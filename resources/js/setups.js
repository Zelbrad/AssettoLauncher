// Car setups, for the Mods page's Setups tab. Per game:
//   AC     <Documents>\Assetto Corsa\setups\<car>\<track>\<name>.ini: sections with
//          VALUE= (steps, as AC's setup screen counts them) and [CAR] MODEL=<car>;
//          <name>.sp beside it is its pit strategy. AC itself writes
//          generic\last.ini (the setup last driven), which isn't listed.
//   ACC    <Documents>\Assetto Corsa Competizione\Setups\<car>\<track>\<name>.json
//          (carName, then basicSetup / advancedSetup groups of steps)
//   Rally  the Personal setups in CarSetupsDataSaveSlot.sav, next to the main save.
//          GVAS header, FString "CarSetupsSaveGameData", int32 size of the rest,
//          int32 1, int32 car count; per car: FString car id, int32 count; per
//          setup: int32 flags (0x10 marks the last one saved), u8 0xFF, int32 1,
//          FString name, author, int64 date (.NET ticks), FString game version, car,
//          stage group, 12 zero bytes, int32 count, then FString key/value pairs,
//          all text ("Brakes.BrakesMain.FrontBias" = "0.445000"). Rally doesn't
//          remember which setup is loaded: the player loads one in Car Setup.
// A setup: { key, game, car, track, name, author, date (ms), version, file, extra, values: [[key, value]] }
import { join, basename, listDir, readTextAnyEncoding, writeText, exists, log, prettifyId, mapLimit, storageGet, storageSet } from './util.js';
import { tr } from './i18n.js';
import { ACC_TRACKS } from './acclaunch.js';
import { rallySetupText } from './rallydata.js';

const fileDate = async path => { try { return (await Neutralino.filesystem.getStats(path)).modifiedAt || 0; } catch { return 0; } };
const dirs = async path => (await listDir(path)).filter(e => e.type === 'DIRECTORY' && e.entry !== '.' && e.entry !== '..').map(e => e.entry);
const files = async (path, re) => (await listDir(path)).filter(e => e.type === 'FILE' && re.test(e.entry)).map(e => e.entry);

// ---------------------------------------------------------------------------
// AC and ACC: one file per setup

function parseIni(text) {
  const out = [];
  let section = '';
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(';')) continue;
    const s = line.match(/^\[(.+)\]$/);
    if (s) { section = s[1].trim(); continue; }
    const kv = line.match(/^([^=]+)=(.*)$/);
    if (kv) out.push([section, kv[1].trim(), kv[2].trim()]);
  }
  return out;
}

async function readAcSetup(file, track) {
  const ini = parseIni(await readTextAnyEncoding(file));
  const car = ini.find(([s, k]) => s === 'CAR' && k === 'MODEL')?.[2] || '';
  const values = ini.filter(([s, k]) => k === 'VALUE' && s !== 'CAR' && !s.startsWith('__')).map(([s, , v]) => [s, v]);
  const sp = file.replace(/\.ini$/i, '.sp');
  return { game: 'ac', car, track, name: basename(file).replace(/\.ini$/i, ''), author: '', version: '', file, extra: (await exists(sp)) ? sp : '', date: await fileDate(file), values };
}

function accValues(json) {
  const out = [];
  for (const part of ['basicSetup', 'advancedSetup']) {
    for (const [group, fields] of Object.entries(json?.[part] || {})) {
      if (!fields || typeof fields !== 'object') continue;
      for (const [k, v] of Object.entries(fields)) {
        if (typeof v === 'number') out.push([`${group}.${k}`, String(v)]);
        else if (Array.isArray(v) && v.every(x => typeof x === 'number')) {
          const pos = v.length === 4 ? ['FL', 'FR', 'RL', 'RR'] : v.length === 2 ? ['F', 'R'] : v.map((_, i) => String(i + 1));
          v.forEach((x, i) => out.push([`${group}.${k}.${pos[i]}`, String(x)]));
        }
      }
    }
  }
  return out;
}

async function readAccSetup(file, track) {
  let json = null;
  try { json = JSON.parse((await readTextAnyEncoding(file)) || 'null'); } catch { /* not a setup */ }
  if (!json?.basicSetup) return null;
  return { game: 'acc', car: json.carName || '', track, name: basename(file).replace(/\.json$/i, ''), author: '', version: '', file, extra: '', date: await fileDate(file), values: accValues(json) };
}

async function scanFolders(root, game) {
  const out = [];
  await mapLimit(await dirs(root), 8, async car => {
    for (const track of await dirs(join(root, car))) {
      const folder = join(root, car, track);
      const names = await files(folder, game === 'ac' ? /\.ini$/i : /\.json$/i);
      for (const f of names) {
        if (game === 'ac' && /^last\.ini$/i.test(f)) continue;
        const s = game === 'ac' ? await readAcSetup(join(folder, f), track) : await readAccSetup(join(folder, f), track);
        if (!s) continue;
        s.car ||= car; // the folder names the car too
        s.key = `${game}:${s.file}`;
        out.push(s);
      }
    }
  });
  return out;
}

