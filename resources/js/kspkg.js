// Assetto Corsa EVO package (.kspkg) reader. Format as documented by
// Nenkai/ACEvo.Package (MIT): file data blobs followed by a fixed-size file
// table (64 MB since EVO 0.7, 32 MB before) XOR'd with a 64-bit key; each
// 0x100-byte entry holds name, flags, size and offset.
//
// We only read the table and the few files we need (metadata, car-select
// thumbnails, track photos/maps), never a whole package. Decoded images are
// cached as JPGs keyed by package size + mtime, so later scans are one stat call.
import { decodeBC7 } from './bc7.js';
import { join, basename, log, readText, writeText, mapLimit, prettifyId } from './util.js';

const KEY = [0xC1, 0x35, 0x11, 0x7D, 0xA9, 0x21, 0x97, 0x9F]; // 0x9F9721A97D1135C1, little-endian
const TABLE_SIZES = [0x4000000, 0x2000000];
const ENTRY_SIZE = 0x100;
const CHUNK = 0x40000;
const FLAG_DIR = 0x1, FLAG_XOR = 0x100;
// Texture format codes seen in EVO content: 33/34 = BC7 (linear/sRGB), 3 = RGBA8 (UI art),
// 6 = BGRA8 (brand logos; red and blue swapped).
const BC7_FORMATS = new Set([33, 34]);
const RGBA8_FORMATS = new Set([3, 6]);
const BGRA8_FORMATS = new Set([6]);

// XOR in place; `start` is the byte position within the entry (key is aligned to the entry start).
const xor = (b, start = 0) => { for (let i = 0; i < b.length; i++) b[i] ^= KEY[(start + i) & 7]; return b; };

async function readBytes(path, pos, size) {
  return new Uint8Array(await Neutralino.filesystem.readBinaryFile(path, { pos, size }));
}

async function readIndex(path, fileSize) {
  for (const tableSize of TABLE_SIZES) {
    if (fileSize < tableSize) continue;
    const start = fileSize - tableSize, entries = [];
    scan: for (let pos = start; pos < fileSize; pos += CHUNK) {
      const chunk = xor(await readBytes(path, pos, Math.min(CHUNK, fileSize - pos)));
      const dv = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
      for (let o = 0; o + ENTRY_SIZE <= chunk.length; o += ENTRY_SIZE) {
        const nameLen = dv.getInt16(o + 0xE6, true);
        const hashed = dv.getUint32(o + 0xE8, true) || dv.getUint32(o + 0xEC, true);
        if (!hashed || nameLen <= 0 || nameLen > 0xE0) break scan;
        entries.push({
          name: String.fromCharCode(...chunk.subarray(o, o + nameLen)),
          flags: dv.getUint16(o + 0xE4, true),
          size: Number(dv.getBigInt64(o + 0xF0, true)),
          offset: Number(dv.getBigInt64(o + 0xF8, true)),
        });
      }
    }
    if (entries.length && /^content[\\/]/i.test(entries[0].name)) return entries;
  }
  return null;
}

async function openPackage(path) {
  const st = await Neutralino.filesystem.getStats(path);
  const entries = await readIndex(path, st.size);
  if (!entries) return null;
  const files = entries.filter(e => !(e.flags & FLAG_DIR));
  const byName = new Map(files.map(e => [e.name.toLowerCase(), e]));
  const readRange = async (e, pos, len) => {
    const data = await readBytes(path, e.offset + pos, Math.min(len, e.size - pos));
    return (e.flags & FLAG_XOR) ? xor(data, pos) : data;
  };
  return {
    path, st, files,
    find: re => files.filter(e => re.test(e.name)),
    get: name => byName.get(name.toLowerCase()),
    read: e => readRange(e, 0, e.size),
    readRange,
  };
}

// One file from a package (e.g. a default save from content.kspkg), or null.
export async function readPackageFile(pkgPath, name) {
  const pkg = await openPackage(pkgPath);
  const e = pkg?.get(name);
  return e ? new Uint8Array(await pkg.read(e)) : null;
}

// ---------------------------------------------------------------------------
// Protobuf helpers (EVO data files are protobuf messages)

