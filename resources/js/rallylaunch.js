// Assetto Corsa Rally quick launch. Rally ignores command-line levels, so this
// pre-selects its Free Practice menu instead: the menu opens on the stage, car
// and start time the player last drove, which Rally keeps in
// %LOCALAPPDATA%\acr\Saved\SaveGames\PlayerDataSaveSlot.sav. That file is an
// Unreal GVAS save with no properties, followed by the game's own data:
//   FString "PlayerSaveGameData", int32 size of the rest of the file, then a blob
//   holding, among others, the Free Practice selection:
//     FString stage ("WelesS4HafrenSouthFullReverse"), FString car ("LanciaDeltaIntegraleEvo"),
//     int32 option count (3), then (FString key, FString value) pairs:
//       /Script/acr.WeatherOptions/StartingTime  (TimeSeconds=34200.000000)
//       /Script/acr.WeatherOptions/Preset        (WeatherType=WT_CLEAR,RandomUniform=…,bRandom=False)
//       /Script/acr.WeatherOptions/TimeSpeed     WT_SPEEDREALISTIC
// Rally applies the stage, car and start time from these; the weather and time
// speed here are leftovers it no longer reads (tested). Its Weather & Time screen
// keeps its settings in the RaceEventRaceSettingsFreePracticeComponent struct
// further up (rallyWeather below).
// Stage ids only appear in the save once the player has driven them, so the
// launcher offers the stages it has seen there.
import { exists, log, isProcessRunning } from './util.js';
import { rallyGroupName, rallyStageName } from './rallydata.js';
import { N_ } from './i18n.js';

const KEY_TIME = '/Script/acr.WeatherOptions/StartingTime';
const SIZE_NAME = 'PlayerSaveGameData\0';

// Stage ids are <location>[S<n>]<stage><Full|CutN|ShortN><Forward|Reverse>.
export const RALLY_LOCATIONS = {
  Alsace: { name: 'Alsace', country: 'France' },
  Greece: { name: 'Greece', country: 'Greece' },
  Livigno: { name: 'Livigno', country: 'Italy' },
  MonteCarlo: { name: 'Monte Carlo', country: 'France' },
  Weles: { name: 'Wales', country: 'United Kingdom' },
  Wales: { name: 'Wales', country: 'United Kingdom' },
};
const STAGE_ID = /^[A-Z][A-Za-z0-9]*(Forward|Reverse)$/;
// Every stage in the game. The variants come from the pacenote tables in the
// game's packages (Data/Pacenote/Tables/DT_Pacenote<Stage><Variant><Direction>),
// the stage groups from its Environments folders; ids follow the save's naming
// (Alsace uses "Short", the others "Cut"; Wales is spelled "Weles").
const STAGE_VARIANTS = {
  AlsaceS2Munster: ['Full', 'Short1', 'Short2'], AlsaceS4Saverne: ['Full', 'Short1'],
  GreeceS3Elatia: ['Full', 'Cut1', 'Cut2'], GreeceS4Loutraki: ['Full', 'Cut1', 'Cut2'],
  LivignoTestTrack01: ['Full'],
  MonteCarloS1Bollene: ['Full', 'Cut1', 'Cut2', 'Cut3'], MonteCarloS2Sisteron: ['Full', 'Cut1', 'Cut2'],
  WelesS3HafrenNorth: ['Full', 'Cut1', 'Cut2'], WelesS4HafrenSouth: ['Full'],
};
export const RALLY_KNOWN_STAGES = Object.entries(STAGE_VARIANTS).flatMap(([group, variants]) =>
  variants.flatMap(v => [`${group}${v}Forward`, `${group}${v}Reverse`]));
// Location covers (img/rally/<location>.jpg, credits in CREDITS.txt); locations without one use a stage photo.
const COVERS = new Set(['Alsace', 'Greece', 'Livigno', 'MonteCarlo', 'Weles']);
export const rallyCover = location => COVERS.has(location) ? `/img/rally/${location.toLowerCase()}.jpg` : '';
const words = s => s.replace(/([a-z])([A-Z0-9])/g, '$1 $2').replace(/(\d)([A-Z])/g, '$1 $2');

