// The Academy: events with bronze, silver and gold targets that the launcher sets
// up and starts, then marks from the game's own results when it closes. Only
// drives started from the Academy count, and progress is the launcher's own (the
// games' career saves are left alone).
//
// Assetto Corsa, "Original": Kunos's career and special events, run the way AC's
// launcher runs them (launcher\themes\default\modules\career2 and specialevents):
//   content\career\seriesN\series.ini  [SERIES] CODE, NAME, DESCRIPTION, REQUIRES
//       (series all needed; REQUIRESANY=1: one of them), POINTS (a championship's
//       points table); [GOALS] POINTS or RANKING (a championship) or TIER1..3 (how
//       many events need bronze, silver, gold: a better medal covers a lower one).
//       opponents.ini [AIn]: a championship's grid.
//   content\career\seriesN\eventN\event.ini  race.ini sections, plus [EVENT] NAME,
//       DESCRIPTION and [CONDITION_0..2] OBJECTIVE for bronze, silver, gold.
//       SESSION_0 TYPE says what's marked: 3 race (finishing position), 4 hotlap
//       (lap ms), 5 time attack and 6 drift (points), 7 drag (wins); practice,
//       qualifying and race make a race weekend. Championship rounds have no
//       conditions: they score from the series' points table.
//   content\specialevents\*\event.ini  the same; races are marked by the AI level
//       beaten (TYPE=AI: win at that level), some with a fourth, harder tier.
// Results: Documents\Assetto Corsa\out\race_out.json, written as AC closes:
//   sessions[] { type, lapsCount, laps[] { car, time, cuts }, lapstotal[] (laps per
//   car), raceResult[] (car indices in finishing order) }, extras[] { name:
//   bestlap | timeattack | drift | drag, time | points | wins }.
import { join, readText, readTextAnyEncoding, writeText, listDir, exists, fileUrl, mountDir, cleanText, storageGet, storageSet, mapLimit, log } from './util.js';
import { parseIni, setIni, removeSections } from './ini.js';
import { TEMPLATE, startAcs } from './quickdrive.js';
import { lapTime } from './bests.js';
import { EVO_LEVELS, EVO_UNLOCK, EVO_RELEASED, RALLY_LEVELS, RALLY_UNLOCK, RALLY_MARGINS, RALLY_PLATINUM, AC_CLASSES } from './academy-data.js';

// Platinum only on the time trials of the launcher's own levels (EVO and Rally):
// their goals have four targets, every other goal three.
export const TIERS = ['bronze', 'silver', 'gold', 'platinum'];

const num = (v, d = 0) => (v === undefined || v === '' || isNaN(Number(v)) ? d : Number(v));
const byNumber = (a, b) => num(a.replace(/\D+/g, '')) - num(b.replace(/\D+/g, ''));
const dirsIn = async path => (await listDir(path)).filter(e => e.type === 'DIRECTORY' && !e.entry.startsWith('.')).map(e => e.entry);
const fileDate = async path => { try { return (await Neutralino.filesystem.getStats(path)).modifiedAt || 0; } catch { return 0; } };

// ---------------------------------------------------------------------------
// Progress, in the launcher's storage:
//   events  { [event key]: { tier (0-4, 4 = platinum), best, last, at, tries } }
//   rounds  { [championship key]: [{ pos, points, at }] } in round order
//   table   { [championship key]: { [driver]: points } } the opponents' points
//   last    the event key started last (the Continue card)

let STORE = 'academy';
let progress = null;
// --check-academy keeps its made-up results out of the player's own.
export function useAcademyStore(name) { STORE = name; progress = null; }
export async function academyProgress() {
  if (!progress) {
    const p = await storageGet(STORE, null);
    progress = { events: {}, rounds: {}, table: {}, last: '', ...(p || {}) };
  }
  return progress;
}
async function saveProgress() { if (progress) await storageSet(STORE, progress); }

export const eventTier = (p, key) => p.events[key]?.tier || 0;

// ---------------------------------------------------------------------------
// Assetto Corsa's events

const SESSION_KIND = { 1: 'practice', 2: 'qualify', 3: 'race', 4: 'hotlap', 5: 'timeattack', 6: 'drift', 7: 'drag' };
// What each kind is marked by, when its conditions don't say (championship rounds).
const KIND_GOAL = { race: 'position', weekend: 'position', qualify: 'position', hotlap: 'time', timeattack: 'points', drift: 'points', drag: 'wins' };

function eventOf(ini, dir, key, group) {
  const sessions = Object.keys(ini).filter(k => /^SESSION_\d+$/.test(k)).sort(byNumber).map(k => ini[k]);
  if (!ini.RACE?.MODEL || !ini.RACE?.TRACK || !sessions.length) return null;
  const types = sessions.map(s => num(s.TYPE, 1));
  const kind = types.length > 1 && types.includes(3) ? 'weekend' : SESSION_KIND[types[0]] || 'practice';
  const race = sessions[types.lastIndexOf(3)];
  // AC reads every condition by the first one's type (later ones often leave it out).
  let conds = [0, 1, 2, 3].map(i => ini[`CONDITION_${i}`]).filter(c => c && c.OBJECTIVE !== undefined && c.OBJECTIVE !== '');
  if (conds.length > 3) conds = conds.slice(-3); // four AI tiers: the three hardest
  const type = (conds[0]?.TYPE || '').toLowerCase();
  return {
    key, game: 'ac', group, dir, ini,
    name: cleanText(ini.EVENT?.NAME) || key.split('/').pop(),
    description: cleanText(ini.EVENT?.DESCRIPTION || ''),
    image: fileUrl(join(dir, 'preview.png')),
    car: ini.RACE.MODEL, skin: ini.CAR_0?.SKIN || ini.RACE.SKIN || '',
    track: ini.RACE.TRACK, layout: ini.RACE.CONFIG_TRACK || '',
    kind,
    sessions: sessions.map((s, i) => ({ type: types[i], name: s.NAME || '', laps: num(s.LAPS), minutes: num(s.DURATION_MINUTES), start: num(s.STARTING_POSITION) })),
    laps: race ? num(race.LAPS, num(ini.RACE.RACE_LAPS)) : 0,
    start: race ? num(race.STARTING_POSITION) : 0,
    opponents: Math.max(0, num(ini.RACE.CARS, 1) - 1),
    aiLevel: num(ini.RACE.AI_LEVEL, 0),
    goal: conds.length === 3 ? { type: ['position', 'time', 'points', 'wins', 'ai'].includes(type) ? type : KIND_GOAL[kind], tiers: conds.map(c => num(c.OBJECTIVE)) } : null,
    weather: ini.WEATHER?.NAME || '3_clear',
    time: 13 * 60 + Math.round(num(ini.LIGHTING?.SUN_ANGLE, 48) / 16 * 60), // 16° per hour from 13:00
    ambient: num(ini.TEMPERATURE?.AMBIENT, 26), road: num(ini.TEMPERATURE?.ROAD, 32),
  };
}

