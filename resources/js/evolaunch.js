// Assetto Corsa EVO quick launch: pre-select the game mode (Practice, Race, Race
// Weekend), track/layout, weather and player car, then start the game. EVO keeps
// these in protobuf save files under Saved Games\ACE, which it reads at startup.
// Field numbers come from the protobuf descriptors embedded in the EVO exe
// (GameModeSelectionClientCommands.proto):
//   GameModes\GameModeType_<MODE>.gamemodesave  GameModeSave { type = 2, repeated sessions = 3 }
//     session: time_of_day = 4 { year 1, month 2, day 3, hour 4, minute 5, time_multiplier 7 }, track_item = 5
//   GameModes\gamemode.lastgamemode  LastGameMode { type = 1, weather_type = 2, repeated weather_data = 3 }
//     weather_data: { type = 1, weather_data = 3 { mean_ambient_temperature_c = 4, ambient_temperature_c = 21 } }
//   ProfileData\<profile>\OpenData\garage.drivergarage  field 4 = current car GUID
// EVO's Single Player page opens on LastGameMode.type with its weather.
// Car GUIDs are generated per car configuration by the game: the ones it has used
// are logged as "Set new car <guid> <preset>", and guid_map.carhashguid holds one
// for every configuration in its car list (withAllConfigs).
import { join, exists, listDir, readText, writeText, log, startProcess, isProcessRunning, userRoots, IS_LINUX } from './util.js';
import { readPackageFile } from './kspkg.js';

const EVO_APPID = '3058630';

// ---------------------------------------------------------------------------
// Protobuf: parse fields keeping their raw bytes so unknown fields survive edits.

function parseRaw(buf) {
  const out = [];
  let i = 0;
  const varint = () => { let r = 0n, s = 0n, b; do { if (i >= buf.length) throw new Error('truncated'); b = buf[i++]; r |= BigInt(b & 0x7F) << s; s += 7n; } while (b & 0x80); return r; };
  while (i < buf.length) {
    const start = i;
    const key = varint(), f = Number(key >> 3n), w = Number(key & 7n);
    let value;
    if (w === 0) value = varint();
    else if (w === 2) { const len = Number(varint()); value = buf.subarray(i, i + len); i += len; }
    else if (w === 1) i += 8;
    else if (w === 5) { value = new DataView(buf.buffer, buf.byteOffset + i, 4).getFloat32(0, true); i += 4; }
    else throw new Error(`unsupported wire type ${w}`);
    out.push({ f, w, value, raw: buf.subarray(start, i) });
  }
  return out;
}

const varint = n => { let v = BigInt(n); const out = []; do { let b = Number(v & 0x7Fn); v >>= 7n; if (v) b |= 0x80; out.push(b); } while (v); return out; };
const fieldNum = (f, n) => [...varint((f << 3) | 0), ...varint(n)];
const fieldBytes = (f, bytes) => [...varint((f << 3) | 2), ...varint(bytes.length), ...bytes];
const fieldStr = (f, s) => fieldBytes(f, [...new TextEncoder().encode(s)]);
const fieldF32 = (f, x) => { const b = new Uint8Array(4); new DataView(b.buffer).setFloat32(0, x, true); return [...varint((f << 3) | 5), ...b]; };
// proto3 leaves out zero values, and so does EVO.
const fieldNumOpt = (f, n) => n ? fieldNum(f, n) : [];

const num = (fields, f) => Number(fields.find(x => x.f === f && x.w === 0)?.value ?? 0n);
const f32 = (fields, f) => fields.find(x => x.f === f && x.w === 5)?.value ?? null;
const msgs = (fields, f) => fields.filter(x => x.f === f && x.w === 2);

// Rebuild a message, replacing (or appending) field `f` with `replacement` bytes.
function replaceField(fields, f, replacement) {
  const out = [];
  let done = false;
  for (const x of fields) {
    if (x.f === f) { if (!done) { out.push(...replacement); done = true; } }
    else out.push(...x.raw);
  }
  if (!done) out.push(...replacement);
  return new Uint8Array(out);
}

