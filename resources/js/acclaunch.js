// Assetto Corsa Competizione quick launch. ACC can't be started straight into a
// session: it has no command-line option for it, and its track maps are inside
// an encrypted package. So this pre-selects the Single Player menu instead. ACC
// keeps every menu choice in Documents\Assetto Corsa Competizione\Config\
// menuSettings.json (UTF-8, tabs, CRLF), reads it at startup and rewrites it on exit:
//   singlePlayerSeason                         championship season (BP_2019 … BP_2025, IGT_2019, GT4_2019, BGT_2019, GT2_2023, Free)
//   seasonGameMode[season]                     game mode the Single Player page opens on
//   seasonRaceEventData[season].raceEventData[mode]
//     carName        official entry code ("E9_563_1") or a custom car file ("<name>.json" in Customs\Cars)
//     trackName, opponentCount, positionOnGrid, skillMultiplier, aggroMultiplier,
//     timeOfDay (hour), timeMultiplier, practiceLength / qualifyLength / raceLength (seconds)
//   globalSeasonTrackName[season], globalOpponentCount/Skill/Aggro, globalPositionOnGrid
//   weatherType                                EWeatherPresetType: Sunny, Cloudy, LightRain, MediumRain, HeavyRain, ThunderStorm, Random
// Mode names are ACC's EGuiGameModes values; track ids are those of the ACC server.
import { join, exists, listDir, readTextAnyEncoding, parseLooseJson, fileUrl, mountDir, log, powershell } from './util.js';

export const ACC_TRACKS = [
  ['barcelona', 'Barcelona', 'Spain'], ['brands_hatch', 'Brands Hatch', 'United Kingdom'], ['cota', 'Circuit of the Americas', 'USA'],
  ['donington', 'Donington Park', 'United Kingdom'], ['hungaroring', 'Hungaroring', 'Hungary'], ['imola', 'Imola', 'Italy'],
  ['indianapolis', 'Indianapolis', 'USA'], ['kyalami', 'Kyalami', 'South Africa'], ['laguna_seca', 'Laguna Seca', 'USA'],
  ['misano', 'Misano', 'Italy'], ['monza', 'Monza', 'Italy'], ['mount_panorama', 'Mount Panorama', 'Australia'],
  ['nurburgring', 'Nürburgring', 'Germany'], ['nurburgring_24h', 'Nürburgring 24h', 'Germany'], ['oulton_park', 'Oulton Park', 'United Kingdom'],
  ['paul_ricard', 'Paul Ricard', 'France'], ['red_bull_ring', 'Red Bull Ring', 'Austria'], ['silverstone', 'Silverstone', 'United Kingdom'],
  ['snetterton', 'Snetterton', 'United Kingdom'], ['spa', 'Spa-Francorchamps', 'Belgium'], ['suzuka', 'Suzuka', 'Japan'],
  ['valencia', 'Valencia', 'Spain'], ['watkins_glen', 'Watkins Glen', 'USA'], ['zandvoort', 'Zandvoort', 'Netherlands'],
  ['zolder', 'Zolder', 'Belgium'],
].map(([id, name, country]) => ({ id, name, country }));

export const ACC_MODES = { Practice: 'Practice', Hotlap: 'Hotlap', Hotstint: 'Hotstint', QuickRace: 'Quick Race', CustomRace: 'Race Weekend' };
export const ACC_WEATHER = [['Sunny', 'Sunny'], ['Cloudy', 'Cloudy'], ['LightRain', 'Light rain'], ['MediumRain', 'Rain'], ['HeavyRain', 'Heavy rain'], ['ThunderStorm', 'Thunderstorm'], ['Random', 'Random']];
export const ACC_TIME_SPEEDS = [1, 2, 3, 5, 10, 24];

export function accSeasonName(id) {
  const m = /^(BP|IGT|GT4|BGT|GT2)_(\d{4})$/.exec(id);
  if (id === 'Free') return 'Free selection';
  if (!m) return id;
  return `${{ BP: 'GT World Challenge Europe', IGT: 'Intercontinental GT Challenge', GT4: 'GT4 European Series', BGT: 'British GT', GT2: 'GT2 European Series' }[m[1]]} ${m[2]}`;
}

const menuPath = paths => join(paths.acc.config, 'menuSettings.json');

async function readMenu(paths) {
  const text = await readTextAnyEncoding(menuPath(paths));
  if (!text) throw new Error("ACC's menu settings weren't found. Start ACC once, then try again.");
  return JSON.parse(text.replace(/^﻿/, ''));
}

