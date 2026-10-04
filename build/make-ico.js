// Packs PNG files (one per size) into a Windows .ico (PNG-compressed entries).
// usage: node make-ico.js out.ico 16.png 24.png ... 256.png
const fs = require('fs');
const [out, ...pngs] = process.argv.slice(2);
const imgs = pngs.map(p => fs.readFileSync(p));
const header = Buffer.alloc(6 + 16 * imgs.length);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(imgs.length, 4);
let offset = header.length;
imgs.forEach((img, i) => {
  const w = img.readUInt32BE(16), h = img.readUInt32BE(20), e = 6 + 16 * i;
  header[e] = w >= 256 ? 0 : w; header[e + 1] = h >= 256 ? 0 : h;
  header.writeUInt16LE(1, e + 4); header.writeUInt16LE(32, e + 6);
  header.writeUInt32LE(img.length, e + 8); header.writeUInt32LE(offset, e + 12);
  offset += img.length;
});
fs.writeFileSync(out, Buffer.concat([header, ...imgs]));
console.log(`${out}: ${imgs.length} sizes, ${offset} bytes`);