// Rebuild a message, passing every occurrence of field `f` through fn(field) -> bytes (null keeps it).
function mapField(fields, f, fn) {
  const out = [];
  for (const x of fields) out.push(...(x.f === f ? fn(x) ?? x.raw : x.raw));
  return new Uint8Array(out);
}

async function readBin(path) {
  try { return new Uint8Array(await Neutralino.filesystem.readBinaryFile(path)); } catch { return null; }
}

async function backupOnce(path, data) {
  const bak = `${path}.launcher-backup`;
  if (!(await exists(bak))) await Neutralino.filesystem.writeBinaryFile(bak, data.slice().buffer);
}

// ---------------------------------------------------------------------------
// Locations

async function saveRoot() {
  if (userRoots.evo) return userRoots.evo; // set by resolvePaths (the Proton prefix on Linux)
  const home = (await Neutralino.os.getEnv('USERPROFILE')).replace(/\\/g, '/');
  return join(home, 'Saved Games/ACE');
}

async function garagePath(root) {
  // One folder per profile; use the most recently modified one.
  const profiles = (await listDir(join(root, 'ProfileData'))).filter(e => e.type === 'DIRECTORY');
  let best = null, bestTime = -1;
  for (const p of profiles) {
    const file = join(root, 'ProfileData', p.entry, 'OpenData/garage.drivergarage');
    try { const st = await Neutralino.filesystem.getStats(file); if (st.modifiedAt > bestTime) { best = file; bestTime = st.modifiedAt; } } catch { /* none */ }
  }
  return best;
}

const guidHex = (hi, lo) => hi.toString(16).padStart(16, '0') + lo.toString(16).padStart(16, '0');

export async function isEvoRunning() {
  return isProcessRunning('AssettoCorsaEVO');
}

// ---------------------------------------------------------------------------
// Car configurations the game has already used. A GUID identifies one exact
// car + mechanical preset + livery (visual preset); EVO logs each pick as
//   [time] ... Selected <car name> <mech preset> <visual preset>   (preset screen)
//   [time] ... Set new car <guid> content\cars\<car>\presets\<mech>.mechanicalcarpreset
// so the last "Selected" line before "Set new car" names the livery.
// EVO only keeps its last ~10 logs, so what we learn is merged into
// <cacheDir>/known-cars.json and survives log rotation.
//
// Returns cars newest first: [{ carId, seen, current, configs: [{ guid, mech, visual, seen, current }] }]

