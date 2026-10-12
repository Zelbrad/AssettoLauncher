// EVO mod tracks in the game's own track list.
//
// EVO lists tracks only from two tables inside content.kspkg:
//   system\tracks.table            a TrackContentData per track (name, nation,
//                                  continent, coordinates, time zone, its .scene and .track)
//   system\track_containers.table  a TrackContainersContentData per layout and game
//                                  mode (base layout, Race, Time Attack, Hotstint, …)
// Both are TableData messages (CustomTable.proto: preset = 2, its lines = 3; a line's
// track = 2, its container = 8; the records in LogicScene.proto). Cars have a "modded
// car" record a mod package can carry; tracks have none, so a track package in the
// mods folder loads but never shows. EvoForge, which converts Assetto Corsa tracks,
// edits content.kspkg for the same reason.
//
// What changes in content.kspkg (69 GB): the two tables are written again, with the
// mod tracks' lines added, into the unused space between the last file's data and
// the file table (about 870 KB in EVO 0.9.1; the two tables take about 90 KB), and
// their two entries in the file table point at the new copies. The originals stay
// where they were and the file keeps its size. Before the first change, that unused
// space and the two entries are saved (track-list-backup-*.bin, and the state in
// storage), so restoring puts the file back byte for byte. Steam's "Verify integrity"
// or a game update replaces the file; the next sync then starts from the new one.
// The file is written with a small PowerShell helper (dd on Linux), which can't open
// it while EVO runs.
import { join, log, storageGet, storageSet, psQuote, shQuote, powershellEncoded, sh, ensureDir, listDir, readText, IS_LINUX } from './util.js';
import { openPackage, readModInfo, cacheKey, kspkgXor, evoTrackName, evoLayoutName, evoUiTrackId, evoTrackLayouts } from './kspkg.js';
import { evoCacheDir } from './games.js';
import { isEvoRunning } from './evolaunch.js';

const TABLE_SIZE = 0x4000000, ENTRY = 0x100;
const TRACKS = 'system\\tracks.table', CONTAINERS = 'system\\track_containers.table';
const STATE_KEY = 'evoTrackList'; // { [content.kspkg path]: state }
const INFO_VERSION = 4; // 2: each layout's containers; 3: map outline; 4: layouts from containers\layout_*.scene, AI line, why one isn't a track

// ---------------------------------------------------------------------------
// Protobuf, just what these tables need.

const utf8 = new TextDecoder(), toUtf8 = new TextEncoder();

function varint(n) {
  const out = [];
  let v = BigInt(n);
  do { let b = Number(v & 0x7fn); v >>= 7n; if (v) b |= 0x80; out.push(b); } while (v);
  return out;
}
const key = (f, w) => varint(f * 8 + w);
const bytesField = (f, b) => [...key(f, 2), ...varint(b.length), ...b];
const pb = {
  str: (f, s) => (s ? bytesField(f, toUtf8.encode(s)) : []),
  msg: (f, bytes) => bytesField(f, bytes),
  int: (f, n) => (n ? [...key(f, 0), ...varint(n)] : []),
  bool: (f, b) => (b ? [...key(f, 0), 1] : []),
  double: (f, x) => { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, x, true); return [...key(f, 1), ...b]; },
  float: (f, x) => { if (!x) return []; const b = new Uint8Array(4); new DataView(b.buffer).setFloat32(0, x, true); return [...key(f, 5), ...b]; },
};

// Top-level fields with where they sit: { f, w, start, end, value: [from, to] }.
function fields(buf, from = 0, to = buf.length) {
  const out = [];
  let p = from;
  const read = () => { let r = 0, s = 0, b; do { b = buf[p++]; r += (b & 0x7f) * 2 ** s; s += 7; } while (b & 0x80); return r; };
  while (p < to) {
    const start = p, k = read(), f = Math.floor(k / 8), w = k & 7;
    if (w === 0) { const v = read(); out.push({ f, w, start, end: p, num: v }); }
    else if (w === 2) { const n = read(); out.push({ f, w, start, end: p + n, value: [p, p + n] }); p += n; }
    else if (w === 1) { p += 8; out.push({ f, w, start, end: p }); }
    else if (w === 5) { p += 4; out.push({ f, w, start, end: p }); }
    else throw new Error(`unreadable table (wire type ${w})`);
  }
  if (p !== to) throw new Error('unreadable table');
  return out;
}
const sub = (buf, x) => buf.subarray(x.value[0], x.value[1]);
const strOf = (msg, f) => { const x = fields(msg).find(y => y.f === f && y.w === 2); return x ? utf8.decode(sub(msg, x)) : ''; };

