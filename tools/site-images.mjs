// Dev tool: downloads the ACC and Rally car/stage/track pictures and the Rally
// stage maps from the official site into resources/img/site/<game>/<kind>-<key>.jpg
// (480 px wide; maps .png, 160 px) and writes resources/img/site/manifest.json
// { rally: { cars, stages, maps }, acc: { cars, tracks } } (key -> file).
// Run: node tools/site-images.mjs [game/kind ...]   e.g. rally/maps  (needs PowerShell)
// With kinds given, only those are fetched again; the rest of the manifest is kept.
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { SITE_PAGES, siteCars, sitePlaces, siteMaps, rallyStagePhotos, imageSizes, bestMatch, stageGroupOf } from '../resources/js/sitecatalog.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'resources/img/site');
const UA = { 'User-Agent': 'Mozilla/5.0 AssettoLauncher (image build)' };
const src = fs.readFileSync(path.join(root, 'resources/js/games.js'), 'utf8');
const table = name => Object.fromEntries([...src.slice(src.indexOf(`export const ${name}`)).split('};')[0].matchAll(/(?:^|[{,])\s*(?:(\d+)|(\w+)): (?:'([^']+)'|\{ name: '([^']+)')/gm)].map(m => [m[1] ?? m[2], m[3] ?? m[4]]));
const ACC_CARS = table('ACC_CARS'), RALLY_CARS = table('RALLY_CARS');
const only = process.argv.slice(2);
const wanted = (game, kind) => !only.length || only.includes(`${game}/${kind}`);

// Pairs the name matching can't tell apart (same name, different years on the site).
const ACC_OVERRIDES = {
  'Mercedes-AMG GT3 (2015)': '1', 'Mercedes-AMG GT3 (2023)': '25', 'Nissan GT-R Nismo GT3 (2015)': '10', 'Nissan GT-R Nismo GT3 (2018)': '6',
  'Bentley Continental GT3 (2015)': '11', 'Bentley Continental GT3 (2018)': '8', 'Porsche 991 GT3 R (2018)': '0', 'Porsche 991II GT3 R (2019)': '23',
  'Lamborghini Huracan GT3 (2015)': '4', 'Lamborghini Huracan GT3 Evo (2019)': '16', 'Lamborghini Huracan GT3 EVO2 (2023)': '33',
  'Lamborghini Huracan ST EVO2 (2021)': '29', 'Reiter Engineering R-EX GT3 (2017)': '13', 'Jaguar Emil Frey G3 (2012)': '14',
  'Audi R8 LMS (2015)': '3', 'Audi R8 LMS Evo (2019)': '19', 'Audi R8 LMS Evo II (2022)': '31', 'McLaren 720S GT3 (2019)': '22', 'McLaren 720S GT3 EVO (2023)': '35',
  'Porsche 911 (992) GT3 R (2023)': '34', 'Porsche 992 GT3 Cup (2021)': '28', 'Ferrari 488 Challenge Evo (2020)': '26', 'Ferrari 488 GT3 Evo (2020)': '24',
  'Ferrari 488 GT3 (2018)': '2', 'Aston Martin V8 Vantage (2019)': '20', 'Aston Martin V12 Vantage (2013)': '12', 'Aston Martin AMR V8 Vantage GT4 (2018)': '51',
  'Maserati GranTurismo MC GT4 (2016)': '58', 'Chevrolet Camaro GT4.R (2017)': '55', 'Porsche 718 Cayman GT4 Clubsport (2019)': '61', 'Honda NSX GT3 (2017)': '17',
  'Honda NSX GT3 Evo (2019)': '21', 'BMW M4 GT3 (2022)': '30', 'BMW M4 GT4 (2018)': '53', 'Ford Mustang GT3 Race Car (2024)': '36', 'Ferrari 296 GT3 (2023)': '32',
};
// ACC's track section names DLC packs instead of some tracks; its 25 pictures follow ACC's alphabetical list.
const ACC_TRACK_ORDER = ['barcelona', 'mount_panorama', 'brands_hatch', 'cota', 'donington', 'hungaroring', 'imola', 'indianapolis', 'kyalami',
  'laguna_seca', 'misano', 'monza', 'nurburgring', 'nurburgring_24h', 'red_bull_ring', 'valencia', 'oulton_park', 'paul_ricard', 'silverstone',
  'spa', 'snetterton', 'suzuka', 'watkins_glen', 'zandvoort', 'zolder'];
// Stages the site has a map of but no photo yet: shots from the news post that added them (EA 0.5).
const RALLY_STAGE_PHOTOS = {
  GreeceS3Elatia: 'https://assettocorsa.gg/wp-content/uploads/Copy-of-3-1080x608.jpg',
  GreeceS4Loutraki: 'https://assettocorsa.gg/wp-content/uploads/Copy-of-6-1080x608.jpg',
};

const ps = (script, ...args) => execFileSync('powershell', ['-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'tools', script), ...args], { stdio: 'ignore' });
async function download(url, file, kind) {
  for (const u of kind === 'maps' ? [url] : imageSizes(url)) {
    const r = await fetch(u, { headers: UA });
    if (!r.ok) continue;
    const tmp = file + '.src';
    fs.writeFileSync(tmp, Buffer.from(await r.arrayBuffer()));
    try { if (kind === 'maps') ps('map.ps1', tmp, file, '160'); else ps('resize.ps1', tmp, file, '480'); }
    catch { continue; } // not an image this size
    finally { try { fs.unlinkSync(tmp); } catch { /* removed below */ } }
    return fs.existsSync(file);
  }
  return false;
}

const old = (() => { try { return JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8')); } catch { return {}; } })();
const manifest = { rally: { cars: {}, stages: {}, maps: {} }, acc: { cars: {}, tracks: {} } };
for (const [game, kinds] of Object.entries(manifest)) for (const kind of Object.keys(kinds)) if (!wanted(game, kind)) kinds[kind] = old[game]?.[kind] || {};
const pages = {};
for (const [k, u] of Object.entries(SITE_PAGES)) pages[k] = await (await fetch(u, { headers: UA })).text();

const jobs = [];
for (const c of siteCars(pages.rally)) {
  const key = bestMatch(c.name, Object.entries(RALLY_CARS).map(([k, name]) => ({ key: k, name: `${name} ${k}` })));
  if (key) jobs.push(['rally', 'cars', key, c.img, c.name]); else console.log('rally car ?', c.name);
}
for (const s of rallyStagePhotos(pages.rally)) { const g = stageGroupOf(s.name); if (g) jobs.push(['rally', 'stages', g, s.img, s.name]); }
for (const [g, img] of Object.entries(RALLY_STAGE_PHOTOS)) jobs.push(['rally', 'stages', g, img, g]);
for (const s of siteMaps(pages.rally)) { const g = stageGroupOf(s.name); if (g) jobs.push(['rally', 'maps', g, s.img, s.name]); }
for (const c of siteCars(pages.acc)) {
  const key = ACC_OVERRIDES[c.name] || bestMatch(c.name, Object.entries(ACC_CARS).map(([k, name]) => ({ key: k, name })));
  if (key) jobs.push(['acc', 'cars', key, c.img, c.name]); else console.log('acc car ?', c.name);
}
sitePlaces(pages.acc, 'id="tracks"', 'NEW CONTENTS').slice(1, 26).forEach((t, i) => jobs.push(['acc', 'tracks', ACC_TRACK_ORDER[i], t.img, t.name]));

for (const [game, kind, key, img, name] of jobs) {
  if (!wanted(game, kind)) continue;
  if (manifest[game][kind][key]) { console.log('dup', game, kind, key, name); continue; }
  const rel = `${game}/${kind}-${key}.${kind === 'maps' ? 'png' : 'jpg'}`;
  fs.mkdirSync(path.join(out, game), { recursive: true });
  if (await download(img, path.join(out, rel), kind)) { manifest[game][kind][key] = rel; console.log(game, kind, key, '<=', name); }
  else console.log('FAILED', game, kind, key, img);
}
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 1));