// { location, locationName, country, group, stage, name, length, direction } of a stage id:
// stage is the group's name ("Col de Turini"), name the variant's as the game shows it
// ("La Bollène-Vésubie - Turini", rallydata.js; '' for a stage it doesn't know yet).
export function rallyStage(id) {
  const loc = Object.keys(RALLY_LOCATIONS).find(k => id.startsWith(k)) || (/^[A-Z][a-z]+/.exec(id) || [id])[0];
  const m = /^(?:S(\d+))?(.*?)(Full|Cut\d*|Short\d*)?(Forward|Reverse)$/.exec(id.slice(loc.length)) || [];
  const group = `${loc}${m[1] ? `S${m[1]}` : ''}${m[2] || ''}`;
  const len = m[3] || '';
  return {
    location: loc === 'Wales' ? 'Weles' : loc,
    locationName: RALLY_LOCATIONS[loc]?.name || words(loc),
    country: RALLY_LOCATIONS[loc]?.country || '',
    group,
    stage: rallyGroupName(group) || words(m[2] || id).replace(/^Bollene$/, 'Bollène'),
    name: rallyStageName(id),
    length: len === 'Full' ? 'Full stage' : len ? `Short ${len.replace(/\D/g, '') || ''}`.trim() : '',
    direction: m[4] || '',
  };
}

// FString at `at`, or null: int32 length (with the null), then Latin-1 bytes
// and a null, or, when the length is negative, that many UTF-16LE characters
// (Unreal's form for text with any non-ASCII character, e.g. a livery folder
// named "Rzeźnik 2026"). `max` caps the length in characters.
function fstrAt(b, at, max = 4096) {
  if (at < 0 || at + 4 > b.length) return null;
  const dv = new DataView(b.buffer, b.byteOffset);
  const n = dv.getInt32(at, true);
  if (n >= 1 && n <= max) {
    if (at + 4 + n > b.length || b[at + 3 + n] !== 0) return null;
    return { start: at, at, end: at + 4 + n, value: String.fromCharCode(...b.subarray(at + 4, at + 3 + n)) };
  }
  if (n <= -1 && -n <= max) {
    const end = at + 4 - 2 * n;
    if (end > b.length || dv.getUint16(end - 2, true) !== 0) return null;
    let value = '';
    for (let i = at + 4; i < end - 2; i += 2) value += String.fromCharCode(dv.getUint16(i, true));
    return { start: at, at, end, value };
  }
  return null;
}
function readStr(b, at) {
  const s = fstrAt(b, at);
  if (!s) throw new Error('bad string');
  return s;
}
function fstr(s) {
  if (/^[\x00-\x7f]*$/.test(s)) {
    const out = new Uint8Array(4 + s.length + 1);
    new DataView(out.buffer).setInt32(0, s.length + 1, true);
    for (let i = 0; i < s.length; i++) out[4 + i] = s.charCodeAt(i);
    return out;
  }
  const out = new Uint8Array(4 + 2 * (s.length + 1)), dv = new DataView(out.buffer);
  dv.setInt32(0, -(s.length + 1), true);
  for (let i = 0; i < s.length; i++) dv.setUint16(4 + 2 * i, s.charCodeAt(i), true);
  return out;
}
const indexOf = (b, text, from = 0) => {
  const t = [...text].map(c => c.charCodeAt(0));
  outer: for (let i = b.indexOf(t[0], from); i >= 0 && i <= b.length - t.length; i = b.indexOf(t[0], i + 1)) {
    for (let j = 1; j < t.length; j++) if (b[i + j] !== t[j]) continue outer;
    return i;
  }
  return -1;
};

// A save the parser doesn't recognise; `why` names the check that failed, so a
// report says what differs.
const layoutError = why => Object.assign(new Error(`unexpected save layout (${why})`), { layout: true });

// The size field after "PlayerSaveGameData", or -1 when it doesn't hold the size
// of the rest of the file (then nothing that changes the file's length is written).
function sizeField(b) {
  const name = indexOf(b, SIZE_NAME);
  if (name < 0) throw new Error('not a Rally save');
  const at = name + SIZE_NAME.length;
  return at + 4 + new DataView(b.buffer, b.byteOffset).getInt32(at, true) === b.length ? at : -1;
}