export async function knownCars(cacheDir) {
  const root = await saveRoot();
  const storePath = cacheDir && join(cacheDir, 'known-cars.json');
  let store = { v: 2, cars: {} };
  try {
    const j = JSON.parse(await readText(storePath) || '{}');
    if (j.v === 2) store = j;
    else for (const [carId, c] of Object.entries(j)) store.cars[carId] = { [c.guid]: { mech: c.preset || '', visual: '', seen: c.seen } }; // v1: one GUID per car
  } catch { /* start over */ }
  let changed = false;
  const add = (carId, guid, mech, visual, seen, onlyIfMissing = false) => {
    guid = guid.replace(/-/g, '').toLowerCase();
    const car = store.cars[carId] || (store.cars[carId] = {});
    const prev = car[guid];
    const keep = onlyIfMissing && prev?.visual;
    const next = { mech: mech || prev?.mech || '', visual: (!keep && visual) || prev?.visual || '', seen: prev && prev.seen > seen ? prev.seen : seen };
    if (JSON.stringify(prev) !== JSON.stringify(next)) { car[guid] = next; changed = true; }
  };

  const logs = (await listDir(join(root, 'Logs'))).filter(e => /^log-.*\.txt$/i.test(e.entry)).map(e => e.entry).sort();
  for (const f of logs) {
    const text = await readText(join(root, 'Logs', f));
    if (!text) continue;
    // A car loaded from the garage at session start has no "Selected" line before
    // it, but the car menu's first "Selected" line afterwards shows the current
    // car, so that one names its livery (only used when still unknown).
    let picked = null, lastSet = null;
    for (const line of text.split('\n')) {
      const sel = line.match(/^\[([^\]]+)\].*\] Selected .+ (\S+) (\S+)\s*$/);
      if (sel) {
        if (lastSet && lastSet.mech === sel[2]) add(lastSet.carId, lastSet.guid, sel[2], sel[3], lastSet.seen, true);
        lastSet = null;
        picked = { mech: sel[2], visual: sel[3] };
        continue;
      }
      const m = line.match(/^\[([^\]]+)\].*?Set new car ([0-9a-f-]{36}) content\\cars\\([^\\\s]+)\\presets\\([^\\\s]+)\.mechanicalcarpreset/i);
      if (m) {
        add(m[3], m[2], m[4], picked?.mech === m[4] ? picked.visual : '', m[1]);
        lastSet = { carId: m[3], guid: m[2], mech: m[4], seen: m[1] };
        picked = null;
      }
    }
  }
  // The last championship also stores the player's car as <steamid><guid hi>-<guid lo>.
  const season = await readText(join(root, 'last_season.seasondefinition'));
  for (const m of (season || '').matchAll(/7656119\d{10}([0-9a-f]{16})-([0-9a-f]{16})[\s\S]{0,12}?content\\cars\\([a-z0-9_]+)\\/gi)) {
    if (!store.cars[m[3]]) add(m[3], m[1] + m[2], '', '', '0');
  }
  if (changed && storePath) await writeText(storePath, JSON.stringify(store)).catch(err => log(`known cars: ${err?.message}`));

  const current = await currentCarGuid();
  return Object.entries(store.cars).map(([carId, configs]) => {
    const list = Object.entries(configs).map(([guid, c]) => ({ guid, ...c, current: guid === current }))
      .sort((a, b) => b.seen.localeCompare(a.seen));
    return { carId, configs: list, seen: list[0]?.seen || '', current: list.some(c => c.current) };
  }).filter(c => c.configs.length).sort((a, b) => b.seen.localeCompare(a.seen));
}

export async function currentCarGuid() {
  const file = await garagePath(await saveRoot());
  const data = file && await readBin(file);
  if (!data) return '';
  const car = parseRaw(data).find(x => x.f === 4 && x.w === 2);
  if (!car) return '';
  const g = parseRaw(car.value);
  return guidHex(g.find(x => x.f === 1)?.value ?? 0n, g.find(x => x.f === 2)?.value ?? 0n);
}

// ---------------------------------------------------------------------------
// Every car configuration, driven or not. EVO keeps an ID per configuration in
// Saved Games\ACE\guid_map.carhashguid (CarHashGUIDData { map<uint64, GUID> map = 1 }),
// filled in for the whole car list, not only for cars the player has driven. The
// key is FNV-1a 64 over the configuration's paths as the game stores them,
// concatenated: <car>.actor + mechanical preset + visual preset, then "1" for the
// player's car (without it: the stock car the game uses elsewhere).

const U64 = (1n << 64n) - 1n;
function fnv1a64(s) {
  let h = 0xcbf29ce484222325n;
  for (const b of new TextEncoder().encode(s)) { h ^= BigInt(b); h = (h * 0x100000001b3n) & U64; }
  return h;
}
const configHash = (carId, mechPath, visualPath) => fnv1a64(`content\\cars\\${carId}\\${carId}.actor${mechPath}${visualPath}1`);

async function readGuidMap() {
  const data = await readBin(join(await saveRoot(), 'guid_map.carhashguid'));
  const map = new Map(); // hash (BigInt) -> guid hex
  for (const e of data ? msgs(parseRaw(data), 1) : []) {
    const f = parseRaw(e.value), key = f.find(x => x.f === 1 && x.w === 0)?.value, g = msgs(f, 2)[0];
    if (key == null || !g) continue;
    const gf = parseRaw(g.value);
    map.set(key, guidHex(gf.find(x => x.f === 1)?.value ?? 0n, gf.find(x => x.f === 2)?.value ?? 0n));
  }
  return map;
}

