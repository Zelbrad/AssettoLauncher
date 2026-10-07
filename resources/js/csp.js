// Custom Shaders Patch (CSP) for Assetto Corsa: what's installed and what it
// supports, its WeatherFX styles (Default, Sol, Pure…) and controllers, the
// user's CSP settings, and installing the public build from acstuff.club. None
// of it needs Content Manager; the files are the same ones it uses.
//
// CSP reads each module's settings from extension/config/<file> (its defaults)
// with the user's values on top from Documents\Assetto Corsa\cfg\extension\<file>.
// Content Manager edits the user file, and so does the launcher (only the keys it
// changes). What CSP supports is listed in data_manifest.ini [FEATURES], which is
// also where Content Manager reads the installed version from (installed.log can
// be stale after a manual install).
import { join, norm, readText, writeText, exists, listDir, run, sh, powershell, psQuote, shQuote, log, mapLimit, ensureDir, extractArchive, isProcessRunning, CURL, IS_LINUX } from './util.js';
import { parseIni, setIni, deleteKeys } from './ini.js';

export const CSP_PAGE = 'https://acstuff.club/patch/';
export const VCREDIST_URL = 'https://www.microsoft.com/en-us/download/details.aspx?id=48145';
export const SOL_URL = 'https://www.overtake.gg/downloads/sol.24914/';
export const PURE_URL = 'https://www.patreon.com/peterboese';
// Proton uses Wine's own dwrite.dll unless told otherwise, and CSP is dwrite.dll.
export const PROTON_DLL_OVERRIDE = 'dwrite=n,b';

// CSP's weather types (Content Manager's WeatherType enum: the number goes into
// race.ini as __CM_WEATHER_TYPE). Snow and sleet need CSP's SNOW feature.
export const CSP_WEATHER_TYPES = [
  [15, 'Clear', 'Clear'], [16, 'FewClouds', 'Few clouds'], [17, 'ScatteredClouds', 'Scattered clouds'],
  [18, 'BrokenClouds', 'Broken clouds'], [19, 'OvercastClouds', 'Overcast'], [31, 'Windy', 'Windy'],
  [20, 'Fog', 'Fog'], [21, 'Mist', 'Mist'], [23, 'Haze', 'Haze'], [22, 'Smoke', 'Smoke'], [25, 'Dust', 'Dust'], [24, 'Sand', 'Sand'],
  [3, 'LightDrizzle', 'Light drizzle'], [4, 'Drizzle', 'Drizzle'], [5, 'HeavyDrizzle', 'Heavy drizzle'],
  [6, 'LightRain', 'Light rain'], [7, 'Rain', 'Rain'], [8, 'HeavyRain', 'Heavy rain'],
  [0, 'LightThunderstorm', 'Light thunderstorm'], [1, 'Thunderstorm', 'Thunderstorm'], [2, 'HeavyThunderstorm', 'Heavy thunderstorm'],
  [9, 'LightSnow', 'Light snow', 'snow'], [10, 'Snow', 'Snow', 'snow'], [11, 'HeavySnow', 'Heavy snow', 'snow'],
  [12, 'LightSleet', 'Light sleet', 'snow'], [13, 'Sleet', 'Sleet', 'snow'], [14, 'HeavySleet', 'Heavy sleet', 'snow'],
  [32, 'Hail', 'Hail'], [26, 'Squalls', 'Squalls'], [27, 'Tornado', 'Tornado'], [28, 'Hurricane', 'Hurricane'],
  [29, 'Cold', 'Cold'], [30, 'Hot', 'Hot'],
].map(([id, key, label, needs]) => ({ id, key, label, needs }));
export const cspWeatherLabel = id => CSP_WEATHER_TYPES.find(t => t.id === Number(id))?.label || `Type ${id}`;
// Rain, drizzle, thunderstorms, snow and sleet (Content Manager: LightThunderstorm…HeavySleet).
export const isWetWeather = id => Number(id) >= 0 && Number(id) <= 14;