// The table's lines, as messages: field 2 (tracks) or 8 (containers) of each.
function tableLines(buf, inner) {
  const out = [];
  for (const top of fields(buf).filter(x => x.f === 2 && x.w === 2)) {
    const preset = sub(buf, top);
    for (const line of fields(preset).filter(x => x.f === 3 && x.w === 2)) {
      const l = sub(preset, line);
      for (const m of fields(l).filter(x => x.f === inner && x.w === 2)) out.push(sub(l, m));
    }
  }
  return out;
}

// The table with lines added at the end of its preset (repeated fields may simply
// follow the others); everything else stays as it was.
function withLines(buf, inner, records) {
  const top = fields(buf), at = top.findIndex(x => x.f === 2 && x.w === 2);
  if (at < 0) throw new Error('table has no lines');
  const preset = sub(buf, top[at]);
  const added = records.flatMap(r => pb.msg(3, pb.msg(inner, r)));
  const body = new Uint8Array(preset.length + added.length);
  body.set(preset); body.set(added, preset.length);
  const head = buf.subarray(0, top[at].start), tail = buf.subarray(top[at].end);
  const field = new Uint8Array([...key(2, 2), ...varint(body.length)]);
  const out = new Uint8Array(head.length + field.length + body.length + tail.length);
  out.set(head); out.set(field, head.length); out.set(body, head.length + field.length); out.set(tail, head.length + field.length + body.length);
  return out;
}

// ---------------------------------------------------------------------------
// Where a mod track is. EvoForge writes the Assetto Corsa track's coordinates into
// the scene's track_info node (SceneTrackInfo: 1 type, 2 display name, 4 coordinates
// { 1 longitude, 2 latitude }, 5 time zone); its time zone is often left as the
// UK's, so the country comes from the coordinates (nearest of these) and the time
// zone from the country. EVO's TimeZone enum (DateTime.proto) has a dozen zones;
// countries without their own get the closest.