// known: knownCars() output; presets: readCarPresets() (kspkg.js). Returns known with
// every configuration EVO has an ID for added after the driven ones ({ stock: true },
// seen ''), and cars never driven appended.
export async function withAllConfigs(known, presets) {
  const [map, current] = await Promise.all([readGuidMap().catch(() => new Map()), currentCarGuid().catch(() => '')]);
  if (!map.size) return known;
  const short = p => p.split('\\').pop().replace(/\.[^.]+$/, '');
  const byCar = new Map(known.map(k => [k.carId, { ...k, configs: [...k.configs] }]));
  for (const { carId, mech, visuals } of presets) {
    for (const visual of visuals) {
      const guid = map.get(configHash(carId, mech, visual));
      if (!guid) continue;
      const car = byCar.get(carId) || byCar.set(carId, { carId, configs: [], seen: '', current: false }).get(carId);
      if (car.configs.some(c => c.guid === guid)) continue;
      car.configs.push({ guid, mech: short(mech), visual: short(visual), seen: '', current: guid === current, stock: true });
      if (guid === current) car.current = true;
    }
  }
  return [...byCar.values()];
}


// ---------------------------------------------------------------------------
// Game modes, sessions and weather
//
// GameModeSelectionSession fields used here (what EVO's Game Mode page edits):
//   name 1, duration 2 (seconds, or laps), duration_type 3 (1 time, 2 laps),
//   time_of_day 4 { hour 4, minute 5, time_multiplier 7 }, track_item 5,
//   grid_type 6 (0 automatic, 1 custom), num_opponents 7, single_make 12,
//   starting_position 22 (0 random), min_strength 30, max_strength 31,
//   aggressivness 32 (1 safe; always written as 1: the game only runs "Safe").
// The AI grid settings live in the first session; EVO builds the field from
// them when the session starts.

// GameModeType values; Practice uses the layout's "Time Attack" container, the
// races its "Race" container (track_containers.table).
export const EVO_MODES = {
  practice: { type: 10, label: 'Practice', file: 'GameModeType_PRACTICE', container: 'practice' },
  race: { type: 3, label: 'Race', file: 'GameModeType_INSTANT_RACE', container: 'race' },
  weekend: { type: 1, label: 'Race Weekend', file: 'GameModeType_RACE_WEEKEND', container: 'race' },
};

// GameModeSelectionWeatherType values EVO's weather page offers, with each preset's
// mean temperature (system\weather\gamemodeselectionweathertype_*.gamemodeweather).
export const EVO_WEATHER = [
  { id: 0, label: 'Clear', temp: 23.381511688232422 },
  { id: 1, label: 'Scattered clouds', temp: 22.85244369506836 },
  { id: 2, label: 'Broken clouds', temp: 22.85244369506836 },
  { id: 3, label: 'Overcast', temp: 22.85244369506836 },
  { id: 4, label: 'Drizzle', temp: 21.29471778869629 },
  { id: 5, label: 'Rain', temp: 21.29471778869629 },
  { id: 6, label: 'Heavy rain', temp: 16.595417022705078 },
];
export const EVO_GRIP = [[0, 'Green'], [1, 'Fast'], [2, 'Optimum']];
export const EVO_TIME_SPEEDS = [1, 2, 4, 6, 12, 24, 48];
const WEEKEND_ROLES = { practice: 'practice', qualifying: 'qualifying', warmup: 'warmup', race: 'race' };