function protoFields(buf) {
  const out = [];
  let i = 0;
  const varint = () => { let r = 0, s = 0, b; do { b = buf[i++]; r += (b & 0x7F) * 2 ** s; s += 7; } while (b & 0x80 && i < buf.length); return r; };
  while (i < buf.length) {
    const key = varint(), f = Math.floor(key / 8), w = key & 7;
    if (w === 0) out.push({ f, v: varint() });
    else if (w === 2) { const len = varint(); out.push({ f, v: buf.subarray(i, i + len) }); i += len; }
    else if (w === 1) i += 8;
    else if (w === 5) i += 4;
    else break;
  }
  return out;
}

function packedVarints(buf) {
  const out = [];
  let i = 0;
  while (i < buf.length) { let r = 0, s = 0, b; do { b = buf[i++]; r += (b & 0x7F) * 2 ** s; s += 7; } while (b & 0x80 && i < buf.length); out.push(r); }
  return out;
}

const utf8 = new TextDecoder();
const isText = b => b.length && b.every(x => x >= 0x20 && x !== 0x7F);
const str = (fields, f) => { const x = fields.find(x => x.f === f && x.v instanceof Uint8Array); return x ? utf8.decode(x.v) : ''; };
const num = (fields, f) => fields.find(x => x.f === f && typeof x.v === 'number')?.v;
const msgs = (fields, f) => fields.filter(x => x.f === f && x.v instanceof Uint8Array).map(x => protoFields(x.v));

// Human-readable top-level strings (skips nested messages and content paths).
function protoStrings(buf) {
  return protoFields(buf)
    .filter(x => x.v instanceof Uint8Array && isText(x.v))
    .map(x => utf8.decode(x.v).trim())
    .filter(s => s && !s.includes('\\'));
}

// ---------------------------------------------------------------------------
// Textures: a protobuf header (.texture) + BC7 data (.texturemips) stored in
// 256x256 tiles, mip levels one after another. Header field 12 holds the tile
// size and the first tile of each mip, so we can read just one smaller mip.

async function decodeTexture(pkg, texEntry, maxWidth = Infinity) {
  const mipsEntry = pkg.get(texEntry.name + 'mips');
  if (!mipsEntry) throw new Error('missing texturemips');
  const h = protoFields(await pkg.read(texEntry));
  const width = num(h, 1), height = num(h, 2), format = num(h, 4);
  const bc7 = BC7_FORMATS.has(format);
  if (!width || !height || (!bc7 && !RGBA8_FORMATS.has(format))) throw new Error(`unsupported texture format ${format}`);

  // Textures without a tiling block are stored as one linear surface.
  const tiling = msgs(h, 12)[0] || [];
  const tw = num(tiling, 1) || width, th = num(tiling, 2) || height;
  const startsField = tiling.find(x => x.f === 4 && x.v instanceof Uint8Array);
  const mipStarts = startsField ? packedVarints(startsField.v) : [0];

  let level = 0;
  while (level + 1 < mipStarts.length && (width >> level) > maxWidth) level++;
  const mw = Math.max(1, width >> level), mh = Math.max(1, height >> level);
  const tilesX = Math.ceil(mw / tw), tilesY = Math.ceil(mh / th);
  const tileBytes = bc7 ? (tw / 4) * (th / 4) * 16 : tw * th * 4;
  const data = await pkg.readRange(mipsEntry, mipStarts[level] * tileBytes, tilesX * tilesY * tileBytes);
  const bgra = BGRA8_FORMATS.has(format);
  const decodeTile = bytes => {
    if (bc7) return decodeBC7(bytes, tw, th);
    const px = new Uint8ClampedArray(bytes);
    if (bgra) for (let i = 0; i < px.length; i += 4) { const b = px[i]; px[i] = px[i + 2]; px[i + 2] = b; }
    return px;
  };

  const rgba = new Uint8ClampedArray(mw * mh * 4);
  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      const n = ty * tilesX + tx;
      const tile = decodeTile(data.subarray(n * tileBytes, (n + 1) * tileBytes));
      const cols = Math.min(tw, mw - tx * tw), rows = Math.min(th, mh - ty * th);
      for (let y = 0; y < rows; y++) {
        rgba.set(tile.subarray(y * tw * 4, (y * tw + cols) * 4), ((ty * th + y) * mw + tx * tw) * 4);
      }
    }
  }
  return { width: mw, height: mh, rgba };
}

// JPEG has no alpha: composite transparent thumbnails onto the dark grey the
// game's own thumbnails use, so all cards look consistent.
async function toJpeg(img) {
  const src = document.createElement('canvas');
  src.width = img.width;
  src.height = img.height;
  src.getContext('2d').putImageData(new ImageData(img.rgba, img.width, img.height), 0, 0);
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#2b2b2b';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(src, 0, 0);
  const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.88));
  return blob.arrayBuffer();
}