// [__LAUNCHER_CM] WEATHER_TYPE in a weather preset: a number or the enum name.
export function weatherTypeOf(value) {
  if (value == null || value === '') return null;
  if (/^-?\d+$/.test(String(value).trim())) return Number(value);
  return CSP_WEATHER_TYPES.find(t => t.key.toLowerCase() === String(value).trim().toLowerCase())?.id ?? null;
}

// ---------------------------------------------------------------------------
// Versions: "0.3.0-preview622" is newer than "0.2.11" and older than "0.3.0".

function versionParts(v) {
  const m = String(v || '').trim().match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-?\s*([a-z]+)\s*(\d*))?/i);
  if (!m) return { n: [0, 0, 0], pre: null };
  return { n: [m[1], m[2], m[3]].map(x => Number(x) || 0), pre: m[4] ? Number(m[5]) || 0 : null };
}

export function compareVersions(a, b) {
  const pa = versionParts(a), pb = versionParts(b);
  for (let i = 0; i < 3; i++) if (pa.n[i] !== pb.n[i]) return pa.n[i] > pb.n[i] ? 1 : -1;
  if (pa.pre === pb.pre) return 0;
  if (pa.pre == null) return 1;
  if (pb.pre == null) return -1;
  return pa.pre > pb.pre ? 1 : -1;
}

// Sol 2.2.9 (its last version) breaks with CSP 0.2.10 to 0.2.12; it works with
// 0.2.9 and older, 0.2.10's first preview, and 0.3.x.
export function solBrokenWith(cspVersion) {
  const p = versionParts(cspVersion);
  if (p.n[0] !== 0 || p.n[1] !== 2 || p.n[2] < 10) return false;
  return !(p.n[2] === 10 && p.pre != null);
}

// ---------------------------------------------------------------------------
// Reading

const isOn = v => v != null && !/^(0|off|false|no|none|disabled)?$/i.test(String(v).trim());
const userConfigPath = (paths, file) => join(paths.ac.cfg, 'extension', file);

// CSP's settings for one module: defaults with the user's values on top.
async function readConfig(paths, file) {
  const out = parseIni(await readText(join(paths.ac.install, 'extension/config', file)));
  const user = parseIni(paths.ac.cfg ? await readText(userConfigPath(paths, file)) : '');
  for (const [section, values] of Object.entries(user)) out[section] = { ...(out[section] || {}), ...values };
  return out;
}

async function readManifest(dir) {
  const about = parseIni(await readText(join(dir, 'manifest.ini'))).ABOUT || {};
  return about;
}

// Folders of extension/weather (styles: weather.lua) or extension/weather-controllers
// (controller.lua), with their manifest's name and version.
async function listScripts(root, script) {
  const dirs = (await listDir(root)).filter(e => e.type === 'DIRECTORY' && !e.entry.startsWith('.'));
  const out = [];
  for (const d of dirs) {
    const dir = join(root, d.entry);
    if (!(await exists(join(dir, script))) && !(await exists(join(dir, 'manifest.ini')))) continue;
    const about = await readManifest(dir);
    out.push({
      id: d.entry, name: about.NAME || d.entry, author: about.AUTHOR || '', version: about.VERSION || '',
      // Controllers that pick their own weather (Live, Schedule…) are chosen in place of a weather type.
      followsWeather: about.FOLLOWS_SELECTED_WEATHER == null || isOn(about.FOLLOWS_SELECTED_WEATHER),
    });
  }
  return out.sort((a, b) => (a.id === 'base' ? -1 : b.id === 'base' ? 1 : a.name.localeCompare(b.name)));
}

const isSol = s => /^sol\b/i.test(s.id) || /^sol\b/i.test(s.name);
const isPure = s => /pure/i.test(s.id) || /pure/i.test(s.name);

