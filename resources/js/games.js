// Game catalogue and per-game content scanners. Each scanner returns plain
// "item" objects the UI renders as cards:
//   { id, kind, title, subtitle, image, fallbackImage, overlay, tags, description,
//     isMod, enabled, path, url, version, meta }
import {
  join, norm, basename, listDir, readText, readTextAnyEncoding, parseLooseJson,
  cleanText, prettifyId, mapLimit, mountDir, fileUrl, exists, log, ensureDir as ensureDirs,
} from './util.js';
import { readModInfo, pruneCache, readEvoCatalog } from './kspkg.js';
import { ddsThumbnail } from './dds.js';
import { scanScreenshots, scanReplays, mediaFolders } from './media.js';

export const GAMES = [
  {
    key: 'ac', appid: 244210, title: 'Assetto Corsa', sub: '',
    headline: 'Your Platform for Driving',
    blurb: 'The simulator that started it all. Laser-scanned tracks, a legendary roster of road and race cars, and the deepest modding scene in sim racing. Thousands of community cars and circuits, all managed from one place, ready to drive in a single click.',
    tabs: [{ id: 'cars', label: 'Cars' }, { id: 'tracks', label: 'Tracks' }, { id: 'screens', label: 'Screenshots' }, { id: 'replays', label: 'Replays' }],
  },
  {
    key: 'acc', appid: 805550, title: 'Assetto Corsa', sub: 'Competizione',
    headline: 'The Official GT World Challenge Game',
    blurb: 'The official GT World Challenge game. Real GT3 and GT4 machinery, laser-scanned circuits, dynamic weather and a full day-night cycle. Build your own team identity with custom liveries and take it online against the best drivers in the world.',
    tabs: [{ id: 'liveries', label: 'Liveries' }, { id: 'screens', label: 'Screenshots' }, { id: 'replays', label: 'Replays' }],
  },
  {
    key: 'evo', appid: 3058630, title: 'Assetto Corsa', sub: 'EVO',
    headline: 'The Next Evolution',
    blurb: 'The next generation of Assetto Corsa. A new physics and tyre model, laser-scanned circuits and an ever-growing roster of road and race cars. Community car mods load straight from your Saved Games folder.',
    tabs: [{ id: 'cars', label: 'Cars' }, { id: 'tracks', label: 'Tracks' }, { id: 'liveries', label: 'Liveries' }, { id: 'screens', label: 'Screenshots' }, { id: 'replays', label: 'Replays' }],
  },
  {
    key: 'rally', appid: 3917090, title: 'Assetto Corsa', sub: 'Rally',
    headline: 'The Stage Is Set',
    blurb: 'Assetto Corsa Rally is a realistic rally simulator focused on precision and challenge. With 3D laser-scanned stages and vehicles, professional co-driver assistance, and variable conditions, it offers a demanding and immersive experience where every second behind the wheel counts.',
    tabs: [{ id: 'liveries', label: 'Liveries' }, { id: 'screens', label: 'Screenshots' }],
  },
];

export const gameByKey = key => GAMES.find(g => g.key === key);

// ---------------------------------------------------------------------------
// Paths

// Resolved per game: install dir (from Steam) and content dirs. Settings can
// override any of them.
export async function resolvePaths(installed, overrides = {}) {
  const home = norm(await Neutralino.os.getEnv('USERPROFILE'));
  let docs = home + '/Documents';
  try { docs = norm(await Neutralino.os.getPath('documents')); } catch { /* default */ }
  const local = norm(await Neutralino.os.getEnv('LOCALAPPDATA').catch(() => '')) || home + '/AppData/Local';

  const p = {};
  const ac = overrides.ac_install || installed['244210'];
  p.ac = { install: ac || '', content: ac ? join(ac, 'content') : '', cfg: join(docs, 'Assetto Corsa/cfg') };

  p.acc = {
    install: overrides.acc_install || installed['805550'] || '',
    customs: overrides.acc_customs || join(docs, 'Assetto Corsa Competizione/Customs'),
    config: join(docs, 'Assetto Corsa Competizione/Config'),
  };

  const ace = join(home, 'Saved Games/ACE');
  p.evo = {
    install: overrides.evo_install || installed['3058630'] || '',
    mods: overrides.evo_mods || join(ace, 'mods'),
    // External liveries: ExternalLiveries\<folder>\external_livery.json, plus the
    // matching car in ProfileData\<profile>\OpenData\SavedCars.
    liveries: overrides.evo_liveries || join(ace, 'ExternalLiveries'),
    profiles: join(ace, 'ProfileData'),
  };

  const rally = overrides.rally_install || installed['3917090'] || '';
  p.rally = {
    install: rally,
    paks: overrides.rally_paks || (rally ? join(rally, 'acr/Content/Paks') : ''),
    // Native custom liveries: <liveries>\<CarId>\<LiveryName>\livery.json + icon.png + body_livery_*.dds
    liveries: overrides.rally_liveries || join(docs, 'My Games/acr/Liveries'),
    // Player data, including the Free Practice selection (see rallylaunch.js).
    save: join(local, 'acr/Saved/SaveGames/PlayerDataSaveSlot.sav'),
  };
  return p;
}

// ---------------------------------------------------------------------------
// Assetto Corsa

