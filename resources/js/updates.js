// Mod update checks through Content Manager's update registry (CUP, acstuff.club),
// where AC mod authors publish their latest versions:
//   GET /cup/list                -> { car: { <id>: "1.2" | { version, limited } }, track: {...}, ... }
//   GET /cup/<car|track>/<id>    -> { version, changelog, author, ... }
//   GET /cup/<car|track>/<id>/get   redirects to the download (or info) page
// Only AC content is registered there; EVO, ACC and Rally mods have no registry.
import { run, log } from './util.js';

const CUP = 'https://acstuff.club/cup';
let list = null, fetchedAt = 0;

async function curlJson(url) {
  const r = await run(`curl.exe -s -L --max-time 20 "${url}"`);
  if (r.exitCode !== 0 || !r.stdOut) return null;
  try { return JSON.parse(r.stdOut); } catch { return null; }
}

// Whether version a is newer than b ("1.10" > "1.9"; missing parts count as 0).
export function newer(a, b) {
  const x = String(a).split(/[^0-9]+/).filter(Boolean).map(Number), y = String(b).split(/[^0-9]+/).filter(Boolean).map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}

// Marks AC mods (cars/tracks) that have a newer version in the registry with
// item.update = { version, limited, get }. Returns how many; the list is cached for 6 hours.
export async function acUpdates(items) {
  if (!list || Date.now() - fetchedAt > 6 * 3600e3) {
    const fresh = await curlJson(`${CUP}/list`);
    if (fresh?.car) { list = fresh; fetchedAt = Date.now(); } else log('cup: list unavailable');
  }
  if (!list) return 0;
  let n = 0;
  for (const i of items) {
    if (!i.isMod || (i.kind !== 'car' && i.kind !== 'track') || !i.version) continue;
    const e = list[i.kind]?.[i.id], version = typeof e === 'object' ? e?.version : e;
    if (version && newer(version, i.version)) {
      i.update = { version, limited: !!e?.limited, get: `${CUP}/${i.kind}/${encodeURIComponent(i.id)}/get` };
      n++;
    }
  }
  return n;
}

export const cupDetails = (kind, id) => curlJson(`${CUP}/${kind}/${encodeURIComponent(id)}`);
