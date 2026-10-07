// Assetto Corsa quick drive: write cfg/race.ini with the chosen car/skin/track and
// session settings, then start acs.exe directly, the same way Content Manager
// does. Sessions, opponents, time, weather, temperatures and grip are written the
// way AC's own launcher does it (launcher\themes\default\js\ui.js); assists go to
// cfg/assists.ini as AC's launcher and Content Manager write them. With CSP's
// WeatherFX, the weather is a CSP weather type and the time can be any hour, with
// the keys Content Manager writes (__CM_WEATHER_TYPE, __CM_WEATHER_CONTROLLER,
// __CM_DATE). Other keys in race.ini are left untouched.
import { join, readText, writeText, exists, listDir, startProcess, log, IS_LINUX } from './util.js';
import { runWithProton } from './steam.js';
import { setIni, deleteKeys, removeSections, parseIni } from './ini.js';
import { weatherTypeOf, isWetWeather, PROTON_DLL_OVERRIDE } from './csp.js';

const lineSplit = text => text.split(/\r?\n/);

const TEMPLATE = `[RACE]
MODEL=
MODEL_CONFIG=
SKIN=
TRACK=
CONFIG_TRACK=
AI_LEVEL=90
CARS=1
DRIFT_MODE=0
FIXED_SETUP=0
PENALTIES=1
JUMP_START_PENALTY=0

[CAR_0]
SETUP=
SKIN=
MODEL=-
MODEL_CONFIG=
BALLAST=0
RESTRICTOR=0
DRIVER_NAME=Player
NATIONALITY=
NATION_CODE=

[SESSION_0]
NAME=Practice
DURATION_MINUTES=0
SPAWN_SET=PIT
TYPE=1

[OPTIONS]
USE_MPH=0

[GHOST_CAR]
RECORDING=0
PLAYING=0
LOAD=0
FILE=
ENABLED=0

[REPLAY]
FILENAME=
ACTIVE=0

[REMOTE]
ACTIVE=0

[LIGHTING]
SUN_ANGLE=-8
TIME_MULT=1
CLOUD_SPEED=0.2

[TEMPERATURE]
AMBIENT=26
ROAD=32

[WEATHER]
NAME=3_clear

[DYNAMIC_TRACK]
SESSION_START=100
RANDOMNESS=0
SESSION_TRANSFER=100
LAP_GAIN=1

[BENCHMARK]
ACTIVE=0

[RESTART]
ACTIVE=0

[HEADER]
VERSION=2
`;

// ---------------------------------------------------------------------------
// Session settings

export const AC_MODES = { practice: 'Practice', hotlap: 'Hotlap', race: 'Race', weekend: 'Race Weekend' };

// cfg\templates\tracks.ini, in file order (DYNAMIC_TRACK/PRESET is the index).
export const AC_GRIP = [
  { id: 'dusty', label: 'Dusty', start: 86, transfer: 50, randomness: 1, lapGain: 30 },
  { id: 'old', label: 'Old', start: 89, transfer: 80, randomness: 3, lapGain: 50 },
  { id: 'slow', label: 'Slow', start: 96, transfer: 80, randomness: 1, lapGain: 300 },
  { id: 'green', label: 'Green', start: 95, transfer: 90, randomness: 2, lapGain: 132 },
  { id: 'fast', label: 'Fast', start: 98, transfer: 80, randomness: 2, lapGain: 700 },
  { id: 'optimum', label: 'Optimum', start: 100, transfer: 100, randomness: 0, lapGain: 1 },
];

export function defaultAcSession() {
  return {
    mode: 'practice',
    practice: { minutes: 0 },
    race: { laps: 5, startPos: 0 }, // startPos: 0 last, -1 random, else the grid slot
    weekend: { practice: 10, qualifying: 15, laps: 10 },
    ai: { count: 9, strength: 95, variation: 2, aggression: 30 },
    time: 13 * 60, speed: 1,
    weather: '3_clear', air: 26, road: 'auto', grip: 'optimum', penalties: true,
    // With CSP's WeatherFX: a weather type (CSP_WEATHER_TYPES id), or "ctrl:<id>" for
    // a controller that picks the weather itself (CSP's Live, Schedule…).
    cspWeather: '15',
    wfxController: '', // controller for a chosen type; '' = CSP's default ("base")
    date: '', // YYYY-MM-DD with CSP's date support; '' = today
    wind: { speed: 0, gusts: 0, dir: 0 }, // km/h; gusts add to the speed; dir in degrees
    assists: { ...AC_ASSIST_PRESETS.racer },
  };
}

