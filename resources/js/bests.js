// Personal bests, read from what each game records itself:
//   AC     Documents\Assetto Corsa\personalbest.ini: [CAR@TRACK] or [CAR@TRACK-LAYOUT]
//          (upper case ids) with TIME (ms) and DATE (epoch ms)
//   EVO    Saved Games\ACE\Results\<yymmdd-hhmm…>.sessionresults.json: per driver
//          best_lap ("m:ss.mmm"), by display names of track, layout and car
//   Rally  the stage records in its save (see rallyBests in rallylaunch.js)
// ACC keeps no lap history outside its encrypted data, so it has none.
// Each returns Map<key, { ms, at }>, keyed so Quick Drive can look up its selection.
import { join, listDir, readText, log } from './util.js';

const up = p => p.replace(/\/[^/]+$/, '');

export const lapTime = ms => {
  const m = Math.floor(ms / 60000), s = ((ms % 60000) / 1000).toFixed(3).padStart(6, '0');
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${s}` : `${m}:${s}`;
};

export const acBestKey = (car, track, layout) => `${car}@${track}${layout ? `-${layout}` : ''}`.toUpperCase();

export async function acBests(paths) {
  const out = new Map();
  const ini = await readText(join(up(paths.ac.cfg), 'personalbest.ini'));
  for (const m of (ini || '').matchAll(/^\[([^\]]+)\]([^[]*)/gm)) {
    const time = Number(/^TIME=(\d+)/m.exec(m[2])?.[1]), date = Number(/^DATE=(\d+)/m.exec(m[2])?.[1]);
    if (time > 0) out.set(m[1].toUpperCase(), { ms: time, at: date || 0 });
  }
  return out;
}

// EVO names: lower case, no accents or punctuation; layouts without the
// " Time Attack" / " Race" suffix of their session version.
const simple = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const simpleLayout = s => simple(s).replace(/ (time attack|race)$/, '');
export const evoBestKey = (track, layout, car) => `${simple(track)}|${simpleLayout(layout)}|${simple(car)}`;

const parseLap = t => {
  const parts = String(t || '').split(':').map(Number);
  if (!parts.length || parts.some(n => !Number.isFinite(n))) return 0;
  return Math.round(parts.reduce((acc, n) => acc * 60 + n, 0) * 1000);
};

export async function evoBests(paths) {
  const dir = join(up(paths.evo.profiles), 'Results');
  const files = (await listDir(dir)).filter(e => /\.sessionresults\.json$/i.test(e.entry));
  const sessions = [];
  for (const f of files) {
    try { sessions.push({ name: f.entry, ...JSON.parse(await readText(join(dir, f.entry))) }); } catch { /* unreadable */ }
  }
  // The player: drivers EVO flags as current; some results don't flag anyone,
  // so the same name counts too.
  const name = d => `${d.driver_name || ''} ${d.driver_surname || ''}`.trim();
  const me = new Set(sessions.flatMap(s => (s.drivers || []).filter(d => d.is_current_driver).map(name)));
  const out = new Map();
  for (const s of sessions) {
    const m = /^(\d{2})(\d{2})(\d{2})-(\d{2})(\d{2})/.exec(s.name);
    const at = m ? new Date(2000 + Number(m[1]), m[2] - 1, Number(m[3]), Number(m[4]), Number(m[5])).getTime() : 0;
    for (const d of s.drivers || []) {
      const ms = parseLap(d.best_lap);
      if (!ms || !(d.is_current_driver || me.has(name(d)))) continue;
      const key = evoBestKey(s.track, s.layout, d.car_name);
      if (!out.has(key) || ms < out.get(key).ms) out.set(key, { ms, at, track: s.track, layout: s.layout, car: d.car_name });
    }
  }
  log(`evo bests: ${out.size} from ${sessions.length} results`);
  return out;
}