async function readEvent(dir, key, group) {
  return eventOf(parseIni(await readText(join(dir, 'event.ini'))), dir, key, group);
}

// The career's levels, in AC's order: series codes by their letters.
export const AC_LEVELS = [
  { id: 'novice', name: 'Novice', re: /^(intro|n\d)/i },
  { id: 'intermediate', name: 'Intermediate', re: /^i\d/i },
  { id: 'trofeo', name: 'Trofeo', re: /^t\d/i },
  { id: 'advanced', name: 'Advanced Trofeo', re: /^at\d/i },
  { id: 'hyper', name: 'Hypercars and Formula', re: /^(h|f)\d/i },
  { id: 'gt', name: 'GT', re: /^gt/i },
];

// [{ key, id, code, name, description, image, requires, requiresAny, champ, points
// (table), goal { points, ranking, tiers }, opponents, events, level }]
export async function acCareer(paths) {
  if (!paths.ac?.content) return [];
  await mountDir('/m/assettocorsa', paths.ac.content);
  const root = join(paths.ac.content, 'career');
  const ids = (await dirsIn(root)).filter(d => /^series\d+$/i.test(d)).sort(byNumber);
  const list = await mapLimit(ids, 6, async id => {
    const dir = join(root, id);
    const ini = parseIni(await readText(join(dir, 'series.ini')));
    if (!ini.SERIES) return null;
    const evIds = (await dirsIn(dir)).filter(d => /^event\d+$/i.test(d)).sort(byNumber);
    const key = `ac/career/${id}`;
    const events = (await Promise.all(evIds.map(e => readEvent(join(dir, e), `${key}/${e}`, 'career')))).filter(Boolean);
    if (!events.length) return null; // the closing placeholder series
    const opp = parseIni(await readText(join(dir, 'opponents.ini')));
    const opponents = Object.keys(opp).filter(k => /^AI\d+$/.test(k)).sort(byNumber).map(k => ({
      id: k.toLowerCase(), model: opp[k].MODEL, config: opp[k].MODEL_CONFIG || '', skin: opp[k].SKIN || '', setup: opp[k].SETUP || '',
      name: opp[k].DRIVER_NAME || k, nation: opp[k].NATIONALITY || '', level: num(opp[k].AI_LEVEL, 100),
    }));
    const g = ini.GOALS || {};
    const goal = { points: num(g.POINTS), ranking: num(g.RANKING), tiers: [num(g.TIER1), num(g.TIER2), num(g.TIER3)] };
    const code = ini.SERIES.CODE || '';
    events.forEach((e, i) => { e.series = key; e.index = i; });
    return {
      key, id, code, events, opponents, goal,
      name: cleanText(ini.SERIES.NAME) || id,
      description: cleanText(ini.SERIES.DESCRIPTION || ''),
      image: fileUrl(join(dir, 'preview.png')), banner: fileUrl(join(dir, 'start.png')),
      requires: (ini.SERIES.REQUIRES || '').split(',').map(s => s.trim()).filter(Boolean),
      requiresAny: ini.SERIES.REQUIRESANY === '1',
      // A championship scores rounds by points; Season zero's goal has points too, but its event has medals.
      champ: (goal.points > 0 || goal.ranking > 0) && !events.some(e => e.goal),
      points: (ini.SERIES.POINTS || '').split(',').map(n => num(n)).filter(n => n > 0),
      level: (AC_LEVELS.find(l => l.re.test(code)) || AC_LEVELS[0]).id,
    };
  });
  return list.filter(Boolean);
}

export async function acSpecialEvents(paths) {
  if (!paths.ac?.content) return [];
  await mountDir('/m/assettocorsa', paths.ac.content);
  const root = join(paths.ac.content, 'specialevents');
  const ids = (await dirsIn(root)).sort(byNumber);
  const list = await mapLimit(ids, 10, id => readEvent(join(root, id), `ac/special/${id}`, 'special'));
  return list.filter(Boolean);
}

// ---------------------------------------------------------------------------
// Series progress and unlocks (career2.js evaluateSeries / isSeriesLocked)

// A championship's standings after the rounds driven: [{ name, points, player }], best first.
export function standings(series, p) {
  const table = p.table[series.key] || {};
  const rows = series.opponents.map(o => ({ name: o.name, points: table[o.name] || 0, player: false }));
  rows.push({ name: '', points: (p.rounds[series.key] || []).reduce((s, r) => s + (r.points || 0), 0), player: true });
  return rows.sort((a, b) => b.points - a.points || (a.player ? -1 : b.player ? 1 : 0));
}

// { done, medals [bronze, silver, gold] counts, points, rank, rounds }
export function seriesState(series, p) {
  if (series.champ) {
    const rounds = p.rounds[series.key] || [];
    const points = rounds.reduce((s, r) => s + (r.points || 0), 0);
    const rank = standings(series, p).findIndex(r => r.player) + 1;
    const all = rounds.length >= series.events.length;
    const done = (series.goal.points > 0 && points >= series.goal.points) || (series.goal.ranking > 0 && all && rank <= series.goal.ranking);
    return { done, points, rank, rounds: rounds.length, finished: all };
  }
  const medals = [0, 0, 0];
  for (const e of series.events) { const t = eventTier(p, e.key); if (t) medals[t - 1]++; }
  // A gold also counts as a silver and a bronze, a silver as a bronze.
  const [g1, g2, g3] = series.goal.tiers, [b, s, g] = medals;
  const done = g >= g3 && g + s >= g3 + g2 && g + s + b >= g1 + g2 + g3;
  return { done, medals };
}

// The goal in words, for the series page.
export function seriesGoalText(series) {
  if (series.champ) return series.goal.points > 0 ? `Score ${series.goal.points} points` : `Finish the championship in the top ${series.goal.ranking}`;
  const [g1, g2, g3] = series.goal.tiers;
  const parts = [];
  if (g3) parts.push(`${g3} gold`);
  if (g2) parts.push(`${g2} silver`);
  if (g1) parts.push(`${g1} bronze`);
  return parts.length ? `Win ${parts.join(', ').replace(/, ([^,]*)$/, ' and $1')} ${g1 + g2 + g3 === 1 ? 'medal' : 'medals'} (a better medal counts too)` : '';
}

