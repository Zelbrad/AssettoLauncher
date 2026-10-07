// Which Rally car a custom livery was painted for, from its design. Rally ships a
// template for every car (acr\Content\LiveryTemplates\<Car>\<Car>_Body.png: the
// car's UV layout as a wireframe), and a livery's body texture follows that layout.
// Both are reduced to a 256x256 grid: the template to the cells its panels cover,
// the livery to its edges and to what differs from its background colour. For each
// car, the detail inside its panels is compared with the detail outside them; the
// right car's ratio is far ahead (2-30x on the liveries tried). The guess is "sure"
// when both measures pick the same car and it leads the next one clearly.
// Templates are reduced once and cached (.cache/rally/livery-templates.json).
import { join, listDir, readText, writeText, log } from './util.js';
import { decodeBC7 } from './bc7.js';
import { appCacheDir } from './games.js';

const N = 256;
const SURE_LEAD = 1.5; // the winner's ratio over the next car's, on both measures
const CACHE_VERSION = 1;

// --- Templates

const toB64 = bits => btoa(String.fromCharCode(...bits));
const fromB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const packBits = mask => { const out = new Uint8Array(N * N / 8); mask.forEach((v, i) => { if (v) out[i >> 3] |= 1 << (i & 7); }); return out; };
const unpackBits = bits => Uint8Array.from({ length: N * N }, (_, i) => (bits[i >> 3] >> (i & 7)) & 1);

// The cells of a template that hold any panel line (max over the cell), widened by one.
async function templateMask(file) {
  const blob = new Blob([await Neutralino.filesystem.readBinaryFile(file)], { type: 'image/png' });
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fail; i.src = url; });
    const w = img.naturalWidth, h = img.naturalHeight, cw = w / N, ch = h / N;
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = Math.ceil(ch) * 16; // a strip of 16 grid rows at a time
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const peak = new Uint8Array(N * N);
    for (let row0 = 0; row0 < N; row0 += 16) {
      const y0 = Math.floor(row0 * ch), sh = Math.min(h - y0, canvas.height);
      ctx.clearRect(0, 0, w, canvas.height);
      ctx.drawImage(img, 0, y0, w, sh, 0, 0, w, sh);
      const px = ctx.getImageData(0, 0, w, sh).data;
      for (let y = 0; y < sh; y++) {
        const gy = Math.min(N - 1, Math.floor((y0 + y) / ch));
        for (let x = 0; x < w; x++) {
          const o = (y * w + x) * 4, v = Math.max(px[o], px[o + 1], px[o + 2]), cell = gy * N + Math.min(N - 1, Math.floor(x / cw));
          if (v > peak[cell]) peak[cell] = v;
        }
      }
    }
    const mask = new Uint8Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      let on = 0;
      for (let dy = -1; dy <= 1 && !on; dy++) for (let dx = -1; dx <= 1 && !on; dx++) {
        const yy = y + dy, xx = x + dx;
        if (yy >= 0 && yy < N && xx >= 0 && xx < N && peak[yy * N + xx] > 24) on = 1;
      }
      mask[y * N + x] = on;
    }
    return mask;
  } finally { URL.revokeObjectURL(url); }
}

// Template folder names are the car ids, give or take ("HyundaiI20NRally2" is
// "Hyundaii20NRally2", "Peugeot306IIMaxi" is "Peugeot306IIMaxiKitCar").
const carOf = (folder, ids) => {
  const f = folder.toLowerCase();
  return ids.find(id => id.toLowerCase() === f) || ids.find(id => id.toLowerCase().startsWith(f) || f.startsWith(id.toLowerCase())) || '';
};

let templatesP = null;
async function templates(paths, ids) {
  if (templatesP) return templatesP;
  templatesP = (async () => {
    const dir = paths.rally.install && join(paths.rally.install, 'acr/Content/LiveryTemplates');
    if (!dir) return [];
    const cacheFile = join(await appCacheDir('rally'), 'livery-templates.json');
    let cache = {};
    try { const j = JSON.parse(await readText(cacheFile) || '{}'); if (j.v === CACHE_VERSION) cache = j.cars || {}; } catch { /* rebuild */ }
    const out = [];
    let changed = false;
    for (const e of await listDir(dir)) {
      if (e.type !== 'DIRECTORY' || e.entry === '.' || e.entry === '..') continue;
      const car = carOf(e.entry, ids);
      const file = join(dir, e.entry, `${e.entry}_Body.png`);
      const st = await Neutralino.filesystem.getStats(file).catch(() => null);
      if (!car || !st) continue;
      let c = cache[e.entry];
      if (!c || c.size !== st.size) {
        try { c = cache[e.entry] = { size: st.size, mask: toB64(packBits(await templateMask(file))) }; changed = true; }
        catch (err) { log(`livery template ${e.entry}: ${err?.message || err}`); continue; }
      }
      out.push({ car, mask: unpackBits(fromB64(c.mask)) });
    }
    if (changed) await writeText(cacheFile, JSON.stringify({ v: CACHE_VERSION, cars: cache }));
    return out;
  })().catch(err => { templatesP = null; throw err; });
  return templatesP;
}

// --- The livery's body texture, sampled at N x N (one texel per sampled block)