// ACC's own JSON layout (Unreal's pretty printer): tabs, CRLF, an object value's
// brace on its own line, floats with 17 significant digits, no final newline.
// Parsing and writing back an unchanged file gives the same bytes.
function accJson(v, ind = '') {
  if (Array.isArray(v)) return v.length ? `[\r\n${v.map(x => `${ind}\t${accJson(x, ind + '\t')}`).join(',\r\n')}\r\n${ind}]` : '[]';
  if (v && typeof v === 'object') {
    const keys = Object.keys(v);
    if (!keys.length) return `{\r\n${ind}}`;
    const member = k => {
      const x = v[k], obj = x && typeof x === 'object' && !Array.isArray(x);
      return `${ind}\t${JSON.stringify(k)}:${obj ? `\r\n${ind}\t` : ' '}${accJson(x, ind + '\t')}`;
    };
    return `{\r\n${keys.map(member).join(',\r\n')}\r\n${ind}}`;
  }
  if (typeof v === 'number' && !Number.isInteger(v) && Number.isFinite(v)) {
    const p = v.toPrecision(17);
    return p.includes('e') ? p : p.replace(/0+$/, '').replace(/\.$/, '');
  }
  return JSON.stringify(v);
}

export function defaultAccSession() {
  return {
    season: 'BP_2019', mode: 'Practice',
    practice: 10, qualifying: 10, race: 20, stint: 10,
    opponents: 20, startPos: 1, skill: 90, aggro: 50,
    time: 14, speed: 1, weather: 'Sunny',
  };
}

// The session ACC's Single Player page currently has, plus the seasons it knows.
export async function readAccSession(paths) {
  const s = defaultAccSession();
  const menu = await readMenu(paths);
  const seasons = Object.keys(menu.seasonRaceEventData || {});
  if (seasons.includes(menu.singlePlayerSeason)) s.season = menu.singlePlayerSeason;
  const mode = menu.seasonGameMode?.[s.season];
  if (ACC_MODES[mode]) s.mode = mode;
  const e = menu.seasonRaceEventData?.[s.season]?.raceEventData?.[s.mode] || {};
  const min = (sec, fallback) => sec > 0 ? Math.round(sec / 60) : fallback;
  if (s.mode === 'Hotstint') s.stint = min(e.raceLength, s.stint);
  else {
    s.practice = e.practiceLength > 0 ? min(e.practiceLength) : (s.mode === 'CustomRace' ? 0 : s.practice);
    s.qualifying = min(e.qualifyLength, s.qualifying);
    s.race = min(e.raceLength, s.race);
  }
  if (e.opponentCount > 0) s.opponents = e.opponentCount;
  if (e.positionOnGrid > 0) s.startPos = e.positionOnGrid;
  if (e.skillMultiplier > 0) s.skill = e.skillMultiplier;
  if (e.aggroMultiplier >= 0) s.aggro = e.aggroMultiplier;
  if (e.timeOfDay >= 0) s.time = e.timeOfDay;
  if (e.timeMultiplier > 0) s.speed = e.timeMultiplier;
  if (ACC_WEATHER.some(([id]) => id === menu.weatherType)) s.weather = menu.weatherType;
  return { session: s, seasons, car: e.carName || '', track: e.trackName || '' };
}

// Custom cars (Customs\Cars\*.json): { file, team, number, model, image }.
export async function accCustomCars(paths) {
  const dir = join(paths.acc.customs, 'Cars');
  await mountDir('/m/competizione', paths.acc.customs);
  const out = [];
  for (const f of (await listDir(dir)).filter(e => e.type === 'FILE' && /\.json$/i.test(e.entry))) {
    const data = parseLooseJson(await readTextAnyEncoding(join(dir, f.entry)));
    if (!data || data.carModelType == null) continue;
    let image = '';
    if (data.customSkinName) {
      const livery = join(paths.acc.customs, 'Liveries', data.customSkinName);
      const files = (await listDir(livery)).map(e => e.entry);
      const pic = files.find(x => /^preview\.(png|jpe?g|webp)$/i.test(x)) || files.find(x => /^decals\.(png|jpe?g)$/i.test(x)) || files.find(x => /^sponsors\.(png|jpe?g)$/i.test(x));
      if (pic) image = fileUrl(join(livery, pic));
    }
    out.push({ file: f.entry, team: data.teamName || '', number: data.raceNumber, model: data.carModelType, image });
  }
  return out;
}