// Everything the launcher needs to know about CSP. installed: false when AC or
// CSP is missing (then nothing else is filled in).
export async function readCsp(paths) {
  const out = {
    installed: false, version: '', build: 0, active: false, features: {},
    wfx: false, rainFx: false, style: 'base', styles: [], controllers: [], baseController: 'base',
    settings: {}, sol: null, pure: null, solBroken: false,
  };
  const ac = paths.ac.install;
  if (!ac) return out;
  const manifest = parseIni(await readText(join(ac, 'extension/config/data_manifest.ini')));
  if (!manifest.VERSION?.SHADERS_PATCH || !(await exists(join(ac, 'dwrite.dll')))) return out;
  out.installed = true;
  out.version = manifest.VERSION.SHADERS_PATCH;
  out.build = Number(manifest.VERSION.SHADERS_PATCH_BUILD) || 0;

  const [general, weatherFx, rainFx] = await Promise.all(['general.ini', 'weather_fx.ini', 'rain_fx.ini'].map(f => readConfig(paths, f)));
  const configs = { 'general.ini': general, 'weather_fx.ini': weatherFx, 'rain_fx.ini': rainFx };
  out.active = isOn(general.BASIC?.ENABLED ?? '1');

  // Feature values: 1/0, or a module that has to be on ("rain_fx.ini", "file.ini:SECTION/KEY=value").
  const feature = id => {
    const q = String(manifest.FEATURES?.[id] ?? '').trim();
    if (/^(1|0)?$/.test(q)) return q === '1';
    const m = q.match(/^([\w.-]+\.ini)(?::\s*([\w]+)(?:\/([\w]+))?(?:\s*=\s*(.*))?)?$/i);
    const cfg = m && configs[m[1].toLowerCase()];
    if (!cfg) return false;
    const v = cfg[(m[2] || 'BASIC').toUpperCase()]?.[(m[3] || 'ENABLED').toUpperCase()];
    return m[4] != null ? v === m[4].trim() : isOn(v);
  };
  for (const id of ['CONDITIONS_24H', 'CONDITIONS_SPECIFIC_DATE', 'WEATHERFX_LAUNCHER_CONTROLLED', 'SNOW']) out.features[id] = feature(id);

  out.wfx = out.active && isOn(weatherFx.BASIC?.ENABLED) && out.features.WEATHERFX_LAUNCHER_CONTROLLED;
  out.rainFx = out.active && isOn(rainFx.BASIC?.ENABLED);
  out.style = weatherFx.BASIC?.IMPLEMENTATION || 'base';
  out.settings = {
    wfxEnabled: isOn(weatherFx.BASIC?.ENABLED),
    rainFxEnabled: isOn(rainFx.BASIC?.ENABLED),
    autoWipers: isOn(weatherFx.MISCELLANEOUS?.SWITCH_WIPERS_WITH_AI),
    aiHeadlights: isOn(weatherFx.MISCELLANEOUS?.FORCE_HEADLIGHTS),
    rainTyres: isOn(rainFx.BASIC?.AUTOSELECT_RAIN_TYRES),
  };

  [out.styles, out.controllers] = await Promise.all([
    listScripts(join(ac, 'extension/weather'), 'weather.lua'),
    listScripts(join(ac, 'extension/weather-controllers'), 'controller.lua'),
  ]);
  // The default controller for a chosen weather type: Content Manager's "base", else
  // the first that follows it. With a Pure style, Pure's own static controller
  // ("Pure Static", which Pure recommends for fixed weathers).
  const style = out.styles.find(s => s.id === out.style);
  // Pure's controllers (a paid mod's) are only offered while a Pure style is in use.
  if (!(style && isPure(style))) out.controllers = out.controllers.filter(c => !isPure(c));
  const pureStatic = style && isPure(style) && out.controllers.find(c => c.followsWeather && isPure(c));
  out.baseController = pureStatic?.id || out.controllers.find(c => c.id === 'base' && c.followsWeather)?.id || out.controllers.find(c => c.followsWeather)?.id || 'base';

  const sol = out.styles.find(isSol);
  if (sol) out.sol = { ...sol, styles: [sol] };
  const pure = out.styles.filter(isPure);
  if (pure.length) out.pure = { ...pure[0], styles: pure };
  out.solBroken = !!sol && solBrokenWith(out.version);
  return out;
}