const TZ = { UTC: 0, ITA: 2, DEU: 3, BEL: 4, ESP: 5, FRA: 7, NLD: 8, GBR: 9, HUN: 10, AUT: 11, AUS: 12, TEXAS: 13, RSA: 14, PACIFIC: 15, JPN: 16, EASTERN: 17 };
// [nation, continent, time zone, longitude, latitude]: roughly the middle of each.
const COUNTRIES = [
  ['JPN', 'Asia', TZ.JPN, 138.0, 36.5], ['GBR', 'Europe', TZ.GBR, -2.0, 53.0], ['ITA', 'Europe', TZ.ITA, 12.5, 42.8],
  ['DEU', 'Europe', TZ.DEU, 10.4, 51.1], ['BEL', 'Europe', TZ.BEL, 4.6, 50.6], ['ESP', 'Europe', TZ.ESP, -3.7, 40.2],
  ['FRA', 'Europe', TZ.FRA, 2.5, 46.6], ['NLD', 'Europe', TZ.NLD, 5.3, 52.2], ['HUN', 'Europe', TZ.HUN, 19.4, 47.2],
  ['AUT', 'Europe', TZ.AUT, 14.1, 47.6], ['CHE', 'Europe', TZ.DEU, 8.2, 46.8], ['PRT', 'Europe', TZ.GBR, -8.0, 39.6],
  ['IRL', 'Europe', TZ.GBR, -8.0, 53.2], ['POL', 'Europe', TZ.DEU, 19.4, 52.1], ['CZE', 'Europe', TZ.DEU, 15.3, 49.8],
  ['SVK', 'Europe', TZ.DEU, 19.7, 48.7], ['SVN', 'Europe', TZ.DEU, 14.8, 46.1], ['HRV', 'Europe', TZ.DEU, 16.0, 45.1],
  ['DNK', 'Europe', TZ.DEU, 9.5, 56.0], ['SWE', 'Europe', TZ.DEU, 16.0, 62.0], ['NOR', 'Europe', TZ.DEU, 9.0, 61.0],
  ['FIN', 'Europe', TZ.RSA, 26.0, 63.0], ['GRC', 'Europe', TZ.RSA, 22.0, 39.0], ['TUR', 'Europe', TZ.RSA, 35.0, 39.0],
  ['USA', 'North America', TZ.PACIFIC, -120.0, 37.5], ['USA', 'North America', TZ.TEXAS, -98.0, 33.0],
  ['USA', 'North America', TZ.EASTERN, -80.0, 37.5], ['CAN', 'North America', TZ.EASTERN, -79.5, 44.5],
  ['MEX', 'North America', TZ.TEXAS, -102.0, 23.0], ['BRA', 'South America', TZ.EASTERN, -47.9, -15.8],
  ['ARG', 'South America', TZ.EASTERN, -64.0, -34.0], ['RSA', 'Africa', TZ.RSA, 24.7, -29.0],
  ['AUS', 'Australia', TZ.AUS, 145.0, -33.0], ['NZL', 'Australia', TZ.AUS, 172.5, -41.5],
  ['CHN', 'Asia', TZ.JPN, 112.0, 32.0], ['KOR', 'Asia', TZ.JPN, 127.8, 36.5], ['MYS', 'Asia', TZ.JPN, 102.0, 4.0],
  ['SGP', 'Asia', TZ.JPN, 103.8, 1.35], ['THA', 'Asia', TZ.JPN, 101.0, 15.0], ['IND', 'Asia', TZ.RSA, 78.0, 21.0],
  ['ARE', 'Asia', TZ.RSA, 54.0, 24.0], ['BHR', 'Asia', TZ.RSA, 50.5, 26.0], ['SAU', 'Asia', TZ.RSA, 45.0, 24.0],
  ['QAT', 'Asia', TZ.RSA, 51.2, 25.3], ['AZE', 'Asia', TZ.RSA, 47.5, 40.4],
];

export function countryOf(lon, lat) {
  let best = null, bestD = Infinity;
  for (const c of COUNTRIES) {
    const dx = (c[3] - lon) * Math.cos(((c[4] + lat) / 2) * Math.PI / 180), dy = c[4] - lat, d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = c; }
  }
  return { nation: best[0], continent: best[1], timezone: best[2] };
}

const indexOf = (buf, text, from = 0) => {
  const t = toUtf8.encode(text);
  outer: for (let i = from; i <= buf.length - t.length; i++) {
    for (let j = 0; j < t.length; j++) if (buf[i + j] !== t[j]) continue outer;
    return i;
  }
  return -1;
};

// { lon, lat, tz } from the scene's track_info node, or null.
function sceneTrackInfo(buf) {
  const at = indexOf(buf, 'track_info');
  if (at < 0) return null;
  for (let p = at; p < Math.min(buf.length - 21, at + 800); p++) {
    if (buf[p] !== 0x22 || buf[p + 1] !== 0x12 || buf[p + 2] !== 0x09 || buf[p + 11] !== 0x11) continue;
    const dv = new DataView(buf.buffer, buf.byteOffset + p + 3, 17), lon = dv.getFloat64(0, true), lat = dv.getFloat64(9, true);
    if (!(Math.abs(lon) <= 180 && Math.abs(lat) <= 90) || (!lon && !lat)) return null;
    return { lon, lat, tz: buf[p + 20] === 0x28 ? buf[p + 21] : null };
  }
  return null;
}

const countOf = (buf, text) => { let n = 0; for (let i = indexOf(buf, text); i >= 0; i = indexOf(buf, text, i + 1)) n++; return n; };