// The Free Practice selection whose options include the StartingTime key at
// `key`. Rally has always saved 3 options with StartingTime first; any count and
// order is accepted, so the block start is searched for: an int32 count, then
// that many (key, value) strings, one of them this key.
function selectionAt(b, key, from) {
  const dv = new DataView(b.buffer, b.byteOffset);
  let countAt = -1, opts = [], end = 0;
  for (let at = key - 8; at >= Math.max(from, key - 4096) && countAt < 0; at--) {
    const count = dv.getInt32(at, true);
    if (count < 1 || count > 16) continue;
    const list = [];
    let p = at + 4;
    for (let i = 0; i < count; i++) {
      const k = fstrAt(b, p), v = k && fstrAt(b, k.end);
      if (!k || !v) break;
      list.push({ k, v }); p = v.end;
    }
    if (list.length === count && list.some(o => o.k.start === key - 4)) { countAt = at; opts = list; end = p; }
  }
  if (countAt < 0) throw layoutError('weather options unreadable');
  // Walk back over the car string, then the stage string.
  const back = (stop, what) => {
    for (let n = 2; n < 128; n++) {
      const at = stop - 4 - n;
      if (at > from && dv.getInt32(at, true) === n && b[stop - 1] === 0) return readStr(b, at);
    }
    throw layoutError(`no ${what} name`);
  };
  const car = back(countAt, 'car'), stage = back(car.start, 'stage');
  if (!STAGE_ID.test(stage.value)) throw layoutError(`stage id "${stage.value}"`);
  if (!/^[A-Za-z0-9]+$/.test(car.value)) throw layoutError(`car id "${car.value}"`);
  const time = opts.find(o => o.k.value === KEY_TIME);
  return { stage, car, countAt, opts, end, seconds: Number(/TimeSeconds=([\d.]+)/.exec(time.v.value)?.[1] ?? 36000) };
}

// Locate the Free Practice selection and the size field around it. Every
// StartingTime key is tried, in case another block has one too.
function parse(b) {
  const sizeAt = sizeField(b);
  if (sizeAt < 0) throw layoutError(`size field, file ${b.length} bytes`);
  let first = null;
  for (let key = indexOf(b, KEY_TIME); key >= 0; key = indexOf(b, KEY_TIME, key + 1)) {
    try { return { sizeAt, ...selectionAt(b, key, sizeAt) }; } catch (err) { if (!err.layout) throw err; first ||= err; }
  }
  throw first || Object.assign(new Error('no Free Practice selection yet'), { empty: true });
}

// --- Weather & Time (Free Practice)
// The game's lists, in its order (the save stores the position), with the names
// and icons its Weather & Time screen uses (img/rally/weather, from the game).
export const RALLY_WEATHERS = [
  [N_('Clear'), 'clear'], [N_('Light Clouds'), 'light-clouds'], [N_('Clouds'), 'clouds'],
  [N_('Light Fog'), 'light-fog'], [N_('Fog'), 'fog'], [N_('Light Rain'), 'light-rain'], [N_('Rain'), 'rain'],
  [N_('Storm'), 'storm'], [N_('Light Snow'), 'light-snow'], [N_('Snow'), 'snow'], [N_('Snow Blizzard'), 'blizzard'],
].map(([label, icon], value) => ({ value, label, icon: `/img/rally/weather/${icon}.png` }));
export const RALLY_TIME_SPEEDS = [N_('Fixed (0x)'), N_('Realistic (1x)'), N_('Accelerated (2x)'), N_('Fast (10x)'), N_('Very Fast (25x)'), N_('Unrealistic (60x)')];
export const RALLY_FORECAST_PROBABILITY = [N_('Low'), N_('Medium'), N_('High'), N_('Maximum')];
export const RALLY_PERSISTENCE = [N_('Zero'), N_('Decreased'), N_('Realistic'), N_('Increased')];
export const RALLY_GRIP = [N_('Dirty'), N_('Slow'), N_('Green'), N_('Fast'), N_('Optimal')];
// Weathers a location can have, from the game's DT_WeatherTypesDistributions:
// Greece has no snow; Alsace, Monte Carlo, Wales and Livigno have all eleven. A
// weather the location doesn't have makes Rally fall back to another one.
const NO_SNOW = new Set(['Greece']);
export const rallyLocationWeathers = location => RALLY_WEATHERS.filter(w => !(NO_SNOW.has(location) && w.value >= 8)).map(w => w.value);
// The weather a location has that's closest to `value` (snow becomes rain).
export const rallyWeatherFor = (location, value) => rallyLocationWeathers(location).includes(value) ? value : [5, 6, 7][value - 8] ?? 0;

