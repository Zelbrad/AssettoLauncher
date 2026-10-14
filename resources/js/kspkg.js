// Assetto Corsa EVO package (.kspkg) reader. Format as documented by
// Nenkai/ACEvo.Package (MIT): file data blobs followed by a fixed-size file
// table (64 MB since EVO 0.7, 32 MB before) XOR'd with a 64-bit key; each
// 0x100-byte entry holds name, flags, size and offset.
//
// We only read the table and the few files we need (metadata, car-select
// thumbnails, track photos/maps), never a whole package. Decoded images are
// cached as JPGs keyed by package size + mtime, so later scans are one stat call.
import { decodeBC7 } from './bc7.js';
import { join, basename, log, readText, writeText, mapLimit, prettifyId, fileUrl, listDir } from './util.js';

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
export const kspkgXor = xor;

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
    if (entries.length && /^(content|uiresources)[\\/]/i.test(entries[0].name)) return entries;
  }
  return null;
}

export async function openPackage(path) {
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

// Every car's mechanical presets with the visual presets each one allows (field 8):
// [{ carId, mech, visuals }], paths as stored in the package. Cached per package build.
export async function readCarPresets(pkgPath, cacheDir) {
  const st = await Neutralino.filesystem.getStats(pkgPath);
  const key = cacheKey(pkgPath, st), file = join(cacheDir, `presets-${key}.json`);
  try { const j = JSON.parse(await readText(file) || 'null'); if (Array.isArray(j)) return j; } catch { /* rebuild */ }
  if (!openPkgs.has(pkgPath)) openPkgs.set(pkgPath, openPackage(pkgPath));
  const pkg = await openPkgs.get(pkgPath);
  if (!pkg) return [];
  const out = [];
  for (const e of pkg.find(/^content\\cars\\[^\\]+\\presets\\[^\\]+\.mechanicalcarpreset$/i)) {
    const visuals = protoFields(await pkg.read(e)).filter(x => x.f === 8 && x.v instanceof Uint8Array).map(x => utf8.decode(x.v));
    out.push({ carId: e.name.split('\\')[2], mech: e.name, visuals });
  }
  await ensureDir(cacheDir);
  // This package's lists from older versions of it aren't needed any more.
  const older = `presets-${key.replace(/-\d+-\d+-[^-]+$/, '')}-`;
  for (const x of await Neutralino.filesystem.readDirectory(cacheDir).catch(() => [])) {
    if (x.entry.startsWith(older) && join(cacheDir, x.entry) !== file) await Neutralino.filesystem.remove(join(cacheDir, x.entry)).catch(() => {});
  }
  await writeText(file, JSON.stringify(out)).catch(err => log(`car presets: ${err?.message || err}`));
  return out;
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
const strs = (fields, f) => fields.filter(x => x.f === f && x.v instanceof Uint8Array).map(x => utf8.decode(x.v));

// A spawn points scene: each point (an actor, field 2) has its StartingPositionData
// at 50 > 104, whose field 6 lists the types it serves (packed): Grid 3, Pit 4, Box 5, Poi 6.
const SPAWN_GRID = 3, SPAWN_PIT = 4, SPAWN_BOX = 5;
const spawnTypes = scene => msgs(scene, 2).flatMap(a => msgs(a, 50)).flatMap(m => msgs(m, 104)).flatMap(d => {
  const t = d.find(x => x.f === 6);
  return t?.v instanceof Uint8Array ? [...t.v] : typeof t?.v === 'number' ? [t.v] : [];
});

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
// game's own thumbnails use, so all cards look consistent. frame: a mod car's
// picture, framed as EVO frames its own (frameCar).
async function toJpeg(img, frame = false) {
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
  if (frame) {
    try { frameCar(canvas); } catch (err) { log(`kspkg: framing failed: ${err?.message || err}`); }
  }
  const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.88));
  return blob.arrayBuffer();
}

