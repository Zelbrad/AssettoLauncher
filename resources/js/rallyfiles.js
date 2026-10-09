// Assetto Corsa Rally's cars and stages, read from the game's own file index so
// what an update adds shows up without a launcher update. The game's packages are
// Unreal IoStore containers: each .utoc holds, after its chunk tables, a directory
// index with every file path (not encrypted). All of them (~15 MB over ~50 files)
// parse in well under a second, and are only read again when a package changed.
//   cars    Vehicles/<class>/<folder>/Liveries/DA_<car id>_UserLivery.uasset; <car id>
//           is the id the save and the custom livery folders use
//   stages  playable stage maps <Location>S<n><Stage>.umap with their pacenote tables
//           Data/Pacenote/Tables/DT_Pacenote<Stage><variant><direction>
// The files also hold content that isn't playable yet (environments of upcoming
// locations), so a stage needs both its map and its pacenotes.
import { join, listDir, log, readText, writeText } from './util.js';

const PAKS_RE = /^(pakchunk\d+(optional)?-Windows|global)\.utoc$/i;
const latin1 = new TextDecoder('latin1'), utf16 = new TextDecoder('utf-16le');

// Every file path in one .utoc ([] when it has no readable index).
function utocPaths(buf) {
  const b = new Uint8Array(buf), v = new DataView(buf);
  if (b.length < 144 || latin1.decode(b.subarray(0, 16)) !== '-==--==--==--==-') return [];
  const u32 = o => v.getUint32(o, true);
  const headerSize = u32(20), entries = u32(24), blocks = u32(28), blockEntry = u32(32);
  const methods = u32(36), methodLen = u32(40), dirSize = u32(48);
  const flags = b[80], seeds = u32(84), noHash = u32(96);
  if (!(flags & 8) || flags & 2 || !dirSize) return []; // not indexed, or encrypted
  // Chunk ids (12) and offsets (10) per entry, hash seeds, blocks, compression names.
  let o = headerSize + 22 * entries + 4 * seeds + 4 * noHash + blockEntry * blocks + methods * methodLen;
  if (flags & 4) { const n = u32(o); o += 4 + n * 2 + 20 * blocks; } // signatures
  if (o + dirSize > b.length) return [];
  let p = o;
  const r32 = () => { const x = u32(p); p += 4; return x; };
  const str = () => {
    const n = v.getInt32(p, true); p += 4;
    if (n >= 0) { const s = n ? latin1.decode(b.subarray(p, p + n - 1)) : ''; p += n; return s; }
    const s = utf16.decode(b.subarray(p, p + (-n - 1) * 2)); p += -n * 2; return s;
  };
  const mount = str();
  const dirs = Array.from({ length: r32() }, () => [r32(), r32(), r32(), r32()]); // name, first child, next sibling, first file
  const files = Array.from({ length: r32() }, () => [r32(), r32(), r32()]);      // name, next file, data
  const names = Array.from({ length: r32() }, str);
  const NONE = 0xFFFFFFFF, out = [], stack = dirs.length ? [[0, mount]] : [];
  while (stack.length) {
    const [first, base] = stack.pop();
    for (let d = first; d !== NONE; d = dirs[d][2]) {
      const path = dirs[d][0] === NONE ? base : `${base}${names[dirs[d][0]]}/`;
      for (let f = dirs[d][3]; f !== NONE; f = files[f][1]) out.push(path + names[files[f][0]]);
      if (dirs[d][1] !== NONE) stack.push([dirs[d][1], path]);
    }
  }
  return out;
}

function scan(paths) {
  const cars = new Map(), maps = new Map(), notes = new Set();
  for (const p of paths) {
    let m = /\/Vehicles\/([^/]+)\/([^/]+)\/Liveries\/DA_([^/]+)_UserLivery\.uasset$/.exec(p);
    if (m) { cars.set(m[3], { cls: m[1], folder: m[2] }); continue; }
    m = /\/(([A-Z][A-Za-z]*?)S(\d+)([A-Z][A-Za-z0-9]*))\.umap$/.exec(p);
    if (m) { maps.set(m[4], { loc: m[2], n: m[3] }); continue; }
    m = /\/DT_Pacenote([A-Za-z0-9]+)\.uasset$/.exec(p);
    if (m) notes.add(m[1]);
  }
  return { cars: [...cars].map(([id, c]) => ({ id, ...c })), maps: Object.fromEntries(maps), notes: [...notes] };
}