// Session settings as the launcher edits them, with EVO's own defaults.
export function defaultEvoSession() {
  const grid = { custom: false, opponents: 9, skillMin: 88, skillMax: 92, singleMake: false };
  return {
    mode: 'practice',
    practice: { minutes: 60, start: 10 * 60 + 45, speed: 1 },
    race: { type: 'laps', laps: 10, minutes: 20, start: 14 * 60, speed: 1, startPos: 0, grid: { ...grid } },
    weekend: {
      practice: { minutes: 10, start: 9 * 60, speed: 1 },
      qualifying: { minutes: 15, start: 12 * 60, speed: 1 },
      warmup: { minutes: 10, start: 13 * 60, speed: 1 },
      race: { type: 'laps', laps: 10, minutes: 20, start: 14 * 60, speed: 1 },
      grid: { ...grid },
    },
    weather: { type: 0, dynamic: false, grip: 2 },
  };
}

function readSession(s) {
  const f = parseRaw(s.value), tod = msgs(f, 4)[0], t = tod ? parseRaw(tod.value) : [];
  const laps = num(f, 3) === 2, duration = num(f, 2);
  return {
    name: String(new TextDecoder().decode(msgs(f, 1)[0]?.value || new Uint8Array())).toLowerCase(),
    timing: {
      ...(laps ? { type: 'laps', laps: duration || 1 } : { type: 'time', minutes: Math.round(duration / 60) }),
      start: num(t, 4) * 60 + num(t, 5), speed: f32(t, 7) || 1,
    },
    startPos: num(f, 22),
    grid: {
      custom: num(f, 6) === 1, opponents: num(f, 7), skillMin: num(f, 30) || 88, skillMax: num(f, 31) || 92,
      singleMake: num(f, 12) === 1,
    },
  };
}

// What EVO's Single Player page currently has, in the shape of defaultEvoSession().
export async function readEvoSession() {
  const dir = join(await saveRoot(), 'GameModes');
  const out = defaultEvoSession();
  const merge = (to, from) => { for (const k of Object.keys(to)) if (from[k] !== undefined && typeof to[k] !== 'object') to[k] = from[k]; };
  try {
    const last = await readBin(join(dir, 'gamemode.lastgamemode'));
    if (last) {
      const f = parseRaw(last);
      out.mode = Object.keys(EVO_MODES).find(k => EVO_MODES[k].type === num(f, 1)) || 'practice';
      out.weather.type = num(f, 2);
      const entry = msgs(f, 3).map(w => parseRaw(w.value)).find(wf => num(wf, 1) === out.weather.type);
      if (entry) { out.weather.dynamic = num(entry, 2) === 1; out.weather.grip = num(entry, 6); }
    }
  } catch (err) { log(`evo session: ${err?.message}`); }
  for (const [key, m] of Object.entries(EVO_MODES)) {
    try {
      const data = await readBin(join(dir, `${m.file}.gamemodesave`));
      const sessions = data ? msgs(parseRaw(data), 3).map(readSession) : [];
      if (!sessions.length) continue;
      if (key === 'practice') merge(out.practice, { minutes: sessions[0].timing.minutes, start: sessions[0].timing.start, speed: sessions[0].timing.speed });
      if (key === 'race') {
        merge(out.race, { ...sessions[0].timing, startPos: sessions[0].startPos });
        if (sessions[0].grid.opponents) merge(out.race.grid, sessions[0].grid);
      }
      if (key === 'weekend') {
        for (const s of sessions) if (WEEKEND_ROLES[s.name]) merge(out.weekend[WEEKEND_ROLES[s.name]], s.timing);
        if (sessions[0].grid.opponents) merge(out.weekend.grid, sessions[0].grid);
      }
    } catch (err) { log(`evo session ${key}: ${err?.message}`); }
  }
  return out;
}