// The files of Peter Boese's Sol or Pure in the AC folder ('sol' | 'pure'), found
// by name: their weather styles and controllers (folder or manifest name), and
// the apps, configs and post-processing filters named after them (Pure:
// apps/lua/PureConfig|PurePlanner|PurePP, extension/config-ext/Pure*,
// extension/lua/pp-filters/pure, system/cfg/ppfilters/pure*). Both ship the
// weather presets content/weather/sol_*, which stay while the other is installed.
export async function weatherModFiles(paths, mod) {
  const ac = paths.ac.install;
  const is = mod === 'pure' ? isPure : isSol;
  const named = mod === 'pure' ? /^pure/i : /^sol([_\s-]|$)/i;
  const out = [];
  const styles = await listScripts(join(ac, 'extension/weather'), 'weather.lua');
  for (const s of styles) if (is(s)) out.push(join(ac, 'extension/weather', s.id));
  for (const c of await listScripts(join(ac, 'extension/weather-controllers'), 'controller.lua')) if (is(c)) out.push(join(ac, 'extension/weather-controllers', c.id));
  const otherInstalled = styles.some(mod === 'pure' ? isSol : isPure);
  const presets = mod === 'pure' ? (otherInstalled ? /^pure/i : /^(pure|sol_)/i) : (otherInstalled ? /^$/ : /^sol_/i);
  for (const [dir, re] of [['apps/lua', named], ['apps/python', named], ['extension/config-ext', named], ['extension/lua/pp-filters', named], ['system/cfg/ppfilters', named], ['content/weather', presets]]) {
    for (const e of await listDir(join(ac, dir))) if (e.entry !== '.' && e.entry !== '..' && re.test(e.entry)) out.push(join(ac, dir, e.entry));
  }
  return [...new Set(out)];
}

// Removes the user's weather style and/or controller from weather_fx.ini in
// Documents, so CSP's own defaults apply again (extension/config/weather_fx.ini:
// AC's Default style, the way CSP comes).
async function dropWeatherChoice(paths, { style, controller }) {
  const path = userConfigPath(paths, 'weather_fx.ini');
  let text = paths.ac.cfg ? await readText(path) : null;
  if (text == null || (!style && !controller)) return;
  if (style) text = deleteKeys(text, 'BASIC', /^IMPLEMENTATION$/i);
  if (controller) text = deleteKeys(text, 'BASIC', /^CONTROLLER$/i);
  await writeText(path, text);
  log(`csp: weather ${[style && 'style', controller && 'controller'].filter(Boolean).join(' and ')} back to CSP's default`);
}

// Deselect Sol or Pure: back to CSP's default style, and its default controller
// when the chosen one is the mod's (Pure's "pureCtrl static", for example).
export async function deselectWeatherMod(paths, mod) {
  const is = mod === 'pure' ? isPure : isSol;
  const ctrl = String(parseIni(paths.ac.cfg ? await readText(userConfigPath(paths, 'weather_fx.ini')) : '').BASIC?.CONTROLLER || '');
  await dropWeatherChoice(paths, { style: true, controller: !!ctrl && is({ id: ctrl, name: ctrl }) });
}

// Moves Sol's or Pure's files to the Recycle Bin. Settings that point at them go
// back to the defaults first: the weather style and controller (CSP's), and AC's
// post-processing filter when it's one of theirs.
export async function uninstallWeatherMod(paths, mod) {
  if (await isProcessRunning('acs')) throw new Error('Close Assetto Corsa first.');
  const files = await weatherModFiles(paths, mod);
  if (!files.length) throw new Error(`${mod === 'pure' ? 'Pure' : 'Sol'} was not found in the Assetto Corsa folder.`);
  const gone = new Set(files.map(f => f.split('/').pop().toLowerCase()));
  const wfx = await readConfig(paths, 'weather_fx.ini');
  await dropWeatherChoice(paths, {
    style: gone.has(String(wfx.BASIC?.IMPLEMENTATION || '').toLowerCase()),
    controller: gone.has(String(wfx.BASIC?.CONTROLLER || '').toLowerCase()),
  });
  const videoPath = join(paths.ac.cfg, 'video.ini');
  const video = await readText(videoPath);
  const filter = String(parseIni(video).POST_PROCESS?.FILTER || '').toLowerCase();
  if (video && filter && (gone.has(`${filter}.ini`) || gone.has(filter))) await writeText(videoPath, setIni(video, 'POST_PROCESS', 'FILTER', 'default'));
  for (const f of files) {
    try { await Neutralino.os.trashItem(f); }
    catch (err) { throw new Error(`Could not move ${f.split('/').pop()} to the Recycle Bin (${err?.message || err?.code || 'in use?'})`); }
  }
  log(`${mod} uninstalled: ${files.length} items`);
  return files.length;
}