// ACC's official team entries are only named by code ("E9_563_1"), so to drive
// any car model the launcher makes a plain custom car for it, as ACC's own car
// creator would: Customs\Cars\Launcher - <model>.json (UTF-16 LE with BOM).
// skinTemplateKey 99 with no customSkinName gives the model's plain paint.
// Returns the file name to use as carName; an existing file is reused.
export async function ensureModelCar(paths, model, name) {
  const dir = join(paths.acc.customs, 'Cars');
  const file = `Launcher - ${name.replace(/[\\/:*?"<>|]/g, '')}.json`;
  if (await exists(join(dir, file))) return file;
  const car = {
    carGuid: 0, teamGuid: 0, raceNumber: 99, raceNumberPadding: 0, auxLightKey: 0, auxLightColor: 241,
    skinTemplateKey: 99, skinColor1Id: 1, skinColor2Id: 1, skinColor3Id: 1, sponsorId: 1,
    skinMaterialType1: 0, skinMaterialType2: 0, skinMaterialType3: 0,
    rimColor1Id: 1, rimColor2Id: 1, rimMaterialType1: 2, rimMaterialType2: 4,
    teamName: name, nationality: 0, displayName: '', competitorName: '', competitorNationality: 0,
    teamTemplateKey: 0, carModelType: model, cupCategory: 0, licenseType: 0, useEnduranceKit: 1,
    customSkinName: '', bannerTemplateKey: 0,
  };
  const text = accJson(car);
  const bytes = new Uint8Array(2 + text.length * 2);
  bytes[0] = 0xFF; bytes[1] = 0xFE;
  for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); bytes[2 + i * 2] = c & 255; bytes[3 + i * 2] = c >> 8; }
  await Neutralino.filesystem.createDirectory(dir).catch(() => {});
  await Neutralino.filesystem.writeBinaryFile(join(dir, file), bytes.buffer);
  log(`acc: created custom car ${file} (model ${model})`);
  return file;
}

// Car models that come with a paid DLC (Steam app id -> carModelType ids, from
// each pack's store page); every other model is in the base game.
export const ACC_DLC_CARS = {
  1337860: [50, 51, 52, 53, 55, 56, 57, 58, 59, 60, 61], // GT4 Pack
  1449260: [24, 25],                                     // 2020 GT World Challenge Pack
  1865950: [26, 27, 28, 29, 31],                         // Challengers Pack
  2328720: [32, 33, 34],                                 // 2023 GT World Challenge Pack
  2700600: [80, 82, 83, 84, 85, 86],                     // GT2 Pack
};

// Tracks and championship seasons that come with a DLC (app id -> ids); the rest
// are in the base game.
export const ACC_DLC_TRACKS = {
  1201360: ['kyalami', 'suzuka', 'laguna_seca', 'mount_panorama'], // Intercontinental GT Pack
  1449260: ['imola'],                                              // 2020 GT World Challenge Pack
  1493170: ['oulton_park', 'donington', 'snetterton'],             // British GT Pack
  1865970: ['cota', 'indianapolis', 'watkins_glen'],               // American Track Pack
  2328720: ['valencia'],                                           // 2023 GT World Challenge Pack
  2700600: ['red_bull_ring'],                                      // GT2 Pack
  2700610: ['nurburgring_24h'],                                    // 24H Nürburgring Pack
};
export const ACC_DLC_SEASONS = { 1201360: ['IGT_2019'], 1449260: ['BP_2020'], 1493170: ['BGT_2019'], 1337860: ['GT4_2019'], 2328720: ['BP_2023'], 2700600: ['GT2_2023'] };

// DLC app ids the Steam account owns, from ACC's app ownership ticket that Steam
// caches in userdata\<account>\config\localconfig.vdf ("apptickets" > "805550").
// Ticket layout: size u32, version u32, steamid u64, appid u32, external ip u32,
// internal ip u32, flags u32, issued u32, expires u32, license count u16 +
// u32 each, dlc count u16, then per DLC: appid u32, license count u16 + u32 each.
// Returns null when unknown (the caller then lists every car).
export async function accOwnedDlcs(steamPath, installDir) {
  try {
    // The manifest sits in the game's Steam library (or the main one, if the folder was set by hand).
    const manifest = (installDir && await readTextAnyEncoding(join(installDir, '../../appmanifest_805550.acf')))
      || (steamPath && await readTextAnyEncoding(join(steamPath, 'steamapps/appmanifest_805550.acf')));
    const owner = /"LastOwner"\s+"(\d+)"/.exec(manifest || '')?.[1];
    if (!steamPath || !owner) return null;
    const account = String(BigInt(owner) - 76561197960265728n);
    const config = await readTextAnyEncoding(join(steamPath, 'userdata', account, 'config/localconfig.vdf'));
    const hex = /"805550"\s+"([0-9a-f]{80,})"/i.exec(config || '')?.[1];
    if (!hex) return null;
    const b = new Uint8Array(hex.match(/../g).map(h => parseInt(h, 16)));
    const dv = new DataView(b.buffer);
    if (dv.getUint32(16, true) !== 805550) return null;
    let o = 40;
    o += 2 + dv.getUint16(o, true) * 4;
    const owned = new Set();
    for (let n = dv.getUint16(o, true), i = 0, p = o + 2; i < n; i++) {
      owned.add(dv.getUint32(p, true));
      p += 6 + dv.getUint16(p + 4, true) * 4;
    }
    return owned;
  } catch (err) {
    log(`acc dlcs: ${err?.message || err}`);
    return null;
  }
}

