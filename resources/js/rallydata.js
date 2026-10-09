// Assetto Corsa Rally's own texts for its released stages and cars: in-game stage
// names, stage group names and descriptions, car descriptions and default livery
// names, per language. tools/rally-data.py builds resources/data/rally-game.json
// from the game's files (they're Oodle-compressed, so it can't be done here).
// The launcher ships that file and, at startup, fetches it from GitHub when it
// changed (one ETag request), so a Rally update's names arrive without a launcher
// update. Whichever copy is newer ("updated") is used.
import { lang } from './i18n.js';
import { join, readText, writeText, run, log, CURL } from './util.js';

const REMOTE = 'https://raw.githubusercontent.com/Zelbrad/AssettoLauncher/main/resources/data/rally-game.json';
let data = { updated: '', groups: {}, stages: {}, cars: {} };
const valid = d => d && typeof d.updated === 'string' && d.groups && d.stages && d.cars;

export async function loadRallyData(cacheDir) {
  const copies = [];
  try { copies.push(await (await fetch('/data/rally-game.json')).json()); } catch (err) { log(`rally data: ${err?.message}`); }
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

// A stage's map (the whole stage in white, the part driven in red) and its small
// thick-lined copy for Quick Drive's buttons: { map, chip } as paths the launcher
// serves, each with a GitHub copy for stages a newer data file lists before this
// launcher ships their pictures; {} when none.
const RAW = REMOTE.slice(0, REMOTE.indexOf('/resources/') + '/resources/'.length);
export function rallyStageMedia(id) {
  const m = data.media?.[id];
  if (!m) return {};
  return { map: `/${m.map}`, mapRemote: RAW + m.map, chip: m.chip && `/${m.chip}`, chipRemote: m.chip && RAW + m.chip };
}