// ---------------------------------------------------------------------------
// Rally: the Personal setups file

const MARK = 'CarSetupsSaveGameData';
const TICKS_1970 = 621355968000000000n;

function reader(b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let p = 0;
  const need = n => { if (p + n > b.length) throw new Error('unexpected end of the setups file'); };
  const r = {
    get pos() { return p; }, set pos(v) { p = v; },
    i32() { need(4); const v = dv.getInt32(p, true); p += 4; return v; },
    u8() { need(1); return b[p++]; },
    i64() { need(8); const v = dv.getBigInt64(p, true); p += 8; return v; },
    bytes(n) { need(n); const v = b.slice(p, p + n); p += n; return v; },
    str() {
      const n = r.i32();
      if (n === 0) return '';
      if (n > 0) { if (n > 65536) throw new Error('bad string'); need(n); const v = String.fromCharCode(...b.subarray(p, p + n - 1)); p += n; return v; }
      if (-n > 65536) throw new Error('bad string');
      need(-2 * n);
      let v = '';
      for (let i = 0; i < -n - 1; i++) v += String.fromCharCode(dv.getUint16(p + 2 * i, true));
      p += -2 * n;
      return v;
    },
  };
  return r;
}

function writer() {
  const parts = [];
  const w = {
    raw(u8) { parts.push(u8); },
    i32(v) { const a = new Uint8Array(4); new DataView(a.buffer).setInt32(0, v, true); parts.push(a); },
    u8(v) { parts.push(Uint8Array.of(v)); },
    i64(v) { const a = new Uint8Array(8); new DataView(a.buffer).setBigInt64(0, BigInt(v), true); parts.push(a); },
    // ASCII as Latin-1 with its length; anything else as UTF-16LE with a negative length.
    str(s) {
      s = String(s ?? '');
      if (!s) return w.i32(0);
      if (/^[\x00-\x7f]*$/.test(s)) { w.i32(s.length + 1); parts.push(Uint8Array.from([...s].map(c => c.charCodeAt(0)), x => x), Uint8Array.of(0)); return; }
      const a = new Uint8Array(2 * (s.length + 1)), dv = new DataView(a.buffer);
      for (let i = 0; i < s.length; i++) dv.setUint16(2 * i, s.charCodeAt(i), true);
      w.i32(-(s.length + 1)); parts.push(a);
    },
    done() {
      const out = new Uint8Array(parts.reduce((n, a) => n + a.length, 0));
      let p = 0;
      for (const a of parts) { out.set(a, p); p += a.length; }
      return out;
    },
  };
  return w;
}

// { head (bytes up to and including the "CarSetupsSaveGameData" name), version, cars: [{ car, setups: [entry] }] }
export function parseRallySetups(b) {
  const at = indexOfText(b, MARK);
  if (at < 4) throw new Error('not a Rally setups file');
  const r = reader(b);
  r.pos = at - 4;
  if (r.str() !== MARK) throw new Error('not a Rally setups file');
  const head = b.slice(0, r.pos);
  const size = r.i32();
  if (r.pos + size !== b.length) throw new Error('the setups file has a layout the launcher doesn\'t know yet');
  const version = r.i32(), cars = [];
  for (let c = r.i32(); c > 0; c--) {
    const car = r.str(), setups = [];
    for (let n = r.i32(); n > 0; n--) {
      const e = { flags: r.i32(), kind: r.u8(), one: r.i32(), name: r.str(), author: r.str(), ticks: r.i64(), version: r.str(), car: r.str(), stage: r.str(), pad: r.bytes(12), values: [] };
      for (let k = r.i32(); k > 0; k--) e.values.push([r.str(), r.str()]);
      setups.push(e);
    }
    cars.push({ car, setups });
  }
  if (r.pos !== b.length) throw new Error('the setups file has a layout the launcher doesn\'t know yet');
  return { head, version, cars };
}

export function serializeRallySetups(doc) {
  const w = writer();
  w.i32(doc.version);
  w.i32(doc.cars.length);
  for (const { car, setups } of doc.cars) {
    w.str(car);
    w.i32(setups.length);
    for (const e of setups) {
      w.i32(e.flags); w.u8(e.kind); w.i32(e.one);
      w.str(e.name); w.str(e.author); w.i64(e.ticks); w.str(e.version); w.str(e.car); w.str(e.stage);
      w.raw(e.pad?.length === 12 ? e.pad : new Uint8Array(12));
      w.i32(e.values.length);
      for (const [k, v] of e.values) { w.str(k); w.str(v); }
    }
  }
  const body = w.done(), out = writer();
  out.raw(doc.head); out.i32(body.length); out.raw(body);
  return out.done();
}

function indexOfText(b, text) {
  const t = [...text].map(c => c.charCodeAt(0));
  outer: for (let i = 0; i <= b.length - t.length; i++) {
    for (let j = 0; j < t.length; j++) if (b[i + j] !== t[j]) continue outer;
    return i;
  }
  return -1;
}