// cfg\assists.ini [ASSISTS] keys for the session's assists.
export const ASSIST_KEYS = {
  abs: 'ABS', tc: 'TRACTION_CONTROL', stability: 'STABILITY_CONTROL', autoClutch: 'AUTO_CLUTCH', autoShift: 'AUTO_SHIFTER',
  autoBlip: 'AUTO_BLIP', autoBrake: 'AUTO_BRAKE', ideal: 'IDEAL_LINE', damage: 'DAMAGE', visualDamage: 'VISUALDAMAGE',
  fuel: 'FUEL_RATE', tyreWear: 'TYRE_WEAR', blankets: 'TYRE_BLANKETS', slipstream: 'SLIPSTREAM',
};
// AC's own presets (cfg\templates\gamer|racer|pro.ini). ABS and TC: 0 off, 1 the car's factory setting, 2 on.
const assists = (abs, tc, stability, autoClutch, autoShift, autoBlip, ideal, damage, fuel, blankets) =>
  ({ abs, tc, stability, autoClutch, autoShift, autoBlip, autoBrake: 0, ideal, damage, visualDamage: damage > 0 ? 1 : 0, fuel, tyreWear: 1, blankets, slipstream: 1 });
export const AC_ASSIST_PRESETS = {
  gamer: assists(2, 2, 100, 1, 1, 1, 1, 0, 0, 1),
  racer: assists(2, 1, 50, 1, 0, 1, 0, 20, 0, 1),
  pro: assists(1, 1, 0, 0, 0, 0, 0, 100, 1, 0),
};

// AC's launcher formula for the asphalt temperature (applytemp/calctemp in ui.js);
// coeff is the weather's TEMPERATURE_COEFF. Outside 08:00-18:00 (CSP's 24 hours)
// it blends from the 18:00 value to the next 08:00 one, as Content Manager does.
export function roadTemperature(minutes, air, coeff = 1) {
  if (!coeff) coeff = 1;
  if (minutes < 8 * 60 || minutes > 18 * 60) {
    const at8 = roadTemperature(8 * 60, air, coeff), at18 = roadTemperature(18 * 60, air, coeff);
    const m = minutes > 18 * 60 ? minutes - 24 * 60 : minutes; // 18:00 is -6 h, 08:00 is +8 h
    return Math.round(at18 + (at8 - at18) * (m + 6 * 60) / (14 * 60));
  }
  const t = (minutes / 60 - 7) / 24;
  return Math.round((-10 * coeff * t + 10 * coeff) * 2 * ((Math.exp(-6 * t) * (0.4 * Math.sin(6 * t)) + 0.1) * (air / 1.5) * Math.sin(0.9 * t)) + air);
}

// Content Manager + CSP pick the weather from __CM_WEATHER_TYPE (CM's WeatherType
// values); these are the types of AC's own presets.
const CM_WEATHER_TYPE = { '1_heavy_fog': 20, '2_light_fog': 21, '3_clear': 15, '4_mid_clear': 16, '5_light_clouds': 17, '6_mid_clouds': 18, '7_heavy_clouds': 19 };