// What the track list needs about a track package: { id, name, nation, continent,
// timezone, lon, lat, layouts: [{ id, name, ai, grid, pit, hotlap, image }] }, or
// { skip: why } when it isn't a whole track (<id>.scene and <id>.track under
// content\tracks\<id>, with layouts; kspkg.js evoTrackLayouts).
async function modTrackInfo(file, cacheDir) {
  const st = await Neutralino.filesystem.getStats(file);
  const cached = join(cacheDir, `trackreg-${cacheKey(file, st)}-${INFO_VERSION}.json`);
  try { const j = JSON.parse(await readText(cached) || 'null'); if (j?.id || j?.skip) return j; } catch { /* read again */ }
  const pkg = await openPackage(file);
  const id = pkg?.files.find(e => /^content\\tracks\\[^\\]+\\/i.test(e.name))?.name.split('\\')[2];
  let info = { skip: 'no track folder (content\\tracks\\<id>)' };
  if (id) {
    const base = `content\\tracks\\${id}`;
    const scene = pkg.get(`${base}\\${id}.scene`), track = pkg.get(`${base}\\${id}.track`);
    const prefix = `${base}\\`.toLowerCase();
    const layouts = evoTrackLayouts(pkg.files.filter(e => e.name.toLowerCase().startsWith(prefix)).map(e => e.name.slice(prefix.length)));
    info = { skip: !scene || !track ? `no ${id}.scene or ${id}.track` : 'no layouts (containers\\layout_<layout>.scene)' };
    if (scene && track && layouts.length) {
      const read = async name => { const e = pkg.get(name); return e ? pkg.read(e) : null; };
      const previewsFile = await read(`${base}\\ui\\previews.json`);
      let previews = null;
      try { previews = previewsFile && JSON.parse(utf8.decode(previewsFile)); } catch { /* none */ }
      const where = sceneTrackInfo(await pkg.read(scene));
      const place = where ? countryOf(where.lon, where.lat) : { nation: 'ITA', continent: 'Europe', timezone: TZ.ITA };
      // A layout's own container (spawnpoints_grid_<layout>.scene, Suzuka's
      // spawnpoints_grid_layout_gp, Brands Hatch's timelines_gp_default) before the shared one.
      const container = (role, layout) => [`${role}_${layout}`, `${role}_layout_${layout}`, `${role}_${layout}_default`, role]
        .map(n => `${base}\\containers\\${n}.scene`).find(n => pkg.get(n)) || '';
      const spots = async name => (name ? countOf(await read(name), 'Start Pos') : 0);
      const out = [];
      for (const { id: l, aiLine } of layouts) {
        const c = {
          layout: pkg.get(`${base}\\containers\\layout_${l}.scene`) ? `${base}\\containers\\layout_${l}.scene` : '',
          pitzones: container('pitlane_zones', l), timelines: container('timelines', l),
          grid: container('spawnpoints_grid', l), pit: container('spawnpoints_pitlane', l),
          hotlap: container('spawnpoints_hotlap', l) || container('hotlap_start', l),
        };
        const img = previews?.layoutImage && (!previews.layout || previews.layout === l || layouts.length === 1) ? previews.layoutImage : null;
        // The map outline (for Quick Drive): the copy for EVO's menus, else ui\map.svg.
        const name = evoTrackName(id, previews), svg = await read(`uiresources\\images\\trackmaps\\${evoUiTrackId(name, evoLayoutName(l))}.svg`) || await read(`${base}\\ui\\map.svg`);
        const outline = svg ? `trackmap-${cacheKey(file, st)}-${l}.svg` : '';
        if (svg) { await ensureDir(cacheDir); await Neutralino.filesystem.writeBinaryFile(join(cacheDir, outline), svg.slice().buffer).catch(() => {}); }
        out.push({ id: l, name: evoLayoutName(l), ai: aiLine, grid: await spots(c.grid), pit: await spots(c.pit), containers: c, image: img, outline });
      }
      info = {
        id, name: evoTrackName(id, previews), ...place,
        lon: where?.lon ?? 9.286, lat: where?.lat ?? 45.617,
        folder: base, scene: `${base}\\${id}.scene`, track: `${base}\\${id}.track`, layouts: out,
      };
    }
  }
  if (info.skip) log(`evo track list: ${file}: not a track EVO can list: ${info.skip}`);
  await ensureDir(cacheDir);
  await Neutralino.filesystem.writeBinaryFile(cached, toUtf8.encode(JSON.stringify(info)).buffer).catch(() => {});
  return info;
}