// One of CSP's user settings, e.g. ('weather_fx.ini', 'BASIC', 'IMPLEMENTATION', 'pure').
export async function writeCspSetting(paths, file, section, key, value) {
  if (!paths.ac.cfg) throw new Error('Assetto Corsa\'s settings folder was not found.');
  await ensureDir(join(paths.ac.cfg, 'extension'));
  const path = userConfigPath(paths, file);
  await writeText(path, setIni((await readText(path)) ?? '', section, key, value));
  log(`csp setting ${file} [${section}] ${key}=${value}`);
}

// ---------------------------------------------------------------------------
// Installing the public build

// The public versions on acstuff.club/patch, newest first, with the tag CSP's
// developer gives each (recommended, untested, buggy…), or null when offline:
//   { list: [{ version, size, tag, kind, url }], latest, recommended }
// kind: 'unstable' (buggy, not recommended), 'stable' (the newest recommended or
// tested one), 'previous' (older than that) or 'untested' (newer, not rated yet).
// Every listed version can still be downloaded (?get=<version>). Patreon preview
// builds aren't on the page.
export async function cspVersions() {
  const r = await run(`${CURL} -s -L --max-time 10 -A AssettoLauncher ${CSP_PAGE}`);
  if (r.exitCode !== 0) return null;
  const html = String(r.stdOut || '');
  const list = [];
  for (const m of html.matchAll(/href="\?info=([\w.-]+)"[^>]*>[^<]*<\/a>\s*\(([^,<)]*),?\s*<span class="tag [^"]*">([^<]*)<\/span>\)/g)) {
    list.push({ version: m[1], size: m[2].trim(), tag: m[3].trim().toLowerCase() });
  }
  const recommended = html.match(/href="\?get=([\w.-]+)"/)?.[1] || '';
  if (recommended && !list.some(v => v.version === recommended)) list.push({ version: recommended, size: '', tag: 'recommended' });
  if (!list.length) return null;
  list.sort((a, b) => compareVersions(b.version, a.version));
  const unstable = t => /buggy|not recommended/.test(t);
  const stable = list.find(v => !unstable(v.tag) && /^(recommended|tested)$/.test(v.tag))?.version || recommended;
  for (const v of list) {
    v.url = `${CSP_PAGE}?get=${v.version}`;
    v.kind = unstable(v.tag) ? 'unstable' : v.version === stable ? 'stable' : stable && compareVersions(v.version, stable) < 0 ? 'previous' : 'untested';
  }
  return { list, latest: list[0].version, recommended: stable || list[0].version };
}