// What a mod package (its .utoc) holds, next to the game's own content (`base`,
// readRallyContent): cars and stage maps the game doesn't have, and the car
// folders (Vehicles/<class>/<folder>) of the game's cars it replaces files of, as
// game car ids. null when its file index can't be read (encrypted, or none).
export function rallyModContents(buf, base) {
  const paths = utocPaths(buf);
  if (!paths.length) return null;
  const mod = scan(paths), has = new Set((base?.cars || []).map(c => c.id.toLowerCase()));
  const byFolder = new Map((base?.cars || []).map(c => [c.folder?.toLowerCase(), c.id]));
  const touched = new Set();
  for (const p of paths) {
    const m = /\/Vehicles\/[^/]+\/([^/]+)\//.exec(p);
    if (m && byFolder.has(m[1].toLowerCase())) touched.add(byFolder.get(m[1].toLowerCase()));
  }
  return {
    cars: mod.cars.filter(c => !has.has(c.id.toLowerCase())),
    stages: Object.keys(mod.maps).filter(s => !(s in (base?.maps || {}))),
    carIds: [...touched],
  };
}

let memo = null; // { key, data }
const FORMAT = 2; // of the cached index (2: cars have their folder)
let reading = null; // the read in progress, shared by callers that ask meanwhile

// { cars: [{ id, cls, folder }], maps: { stage: { loc, n } }, notes: [pacenote names] }, or null.
export function readRallyContent(paksDir, cacheDir) {
  if (reading?.dir === paksDir) return reading.promise;
  const promise = readContent(paksDir, cacheDir).finally(() => { if (reading?.promise === promise) reading = null; });
  reading = { dir: paksDir, promise };
  return promise;
}

async function readContent(paksDir, cacheDir) {
  if (!paksDir) return null;
  const t0 = Date.now();
  const files = (await listDir(paksDir)).filter(e => e.type === 'FILE' && PAKS_RE.test(e.entry)).map(e => e.entry).sort();
  if (!files.length) return null;
  const stats = await Promise.all(files.map(f => Neutralino.filesystem.getStats(join(paksDir, f)).catch(() => null)));
  const key = `${FORMAT}|${files.map((f, i) => `${f}:${stats[i]?.size}:${Math.floor(stats[i]?.modifiedAt || 0)}`).join('|')}`;
  if (memo?.key === key) return memo.data;
  const cacheFile = cacheDir && join(cacheDir, 'rally-content.json');
  try { const c = JSON.parse(await readText(cacheFile) || 'null'); if (c?.key === key) return (memo = { key, data: c.data }).data; } catch { /* rebuild */ }
  const paths = [];
  for (const f of files) {
    try { paths.push(...utocPaths(await Neutralino.filesystem.readBinaryFile(join(paksDir, f)))); }
    catch (err) { log(`rally index ${f}: ${err?.message || err}`); }
  }
  const data = scan(paths);
  log(`rally index: ${files.length} files, ${paths.length} paths, ${data.cars.length} cars, ${Object.keys(data.maps).length} stage maps in ${Date.now() - t0} ms`);
  memo = { key, data };
  if (cacheFile) await writeText(cacheFile, JSON.stringify({ key, data })).catch(() => {});
  return data;
}

// Save-style stage ids (<Location>S<n><Stage><Full|CutN|ShortN><Forward|Reverse>) for
// the stages in the files. `known`: ids the launcher knows or the save has used; a
// location's naming follows them (the save spells Wales "Weles", Alsace says "Short"
// where its pacenotes say "Cut").
const SAVE_LOCATION = { Wales: 'Weles' };
export function rallyFileStages(data, known = []) {
  if (!data) return [];
  const out = new Set();
  const stages = Object.keys(data.maps).sort((a, b) => b.length - a.length);
  for (const note of data.notes) {
    const stage = stages.find(s => note.startsWith(s));
    if (!stage) continue;
    const rest = note.slice(stage.length);
    const dir = /Forward|Reverse/.exec(rest)?.[0];
    const variant = /(Full|Cut|Short)(\d*)/.exec(rest);
    if (!dir || rest.replace(dir, '').replace(variant?.[0] || '', '')) continue; // not a stage variant table
    const { loc, n } = data.maps[stage];
    const saveLoc = SAVE_LOCATION[loc] || loc, prefix = `${saveLoc}S${n}`;
    const here = known.filter(id => id.startsWith(`${saveLoc}S`) && /\d/.test(id[saveLoc.length + 1] || ''));
    const short = here.some(id => /Short\d/.test(id)), cut = here.some(id => /Cut\d/.test(id));
    const word = !variant || variant[1] === 'Full' ? 'Full' : short && !cut ? 'Short' : cut && !short ? 'Cut' : variant[1];
    out.add(`${prefix}${stage}${word}${word === 'Full' ? '' : variant[2]}${dir}`);
  }
  return [...out];
}