// EVO renders its car pictures on a grey studio backdrop (a soft gradient), the car
// and its shadow across at most three quarters of the width and half the height.
// Some mods ship theirs closer, the car touching the sides, so their cards look
// zoomed in. Such a picture is redone at EVO's framing: the backdrop without the
// car is worked out, and the car alone (how the picture differs from that
// backdrop) is put back on it smaller, in the middle, so no edge shows. Anything
// else is left as it is: cars already framed like EVO's, pictures that aren't
// square, and any picture whose border or top isn't mostly plain backdrop (a
// photo, say). Measured on a 128 px copy; a few milliseconds a picture.
// Returns whether the picture changed.
const CAR_FRAME = { width: 0.75, height: 0.5 };
export const FRAMING = 1; // in the pictures' names: a new number when frameCar changes makes them again
const canvasOf = (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h });
// src drawn into a w x h canvas (at rect, or filling it), as RGBA bytes. Big ones
// are drawn by the GPU (read once), small ones by the CPU.
function drawn(src, w, h, rect = [0, 0, w, h]) {
  const ctx = canvasOf(w, h).getContext('2d', { willReadFrequently: w * h <= 256 * 256 });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, ...rect);
  return ctx.getImageData(0, 0, w, h).data;
}
export function frameCar(canvas) {
  const w = canvas.width, h = canvas.height, N = 128;
  if (Math.abs(w / h - 1) > 0.1) return false;
  const px = drawn(canvas, N, N);
  // The backdrop's grey: the median colour of the outer ring of pixels.
  const ring = [];
  for (let i = 0; i < N; i++) ring.push(i, (N - 1) * N + i, i * N, i * N + N - 1);
  const median = c => ring.map(i => px[i * 4 + c]).sort((a, b) => a - b)[ring.length >> 1];
  const bg = [median(0), median(1), median(2)], bgLum = (bg[0] + bg[1] + bg[2]) / 3;
  // Car or shadow: lighter, darker or more colourful than the backdrop.
  const car = new Uint8Array(N * N);
  for (let i = 0; i < N * N; i++) {
    const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2];
    car[i] = Math.abs((r + g + b) / 3 - bgLum) > 22 || Math.max(r, g, b) - Math.min(r, g, b) > 24 ? 1 : 0;
  }
  if (ring.filter(i => car[i]).length > ring.length / 4) return false;
  const cols = new Uint16Array(N), rows = new Uint16Array(N);
  for (let i = 0; i < N * N; i++) if (car[i]) { cols[i % N]++; rows[Math.floor(i / N)]++; }
  const span = a => { const i = a.findIndex(n => n > 1); return i < 0 ? null : [i, a.findLastIndex(n => n > 1) + 1]; };
  const xs = span(cols), ys = span(rows);
  if (!xs || ys[0] < N * 0.15) return false;
  const s = Math.min(CAR_FRAME.width * N / (xs[1] - xs[0]), CAR_FRAME.height * N / (ys[1] - ys[0]));
  if (s > 0.92) return false;

  // The backdrop without the car, on a 32 x 32 grid: cells clear of the car (and
  // of its edges) keep the picture's colour; the rest are filled in smoothly from
  // their neighbours.
  const G = 32, C = N / G, back = new Float32Array(G * G * 3), known = new Uint8Array(G * G), hit = new Uint8Array(G * G);
  for (let i = 0; i < N * N; i++) if (car[i]) hit[Math.floor(Math.floor(i / N) / C) * G + Math.floor((i % N) / C)] = 1;
  for (let gy = 0; gy < G; gy++) for (let gx = 0; gx < G; gx++) {
    let near = 0;
    for (let y = Math.max(0, gy - 1); y <= Math.min(G - 1, gy + 1); y++) for (let x = Math.max(0, gx - 1); x <= Math.min(G - 1, gx + 1); x++) near |= hit[y * G + x];
    const k = gy * G + gx;
    if (near) { back.set(bg, k * 3); continue; }
    known[k] = 1;
    for (let c = 0; c < 3; c++) {
      let sum = 0;
      for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) sum += px[((gy * C + y) * N + gx * C + x) * 4 + c];
      back[k * 3 + c] = sum / (C * C);
    }
  }
  const holes = [];
  for (let k = 0; k < G * G; k++) {
    const gx = k % G, gy = Math.floor(k / G);
    if (!known[k]) holes.push([k, [gx > 0 && k - 1, gx < G - 1 && k + 1, gy > 0 && k - G, gy < G - 1 && k + G].filter(n => n !== false)]);
  }
  for (let pass = 0; pass < 200; pass++) {
    for (const [k, nb] of holes) for (let c = 0; c < 3; c++) back[k * 3 + c] = nb.reduce((t, n) => t + back[n * 3 + c], 0) / nb.length;
  }
  const grid = canvasOf(G, G), img = new ImageData(G, G);
  for (let k = 0; k < G * G; k++) { img.data.set([back[k * 3], back[k * 3 + 1], back[k * 3 + 2]], k * 4); img.data[k * 4 + 3] = 255; }
  grid.getContext('2d').putImageData(img, 0, 0);

  // out = backdrop + (shrunk picture - shrunk backdrop), fading out at the shrunk
  // picture's edges (where a car that touched the sides is cut off).
  const cx = (xs[0] + xs[1]) / 2 / N, cy = (ys[0] + ys[1]) / 2 / N;
  const rect = [w / 2 - cx * w * s, h / 2 - cy * h * s, w * s, h * s];
  const [dx, dy, dw, dh] = rect, feather = 0.05 * dw;
  const B = drawn(grid, w, h), Bs = drawn(grid, w, h, rect), Is = drawn(canvas, w, h, rect);
  const out = new ImageData(w, h);
  out.data.set(B);
  for (let y = Math.max(0, Math.floor(dy)); y < Math.min(h, Math.ceil(dy + dh)); y++) {
    for (let x = Math.max(0, Math.floor(dx)); x < Math.min(w, Math.ceil(dx + dw)); x++) {
      const f = Math.min(1, (x + 0.5 - dx) / feather, (dx + dw - x - 0.5) / feather, (y + 0.5 - dy) / feather, (dy + dh - y - 0.5) / feather);
      if (f <= 0) continue;
      const i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) out.data[i + c] = B[i + c] + f * (Is[i + c] - Bs[i + c]);
    }
  }
  canvas.getContext('2d').putImageData(out, 0, 0);
  return true;
}