async function exists(path) {
  try { await Neutralino.filesystem.getStats(path); return true; } catch { return false; }
}

async function saveTexture(pkg, entry, out, maxWidth) {
  if (await exists(out)) return true; // resumable: keep work from an interrupted scan
  await Neutralino.filesystem.writeBinaryFile(out, await toJpeg(await decodeTexture(pkg, entry, maxWidth)));
  return true;
}

const ensureDir = async dir => { try { await Neutralino.filesystem.createDirectory(dir); } catch { /* exists */ } };

// ---------------------------------------------------------------------------
// Mod packages

const CACHE_VERSION = 'v4';
// Enabling/disabling only renames the file, so the key ignores the .disabled suffix.
export const cacheKey = (file, st) =>
  `${basename(file).replace(/\.disabled$/i, '').replace(/[^\w.-]+/g, '_')}-${st.size}-${Math.floor(st.modifiedAt)}-${CACHE_VERSION}`;

const withPaths = (info, cacheDir) => ({ ...info, thumbs: info.thumbs.map(t => ({ ...t, path: join(cacheDir, t.file) })) });

// Returns { key, kind: 'car'|'track'|'other', name, brand, thumbs: [{ path, label }] }, or null.
export async function readModInfo(file, cacheDir) {
  const st = await Neutralino.filesystem.getStats(file);
  const key = cacheKey(file, st);
  const manifestPath = join(cacheDir, `${key}.json`);
  const cached = await readText(manifestPath);
  if (cached) { try { return withPaths(JSON.parse(cached), cacheDir); } catch { /* rebuild */ } }

  const pkg = await openPackage(file);
  if (!pkg) { log(`kspkg: no file table in ${file}`); return null; }
  const hasCars = pkg.files.some(e => /^content\\cars\\/i.test(e.name));
  const hasTracks = pkg.files.some(e => /^content\\tracks\\/i.test(e.name));
  // content\cars\<id>\... -> <id>, the id EVO uses for this car/track.
  const folderOf = re => pkg.files.find(e => re.test(e.name))?.name.split('\\')[2] || '';
  const info = {
    key, kind: hasCars ? 'car' : hasTracks ? 'track' : 'other', name: '', brand: '', thumbs: [],
    contentId: hasCars ? folderOf(/^content\\cars\\[^\\]+\\/i) : folderOf(/^content\\tracks\\[^\\]+\\/i),
  };

  const content = pkg.find(/\.modded\w*content$/i)[0];
  if (content) {
    const s = protoStrings(await pkg.read(content));
    info.name = s[0] || '';
    info.brand = s[1] || '';
  }
  await ensureDir(cacheDir);

  if (info.kind === 'car') {
    // Sorted so variants appear in preset order (visual_1, visual_2, ...).
    const textures = pkg.find(/[\\/]generated[\\/]thumbnails[\\/][^\\/]+\.texture$/i)
      .sort((a, b) => a.name.split('-').pop().localeCompare(b.name.split('-').pop(), undefined, { numeric: true }));
    const seen = new Set();
    for (const tex of textures) {
      const visual = tex.name.split(/[\\/]/).pop().replace(/\.texture$/i, '').split('-').pop();
      if (seen.has(visual)) continue;
      try {
        const name = `${key}-${seen.size}.jpg`;
        await saveTexture(pkg, tex, join(cacheDir, name), 1024);
        // Visual presets carry [brand, trim, livery name]: "Porsche", "Weissach", "Manthey Racing Tuned".
        const preset = pkg.files.find(e => e.name.toLowerCase().endsWith(`${visual.toLowerCase()}.visualcarpreset`));
        const labels = preset ? protoStrings(await pkg.read(preset)) : [];
        info.thumbs.push({ file: name, label: labels.slice(1).join(' · ') || labels[0] || visual });
        seen.add(visual);
      } catch (err) {
        log(`kspkg: thumbnail failed ${tex.name}: ${err?.message || err}`);
      }
    }
  } else if (info.kind === 'track') {
    // Best effort until track mods with a known layout exist: first UI/preview texture.
    const tex = pkg.find(/^content\\tracks\\.*(\\ui\\|preview|thumb|layout).*\.texture$/i)[0];
    if (tex) {
      try {
        const name = `${key}-0.jpg`;
        await saveTexture(pkg, tex, join(cacheDir, name), 1000);
        info.thumbs.push({ file: name, label: '' });
      } catch (err) { log(`kspkg: track preview failed ${tex.name}: ${err?.message || err}`); }
    }
    if (!info.name) info.name = prettifyId(pkg.find(/^content\\tracks\\[^\\]+\\/i)[0]?.name.split('\\')[2] || '');
  }
  await writeText(manifestPath, JSON.stringify(info));
  return withPaths(info, cacheDir);
}