// RaceEventRaceSettingsFreePracticeComponent: FString name, int32 size (72), then
// the struct (offsets below, found by changing each setting in the game and
// comparing saves). The floats between are random rolls for the forecast; they're
// left as they are. Another size means another layout: then nothing is read or written.
const FP_NAME = 'RaceEventRaceSettingsFreePracticeComponent\0', FP_SIZE = 72;
const FP = {
  weather: [21, 'u8'], forecast: [30, 'u8'], forecastRandom: [35, 'u8'], probability: [39, 'u8'], persistence: [40, 'u8'],
  dynamic: [41, 'u8'], seconds: [45, 'f32'], wetness: [53, 'f32'], snow: [57, 'f32'], speed: [61, 'u8'], grip: [62, 'u8'],
};
const FP_MAX = { weather: 10, forecast: 10, forecastRandom: 1, probability: 3, persistence: 3, dynamic: 1, speed: 5, grip: 4 };
function fpStruct(b) {
  const at = indexOf(b, FP_NAME);
  if (at < 0 || indexOf(b, FP_NAME, at + 1) >= 0) return -1;
  const dv = new DataView(b.buffer, b.byteOffset);
  return dv.getInt32(at + FP_NAME.length, true) === FP_SIZE ? at + FP_NAME.length + 4 : -1;
}
// { weather, forecast (-1 = Random), probability, persistence, dynamic, seconds,
//   wetness, snow (0-100), speed, grip } or null when the struct isn't there.
function readWeather(b) {
  const s = fpStruct(b);
  if (s < 0) return null;
  const dv = new DataView(b.buffer, b.byteOffset), v = {};
  for (const [k, [o, t]] of Object.entries(FP)) v[k] = t === 'u8' ? b[s + o] : dv.getFloat32(s + o, true);
  if (Object.entries(FP_MAX).some(([k, max]) => v[k] > max)) return null;
  return {
    weather: v.weather, forecast: v.forecastRandom ? -1 : v.forecast, probability: v.probability, persistence: v.persistence,
    dynamic: !!v.dynamic, seconds: v.seconds, wetness: Math.round(v.wetness * 100), snow: Math.round(v.snow * 100), speed: v.speed, grip: v.grip,
  };
}
// `b` with the Weather & Time settings in `w` (as readWeather returns them) written in place.
function withWeather(b, w) {
  const s = fpStruct(b);
  if (s < 0 || !readWeather(b)) { log('rally: Weather & Time settings not found, left as they are'); return b; }
  const out = b.slice(), dv = new DataView(out.buffer);
  const u8 = (k, x) => { if (Number.isInteger(x) && x >= 0 && x <= FP_MAX[k]) out[s + FP[k][0]] = x; };
  const pct = (k, x) => { if (Number.isFinite(x)) dv.setFloat32(s + FP[k][0], Math.min(100, Math.max(0, x)) / 100, true); };
  u8('weather', w.weather);
  if (w.forecast === -1) u8('forecastRandom', 1); else if (w.forecast !== undefined) { u8('forecastRandom', 0); u8('forecast', w.forecast); }
  u8('probability', w.probability); u8('persistence', w.persistence); u8('speed', w.speed); u8('grip', w.grip);
  if (typeof w.dynamic === 'boolean') u8('dynamic', w.dynamic ? 1 : 0);
  if (Number.isFinite(w.seconds)) dv.setFloat32(s + FP.seconds[0], w.seconds, true);
  pct('wetness', w.wetness); pct('snow', w.snow);
  return out;
}

