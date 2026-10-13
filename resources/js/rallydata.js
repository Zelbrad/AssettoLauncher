// Assetto Corsa Rally's own texts for its released stages and cars: in-game stage
// names, stage group names and descriptions, car descriptions and default livery
// names, per language, and the cars' pictures. tools/rally-data.py builds resources/data/rally-game.json
// from the game's files (they're Oodle-compressed, so it can't be done here).
// The launcher ships that file and, at startup, fetches it from GitHub when it
// changed (one ETag request), so a Rally update's names arrive without a launcher
// update. Whichever copy is newer ("updated") is used.
import { lang } from './i18n.js';
import { join, readText, writeText, run, log, CURL } from './util.js';

const REMOTE = 'https://raw.githubusercontent.com/tawndelli/AssettoLauncher/main/resources/data/rally-game.json';
const RAW = REMOTE.slice(0, REMOTE.indexOf('/resources/') + '/resources/'.length);
let data = { updated: '', groups: {}, stages: {}, cars: {} };
const valid = d => d && typeof d.updated === 'string' && d.groups && d.stages && d.cars;

// Car pictures this launcher ships (the ones its own copy of the file lists).
let shipped = new Set();

export async function loadRallyData(cacheDir) {
  const copies = [];
  try {
    const own = await (await fetch('/data/rally-game.json')).json();
    copies.push(own);
    shipped = new Set(Object.values(own?.cars || {}).map(c => c.picture).filter(Boolean));
  } catch (err) { log(`rally data: ${err?.message}`); }
  try { if (cacheDir) copies.push(JSON.parse(await readText(join(cacheDir, 'rally-game.json')) || 'null')); } catch { /* none cached */ }
  const best = copies.filter(valid).sort((a, b) => b.updated.localeCompare(a.updated))[0];
  if (best) data = best;
}

// True when GitHub had a newer file (now in use and cached).
export async function refreshRallyData(cacheDir) {
  const file = join(cacheDir, 'rally-game.json'), tmp = `${file}.new`, etag = join(cacheDir, 'rally-game.etag');
  const r = await run(`${CURL} -s -L --compressed --max-time 15 --etag-compare "${etag}" --etag-save "${etag}" -o "${tmp}" -w "%{http_code}" "${REMOTE}"`);
  if (r.stdOut.trim() !== '200') return false;
  let d = null;
  try { d = JSON.parse(await readText(tmp) || 'null'); } catch { /* not JSON */ }
  if (!valid(d) || d.updated <= data.updated) return false;
  await writeText(file, JSON.stringify(d));
  data = d;
  log(`rally data: updated to ${d.updated} (Rally build ${d.build || '?'})`);
  return true;
}

// The text in the launcher's language (pt-BR: the game has no Portuguese, so English).
const pick = t => (t && (t[lang] || t[lang.split('-')[0]] || t.en)) || '';
const carEntry = id => data.cars[id] || data.cars[Object.keys(data.cars).find(k => k.toLowerCase() === String(id).toLowerCase())];

export const rallyStageName = id => pick(data.stages[id]);
export const rallyGroupName = group => pick(data.groups[group]?.name);
export const rallyGroupText = group => pick(data.groups[group]?.description);
export const rallyCarText = id => ({ description: pick(carEntry(id)?.description), livery: pick(carEntry(id)?.livery) });
// The car's figures as Rally's car selection lists them, or null (an older data file):
// { year, cc, hp, nm, kg, engine, position, induction, drive: 'FWD'|'RWD'|'AWD', gears,
//   steering (the steering wheel's degrees lock to lock), powerRpm, torqueRpm }.
export const rallyCarSpecs = id => carEntry(id)?.specs || null;
// The car's picture from the game (its car-select one, transparent): the launcher's
// copy, or GitHub's for a car a newer data file lists before this launcher ships it;
// '' when the game has none.
export function rallyCarPicture(id) {
  const p = carEntry(id)?.picture;
  return !p ? '' : shipped.has(p) ? `/${p}` : RAW + p;
}
// Car Setup labels: kind 'groups' ("Dampers"), 'positions' ("Front Left") or 'settings' ("Front Bias").
export const rallySetupText = (kind, id) => pick(data.setup?.[kind]?.[id]);
// The AI's time for a car on a stage variant, in ms (0 when the game has none): the
// Academy's reference time.
export const rallyAiTime = (stage, car) => {
  const t = data.ai?.[stage];
  return (t && (t[car] ?? t[Object.keys(t).find(k => k.toLowerCase() === String(car).toLowerCase())])) || 0;
};

// A stage's map (the whole stage in white, the part driven in red) and its small
// thick-lined copy for Quick Drive's buttons: { map, chip } as paths the launcher
// serves, each with a GitHub copy for stages a newer data file lists before this
// launcher ships their pictures; {} when none.
export function rallyStageMedia(id) {
  const m = data.media?.[id];
  if (!m) return {};
  return { map: `/${m.map}`, mapRemote: RAW + m.map, chip: m.chip && `/${m.chip}`, chipRemote: m.chip && RAW + m.chip };
}