// A layout's game modes as listed (trackRecords) and as Quick Drive's saves name
// them (evoModTracks): event name, the flag field, max drivers, containers. EVO's
// own layouts take at most 32 cars; converted pit lanes can have more spots. A
// layout without an AI line has no Race: the AI cars drive that line.
function layoutModes(l) {
  const c = l.containers;
  return {
    race: c.grid && l.ai !== false ? { event: `${l.name} Race`, flag: 5, drivers: Math.min(32, l.grid), list: [c.timelines, c.grid, c.pit] } : null,
    practice: c.pit ? { event: `${l.name} Time Attack`, flag: 6, drivers: Math.min(32, Math.max(1, l.pit)), list: [c.timelines, c.pit] } : null,
    hotstint: c.hotlap ? { event: `${l.name} Hotstint`, flag: 7, drivers: 1, list: [c.timelines, c.hotlap] } : null,
  };
}

// The lines for one track: [trackRecord], [containerRecords]. As EVO's own tracks
// (Laguna Seca, Brands Hatch, Suzuka), per layout:
//   No Game Mode  the base layout: layout_<layout>.scene (EVO finds the layout's AI
//                 line from it, layouts\layout_<layout>.ideal_line.aisplinedata) and
//                 the pit lane zones
//   Race          timelines, grid and pit lane spawn points
//   Time Attack   (Practice) timelines and pit lane spawn points
//   Hotstint      timelines and the hotlap spawn point
// A converted track's main scene also embeds these containers, as EVO's own do.
// Without the base layout's, EVO has no AI line for the car ("no simulated
// reference") and the car falls through the road.
function trackRecords(t) {
  const coords = [...pb.double(1, t.lon), ...pb.double(2, t.lat)];
  const track = new Uint8Array([
    ...pb.str(1, t.name), ...pb.str(3, t.folder), ...pb.str(4, t.scene), ...pb.str(5, t.nation),
    ...pb.msg(6, coords), ...pb.int(7, t.timezone), ...pb.str(8, t.track), ...pb.bool(10, true), ...pb.str(13, t.continent),
  ]);
  const image = i => (i ? pb.msg(18, [...pb.int(1, Math.round(i.margin || 0)), ...pb.float(2, i.minX), ...pb.float(3, i.minY), ...pb.float(4, i.k), ...pb.float(5, i.offsetX), ...pb.float(6, i.offsetY)]) : []);
  const containers = [];
  t.layouts.forEach((l, n) => {
    const c = l.containers;
    const common = [...pb.str(10, t.name), ...pb.str(14, l.name), ...pb.int(17, 10)]; // test_stage: LiveContent
    const paths = list => list.filter(Boolean).flatMap(p => pb.str(11, p));
    containers.push(new Uint8Array([...pb.str(1, 'No Game Mode'), ...common, ...pb.bool(15, true), ...paths([c.layout, c.pitzones]), ...pb.int(20, 1)]));
    for (const m of Object.values(layoutModes(l)).filter(Boolean)) {
      containers.push(new Uint8Array([...pb.str(1, m.event), ...common, ...pb.bool(m.flag, true), ...pb.int(9, m.drivers), ...paths(m.list), ...pb.bool(16, n === 0), ...image(l.image)]));
    }
  });
  return [[track], containers];
}

// ---------------------------------------------------------------------------
// content.kspkg

const b64 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const readBytes = async (file, pos, size) => new Uint8Array(await Neutralino.filesystem.readBinaryFile(file, { pos, size }));

// An entry (decoded) and its fields.
const entryOf = (raw, i) => {
  const dv = new DataView(raw.buffer, raw.byteOffset, ENTRY), len = dv.getInt16(0xE6, true);
  return { i, raw, name: String.fromCharCode(...raw.subarray(0, len)), flags: dv.getUint16(0xE4, true), size: Number(dv.getBigInt64(0xF0, true)), offset: Number(dv.getBigInt64(0xF8, true)) };
};
const withPlace = (e, offset, size) => {
  const raw = e.raw.slice(), dv = new DataView(raw.buffer);
  dv.setBigInt64(0xF0, BigInt(size), true); dv.setBigInt64(0xF8, BigInt(offset), true);
  return raw;
};