// Base-game Kunos cars without the ks_ prefix. Everything else without ks_ is a mod.
const AC_KUNOS_CARS = new Set(('abarth500 abarth500_s1 alfa_romeo_giulietta_qv alfa_romeo_giulietta_qv_le bmw_1m bmw_1m_s3 ' +
  'bmw_m3_e30 bmw_m3_e30_drift bmw_m3_e30_dtm bmw_m3_e30_gra bmw_m3_e30_s1 bmw_m3_e92 bmw_m3_e92_drift bmw_m3_e92_s1 ' +
  'bmw_m3_gt2 bmw_z4 bmw_z4_drift bmw_z4_gt3 bmw_z4_s1 ferrari_312t ferrari_458 ferrari_458_gt2 ferrari_458_s3 ' +
  'ferrari_599xxevo ferrari_f40 ferrari_f40_s3 ferrari_laferrari ktm_xbow_r lotus_2_eleven lotus_2_eleven_gt4 lotus_49 ' +
  'lotus_98t lotus_elise_sc lotus_elise_sc_s1 lotus_elise_sc_s2 lotus_evora_gtc lotus_evora_gte lotus_evora_gte_carbon ' +
  'lotus_evora_gx lotus_evora_s lotus_evora_s_s2 lotus_exige_240 lotus_exige_240_s3 lotus_exige_s lotus_exige_s_roadster ' +
  'lotus_exige_scura lotus_exige_v6_cup lotus_exos_125 lotus_exos_125_s1 mclaren_mp412c mclaren_mp412c_gt3 mercedes_sls ' +
  'mercedes_sls_gt3 p4-5_2011 pagani_huayra pagani_zonda_r ruf_yellowbird shelby_cobra_427sc tatuusfa1').split(' '));
const AC_KUNOS_TRACKS = new Set('drift imola magione monza mugello spa trento-bondone'.split(' '));

const isKunosAuthor = a => /kunos/i.test(a || '');