// Delete cached thumbnails/manifests for packages that changed or were removed.
export async function pruneCache(cacheDir, liveKeys) {
  let entries = [];
  try { entries = await Neutralino.filesystem.readDirectory(cacheDir); } catch { return; }
  for (const e of entries) {
    if (e.type !== 'FILE' || [...liveKeys].some(k => e.entry.startsWith(k))) continue;
    try { await Neutralino.filesystem.remove(join(cacheDir, e.entry)); } catch { /* in use */ }
  }
}

// ---------------------------------------------------------------------------
// Official content (content.kspkg): car list with car-select thumbnails and
// track list with layout photos + SVG maps, as the game's menus show them.

const BASE_VERSION = 'v4'; // v4: Race containers per layout
const slug = name => name.toLowerCase().replace(/\s+/g, '_');
const layoutName = id => prettifyId(id.replace(/-/g, ' ')).replace(/\bV(\d)/g, 'v$1');

function catalogWithPaths(cat, dir) {
  const p = f => f ? join(dir, f) : '';
  return {
    cars: cat.cars.map(c => ({ ...c, image: p(c.image) })),
    tracks: cat.tracks.map(t => ({ ...t, layouts: t.layouts.map(l => ({ ...l, image: p(l.image), map: p(l.map) })) })),
  };
}