// One session's timing: { type: 'time'|'laps', minutes, laps, start, speed }.
function timingFields(f, t) {
  let bytes = t.type === 'laps'
    ? replaceField(parseRaw(replaceField(f, 2, fieldNumOpt(2, t.laps))), 3, fieldNum(3, 2))
    : replaceField(parseRaw(replaceField(f, 2, fieldNumOpt(2, Math.round(t.minutes * 60)))), 3, fieldNum(3, 1));
  const g = parseRaw(bytes), tod = msgs(g, 4)[0];
  let time = tod ? parseRaw(tod.value) : [];
  time = parseRaw(replaceField(time, 4, fieldNumOpt(4, Math.floor(t.start / 60))));
  time = parseRaw(replaceField(time, 5, fieldNumOpt(5, t.start % 60)));
  const timeBytes = replaceField(time, 7, fieldF32(7, t.speed || 1));
  return replaceField(g, 4, fieldBytes(4, [...timeBytes]));
}

function gridFields(bytes, grid, maxOpponents) {
  const set = (b, f, v) => replaceField(parseRaw(b), f, fieldNumOpt(f, v));
  bytes = set(bytes, 6, grid.custom ? 1 : 0);
  if (grid.custom) return bytes; // EVO's own custom grid (models picked in the game) stays as it is
  bytes = set(bytes, 7, Math.max(1, Math.min(grid.opponents, maxOpponents)));
  bytes = set(bytes, 30, Math.min(grid.skillMin, grid.skillMax));
  bytes = set(bytes, 31, Math.max(grid.skillMin, grid.skillMax));
  bytes = set(bytes, 32, 1);
  return set(bytes, 12, grid.singleMake ? 1 : 0);
}

// Track, timing and AI grid of every session of the selected mode.
async function writeGameMode(session, track, layout, contentPkg) {
  const mode = session.mode, m = EVO_MODES[mode];
  const c = layout[m.container];
  if (!c) throw new Error(`${track.name} ${layout.name} has no ${m.label} layout in EVO.`);
  const file = join(await saveRoot(), `GameModes/${m.file}.gamemodesave`);
  let data = await readBin(file);
  if (data) await backupOnce(file, data);
  else {
    // EVO creates the file the first time the mode is opened; start from its default.
    data = contentPkg ? await readPackageFile(contentPkg, `system\\gamemodes\\${m.file.toLowerCase()}.gamemodesave`).catch(() => null) : null;
    if (!data) throw new Error(`Open ${m.label} once in EVO first so it creates its save file.`);
  }

  // Same field layout EVO writes itself (TrackItem).
  const maxDrivers = c.maxDrivers ?? c.layoutId ?? 0;
  const block = [
    ...fieldStr(1, track.country), ...fieldStr(2, track.name), ...fieldStr(3, c.layoutName),
    ...fieldNum(5, maxDrivers), ...fieldStr(6, c.container), ...fieldNum(7, 1),
    ...fieldStr(8, track.region), ...fieldNum(9, c.length),
  ];
  const top = parseRaw(data);
  if (!msgs(top, 3).length) throw new Error(`Unexpected ${m.label} save format`);
  let index = -1;
  const out = mapField(top, 3, s => {
    index++;
    let bytes = replaceField(parseRaw(s.value), 5, fieldBytes(5, block));
    const role = mode === 'weekend' ? WEEKEND_ROLES[readSession(s).name] : mode;
    const timing = mode === 'weekend' ? session.weekend[role] : session[mode];
    if (timing) bytes = timingFields(parseRaw(bytes), timing);
    if (mode === 'race') {
      // Like EVO's menu: the slot stays within the grid (opponents + 1); 0 = random.
      const g = session.race.grid, last = Math.min(g.opponents, maxDrivers ? maxDrivers - 1 : 32) + 1;
      bytes = replaceField(parseRaw(bytes), 22, fieldNumOpt(22, g.custom ? session.race.startPos : Math.min(session.race.startPos, last)));
    }
    const grid = mode === 'race' ? session.race.grid : mode === 'weekend' ? session.weekend.grid : null;
    if (grid && index === 0) bytes = gridFields(bytes, grid, maxDrivers ? maxDrivers - 1 : 32);
    return fieldBytes(3, [...bytes]);
  });
  await Neutralino.filesystem.writeBinaryFile(file, out.slice().buffer);
}