export function seriesLocked(series, all, p) {
  if (!series.requires.length) return false;
  const done = id => { const s = all.find(x => x.id === id); return !s || seriesState(s, p).done; };
  return series.requiresAny ? !series.requires.some(done) : !series.requires.every(done);
}

// The next round of a championship (they're driven in order, once each), or -1.
export function nextRound(series, p) {
  const n = (p.rounds[series.key] || []).length;
  return n < series.events.length ? n : -1;
}

// ---------------------------------------------------------------------------
// Medals from a result

// For "ai" goals: the AI level is the tier's (a win at that level or harder).
export function tierFor(ev, r) {
  if (!ev.goal || !r) return 0;
  const t = ev.goal.tiers;
  const count = test => t.filter(test).length;
  switch (ev.goal.type) {
    case 'time': return r.ms > 0 ? count(x => r.ms <= x) : 0;
    case 'position': return r.pos > 0 ? count(x => r.pos <= x) : 0;
    case 'points': return r.points > 0 ? count(x => r.points >= x) : 0;
    case 'wins': return r.wins > 0 ? count(x => r.wins >= x) : 0;
    case 'ai': return r.pos === 1 ? count(x => (r.ai || 0) >= x) : 0;
    default: return 0;
  }
}

// What a result's number is, compared with targets: lower or higher is better.
const lowerBetter = type => type === 'time' || type === 'position';
export function betterScore(type, a, b) {
  if (a == null) return b;
  if (b == null) return a;
  return lowerBetter(type) ? Math.min(a, b) : Math.max(a, b);
}

const suffix = n => `${n}${[, 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] || 'th'}`;
// A target or a score as text.
export function goalValue(type, v) {
  if (v == null || v === '') return '';
  if (type === 'time') return lapTime(v);
  if (type === 'position') return v === 1 ? '1st' : `${suffix(v)} or better`;
  if (type === 'points') return `${Number(v).toLocaleString()} points`;
  if (type === 'wins') return `${v} wins`;
  if (type === 'ai') return `Win at AI ${v}%`;
  return String(v);
}
export function scoreText(type, v) {
  if (v == null) return '';
  if (type === 'time') return lapTime(v);
  if (type === 'position' || type === 'ai') return suffix(v);
  if (type === 'points') return `${Number(v).toLocaleString()} pts`;
  if (type === 'wins') return `${v} ${v === 1 ? 'win' : 'wins'}`;
  return String(v);
}
// The number a result is compared by.
export const scoreOf = (type, r) => (!r ? null : type === 'time' ? r.ms || null : type === 'position' || type === 'ai' ? r.pos || null : type === 'points' ? r.points || null : type === 'wins' ? r.wins ?? null : null);

// ---------------------------------------------------------------------------
// Starting an AC event: race.ini as AC's career and special events write it.

// opts: { ai } the AI level for an "ai" goal; { opponents } a championship's grid.
export async function startAcEvent(paths, ev, opts) {
  if (!paths.ac?.install) throw new Error('Assetto Corsa install folder not found.');
  if (!(await exists(join(paths.ac.install, 'acs.exe')))) throw new Error(`acs.exe not found in ${paths.ac.install}`);
  await writeAcEvent(paths, ev, opts);
  await startAcs(paths);
}

// cfg\race.ini for the event (backed up once, like Quick Drive does). Returns its text.
export async function writeAcEvent(paths, ev, { ai = 0, opponents = null } = {}) {
  const iniPath = join(paths.ac.cfg, 'race.ini');
  const old = await readText(iniPath);
  if (old != null && !(await exists(iniPath + '.launcher-backup'))) await writeText(iniPath + '.launcher-backup', old);
  const prev = parseIni(old || '');

  let ini = removeSections(TEMPLATE.replace(/\r?\n/g, '\r\n'), /^(SESSION_\d+|CAR_\d+)$/i);
  for (const [sec, keys] of Object.entries(ev.ini)) {
    if (/^(EVENT|CONDITION_\d+|METADATA)$/.test(sec) || (ev.group !== 'special' && sec === 'SPECIAL_EVENT')) continue;
    for (const [k, v] of Object.entries(keys)) ini = setIni(ini, sec, k, v);
  }
  // The player: their own name (as AC or Content Manager last wrote it) and a skin the car has.
  const skins = await dirsIn(join(paths.ac.content, 'cars', ev.car, 'skins'));
  const skin = skins.find(s => s.toLowerCase() === (ev.skin || '').toLowerCase()) || skins[0] || '';
  for (const [k, v] of [['MODEL', '-'], ['SETUP', ''], ['SKIN', skin], ['DRIVER_NAME', prev.CAR_0?.DRIVER_NAME || 'Player'],
    ['NATIONALITY', prev.CAR_0?.NATIONALITY || ''], ['NATION_CODE', prev.CAR_0?.NATION_CODE || '']]) ini = setIni(ini, 'CAR_0', k, v);
  ini = setIni(ini, 'RACE', 'SKIN', skin);
  if (opponents) {
    ini = removeSections(ini, /^CAR_([1-9]\d*)$/i);
    opponents.forEach((o, i) => {
      for (const [k, v] of [['MODEL', o.model], ['MODEL_CONFIG', o.config], ['SKIN', o.skin], ['SETUP', o.setup], ['AI_LEVEL', o.level],
        ['DRIVER_NAME', o.name], ['NATIONALITY', o.nation]]) ini = setIni(ini, `CAR_${i + 1}`, k, v);
    });
    ini = setIni(ini, 'RACE', 'CARS', opponents.length + 1);
  }
  if (ai) ini = setIni(ini, 'RACE', 'AI_LEVEL', ai);
  if (prev.OPTIONS?.USE_MPH != null) ini = setIni(ini, 'OPTIONS', 'USE_MPH', prev.OPTIONS.USE_MPH);
  for (const [sec, k] of [['REMOTE', 'ACTIVE'], ['REPLAY', 'ACTIVE'], ['BENCHMARK', 'ACTIVE'], ['RESTART', 'ACTIVE'], ['GHOST_CAR', 'RECORDING'], ['GHOST_CAR', 'PLAYING']]) ini = setIni(ini, sec, k, '0');
  await writeText(iniPath, ini);
  log(`academy start ${ev.key}: ${ev.car}/${skin} @ ${ev.track}/${ev.layout} ${ev.kind}${ai ? ` ai ${ai}` : ''}${opponents ? ` grid ${opponents.length}` : ''}`);
  return ini;
}