export async function readEvoCatalog(contentPath, cacheDir, onProgress = () => {}) {
  const st = await Neutralino.filesystem.getStats(contentPath);
  const key = `base-${st.size}-${Math.floor(st.modifiedAt)}-${BASE_VERSION}`;
  const baseDir = join(cacheDir, 'base'), dir = join(baseDir, key);
  const manifestPath = join(dir, 'catalog.json');
  const cached = await readText(manifestPath);
  if (cached) { try { return catalogWithPaths(JSON.parse(cached), dir); } catch { /* rebuild */ } }

  await ensureDir(cacheDir); await ensureDir(baseDir);
  // A game update produces a new key; drop catalogues from older versions. For the
  // same game build, a new BASE_VERSION reuses the old folder so its images are kept.
  const build = `base-${st.size}-${Math.floor(st.modifiedAt)}-`;
  for (const e of await Neutralino.filesystem.readDirectory(baseDir).catch(() => [])) {
    if (e.type !== 'DIRECTORY' || e.entry === key) continue;
    const old = join(baseDir, e.entry);
    const reused = e.entry.startsWith(build) && !(await exists(dir)) && await Neutralino.filesystem.move(old, dir).then(() => true, () => false);
    if (reused) await Neutralino.filesystem.remove(manifestPath).catch(() => {});
    else await Neutralino.filesystem.remove(old).catch(() => {});
  }
  await ensureDir(dir);

  onProgress(0, 0, 'Reading game package…');
  const pkg = await openPackage(contentPath);
  if (!pkg) throw new Error('content.kspkg has no readable file table');

  const table = async name => { const e = pkg.get(name); return e ? protoFields(await pkg.read(e)) : []; };
  const rows = (t, inner) => msgs(t, 2).flatMap(m => msgs(m, 3)).flatMap(m => msgs(m, inner));

  const cars = rows(await table('system\\cars.table'), 1).map(c => ({
    id: str(c, 1), name: str(c, 4), year: num(c, 5) || '', brand: str(c, 10), image: '',
  })).filter(c => c.id && c.name);

  // Track containers describe each layout per game mode: Practice uses the
  // "Time Attack" container (flag field 6), Race and Race Weekend the "Race" one
  // (flag field 5). Each carries the track_item values the game mode saves need
  // (container name, max drivers, length).
  const containers = { practice: new Map(), race: new Map() };
  for (const c of rows(await table('system\\track_containers.table'), 8)) {
    const mode = num(c, 6) === 1 ? 'practice' : num(c, 5) === 1 ? 'race' : '';
    const venue = str(c, 10), layout = str(c, 14);
    if (!mode || !venue || !layout) continue;
    containers[mode].set(`${slug(venue)}|${slug(layout)}`, { layoutName: layout, container: str(c, 1), maxDrivers: num(c, 9) ?? 0, length: num(c, 8) ?? 0 });
  }

  const photos = pkg.find(/^uiresources\\images\\tracks\\[^\\]+\.texture$/i);
  const tracks = rows(await table('system\\tracks.table'), 2).map(t => ({
    name: str(t, 1), path: str(t, 3), country: str(t, 5), region: str(t, 13),
  })).filter(t => t.name && t.path && !/\\interns\\/i.test(t.path)).map(t => {
    const s = slug(t.name);
    const own = photos.filter(e => basename(e.name.replace(/\\/g, '/')).toLowerCase().startsWith(`${s}-`));
    return {
      id: t.path.split('\\').pop(), name: t.name, country: t.country, region: t.region,
      layouts: own.map(e => {
        const file = basename(e.name.replace(/\\/g, '/')).replace(/\.texture$/i, '');
        const id = file.slice(s.length + 1);
        const practice = containers.practice.get(`${s}|${id}`) || null, race = containers.race.get(`${s}|${id}`) || null;
        return { id, name: (practice || race)?.layoutName || layoutName(id), file, practice, race };
      }).sort((a, b) => a.name.localeCompare(b.name)),
    };
  });

  const jobs = [
    ...cars.map(c => async () => {
      const tex = pkg.find(new RegExp(`^content\\\\cars\\\\${c.id}\\\\generated\\\\thumbnails\\\\[^\\\\]+\\.texture$`, 'i'))
        .sort((a, b) => a.name.split('-').pop().localeCompare(b.name.split('-').pop(), undefined, { numeric: true }))[0];
      if (!tex) return;
      const out = `car-${c.id}.jpg`;
      if (await saveTexture(pkg, tex, join(dir, out), 1024).catch(err => log(`car thumb ${c.id}: ${err?.message || err}`))) c.image = out;
    }),
    ...tracks.flatMap(t => t.layouts.map(l => async () => {
      const tex = pkg.get(`uiresources\\images\\tracks\\${l.file}.texture`);
      const out = `track-${l.file}.jpg`;
      if (tex && await saveTexture(pkg, tex, join(dir, out), 1000).catch(err => log(`track photo ${l.file}: ${err?.message || err}`))) l.image = out;
      const svg = pkg.get(`uiresources\\images\\trackmaps\\${l.file}.svg`);
      if (svg) {
        const mapOut = `map-${l.file}.svg`;
        await Neutralino.filesystem.writeBinaryFile(join(dir, mapOut), (await pkg.read(svg)).slice().buffer);
        l.map = mapOut;
      }
      delete l.file;
    })),
  ];
  let done = 0;
  await mapLimit(jobs, 3, async job => { await job(); onProgress(++done, jobs.length, 'Extracting official cars and tracks…'); });

  const catalog = { cars: cars.filter(c => c.image), tracks: tracks.filter(t => t.layouts.length) };
  await writeText(manifestPath, JSON.stringify(catalog));
  return catalogWithPaths(catalog, dir);
}

// ---------------------------------------------------------------------------
// Quick Drive extras, read on demand and cached in <cacheDir>/extras:
//   liveries  thumbnail + name of one car/mech/visual combination
//             (content\cars\<car>\generated\thumbnails\<car>-<mech>-<visual>.texture and
//             presets\<visual>.visualcarpreset), from content.kspkg or the car's mod package
//   brands    manufacturer logos (uiresources\branding\oem\<brand>\logo.texture)

const EXTRAS_VERSION = 'v4'; // v4: brand logos decoded as BGRA (new file names so the webview doesn't show cached ones)
const brandSlug = name => String(name).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const liveryKey = r => `${r.carId}-${r.mech}-${r.visual}`.toLowerCase();

async function toPng(img) {
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  canvas.getContext('2d').putImageData(new ImageData(img.rgba, img.width, img.height), 0, 0);
  const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
  return blob.arrayBuffer();
}