// One version's build number and changelog (acstuff.club/patch/?info=<version>),
// as plain text items with their nesting depth, or null. Cached for the run.
const infoCache = new Map();
export async function cspVersionInfo(version) {
  if (!/^[\w.-]+$/.test(version)) return null;
  if (infoCache.has(version)) return infoCache.get(version);
  const r = await run(`${CURL} -s -L --max-time 10 -A AssettoLauncher "${CSP_PAGE}?info=${version}"`);
  if (r.exitCode !== 0 || !r.stdOut) return null;
  const doc = new DOMParser().parseFromString(String(r.stdOut), 'text/html');
  const changes = [];
  const walk = (ul, depth) => {
    for (const li of ul.children) {
      if (li.tagName !== 'LI') continue;
      const text = [...li.childNodes].filter(n => n.nodeName !== 'UL').map(n => n.textContent).join('').replace(/\s+/g, ' ').trim();
      if (text) changes.push({ text, depth });
      for (const sub of li.children) if (sub.tagName === 'UL') walk(sub, depth + 1);
    }
  };
  const root = doc.querySelector('.changelog > ul');
  if (root) walk(root, 0);
  const info = { version, build: Number(doc.body?.textContent.match(/Version ID:\s*(\d+)/)?.[1]) || 0, changes };
  infoCache.set(version, info);
  return info;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const tempRoot = async () => norm(await Neutralino.os.getEnv(IS_LINUX ? 'TMPDIR' : 'TEMP').catch(() => '') || (IS_LINUX ? '/tmp' : ''));

// curl runs in the background so the window stays responsive; it leaves "<file>.done"
// with ok/fail when it ends, and the file's size is the progress.
async function download(url, file, onProgress) {
  const done = `${file}.done`;
  await Neutralino.filesystem.remove(done).catch(() => {});
  await Neutralino.filesystem.remove(file).catch(() => {});
  const head = await run(`${CURL} -s -I -L --max-time 15 -A AssettoLauncher "${url}"`);
  const total = Number([...String(head.stdOut || '').matchAll(/content-length:\s*(\d+)/gi)].pop()?.[1]) || 0;
  const args = `-s -L -f --retry 2 --connect-timeout 20 --max-time 3600 -A AssettoLauncher`;
  if (IS_LINUX) {
    await sh(`${CURL} ${args} -o ${shQuote(file)} ${shQuote(url)} && echo ok > ${shQuote(done)} || echo fail > ${shQuote(done)}`, { background: true });
  } else {
    await powershell(`& curl.exe ${args} -o ${psQuote(file)} '${url}'; $r = if ($LASTEXITCODE -eq 0) { 'ok' } else { 'fail' }; Set-Content -Encoding ascii -LiteralPath ${psQuote(done)} -Value $r`, { background: true });
  }
  for (;;) {
    await sleep(500);
    const size = (await Neutralino.filesystem.getStats(file).catch(() => null))?.size || 0;
    onProgress?.({ stage: 'download', done: size, total });
    const result = await readText(done);
    if (result == null) continue;
    if (result.trim() !== 'ok') throw new Error('The download failed. Check your connection and try again.');
    return;
  }
}

// installed.log lists the files of the installed version, so the next update can
// remove the ones it doesn't have: "version: x", "build: n", then
// "directory: rel" and "file: rel:checksum:size:mtime" (paths relative to
// extension\; the same format Content Manager uses, checksum left empty). Lines
// after "chunk:" are Content Manager's own data pack; they're ignored, and not
// written back (the public zip already has those files).
function parseInstalledLog(text) {
  const out = { build: -1, files: [] };
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (/^chunk\s*:/i.test(line)) break;
    const [key, value = ''] = line.split(/:(.*)/s);
    if (key.trim() === 'build') out.build = Number(value.trim());
    if (key.trim() === 'file') {
      const [rel, , , mtime] = value.split(':');
      if (rel?.trim()) out.files.push({ rel: rel.trim().replace(/\\/g, '/'), mtime: Number(mtime) || 0 });
    }
  }
  return out;
}