export async function scanAcCars(paths) {
  if (!paths.ac.content) return [];
  await mountDir('/m/assettocorsa', paths.ac.content);
  const root = join(paths.ac.content, 'cars');
  const dirs = (await listDir(root)).filter(e => e.type === 'DIRECTORY');

  const items = await mapLimit(dirs, 10, async d => {
    const dir = join(root, d.entry);
    const ui = parseLooseJson(await readText(join(dir, 'ui/ui_car.json')));
    if (!ui) return null; // unowned DLC stubs ship without a ui folder

    const skins = (await listDir(join(dir, 'skins'))).filter(e => e.type === 'DIRECTORY').map(e => e.entry).sort();
    const kunosId = d.entry.startsWith('ks_') || AC_KUNOS_CARS.has(d.entry);
    const isMod = ui.author ? !isKunosAuthor(ui.author) : !kunosId;
    return {
      id: d.entry, kind: 'car', game: 'ac',
      title: cleanText(ui.name) || prettifyId(d.entry),
      subtitle: [ui.brand, ui.class].filter(Boolean).join(' · '),
      author: isMod ? (ui.author || 'Unknown author') : 'Kunos Simulazioni',
      version: ui.version || '',
      url: ui.url || '',
      image: skins.length ? fileUrl(join(dir, 'skins', skins[0], 'preview.jpg')) : '',
      fallbackImage: fileUrl(join(dir, 'ui/badge.png')),
      badge: fileUrl(join(dir, 'ui/badge.png')),
      tags: (ui.tags || []).map(t => String(t).replace(/^#/, '')).slice(0, 8),
      description: cleanText(ui.description),
      specs: ui.specs || null,
      year: ui.year || '', brand: cleanText(ui.brand) || '',
      country: ui.country || '',
      isMod, enabled: true, path: dir,
      skins: skins.map(s => ({ id: s, image: fileUrl(join(dir, 'skins', s, 'preview.jpg')), livery: fileUrl(join(dir, 'skins', s, 'livery.png')) })),
    };
  });
  return items.filter(Boolean).sort((a, b) => a.title.localeCompare(b.title));
}

async function readTrackLayout(uiDir, layoutId) {
  const ui = parseLooseJson(await readText(join(uiDir, 'ui_track.json')));
  if (!ui) return null;
  return {
    id: layoutId, // '' means the default (single) layout
    name: cleanText(ui.name) || '',
    description: cleanText(ui.description),
    author: ui.author || '',
    version: ui.version || '',
    url: ui.url || '',
    country: ui.country || '', city: ui.city || '',
    length: ui.length || '', pitboxes: ui.pitboxes || '',
    tags: ui.tags || [],
    preview: fileUrl(join(uiDir, 'preview.png')),
    outline: fileUrl(join(uiDir, 'outline.png')),
  };
}

export async function scanAcTracks(paths) {
  if (!paths.ac.content) return [];
  await mountDir('/m/assettocorsa', paths.ac.content);
  const root = join(paths.ac.content, 'tracks');
  const dirs = (await listDir(root)).filter(e => e.type === 'DIRECTORY');

  const items = await mapLimit(dirs, 8, async d => {
    const dir = join(root, d.entry);
    const uiDir = join(dir, 'ui');
    const entries = await listDir(uiDir);
    const layouts = [];
    if (entries.some(e => e.entry.toLowerCase() === 'ui_track.json')) {
      const l = await readTrackLayout(uiDir, '');
      if (l) layouts.push(l);
    }
    for (const e of entries.filter(e => e.type === 'DIRECTORY')) {
      const l = await readTrackLayout(join(uiDir, e.entry), e.entry);
      if (l) layouts.push(l);
    }
    if (!layouts.length) return null;
    // Unowned DLC leaves a ui-only placeholder (and some mod layouts need that DLC's
    // models); without a .kn5 AC can't load the track. Opponents need an AI line.
    const files = await listDir(dir);
    const hasKn5 = list => list.some(e => e.type !== 'DIRECTORY' && /\.kn5$/i.test(e.entry));
    let playable = hasKn5(files);
    for (const l of layouts) {
      const sub = l.id ? await listDir(join(dir, l.id)) : files;
      if (l.id && hasKn5(sub)) playable = true;
      l.aiLine = await exists(join(dir, l.id, 'ai/fast_lane.ai'));
    }

    const main = layouts[0];
    const author = layouts.map(l => l.author).find(Boolean) || '';
    const kunosId = d.entry.startsWith('ks_') || AC_KUNOS_TRACKS.has(d.entry);
    const isMod = author ? !isKunosAuthor(author) : !kunosId;
    // Multi-layout tracks repeat the venue name in each layout ("Nordschleife - Endurance").
    const venue = layouts.length > 1 ? commonPrefix(layouts.map(l => l.name)) : main.name;
    return {
      id: d.entry, kind: 'track', game: 'ac',
      title: venue || prettifyId(d.entry),
      subtitle: [main.city, main.country].filter(Boolean).join(', '),
      author: isMod ? (author || 'Unknown author') : 'Kunos Simulazioni',
      version: layouts.map(l => l.version).find(Boolean) || '',
      url: layouts.map(l => l.url).find(Boolean) || '',
      image: main.preview, overlay: main.outline,
      tags: [...new Set(layouts.flatMap(l => l.tags))].slice(0, 8),
      description: main.description,
      isMod, enabled: true, path: dir,
      layouts, playable,
    };
  });
  return items.filter(Boolean).sort((a, b) => a.title.localeCompare(b.title));
}

function commonPrefix(names) {
  if (!names.length) return '';
  let p = names[0];
  for (const n of names) while (p && !n.startsWith(p)) p = p.slice(0, -1);
  return p.replace(/[\s\-–:(]+$/, '').trim();
}

// ---------------------------------------------------------------------------
// Assetto Corsa Competizione

// carModelType ids from the ACC broadcasting SDK.
export const ACC_CARS = {
  0: 'Porsche 991 GT3 R', 1: 'Mercedes-AMG GT3', 2: 'Ferrari 488 GT3', 3: 'Audi R8 LMS', 4: 'Lamborghini Huracán GT3',
  5: 'McLaren 650S GT3', 6: 'Nissan GT-R Nismo GT3 2018', 7: 'BMW M6 GT3', 8: 'Bentley Continental GT3 2018',
  9: 'Porsche 991 II GT3 Cup', 10: 'Nissan GT-R Nismo GT3 2017', 11: 'Bentley Continental GT3 2016',
  12: 'Aston Martin V12 Vantage GT3', 13: 'Lamborghini Gallardo R-EX', 14: 'Emil Frey Jaguar G3', 15: 'Lexus RC F GT3',
  16: 'Lamborghini Huracán GT3 Evo', 17: 'Honda NSX GT3', 18: 'Lamborghini Huracán ST', 19: 'Audi R8 LMS Evo',
  20: 'Aston Martin V8 Vantage GT3', 21: 'Honda NSX GT3 Evo', 22: 'McLaren 720S GT3', 23: 'Porsche 911 II GT3 R',
  24: 'Ferrari 488 GT3 Evo', 25: 'Mercedes-AMG GT3 2020', 26: 'Ferrari 488 Challenge Evo', 27: 'BMW M2 CS Racing',
  28: 'Porsche 992 GT3 Cup', 29: 'Lamborghini Huracán ST Evo2', 30: 'BMW M4 GT3', 31: 'Audi R8 LMS GT3 Evo II',
  32: 'Ferrari 296 GT3', 33: 'Lamborghini Huracán GT3 Evo2', 34: 'Porsche 992 GT3 R', 35: 'McLaren 720S GT3 Evo',
  36: 'Ford Mustang GT3', 50: 'Alpine A110 GT4', 51: 'Aston Martin V8 Vantage GT4', 52: 'Audi R8 LMS GT4', 53: 'BMW M4 GT4',
  55: 'Chevrolet Camaro GT4', 56: 'Ginetta G55 GT4', 57: 'KTM X-Bow GT4', 58: 'Maserati MC GT4', 59: 'McLaren 570S GT4',
  60: 'Mercedes-AMG GT4', 61: 'Porsche 718 Cayman GT4', 80: 'Audi R8 LMS GT2', 82: 'KTM X-Bow GT2', 83: 'Maserati MC20 GT2',
  84: 'Mercedes-AMG GT2', 85: 'Porsche 911 GT2 RS CS Evo', 86: 'Porsche 935',
};

export async function scanAccLiveries(paths) {
  const customs = paths.acc.customs;
  if (!customs || !(await exists(customs))) return [];
  await mountDir('/m/competizione', customs);

  // Car files link team/number/model to a livery folder via customSkinName.
  const carFiles = (await listDir(join(customs, 'Cars'))).filter(e => /\.json$/i.test(e.entry));
  const cars = (await mapLimit(carFiles, 8, async f => {
    const data = parseLooseJson(await readTextAnyEncoding(join(customs, 'Cars', f.entry)));
    return data ? { file: f.entry, ...data } : null;
  })).filter(Boolean);
  const carBySkin = new Map(cars.filter(c => c.customSkinName).map(c => [c.customSkinName.toLowerCase(), c]));

  const liveryDirs = (await listDir(join(customs, 'Liveries'))).filter(e => e.type === 'DIRECTORY');
  const items = await mapLimit(liveryDirs, 8, async d => {
    const dir = join(customs, 'Liveries', d.entry);
    const files = (await listDir(dir)).map(e => e.entry);
    const find = re => files.find(f => re.test(f));
    const preview = find(/^preview\.(png|jpe?g|webp)$/i);
    const decals = find(/^decals\.(png|jpe?g)$/i);
    const sponsors = find(/^sponsors\.(png|jpe?g)$/i);
    const car = carBySkin.get(d.entry.toLowerCase());
    const model = car ? ACC_CARS[car.carModelType] || `Car model #${car.carModelType}` : '';
    const imgs = [preview, decals, sponsors].filter(Boolean).map(f => fileUrl(join(dir, f)));
    return {
      id: d.entry, kind: 'livery', game: 'acc',
      title: car?.teamName || d.entry,
      subtitle: model || 'Livery folder',
      author: car?.displayName || '',
      number: car?.raceNumber ?? null,
      image: imgs[0] || '', gallery: imgs,
      tags: [car ? 'Linked car' : 'Livery only', decals || sponsors ? 'Custom textures' : 'Decal JSON only'],
      description: car
        ? `Livery folder "${d.entry}" is used by car file "${car.file}".`
        : `Livery folder "${d.entry}" has no matching car file in Customs/Cars.`,
      isMod: true, enabled: true, path: dir,
      meta: {
        carFile: car ? join(customs, 'Cars', car.file) : '', files,
        // Every car file that points at this livery (removed together on uninstall).
        carFiles: cars.filter(c => c.customSkinName?.toLowerCase() === d.entry.toLowerCase()).map(c => join(customs, 'Cars', c.file)),
      },
    };
  });
  // Liveries with real artwork first, then alphabetical.
  return items.filter(Boolean).sort((a, b) => (!a.image - !b.image) || a.title.localeCompare(b.title));
}

// ---------------------------------------------------------------------------
// Assetto Corsa EVO

const IMG_RE = /\.(png|jpe?g|webp)$/i;

// <app>/.cache/<name>, created and mounted on first use.
const cacheDirs = new Map();
export async function appCacheDir(name) {
  if (cacheDirs.has(name)) return cacheDirs.get(name);
  let appDir = window.NL_PATH;
  try { appDir = await Neutralino.filesystem.getAbsolutePath(appDir); } catch { /* keep as is */ }
  const dir = join(appDir, `.cache/${name}`);
  try { await Neutralino.filesystem.createDirectory(join(appDir, '.cache')); } catch { /* exists */ }
  try { await Neutralino.filesystem.createDirectory(dir); } catch { /* exists */ }
  await mountDir(`/m/${name}-cache`, dir);
  cacheDirs.set(name, dir);
  return dir;
}
export const evoCacheDir = () => appCacheDir('evo');

// EVO mods are packaged .kspkg files. The car-select thumbnails EVO renders for
// each visual preset live inside the package; kspkg.js extracts and caches them.
// A sidecar image with the same base name (my_car.png) overrides them.
async function scanEvoPackages(paths) {
  const dir = paths.evo.mods;
  if (!dir || !(await exists(dir))) return [];
  await mountDir('/m/evo-mods', dir);
  const cacheDir = await evoCacheDir();
  const liveKeys = new Set();
  const entries = await listDir(dir);
  const images = entries.filter(e => e.type === 'FILE' && IMG_RE.test(e.entry));
  const sidecar = base => images.find(i => i.entry.replace(IMG_RE, '').toLowerCase() === base.toLowerCase());

  const items = [];
  for (const e of entries) {
    const m = e.entry.match(/^(.*)\.kspkg(\.disabled)?$/i);
    if (e.type === 'FILE' && m) {
      const path = join(dir, e.entry);
      let info = null;
      try { info = await readModInfo(path, cacheDir); } catch (err) { log(`kspkg read failed ${e.entry}: ${err?.message || err}`); }
      if (info?.key) liveKeys.add(info.key);
      const thumbs = (info?.thumbs || []).map(t => ({ src: fileUrl(t.path), label: t.label }));
      const img = sidecar(m[1]);
      items.push({
        id: e.entry, kind: info?.kind === 'track' ? 'track' : 'car', game: 'evo',
        title: info?.name || prettifyId(m[1]),
        subtitle: [info?.brand, 'Packaged mod'].filter(Boolean).join(' · '),
        author: '',
        image: img ? fileUrl(join(dir, img.entry)) : thumbs[0]?.src || '',
        gallery: thumbs.filter(t => t.label), galleryTitle: 'Variants',
        tags: ['kspkg', ...(thumbs.length > 1 ? [`${thumbs.length} variants`] : [])],
        description: `Package: ${e.entry}`,
        isMod: true, enabled: !m[2], path, toggle: 'evo', unreadable: !info,
        carId: info?.kind === 'car' ? info.contentId || m[1] : '', brand: info?.brand || '',
        meta: { sidecar: img ? join(dir, img.entry) : '' },
      });
    } else if (e.type === 'DIRECTORY') {
      // Loose (developer) mod folder: look for any artwork and a json manifest.
      const inner = await listDir(join(dir, e.entry));
      const img = inner.find(i => /preview|thumb|cover|badge/i.test(i.entry) && IMG_RE.test(i.entry)) || inner.find(i => IMG_RE.test(i.entry));
      const manifest = inner.find(i => /\.json$/i.test(i.entry));
      const meta = manifest ? parseLooseJson(await readText(join(dir, e.entry, manifest.entry))) : null;
      items.push({
        id: e.entry, kind: /track/i.test(e.entry) ? 'track' : 'car', game: 'evo',
        title: cleanText(meta?.name || meta?.displayName) || prettifyId(e.entry),
        subtitle: 'Loose mod folder', author: meta?.author || '',
        image: img ? fileUrl(join(dir, e.entry, img.entry)) : '',
        tags: ['folder'], description: cleanText(meta?.description) || '',
        isMod: true, enabled: true, path: join(dir, e.entry),
      });
    }
  }
  pruneCache(cacheDir, liveKeys);
  return items;
}

// Official cars/tracks come from the game's own content.kspkg (see kspkg.js).
async function evoCatalog(paths, onProgress) {
  if (!paths.evo.install) return null;
  const pkg = join(paths.evo.install, 'content.kspkg');
  if (!(await exists(pkg))) return null;
  try { return await readEvoCatalog(pkg, await evoCacheDir(), onProgress); }
  catch (err) { log(`evo catalog failed: ${err?.message || err}`); return null; }
}

const byTitle = (a, b) => a.title.localeCompare(b.title);

// SavedCars folder of the most recently used EVO profile ('' if EVO never ran).
export async function evoSavedCarsDir(paths) {
  let best = '', bestTime = -1;
  for (const p of (await listDir(paths.evo.profiles)).filter(e => e.type === 'DIRECTORY' && e.entry !== '.' && e.entry !== '..')) {
    const open = join(paths.evo.profiles, p.entry, 'OpenData');
    try { const st = await Neutralino.filesystem.getStats(open); if (st.modifiedAt > bestTime) { best = join(open, 'SavedCars'); bestTime = st.modifiedAt; } } catch { /* no OpenData */ }
  }
  return best;
}

// External liveries (made with tools like LiveryLab Evo). Each folder has an
// external_livery.json whose car_guid links it to a car in SavedCars, named
// <car id>_<guid>.carfinalstatewithconsumable.
export async function scanEvoLiveries(paths) {
  const root = paths.evo.liveries;
  if (!root || !(await exists(root))) return [];
  await mountDir('/m/evo-liveries', root);
  const savedDir = await evoSavedCarsDir(paths);
  const saved = savedDir ? (await listDir(savedDir)).filter(e => e.type === 'FILE').map(e => e.entry) : [];
  const carNames = new Map(((await evoCatalog(paths))?.cars || []).map(c => [c.id, c.name]));

  const dirs = (await listDir(root)).filter(e => e.type === 'DIRECTORY' && e.entry !== '.' && e.entry !== '..');
  const items = await mapLimit(dirs, 6, async d => {
    const dir = join(root, d.entry);
    const files = (await listDir(dir)).filter(e => e.type === 'FILE').map(e => e.entry);
    const json = parseLooseJson(await readText(join(dir, 'external_livery.json')));
    if (!json) return null;
    const guid = String(json.car_guid || '').toLowerCase();
    const savedCars = guid ? saved.filter(f => f.toLowerCase().includes(guid)) : [];
    const carId = savedCars[0]?.replace(/_[0-9a-f-]{36}\..*$/i, '') || '';
    const carName = carNames.get(carId) || (carId ? prettifyId(carId) : '');
    // Folder names repeat the car ("bmw_m4_gt3_bmw_m4_evo_m_sport"); drop that prefix.
    const short = carId ? d.entry.replace(new RegExp(`^${carId.replace(/^ks_/, '')}_`, 'i'), '') : d.entry;
    const thumb = files.find(f => /^livery_thumbnail\.(png|jpe?g)$/i.test(f)) || files.find(f => IMG_RE.test(f) && !/^EXT_/i.test(f));
    return {
      id: d.entry, kind: 'livery', game: 'evo',
      title: prettifyId(short), subtitle: carName || 'External livery',
      author: '', image: thumb ? fileUrl(join(dir, thumb)) : '',
      tags: ['External livery', ...(savedCars.length ? [] : ['car not in garage'])],
      description: savedCars.length
        ? `Livery folder "${d.entry}", linked to the garage car ${savedCars[0]}.`
        : `Livery folder "${d.entry}". Its car (${guid || 'no car_guid'}) isn't in your EVO garage, so you'll see it on other drivers online but can't drive it yourself.`,
      isMod: true, enabled: true, path: dir,
      meta: { carId, savedCars: savedCars.map(f => join(savedDir, f)) },
    };
  });
  return items.filter(Boolean).sort(byTitle);
}

export async function scanEvoCars(paths, onProgress) {
  const mods = (await scanEvoPackages(paths)).filter(i => i.kind === 'car');
  const cat = await evoCatalog(paths, onProgress);
  const official = (cat?.cars || []).map(c => ({
    id: c.id, kind: 'car', game: 'evo',
    title: c.name, subtitle: [c.brand, c.year].filter(Boolean).join(' · '),
    author: 'Kunos Simulazioni', image: fileUrl(c.image),
    tags: [c.brand].filter(Boolean), description: '',
    isMod: false, enabled: true, path: paths.evo.install, carId: c.id, brand: c.brand || '',
  }));
  return [...mods.sort(byTitle), ...official.sort(byTitle)];
}

export async function scanEvoTracks(paths, onProgress) {
  const mods = (await scanEvoPackages(paths)).filter(i => i.kind === 'track');
  const cat = await evoCatalog(paths, onProgress);
  const official = (cat?.tracks || []).map(t => {
    // `practice` / `race` hold what Quick Drive writes into the Practice and Race/Race Weekend saves.
    const layouts = t.layouts.map(l => ({ id: l.id, name: l.name, preview: fileUrl(l.image), outline: fileUrl(l.map), practice: l.practice, race: l.race }));
    return {
      id: t.id, kind: 'track', game: 'evo',
      title: t.name, subtitle: [t.region, t.country].filter(Boolean).join(' · '),
      author: 'Kunos Simulazioni', image: layouts[0]?.preview || '', overlay: layouts[0]?.outline || '',
      tags: layouts.map(l => l.name), description: `${layouts.length} layout${layouts.length > 1 ? 's' : ''}: ${layouts.map(l => l.name).join(', ')}`,
      isMod: false, enabled: true, path: paths.evo.install, layouts,
      evoTrack: { name: t.name, country: t.country, region: t.region },
    };
  });
  return [...mods.sort(byTitle), ...official.sort(byTitle)];
}

// ---------------------------------------------------------------------------
// Assetto Corsa Rally

const RALLY_EXTS = ['pak', 'utoc', 'ucas'];
const RALLY_BASE = /^(pakchunk\d|global$)/i;

// Car ids are the folder names the game creates under Documents\My Games\acr\Liveries.
// `keys` are words that identify the car in a livery's folder or archive name.
export const RALLY_CARS = {
  AlfaRomeoGTA1300: { name: 'Alfa Romeo GTA 1300 Junior', keys: ['gta', '1300', 'gta1300'] },
  AlpineA110: { name: 'Alpine A110', keys: ['a110', 'alpine'] },
  AudiQuattroGr4: { name: 'Audi Quattro Gr.4', keys: ['quattro'] },
  CitroenXsaraWRC: { name: 'Citroën Xsara WRC', keys: ['xsara'] },
  Fiat124Abarth: { name: 'Fiat 124 Abarth', keys: ['124'] },
  Fiat131Abarth: { name: 'Fiat 131 Abarth', keys: ['131'] },
  Hyundaii20NRally2: { name: 'Hyundai i20 N Rally2', keys: ['i20'] },
  LanciaDeltaIntegraleEvo: { name: 'Lancia Delta HF Integrale Evo', keys: ['delta', 'integrale'] },
  LanciaFulviaHF: { name: 'Lancia Fulvia HF', keys: ['fulvia'] },
  LanciaRally037Evo2: { name: 'Lancia 037 Rally Evo 2', keys: ['037'] },
  LanciaStratosHF: { name: 'Lancia Stratos HF', keys: ['stratos'] },
  MiniCooperS1275: { name: 'Mini Cooper S 1275', keys: ['mini', 'cooper', '1275'] },
  Peugeot206: { name: 'Peugeot 206 WRC', keys: ['206'] },
  Peugeot208Rally4: { name: 'Peugeot 208 Rally4', keys: ['208'] },
  Peugeot306IIMaxiKitCar: { name: 'Peugeot 306 Maxi Kit Car', keys: ['306', 'maxi'] },
  SkodaFabiaRSRally2: { name: 'Škoda Fabia RS Rally2', keys: ['fabia'] },
  SubaruImprezaS3: { name: 'Subaru Impreza', keys: ['impreza', 'subaru'] },
  VWPoloGTIR5: { name: 'Volkswagen Polo GTI R5', keys: ['polo'] },
};
export const rallyCarName = id => RALLY_CARS[id]?.name || String(id).replace(/([a-z])([A-Z])/g, '$1 $2');

// Best car id for a livery from its folder/archive/pak names ('' when nothing matches).
export function guessRallyCar(names, ids = Object.keys(RALLY_CARS)) {
  const tokens = new Set(names.flatMap(s => String(s).toLowerCase().split(/[^a-z0-9]+/)).filter(Boolean));
  const joined = names.join(' ').toLowerCase();
  let best = '', bestScore = 0;
  for (const id of ids) {
    const score = (joined.includes(id.toLowerCase()) ? 10 : 0) + (RALLY_CARS[id]?.keys || []).filter(k => tokens.has(k)).length;
    if (score > bestScore) { best = id; bestScore = score; }
  }
  return best;
}

// Every car the game knows: the built-in list plus any folder the game created.
export async function rallyCarIds(paths) {
  const ids = new Set(Object.keys(RALLY_CARS));
  if (paths.rally.liveries) for (const e of await listDir(paths.rally.liveries)) if (e.type === 'DIRECTORY' && e.entry !== '.' && e.entry !== '..') ids.add(e.entry);
  return [...ids].sort((a, b) => rallyCarName(a).localeCompare(rallyCarName(b)));
}

// Disabled folder liveries are parked outside the folder the game reads.
const rallyDisabledRoot = paths => `${paths.rally.liveries} (disabled)`;

// The livery's body texture as a square 1024 px JPEG, made once and cached by
// path, size and date ('' when it can't be read). Cards show the livery's own
// icon.png, as the game does; the texture is the second picture on the detail
// page, and the card picture for liveries without an icon.
async function rallyLiveryThumb(ddsPath) {
  try {
    const st = await Neutralino.filesystem.getStats(ddsPath);
    const key = `${norm(ddsPath).toLowerCase()}|${st.size}|${st.modifiedAt}|1024`;
    let h = 2166136261;
    for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
    const file = join(await appCacheDir('rally'), `${(h >>> 0).toString(16).padStart(8, '0')}.jpg`);
    if (!(await exists(file))) await Neutralino.filesystem.writeBinaryFile(file, await ddsThumbnail(ddsPath, 1024));
    return fileUrl(file);
  } catch (err) {
    log(`rally thumb ${ddsPath}: ${err?.message || err}`);
    return '';
  }
}

// Native custom liveries: <Liveries>\<CarId>\<LiveryName>\ with livery.json,
// icon.png and body_livery_*.dds.
async function scanRallyFolderLiveries(paths) {
  const items = [];
  for (const [root, enabled, mount] of [[paths.rally.liveries, true, '/m/rally-liveries'], [rallyDisabledRoot(paths), false, '/m/rally-disabled']]) {
    if (!root || !(await exists(root))) continue;
    await mountDir(mount, root);
    for (const car of (await listDir(root)).filter(e => e.type === 'DIRECTORY' && e.entry !== '.' && e.entry !== '..')) {
      for (const liv of (await listDir(join(root, car.entry))).filter(e => e.type === 'DIRECTORY' && e.entry !== '.' && e.entry !== '..')) {
        const dir = join(root, car.entry, liv.entry);
        const files = (await listDir(dir)).filter(e => e.type === 'FILE').map(e => e.entry);
        if (!files.some(f => /^livery\.json$/i.test(f))) continue;
        const icon = files.find(f => /^icon\.(png|jpe?g)$/i.test(f)) || files.find(f => IMG_RE.test(f));
        const albedo = files.find(f => /^body_livery_albedo\.dds$/i.test(f));
        const thumb = albedo ? await rallyLiveryThumb(join(dir, albedo)) : '';
        items.push({
          id: `${car.entry}/${liv.entry}`, kind: 'livery', game: 'rally',
          title: liv.entry, subtitle: rallyCarName(car.entry),
          author: '', image: (icon ? fileUrl(join(dir, icon)) : '') || thumb,
          gallery: [icon && { src: fileUrl(join(dir, icon)), label: 'Icon' }, thumb && { src: thumb, label: 'Texture' }].filter(Boolean), galleryTitle: 'Pictures',
          tags: ['Custom livery', rallyCarName(car.entry)],
          description: `Custom livery for the ${rallyCarName(car.entry)}.\nFiles: ${files.join(', ')}`,
          isMod: true, enabled, path: dir, toggle: 'rally-folder',
          meta: { car: car.entry, name: liv.entry, paths },
        });
      }
    }
  }
  return items;
}

// IoStore container version: byte 16 of a .utoc (null when unreadable). A pak
// cooked for another engine version than the game's own global.utoc makes the
// game crash while loading at startup ("Trying to resize TArray to an invalid
// size"), so such paks are flagged.
export async function utocVersion(path) {
  try { return new Uint8Array(await Neutralino.filesystem.readBinaryFile(path, { pos: 16, size: 1 }))[0] ?? null; } catch { return null; }
}
export const rallyGameTocVersion = paths => paths.rally.paks ? utocVersion(join(paths.rally.paks, 'global.utoc')) : Promise.resolve(null);

// Enabled .pak liveries that the current game version can't load.
export const rallyIncompatible = items => items.filter(i => i.toggle === 'rally' && i.enabled && i.incompatible);

// Rally liveries come in two forms: the game's own custom-livery folders (above)
// and Unreal .pak/.utoc/.ucas trios in acr/Content/Paks (replace a car's default
// scheme). A trio is disabled by suffixing ".disabled" so the engine skips it.
export async function scanRallyLiveries(paths) {
  const items = await scanRallyFolderLiveries(paths);
  const dir = paths.rally.paks;
  if (!dir || !(await exists(dir))) return items.sort((a, b) => a.title.localeCompare(b.title));
  await mountDir('/m/rally-paks', dir);
  const gameToc = await rallyGameTocVersion(paths);

  const scanDirs = [dir];
  const modsSub = (await listDir(dir)).find(e => e.type === 'DIRECTORY' && /^~?mods$/i.test(e.entry));
  if (modsSub) scanDirs.push(join(dir, modsSub.entry));

  for (const d of scanDirs) {
    const entries = (await listDir(d)).filter(e => e.type === 'FILE');
    const images = entries.filter(e => IMG_RE.test(e.entry));
    const groups = new Map();
    for (const e of entries) {
      const m = e.entry.match(/^(.*)\.(pak|utoc|ucas)(\.disabled)?$/i);
      if (!m || RALLY_BASE.test(m[1])) continue;
      const g = groups.get(m[1]) || { base: m[1], files: [], disabled: false };
      g.files.push(e.entry);
      if (m[3]) g.disabled = true;
      groups.set(m[1], g);
    }
    for (const g of groups.values()) {
      const img = images.find(i => i.entry.replace(IMG_RE, '').toLowerCase() === g.base.toLowerCase());
      const complete = RALLY_EXTS.every(x => g.files.some(f => f.toLowerCase().startsWith(`${g.base.toLowerCase()}.${x}`)));
      const car = guessRallyCar([g.base]);
      const utoc = g.files.find(f => /\.utoc(\.disabled)?$/i.test(f));
      const toc = utoc ? await utocVersion(join(d, utoc)) : null;
      const incompatible = gameToc != null && toc != null && toc !== gameToc;
      items.push({
        id: g.base, kind: 'livery', game: 'rally',
        title: prettifyId(g.base.replace(/_P$/i, '')),
        subtitle: !complete ? 'Incomplete package' : incompatible ? 'Made for another game version · crashes the game'
          : [car && rallyCarName(car), '.pak livery'].filter(Boolean).join(' · '),
        author: '', image: img ? fileUrl(join(d, img.entry)) : '',
        tags: [complete ? 'pak + utoc + ucas' : 'missing files', ...(incompatible ? ['Incompatible'] : [])],
        description: (incompatible ? `This .pak was built for ${toc < gameToc ? 'an older' : 'a newer'} version of the game (container v${toc}, the game uses v${gameToc}). The game crashes at startup while it is enabled. Disable it until the author releases an updated version.\n\n` : '')
          + `Files: ${g.files.join(', ')}`,
        incompatible,
        isMod: true, enabled: !g.disabled, path: d, toggle: 'rally',
        meta: { files: g.files, dir: d, sidecar: img ? join(d, img.entry) : '' },
      });
    }
  }
  return items.sort((a, b) => a.title.localeCompare(b.title));
}

// ---------------------------------------------------------------------------
// Enable / disable (rename-based, fully reversible)

export async function setEnabled(item, enabled) {
  if (item.toggle === 'evo') {
    const base = item.path.replace(/\.disabled$/i, '');
    const target = enabled ? base : base + '.disabled';
    if (target !== item.path) await Neutralino.filesystem.move(item.path, target);
    return;
  }
  if (item.toggle === 'rally') {
    for (const f of item.meta.files) {
      const clean = f.replace(/\.disabled$/i, '');
      const target = enabled ? clean : clean + '.disabled';
      if (target !== f) await Neutralino.filesystem.move(join(item.meta.dir, f), join(item.meta.dir, target));
    }
    return;
  }
  if (item.toggle === 'rally-folder') {
    // The game loads every folder under Liveries\<Car>, so a disabled livery is moved out of it.
    const paths = item.meta.paths;
    const root = enabled ? paths.rally.liveries : rallyDisabledRoot(paths);
    const target = join(root, item.meta.car, item.meta.name);
    if (await exists(target)) throw new Error(`a livery named "${item.meta.name}" already exists there`);
    await ensureDirs(join(root, item.meta.car));
    await Neutralino.filesystem.move(item.path, target);
    item.path = target;
    return;
  }
  throw new Error('This item cannot be toggled');
}

// ---------------------------------------------------------------------------
// Uninstall: everything that belongs to a mod goes to the Recycle Bin, so it
// can be restored from there. Official content can't be uninstalled.

export function uninstallPaths(item) {
  if (!item.isMod) return [];
  if (item.kind === 'screenshot' || item.kind === 'replay') return [item.meta.file, ...item.meta.extra];
  switch (item.game) {
    case 'ac': return [item.path];
    case 'acc': return [item.path, ...(item.meta?.carFiles || [])];
    case 'evo': return item.kind === 'livery'
      ? [item.path, ...(item.meta?.savedCars || [])]
      : [item.path, item.meta?.sidecar].filter(Boolean);
    case 'rally': return item.toggle === 'rally'
      ? [...item.meta.files.map(f => join(item.meta.dir, f)), item.meta.sidecar].filter(Boolean)
      : [item.path];
  }
  return [];
}

export async function uninstallItem(item) {
  const paths = uninstallPaths(item);
  if (!paths.length) throw new Error('official content cannot be uninstalled');
  for (const p of paths) {
    if (!(await exists(p))) continue;
    try { await Neutralino.os.trashItem(p); }
    catch (err) { throw new Error(`could not move ${basename(p)} to the Recycle Bin (${err?.message || err?.code || 'in use?'})`); }
    if (await exists(p)) throw new Error(`${basename(p)} is still there (file in use?)`);
  }
}

const media = game => ({ screens: p => scanScreenshots(game, p), replays: p => scanReplays(game, p) });
export const SCANNERS = {
  ac: { cars: scanAcCars, tracks: scanAcTracks, ...media('ac') },
  acc: { liveries: scanAccLiveries, ...media('acc') },
  evo: { cars: scanEvoCars, tracks: scanEvoTracks, liveries: scanEvoLiveries, ...media('evo') },
  rally: { liveries: scanRallyLiveries, ...media('rally') },
};

export function contentFolder(gameKey, tab, paths) {
  if (tab === 'screens' || tab === 'replays') return mediaFolders(gameKey, paths, tab)[0] || '';
  switch (gameKey) {
    case 'ac': return paths.ac.content ? join(paths.ac.content, tab) : '';
    case 'acc': return paths.acc.customs ? join(paths.acc.customs, 'Liveries') : '';
    case 'evo': return tab === 'liveries' ? paths.evo.liveries : paths.evo.mods;
    case 'rally': return paths.rally.liveries || paths.rally.paks;
  }
  return '';
}

export { basename };