// liveries: [{ carId, mech, visual, pkgPath }], brands: [brand name] (read from contentPkg)
// -> { liveries: { key: { image, label } }, brands: { slug: image } } (absolute paths)
export async function readEvoExtras({ liveries = [], brands = [], contentPkg = '' }, cacheDir, onProgress = () => {}) {
  const dir = join(cacheDir, 'extras');
  await ensureDir(cacheDir); await ensureDir(dir);
  const indexPath = join(dir, 'index.json');
  let index = { v: EXTRAS_VERSION, liveries: {}, brands: {} };
  try { const j = JSON.parse(await readText(indexPath) || '{}'); if (j.v === EXTRAS_VERSION) index = j; } catch { /* rebuild */ }
  if (!Object.keys(index.brands).length) {
    // Logos from older versions (brand-*.png) had red and blue swapped.
    for (const e of await Neutralino.filesystem.readDirectory(dir).catch(() => [])) {
      if (/^brand-.*\.png$/i.test(e.entry)) await Neutralino.filesystem.remove(join(dir, e.entry)).catch(() => {});
    }
  }

  // Group missing work by package so each package's table is read once.
  const todo = new Map(); // pkgPath -> { liveries: [], brands: [] }
  const job = p => todo.get(p) || todo.set(p, { liveries: [], brands: [] }).get(p);
  for (const r of liveries) if (r.pkgPath && !(liveryKey(r) in index.liveries)) job(r.pkgPath).liveries.push(r);
  for (const b of brands) if (contentPkg && !(brandSlug(b) in index.brands)) job(contentPkg).brands.push(b);

  for (const [pkgPath, work] of todo) {
    onProgress(`Reading ${basename(pkgPath)}…`);
    let pkg = null;
    try { pkg = await openPackage(pkgPath); } catch (err) { log(`extras: ${pkgPath}: ${err?.message || err}`); }
    for (const r of work.liveries) {
      const key = liveryKey(r);
      let entry = { image: '', label: '' };
      if (pkg) {
        const base = `content\\cars\\${r.carId}\\`;
        // Some combinations have no thumbnail of their own; any mech with the same visual looks the same.
        const exact = pkg.get(`${base}generated\\thumbnails\\${r.carId}-${r.mech}-${r.visual}.texture`);
        const tex = (exact?.size > 20 ? exact : null) || pkg.find(new RegExp(`^content\\\\cars\\\\${r.carId}\\\\generated\\\\thumbnails\\\\[^\\\\]+-${r.visual}\\.texture$`, 'i')).find(e => e.size > 20);
        if (tex) {
          try { const file = `livery-${key}.jpg`; await saveTexture(pkg, tex, join(dir, file), 512); entry.image = file; }
          catch (err) { log(`extras: livery thumb ${key}: ${err?.message || err}`); }
        }
        const preset = pkg.get(`${base}presets\\${r.visual}.visualcarpreset`) || pkg.files.find(e => e.name.toLowerCase().endsWith(`\\${r.visual.toLowerCase()}.visualcarpreset`));
        // Presets carry [brand, full name, short name]: "Porsche", "992 GT3 Cup Black Falcon 632",
        // "Black Falcon 632" (visual) and "Porsche", "... Carrera Cup ABS TC Variant", "ABS TC" (mechanical).
        // Skip internal codes such as "1_1" that some presets also carry.
        const shortName = labels => labels.slice(1).filter(s => /[a-z]{2}/i.test(s) && !s.includes('_')).pop() || labels[0] || '';
        const labels = preset ? protoStrings(await pkg.read(preset)) : [];
        entry.label = shortName(labels);
        const mech = pkg.get(`${base}presets\\${r.mech}.mechanicalcarpreset`);
        entry.mech = mech ? shortName(protoStrings(await pkg.read(mech))) : '';
      }
      index.liveries[key] = entry;
    }
    for (const b of work.brands) {
      const slug = brandSlug(b);
      let image = '';
      const tex = pkg?.get(`uiresources\\branding\\oem\\${slug}\\logo.texture`);
      if (tex) {
        try { image = `logo-${slug}.png`; await Neutralino.filesystem.writeBinaryFile(join(dir, image), await toPng(await decodeTexture(pkg, tex, 128))); }
        catch (err) { image = ''; log(`extras: brand ${slug}: ${err?.message || err}`); }
      }
      index.brands[slug] = image;
    }
  }
  if (todo.size) await writeText(indexPath, JSON.stringify(index));

  const abs = f => f ? join(dir, f) : '';
  return {
    liveries: Object.fromEntries(liveries.map(r => [liveryKey(r), { ...(index.liveries[liveryKey(r)] || {}), image: abs(index.liveries[liveryKey(r)]?.image) }])),
    brands: Object.fromEntries(brands.map(b => [brandSlug(b), abs(index.brands[brandSlug(b)])])),
    liveryKey, brandSlug,
  };
}