// Whether a car model is playable with these DLCs (null = unknown: yes).
const inOwned = (table, id, owned) => !owned || Object.entries(table).every(([app, ids]) => !ids.includes(id) || owned.has(Number(app)));
export const accModelOwned = (model, owned) => inOwned(ACC_DLC_CARS, Number(model), owned);
export const accTrackOwned = (track, owned) => inOwned(ACC_DLC_TRACKS, track, owned);
export const accSeasonOwned = (season, owned) => inOwned(ACC_DLC_SEASONS, season, owned);

// Class of an ACC car model id.
export const accModelClass = id => id >= 80 ? 'GT2' : id >= 50 ? 'GT4' : ({ 9: 'Cup', 28: 'Cup', 18: 'Super Trofeo', 29: 'Super Trofeo', 26: 'Challenge', 27: 'TCX' })[id] || 'GT3';

export async function isAccRunning() {
  const r = await powershell('(Get-Process AC2-Win64-Shipping -ErrorAction SilentlyContinue | Measure-Object).Count');
  return Number(r.stdOut.trim()) > 0;
}

// Write the session into ACC's menu settings. `car` is a custom car file name
// ('' keeps the car chosen in ACC), `track` an ACC track id.
export async function writeAccSession(paths, { session: s, car, track }) {
  if (await isAccRunning()) throw new Error('Close Assetto Corsa Competizione first: it saves its menu over these settings when it exits.');
  const file = menuPath(paths);
  const raw = new Uint8Array(await Neutralino.filesystem.readBinaryFile(file));
  const bak = `${file}.launcher-backup`;
  if (!(await exists(bak))) await Neutralino.filesystem.writeBinaryFile(bak, raw.slice().buffer);
  const menu = await readMenu(paths);

  const season = s.season;
  const events = ((menu.seasonRaceEventData ||= {})[season] ||= { raceEventData: {} }).raceEventData ||= {};
  // A mode ACC hasn't used in this season yet starts from one it has.
  const e = events[s.mode] ||= { ...(events.Practice || Object.values(events)[0] || {}) };
  if (car) e.carName = car;
  e.trackName = track;
  e.timeOfDay = s.time;
  e.timeMultiplier = s.speed;
  const racing = s.mode === 'QuickRace' || s.mode === 'CustomRace';
  if (s.mode === 'Practice') e.practiceLength = s.practice * 60;
  if (s.mode === 'Hotstint') e.raceLength = s.stint * 60;
  if (s.mode === 'QuickRace') e.raceLength = s.race * 60;
  if (s.mode === 'CustomRace') {
    e.practiceLength = s.practice * 60;
    e.qualifyLength = s.qualifying * 60;
    e.raceLength = s.race * 60;
    for (const k of ['p1_TimeOfDay', 'q_TimeOfDay', 'r1_TimeOfDay']) if (k in e) e[k] = s.time;
  }
  if (racing) {
    e.opponentCount = s.opponents;
    e.positionOnGrid = Math.min(s.startPos, s.opponents + 1);
    e.skillMultiplier = s.skill;
    e.aggroMultiplier = s.aggro;
    Object.assign(menu, { globalOpponentCount: s.opponents, globalOpponentSkill: s.skill, globalOpponentAggro: s.aggro, globalPositionOnGrid: e.positionOnGrid });
  }
  menu.singlePlayerSeason = season;
  (menu.seasonGameMode ||= {})[season] = s.mode;
  (menu.globalSeasonTrackName ||= {})[season] = track;
  menu.weatherType = s.weather;

  const text = accJson(menu);
  const utf16 = raw[0] === 0xFF || (raw[1] === 0 && raw[0] !== 0);
  if (utf16) {
    const bytes = new Uint8Array(text.length * 2 + (raw[0] === 0xFF ? 2 : 0));
    let o = 0;
    if (raw[0] === 0xFF) { bytes[o++] = 0xFF; bytes[o++] = 0xFE; }
    for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); bytes[o++] = c & 255; bytes[o++] = c >> 8; }
    await Neutralino.filesystem.writeBinaryFile(file, bytes.buffer);
  } else {
    await Neutralino.filesystem.writeBinaryFile(file, new TextEncoder().encode(text).buffer);
  }
  log(`acc session: ${season} ${s.mode} ${track} ${car || '(ACC car)'} ${JSON.stringify(s)}`);
}