// The player's result from race_out.json, if AC wrote it after `since`:
// { ms, pos, points, wins, laps, finished, order (car indices), names }.
export async function readAcResult(paths, ev, since) {
  const file = join(paths.ac.cfg.replace(/\/[^/]+$/, ''), 'out/race_out.json');
  if ((await fileDate(file)) < since) return null;
  let out = null;
  try { out = JSON.parse((await readTextAnyEncoding(file)) || 'null'); } catch { return null; }
  if (!out?.sessions?.length) return null;
  const want = { qualify: 2, race: 3, weekend: 3, hotlap: 4, timeattack: 5, drift: 6, drag: 7 }[ev.kind];
  const session = [...out.sessions].reverse().find(s => num(s.type) === want) || out.sessions[out.sessions.length - 1];
  const extra = name => (out.extras || []).find(x => x.name === name) || {};
  const mine = (session.laps || []).filter(l => (l.car ?? 0) === 0 && l.time > 0);
  const valid = mine.filter(l => !l.cuts).map(l => l.time);
  const r = { laps: mine.length, names: (out.players || []).map(p => p.name) };
  if (ev.kind === 'race' || ev.kind === 'weekend') {
    const order = session.raceResult || [];
    const done = (session.lapstotal || [])[0] ?? mine.length;
    r.order = order;
    r.finished = !session.lapsCount || done >= session.lapsCount;
    r.pos = r.finished && order.includes(0) ? order.indexOf(0) + 1 : 0;
    r.ms = valid.length ? Math.min(...valid) : 0;
  } else if (ev.kind === 'qualify') {
    // The place on the grid: each car's best clean lap, quickest first.
    const best = new Map();
    for (const l of session.laps || []) if (l.time > 0 && !l.cuts) best.set(l.car ?? 0, Math.min(best.get(l.car ?? 0) ?? Infinity, l.time));
    r.ms = best.get(0) || 0;
    r.pos = r.ms ? [...best.values()].filter(t => t < r.ms).length + 1 : 0;
  } else if (ev.kind === 'hotlap') {
    r.ms = valid.length ? Math.min(...valid) : num(extra('bestlap').time);
  } else if (ev.kind === 'timeattack' || ev.kind === 'drift') {
    r.points = num(extra(ev.kind).points);
  } else if (ev.kind === 'drag') {
    r.wins = num(extra('drag').wins);
  }
  return r;
}

// Saves a result: the event's best and medal, a championship round's points and
// the grid's. Returns { tier, before (tier), gained, score, type, best, prevBest, round, points }.
// save: false gives the same without saving (an EVO race's card, shown before EVO
// saves the result).
export async function recordResult(ev, r, { ai = 0, series = null, save = true } = {}) {
  const p = await academyProgress();
  const out = { before: eventTier(p, ev.key) };
  const type = ev.goal?.type || KIND_GOAL[ev.kind];
  const score = scoreOf(type, { ...r, ai });
  const prev = p.events[ev.key] || { tier: 0, tries: 0 };
  const gained = tierFor(ev, { ...r, ai }), tier = Math.max(prev.tier || 0, gained), best = betterScore(type, prev.best ?? null, score);
  if (!save) return { ...out, tier, gained, score, type, best, prevBest: prev.best ?? null };
  if (series?.champ) {
    const rounds = p.rounds[series.key] ||= [];
    if (rounds.length !== ev.index) return null; // not this championship's next round
    const pts = pos => series.points[pos - 1] || 0;
    const table = p.table[series.key] ||= {};
    (r.order || []).forEach((car, i) => {
      if (car === 0) return;
      const o = series.opponents[car - 1];
      if (o) table[o.name] = (table[o.name] || 0) + pts(i + 1);
    });
    rounds.push({ pos: r.pos, points: r.pos ? pts(r.pos) : 0, at: Date.now() });
    Object.assign(out, { round: ev.index, pos: r.pos, points: r.pos ? pts(r.pos) : 0 });
  }
  p.events[ev.key] = { tier, best, last: score, at: Date.now(), tries: (prev.tries || 0) + 1, ...(ai ? { ai: Math.max(prev.ai || 0, r.pos === 1 ? ai : 0) || prev.ai } : {}) };
  await saveProgress();
  return { ...out, tier, gained, score, type, best, prevBest: prev.best ?? null };
}

export async function setLastEvent(key) { const p = await academyProgress(); p.last = key; (p.lastBy ||= {})[key.split('/')[0]] = key; await saveProgress(); }

export async function restartChampionship(series) {
  const p = await academyProgress();
  delete p.rounds[series.key]; delete p.table[series.key];
  for (const e of series.events) delete p.events[e.key];
  await saveProgress();
}

// ---------------------------------------------------------------------------
// EVO and Rally: the launcher's own levels (academy-data.js). A level opens when
// the one before has `unlock` events with a medal; a side level (`side`) is open
// from the start and isn't counted for the next one.

export const levelMedals = (level, p) => level.events.filter(e => eventTier(p, e.key)).length;
// The level a level opens from: the one before it that isn't a side level.
export const levelBefore = (levels, i) => levels.slice(0, i).reverse().find(l => !l.side) || null;
// A level can also ask for a safety rating grade (`sr`, its lowest rating).
export const levelLocked = (levels, i, p) => (!!levels[i].unlock && levelMedals(levelBefore(levels, i), p) < levels[i].unlock) || srShort(levels[i], p);
export const srShort = (level, p) => !!level.sr && srOf(p) < level.sr;
// A level's bonus event (`level.bonus`, also in the game's `all`) opens with gold or better on all its events.
export const levelGolds = (level, p) => level.events.filter(e => eventTier(p, e.key) >= 3).length;
export const bonusLocked = (level, p) => !!level.bonus && levelGolds(level, p) < level.events.length;
// A level's events, its bonus last.
export const levelEvents = level => level.bonus ? [...level.events, level.bonus] : level.events;

// The driver level: points for each event's medal (bronze 1, silver 2, gold 3,
// platinum 5), every game counted; going from level n to n + 1 takes n + 3 points.
export const MEDAL_POINTS = [0, 1, 2, 3, 5];
export function driverLevel(p) {
  const points = Object.values(p.events).reduce((n, e) => n + (MEDAL_POINTS[e?.tier] || 0), 0);
  let level = 1, from = 0;
  while (points >= from + level + 3) { from += level + 3; level++; }
  return { level, points, into: points - from, need: level + 3 };
}

// Time trials from near the line on the layout's Hotstint container (`flying`): an
// Instant Race alone, as long as the event, started on the lights there; after the
// short run to the line every lap is a flying one. (In Practice, EVO 0.9.1 spawns the
// car there but never leaves its loading screen: no pit menu; tested 2026-10-14.)
const EVO_FLYING_START = true;