// What the launcher can read from the save, which never fails for a save that
// doesn't look as expected: { stage, car ('' when not found), seconds, weather
// (Weather & Time settings, null when not in the known layout), stages (every
// stage id the save mentions), problem }. problem is '' when the selection was
// read, else 'missing' (no save yet), 'empty' (no Free Practice selection yet),
// 'layout' (a layout the launcher doesn't know; detail says what differs).
export async function readRallySave(paths) {
  const out = { stage: '', car: '', seconds: 36000, weather: null, stages: [], problem: '', detail: '' };
  if (!(await exists(paths.rally.save))) return { ...out, problem: 'missing' };
  const b = new Uint8Array(await Neutralino.filesystem.readBinaryFile(paths.rally.save));
  try {
    const sel = parse(b);
    Object.assign(out, { stage: sel.stage.value, car: sel.car.value, seconds: sel.seconds });
  } catch (err) {
    out.problem = err.empty ? 'empty' : 'layout';
    out.detail = err.message;
    log(`rally: ${err.message} in ${paths.rally.save} (${b.length} bytes)`);
  }
  out.weather = readWeather(b);
  if (out.problem && out.weather) out.seconds = out.weather.seconds;
  const text = new TextDecoder('latin1').decode(b);
  out.stages = [...new Set([...text.matchAll(/[A-Z][A-Za-z0-9]+(?:Forward|Reverse)(?=\0)/g)].map(m => m[0]))].filter(id => STAGE_ID.test(id));
  return out;
}

// Best stage times, from the save's stage records. Each stage has a list:
//   FString stage, int32 count, then per car: FString car, FString class,
//   FString "EWeatherType::WT_…", u32 total ms (penalties included), u32 penalty ms,
//   u32 split count, u32 splits (ms), int64 date (.NET ticks), u32.
// (splits + penalty = total, checked.) Map<"stage|car", { ms, at, penalty }>.
export async function rallyBests(paths) {
  const out = new Map();
  if (!(await exists(paths.rally.save))) return out;
  const b = new Uint8Array(await Neutralino.filesystem.readBinaryFile(paths.rally.save));
  const dv = new DataView(b.buffer, b.byteOffset);
  const text = new TextDecoder('latin1').decode(b);
  const back = p => { for (let n = 2; n < 96; n++) { const at = p - n; if (at > 4 && dv.getInt32(at - 4, true) === n && b[p - 1] === 0) return at - 4; } return -1; };
  const str = at => text.slice(at + 4, at + 3 + dv.getInt32(at, true));
  let stage = '';
  for (const m of text.matchAll(/EWeatherType::WT_\w+\0/g)) {
    try {
      const cls = back(m.index - 4), car = cls > 0 ? back(cls) : -1;
      if (car < 0) continue;
      const before = back(car - 4);
      if (before > 0 && STAGE_ID.test(str(before))) stage = str(before);
      const end = m.index + m[0].length, total = dv.getUint32(end, true), penalty = dv.getUint32(end + 4, true), n = dv.getUint32(end + 8, true);
      if (!stage || n > 32) continue;
      let sum = penalty;
      for (let i = 0; i < n; i++) sum += dv.getUint32(end + 12 + 4 * i, true);
      if (sum !== total || !total) continue; // not a stage record
      const ticks = dv.getBigUint64(end + 12 + 4 * n, true);
      const key = `${stage}|${str(car)}`;
      if (!out.has(key) || total < out.get(key).ms) out.set(key, { ms: total, penalty, at: Number((ticks - 621355968000000000n) / 10000n) });
    } catch { /* past the end */ }
  }
  return out;
}

export async function isRallyRunning() {
  return isProcessRunning('acr');
}