async function exists(path) {
  try { await Neutralino.filesystem.getStats(path); return true; } catch { return false; }
}

async function saveTexture(pkg, entry, out, maxWidth, frame = false) {
  if (await exists(out)) return true; // resumable: keep work from an interrupted scan
  await Neutralino.filesystem.writeBinaryFile(out, await toJpeg(await decodeTexture(pkg, entry, maxWidth), frame));
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
  let old = null;
  if (cached) {
    try {
      old = JSON.parse(cached);
      // Read again: tracks read before they were named from their ui\previews.json,
      // and cars whose pictures were framed differently (frameCar), or not at all.
      if (old.kind === 'track' ? old.named : old.kind !== 'car' || old.framing === FRAMING) return withPaths(old, cacheDir);
    } catch { /* rebuild */ }
  }

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
        const name = `${key}-f${FRAMING}-${seen.size}.jpg`;
        await saveTexture(pkg, tex, join(cacheDir, name), 1024, true);
        // Visual presets carry [brand, trim, livery name]: "Porsche", "Weissach", "Manthey Racing Tuned".
        const preset = pkg.files.find(e => e.name.toLowerCase().endsWith(`${visual.toLowerCase()}.visualcarpreset`));
        const labels = preset ? protoStrings(await pkg.read(preset)) : [];
        info.thumbs.push({ file: name, label: labels.slice(1).join(' · ') || labels[0] || visual });
        seen.add(visual);
      } catch (err) {
        log(`kspkg: thumbnail failed ${tex.name}: ${err?.message || err}`);
      }
    }
    info.framing = FRAMING;
    // The pictures made before (other names) aren't needed any more.
    for (const t of old?.thumbs || []) {
      if (!info.thumbs.some(x => x.file === t.file)) await Neutralino.filesystem.remove(join(cacheDir, t.file)).catch(() => {});
    }
  } else if (info.kind === 'track') {
    // A UI or preview texture, a photo first (a converted track has ui\photo and ui\map).
    const tex = pkg.find(/^content\\tracks\\.*(\\ui\\|preview|thumb|layout).*\.texture$/i).sort((a, b) => +!/photo|preview/i.test(a.name) - +!/photo|preview/i.test(b.name))[0];
    if (tex) {
      try {
        const name = `${key}-0.jpg`;
        await saveTexture(pkg, tex, join(cacheDir, name), 1000);
        info.thumbs.push({ file: name, label: '' });
      } catch (err) { log(`kspkg: track preview failed ${tex.name}: ${err?.message || err}`); }
    }
    if (!info.name) {
      const previews = pkg.get(`content\\tracks\\${info.contentId}\\ui\\previews.json`);
      info.name = evoTrackName(info.contentId, previews ? parseJson(utf8.decode(await pkg.read(previews))) : null);
    }
    info.named = true;
  }
  await writeText(manifestPath, JSON.stringify(info));
  return withPaths(info, cacheDir);
}

// Delete cached files of mod packages that changed or were removed: the files
// named after a package's key (its manifest and pictures, presets-<key>.json,
// evotracks.js's trackreg-<key>-….json and trackmap-<key>-….svg) whose key isn't
// a live one. Other files (known-cars.json, the game package's presets) stay.
export async function pruneCache(cacheDir, liveKeys) {
  let entries = [];
  try { entries = await Neutralino.filesystem.readDirectory(cacheDir); } catch { return; }
  for (const e of entries) {
    if (e.type !== 'FILE' || !/\.kspkg-\d+-\d+-v\d+/i.test(e.entry) || /(^|-)content\.kspkg-\d/i.test(e.entry)) continue;
    if ([...liveKeys].some(k => e.entry.includes(k))) continue;
    try { await Neutralino.filesystem.remove(join(cacheDir, e.entry)); } catch { /* in use */ }
  }
}