// cars, tracks: the launcher's EVO lists (games.js scanEvoCars / scanEvoTracks).
// every: also the levels this version doesn't show yet (EVO_RELEASED).
export function evoAcademy({ cars, tracks, every = false }) {
  let chain = 0; // levels so far that open one after another
  const event = (lv, e, i) => {
    const car = cars.find(c => c.carId === e.car && !c.isMod);
    const track = tracks.find(t => t.id === e.track && t.evoTrack), layout = track?.layouts.find(l => l.id === e.layout);
    const container = e.kind === 'timetrial' ? 'practice' : 'race';
    const sprint = e.kind === 'sprint', arch = sprint ? layout?.arches?.find(a => a.container === e.arch) : null;
    return {
      key: `evo/${lv.id}/${e.id}`, game: 'evo', group: 'level', level: lv.id, index: i, bonus: e.id === 'bonus', def: e,
      name: e.name, description: e.note || '', kind: e.kind,
      car: e.car, carName: car?.title || e.car, carImage: car?.image || '', mech: e.mech || '',
      track: e.track, layout: e.layout, evoTrack: track?.evoTrack, evoLayout: layout, arch: e.arch || '', finish: e.finish ?? null,
      flying: EVO_FLYING_START && e.kind === 'timetrial' && !!layout?.hotstint,
      trackName: [track?.title, layout?.name].filter(Boolean).join(' · ') || e.track, trackTitle: track?.title || '', layoutName: layout?.name || '',
      image: layout?.preview || car?.image || '', outline: layout?.outline || '',
      laps: sprint ? 1 : e.laps || 0, qualifying: e.qualifying || 0, minutes: e.minutes || 0, opponents: e.opponents || 0, start: e.startPos || 0, skill: e.skill || null,
      goal: e.kind === 'timetrial' || sprint ? { type: 'time', tiers: e.tiers } : { type: 'position', tiers: e.podium },
      time: e.start, weather: 'clear',
      missing: !car ? 'car' : (sprint ? !arch : !layout?.[container]) ? 'track' : '',
    };
  };
  return EVO_LEVELS.filter(lv => every || EVO_RELEASED.includes(lv.id)).map(lv => ({
    key: `evo/${lv.id}`, id: lv.id, name: lv.name, blurb: lv.blurb, side: !!lv.side, unlock: lv.side ? 0 : chain++ ? EVO_UNLOCK : 0,
    sr: lv.sr ? srGradeMin(lv.sr) : 0, srGrade: lv.sr || '',
    events: lv.events.map((e, i) => event(lv, e, i)),
    bonus: lv.bonus ? event(lv, lv.bonus, lv.events.length) : null,
  }));
}

// EVO's Single Player settings for an event (the shape of evolaunch.js defaultEvoSession()).
export function evoSessionFor(ev, session) {
  const s = JSON.parse(JSON.stringify(session));
  const max = Math.max(1, (ev.evoLayout?.race?.maxDrivers || 33) - 1);
  const grid = { custom: false, opponents: Math.min(ev.opponents, max), skillMin: ev.skill?.[0] || 88, skillMax: ev.skill?.[1] || 92, singleMake: true };
  // A time trial: Practice from the pits, or alone in a race of the same length from
  // near the line (`flying`, evolaunch.js session.flying).
  if (ev.kind === 'timetrial' && !ev.flying) { s.mode = 'practice'; s.practice = { minutes: ev.minutes || 15, start: ev.time, speed: 1 }; }
  if (ev.kind === 'timetrial' && ev.flying) { s.mode = 'race'; s.flying = true; s.race = { type: 'time', laps: 1, minutes: ev.minutes || 15, start: ev.time, speed: 1, startPos: 1, grid: { ...grid, opponents: 0, singleMake: false } }; }
  if (ev.kind === 'race') { s.mode = 'race'; s.race = { type: 'laps', laps: ev.laps, minutes: 20, start: ev.time, speed: 1, startPos: Math.min(ev.start || grid.opponents + 1, grid.opponents + 1), grid }; }
  // A sprint: one lap alone in the layout's academy container (evolaunch.js session.arch).
  if (ev.kind === 'sprint') { s.mode = 'race'; s.arch = ev.arch; s.race = { type: 'laps', laps: 1, minutes: 20, start: ev.time, speed: 1, startPos: 1, grid: { ...grid, opponents: 0, singleMake: false } }; }
  if (ev.kind === 'weekend') {
    s.mode = 'weekend';
    s.weekend = {
      practice: { minutes: 0, start: ev.time - 120, speed: 1 }, qualifying: { minutes: ev.qualifying || 10, start: ev.time - 60, speed: 1 },
      warmup: { minutes: 0, start: ev.time - 30, speed: 1 }, race: { type: 'laps', laps: ev.laps, minutes: 20, start: ev.time, speed: 1 }, grid,
    };
  }
  s.weather = { type: 0, dynamic: false, grip: 2 };
  return s;
}

// EVO's result: Saved Games\ACE\Results\<yymmdd-hhmm>_SP_<Session>.sessionresults.json
// written since `since`, { session, track, layout, drivers[] { driver_name, car_name,
// position (0-based), laps, best_lap "mm:ss.mmm" } }. AI drivers' names start with "•".
// The run counts only with the event's car and track (EVO's menu can change them).
const evoLap = t => { const p = String(t || '').split(':').map(Number); return p.length > 1 && p.every(Number.isFinite) ? Math.round(p.reduce((a, n) => a * 60 + n, 0) * 1000) : 0; };
const evoName = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const evoLayoutName = s => evoName(s).replace(/(^| )(time attack|hotstint|race)$/, '').trim();
// The file's layout is the container's name: "<Layout> Time Attack", "<Layout> Race", or
// the Hotstint one a time trial ran on (Laguna Seca's is plain "Hotstint").
const evoSameLayout = (j, ev) => evoLayoutName(j.layout) === evoLayoutName(ev.layoutName) || (!!ev.evoLayout?.hotstint && evoName(j.layout) === evoName(ev.evoLayout.hotstint.container));
// A flying start's first crossing of the line can come as a "lap" of a few seconds:
// a time trial's lap under 80 % of its fastest target isn't a lap.
export const evoLapTooShort = (ev, ms) => ev.kind === 'timetrial' && ms > 0 && ms < 0.8 * Math.min(...(ev.goal?.tiers || [0]));
// One results file (parsed) against the event: null when it's another session (a
// weekend's practice), { mismatch: 'car' | 'track' }, or { laps, ms, pos, finished }
// (pos only for a race the player finished). A flying time trial's file is a race's.
export function evoResultFile(j, ev) {
  const want = ev.kind === 'timetrial' && !ev.flying ? 'practice' : 'race';
  if (!j || evoName(j.session) !== want) return null;
  const me = (j.drivers || []).find(d => !String(d.driver_name || '').startsWith('•')) || (j.drivers || []).find(d => d.is_current_driver);
  if (!me) return null;
  if (evoName(j.track) !== evoName(ev.trackTitle) || !evoSameLayout(j, ev)) return { mismatch: 'track' };
  if (evoName(me.car_name) !== evoName(ev.carName)) return { mismatch: 'car' };
  // Penalties EVO gave (`penalties`, the worst as `high_penalty`): a disqualification
  // isn't a finish. Others are in EVO's own classification, `position`.
  const penalties = Array.isArray(me.penalties) && me.penalties.length ? me.penalties : null;
  const dsq = /disqualif/i.test(`${JSON.stringify(penalties || [])} ${me.high_penalty || ''}`);
  const laps = Number(me.laps) || 0, finished = ev.kind !== 'timetrial' && want === 'race' && laps >= ev.laps && !dsq, best = evoLap(me.best_lap);
  return { laps, ms: evoLapTooShort(ev, best) ? 0 : best, pos: finished ? (Number(me.position) || 0) + 1 : 0, finished, ...(dsq ? { dsq } : {}), ...(penalties ? { penalties } : {}) };
}