// Weather presets in content\weather: [{ id, name, coeff, type }]; type is the CSP
// weather type a preset is made for ([__LAUNCHER_CM] WEATHER_TYPE, as in Sol's).
export async function acWeathers(paths) {
  if (!paths.ac.content) return [];
  const root = join(paths.ac.content, 'weather');
  const dirs = (await listDir(root)).filter(e => e.type === 'DIRECTORY');
  const out = [];
  for (const d of dirs) {
    const ini = parseIni(await readText(join(root, d.entry, 'weather.ini')));
    if (!ini.LAUNCHER && !ini.CLOUDS) continue;
    out.push({
      id: d.entry, name: ini.LAUNCHER?.NAME || d.entry.replace(/^\d+_/, '').replace(/_/g, ' '), coeff: Number(ini.LAUNCHER?.TEMPERATURE_COEFF) || 1,
      type: weatherTypeOf(ini.__LAUNCHER_CM?.WEATHER_TYPE) ?? CM_WEATHER_TYPE[d.entry] ?? null,
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
}

// The preset written as [WEATHER] NAME for a CSP weather type: one made for that
// type, else the closest of AC's own (CSP draws the type either way).
export function presetForType(weathers, type) {
  const made = weathers.find(w => w.type === type);
  if (made) return made;
  const kunos = Object.entries(CM_WEATHER_TYPE).find(([, t]) => t === type)?.[0]
    || (isWetWeather(type) || [26, 27, 28, 32].includes(type) ? '7_heavy_clouds' : [22, 23, 24, 25].includes(type) ? '2_light_fog' : '3_clear');
  return weathers.find(w => w.id === kunos) || weathers.find(w => w.id === '3_clear') || weathers[0] || { id: kunos, coeff: 1 };
}

const pad = n => String(n).padStart(2, '0');
// __CM_DATE: seconds since 1970 for the chosen day (Content Manager's format).
const dateToUnix = d => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || ''); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 1000 : null; };
const unixToDate = s => { const d = new Date(Number(s) * 1000); return isNaN(d) ? '' : `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };

// The settings currently in race.ini and assists.ini, in the shape of
// defaultAcSession(). csp (readCsp) tells controllers that pick their own weather apart.
export async function readAcSession(paths, csp = null) {
  const s = defaultAcSession();
  const ini = parseIni(paths.ac.cfg ? await readText(join(paths.ac.cfg, 'race.ini')) : '');
  const n = (v, d) => (v === undefined || v === '' || isNaN(Number(v)) ? d : Number(v));
  const sessions = Object.keys(ini).filter(k => /^SESSION_\d+$/.test(k)).sort().map(k => ini[k]);
  const ofType = t => sessions.find(x => n(x.TYPE) === t);
  if (ofType(2)) s.mode = 'weekend';
  else if (ofType(3)) s.mode = 'race';
  else if (ofType(4)) s.mode = 'hotlap';
  if (s.mode === 'practice' && ofType(1)) s.practice.minutes = n(ofType(1).DURATION_MINUTES, 0);
  if (s.mode === 'race') s.race.laps = n(ofType(3).LAPS, 5);
  if (s.mode === 'weekend') {
    s.weekend.practice = ofType(1) ? n(ofType(1).DURATION_MINUTES, 10) : 0;
    s.weekend.qualifying = n(ofType(2).DURATION_MINUTES, 15);
    s.weekend.laps = n(ofType(3)?.LAPS, 10);
  }
  const cars = n(ini.RACE?.CARS, 1);
  if (cars > 1) s.ai.count = cars - 1;
  s.ai.strength = Math.min(100, Math.max(80, n(ini.RACE?.AI_LEVEL, 95)));
  s.ai.aggression = n(ini.CAR_1?.AI_AGGRESSION, s.ai.aggression);
  s.penalties = n(ini.RACE?.PENALTIES, 1) !== 0;
  // SUN_ANGLE is 16° per hour from 13:00; with CSP it can be any hour of the day.
  const angle = n(ini.LIGHTING?.SUN_ANGLE, null);
  if (angle !== null) s.time = ((Math.round((13 + angle / 16) * 60 / 15) * 15) % 1440 + 1440) % 1440;
  s.speed = n(ini.LIGHTING?.TIME_MULT, 1);
  s.weather = ini.WEATHER?.NAME || s.weather;
  s.air = n(ini.TEMPERATURE?.AMBIENT, 26);
  s.grip = AC_GRIP.find(g => g.start === n(ini.DYNAMIC_TRACK?.SESSION_START) && g.lapGain === n(ini.DYNAMIC_TRACK?.LAP_GAIN))?.id || 'optimum';

  const type = n(ini.LIGHTING?.__CM_WEATHER_TYPE, -1);
  const ctrl = ini.LIGHTING?.__CM_WEATHER_CONTROLLER || '';
  const controller = csp?.controllers?.find(c => c.id === ctrl);
  if (controller && !controller.followsWeather) s.cspWeather = `ctrl:${ctrl}`;
  else if (type >= 0) s.cspWeather = String(type);
  else if (CM_WEATHER_TYPE[s.weather] != null) s.cspWeather = String(CM_WEATHER_TYPE[s.weather]);
  // "base" is what Content Manager writes for everyone, so it isn't a choice to keep
  // (with Pure, the default becomes Pure Static).
  if (controller?.followsWeather && ctrl !== 'base' && ctrl !== csp.baseController) s.wfxController = ctrl;
  if (ini.LIGHTING?.__CM_DATE) s.date = unixToDate(ini.LIGHTING.__CM_DATE);
  const windMin = n(ini.WIND?.SPEED_KMH_MIN, 0), windMax = n(ini.WIND?.SPEED_KMH_MAX, windMin);
  s.wind = { speed: windMin, gusts: Math.max(0, windMax - windMin), dir: n(ini.WIND?.DIRECTION_DEG, 0) };

  const a = parseIni(paths.ac.cfg ? await readText(join(paths.ac.cfg, 'assists.ini')) : '').ASSISTS;
  if (a) for (const [k, key] of Object.entries(ASSIST_KEYS)) s.assists[k] = n(a[key], s.assists[k]);
  s.assists.visualDamage = s.assists.visualDamage > 0 ? 1 : 0;
  return s;
}

// Driver names: the skin's ui_skin.json, else AC's own random name list.
const FALLBACK_NAMES = ['Marco Rossi,ITA', 'Jan Novak,CZE', 'Lukas Weber,DEU', 'Tom Hughes,GBR', 'Pierre Laurent,FRA', 'Diego Alvarez,ESP', 'Kenji Sato,JPN', 'Liam Walsh,IRL', 'Mikko Virtanen,FIN', 'Joao Silva,BRA', 'Erik Larsson,SWE', 'Pieter de Vries,NLD'];
async function driverNames(acDir) {
  const text = await readText(join(acDir, 'launcher/themes/default/modules/randomizer/namesnat.txt'));
  const list = (text ? lineSplit(text) : FALLBACK_NAMES).map(l => l.trim()).filter(l => l.includes(','));
  return list.length ? list : FALLBACK_NAMES;
}
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// Does the track layout have an AI line (needed for opponents)?
export async function hasAiLine(paths, track, layout) {
  return exists(join(paths.ac.content, 'tracks', track, layout || '', 'ai/fast_lane.ai'));
}

async function opponentEntries(paths, { car, skin, skins }, ai) {
  const acDir = paths.ac.install;
  const names = shuffle(await driverNames(acDir));
  const others = skins.filter(s => s !== skin);
  const pool = shuffle(others.length ? others : skins.length ? skins : [skin]);
  const entries = [];
  for (let i = 0; i < ai.count; i++) {
    const s = pool[i % pool.length] || '';
    let name = '', nation = '';
    try {
      const j = JSON.parse(await readText(join(paths.ac.content, 'cars', car, 'skins', s, 'ui_skin.json')) || 'null');
      name = String(j?.drivername || '').trim(); nation = String(j?.country || '').trim().slice(0, 3).toUpperCase();
    } catch { /* no skin info */ }
    if (!name || entries.some(e => e.name === name)) [name, nation] = (names[i % names.length] || 'Driver,').split(',');
    // AC's launcher: the race strength is [RACE] AI_LEVEL; each car varies below 100 by up to "variation" %.
    entries.push({ skin: s, name, nation, level: Math.round(100 - Math.random() * ai.variation), aggression: ai.aggression });
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Launch

// selection: { car, skin, skins (all skin ids of the car), track, layout, session, maxOpponents }
// csp: readCsp() (WeatherFX, 24 hours, specific date); null without CSP.
export async function quickDrive(paths, { car, skin, skins = [], track, layout, session = defaultAcSession(), maxOpponents = 0, csp = null }) {
  const acDir = paths.ac.install;
  if (!acDir) throw new Error('Assetto Corsa install folder not found.');
  const acs = join(acDir, 'acs.exe');
  if (!(await exists(acs))) throw new Error(`acs.exe not found in ${acDir}`);

  const racing = session.mode === 'race' || session.mode === 'weekend';
  const count = racing ? Math.max(1, Math.min(session.ai.count, maxOpponents || session.ai.count)) : 0;
  if (count && !(await hasAiLine(paths, track, layout))) {
    throw new Error("This track layout has no AI line (ai/fast_lane.ai), so it can't have opponents. Pick Practice or Hotlap, or another track.");
  }

  const iniPath = join(paths.ac.cfg, 'race.ini');
  let ini = await readText(iniPath);
  if (ini == null) {
    ini = TEMPLATE;
  } else if (!(await exists(iniPath + '.launcher-backup'))) {
    await writeText(iniPath + '.launcher-backup', ini);
  }

  // Car and track.
  ini = setIni(ini, 'RACE', 'MODEL', car);
  ini = setIni(ini, 'RACE', 'MODEL_CONFIG', '');
  ini = setIni(ini, 'RACE', 'SKIN', skin || '');
  ini = setIni(ini, 'RACE', 'TRACK', track);
  ini = setIni(ini, 'RACE', 'CONFIG_TRACK', layout || '');
  ini = setIni(ini, 'CAR_0', 'MODEL', '-');
  ini = setIni(ini, 'CAR_0', 'SKIN', skin || '');

  // Sessions (AC's launcher: _defineSession).
  ini = removeSections(ini, /^SESSION_\d+$/i);
  const sessions = [];
  const add = (name, type, { laps, minutes = 0, spawn, position } = {}) => sessions.push({ name, type, laps, minutes, spawn, position });
  if (session.mode === 'practice') add('Practice', 1, { minutes: session.practice.minutes, spawn: 'PIT' });
  if (session.mode === 'hotlap') add('Hotlap', 4, { spawn: 'HOTLAP_START' });
  if (session.mode === 'race') {
    const p = session.race.startPos === -1 ? 1 + Math.floor(Math.random() * (count + 1)) : session.race.startPos === 0 ? count + 1 : Math.min(session.race.startPos, count + 1);
    add('Quick Race', 3, { laps: session.race.laps, spawn: 'START', position: p });
  }
  if (session.mode === 'weekend') {
    if (session.weekend.practice > 0) add('Practice', 1, { minutes: session.weekend.practice, spawn: 'PIT' });
    add('Qualifying', 2, { minutes: session.weekend.qualifying, spawn: 'PIT' });
    add('Race', 3, { laps: session.weekend.laps, spawn: 'START' });
  }
  sessions.forEach((s, i) => {
    const sec = `SESSION_${i}`;
    ini = setIni(ini, sec, 'NAME', s.name);
    ini = setIni(ini, sec, 'TYPE', s.type);
    if (s.laps != null) ini = setIni(ini, sec, 'LAPS', s.laps);
    ini = setIni(ini, sec, 'DURATION_MINUTES', s.minutes);
    if (s.position != null) ini = setIni(ini, sec, 'STARTING_POSITION', s.position);
    ini = setIni(ini, sec, 'SPAWN_SET', s.spawn);
  });
  const laps = session.mode === 'race' ? session.race.laps : session.mode === 'weekend' ? session.weekend.laps : 0;
  if (laps) ini = setIni(ini, 'RACE', 'RACE_LAPS', laps);

  // Opponents: the player's car with other skins.
  ini = removeSections(ini, /^CAR_([1-9]\d*)$/i);
  ini = setIni(ini, 'RACE', 'CARS', count + 1);
  if (count) {
    ini = setIni(ini, 'RACE', 'AI_LEVEL', session.ai.strength);
    const opponents = await opponentEntries(paths, { car, skin, skins }, { ...session.ai, count });
    opponents.forEach((o, i) => {
      const sec = `CAR_${i + 1}`;
      for (const [k, v] of [['MODEL', car], ['MODEL_CONFIG', ''], ['SKIN', o.skin], ['SETUP', ''], ['AI_LEVEL', o.level], ['AI_AGGRESSION', o.aggression],
        ['DRIVER_NAME', o.name], ['NATIONALITY', ''], ['NATION_CODE', o.nation], ['BALLAST', 0], ['RESTRICTOR', 0]]) ini = setIni(ini, sec, k, v);
    });
  }
  ini = setIni(ini, 'RACE', 'PENALTIES', session.penalties ? 1 : 0);

  // Time (any hour with CSP; AC alone takes 08:00-18:00), weather, temperatures, grip.
  const time = csp?.features?.CONDITIONS_24H ? session.time : Math.min(18 * 60, Math.max(8 * 60, session.time));
  ini = setIni(ini, 'LIGHTING', 'SUN_ANGLE', (16 * (time / 60 - 13)).toFixed(2));
  ini = deleteKeys(ini, 'LIGHTING', /^__CM_UNCLAMPED_SUN_ANGLE$/i); // older CSP's key; Content Manager removes it too
  ini = setIni(ini, 'LIGHTING', 'TIME_MULT', session.speed);
  ini = deleteKeys(ini, 'LIGHTING', /^__TRACK_/i); // Content Manager's location of the previous track
  const weathers = await acWeathers(paths);
  let weather = weathers.find(w => w.id === session.weather) || { id: session.weather, coeff: 1 };
  if (csp?.wfx) {
    // WeatherFX: CSP draws the chosen type; [WEATHER] NAME gets a preset that fits it.
    // Only controllers readCsp offers (Pure's only with a Pure style); a saved one
    // that isn't offered any more falls back to the default.
    const offered = (id, follows) => csp.controllers.some(c => c.id === id && c.followsWeather === follows);
    const own = session.cspWeather.startsWith('ctrl:') ? session.cspWeather.slice(5) : '';
    const ctrl = offered(own, false) ? own : '';
    const type = own || Number.isNaN(Number(session.cspWeather)) ? 15 : Number(session.cspWeather);
    weather = presetForType(weathers, type);
    ini = setIni(ini, 'LIGHTING', '__CM_WEATHER_TYPE', type);
    ini = setIni(ini, 'LIGHTING', '__CM_WEATHER_CONTROLLER', ctrl || (offered(session.wfxController, true) ? session.wfxController : '') || csp.baseController);
    ini = deleteKeys(ini, 'LIGHTING', /^__CM_WEATHER_(HUMIDITY|PRESSURE)$/i);
  } else if (/__CM_WEATHER_TYPE/i.test(ini)) {
    // Keep Content Manager's key in step with the preset so CSP doesn't show the old weather.
    const type = weather.type ?? CM_WEATHER_TYPE[weather.id];
    ini = type != null ? setIni(ini, 'LIGHTING', '__CM_WEATHER_TYPE', type) : deleteKeys(ini, 'LIGHTING', /^__CM_WEATHER_(TYPE|CONTROLLER)$/i);
  }
  const unix = csp?.features?.CONDITIONS_SPECIFIC_DATE ? dateToUnix(session.date) : null;
  ini = unix != null ? setIni(ini, 'LIGHTING', '__CM_DATE', unix) : deleteKeys(ini, 'LIGHTING', /^__CM_DATE$/i);
  ini = setIni(ini, 'WEATHER', 'NAME', weather.id);
  ini = setIni(ini, 'TEMPERATURE', 'AMBIENT', session.air);
  ini = setIni(ini, 'TEMPERATURE', 'ROAD', session.road === 'auto' ? roadTemperature(time, session.air, weather.coeff) : session.road);
  ini = setIni(ini, 'WIND', 'SPEED_KMH_MIN', session.wind.speed);
  ini = setIni(ini, 'WIND', 'SPEED_KMH_MAX', session.wind.speed + session.wind.gusts);
  ini = setIni(ini, 'WIND', 'DIRECTION_DEG', session.wind.dir);
  const grip = AC_GRIP.find(g => g.id === session.grip) || AC_GRIP[5];
  ini = setIni(ini, 'DYNAMIC_TRACK', 'PRESET', AC_GRIP.indexOf(grip));
  ini = setIni(ini, 'DYNAMIC_TRACK', 'SESSION_START', grip.start);
  ini = setIni(ini, 'DYNAMIC_TRACK', 'RANDOMNESS', grip.randomness);
  ini = setIni(ini, 'DYNAMIC_TRACK', 'LAP_GAIN', grip.lapGain);
  ini = setIni(ini, 'DYNAMIC_TRACK', 'SESSION_TRANSFER', grip.transfer);

  // Replays and benchmark mode would hijack the session if left on.
  ini = setIni(ini, 'REPLAY', 'ACTIVE', '0');
  ini = setIni(ini, 'BENCHMARK', 'ACTIVE', '0');
  ini = setIni(ini, 'REMOTE', 'ACTIVE', '0');
  await writeText(iniPath, ini);
  await writeAssists(paths, session.assists);

  log(`quick drive ${session.mode} ${car}/${skin} @ ${track}/${layout} ai ${count} weather ${csp?.wfx ? session.cspWeather : weather.id}`);
  // Linux: acs.exe runs in AC's Proton prefix, like Steam would start it. CSP is
  // AC's dwrite.dll, which Wine only loads with an override.
  if (IS_LINUX) {
    const dllOverrides = (await exists(join(acDir, 'dwrite.dll'))) ? PROTON_DLL_OVERRIDE : '';
    await runWithProton({ exe: acs, cwd: acDir, appid: 244210, installDir: acDir, steamPath: paths.steam, dllOverrides });
  } else await startProcess(acs, acDir);
}

// cfg\assists.ini, as AC's launcher and Content Manager write it before a drive.
async function writeAssists(paths, a) {
  if (!a) return;
  const path = join(paths.ac.cfg, 'assists.ini');
  let text = await readText(path);
  if (text != null && !(await exists(path + '.launcher-backup'))) await writeText(path + '.launcher-backup', text);
  text = text ?? '[ASSISTS]\r\n';
  for (const [k, key] of Object.entries(ASSIST_KEYS)) if (a[k] != null) text = setIni(text, 'ASSISTS', key, a[k]);
  await writeText(path, text);
}