// ---------------------------------------------------------------------------
// Writing a package: a loose mod folder made into one EVO loads from its mods
// folder. The files' data one after another, then the file table: an entry per
// file and per folder (from the mod's own folder down, as car mods have
// content\cars\<id>), named as EVO looks it up (FNV-1a 64 of the path in lower
// case, UTF-16, with \'s) and sorted by that hash, since EVO finds files by
// binary search. Nothing is XOR'd but the table.

const pathHash = name => {
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < name.length; i++) {
    const c = name.charCodeAt(i);
    for (const b of [c & 255, c >> 8]) { h ^= BigInt(b); h = (h * 0x100000001b3n) & 0xffffffffffffffffn; }
  }
  return h;
};

// files: [{ name: 'content\\tracks\\<id>\\…', src, size, optional }]. Optional ones
// (pictures for the game's menus) are left out if one would sort first: readers
// find a package by its first entry being under content\. Written to <out>.part,
// renamed when done, removed if it fails. onProgress(done, total) in bytes of the
// package; it may throw to stop.
export async function writePackage(out, files, onProgress) {
  const part = `${out}.part`;
  try {
    return await writePackageTo(out, part, files, onProgress);
  } catch (err) {
    await Neutralino.filesystem.remove(part).catch(() => {});
    throw err;
  }
}

async function writePackageTo(out, part, files, onProgress) {
  const top = 3, CH = 8 << 20;
  const named = files.map(f => ({ ...f, hash: pathHash(f.name.toLowerCase()) }));
  const bad = named.find(f => !/^[\x20-\x7e]+$/.test(f.name) || f.name.length > 0xE0);
  if (bad) throw new Error(`a file name EVO can't take: ${bad.name}`);
  const first = list => list.reduce((m, f) => (f.hash < m ? f.hash : m), 0xffffffffffffffffn);
  const used = first(named.filter(f => f.optional)) < first(named.filter(f => !f.optional)) ? named.filter(f => !f.optional) : named;

  const entries = [], data = used.reduce((n, f) => n + f.size, 0), total = data + TABLE_SIZES[0];
  let offset = 0, pending = [], pendingSize = 0;
  const flush = async () => {
    if (!pendingSize) return;
    const buf = new Uint8Array(pendingSize);
    let at = 0;
    for (const p of pending) { buf.set(p, at); at += p.length; }
    await Neutralino.filesystem.appendBinaryFile(part, buf.buffer);
    pending = []; pendingSize = 0;
    onProgress?.(offset, total);
  };
  await Neutralino.filesystem.writeBinaryFile(part, new ArrayBuffer(0));
  onProgress?.(0, total);
  for (const f of used) {
    entries.push({ name: f.name, hash: f.hash, flags: 0, size: f.size, offset });
    for (let pos = 0; pos < f.size; pos += CH) {
      const bytes = new Uint8Array(await Neutralino.filesystem.readBinaryFile(f.src, { pos, size: Math.min(CH, f.size - pos) }));
      pending.push(bytes); pendingSize += bytes.length; offset += bytes.length;
      if (pendingSize >= CH) await flush();
    }
  }
  await flush();
  if (offset !== data) throw new Error('a file changed while it was packed');

  const dirs = new Set();
  for (const f of used) {
    const parts = f.name.split('\\');
    for (let i = top; i < parts.length; i++) dirs.add(parts.slice(0, i).join('\\'));
  }
  for (const d of dirs) entries.push({ name: d, hash: pathHash(d.toLowerCase()), flags: FLAG_DIR, size: 0, offset: 0 });
  if (entries.length > TABLE_SIZES[0] / ENTRY_SIZE) throw new Error('too many files for one package');
  entries.sort((a, b) => (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0));

  const table = new Uint8Array(TABLE_SIZES[0]), dv = new DataView(table.buffer);
  entries.forEach((e, i) => {
    const o = i * ENTRY_SIZE;
    for (let k = 0; k < e.name.length; k++) table[o + k] = e.name.charCodeAt(k);
    dv.setUint16(o + 0xE4, e.flags, true);
    dv.setInt16(o + 0xE6, e.name.length, true);
    dv.setBigUint64(o + 0xE8, e.hash, true);
    dv.setBigInt64(o + 0xF0, BigInt(e.size), true);
    dv.setBigInt64(o + 0xF8, BigInt(e.offset), true);
  });
  xor(table);
  for (let pos = 0; pos < table.length; pos += CH) {
    await Neutralino.filesystem.appendBinaryFile(part, table.slice(pos, pos + CH).buffer);
    onProgress?.(data + Math.min(pos + CH, table.length), total);
  }
  await Neutralino.filesystem.remove(out).catch(() => {});
  await Neutralino.filesystem.move(part, out);
  return { files: used.length, dirs: dirs.size, skipped: named.length - used.length, size: offset + table.length };
}