// All the event's results files since `since`, leaving out the names in `skip`
// (results already saved while EVO was open, see main.js academyWatch).
export async function readEvoResult(resultsDir, ev, since, skip = new Set()) {
  const r = { laps: 0, ms: 0, pos: 0, finished: false, mismatch: '', files: 0 };
  for (const f of (await listDir(resultsDir)).filter(e => /_SP_.*\.sessionresults\.json$/i.test(e.entry) && !skip.has(e.entry))) {
    const path = join(resultsDir, f.entry);
    if ((await fileDate(path)) < since) continue;
    let j = null;
    try { j = JSON.parse((await readText(path)) || 'null'); } catch { continue; }
    const one = evoResultFile(j, ev);
    if (!one) continue;
    if (one.mismatch) { r.mismatch ||= one.mismatch; continue; }
    r.files++;
    r.laps += one.laps;
    if (one.ms && (!r.ms || one.ms < r.ms)) r.ms = one.ms;
    if (one.finished && (!r.finished || one.pos < r.pos)) { r.finished = true; r.pos = one.pos; }
    if (one.dsq) r.dsq = true;
  }
  if (r.files) r.mismatch = '';
  if (r.finished) delete r.dsq; // another run of the event finished
  return r;
}

// A sprint's time: EVO doesn't end the race at the finish arch and writes no
// result for it, but its log (Saved Games\ACE\Logs\log-<yymmdd-hhmmss>.txt) has
// the run, every line starting "[yyyy-mm-dd hh:mm:ss.mmm]":
//   Game Started! GameModeType_INSTANT_RACE | <track> <container> <session>  1 laps @… | <car id> | …
//   changing session phase 4 -> 50          green (again after each restart)
//   … session_phase_changed: Session -> Waiting_For_Players   restarted from the pause menu
//   Split completed for car <guid>: (<ms> ms, splitindex 0) lap:0
// The first split comes with the green (the wait on the grid); the next one is the
// finish arch, its time counted from the green. A run is that split when its time
// matches the clock since the green; restarts give more runs, the best counts.
// sprintReader reads one log, in pieces as EVO writes it (the launcher shows each
// run while EVO is still open) or whole: feed(text) returns the run times (ms)
// finished in it; `state` says whether the log had the event, or another car or track.
const logTime = line => { const m = /^\[(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d(?:\.\d+)?)\]/.exec(line); return m ? Date.parse(`${m[1]}T${m[2]}`) : 0; };
// The log's lines EVO's readers here look for: the session (mode, "<track> <layout or
// container> <session> <length>", car id), the player's car, a car crossing the line.
const LOG_START = /Game Started! (\w+) \| (.*?) @[^|]*\| (\S+) \|/, LOG_PLAYER = /\[VehicleSystem\]\[(\S+?)\] SpawnVehicle\(Player\)/;
const LOG_LAP = /New lap carId (\S+): (\d+):(\d+(?:\.\d+)?)/, lapMs = m => Math.round((Number(m[2]) * 60 + Number(m[3])) * 1000);
// EVO's start check (the car moved before the green: a jump start, penalised), and
// a penalty given (the notification that comes with it; a cleared one says
// {PENALTY_CLEARED_KEY} instead).
const LOG_JUMP = /DetectorWrongPositionOnStart::onStart .*\(Penalty: true\)/, LOG_PENALTY = /\{PENALTY_ADDED_KEY\}/;
// EVO's HUD showing the time a cut gained (in a race), until it's given back.
const LOG_CUT = /Showing track cut widget/;
// feed(text, end) for a reader of whole lines: text in any pieces, the last line
// kept until it ends (or `end`); returns what read(line) gave that isn't empty.
const lineFeed = read => {
  let rest = '';
  return (text, end = false) => {
    const lines = (rest + text).split('\n');
    rest = end ? '' : lines.pop();
    return lines.map(read).filter(Boolean);
  };
};
export function sprintReader(ev) {
  // Anything quicker than this isn't a run to the finish arch (a start line crossed instead).
  const least = Math.round((ev.goal?.tiers?.at(-1) || 0) * 0.6);
  // jumps: runs left out for a jump start (EVO's start check at the arch's lights).
  // runs: each run returned, with when it finished by the log's clock ({ ms, at }).
  const state = { ours: false, seen: false, mismatch: '', jumps: 0, runs: [] };
  let green = 0, jumped = false;
  const read = text => {
    const start = LOG_START.exec(text);
    if (start) {
      const here = start[1] === 'GameModeType_INSTANT_RACE' && ` ${start[2]} `.includes(` ${ev.arch} `);
      state.ours = here && start[3] === ev.car;
      state.seen ||= state.ours;
      if (here && !state.ours) state.mismatch = 'car';
      else if (!here) state.mismatch ||= 'track';
      green = 0;
      return 0;
    }
    if (!state.ours) return 0;
    if (/changing session phase \d+ -> 50\b/.test(text)) { green = logTime(text); jumped = false; return 0; }
    if (/changing session phase 50 -> |session_phase_changed: Session -> /.test(text)) { green = 0; return 0; } // restarted
    if (LOG_JUMP.test(text)) { jumped = true; return 0; }
    const split = /Split completed for car \S+: \((\d+) ms/.exec(text);
    if (!split || !green) return 0;
    const clock = logTime(text) - green, ms = Number(split[1]);
    if (clock < 1500) return 0; // the one that comes with the green
    green = 0; // one run per green
    if (jumped) { state.jumps++; return 0; }
    if (!(Math.abs(ms - clock) < 1000 && ms >= least)) return 0;
    state.runs.push({ ms, at: logTime(text) });
    return ms;
  };
  return { state, feed: lineFeed(read) };
}
export async function readEvoSprint(logsDir, ev, since) {
  const r = { ms: 0, runs: 0, laps: 0, times: [], found: [], mismatch: '', files: 0 }; // found: { ms, at } of each time
  for (const f of (await listDir(logsDir)).filter(e => /^log-.*\.txt$/i.test(e.entry)).sort((a, b) => a.entry.localeCompare(b.entry))) {
    const path = join(logsDir, f.entry);
    if ((await fileDate(path)) < since) continue;
    const text = await readText(path);
    if (!text) continue;
    const reader = sprintReader(ev);
    r.times.push(...reader.feed(text, true));
    r.found.push(...reader.state.runs);
    if (reader.state.seen) r.files++;
    if (reader.state.mismatch === 'car' || !r.mismatch) r.mismatch = reader.state.mismatch || r.mismatch;
  }
  r.runs = r.laps = r.times.length;
  r.ms = r.times.length ? Math.min(...r.times) : 0;
  if (r.runs) r.mismatch = '';
  return r;
}

// A race's finish from the same log, the moment the player crosses the line (EVO
// saves the result some 11 s later, once the field is in and the car is back):
//   [VehicleSystem][<guid>] SpawnVehicle(Player)   the player's car
//   Game Started! GameModeType_INSTANT_RACE | <track> <layout> Race  <n> laps @… | <car id> | …
//   changing session phase 4 -> 50                  green (again after each restart)
//   New lap carId <guid>: mm:ss.mmm                 a car crossing the line
// The first car to complete <n> laps wins; after it, each car's next crossing is
// its finish. The player's place is one more than the cars finished before them.
// feed(text) returns the player's result, { laps, ms, pos, finished } as
// evoResultFile gives it, when they've just finished.
export function raceReader(ev) {
  let me = '', ours = false, laps = 0, count = new Map(), done = new Set(), best = 0, sent = false;
  const read = text => {
    const player = LOG_PLAYER.exec(text);
    if (player) { me = player[1]; return null; }
    const start = LOG_START.exec(text);
    if (start) {
      laps = Number(/ (\d+) laps\s*$/.exec(start[2])?.[1]) || 0;
      ours = start[1] === 'GameModeType_INSTANT_RACE' && start[3] === ev.car && laps > 0 && evoName(start[2]).startsWith(evoName(ev.trackTitle));
      return null;
    }
    if (!ours) return null;
    if (/changing session phase \d+ -> 50\b/.test(text)) { count = new Map(); done = new Set(); best = 0; sent = false; return null; }
    const lap = LOG_LAP.exec(text);
    if (!lap || sent) return null;
    const car = lap[1], n = (count.get(car) || 0) + 1;
    count.set(car, n);
    if (done.size || n >= laps) done.add(car);
    if (car !== me) return null;
    const ms = lapMs(lap);
    if (ms && (!best || ms < best)) best = ms;
    if (!done.has(car)) return null;
    sent = true;
    const finished = n >= ev.laps;
    return { laps: n, ms: best, pos: finished ? done.size : 0, finished };
  };
  return { feed: lineFeed(read) };
}

// A time trial's laps from the same log, each as the player completes it:
//   Game Started! GameModeType_PRACTICE | <track> <layout> Time Attack Practice  <s> seconds @… | <car id> | …
//   (a flying time trial: GameModeType_INSTANT_RACE | <track> <layout> Hotstint Race …)
//   New lap carId <guid>: mm:ss.mmm                     the player's lap (the out-lap isn't logged)
//   … {PENALTY_ADDED_KEY}                              a penalty given, as for a cut
// The log doesn't say which laps EVO counts: a lap with a penalty given during it
// is marked `cut` (EVO's file at the end of the session has the best clean lap).
// feed(text) returns the laps completed in it, { ms, n, cut }.
export function lapReader(ev) {
  let me = '', ours = false, n = 0, cut = false;
  const read = text => {
    const player = LOG_PLAYER.exec(text);
    if (player) { me = player[1]; return null; }
    const start = LOG_START.exec(text);
    if (start) {
      ours = start[1] === (ev.flying ? 'GameModeType_INSTANT_RACE' : 'GameModeType_PRACTICE') && start[3] === ev.car && evoName(start[2]).startsWith(evoName(ev.trackTitle));
      n = 0; cut = false;
      return null;
    }
    if (!ours) return null;
    if (LOG_PENALTY.test(text)) { cut = true; return null; }
    const lap = LOG_LAP.exec(text);
    if (!lap || lap[1] !== me) return null;
    const r = { ms: lapMs(lap), n: ++n, cut };
    cut = false;
    return r;
  };
  return { feed: lineFeed(read) };
}

// ---------------------------------------------------------------------------
// Safety rating: EVO races and race weekends started from the Academy. 0 to 99,
// from 50, shown as a grade like Gran Turismo Sport's (E to S). Impacts and
// wheels off the track, corner cuts (evotelemetry.js: EVO's live data; a cut also
// from the log) and penalties take it down; a lap with none of them brings it up
// (main.js academyWatch).
export const SR_START = 50;
const SR_GRADES = [['S', 99], ['A', 80], ['B', 60], ['C', 40], ['D', 20], ['E', 0]];
export const srOf = p => p.sr ?? SR_START;
export const srGrade = sr => SR_GRADES.find(([, min]) => sr >= min)[0];
export const srGradeMin = grade => SR_GRADES.find(([g]) => g === grade)?.[1] ?? 0;
// How much an event takes: an impact by how much the car's damage went up (EVO's
// damage units, summed over 0.4 s: a tap about 3, a hard hit 20 and more), wheels
// off the track, a corner cut (the lap marked invalid), a penalty from EVO.
export function srLoss(e) {
  if (e.t === 'hit') return e.d < 8 ? 1 : e.d < 18 ? 3 : 5;
  if (e.t === 'off') return e.cut ? 2 : 1;
  if (e.t === 'cut' || e.t === 'penalty') return 2;
  return 0;
}
export async function changeSR(delta) {
  const p = await academyProgress();
  p.sr = Math.max(0, Math.min(99, srOf(p) + delta));
  await saveProgress();
  return p.sr;
}

// What the rating follows in the log, as it's written: the green (it counts from
// then), the end of the player's driving (the race's end, or a restart), the
// player's laps, penalties (a jump start's marked `jump`), corner cuts.
//   changing session phase N -> 50                 green
//   changing session phase N -> 72 | 80, Session -> Waiting_For_Players   stop
//   New lap carId <player>: …                      a lap
//   DetectorWrongPositionOnStart::onStart … (Penalty: true), {PENALTY_ADDED_KEY}
//   Showing track cut widget                       a cut
export function srReader() {
  let me = '', jumpAt = 0;
  const read = text => {
    const player = LOG_PLAYER.exec(text);
    if (player) { me = player[1]; return null; }
    if (/changing session phase \d+ -> 50\b/.test(text)) return { t: 'green' };
    if (/changing session phase \d+ -> (?:72|80)\b|session_phase_changed: Session -> Waiting_For_Players/.test(text)) return { t: 'stop' };
    if (LOG_JUMP.test(text)) { jumpAt = logTime(text); return null; }
    if (LOG_PENALTY.test(text)) return { t: 'penalty', jump: !!jumpAt && logTime(text) - jumpAt < 2000 };
    if (LOG_CUT.test(text)) return { t: 'cut' };
    const lap = LOG_LAP.exec(text);
    return lap && lap[1] === me ? { t: 'lap' } : null;
  };
  return { feed: lineFeed(read) };
}

// Rally: stage id, car, start time, weather. names: { car(id), stage(id) } -> text.
export function rallyAcademy({ aiTime, carName, carImage, stageName, stageImage, stageMap }) {
  const event = (lv, e, i) => {
    const ref = aiTime(e.stage, e.car);
    const night = e.start >= 20 * 60 || e.start < 6 * 60, wet = e.weather >= 5;
    const kind = `${wet ? 'hard' : 'normal'}${night ? 'Night' : ''}`, margins = [...RALLY_MARGINS[kind], RALLY_PLATINUM[kind]];
    return {
      key: `rally/${lv.id}/${e.id}`, game: 'rally', group: 'level', level: lv.id, index: i, bonus: e.id === 'bonus', def: e,
      name: e.name, description: '', kind: 'stage',
      car: e.car, carName: carName(e.car), carImage: carImage(e.car),
      track: e.stage, stage: e.stage, trackName: stageName(e.stage), image: stageImage(e.stage) || carImage(e.car), outline: stageMap(e.stage),
      time: e.start, weather: e.weather, night, wet, ref,
      goal: ref ? { type: 'time', tiers: margins.map(m => Math.round(ref * (1 + m) / 100) * 100) } : null,
      missing: '',
    };
  };
  return RALLY_LEVELS.map((lv, li) => ({
    key: `rally/${lv.id}`, id: lv.id, name: lv.name, blurb: lv.blurb, unlock: li ? RALLY_UNLOCK : 0,
    events: lv.events.map((e, i) => event(lv, e, i)),
    bonus: lv.bonus ? event(lv, lv.bonus, lv.events.length) : null,
  }));
}

// ---------------------------------------------------------------------------
// Assetto Corsa "Modded": the launcher's classes (academy-data.js AC_CLASSES).
// cars, tracks: the launcher's AC lists (games.js). Each class: its cars with
// `installed`, and its events; an event opens with a medal in the one before.

export function acClasses({ cars, tracks }) {
  const byId = (list, id) => list.find(x => x.id.toLowerCase() === String(id || '').toLowerCase());
  return AC_CLASSES.map(c => {
    const list = c.cars.map(m => { const it = byId(cars, m.id); return { ...m, installed: !!it, title: it?.title || m.name, image: it?.image || '', skins: it?.skins || [] }; });
    const have = list.filter(m => m.installed);
    const key = `ac/modded/${c.id}`;
    return {
      key, id: c.id, name: c.name, blurb: c.blurb, cars: list,
      events: c.events.map((e, i) => {
        const t = byId(tracks, e.track), l = t && (e.layout ? t.layouts.find(x => x.id.toLowerCase() === e.layout.toLowerCase()) : t.layouts[0]);
        return {
          key: `${key}/${e.id}`, game: 'ac', group: 'modded', classId: c.id, index: i, def: e,
          name: e.name, description: '', kind: e.kind,
          car: have[0]?.id || list[0].id, carName: have.length > 1 ? `${have.length} cars` : (have[0] || list[0]).title, carImage: have[0]?.image || '',
          track: e.track, layout: e.layout || '', trackName: l?.name || t?.title || e.track, outline: l?.outline || '', image: l?.preview || t?.image || have[0]?.image || '',
          pitboxes: Number(l?.pitboxes) || 0,
          laps: e.laps || 0, minutes: e.minutes || 0, opponents: e.opponents, aiLevel: e.ai, start: e.start || 0, time: e.time, weather: '3_clear', ambient: 24, road: 0,
          goal: { type: 'position', tiers: e.podium },
          missing: !have.length ? 'car' : !t || !t.playable || !l ? 'track' : '',
        };
      }),
    };
  });
}
// An event opens when the one before it in its class has a medal.
export const classEventLocked = (cls, ev, p) => ev.index > 0 && !eventTier(p, cls.events[ev.index - 1].key);

// Quick Drive's session for a class event, from the player's current one (their assists).
export function classSession(ev, base) {
  const s = JSON.parse(JSON.stringify(base));
  s.mode = ev.kind;
  s.qualify = { minutes: ev.minutes || 10 };
  s.race = { laps: ev.laps || 5, startPos: ev.start || 0 };
  s.weekend = { practice: 0, qualifying: ev.minutes || 10, laps: ev.laps || 8 };
  s.ai = { ...s.ai, count: ev.opponents, strength: ev.aiLevel, variation: 2 };
  Object.assign(s, { time: ev.time, speed: 1, weather: '3_clear', cspWeather: '15', air: 24, road: 'auto', grip: 'optimum', penalties: true, date: '', wind: { speed: 0, gusts: 0, dir: 0 } });
  return s;
}

// The AI grid: the class's installed cars in turn, each with its next livery
// (liveries repeat once a car runs out), leaving out the player's own livery.
export function classGrid(cls, count, car, skin) {
  const lists = cls.cars.filter(m => m.installed)
    .map(m => m.skins.map(s => ({ car: m.id, skin: s.id })).filter(g => !(g.car === car && g.skin === skin)))
    .filter(l => l.length);
  const out = [];
  for (let round = 0; out.length < count && lists.length; round++) {
    for (const l of lists) { if (out.length < count) out.push(l[round % l.length]); }
  }
  return out;
}
