// Thumbnails from DDS textures (BC1, BC2, BC3 and uncompressed 32-bit). Each
// 4x4 block becomes one averaged pixel, so a 4096² texture is reduced to 1024²
// without decoding every texel, then scaled down on a canvas. Alpha is ignored.

const FOURCC = { DXT1: 'bc1', DXT2: 'bc2', DXT3: 'bc2', DXT4: 'bc3', DXT5: 'bc3' };
const DXGI = {
  70: 'bc1', 71: 'bc1', 72: 'bc1', 73: 'bc2', 74: 'bc2', 75: 'bc2', 76: 'bc3', 77: 'bc3', 78: 'bc3',
  27: 'rgba', 28: 'rgba', 29: 'rgba', 87: 'bgra', 88: 'bgra', 90: 'bgra', 91: 'bgra',
};

// RGBA pixels at a quarter of the texture's size: { rgba, width, height }.
function reduce(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (buf.length < 128 || dv.getUint32(0, true) !== 0x20534444) throw new Error('not a DDS file');
  const h = dv.getUint32(12, true), w = dv.getUint32(16, true);
  const fourcc = String.fromCharCode(...buf.subarray(84, 88));
  let fmt = FOURCC[fourcc], off = 128;
  if (fourcc === 'DX10') { fmt = DXGI[dv.getUint32(128, true)]; off = 148; }
  else if (!fmt && dv.getUint32(88, true) === 32) fmt = dv.getUint32(92, true) === 0xff0000 ? 'bgra' : 'rgba';
  if (!fmt) throw new Error(`unsupported DDS format ${fourcc}`);

  const bw = Math.max(1, w >> 2), bh = Math.max(1, h >> 2);
  const out = new Uint8ClampedArray(bw * bh * 4);
  if (fmt === 'rgba' || fmt === 'bgra') {
    if (off + w * h * 4 > buf.length) throw new Error('truncated DDS file');
    const [ri, bi] = fmt === 'rgba' ? [0, 2] : [2, 0];
    for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let y = by * 4; y < Math.min(h, by * 4 + 4); y++) for (let x = bx * 4; x < Math.min(w, bx * 4 + 4); x++) {
        const p = off + (y * w + x) * 4;
        r += buf[p + ri]; g += buf[p + 1]; b += buf[p + bi]; n++;
      }
      const q = (by * bw + bx) * 4;
      out[q] = r / n; out[q + 1] = g / n; out[q + 2] = b / n; out[q + 3] = 255;
    }
    return { rgba: out, width: bw, height: bh };
  }

  // Block formats: the colour part is two RGB565 endpoints + 2-bit indices.
  const size = fmt === 'bc1' ? 8 : 16, co = fmt === 'bc1' ? 0 : 8;
  if (off + bw * bh * size > buf.length) throw new Error('truncated DDS file');
  const counts = new Uint8Array(4);
  for (let i = 0, n = bw * bh; i < n; i++) {
    const o = off + i * size + co;
    const c0 = buf[o] | (buf[o + 1] << 8), c1 = buf[o + 2] | (buf[o + 3] << 8);
    const r0 = ((c0 >> 11) & 31) * 255 / 31, g0 = ((c0 >> 5) & 63) * 255 / 63, b0 = (c0 & 31) * 255 / 31;
    const r1 = ((c1 >> 11) & 31) * 255 / 31, g1 = ((c1 >> 5) & 63) * 255 / 63, b1 = (c1 & 31) * 255 / 31;
    let bits = (buf[o + 4] | (buf[o + 5] << 8) | (buf[o + 6] << 16) | (buf[o + 7] << 24)) >>> 0;
    counts.fill(0);
    for (let t = 0; t < 16; t++, bits >>>= 2) counts[bits & 3]++;
    // Weight of each endpoint: palette 2 and 3 are 2/3–1/3 blends, or (BC1 with
    // c0 <= c1) the midpoint and black.
    let w0, w1;
    if (fmt !== 'bc1' || c0 > c1) { w0 = counts[0] + counts[2] * 2 / 3 + counts[3] / 3; w1 = counts[1] + counts[2] / 3 + counts[3] * 2 / 3; }
    else { w0 = counts[0] + counts[2] / 2; w1 = counts[1] + counts[2] / 2; }
    const q = i * 4;
    out[q] = (r0 * w0 + r1 * w1) / 16; out[q + 1] = (g0 * w0 + g1 * w1) / 16; out[q + 2] = (b0 * w0 + b1 * w1) / 16; out[q + 3] = 255;
  }
  return { rgba: out, width: bw, height: bh };
}

// JPEG bytes of the texture, fitted in size × size.
export async function ddsThumbnail(path, size = 512) {
  const img = reduce(new Uint8Array(await Neutralino.filesystem.readBinaryFile(path)));
  const src = document.createElement('canvas');
  src.width = img.width; src.height = img.height;
  src.getContext('2d').putImageData(new ImageData(img.rgba, img.width, img.height), 0, 0);
  const scale = Math.min(1, size / Math.max(img.width, img.height));
  const dst = document.createElement('canvas');
  dst.width = Math.round(img.width * scale); dst.height = Math.round(img.height * scale);
  const ctx = dst.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, dst.width, dst.height);
  const blob = await new Promise(r => dst.toBlob(r, 'image/jpeg', 0.9));
  return blob.arrayBuffer();
}