// ---------------------------------------------------------------------------
// Mod track names. EvoForge (the tool converting Assetto Corsa tracks) writes
// ui\previews.json with the Assetto Corsa track it came from ("sources.photo":
// ...\content\tracks\ek_tsubaki_line\ui\...): its folder name reads better than
// the converted id (ek_tsubak_hv).

const parseJson = text => { try { return JSON.parse(text); } catch { return null; } };

export function evoTrackName(id, previews) {
  const from = /[\\/]tracks[\\/]([^\\/]+)[\\/]ui[\\/]/i.exec(previews?.sources?.photo || previews?.sources?.outline || '')?.[1];
  return prettifyId(from || id);
}
export const evoLayoutName = layout => prettifyId(layout);

// A track's layouts as EVO finds them: each containers\layout_<id>.scene (all of
// EVO's own tracks; only Brands Hatch and Imola also have .track_layout files) and
// each layouts\<id>.track_layout (converted tracks have both). names: the track's
// files, relative to its folder. [{ id, aiLine }], aiLine: it has
// layouts\layout_<id>.ideal_line.aisplinedata, the line EVO's AI drives (Assetto
// Corsa layouts without an AI line, such as free roam ones, convert without it).
export function evoTrackLayouts(names) {
  const lower = new Set(names.map(n => n.toLowerCase())), ids = new Map();
  for (const n of names) {
    const m = /^containers\\layout_([^\\]+)\.scene$/i.exec(n) || /^layouts\\([^\\]+)\.track_layout$/i.exec(n);
    if (m && !ids.has(m[1].toLowerCase())) ids.set(m[1].toLowerCase(), m[1]);
  }
  return [...ids.values()].sort().map(id => ({
    id, aiLine: [`layout_${id}`, id].some(s => lower.has(`layouts\\${s}.ideal_line.aisplinedata`.toLowerCase())),
  }));
}

// The name EVO's menus give a track's picture and map (ksUI.getTrackId in
// uiresources\js\components.js): "<track name>-<layout name>", spaces as _.
export const evoUiTrackId = (name, layout) => [name.trim().replace('-', '_'), layout.trim()].join('-').replaceAll(' ', '_').toLowerCase();

// An EVO track as a loose folder (<id>.track, <id>.scene, containers\layout_<layout>.scene,
// the way EVO's own are, as tools converting Assetto Corsa tracks make them; see
// evoTrackLayouts) packed for the mods folder: the folder as content\tracks\<id>. The folder's
// ui\photo and ui\map, when there, are also put where EVO's menus look for a
// track's picture and map: uiresources\images\tracks\<name>-<layout>.texture and
// uiresources\images\trackmaps\<name>-<layout>.svg and .texture (evoUiTrackId), for
// each layout, with the names the track is listed under (evotracks.js).
export async function packEvoTrack(dir, id, out, onProgress) {
  const files = [];
  const walk = async (abs, rel) => {
    for (const e of await listDir(abs)) {
      if (e.entry === '.' || e.entry === '..') continue;
      const src = join(abs, e.entry), name = rel ? `${rel}\\${e.entry}` : e.entry;
      if (e.type === 'DIRECTORY') await walk(src, name);
      else files.push({ name: `content\\tracks\\${id}\\${name}`, src, size: (await Neutralino.filesystem.getStats(src)).size });
    }
  };
  await walk(dir, '');
  const has = rel => files.find(f => f.name.toLowerCase() === `content\\tracks\\${id}\\${rel}`.toLowerCase());
  const prefix = `content\\tracks\\${id}\\`;
  const layouts = evoTrackLayouts(files.map(f => f.name.slice(prefix.length))).map(l => l.id);
  const photo = has('ui\\photo.texture'), mips = has('ui\\photo.texturemips'), map = has('ui\\map.svg');
  const mapTex = has('ui\\map.texture'), mapMips = has('ui\\map.texturemips');
  const previews = has('ui\\previews.json'), name = evoTrackName(id, previews ? parseJson(await readText(previews.src)) : null);
  for (const layout of layouts) {
    const ui = evoUiTrackId(name, evoLayoutName(layout));
    if (photo && mips) files.push({ ...photo, name: `uiresources\\images\\tracks\\${ui}.texture`, optional: true }, { ...mips, name: `uiresources\\images\\tracks\\${ui}.texturemips`, optional: true });
    if (map) files.push({ ...map, name: `uiresources\\images\\trackmaps\\${ui}.svg`, optional: true });
    // The in-game map takes the texture, the menus the svg (EVO's own have both).
    if (mapTex && mapMips) files.push({ ...mapTex, name: `uiresources\\images\\trackmaps\\${ui}.texture`, optional: true }, { ...mapMips, name: `uiresources\\images\\trackmaps\\${ui}.texturemips`, optional: true });
  }
  const r = await writePackage(out, files, onProgress);
  log(`kspkg: packed ${dir} as ${out}: ${r.files} files, ${r.dirs} folders, ${r.size} bytes${r.skipped ? `, ${r.skipped} menu pictures left out` : ''}`);
  return r;
}