// The car → last driven map. The main menu shows the most recently driven car
// (read at startup), so marking the Quick Drive car as driven now makes it the
// menu car. It follows a short car list:
//   int32 k, k × FString car, 8 zero bytes, int32 m, m × (FString car, int64 .NET ticks, local time)
// menuCars returns that list and where it starts, or null when not found.
function menuCars(b) {
  const dv = new DataView(b.buffer, b.byteOffset);
  const str = at => {
    if (at + 4 > b.length) return null;
    const n = dv.getInt32(at, true);
    if (n < 3 || n > 64 || at + 4 + n > b.length || b[at + 3 + n] !== 0) return null;
    const value = String.fromCharCode(...b.subarray(at + 4, at + 3 + n));
    return /^[A-Z][A-Za-z0-9]+$/.test(value) ? { at, end: at + 4 + n, value } : null;
  };
  const ticksOk = at => at + 8 <= b.length && b[at + 7] === 0x08 && b[at + 6] >= 0xd0; // years ~2016-2100
  for (let p = 0; p + 4 < b.length; p++) {
    const k = dv.getInt32(p, true);
    if (k < 1 || k > 16) continue;
    const list = [];
    let q = p + 4;
    for (let i = 0; i < k; i++) { const s = str(q); if (!s) break; list.push(s); q = s.end; }
    if (list.length !== k || q + 12 > b.length || dv.getInt32(q, true) !== 0 || dv.getInt32(q + 4, true) !== 0) continue;
    const m = dv.getInt32(q + 8, true), first = str(q + 12);
    if (m < 1 || m > 64 || !first || !ticksOk(first.end)) continue;
    return { start: p, list };
  }
  return null;
}

const concat = parts => {
  const out = new Uint8Array(parts.reduce((n, x) => n + x.length, 0));
  parts.reduce((at, x) => (out.set(x, at), at + x.length), 0);
  return out;
};
const nowTicks = () => BigInt(Date.now() - new Date().getTimezoneOffset() * 60000) * 10000n + 621355968000000000n;

// The car → last driven entries: [{ at, end, value, ticksAt }] and where the map's count is.
function lastDriven(b) {
  const found = menuCars(b);
  if (!found) return null;
  const dv = new DataView(b.buffer, b.byteOffset);
  const countAt = found.list[found.list.length - 1].end + 8, m = dv.getInt32(countAt, true), entries = [];
  let q = countAt + 4;
  for (let i = 0; i < m; i++) {
    const n = dv.getInt32(q, true);
    if (n < 2 || n > 64 || b[q + 3 + n] !== 0) return null;
    entries.push({ at: q, value: String.fromCharCode(...b.subarray(q + 4, q + 3 + n)), ticksAt: q + 4 + n });
    q += 4 + n + 8;
  }
  return { countAt, entries, end: q };
}

// The save with `car` marked as driven now (so it's the main menu car), or unchanged.
function withLastDriven(b, car) {
  const map = lastDriven(b);
  if (!map) { log('rally: last-driven map not found'); return b; }
  const ticks = new Uint8Array(8);
  new DataView(ticks.buffer).setBigUint64(0, nowTicks(), true);
  const e = map.entries.find(x => x.value === car);
  if (e) { const out = b.slice(); out.set(ticks, e.ticksAt); return out; }
  // A car the save hasn't seen yet: add it to the map.
  const out = concat([b.subarray(0, map.end), fstr(car), ticks, b.subarray(map.end)]);
  new DataView(out.buffer).setInt32(map.countAt, map.entries.length + 1, true);
  return out;
}

// The car → selected livery map at the end of the save: int32 count, then
// (FString car, FString livery) pairs up to the end of the file. A car's own
// livery is its id ("VWPoloGTIR5"), a livery from Documents\My Games\acr\Liveries
// is "usergen_<folder name>". Returns { countAt, entries: [{ at, car, livery, liveryAt, end }] } or null.
export function liveryMap(b) {
  const dv = new DataView(b.buffer, b.byteOffset);
  const str = at => { const s = fstrAt(b, at, 256); return s?.value ? s : null; };
  for (let p = b.length - 8; p > b.length - 8192 && p > 0; p--) {
    const k = dv.getInt32(p, true);
    if (k < 1 || k > 64) continue;
    const entries = [];
    let q = p + 4;
    for (let i = 0; i < k; i++) {
      const c = str(q), l = c && str(c.end);
      if (!c || !l || !/^[A-Z][A-Za-z0-9]+$/.test(c.value)) break;
      entries.push({ at: c.at, car: c.value, livery: l.value, liveryAt: l.at, end: l.end });
      q = l.end;
    }
    if (entries.length === k && q === b.length) return { countAt: p, entries };
  }
  return null;
}

