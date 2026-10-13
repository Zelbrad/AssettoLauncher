// What an Assetto Corsa car's ui file doesn't say, from its physics data: which
// wheels are driven (drivetrain.ini [TRACTION] TYPE) and how far it steers
// (car.ini [CONTROLS] STEER_LOCK: the steering wheel's degrees to one side;
// STEER_RATIO: the wheel's degrees per degree at the front wheels). Read only.
// The data is the car's data\ folder or, for most cars, data.acd: a pack of
//   [int32 -1111, int32]   (newer packs only)
//   per file: int32 name length, name, int32 size, then one int32 per byte:
//   the byte plus a character of a key made from the car's folder name
// (Content Manager's AcdEncryption). Only the two files wanted are read, by
// stepping over the others; the figures are kept (storage) until the data changes.
import { join, readText, mapLimit, storageGet, storageSet, log } from './util.js';
import { parseIni } from './ini.js';

const STORE = 'ac_car_data';

// The pack's key: eight numbers worked out from the folder name (32-bit, as the game does).
export function acdKey(folder) {
  const s = [...folder.toLowerCase()].map(c => c.charCodeAt(0)), n = s.length;
  let a = 0; for (const c of s) a = (a + c) | 0;
  let b = 0; for (let i = 0; i < n - 1; i += 2) b = (Math.imul(s[i], b) - s[i + 1]) | 0;
  let c = 0; for (let i = 1; i < n - 3; i += 3) c = (-0x1b - s[i - 1] + Math.trunc(Math.imul(s[i], c) / (s[i + 1] + 0x1b))) | 0;
  let d = 0x1683; for (let i = 1; i < n; i++) d = (d - s[i]) | 0;
  let e = 0x42; for (let i = 1; i < n - 4; i += 4) e = (Math.imul(s[i - 1] + 0xf, Math.imul(s[i] + 0xf, e)) + 0x16) | 0;
  let f = 0x65; for (let i = 0; i < n - 2; i += 2) f = (f - s[i]) | 0;
  let g = 0xab; for (let i = 0; i < n - 2; i += 2) g %= s[i];
  let h = 0xab; for (let i = 0; i < n - 1; i++) h = (Math.trunc(h / s[i]) + s[i + 1]) | 0;
  return [a, b, c, d, e, f, g, h].map(x => x & 0xff).join('-');
}

// The text of the wanted files (lower-case names) of a data.acd of `size` bytes.
async function acdTexts(file, size, folder, want) {
  const key = acdKey(folder), out = {};
  const read = async (pos, n) => new Uint8Array(await Neutralino.filesystem.readBinaryFile(file, { pos, size: Math.max(0, Math.min(n, size - pos)) }));
  let p = size >= 8 && new DataView((await read(0, 8)).buffer).getInt32(0, true) === -1111 ? 8 : 0;
  while (p + 8 <= size && Object.keys(out).length < want.length) {
    const b = await read(p, 300), dv = new DataView(b.buffer);
    const nameLen = dv.getInt32(0, true);
    if (nameLen <= 0 || 8 + nameLen > b.length) break;
    const name = String.fromCharCode(...b.subarray(4, 4 + nameLen)).toLowerCase(), len = dv.getInt32(4 + nameLen, true);
    if (len < 0) break;
    p += 8 + nameLen;
    if (want.includes(name) && p + len * 4 <= size) {
      const d = await read(p, len * 4);
      let text = '';
      for (let i = 0; i < len; i++) text += String.fromCharCode((d[i * 4] - key.charCodeAt(i % key.length)) & 0xff);
      out[name] = text;
    }
    p += len * 4;
  }
  return out;
}

// { drive: 'FWD' | 'RWD' | 'AWD' | '', lock, ratio, angle } (angle: the front wheels'
// most, in degrees, as lock / ratio; 0 when unknown).
function figures(carIni, drivetrainIni) {
  const controls = parseIni(carIni || '').CONTROLS || {}, type = String(parseIni(drivetrainIni || '').TRACTION?.TYPE || '').trim().toUpperCase();
  const lock = parseFloat(controls.STEER_LOCK) || 0, ratio = Math.abs(parseFloat(controls.STEER_RATIO)) || 0;
  return {
    drive: /^AWD/.test(type) ? 'AWD' : /^(FWD|RWD)/.test(type) ? type.slice(0, 3) : '',
    lock, ratio, angle: lock && ratio ? Math.round(lock / ratio) : 0,
  };
}

// Fills item.mech for AC cars (items of scanAcCars) that don't have it yet; null
// when a car's data can't be read. Resolves to how many were filled.
export async function loadAcCarData(items) {
  const todo = items.filter(i => i.game === 'ac' && i.kind === 'car' && i.mech === undefined && i.path);
  if (!todo.length) return 0;
  const kept = await storageGet(STORE, {});
  let fresh = 0;
  await mapLimit(todo, 4, async i => {
    i.mech = null;
    try {
      const acd = join(i.path, 'data.acd');
      const st = await Neutralino.filesystem.getStats(acd).catch(() => null);
      const stamp = st ? `${st.size}:${st.modifiedAt}` : `dir:${(await Neutralino.filesystem.getStats(join(i.path, 'data/car.ini')).catch(() => null))?.modifiedAt || ''}`;
      if (kept[i.id]?.stamp === stamp) { i.mech = kept[i.id].mech; return; }
      if (st) {
        const t = await acdTexts(acd, st.size, i.id, ['car.ini', 'drivetrain.ini']);
        i.mech = figures(t['car.ini'], t['drivetrain.ini']);
      } else {
        i.mech = figures(await readText(join(i.path, 'data/car.ini')), await readText(join(i.path, 'data/drivetrain.ini')));
      }
      kept[i.id] = { stamp, mech: i.mech };
      fresh++;
    } catch (err) { log(`car data ${i.id}: ${err?.message || JSON.stringify(err)}`); }
  });
  if (fresh) { await storageSet(STORE, kept); log(`car data: read ${fresh} of ${todo.length} cars`); }
  return todo.length;
}

// The tags a car's figures give it on the Mods page: 'fwd' | 'rwd' | 'awd' and
// its steering angle's band.
export const STEER_BANDS = ['steering under 20°', 'steering 20–30°', 'steering 30–40°', 'steering 40–50°', 'steering 50°+'];
// Rally gives the steering wheel's turn lock to lock instead (m.rotation, main.js decorateRally).
export const WHEEL_BANDS = ['steering wheel under 600°', 'steering wheel 600–900°', 'steering wheel over 900°'];
export const MECH_TAGS = ['fwd', 'rwd', 'awd', ...STEER_BANDS, ...WHEEL_BANDS];
export function mechTags(item) {
  const m = item.mech;
  if (!m) return [];
  return [
    m.drive.toLowerCase(),
    m.angle ? STEER_BANDS[Math.max(0, Math.min(4, Math.floor(m.angle / 10) - 1))] : '',
    m.rotation ? WHEEL_BANDS[m.rotation < 600 ? 0 : m.rotation <= 900 ? 1 : 2] : '',
  ].filter(Boolean);
}