// A loose texture (.texture beside its .texturemips) as a JPG, for a preview.
export async function looseTextureJpeg(texPath, out, maxWidth = 1000) {
  const read = async (path, pos, size) => new Uint8Array(await Neutralino.filesystem.readBinaryFile(path, size == null ? undefined : { pos, size }));
  const entry = name => ({ name, path: name });
  const pkg = {
    get: name => entry(name),
    read: e => read(e.path),
    readRange: (e, pos, len) => read(e.path, pos, len),
  };
  await Neutralino.filesystem.writeBinaryFile(out, await toJpeg(await decodeTexture(pkg, entry(texPath), maxWidth)));
  return out;
}

// ---------------------------------------------------------------------------
// Official content (content.kspkg): car list with car-select thumbnails and
// track list with layout photos + SVG maps, as the game's menus show them.

const BASE_VERSION = 'v8'; // v8: only Hotstint containers whose start is a pit spot too; v7: Hotstint containers per layout; v6: academy arches per layout; v5: pictures decoded when shown (catalogue lists their textures)
const slug = name => name.toLowerCase().replace(/\s+/g, '_');
const layoutName = id => prettifyId(id.replace(/-/g, ' ')).replace(/\bV(\d)/g, 'v$1');

// ---------------------------------------------------------------------------
// Pictures of the official catalogue are decoded when first shown, not while the
// catalogue is built (70+ BC7 textures made the first EVO page take long). The
// catalogue lists each picture's texture; cards point at the JPG it becomes, and a
// card whose JPG doesn't exist yet asks for it (lazyImage, from the page's image
// error handler; the browser only loads cards near the view). Shown pictures go
// first; the rest are decoded one by one in the background, tracks then cars.

const lazyJobs = new Map(); // picture URL -> { url, pkgPath, tex, out, maxWidth }
const urgent = [], idle = [];
const openPkgs = new Map(); // package path -> Promise<package>
let pumping = false, prefetchTimer = 0;

export const isLazyImage = url => lazyJobs.has(url);

// Decodes the picture behind url (if it's one of ours); resolves true once its JPG
// exists. el: the <img> waiting for it (pictures on screen are decoded first).
export function lazyImage(url, now = true, el = null) {
  const job = lazyJobs.get(url);
  if (!job) return Promise.resolve(false);
  if (el) (job.els ||= new Set()).add(el);
  if (!job.promise) {
    job.promise = new Promise(resolve => { job.resolve = resolve; });
    (now ? urgent : idle).push(job);
  } else if (now && idle.includes(job)) {
    idle.splice(idle.indexOf(job), 1); urgent.push(job);
  }
  pump();
  return job.promise;
}

// Is one of the job's <img>s inside its scrolling list's visible area?
function onScreen(job) {
  for (const el of job.els || []) {
    if (!el.isConnected) continue;
    const r = el.getBoundingClientRect();
    const box = el.closest('.qd-grid, .mods-cars .grid, .view')?.getBoundingClientRect() || { top: 0, bottom: innerHeight };
    if (r.height && r.bottom > Math.max(0, box.top) && r.top < Math.min(innerHeight, box.bottom)) return true;
  }
  return false;
}

async function pump() {
  if (pumping) return;
  pumping = true;
  while (urgent.length || idle.length) {
    const i = urgent.findIndex(onScreen);
    const job = i >= 0 ? urgent.splice(i, 1)[0] : urgent.shift() || idle.shift();
    let ok = false;
    try {
      if (await exists(job.out)) { job.resolve(true); continue; } // decoded on an earlier run
      if (!openPkgs.has(job.pkgPath)) openPkgs.set(job.pkgPath, openPackage(job.pkgPath));
      const pkg = await openPkgs.get(job.pkgPath), e = pkg?.get(job.tex);
      ok = !!e && await saveTexture(pkg, e, job.out, job.maxWidth);
    } catch (err) { log(`picture ${job.tex}: ${err?.message || err}`); }
    job.resolve(ok);
    // Background work yields between pictures so scrolling stays smooth.
    if (!urgent.length) await new Promise(r => setTimeout(r, 60));
  }
  pumping = false;
}