// The save with `livery` selected for `car` (left alone when the map isn't there).
function withLivery(b, car, livery) {
  if (!livery) return b;
  const map = liveryMap(b);
  if (!map) { log('rally: livery map not found'); return b; }
  const e = map.entries.find(x => x.car === car);
  if (e?.livery === livery) return b;
  const out = e ? concat([b.subarray(0, e.liveryAt), fstr(livery), b.subarray(e.end)]) : concat([b, fstr(car), fstr(livery)]);
  if (!e) new DataView(out.buffer).setInt32(map.countAt, map.entries.length + 1, true);
  return out;
}

// The livery the save has selected for each car.
export async function rallySelectedLiveries(paths) {
  if (!(await exists(paths.rally.save))) return {};
  const map = liveryMap(new Uint8Array(await Neutralino.filesystem.readBinaryFile(paths.rally.save)));
  return Object.fromEntries((map?.entries || []).map(e => [e.car, e.livery]));
}

// Pre-select stage, car and start time (seconds after midnight) in Free Practice,
// and its Weather & Time settings when `weather` is given (see withWeather; the
// start time goes in both places Rally keeps it). Whatever the save's layout
// allows is written: without a selection the launcher can read, the Weather &
// Time settings, main menu car and livery still are. Returns { selected } (stage
// and car set) or throws when nothing could be done safely.
export async function writeRallySession(paths, { stage, car, seconds, livery, weather }) {
  if (await isRallyRunning()) throw new Error('Close Assetto Corsa Rally first: it saves its menu over this selection when it exits.');
  if (!STAGE_ID.test(stage) || !/^[A-Za-z0-9]+$/.test(car)) throw new Error('Unknown stage or car');
  const file = paths.rally.save;
  if (!(await exists(file))) { log('rally: no save yet, starting without a selection'); return { selected: false }; }
  const b = new Uint8Array(await Neutralino.filesystem.readBinaryFile(file));
  const sizeAt = sizeField(b);
  let sel = null;
  try { sel = parse(b); } catch (err) { log(`rally: ${err.message} in ${file}, stage and car not set`); }
  let out = b;
  if (sel) {
    const parts = [b.subarray(0, sel.stage.start), fstr(stage), fstr(car), b.subarray(sel.countAt, sel.countAt + 4)];
    for (const { k, v } of sel.opts) parts.push(b.subarray(k.start, k.end), k.value === KEY_TIME ? fstr(`(TimeSeconds=${Number(seconds).toFixed(6)})`) : b.subarray(v.start, v.end));
    parts.push(b.subarray(sel.end));
    out = concat(parts);
  }
  // The main menu shows the same car, with the chosen livery (both lie after the
  // size field, and change the file's length: only with a size field that adds up).
  if (sizeAt >= 0) out = withLivery(withLastDriven(out, car), car, livery);
  // Written in place: the file's length stays the same.
  if (weather) out = withWeather(out, { ...weather, seconds });
  if (out === b) { log('rally: nothing in the save could be set'); return { selected: false }; }
  if (sizeAt >= 0) {
    // The only enclosing size: the blob after "PlayerSaveGameData" runs to the end of the file.
    const dv = new DataView(out.buffer);
    dv.setInt32(sizeAt, dv.getInt32(sizeAt, true) + out.length - b.length, true);
    if (sizeField(out) !== sizeAt) throw new Error('Could not update the Rally save');
  }
  if (sel) {
    const check = parse(out);
    if (check.stage.value !== stage || check.car.value !== car) throw new Error('Could not update the Rally save');
  }
  if (sizeAt >= 0 && livery && liveryMap(out) && liveryMap(out).entries.find(e => e.car === car)?.livery !== livery) throw new Error('Could not update the Rally save');
  // The save as it was before this change, so it can always be put back.
  await Neutralino.filesystem.writeBinaryFile(`${file}.launcher-backup`, b.slice().buffer);
  await Neutralino.filesystem.writeBinaryFile(file, out.buffer);
  const w = weather && readWeather(out);
  log(`rally: ${sel ? `free practice set to ${stage} / ${car} / ${seconds}s` : `free practice selection not found, set ${car}`}${w ? ` / ${JSON.stringify({ ...w, seconds: undefined })}` : ''}`);
  return { selected: !!sel };
}