// Rally's dates are the local wall-clock time.
const zone = ms => new Date(ms).getTimezoneOffset() * 60000;
const ticksToMs = t => { const local = Number((BigInt(t) - TICKS_1970) / 10000n); return local + zone(local); };
const msToTicks = ms => BigInt(Math.round(ms - zone(ms))) * 10000n + TICKS_1970;

async function readRallyDoc(file) {
  if (!file || !(await exists(file))) return null;
  return parseRallySetups(new Uint8Array(await Neutralino.filesystem.readBinaryFile(file)));
}

function rallyList(doc, file) {
  const out = [];
  for (const { car, setups } of doc?.cars || []) {
    setups.forEach(e => out.push({
      key: `rally:${car}:${e.name}`, game: 'rally', car: e.car || car, track: e.stage, name: e.name, author: e.author,
      version: e.version, date: ticksToMs(e.ticks), file, extra: '', values: e.values,
    }));
  }
  return out;
}

// Changes Rally's Personal setups: change(doc) edits the parsed file in place.
// The file before is kept as <file>.launcher-backup; what's written is read back
// and must match, else the backup goes back and the change fails.
export async function editRallySetups(file, change) {
  const before = (await exists(file)) ? new Uint8Array(await Neutralino.filesystem.readBinaryFile(file)) : null;
  if (!before) throw new Error(tr("Save a setup in Rally's Car Setup menu first: Rally makes its setups file then."));
  const doc = parseRallySetups(before);
  change(doc);
  doc.cars = doc.cars.filter(c => c.setups.length);
  const out = serializeRallySetups(doc);
  await Neutralino.filesystem.writeBinaryFile(`${file}.launcher-backup`, before.slice().buffer);
  await Neutralino.filesystem.writeBinaryFile(file, out.buffer);
  const back = new Uint8Array(await Neutralino.filesystem.readBinaryFile(file));
  let ok = back.length === out.length && back.every((x, i) => x === out[i]);
  try { if (ok) parseRallySetups(back); } catch { ok = false; }
  if (!ok) {
    await Neutralino.filesystem.writeBinaryFile(file, before.slice().buffer);
    throw new Error(tr('The setups file didn\'t read back as written, so it was put back as it was.'));
  }
  log(`rally setups: written (${doc.cars.reduce((n, c) => n + c.setups.length, 0)} setups)`);
}

const carBlock = (doc, car) => {
  let c = doc.cars.find(x => x.car.toLowerCase() === car.toLowerCase());
  if (!c) { c = { car, setups: [] }; doc.cars.push(c); }
  return c;
};
// A name not yet used by this car's setups (Rally refuses duplicates).
export function freeName(taken, name) {
  const used = new Set(taken.map(n => n.toLowerCase()));
  if (!used.has(name.toLowerCase())) return name;
  for (let i = 2; ; i++) if (!used.has(`${name} (${i})`.toLowerCase())) return `${name} (${i})`;
}
function newEntry(src, car, name, author) {
  return {
    flags: 0x02, kind: 0xff, one: 1, name, author: author ?? src.author ?? '', ticks: msToTicks(Date.now()),
    version: src.version || '', car, stage: src.track || src.stage || '', pad: new Uint8Array(12), values: src.values.map(([k, v]) => [String(k), String(v)]),
  };
}

// ---------------------------------------------------------------------------
// All of a game's setups

export async function scanSetups(game, paths) {
  try {
    if (game === 'ac') return paths.ac.setups ? await scanFolders(paths.ac.setups, 'ac') : [];
    if (game === 'acc') return paths.acc.setups ? await scanFolders(paths.acc.setups, 'acc') : [];
    if (game === 'rally') return rallyList(await readRallyDoc(paths.rally.setups), paths.rally.setups);
  } catch (err) {
    log(`setups ${game}: ${err?.message || err}`);
    if (game === 'rally') throw err;
  }
  return [];
}

// The folder a setup's file is in (Rally: SaveGames).
export const setupFolder = s => s.file.replace(/\/[^/]+$/, '');