// The whole file table: the two tables' entries and where the last data ends.
async function readTable(file, size) {
  const start = size - TABLE_SIZE, CH = 4 << 20;
  let tracks = null, containers = null, dataEnd = 0, i = 0;
  scan: for (let pos = start; pos < size; pos += CH) {
    const chunk = kspkgXor(await readBytes(file, pos, Math.min(CH, size - pos)));
    for (let o = 0; o + ENTRY <= chunk.length; o += ENTRY, i++) {
      const raw = chunk.subarray(o, o + ENTRY), dv = new DataView(raw.buffer, raw.byteOffset, ENTRY);
      const len = dv.getInt16(0xE6, true);
      if (!(dv.getUint32(0xE8, true) || dv.getUint32(0xEC, true)) || len <= 0 || len > 0xE0) break scan;
      const e = entryOf(raw.slice(), i);
      if (e.offset + e.size > dataEnd) dataEnd = e.offset + e.size;
      if (e.name.toLowerCase() === TRACKS) tracks = e;
      else if (e.name.toLowerCase() === CONTAINERS) containers = e;
    }
  }
  return { start, tracks, containers, dataEnd };
}
const readEntry = async (file, start, i) => entryOf(kspkgXor(await readBytes(file, start + i * ENTRY, ENTRY)), i);
const readBlob = async (file, e) => { const b = await readBytes(file, e.offset, e.size); return (e.flags & 0x100) ? kspkgXor(b) : b; };