// Selected mode and weather. EVO keeps one entry per weather preset and copies
// the static/dynamic choice and the initial grip onto the preset you pick, so
// they're written to that preset's entry. Earlier launcher versions changed the
// presets' temperature (EVO ignores it); those values are put back.
async function writeLastGameMode(mode, weather) {
  const file = join(await saveRoot(), 'GameModes/gamemode.lastgamemode');
  const data = await readBin(file) || new Uint8Array();
  if (data.length) await backupOnce(file, data);
  let out = replaceField(parseRaw(data), 1, fieldNum(1, EVO_MODES[mode].type));
  out = replaceField(parseRaw(out), 2, fieldNumOpt(2, weather.type));
  out = mapField(parseRaw(out), 3, w => {
    let wf = parseRaw(w.value);
    const type = num(wf, 1);
    let bytes = null;
    const preset = EVO_WEATHER.find(p => p.id === type), d = msgs(wf, 3)[0];
    if (preset && d) {
      const df = parseRaw(d.value), mean = f32(df, 4), now = f32(df, 21);
      if (mean != null && Math.abs(mean - preset.temp) > 0.01) {
        let wd = replaceField(df, 4, fieldF32(4, preset.temp));
        if (now != null) wd = replaceField(parseRaw(wd), 21, fieldF32(21, preset.temp + (now - mean)));
        bytes = replaceField(wf, 3, fieldBytes(3, [...wd]));
        wf = parseRaw(bytes);
      }
    }
    if (type === weather.type) {
      bytes = replaceField(wf, 2, fieldNumOpt(2, weather.dynamic ? 1 : 0));
      bytes = replaceField(parseRaw(bytes), 6, fieldNumOpt(6, weather.grip));
    }
    return bytes ? fieldBytes(3, [...bytes]) : null;
  });
  await Neutralino.filesystem.writeBinaryFile(file, out.slice().buffer);
}

// ---------------------------------------------------------------------------
// Car

async function setCurrentCar(guid) {
  const file = await garagePath(await saveRoot());
  const data = file && await readBin(file);
  if (!data) throw new Error('No EVO garage found. Drive any car in EVO once first.');
  await backupOnce(file, data);
  const hi = BigInt('0x' + guid.slice(0, 16)), lo = BigInt('0x' + guid.slice(16, 32));
  const out = replaceField(parseRaw(data), 4, fieldBytes(4, [...fieldNum(1, hi), ...fieldNum(2, lo)]));
  await Neutralino.filesystem.writeBinaryFile(file, out.slice().buffer);
}

// session: see defaultEvoSession(); track/layout from the EVO catalogue;
// carGuid optional (keep the current car when empty).
export async function prepareEvoSession({ session, track, layout, carGuid, contentPkg }) {
  if (await isEvoRunning()) throw new Error('Assetto Corsa EVO is already running. Close it first so it picks up the new selection.');
  await writeGameMode(session, track, layout, contentPkg);
  await writeLastGameMode(session.mode, session.weather);
  if (carGuid) await setCurrentCar(carGuid);
  log(`evo ${session.mode}: ${track.name} / ${layout.name} car ${carGuid || '(current)'} ${JSON.stringify(session.weather)}`);
}

// Launch through Steam: started directly, the exe can fail Steam's ownership
// check ("user has no permission to run this product").
export async function launchEvo({ steamPath, installDir, ...selection }) {
  await prepareEvoSession({ contentPkg: installDir ? join(installDir, 'content.kspkg') : '', ...selection });
  // On Linux `steam -applaunch` starts it under the game's Proton setup.
  if (steamPath || IS_LINUX) await startProcess(join(steamPath, 'steam.exe'), steamPath || '/', ['-applaunch', EVO_APPID, '-no_intro']);
  else await startProcess(join(installDir, 'AssettoCorsaEVO.exe'), installDir, ['-no_intro']);
}