const sameFolderNames = async s => (await files(setupFolder(s), s.game === 'ac' ? /\.ini$/i : /\.json$/i)).map(f => f.replace(/\.(ini|json)$/i, ''));
const ext = s => (s.game === 'ac' ? '.ini' : '.json');
const validName = name => {
  const n = String(name || '').trim();
  if (!n) throw new Error(tr('Give the setup a name.'));
  if (/[\\/:*?"<>|]/.test(n)) throw new Error(tr('A setup name can\'t contain \\ / : * ? " < > |'));
  return n;
};

export async function renameSetup(s, name) {
  name = validName(name);
  if (name === s.name) return;
  if (s.game === 'rally') {
    await editRallySetups(s.file, doc => {
      const c = carBlock(doc, s.car);
      if (c.setups.some(e => e.name.toLowerCase() === name.toLowerCase())) throw new Error(tr('{car} already has a setup called {name}.', { car: s.car, name }));
      const e = c.setups.find(x => x.name === s.name);
      if (!e) throw new Error(tr('That setup isn\'t in Rally\'s file any more.'));
      e.name = name;
    });
    return;
  }
  if ((await sameFolderNames(s)).some(n => n.toLowerCase() === name.toLowerCase())) throw new Error(tr('There\'s already a setup called {name} here.', { name }));
  const target = join(setupFolder(s), name + ext(s));
  await Neutralino.filesystem.move(s.file, target);
  if (s.extra) await Neutralino.filesystem.move(s.extra, target.replace(/\.ini$/i, '.sp')).catch(() => {});
}

export async function duplicateSetup(s) {
  if (s.game === 'rally') {
    await editRallySetups(s.file, doc => {
      const c = carBlock(doc, s.car);
      c.setups.push(newEntry(s, c.car, freeName(c.setups.map(e => e.name), tr('{name} copy', { name: s.name }))));
    });
    return;
  }
  const name = freeName(await sameFolderNames(s), tr('{name} copy', { name: s.name }));
  const target = join(setupFolder(s), name + ext(s));
  await Neutralino.filesystem.copy(s.file, target);
  if (s.extra) await Neutralino.filesystem.copy(s.extra, target.replace(/\.ini$/i, '.sp')).catch(() => {});
}

// AC and ACC: to the Recycle Bin. Rally: out of the file (the backup keeps it).
export async function deleteSetup(s) {
  if (s.game === 'rally') {
    await editRallySetups(s.file, doc => {
      const c = carBlock(doc, s.car);
      c.setups = c.setups.filter(e => e.name !== s.name);
    });
    return;
  }
  for (const f of [s.file, s.extra].filter(Boolean)) await Neutralino.os.trashItem(f);
}

// ---------------------------------------------------------------------------
// Sharing: AC and ACC share their own files; Rally a small JSON file.

const RALLY_FORMAT = 'assetto-launcher/rally-setup';
export const exportName = s => `${s.name}${s.game === 'rally' ? '.rallysetup.json' : ext(s)}`;

export async function exportSetup(s, target) {
  if (s.game === 'rally') {
    await writeText(target, JSON.stringify({ format: RALLY_FORMAT, version: 1, car: s.car, name: s.name, author: s.author, gameVersion: s.version, stage: s.track, values: Object.fromEntries(s.values) }, null, 1));
    return;
  }
  await Neutralino.filesystem.copy(s.file, target, { overwrite: true });
  if (s.extra) await Neutralino.filesystem.copy(s.extra, target.replace(/\.ini$/i, '.sp'), { overwrite: true }).catch(() => {});
}

// A setup file picked to import, read: { game, car, name, values, … } or an error.
export async function readSetupFile(path) {
  const text = await readTextAnyEncoding(path);
  if (text == null) throw new Error(tr('Couldn\'t read {file}.', { file: basename(path) }));
  if (/\.ini$/i.test(path)) {
    const s = await readAcSetup(path, '');
    if (!s.values.length) throw new Error(tr('{file} isn\'t an AC setup.', { file: basename(path) }));
    if (!s.car) throw new Error(tr("{file} doesn't say which car it's for.", { file: basename(path) }));
    return s;
  }
  let json = null;
  try { json = JSON.parse(text); } catch { /* below */ }
  if (json?.format === RALLY_FORMAT) {
    const values = Object.entries(json.values || {}).filter(([k, v]) => /^\w+\.\w+\.\w+$/.test(k) && typeof v === 'string');
    if (!json.car || !values.length) throw new Error(tr('{file} isn\'t a Rally setup.', { file: basename(path) }));
    return { game: 'rally', car: String(json.car), track: String(json.stage || ''), name: String(json.name || basename(path).replace(/\.rallysetup\.json$/i, '')), author: String(json.author || ''), version: String(json.gameVersion || ''), values };
  }
  if (json?.basicSetup) {
    const s = await readAccSetup(path, '');
    if (!s.car) throw new Error(tr("{file} doesn't say which car it's for.", { file: basename(path) }));
    return s;
  }
  throw new Error(tr('{file} isn\'t a setup the launcher knows (AC .ini, ACC .json or a Rally setup from the launcher).', { file: basename(path) }));
}

// Copies an imported setup in: AC and ACC into <car>\<track>, Rally into its file.
// Returns the name it was saved under (a free one).
export async function importSetup(s, paths, track, name) {
  name = validName(name || s.name);
  if (s.game === 'rally') {
    let saved = name;
    await editRallySetups(paths.rally.setups, doc => {
      const c = carBlock(doc, s.car);
      saved = freeName(c.setups.map(e => e.name), name);
      c.setups.push(newEntry(s, c.car, saved));
    });
    return saved;
  }
  const root = s.game === 'ac' ? paths.ac.setups : paths.acc.setups;
  const folder = join(root, s.car, track || (s.game === 'ac' ? 'generic' : ''));
  await Neutralino.filesystem.createDirectory(folder).catch(() => {});
  const saved = freeName((await files(folder, s.game === 'ac' ? /\.ini$/i : /\.json$/i)).map(f => f.replace(/\.(ini|json)$/i, '')), name);
  const target = join(folder, saved + ext(s));
  await Neutralino.filesystem.copy(s.file, target);
  if (s.extra) await Neutralino.filesystem.copy(s.extra, target.replace(/\.ini$/i, '.sp')).catch(() => {});
  return saved;
}

// ---------------------------------------------------------------------------
// Times per setup. The games don't note which setup a time was set with, so the
// launcher keeps its own log ("setupRuns" in its storage): { game, car, track, sig,
// name, ms, laps, at }. A setup is known by its values (sig), so renaming it keeps
// its times and changing it starts new ones.
//   AC     when AC closes: the session's laps (Documents\Assetto Corsa\out\race_out.json),
//          with the setup AC saved as last.ini, matched to a saved one by its values
//   Rally  the stage records Rally added while it ran, with the setup picked in
//          Quick Drive (Rally only keeps the best per stage and car)

const fnv = text => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
};
export const setupSig = values => fnv(values.map(([k, v]) => `${k}=${v}`).sort().join('\n'));

const RUNS = 'setupRuns';
export async function addSetupRun(run) {
  const runs = await storageGet(RUNS, []);
  runs.push(run);
  await storageSet(RUNS, runs.slice(-3000));
}
// A setup's runs in the log (`all`, read once with allSetupRuns for a whole list).
export const allSetupRuns = () => storageGet(RUNS, []);
export function runsOf(s, all) {
  const sig = setupSig(s.values), car = s.car.toLowerCase();
  return all.filter(r => r.game === s.game && r.sig === sig && r.car.toLowerCase() === car);
}

// AC's last session, when it ended after `since`: { car, track, ms (best valid
// lap, 0 when none), laps, values (the setup it was driven with) } or null.
export async function readAcRun(paths, since) {
  const docs = paths.ac.cfg.replace(/\/[^/]+$/, '');
  const file = join(docs, 'out/race_out.json');
  if ((await fileDate(file)) < since) return null;
  let out = null;
  try { out = JSON.parse((await readTextAnyEncoding(file)) || 'null'); } catch { /* not written yet */ }
  const car = out?.players?.[0]?.car;
  if (!car) return null;
  const laps = (out.sessions || []).flatMap(s => s.laps || []).filter(l => (l.car ?? 0) === 0 && l.time > 0);
  const valid = laps.filter(l => !l.cuts).map(l => l.time);
  const track = String(out.track || '');
  let values = [];
  for (const folder of [track.split('-')[0], 'generic']) {
    const f = join(paths.ac.setups, car, folder, 'last.ini');
    if (folder && (await exists(f))) { values = (await readAcSetup(f, folder)).values; break; }
  }
  return { car, track, ms: valid.length ? Math.min(...valid) : 0, laps: laps.length, values };
}

// ---------------------------------------------------------------------------
// Showing a setup: the game's groups, each value at its wheel, axle or on its own.

const CORNERS = ['FL', 'FR', 'RL', 'RR'];
const POSITION_LABEL = { F: 'Front', R: 'Rear', C: 'Centre', FL: 'Front left', FR: 'Front right', RL: 'Rear left', RR: 'Rear right' };
const RALLY_POSITION = { FrontLeft: 'FL', FrontRight: 'FR', RearLeft: 'RL', RearRight: 'RR', Front: 'F', Rear: 'R', Centre: 'C' };
const RALLY_POSITION_TEXT = { FL: 'FrontLeft', FR: 'FrontRight', RL: 'RearLeft', RR: 'RearRight', F: 'Front', R: 'Rear' };
const RALLY_GROUPS = ['Wheels', 'Brakes', 'Suspensions', 'Dampers', 'Axles', 'Differentials', 'Gearbox', 'Other'];

const trimNumber = v => (/^-?\d+(\.\d+)?$/.test(v) ? String(Number(v)) : v);
const words = s => s.replace(/_/g, ' ').replace(/([a-z])([A-Z0-9])/g, '$1 $2').replace(/\s+/g, ' ').trim();

// Rally's values as its menu would read them: "(Gears:65//17)" -> "65/17",
// "(Discs:Brembo_…_BremboDisc03)" -> "Brembo …", 0.445 front bias -> "44.5 %".
function rallyValue(setting, raw, car) {
  const m = String(raw).match(/^\((\w+):(.*)\)$/);
  let v = m ? m[2] : String(raw);
  if (m) {
    if (m[1] === 'Gears') return v.split('*').map(x => x.replace('//', '/')).join(' · ');
    if (m[1] === 'GearsSets') { const n = v.match(/Set(\d+)$/); return n ? tr('Set {n}', { n: n[1] }) : words(v); }
    if (m[1] === 'LSDRampAngles') return v.replace('_', ' / ').replace(/(\d+)/g, '$1°');
    if (m[1] === 'Discs' || m[1] === 'Calipers') v = v.replace(/_[A-Za-z]+(Disc|Caliper)\d+.*$/, '');
    if (m[1] === 'Pads') return v.replace(/^Type(\d+)/, 'Type $1').replace(/_/g, ' ');
    return v.replace(/_/g, ' ').replace(new RegExp(`^${car}\\s*`), '');
  }
  if (!/^-?\d+(\.\d+)?$/.test(v)) return v;
  const n = Number(v);
  if (setting === 'FrontBias') return `${+(n * 100).toFixed(1)} %`;
  if (setting === 'TyrePressure') return `${+n.toFixed(1)} psi`;
  if (setting === 'Camber') return `${+n.toFixed(2)}°`;
  if (setting === 'AdditionalLights') return n ? tr('On') : tr('Off');
  return Math.abs(n) >= 10000 ? n.toLocaleString() : String(+n.toFixed(4));
}

// AC's sections: "CAMBER_LF" (left front) -> Camber · FL, "ARB_FRONT" -> F.
const AC_GROUPS = [
  ['Tyres', /^(TYRES|PRESSURE|CAMBER|TOE_OUT|TOE)/], ['Brakes', /^(BRAKE|FRONT_BIAS)/], ['Suspension', /^(SPRING|ROD|ARB|PACKER|BUMP_STOP|HEAVE|RIDE)/],
  ['Dampers', /^DAMP/], ['Aero', /^WING/], ['Drivetrain', /^(DIFF|FINAL|GEAR|INTERNAL_GEAR)/], ['Electronics', /^(ABS|TRACTION|TC|ENGINE|TURBO|ERS|KERS|MGU)/], ['Fuel', /^FUEL/],
];
const AC_LABELS = {
  TYRES: 'Tyre compound', PRESSURE: 'Tyre pressure', CAMBER: 'Camber', TOE_OUT: 'Toe', SPRING_RATE: 'Spring rate', ROD_LENGTH: 'Ride height (rod)',
  ARB: 'Anti-roll bar', PACKER_RANGE: 'Packers', BUMP_STOP_RATE: 'Bump stop rate', DAMP_BUMP: 'Bump', DAMP_REBOUND: 'Rebound',
  DAMP_FAST_BUMP: 'Fast bump', DAMP_FAST_REBOUND: 'Fast rebound', FRONT_BIAS: 'Brake bias', BRAKE_POWER_MULT: 'Brake power',
  DIFF_POWER: 'Diff power', DIFF_COAST: 'Diff coast', DIFF_PRELOAD: 'Diff preload', FINAL_RATIO: 'Final drive', FUEL: 'Fuel',
  ABS: 'ABS', TRACTION_CONTROL: 'Traction control', ENGINE_LIMITER: 'Rev limiter', TURBO: 'Turbo',
};
const AC_POSITION = { LF: 'FL', RF: 'FR', LR: 'RL', RR: 'RR', FRONT: 'F', REAR: 'R' };

// ACC's fields, by name.
const ACC_GROUP_LABEL = { tyres: 'Tyres', alignment: 'Alignment', electronics: 'Electronics', strategy: 'Strategy', mechanicalBalance: 'Mechanical grip', dampers: 'Dampers', aeroBalance: 'Aero', drivetrain: 'Drivetrain' };
const ACC_LABELS = {
  tyreCompound: 'Tyre compound', tyrePressure: 'Tyre pressure', camber: 'Camber', toe: 'Toe', staticCamber: 'Static camber', toeOutLinear: 'Toe (linear)',
  casterLF: 'Caster left', casterRF: 'Caster right', steerRatio: 'Steering ratio', tC1: 'TC', tC2: 'TC 2', abs: 'ABS', eCUMap: 'ECU map', fuelMix: 'Fuel mix',
  telemetryLaps: 'Telemetry laps', fuel: 'Fuel', nPitStops: 'Pit stops', tyreSet: 'Tyre set', frontBrakePadCompound: 'Front brake pads', rearBrakePadCompound: 'Rear brake pads',
  fuelPerLap: 'Fuel per lap', aRBFront: 'Anti-roll bar front', aRBRear: 'Anti-roll bar rear', wheelRate: 'Wheel rate', bumpStopRateUp: 'Bump stop rate',
  bumpStopRateDn: 'Bump stop rate (rebound)', bumpStopWindow: 'Bump stop range', brakeTorque: 'Brake power', brakeBias: 'Brake bias',
  bumpSlow: 'Bump', bumpFast: 'Fast bump', reboundSlow: 'Rebound', reboundFast: 'Fast rebound', rideHeight: 'Ride height', rodLength: 'Rod length',
  splitter: 'Splitter', rearWing: 'Rear wing', brakeDuct: 'Brake ducts', preload: 'Diff preload',
};

// One value: { group, groupLabel, setting, label, pos, value }.
function entry(s, key, raw) {
  if (s.game === 'rally') {
    const [g, p, setting] = key.split('.');
    const pos = RALLY_POSITION[p] ?? '';
    return { group: g, groupLabel: rallySetupText('groups', g) || words(g), setting, label: rallySetupText('settings', setting) || words(setting), pos, value: rallyValue(setting, raw, s.car) };
  }
  if (s.game === 'acc') {
    const [g, field, p = ''] = key.split('.');
    return { group: g, groupLabel: tr(ACC_GROUP_LABEL[g] || words(g)), setting: field, label: tr(ACC_LABELS[field] || words(field)), pos: CORNERS.includes(p) || p === 'F' || p === 'R' ? p : '', value: trimNumber(raw) + (p && !POSITION_LABEL[p] ? ` (${p})` : '') };
  }
  const m = key.match(/^(.*?)_(LF|RF|LR|RR|FRONT|REAR)$/);
  const setting = m ? m[1] : key, pos = m ? AC_POSITION[m[2]] : '';
  const group = AC_GROUPS.find(([, re]) => re.test(setting))?.[0] || 'Other';
  const gear = setting.match(/^INTERNAL_GEAR_(\d+)$/), wing = setting.match(/^WING_(\d+)$/);
  const label = gear ? tr('Gear {n}', { n: gear[1] }) : wing ? tr('Wing {n}', { n: wing[1] }) : tr(AC_LABELS[setting] || words(setting.toLowerCase()).replace(/^\w/, c => c.toUpperCase()));
  return { group, groupLabel: tr(group), setting, label, pos, value: trimNumber(raw) };
}

const positionLabel = (game, pos) => (game === 'rally' && RALLY_POSITION_TEXT[pos] && rallySetupText('positions', RALLY_POSITION_TEXT[pos])) || tr(POSITION_LABEL[pos] || pos);
const groupRank = (s, g) => {
  if (s.game === 'rally') { const i = RALLY_GROUPS.indexOf(g); return i < 0 ? 99 : i; }
  if (s.game === 'ac') { const i = AC_GROUPS.findIndex(([n]) => n === g); return i < 0 ? 99 : i; }
  const i = Object.keys(ACC_GROUP_LABEL).indexOf(g);
  return i < 0 ? 99 : i;
};

export { positionLabel };

const isNumber = v => /^-?\d+(\.\d+)?$/.test(String(v).trim());

// A setup's settings, each with its values by position:
// { group, groupLabel, label, cells: { pos: { value, raw, key } } }.
function settingsOf(s) {
  const out = new Map();
  for (const [k, v] of s.values) {
    const e = entry(s, k, v);
    const id = `${e.group}.${e.setting}`;
    if (!out.has(id)) out.set(id, { group: e.group, groupLabel: e.groupLabel, label: e.label, cells: {} });
    out.get(id).cells[e.pos] = { value: e.value, raw: v, key: k };
  }
  return out;
}

// How a setting is shown: 'corners' (a value per wheel), 'axles' (front and rear),
// or 'one'. A part fitted to every wheel (discs, calipers, pads) is shown once when
// the four are the same, or once per axle when only left and right are; numbers per
// wheel always stay per wheel. `rows`: the setting in each setup shown.
function shapeOf(rows) {
  let shape = 'one';
  for (const r of rows) {
    const c = r.cells;
    if (CORNERS.some(p => c[p])) {
      const v = CORNERS.map(p => c[p]?.value ?? '');
      if (CORNERS.some(p => c[p] && isNumber(c[p].raw)) || v[0] !== v[1] || v[2] !== v[3]) return 'corners';
      if (v[0] !== v[2]) shape = 'axles';
    } else if (c.F || c.R || c.C) shape = 'axles';
  }
  return shape;
}
function cellsIn(r, shape) {
  const c = r.cells, wheels = CORNERS.some(p => c[p]);
  if (shape === 'corners') return Object.fromEntries(CORNERS.filter(p => c[p]).map(p => [p, c[p]]));
  if (shape === 'axles') return wheels ? { F: c.FL || c.FR, R: c.RL || c.RR } : Object.fromEntries(['F', 'C', 'R'].filter(p => c[p]).map(p => [p, c[p]]));
  return { '': wheels ? c.FL || c.FR || c.RL || c.RR : c[''] || Object.values(c)[0] };
}
const valuesOf = cells => Object.fromEntries(Object.entries(cells).map(([p, c]) => [p, c?.value ?? '']));

// A setup in the game's groups: [{ id, title, corners: [{ label, cells: { FL… } }],
// axles: [{ label, cells: { F, C, R } }], singles: [{ label, value, note }] }].
export function setupGroups(s) {
  const groups = new Map();
  for (const r of settingsOf(s).values()) {
    if (!groups.has(r.group)) groups.set(r.group, { id: r.group, title: r.groupLabel, corners: [], axles: [], singles: [] });
    const g = groups.get(r.group), shape = shapeOf([r]), cells = valuesOf(cellsIn(r, shape));
    if (shape === 'one') g.singles.push({ label: r.label, value: cells[''], note: CORNERS.some(p => r.cells[p]) ? tr('All four wheels') : '' });
    else g[shape].push({ label: r.label, cells });
  }
  return [...groups.values()].sort((a, b) => groupRank(s, a.id) - groupRank(s, b.id));
}

// Two setups of the same car, setting by setting, laid out as setupGroups does:
// [{ id, title, rows: [{ label, note, shape, positions, a, b, delta, diff, same }] }],
// a / b / delta / diff by position ('' for a single value). delta: "+3 psi" when
// both are numbers.
export function compareGroups(a, b) {
  const sa = settingsOf(a), sb = settingsOf(b), groups = new Map();
  for (const id of new Set([...sa.keys(), ...sb.keys()])) {
    const ra = sa.get(id), rb = sb.get(id), r = ra || rb;
    const shape = shapeOf([ra, rb].filter(Boolean));
    const ca = ra ? cellsIn(ra, shape) : {}, cb = rb ? cellsIn(rb, shape) : {};
    const positions = shape === 'corners' ? CORNERS : shape === 'axles' ? ['F', 'C', 'R'].filter(p => ca[p] || cb[p]) : [''];
    const note = shape === 'one' && CORNERS.some(p => r.cells[p]) ? tr('All four wheels') : '';
    const row = { label: r.label, note, shape, positions, a: {}, b: {}, delta: {}, diff: {}, same: true };
    for (const p of positions) {
      const x = ca[p], y = cb[p];
      row.a[p] = x?.value ?? ''; row.b[p] = y?.value ?? '';
      row.diff[p] = row.a[p] !== row.b[p];
      if (!row.diff[p]) continue;
      row.same = false;
      if (x && y && isNumber(x.raw) && isNumber(y.raw)) {
        const d = +(Number(y.raw) - Number(x.raw)).toFixed(6), text = entry(b, y.key, String(Math.abs(d))).value;
        if (d && /^\d/.test(text)) row.delta[p] = `${d > 0 ? '+' : '−'}${text}`;
      }
    }
    if (!groups.has(r.group)) groups.set(r.group, { id: r.group, title: r.groupLabel, rank: groupRank(a, r.group), rows: [] });
    groups.get(r.group).rows.push(row);
  }
  return [...groups.values()].sort((x, y) => x.rank - y.rank);
}

// Display names of the folders setups are filed under.
export function setupTrackName(s, tracks = []) {
  if (!s.track) return '';
  if (s.game === 'ac' && s.track === 'generic') return tr('Any track');
  if (s.game === 'acc') return ACC_TRACKS.find(t => t.id === s.track)?.name || prettifyId(s.track);
  return tracks.find(t => t.id === s.track)?.title || prettifyId(s.track);
}

// ACC's car folders (carName) and the model number the launcher's ACC tables use.
export const ACC_SETUP_CARS = {
  porsche_991_gt3_r: 0, mercedes_amg_gt3: 1, ferrari_488_gt3: 2, audi_r8_lms: 3, lamborghini_huracan_gt3: 4, mclaren_650s_gt3: 5,
  nissan_gt_r_gt3_2018: 6, bmw_m6_gt3: 7, bentley_continental_gt3_2018: 8, porsche_991ii_gt3_cup: 9, nissan_gt_r_gt3_2017: 10,
  bentley_continental_gt3_2016: 11, amr_v12_vantage_gt3: 12, lamborghini_gallardo_rex: 13, jaguar_g3: 14, lexus_rc_f_gt3: 15,
  lamborghini_huracan_gt3_evo: 16, honda_nsx_gt3: 17, lamborghini_huracan_st: 18, audi_r8_lms_evo: 19, amr_v8_vantage_gt3: 20,
  honda_nsx_gt3_evo: 21, mclaren_720s_gt3: 22, porsche_991ii_gt3_r: 23, ferrari_488_gt3_evo: 24, mercedes_amg_gt3_evo: 25,
  ferrari_488_challenge_evo: 26, bmw_m2_cs_racing: 27, porsche_992_gt3_cup: 28, lamborghini_huracan_st_evo2: 29, bmw_m4_gt3: 30,
  audi_r8_lms_evo_ii: 31, ferrari_296_gt3: 32, lamborghini_huracan_gt3_evo2: 33, porsche_992_gt3_r: 34, mclaren_720s_gt3_evo: 35,
  ford_mustang_gt3: 36, alpine_a110_gt4: 50, amr_v8_vantage_gt4: 51, audi_r8_gt4: 52, bmw_m4_gt4: 53, chevrolet_camaro_gt4r: 55,
  ginetta_g55_gt4: 56, ktm_xbow_gt4: 57, maserati_mc_gt4: 58, mclaren_570s_gt4: 59, mercedes_amg_gt4: 60, porsche_718_cayman_gt4_mr: 61,
  audi_r8_lms_gt2: 80, ktm_xbow_gt2: 82, maserati_mc20_gt2: 83, mercedes_amg_gt2: 84, porsche_991_gt2_rs_cs_evo: 85, porsche_935: 86,
};
