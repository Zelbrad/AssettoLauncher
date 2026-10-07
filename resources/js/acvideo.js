// Assetto Corsa's main video settings (Documents\Assetto Corsa\cfg\video.ini),
// with the values AC's launcher and Content Manager use. Only the keys shown in
// Settings are changed; AC reads the file when it starts.
import { join, readText, writeText, exists, powershell, sh, IS_LINUX, log } from './util.js';
import { parseIni, setIni, deleteKeys } from './ini.js';

export const AA_LEVELS = [[1, 'Off'], [2, '2×'], [4, '4×'], [8, '8×']];
export const ANISO_LEVELS = [[0, 'Off'], [2, '2×'], [4, '4×'], [8, '8×'], [16, '16×']];
export const SHADOW_SIZES = [[-1, 'Off'], [512, '512 px'], [1024, '1024 px'], [2048, '2048 px'], [3072, '3072 px'], [4096, '4096 px']];
export const FPS_LIMITS = [0, 30, 60, 75, 90, 100, 120, 144, 165, 180, 240];

const num = (v, d) => (v == null || v === '' || isNaN(Number(v)) ? d : Number(v));

export const readVideoIni = async paths => (paths.ac.cfg ? readText(join(paths.ac.cfg, 'video.ini')) : null);

// null when AC hasn't written video.ini yet.
export async function readVideo(paths) {
  const ini = parseIni(await readVideoIni(paths) || '');
  const v = ini.VIDEO;
  if (!v) return null;
  const cap = num(v.FPS_CAP_MS, 0);
  return {
    fullscreen: num(v.FULLSCREEN, 1) !== 0,
    width: num(v.WIDTH, 1920), height: num(v.HEIGHT, 1080),
    refresh: num(ini.REFRESH?.VALUE ?? v.REFRESH, 60),
    vsync: num(v.VSYNC, 0) !== 0,
    // FPS_CAP_MS is the frame time in ms (Content Manager: 1000 / limit); 0 = no limit.
    fps: Math.abs(cap) >= 0.1 ? Math.round(1000 / cap) : 0,
    aa: num(v.AASAMPLES, 1), aniso: num(v.ANISOTROPIC, 8), shadows: num(v.SHADOW_MAP_SIZE, 2048),
  };
}

// Applies { key: value } (keys of readVideo). The resolution goes into WIDTH and
// HEIGHT and INDEX is cleared, as AC's own launcher does (INDEX points into its
// own list of modes); the refresh rate goes into [VIDEO] REFRESH and [REFRESH] VALUE.
export async function writeVideo(paths, c) {
  const path = join(paths.ac.cfg, 'video.ini');
  let text = await readText(path);
  if (text == null) throw new Error('video.ini was not found. Start Assetto Corsa once, then try again.');
  if (!(await exists(path + '.launcher-backup'))) await writeText(path + '.launcher-backup', text);
  const set = (section, key, value) => { text = setIni(text, section, key, value); };
  if ('fullscreen' in c) set('VIDEO', 'FULLSCREEN', c.fullscreen ? 1 : 0);
  if ('width' in c) { set('VIDEO', 'WIDTH', c.width); set('VIDEO', 'HEIGHT', c.height); text = deleteKeys(text, 'VIDEO', /^INDEX$/i); }
  if ('refresh' in c) { set('VIDEO', 'REFRESH', c.refresh); set('REFRESH', 'VALUE', c.refresh); }
  if ('vsync' in c) set('VIDEO', 'VSYNC', c.vsync ? 1 : 0);
  if ('fps' in c) set('VIDEO', 'FPS_CAP_MS', c.fps ? (1000 / c.fps).toFixed(3) : 0);
  if ('aa' in c) set('VIDEO', 'AASAMPLES', c.aa);
  if ('aniso' in c) set('VIDEO', 'ANISOTROPIC', c.aniso);
  if ('shadows' in c) set('VIDEO', 'SHADOW_MAP_SIZE', c.shadows);
  // Post-processing: on/off and the filter (system/cfg/ppfilters/<filter>.ini).
  if ('pp' in c) set('POST_PROCESS', 'ENABLED', c.pp ? 1 : 0);
  if ('filter' in c) set('POST_PROCESS', 'FILTER', c.filter);
  await writeText(path, text);
  log(`video.ini: ${JSON.stringify(c)}`);
}

// The display's modes, biggest first: [{ width, height, rates: [Hz…] }]. Windows
// asks the display adapter (CIM), Linux asks xrandr; [] when neither answers.
let modesCache = null;
export async function displayModes() {
  if (modesCache) return modesCache;
  const modes = new Map();
  const add = (w, h, hz) => {
    if (!(w >= 800 && h >= 600)) return;
    const k = `${w}x${h}`;
    if (!modes.has(k)) modes.set(k, { width: w, height: h, rates: new Set() });
    if (hz > 0) modes.get(k).rates.add(Math.round(hz));
  };
  try {
    if (IS_LINUX) {
      const r = await sh('xrandr --current 2>/dev/null');
      for (const m of String(r.stdOut || '').matchAll(/^\s+(\d+)x(\d+)\s+(.*)$/gm)) {
        for (const hz of m[3].matchAll(/(\d+(?:\.\d+)?)/g)) add(Number(m[1]), Number(m[2]), Number(hz[1]));
      }
    } else {
      const r = await powershell("Get-CimInstance CIM_VideoControllerResolution | ForEach-Object { '{0}x{1}@{2}' -f $_.HorizontalResolution,$_.VerticalResolution,$_.RefreshRate }");
      for (const m of String(r.stdOut || '').matchAll(/(\d+)x(\d+)@(\d+)/g)) add(Number(m[1]), Number(m[2]), Number(m[3]));
    }
  } catch (err) { log(`display modes: ${err?.message || err}`); }
  modesCache = [...modes.values()]
    .map(m => ({ ...m, rates: [...m.rates].sort((a, b) => b - a) }))
    .sort((a, b) => b.width * b.height - a.width * a.height || b.width - a.width);
  return modesCache;
}