function sampleDds(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (buf.length < 148 || dv.getUint32(0, true) !== 0x20534444) return null; // "DDS "
  const h = dv.getUint32(12, true), w = dv.getUint32(16, true);
  const fourcc = String.fromCharCode(buf[84], buf[85], buf[86], buf[87]);
  let off = 128, kind = '';
  if (fourcc === 'DX10') {
    const f = dv.getUint32(128, true);
    off = 148;
    kind = f === 71 || f === 72 ? 'bc1' : f === 77 || f === 78 ? 'bc3' : f === 98 || f === 99 ? 'bc7' : '';
  } else kind = fourcc === 'DXT1' ? 'bc1' : fourcc === 'DXT5' || fourcc === 'DXT4' ? 'bc3' : '';
  if (!kind || w < N * 4 || h < N * 4) return null;
  const bs = kind === 'bc1' ? 8 : 16, bw = w >> 2, bh = h >> 2;
  if (off + bw * bh * bs > buf.length) return null;
  const rgb = new Uint8Array(N * N * 3);
  const c565 = c => [((c >> 11) & 31) * 255 / 31 | 0, ((c >> 5) & 63) * 255 / 63 | 0, (c & 31) * 255 / 31 | 0];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const b = off + (Math.floor(y * bh / N) * bw + Math.floor(x * bw / N)) * bs, o = (y * N + x) * 3;
    if (kind === 'bc7') { const px = decodeBC7(buf.subarray(b, b + 16), 4, 4); rgb[o] = px[0]; rgb[o + 1] = px[1]; rgb[o + 2] = px[2]; continue; }
    const cb = kind === 'bc3' ? b + 8 : b; // BC3: alpha block first
    const c0 = dv.getUint16(cb, true), c1 = dv.getUint16(cb + 2, true), i = buf[cb + 4] & 3;
    const p0 = c565(c0), p1 = c565(c1), threeColour = kind === 'bc1' && c0 <= c1;
    const c = i === 0 ? p0 : i === 1 ? p1
      : i === 2 ? p0.map((v, k) => (threeColour ? (v + p1[k]) / 2 : (2 * v + p1[k]) / 3) | 0)
      : threeColour ? [0, 0, 0] : p0.map((v, k) => (v + 2 * p1[k]) / 3 | 0);
    rgb[o] = c[0]; rgb[o + 1] = c[1]; rgb[o + 2] = c[2];
  }
  return rgb;
}

// Edges (colour change to the right and below) and "not the background colour".
function features(rgb) {
  const E = new Float32Array(N * N), NB = new Uint8Array(N * N);
  for (let y = 0; y < N - 1; y++) for (let x = 0; x < N - 1; x++) {
    const i = y * N + x;
    let e = 0;
    for (let k = 0; k < 3; k++) e += Math.abs(rgb[i * 3 + k] - rgb[(i + 1) * 3 + k]) + Math.abs(rgb[i * 3 + k] - rgb[(i + N) * 3 + k]);
    E[i] = e;
  }
  const q = i => ((rgb[i * 3] >> 4) << 8) | ((rgb[i * 3 + 1] >> 4) << 4) | (rgb[i * 3 + 2] >> 4);
  const hist = new Uint32Array(4096);
  for (let i = 0; i < N * N; i++) hist[q(i)]++;
  const bg = hist.indexOf(Math.max(...hist));
  for (let i = 0; i < N * N; i++) NB[i] = q(i) !== bg ? 1 : 0;
  return { E, NB };
}

function score({ E, NB }, mask) {
  let ein = 0, eout = 0, bin = 0, bout = 0, nin = 0;
  for (let i = 0; i < N * N; i++) {
    if (mask[i]) { ein += E[i]; bin += NB[i]; nin++; } else { eout += E[i]; bout += NB[i]; }
  }
  const nout = N * N - nin;
  return {
    edges: (ein / Math.max(1, nin) + 1) / (eout / Math.max(1, nout) + 1),
    design: (bin / Math.max(1, nin) + 0.01) / (bout / Math.max(1, nout) + 0.01),
  };
}

// dir: a livery folder (body_livery_albedo.dds); ids: the game's car ids.
// -> { car, sure, likely: [car ids, best first] } or null (no template or texture).
export async function guessLiveryCar(dir, paths, ids) {
  const tex = (await listDir(dir)).find(e => /^body_livery_albedo\.dds$/i.test(e.entry));
  if (!tex) return null;
  const tpls = await templates(paths, ids);
  if (tpls.length < 2) return null;
  const rgb = sampleDds(new Uint8Array(await Neutralino.filesystem.readBinaryFile(join(dir, tex.entry))));
  if (!rgb) return null;
  const f = features(rgb);
  const rows = tpls.map(t => ({ car: t.car, ...score(f, t.mask) }));
  const by = k => [...rows].sort((a, b) => b[k] - a[k]);
  const [e1, e2] = by('edges'), [d1, d2] = by('design');
  const sure = e1.car === d1.car && e1.edges >= SURE_LEAD * e2.edges && d1.design >= SURE_LEAD * d2.design;
  const likely = [...new Set([e1.car, d1.car, ...by('edges').map(r => r.car).slice(0, 3)])].slice(0, 3);
  log(`livery car ${dir.split('/').pop()}: ${sure ? 'sure' : 'unsure'} ${e1.car} (edges ${e1.edges.toFixed(2)} vs ${e2.edges.toFixed(2)} ${e2.car}; design ${d1.design.toFixed(2)} ${d1.car} vs ${d2.design.toFixed(2)} ${d2.car})`);
  return { car: e1.car === d1.car ? e1.car : '', sure, likely };
}