// Writes each { offset, bytes } into the file in place.
async function writeAt(file, patches, dir) {
  await ensureDir(dir);
  const parts = [];
  for (const [n, p] of patches.entries()) {
    const f = join(dir, `patch-${n}.bin`);
    await Neutralino.filesystem.writeBinaryFile(f, p.bytes.slice().buffer);
    parts.push({ f, offset: p.offset });
  }
  try {
    if (IS_LINUX) {
      for (const p of parts) {
        const r = await sh(`dd if=${shQuote(p.f)} of=${shQuote(file)} bs=65536 seek=${p.offset} oflag=seek_bytes conv=notrunc,fsync status=none && echo ok`);
        if (!/ok/.test(r.stdOut || '')) throw new Error((r.stdErr || '').trim() || 'could not write content.kspkg');
      }
    } else {
      const writes = parts.map(p => `$b = [IO.File]::ReadAllBytes(${psQuote(p.f)}); [void]$f.Seek(${p.offset}, 'Begin'); $f.Write($b, 0, $b.Length)`).join('; ');
      const r = await powershellEncoded(`$ErrorActionPreference = 'Stop'; $f = [IO.File]::Open(${psQuote(file)}, 'Open', 'ReadWrite', 'Read'); try { ${writes}; $f.Flush($true) } finally { $f.Close() }; 'ok'`);
      if (!/ok/.test(r.stdOut || '')) throw new Error(/being used|another process/i.test(r.stdErr || '') ? 'content.kspkg is in use. Close Assetto Corsa EVO first.' : (r.stdErr || '').trim().split('\n')[0] || 'could not write content.kspkg');
    }
  } finally {
    for (const p of parts) await Neutralino.filesystem.remove(p.f).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Keeping the list in step with the mods folder

async function loadState(file) { return (await storageGet(STATE_KEY, {}))[file] || null; }
async function saveState(file, state) {
  const all = await storageGet(STATE_KEY, {});
  if (state) all[file] = state; else delete all[file];
  await storageSet(STATE_KEY, all);
}

// Our change is still in the file: same size, and both entries point at our copies.
async function intact(file, size, s) {
  if (!s || s.size !== size) return false;
  for (const k of ['t', 'c']) {
    const e = await readEntry(file, s.start, s[k].i).catch(() => null);
    if (!e || e.offset !== s[k].patched.offset || e.size !== s[k].patched.size) return false;
  }
  return true;
}

// The enabled track packages in the mods folder, with what the list needs.
// skipped: gets { file, why } for each track package EVO can't list.
async function modTracks(paths, skipped = []) {
  const dir = paths.evo.mods, cacheDir = await evoCacheDir(), out = [];
  for (const e of await listDir(dir)) {
    if (e.type !== 'FILE' || !/\.kspkg$/i.test(e.entry)) continue;
    const file = join(dir, e.entry);
    try {
      const mod = await readModInfo(file, cacheDir);
      if (mod?.kind !== 'track') continue;
      const info = await modTrackInfo(file, cacheDir);
      if (info.skip) skipped.push({ file: e.entry, why: info.skip });
      else out.push({ ...info, file });
    } catch (err) { log(`evo track list: ${e.entry}: ${err?.message || err}`); }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

const pkgPathOf = paths => (paths.evo.install ? join(paths.evo.install, 'content.kspkg') : '');

// The enabled mod tracks as the official ones are described for Quick Drive
// (kspkg.js readEvoCatalog): [{ file, name, country, region, layouts: [{ id, name,
// outline, practice, race, arches }] }], practice/race being what its saves write
// (TrackItem: layout name, event name, max drivers, length). None while the list
// is restored: EVO wouldn't know them.
export async function evoModTracks(paths) {
  const file = pkgPathOf(paths);
  if (!file || !paths.evo.mods || (await loadState(file))?.off) return [];
  const cacheDir = await evoCacheDir();
  const item = (l, m) => (m ? { layoutName: l.name, container: m.event, maxDrivers: m.drivers, length: 0 } : null);
  return (await modTracks(paths)).map(t => ({
    file: t.file, name: t.name, country: t.nation, region: t.continent,
    layouts: t.layouts.map(l => {
      const m = layoutModes(l);
      return { id: l.id, name: l.name, outline: l.outline ? join(cacheDir, l.outline) : '', practice: item(l, m.practice), race: item(l, m.race), noAiLine: l.ai === false, arches: [] };
    }),
  }));
}

// For Settings: { listed: [names], waiting: [names], skipped: [{ file, why }], off }.
export async function evoTrackListStatus(paths) {
  const file = pkgPathOf(paths);
  if (!file) return { listed: [], waiting: [], skipped: [], off: false };
  const st = await Neutralino.filesystem.getStats(file).catch(() => null);
  const s = await loadState(file), ok = st && await intact(file, st.size, s);
  const skipped = [], want = await modTracks(paths, skipped), listed = ok ? s.listed : [];
  return { listed, waiting: want.map(t => t.name).filter(n => !listed.includes(n)), skipped, off: !!s?.off };
}

// Makes EVO's track list hold exactly the enabled mod tracks (none: the original
// list). force: also after a restore (which turns the automatic sync off). Returns
// { changed, listed: [names] }; throws when it can't (EVO running, no room…).
// isRunning: only for the import test's stand-in package, which EVO doesn't hold.
export async function syncEvoTrackList(paths, { force = false, restore = false, isRunning = isEvoRunning } = {}) {
  const file = pkgPathOf(paths);
  if (!file) return { changed: false, listed: [] };
  const st = await Neutralino.filesystem.getStats(file).catch(() => null);
  if (!st || st.size < TABLE_SIZE) return { changed: false, listed: [] };
  let s = await loadState(file);
  if (s?.off && !force && !restore) return { changed: false, listed: [] };
  const ok = await intact(file, st.size, s);
  if (s?.t && !ok) {
    // Replaced since (update, Verify integrity): what was saved belongs to the old file.
    log('evo track list: content.kspkg was replaced since the tracks were added; starting from the new one');
    await Neutralino.filesystem.remove(s.backup).catch(() => {});
    await saveState(file, s.off ? { off: true } : null);
    s = null;
  }
  const want = restore ? [] : await modTracks(paths);
  const wantKey = JSON.stringify(want);
  if (ok && s.want === wantKey) return { changed: false, listed: s.listed };
  if (!ok && !want.length) {
    if (restore) await saveState(file, { off: true });
    return { changed: false, listed: [] };
  }
  const work = join(await evoCacheDir(), 'track-list');
  const notRunning = async () => { if (await isRunning()) throw new Error('Close Assetto Corsa EVO first: its track list is in a file it keeps open.'); };

  if (ok && !want.length) {
    await notRunning();
    // Back to the original: the saved space and the two entries as they were.
    const gap = new Uint8Array(await Neutralino.filesystem.readBinaryFile(s.backup));
    await writeAt(file, [
      { offset: s.region.start, bytes: gap },
      { offset: s.start + s.t.i * ENTRY, bytes: kspkgXor(unb64(s.t.raw)) },
      { offset: s.start + s.c.i * ENTRY, bytes: kspkgXor(unb64(s.c.raw)) },
    ], work);
    await Neutralino.filesystem.remove(s.backup).catch(() => {});
    await saveState(file, restore ? { off: true } : null);
    log(`evo track list: restored the original list in ${file}`);
    return { changed: true, listed: [] };
  }

  let base = s;
  if (!ok) {
    // First change to this file: save the unused space and the two entries.
    await notRunning();
    const t = await readTable(file, st.size);
    if (!t.tracks || !t.containers) throw new Error("EVO's track tables weren't found in content.kspkg");
    if (t.dataEnd > t.start) throw new Error('content.kspkg has no unused space before its file table');
    const backup = join(work, `track-list-backup-${st.size}.bin`);
    await ensureDir(work);
    await Neutralino.filesystem.writeBinaryFile(backup, (await readBytes(file, t.dataEnd, t.start - t.dataEnd)).slice().buffer);
    const place = e => ({ i: e.i, raw: b64(e.raw), orig: { offset: e.offset, size: e.size, flags: e.flags } });
    base = { size: st.size, start: t.start, region: { start: t.dataEnd, end: t.start }, backup, t: place(t.tracks), c: place(t.containers) };
  }

  // The original tables, plus a line set per mod track not already in them.
  const origT = await readBlob(file, base.t.orig), origC = await readBlob(file, base.c.orig);
  const have = new Set(tableLines(origT, 2).map(m => strOf(m, 3).toLowerCase()));
  const add = want.filter(t => !have.has(t.folder.toLowerCase()));
  const recs = add.map(trackRecords);
  const newT = withLines(origT, 2, recs.flatMap(r => r[0])), newC = withLines(origC, 8, recs.flatMap(r => r[1]));
  const at = base.region.start, room = base.region.end - at;
  if (newT.length + newC.length > room) throw new Error(`not enough room in content.kspkg for the track list (${newT.length + newC.length} of ${room} bytes)`);
  const xorIf = (b, flags) => ((flags & 0x100) ? kspkgXor(b.slice()) : b);
  const blob = new Uint8Array(newT.length + newC.length);
  blob.set(xorIf(newT, base.t.orig.flags)); blob.set(xorIf(newC, base.c.orig.flags), newT.length);
  const eT = entryOf(unb64(base.t.raw), base.t.i), eC = entryOf(unb64(base.c.raw), base.c.i);
  const listed = want.map(t => t.name);
  const keep = () => saveState(file, {
    ...base, want: wantKey, listed,
    t: { ...base.t, patched: { offset: at, size: newT.length } },
    c: { ...base.c, patched: { offset: at + newT.length, size: newC.length } },
  });
  // Something the tables don't hold changed (a newer launcher reading more about the
  // track): the file already has these exact tables, so it isn't written again.
  if (ok && s.t.patched.offset === at && s.t.patched.size === newT.length && s.c.patched.size === newC.length) {
    const now = await readBytes(file, at, blob.length);
    if (now.every((b, i) => b === blob[i])) { await keep(); return { changed: false, listed }; }
  }
  await notRunning();
  await writeAt(file, [
    { offset: at, bytes: blob },
    { offset: base.start + base.t.i * ENTRY, bytes: kspkgXor(withPlace(eT, at, newT.length)) },
    { offset: base.start + base.c.i * ENTRY, bytes: kspkgXor(withPlace(eC, at + newT.length, newC.length)) },
  ], work);

  // Read back before keeping the state.
  const backT = await readEntry(file, base.start, base.t.i);
  if (backT.offset !== at || backT.size !== newT.length) throw new Error('content.kspkg did not take the change');
  await keep();
  log(`evo track list: ${listed.join(', ') || 'no mod tracks'} in ${file}${add.length < want.length ? ` (${want.length - add.length} already listed)` : ''}`);
  return { changed: true, listed };
}

export const restoreEvoTrackList = (paths, opts = {}) => syncEvoTrackList(paths, { ...opts, restore: true });
