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
// Rally applies the stage, car and start time; the weather and time speed it
// keeps in the menu are ignored (tested), so those are left alone.
// Stage ids only appear in the save once the player has driven them, so the
// launcher offers the stages it has seen there.
import { exists, log, powershell } from './util.js';

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
// Stage names as the game shows them, where they differ from the id.
const STAGE_NAMES = {
  MonteCarloS1Bollene: 'Col de Turini',
  MonteCarloS2Sisteron: 'Sisteron',
  LivignoTestTrack01: 'Ice track',
};
// Start and finish of stage variants players have confirmed in the game.
const STAGE_ROUTES = {
  MonteCarloS1BolleneFullForward: 'Bollène-Vésubie → Peira-Cava',
  MonteCarloS1BolleneFullReverse: 'Peira-Cava → Bollène-Vésubie',
  WelesS4HafrenSouthFullForward: 'Afon Bidno → Severn',
  WelesS4HafrenSouthFullReverse: 'Severn → Afon Bidno',
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
// Location covers (img/rally/<location>.jpg, credits in CREDITS.txt).
export const rallyCover = location => RALLY_LOCATIONS[location] ? `/img/rally/${location.toLowerCase()}.jpg` : '';
const words = s => s.replace(/([a-z])([A-Z0-9])/g, '$1 $2').replace(/(\d)([A-Z])/g, '$1 $2');

// { location, locationName, country, group, stage, length, direction, route } of a stage id.
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
    stage: STAGE_NAMES[group] || words(m[2] || id).replace(/^Bollene$/, 'Bollène'),
    length: len === 'Full' ? 'Full stage' : len ? `Short ${len.replace(/\D/g, '') || ''}`.trim() : '',
    direction: m[4] || '',
    route: STAGE_ROUTES[id] || '',
  };
}

// FString at `at`: int32 length (with the null), Latin-1 bytes, null.
function readStr(b, at) {
  const n = new DataView(b.buffer, b.byteOffset).getInt32(at, true);
  if (n < 1 || n > 4096 || at + 4 + n > b.length || b[at + 3 + n] !== 0) throw new Error('bad string');
  return { start: at, end: at + 4 + n, value: String.fromCharCode(...b.subarray(at + 4, at + 3 + n)) };
}
function fstr(s) {
  const out = new Uint8Array(4 + s.length + 1);
  new DataView(out.buffer).setInt32(0, s.length + 1, true);
  for (let i = 0; i < s.length; i++) out[4 + i] = s.charCodeAt(i) & 0xff;
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

// Locate the Free Practice selection and the size field around it.
function parse(b) {
  const dv = new DataView(b.buffer, b.byteOffset);
  const name = indexOf(b, SIZE_NAME);
  if (name < 0) throw new Error('not a Rally save');
  const sizeAt = name + SIZE_NAME.length;
  if (sizeAt + 4 + dv.getInt32(sizeAt, true) !== b.length) throw new Error('unexpected save layout');
  const key = indexOf(b, KEY_TIME);
  if (key < 0) throw new Error('no Free Practice selection yet (drive one stage in Rally first)');
  const countAt = key - 8;
  if (dv.getInt32(countAt, true) !== 3) throw new Error('unexpected save layout');
  // Walk back over the car string, then the stage string.
  const back = end => {
    for (let n = 2; n < 128; n++) {
      const at = end - 4 - n;
      if (at > sizeAt && dv.getInt32(at, true) === n && b[end - 1] === 0) return readStr(b, at);
    }
    throw new Error('unexpected save layout');
  };
  const car = back(countAt), stage = back(car.start);
  const opts = [];
  let p = countAt + 4;
  for (let i = 0; i < 3; i++) { const k = readStr(b, p), v = readStr(b, k.end); opts.push({ k, v }); p = v.end; }
  const time = opts.find(o => o.k.value === KEY_TIME);
  if (!STAGE_ID.test(stage.value) || !time) throw new Error('unexpected save layout');
  return { sizeAt, stage, car, countAt, opts, end: p, seconds: Number(/TimeSeconds=([\d.]+)/.exec(time.v.value)?.[1] ?? 36000) };
}

// The current Free Practice selection and every stage id the save mentions.
export async function readRallySave(paths) {
  if (!(await exists(paths.rally.save))) throw new Error('Drive one stage in Rally\'s Free Practice first: the launcher sets up the selection Rally saves then.');
  const b = new Uint8Array(await Neutralino.filesystem.readBinaryFile(paths.rally.save));
  const sel = parse(b);
  const text = new TextDecoder('latin1').decode(b.subarray(sel.sizeAt));
  const stages = [...new Set([...text.matchAll(/[A-Z][A-Za-z0-9]+(?:Forward|Reverse)(?=\0)/g)].map(m => m[0]))];
  return { stage: sel.stage.value, car: sel.car.value, seconds: sel.seconds, stages };
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
  const r = await powershell('(Get-Process acr -ErrorAction SilentlyContinue | Measure-Object).Count');
  return Number(r.stdOut.trim()) > 0;
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
  const str = at => {
    if (at + 4 > b.length) return null;
    const n = dv.getInt32(at, true);
    return n >= 2 && n <= 256 && at + 4 + n <= b.length && b[at + 3 + n] === 0 ? { at, end: at + 4 + n, value: String.fromCharCode(...b.subarray(at + 4, at + 3 + n)) } : null;
  };
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

// Pre-select stage, car and start time (seconds after midnight) in Free Practice.
export async function writeRallySession(paths, { stage, car, seconds, livery }) {
  if (await isRallyRunning()) throw new Error('Close Assetto Corsa Rally first: it saves its menu over this selection when it exits.');
  if (!STAGE_ID.test(stage) || !/^[A-Za-z0-9]+$/.test(car)) throw new Error('Unknown stage or car');
  const file = paths.rally.save;
  const b = new Uint8Array(await Neutralino.filesystem.readBinaryFile(file));
  const sel = parse(b);
  const parts = [b.subarray(0, sel.stage.start), fstr(stage), fstr(car), b.subarray(sel.countAt, sel.countAt + 4)];
  for (const { k, v } of sel.opts) parts.push(b.subarray(k.start, k.end), k.value === KEY_TIME ? fstr(`(TimeSeconds=${Number(seconds).toFixed(6)})`) : b.subarray(v.start, v.end));
  parts.push(b.subarray(sel.end));
  let out = concat(parts);
  // The main menu shows the same car, with the chosen livery (both lie after the size field).
  out = withLivery(withLastDriven(out, car), car, livery);
  // The only enclosing size: the blob after "PlayerSaveGameData" runs to the end of the file.
  const dv = new DataView(out.buffer);
  dv.setInt32(sel.sizeAt, dv.getInt32(sel.sizeAt, true) + out.length - b.length, true);
  const check = parse(out);
  if (check.stage.value !== stage || check.car.value !== car) throw new Error('Could not update the Rally save');
  if (livery && liveryMap(out) && liveryMap(out).entries.find(e => e.car === car)?.livery !== livery) throw new Error('Could not update the Rally save');
  // The save as it was before this change, so it can always be put back.
  await Neutralino.filesystem.writeBinaryFile(`${file}.launcher-backup`, b.slice().buffer);
  await Neutralino.filesystem.writeBinaryFile(file, out.buffer);
  log(`rally: free practice set to ${stage} / ${car} / ${seconds}s`);
}