// Installs or updates CSP from the public zip (dwrite.dll + extension/), on its
// own (Content Manager isn't needed): only those two are copied into the AC
// folder; files of the previous version that aren't in the new one are removed
// unless the user changed them; installed.log is rewritten for the next update.
// The user's CSP settings (Documents) aren't touched.
// onProgress({ stage: 'download'|'extract'|'copy'|'finish', done?, total? }).
export async function installCsp(paths, { version, url }, onProgress) {
  const ac = paths.ac.install;
  if (!ac || !(await exists(join(ac, 'acs.exe')))) throw new Error('Assetto Corsa was not found. Check its folder in Settings.');
  if (!/^https:\/\/acstuff\.club\/patch\/\?get=[\w.-]+$/.test(url)) throw new Error('Unexpected download address');
  if (await isProcessRunning('acs')) throw new Error('Close Assetto Corsa first.');

  const tmp = join(await tempRoot(), 'acl-csp');
  await Neutralino.filesystem.remove(tmp).catch(() => {});
  await ensureDir(join(tmp, 'x'));
  try {
    const zip = join(tmp, `csp-${version}.zip`);
    await download(url, zip, onProgress);

    onProgress?.({ stage: 'extract' });
    await extractArchive(zip, join(tmp, 'x'));
    const src = join(tmp, 'x');
    const newManifest = parseIni(await readText(join(src, 'extension/config/data_manifest.ini')));
    if (!(await exists(join(src, 'dwrite.dll'))) || !newManifest.VERSION?.SHADERS_PATCH) throw new Error('The download is not a Custom Shaders Patch package.');
    if (await isProcessRunning('acs')) throw new Error('Close Assetto Corsa first.');

    onProgress?.({ stage: 'copy' });
    const extDir = join(ac, 'extension');
    const entries = await Neutralino.filesystem.readDirectory(join(src, 'extension'), { recursive: true }).catch(() => []);
    const base = (norm(join(src, 'extension')) + '/').toLowerCase();
    const rel = e => { const p = norm(e.path); return p.toLowerCase().startsWith(base) ? p.slice(base.length) : p; };
    const newFiles = entries.filter(e => e.type === 'FILE').map(rel);
    const newDirs = entries.filter(e => e.type === 'DIRECTORY').map(rel);

    // Files of the previous version (when its log matches what's installed) that the new one doesn't have.
    const currentBuild = Number(parseIni(await readText(join(extDir, 'config/data_manifest.ini'))).VERSION?.SHADERS_PATCH_BUILD) || 0;
    const old = parseInstalledLog(await readText(join(extDir, 'installed.log')));
    const inSync = old.build === currentBuild; // else the log is from another install: nothing is removed
    if (inSync && old.files.length) {
      const keep = new Set(newFiles.map(f => f.toLowerCase()));
      for (const f of old.files.filter(f => !keep.has(f.rel.toLowerCase()))) {
        const st = await Neutralino.filesystem.getStats(join(extDir, f.rel)).catch(() => null);
        if (st?.isFile && st.modifiedAt / 1000 <= f.mtime + 60) await Neutralino.filesystem.remove(join(extDir, f.rel)).catch(() => {});
      }
    }

    await ensureDir(extDir);
    await Neutralino.filesystem.copy(join(src, 'extension'), extDir, { recursive: true, overwrite: true });
    await Neutralino.filesystem.copy(join(src, 'dwrite.dll'), join(ac, 'dwrite.dll'), { overwrite: true });

    onProgress?.({ stage: 'finish' });
    const stats = await mapLimit(newFiles, 16, f => Neutralino.filesystem.getStats(join(extDir, f)));
    const win = p => p.replace(/\//g, '\\');
    const lines = [
      '# Generated automatically during last patch installation via Assetto Launcher (Content Manager\'s format).',
      '# Do not edit, unless you have to for some reason.',
      `version: ${newManifest.VERSION.SHADERS_PATCH}`,
      `build: ${newManifest.VERSION.SHADERS_PATCH_BUILD || ''}`,
      ...newDirs.map(d => `directory: ${win(d)}`),
      ...newFiles.map((f, i) => `file: ${win(f)}::${stats[i]?.size ?? 0}:${Math.floor((stats[i]?.modifiedAt || 0) / 1000)}`),
    ];
    await writeText(join(extDir, 'installed.log'), lines.join('\r\n') + '\r\n');
    log(`csp installed ${newManifest.VERSION.SHADERS_PATCH} (${newManifest.VERSION.SHADERS_PATCH_BUILD})`);
    return newManifest.VERSION.SHADERS_PATCH;
  } finally {
    await Neutralino.filesystem.remove(tmp).catch(() => {});
  }
}