function catalogWithPaths(cat, dir, pkgPath) {
  const p = f => f ? join(dir, f) : '';
  const lazy = (file, tex, maxWidth) => {
    const out = p(file), url = fileUrl(out);
    if (tex && url && !lazyJobs.has(url)) lazyJobs.set(url, { url, pkgPath, tex, out, maxWidth });
    return out;
  };
  const out = {
    tracks: cat.tracks.map(t => ({ ...t, layouts: t.layouts.map(l => ({ ...l, image: lazy(l.image, l.tex, 1000), map: p(l.map) })) })),
    cars: cat.cars.map(c => ({ ...c, image: lazy(c.image, c.tex, 1024) })),
  };
  // Whatever hasn't been shown yet is decoded in the background, a moment later.
  clearTimeout(prefetchTimer);
  prefetchTimer = setTimeout(() => { for (const url of lazyJobs.keys()) lazyImage(url, false); }, 2500);
  return out;
}

export async function readEvoCatalog(contentPath, cacheDir, onProgress = () => {}) {
  const st = await Neutralino.filesystem.getStats(contentPath);
  const key = `base-${st.size}-${Math.floor(st.modifiedAt)}-${BASE_VERSION}`;
  const baseDir = join(cacheDir, 'base'), dir = join(baseDir, key);
  const manifestPath = join(dir, 'catalog.json');
  const cached = await readText(manifestPath);
  if (cached) { try { return catalogWithPaths(JSON.parse(cached), dir, contentPath); } catch { /* rebuild */ } }

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
  openPkgs.set(contentPath, Promise.resolve(pkg)); // reused for the pictures

  const table = async name => { const e = pkg.get(name); return e ? protoFields(await pkg.read(e)) : []; };
  const rows = (t, inner) => msgs(t, 2).flatMap(m => msgs(m, 3)).flatMap(m => msgs(m, inner));

  const cars = rows(await table('system\\cars.table'), 1).map(c => ({
    id: str(c, 1), name: str(c, 4), year: num(c, 5) || '', brand: str(c, 10), image: '',
  })).filter(c => c.id && c.name);

  // Track containers describe each layout per game mode: Practice uses the
  // "Time Attack" container (flag field 6), Race and Race Weekend the "Race" one
  // (flag field 5). Each carries the track_item values the game mode saves need
  // (container name, max drivers, length). The "Hotstint" one (flag field 7, one
  // driver) has a single spawn point on track before the line, for a flying lap;
  // EVO's menus don't offer it, the Academy's time trials use it (`hotstint`).
  // The Driving Academy's containers (is_a_to_b, field 13: "Academy R1-1"…) put a
  // start arch with lights and a finish arch on the layout; a layout can have
  // several (`arches`).
  const containers = { practice: new Map(), race: new Map(), hotstint: new Map() }, arches = new Map();
  for (const c of rows(await table('system\\track_containers.table'), 8)) {
    const mode = num(c, 6) === 1 ? 'practice' : num(c, 5) === 1 ? 'race' : num(c, 7) === 1 ? 'hotstint' : num(c, 13) === 1 ? 'arch' : '';
    const venue = str(c, 10), layout = str(c, 14);
    if (!mode || !venue || !layout) continue;
    const item = { layoutName: layout, container: str(c, 1), maxDrivers: num(c, 9) ?? 0, length: num(c, 8) ?? 0 }, at = `${slug(venue)}|${slug(layout)}`;
    if (mode === 'arch') arches.set(at, [...(arches.get(at) || []), item]);
    else containers[mode].set(at, mode === 'hotstint' ? { ...item, scenes: strs(c, 11) } : item);
  }
  // A Hotstint container is kept only when its start spot is a grid spot (the race
  // starts the car there), a pit spot and a box: EVO gives the car a pit slot as it
  // creates it and crashes without one (Oulton Park's is a grid spot only; Laguna
  // Seca's and Brands Hatch's are all three; tested 2026-10-14).
  for (const [at, item] of containers.hotstint) {
    const scene = item.scenes.find(p => /hotlap/i.test(p.split('\\').pop()));
    const e = scene && pkg.get(scene);
    const types = e ? spawnTypes(protoFields(await pkg.read(e))) : [];
    delete item.scenes;
    if (![SPAWN_GRID, SPAWN_PIT, SPAWN_BOX].every(t => types.includes(t))) containers.hotstint.delete(at);
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
        return { id, name: (practice || race)?.layoutName || layoutName(id), file, practice, race, hotstint: containers.hotstint.get(`${s}|${id}`) || null, arches: arches.get(`${s}|${id}`) || [] };
      }).sort((a, b) => a.name.localeCompare(b.name)),
    };
  });

  // Pictures: only their textures are noted here (decoded when shown, see lazyImage).
  for (const c of cars) {
    const tex = pkg.find(new RegExp(`^content\\\\cars\\\\${c.id}\\\\generated\\\\thumbnails\\\\[^\\\\]+\\.texture$`, 'i'))
      .sort((a, b) => a.name.split('-').pop().localeCompare(b.name.split('-').pop(), undefined, { numeric: true }))[0];
    if (tex) { c.tex = tex.name; c.image = `car-${c.id}.jpg`; }
  }
  // Track maps are small SVGs, copied out now.
  const jobs = tracks.flatMap(t => t.layouts.map(l => async () => {
    const tex = pkg.get(`uiresources\\images\\tracks\\${l.file}.texture`);
    if (tex) { l.tex = tex.name; l.image = `track-${l.file}.jpg`; }
    const svg = pkg.get(`uiresources\\images\\trackmaps\\${l.file}.svg`);
    if (svg) {
      const mapOut = `map-${l.file}.svg`;
      if (!(await exists(join(dir, mapOut)))) await Neutralino.filesystem.writeBinaryFile(join(dir, mapOut), (await pkg.read(svg)).slice().buffer);
      l.map = mapOut;
    }
    delete l.file;
  }));
  let done = 0;
  await mapLimit(jobs, 4, async job => { await job(); onProgress(++done, jobs.length, 'Reading official cars and tracks…'); });

  const catalog = { cars: cars.filter(c => c.tex), tracks: tracks.filter(t => t.layouts.length) };
  await writeText(manifestPath, JSON.stringify(catalog));
  return catalogWithPaths(catalog, dir, contentPath);
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
// cachedOnly: only what's already in the cache (nothing is decoded; missing ones are left out).
export async function readEvoExtras({ liveries = [], brands = [], contentPkg = '', cachedOnly = false }, cacheDir, onProgress = () => {}) {
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

  // A mod's livery pictures are framed like the game's (frameCar); ones framed
  // differently, or not at all, are made again.
  const isMod = r => r.pkgPath !== contentPkg;
  const ready = r => { const e = index.liveries[liveryKey(r)]; return !!e && (!isMod(r) || e.framing === FRAMING); };
  // Group missing work by package so each package's table is read once.
  const todo = new Map(); // pkgPath -> { liveries: [], brands: [] }
  const job = p => todo.get(p) || todo.set(p, { liveries: [], brands: [] }).get(p);
  if (!cachedOnly) {
    for (const r of liveries) if (r.pkgPath && !ready(r)) job(r.pkgPath).liveries.push(r);
    for (const b of brands) if (contentPkg && !(brandSlug(b) in index.brands)) job(contentPkg).brands.push(b);
  }

  for (const [pkgPath, work] of todo) {
    onProgress(`Reading ${basename(pkgPath)}…`);
    let pkg = null;
    try { pkg = await openPackage(pkgPath); } catch (err) { log(`extras: ${pkgPath}: ${err?.message || err}`); }
    for (const r of work.liveries) {
      const key = liveryKey(r), mod = isMod(r);
      let entry = { image: '', label: '', ...(mod ? { framing: FRAMING } : {}) };
      if (pkg) {
        const base = `content\\cars\\${r.carId}\\`;
        // Some combinations have no thumbnail of their own; any mech with the same visual looks the same.
        const exact = pkg.get(`${base}generated\\thumbnails\\${r.carId}-${r.mech}-${r.visual}.texture`);
        const tex = (exact?.size > 20 ? exact : null) || pkg.find(new RegExp(`^content\\\\cars\\\\${r.carId}\\\\generated\\\\thumbnails\\\\[^\\\\]+-${r.visual}\\.texture$`, 'i')).find(e => e.size > 20);
        if (tex) {
          try { const file = mod ? `livery-${key}-f${FRAMING}.jpg` : `livery-${key}.jpg`; await saveTexture(pkg, tex, join(dir, file), 512, mod); entry.image = file; }
          catch (err) { log(`extras: livery thumb ${key}: ${err?.message || err}`); }
        }
        // The picture made before (another name) isn't needed any more.
        const before = index.liveries[key]?.image;
        if (before && before !== entry.image) await Neutralino.filesystem.remove(join(dir, before)).catch(() => {});
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
    liveries: Object.fromEntries(liveries.filter(r => cachedOnly ? ready(r) : liveryKey(r) in index.liveries).map(r => [liveryKey(r), { ...index.liveries[liveryKey(r)], image: abs(index.liveries[liveryKey(r)].image) }])),
    brands: Object.fromEntries(brands.filter(b => brandSlug(b) in index.brands).map(b => [brandSlug(b), abs(index.brands[brandSlug(b)])])),
    liveryKey, brandSlug,
  };
}
