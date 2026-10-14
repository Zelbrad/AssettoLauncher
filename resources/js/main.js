import { GAMES, gameByKey, resolvePaths, SCANNERS, setEnabled, contentFolder, evoCacheDir, uninstallPaths, uninstallItem, rallyIncompatible, ACC_CARS, RALLY_CARS, rallyCarName, rallyCarIds, appCacheDir, rallyGameStages, markFresh } from './games.js';
import { ACC_TRACKS, ACC_MODES, ACC_WEATHER, ACC_TIME_SPEEDS, accSeasonName, accOwnedDlcs, accModelOwned, accTrackOwned, accSeasonOwned, accModelClass, readAccSession, accCustomCars, writeAccSession, ensureModelCar } from './acclaunch.js';
import { readRallySave, rallyStage, writeRallySession, rallyBests, rallyRecords, RALLY_WEATHER_IDS, RALLY_KNOWN_STAGES, rallyCover, rallySelectedLiveries, RALLY_WEATHERS, RALLY_TIME_SPEEDS, RALLY_FORECAST_PROBABILITY, RALLY_PERSISTENCE, RALLY_GRIP, rallyLocationWeathers, rallyWeatherFor } from './rallylaunch.js';
import { loadRallyData, refreshRallyData, rallyGroupText, rallyGroupName, rallyCarText, rallyCarPicture, rallyStageMedia, rallyAiTime } from './rallydata.js';
import { TIERS, AC_LEVELS, academyProgress, eventTier, acCareer, acSpecialEvents, seriesState, seriesGoalText, seriesLocked, nextRound, standings, goalValue, scoreText, betterScore, startAcEvent, writeAcEvent, readAcResult, recordResult, tierFor, setLastEvent, restartChampionship, useAcademyStore, evoAcademy, rallyAcademy, levelMedals, levelLocked, levelBefore, levelGolds, bonusLocked, levelEvents, driverLevel, srOf, srGrade, srGradeMin, srLoss, changeSR, srShort, srReader, evoSessionFor, readEvoResult, evoResultFile, evoLapTooShort, readEvoSprint, sprintReader, raceReader, lapReader, acClasses, classEventLocked, classSession, classGrid } from './academy.js';
import { RALLY_RELEASED } from './academy-data.js';
import { setupGroups, compareGroups, positionLabel, setupTrackName, renameSetup, duplicateSetup, deleteSetup, exportSetup, exportName, readSetupFile, importSetup, setupSig, allSetupRuns, runsOf, addSetupRun, readAcRun, ACC_SETUP_CARS } from './setups.js';
import { SITE_PAGES, siteMaps, rallyStagePhotos, imageSizes, stageGroupOf, words } from './sitecatalog.js';
import { acBests, acBestKey, evoBests, evoBestKey, lapTime } from './bests.js';
import { checkMods } from './health.js';
import { acUpdates, cupDetails } from './updates.js';
import { listBackups, createBackup, restoreBackup, deleteBackup, autoBackups, backupsRoot } from './backups.js';
import { findSteamPath, findInstalledApps, getNews, cachedNews, refreshNews, getStoreDetails, newsPageUrl, steamUrls, appBuilds } from './steam.js';
import { quickDrive, readAcSession, defaultAcSession, acWeathers, roadTemperature, presetForType, AC_MODES, AC_GRIP, AC_ASSIST_PRESETS } from './quickdrive.js';
import { readCsp, cspVersions, cspVersionInfo, installCsp, uninstallWeatherMod, deselectWeatherMod, writeCspSetting, compareVersions, cspWeatherLabel, isWetWeather, CSP_WEATHER_TYPES, CSP_PAGE, VCREDIST_URL, SOL_URL, PURE_URL, PROTON_DLL_OVERRIDE } from './csp.js';
import { readVideo, writeVideo, displayModes, AA_LEVELS, ANISO_LEVELS, SHADOW_SIZES, FPS_LIMITS } from './acvideo.js';
import { listPpFilters, uninstallPpFilter, restorePpFilter } from './ppfilters.js';
import { primeChime, playChime } from './chime.js';
import { startTelemetry } from './evotelemetry.js';
import { knownCars, withAllConfigs, launchEvo, readEvoSession, defaultEvoSession, EVO_MODES, EVO_WEATHER, EVO_GRIP, EVO_TIME_SPEEDS } from './evolaunch.js';
import { IMPORT_RE, resolveDropped, prepareImport, installItem, setItemCar, carChoices, discardImport } from './installer.js';
import { syncEvoTrackList, restoreEvoTrackList, evoTrackListStatus } from './evotracks.js';
import { readEvoExtras, readCarPresets, isLazyImage, lazyImage } from './kspkg.js';
import { latestRelease, isNewer, isInstalledCopy, installUpdate } from './appupdate.js';
import { esc, timeAgo, openExternal, openFile, openFolder, safeUrl, powershellEncodedCommand, storageGet, storageSet, norm, log, exists, basename, prettifyId, fileUrl, mountDir, listDir, join, run, runningProcesses, stopProcess, readText, writeText, ensureDir, overlayFile, CURL, NULL_DEV, IS_LINUX } from './util.js';
import { tr, trn, N_, loadLanguage, systemLanguage, LANGUAGES, lang } from './i18n.js';

Neutralino.init();

const DEFAULT_SETTINGS = { overrides: {}, minimizeOnLaunch: true, lastGame: 'rally', acFilter: 'all', academyCard: true, academyCardSeconds: 8, academyCardSound: true };

const state = {
  view: 'games',
  game: 'rally',
  settings: { ...DEFAULT_SETTINGS },
  steamPath: '',
  installed: {},
  paths: null,
  cache: {},           // `${game}:${tab}` -> items
  tab: {},             // game -> active mods tab
  brand: {},           // game -> brand picked on the Mods car page ('' = all)
  search: '',
  news: {},            // appid -> items
};

const $ = (sel, root = document) => root.querySelector(sel);
const main = $('#main');
// Games whose Cars/Tracks tabs list the game's own content next to mods (Mods / All content).
const hasOfficialContent = (g, tab = currentTab(g)) => ((g.key === 'ac' || g.key === 'evo') && tab !== 'setups') || (g.key === 'rally' && (tab === 'cars' || tab === 'tracks'));
const isInstalled = g => !!state.installed[g.appid] || !!state.settings.overrides[`${g.key}_install`];

// ---------------------------------------------------------------------------
// Bits of UI shared across views

function logoHTML(g) {
  return `<img class="logo ${g.key}" src="/img/logos/${g.key}.png" alt="${esc(`${g.title} ${g.sub}`.trim())}" draggable="false">`;
}

let toastTimer;
function toast(msg, error = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'show' + (error ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = ''), 3200);
}

// Card/thumbnail images fall back through data-fallback, then to a placeholder.
function imgFail(img) {
  // An EVO picture not decoded yet: decode it now (cards only load near the
  // view), keep the card blank meanwhile, then show it.
  const src = img.getAttribute('src') || '';
  if (!img.dataset.lazy && isLazyImage(src)) {
    img.dataset.lazy = '1';
    img.style.visibility = 'hidden';
    lazyImage(src, true, img).then(ok => {
      if (!img.isConnected) return;
      img.style.visibility = '';
      if (ok) { img.removeAttribute('src'); img.src = src; } else imgFail(img);
    });
    return;
  }
  const next = img.dataset.fallback;
  if (next) {
    img.dataset.fallback = '';
    img.classList.add('contain');
    img.src = next;
  } else {
    img.style.display = 'none';
    img.closest('.thumb, .detail-hero')?.classList.add('noimg');
  }
}

// Image errors: <img data-err> says what to do, so there are no inline onerror
// handlers (text from data files inside one could run as code).
// "fallback": imgFail. "remove": data-fallback once if set, then remove the
// image. "initials": replace it with a span of data-initials.
document.addEventListener('error', e => {
  const img = e.target;
  const how = img instanceof HTMLImageElement && img.dataset.err;
  if (!how) return;
  if (how === 'fallback') return imgFail(img);
  if (how === 'initials') return img.replaceWith(Object.assign(document.createElement('span'), { textContent: img.dataset.initials || '' }));
  const next = img.dataset.fallback;
  if (next) { img.dataset.fallback = ''; img.src = next; } else img.remove();
}, true);

function imgTag(src, fallback, cls = 'main') {
  if (!src && !fallback) return '';
  const first = src || fallback;
  const fb = src ? (fallback || '') : '';
  return `<img class="${cls}${!src ? ' contain' : ''}" src="${esc(first)}" data-fallback="${esc(fb)}" loading="lazy" data-err="fallback" alt="">`;
}

// Track outlines on cards and detail pages (AC's outline.png, EVO's, Rally's maps)
// come with any amount of empty space around the drawing. Each one is cropped to
// the drawing when it first loads (once per picture), so the CSS can fit every
// outline in the same corner box. Hidden until then (app.css); a picture that
// can't be read (from another site) is shown as it is.
const trimmedOutlines = new Map();
function trimOutline(img) {
  const src = img.getAttribute('src');
  if (!trimmedOutlines.has(src)) trimmedOutlines.set(src, new Promise(done => {
    try {
      const k = Math.min(1, 400 / Math.max(img.naturalWidth, img.naturalHeight, 1));
      const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0, w, h);
      const a = g.getImageData(0, 0, w, h).data;
      let x0 = w, y0 = h, x1 = -1, y1 = -1;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (a[(y * w + x) * 4 + 3] <= 40) continue;
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
      // Empty, or nothing to cut away (no transparent border).
      if (x1 < 0 || (x0 === 0 && y0 === 0 && x1 === w - 1 && y1 === h - 1)) { done(src); return; }
      x0 = Math.max(0, x0 - 2); y0 = Math.max(0, y0 - 2); x1 = Math.min(w - 1, x1 + 2); y1 = Math.min(h - 1, y1 + 2);
      const out = document.createElement('canvas');
      out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
      out.getContext('2d').drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
      done(out.toDataURL('image/png'));
    } catch { done(src); }
  }));
  trimmedOutlines.get(src).then(url => {
    img.dataset.trimmed = '1';
    if (url !== src) img.src = url;
  });
}
document.addEventListener('load', e => {
  const img = e.target;
  if (img instanceof HTMLImageElement && img.classList.contains('overlay') && !img.dataset.trimmed) trimOutline(img);
}, true);

function initials(title) {
  const words = String(title).replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(/\s+/);
  return esc(words.slice(0, 2).map(w => w[0] || '').join('').toUpperCase());
}

function modal(html, cls = 'modal', onClose) {
  const root = $('#modal-root');
  root.__onClose?.();
  root.innerHTML = `<div class="modal-backdrop"><div class="${cls}"><button class="close" data-close>✕</button>${html}</div></div>`;
  root.__onClose = onClose;
  const backdrop = root.firstElementChild;
  // Dialogs with a header get the close button inside it, centred on the header.
  const head = backdrop.querySelector('.qd-head');
  if (head) head.appendChild(backdrop.querySelector('.close'));
  const close = () => {
    if (!backdrop.isConnected) return;
    backdrop.querySelector('video')?.pause(); root.__hls?.destroy(); root.__hls = null; root.innerHTML = '';
    root.__onClose = null; onClose?.();
  };
  backdrop.addEventListener('click', e => {
    if (backdrop.firstElementChild.dataset.busy) return; // e.g. mid-install
    if (e.target === backdrop || e.target.closest('[data-close]')) close();
  });
  return { el: backdrop.firstElementChild, close };
}

// The window is borderless (its own title bar), so Windows gives it no resize
// frame: thin grips along its edges and corners resize it through Neutralino.
// They're hidden while maximized. k converts screen CSS px to window px.
// The default size is the smallest: the layout is designed for it (smaller would zoom the text out).
const MIN_WIN = { width: 1540, height: 795 };
function windowGrips() {
  document.body.insertAdjacentHTML('beforeend', `<div id="win-grips">${['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']
    .map(d => `<div class="rz rz-${d}" data-rz="${d}"></div>`).join('')}</div>`);
  $('#win-grips').addEventListener('pointerdown', async e => {
    const grip = e.target, dir = grip.dataset.rz;
    if (!dir || e.button !== 0) return;
    e.preventDefault();
    try { grip.setPointerCapture(e.pointerId); } catch { /* synthetic event (snapshot test) */ }
    const x0 = e.screenX, y0 = e.screenY;
    let start = null, want = null, busy = false;
    // One resize at a time; the latest pointer position wins.
    const apply = async () => {
      if (busy || !want || !start) return;
      busy = true;
      const w = want; want = null;
      try {
        if (w.x !== start.x || w.y !== start.y) await Neutralino.window.move(w.x, w.y);
        await setWindowSize(w.width, w.height);
      } catch (err) { log(`resize: ${JSON.stringify(err)}`); }
      busy = false;
      apply();
    };
    let last = null; // pointer moves before the window's size is known are replayed then
    const move = ev => {
      last = ev;
      if (!start) return;
      const dx = Math.round((ev.screenX - x0) * start.k), dy = Math.round((ev.screenY - y0) * start.k);
      let { width, height, x, y } = start;
      if (dir.includes('e')) width = Math.max(MIN_WIN.width, start.width + dx);
      if (dir.includes('s')) height = Math.max(MIN_WIN.height, start.height + dy);
      if (dir.includes('w')) { width = Math.max(MIN_WIN.width, start.width - dx); x = start.x + start.width - width; }
      if (dir.includes('n')) { height = Math.max(MIN_WIN.height, start.height - dy); y = start.y + start.height - height; }
      want = { width, height, x, y };
      apply();
    };
    const up = () => {
      grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up);
      document.body.classList.remove('resizing');
    };
    document.body.classList.add('resizing');
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    try {
      const [size, pos] = await Promise.all([Neutralino.window.getSize(), Neutralino.window.getPosition()]);
      start = { width: size.width, height: size.height, x: pos.x, y: pos.y, k: size.width / outerWidth || 1 };
    } catch (err) { log(`resize start: ${JSON.stringify(err)}`); }
    if (last) move(last);
  });
}
// Neutralino's setSize gives a resizable window Windows' resize frame
// (WS_THICKFRAME), which a borderless window shows as a strip above the title
// bar; resizable: false keeps it off (the grips do the resizing). Restoring the
// last size at launch adds the frame too, so startup calls this once.
function setWindowSize(width, height) {
  return Neutralino.window.setSize({ width, height, minWidth: MIN_WIN.width, minHeight: MIN_WIN.height, resizable: false });
}
async function dropResizeFrame() {
  try {
    if (await Neutralino.window.isMaximized()) return;
    const s = await Neutralino.window.getSize();
    await setWindowSize(Math.max(MIN_WIN.width, s.width), Math.max(MIN_WIN.height, s.height));
  } catch (err) { log(`resize frame: ${JSON.stringify(err)}`); }
}
let wasMaximized = null;
async function syncMaximized() {
  let max;
  try { max = await Neutralino.window.isMaximized(); } catch { return; /* not ready */ }
  document.body.classList.toggle('maximized', max);
  if (max === wasMaximized) return;
  // A window that started maximized gets the resize frame dropped when it's restored.
  if (wasMaximized && !max) await dropResizeFrame();
  wasMaximized = max;
  windowFrame();
}

// Windows 11 rounds the corners of normal windows but not of borderless ones
// unless asked: DWMWA_WINDOW_CORNER_PREFERENCE (33) = DWMWCP_ROUNDSMALL (3), a
// ~4-5 px radius that keeps the window's shadow. Asked for, the corners and the
// 1 px border (DWMWA_BORDER_COLOR, 34) stay while maximized too, showing the
// window behind at the screen's edges, so a maximized window gets square corners
// (DWMWCP_DONOTROUND, 1) and no border (DWMWA_COLOR_NONE). A window that starts
// maximized (its saved state) also reaches 8 px past every edge of the screen's
// work area (the screen minus the taskbar), the frame Windows leaves room for:
// it's fitted to the work area. The helper works in real pixels (per-monitor DPI
// aware), so display scaling doesn't round it off. Older Windows ignores the DWM
// attributes. One PowerShell stays open for this, so the switch is instant.
const WINDOW_FRAME_CS = 'using System; using System.Runtime.InteropServices; public static class LauncherWindow {'
  + ' [StructLayout(LayoutKind.Sequential)] public struct R { public int L, T, Rt, B; }'
  + ' [StructLayout(LayoutKind.Sequential)] public struct MI { public int cb; public R mon; public R work; public int f; }'
  + ' [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr h);'
  + ' [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out R r);'
  + ' [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, int f);'
  + ' [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr m, ref MI i);'
  + ' [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int cx, int cy, uint f);'
  + ' [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr h, int a, ref int v, int s);'
  + ' [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);'
  + ' public static string Fit(IntPtr h) {'
  + '  try { SetThreadDpiAwarenessContext(new IntPtr(-4)); } catch (EntryPointNotFoundException) { }'
  + '  bool max = IsZoomed(h); int corner = max ? 1 : 3, border = max ? -2 : -1;'
  + '  DwmSetWindowAttribute(h, 33, ref corner, 4); DwmSetWindowAttribute(h, 34, ref border, 4);'
  + '  if (!max) return "normal";'
  + '  R r; GetWindowRect(h, out r); MI mi = new MI(); mi.cb = Marshal.SizeOf(mi); GetMonitorInfo(MonitorFromWindow(h, 2), ref mi);'
  + '  R w = mi.work; int o = w.L - r.L;'
  + '  if (o <= 0 || o > 32 || r.Rt - w.Rt != o || w.T - r.T != o || r.B - w.B != o) return "maximized " + (r.Rt - r.L) + "x" + (r.B - r.T);'
  + '  SetWindowPos(h, IntPtr.Zero, w.L, w.T, w.Rt - w.L, w.B - w.T, 0x14);'
  + '  return "maximized, pulled in " + o + " px to " + (w.Rt - w.L) + "x" + (w.B - w.T); } }';
let frameHelper = null;
async function windowFrame() {
  if (!window.NL_PID || IS_LINUX) return;
  try {
    frameHelper ||= (async () => {
      const p = await Neutralino.os.spawnProcess('powershell -NoProfile -NonInteractive -WindowStyle Hidden -Command -');
      Neutralino.events.on('spawnedProcess', e => {
        const text = String(e.detail.data ?? '').trim();
        if (e.detail.id === p.id && e.detail.action !== 'exit' && text) log(`window frame: ${text}`);
      });
      await Neutralino.os.updateSpawnedProcess(p.id, 'stdIn', `Add-Type -TypeDefinition '${WINDOW_FRAME_CS}'; $h = (Get-Process -Id ${window.NL_PID}).MainWindowHandle\n`);
      return p.id;
    })();
    await Neutralino.os.updateSpawnedProcess(await frameHelper, 'stdIn', '[LauncherWindow]::Fit($h)\n');
  } catch (err) { frameHelper = null; log(`window frame: ${err?.message || JSON.stringify(err)}`); }
}

// No browser context menu (Back, Reload, Save as, Inspect...): it doesn't belong
// in an app. Text fields keep it for cut, copy and paste.
document.addEventListener('contextmenu', e => {
  if (!e.target.closest('input, textarea, [contenteditable="true"]')) e.preventDefault();
});

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  // A sheet over a dialog (Quick Drive session settings) closes first.
  const sheet = $('#modal-root .qd-sheet-wrap');
  if (sheet) sheet.remove(); else $('#modal-root [data-close]')?.click();
});

// Running games. From the moment a game is launched, and while its process
// runs (checked every few seconds while the launcher is visible), its launch
// buttons (Play, Quick Drive's Set up & start) say Close instead. Close takes
// a second click, asks the game to close as its own close button would (so it
// can save on the way out), and when the game is still open 10 s later the
// button offers Force close.
const GAME_PROCESS = { ac: 'acs', acc: 'AC2-Win64-Shipping', evo: 'AssettoCorsaEVO', rally: 'acr' };
const STARTING_MS = 90 * 1000; // Steam can take a while to start a game; after this a launch that never ran is forgotten
const running = new Set(), starting = new Map(), closing = new Set(), forceStop = new Set();
const isUp = key => running.has(key) || Date.now() - (starting.get(key) || 0) < STARTING_MS;

async function checkRunning() {
  if (document.hidden) return;
  const procs = await runningProcesses(Object.values(GAME_PROCESS)).catch(() => null);
  if (!procs) return;
  running.clear();
  for (const k of Object.keys(GAME_PROCESS)) if (procs.has(GAME_PROCESS[k])) { running.add(k); starting.delete(k); }
  for (const k of [...forceStop]) if (!running.has(k)) forceStop.delete(k);
  // A game seen running (launched here or not) that has closed, or a launch whose
  // game ran while the launcher was minimized: its results are read now.
  for (const k of Object.keys(GAME_PROCESS)) {
    if (running.has(k)) { (launches[k] ||= { at: Date.now() }).seen = true; continue; }
    const l = launches[k];
    if (l && (l.seen || Date.now() - l.at > STARTING_MS)) {
      delete launches[k];
      gameClosed(k, l).catch(err => log(`results ${k}: ${err?.message || err}`));
    }
  }
  // Also catches a launch that never started (its STARTING_MS ran out).
  if (upState() !== shownUp) syncRunning();
}

// Each launch (and each game seen running): { at, seen, …what Quick Drive set up
// (nextLaunch) }, until the game has closed and its results were read.
const launches = {}, nextLaunch = {};
async function gameClosed(key, l) {
  if (key === 'evo') watchStop();
  if (l.academy) await academyClosed(key, l).catch(err => log(`academy result: ${err?.stack || err}`));
  if (key === 'ac' && l.academy?.layout) await restoreClassLayout(l.academy.layout).catch(err => log(`academy layout: ${err?.message || err}`));
  if (key === 'ac') {
    const r = await readAcRun(state.paths, l.at - 5000);
    if (!r?.ms || !r.values.length) return;
    const sig = setupSig(r.values);
    const named = (await getItems(gameByKey('ac'), 'setups', true).catch(() => [])).find(i => i.carId.toLowerCase() === r.car.toLowerCase())?.setups.find(s => setupSig(s.values) === sig);
    await addSetupRun({ game: 'ac', car: r.car, track: r.track, sig, name: named?.name || '', ms: r.ms, laps: r.laps, at: Date.now() });
    if (named) toast(tr('Best lap {time} with your setup {name} (saved to its times).', { time: lapTime(r.ms), name: named.name }));
    log(`results ac: ${r.car} ${r.track} ${r.ms} ms, ${r.laps} laps, setup ${named?.name || sig}`);
  }
  if (key === 'rally' && l.setup) {
    // Stage records that are new or better than when Rally was started.
    const after = await rallyBests(state.paths);
    let n = 0;
    for (const [k, v] of after) {
      const [stage, car] = k.split('|');
      if (car.toLowerCase() !== l.car.toLowerCase() || (l.before[k] && v.ms >= l.before[k])) continue;
      await addSetupRun({ game: 'rally', car, track: stage, sig: l.setup.sig, name: l.setup.name, ms: v.ms, laps: 1, at: Date.now() });
      n++;
      toast(tr('New best on {stage}: {time} with {name}.', { stage: rallyStage(stage).name || rallyStage(stage).stage, time: lapTime(v.ms), name: l.setup.name }));
    }
    log(`results rally: ${n} new stage bests with ${l.setup.name}`);
  }
}
const upState = () => Object.keys(GAME_PROCESS).map(k => `${isUp(k)}${forceStop.has(k)}`).join();
let shownUp = '';

function markStarting(key) {
  starting.set(key, Date.now());
  launches[key] = { at: Date.now(), ...(nextLaunch[key] || {}) };
  delete nextLaunch[key];
  syncRunning();
}

// While the game runs, a start button says just "Close".
const stopLabel = key => closing.has(key) ? tr('Closing…') : forceStop.has(key) ? tr('Force close') : tr('Close');

// Launch buttons carry data-launch-game; their own label is kept in data-label.
function syncRunning(root = document) {
  if (root === document) { shownUp = upState(); if (state.view === 'academy') drawAcademyRunning(); }
  for (const b of root.querySelectorAll('[data-launch-game]')) {
    const key = b.dataset.launchGame, up = isUp(key);
    b.dataset.label ??= b.innerHTML;
    if (up) b.textContent = stopLabel(key); else b.innerHTML = b.dataset.label;
    if (up || b.classList.contains('stop')) b.disabled = up && closing.has(key);
    b.classList.toggle('stop', up);
    delete b.dataset.armed;
  }
}

// Captured before the buttons' own launch handlers, which it stops while the game is up.
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-launch-game]');
  if (!b || !isUp(b.dataset.launchGame)) return;
  e.stopPropagation(); e.preventDefault();
  const key = b.dataset.launchGame, force = forceStop.has(key), g = gameByKey(key);
  if (!b.dataset.armed) {
    b.dataset.armed = '1';
    b.textContent = force ? tr('Click again: unsaved progress is lost') : tr('Click again to close');
    setTimeout(() => { if (b.isConnected && b.dataset.armed) { delete b.dataset.armed; b.textContent = stopLabel(key); } }, 4000);
    return;
  }
  closing.add(key); starting.delete(key);
  syncRunning();
  await stopProcess(GAME_PROCESS[key], force);
  for (let i = 0; i < 10 && running.has(key); i++) {
    await new Promise(r => setTimeout(r, 1000));
    await checkRunning();
  }
  closing.delete(key);
  if (running.has(key)) {
    forceStop.add(key);
    toast(tr('{game} is still open. Close it from the game, or use Force close.', { game: `${g.title} ${g.sub || ''}`.trim() }), true);
  }
  syncRunning();
}, true);

setInterval(checkRunning, 5000);
document.addEventListener('visibilitychange', checkRunning);
checkRunning();

async function launchGame(g) {
  if (g.key === 'rally' && !(await rallyPreflight(g))) return;
  if (g.key === 'evo') await evoTrackSync({ quiet: true });
  await openExternal(steamUrls.run(g.appid));
  markStarting(g.key);
  toast(tr('Launching {game} via Steam…', { game: `${g.title} ${g.sub || ''}`.trim() }));
  if (state.settings.minimizeOnLaunch) setTimeout(() => Neutralino.window.minimize(), 1500);
}

// Game updates: the launcher remembers each game's Steam build id. When Steam
// has updated a game since, its Games and Mods pages say what that means for
// the installed mods until the player dismisses the note.
function checkGameUpdates() {
  const seen = state.settings.builds ||= {};
  const notes = state.settings.updateNotes ||= {};
  for (const g of GAMES) {
    const b = appBuilds[g.appid];
    if (!b || !isInstalled(g)) continue;
    if (seen[g.appid] && seen[g.appid] !== b.build) notes[g.key] = { at: b.updated || Math.floor(Date.now() / 1000) };
    seen[g.appid] = b.build;
  }
  saveSettings();
}

// What the update means for this game's mods, or '' when nothing needs attention.
async function updateNoteText(g) {
  if (g.key === 'rally') {
    const bad = rallyIncompatible(await getItems(g, 'liveries').catch(() => []));
    if (!bad.length) return '';
    return trn(bad.length,
      'A .pak livery was built for the previous version and will crash Rally while enabled ({names}). Disable it until the author releases an update.',
      '{n} .pak liveries were built for the previous version and will crash Rally while enabled ({names}). Disable them until the author releases an update.',
      { names: bad.map(i => i.title).join(', ') });
  }
  if (g.key === 'evo') {
    const mods = (await listDir(state.paths.evo.mods)).filter(e => !['.', '..'].includes(e.entry));
    return mods.length ? tr('Updates can break mod packages ({n} installed). If EVO crashes at start or mod cars or tracks are missing, disable mods here and look for updated versions.', { n: mods.length }) : '';
  }
  if (g.key === 'ac') return tr('Content Manager, Custom Shaders Patch and some mods may need an update for the new version.');
  return ''; // ACC: liveries and custom cars keep working across updates
}

async function showUpdateNote(g) {
  const box = $('#update-note');
  const note = state.settings.updateNotes?.[g.key];
  if (!box || !note) return;
  const text = await updateNoteText(g);
  if (!text) { delete state.settings.updateNotes[g.key]; saveSettings(); return; }
  if (!box.isConnected || state.game !== g.key) return;
  box.innerHTML = `<div class="update-note"><span class="update-note-icon">!</span>
    <div><b>${esc(tr('{game} was updated {when}', { game: `${g.title} ${g.sub || ''}`.trim(), when: timeAgo(note.at) }))}</b><small>${esc(text)}</small></div>
    ${state.view === 'mods' ? '' : `<button class="btn subtle small" data-un="mods">${tr('Review mods')}</button>`}
    <button class="btn subtle small" data-un="ok">${tr('Got it')}</button></div>`;
  box.onclick = e => {
    const v = e.target.closest('[data-un]')?.dataset.un;
    if (v === 'mods') { state.view = 'mods'; render(); }
    if (v === 'ok') { delete state.settings.updateNotes[g.key]; saveSettings(); box.innerHTML = ''; }
  };
}

// Mod health check of the sidebar's game (health.js), plus available updates for AC.
async function openHealthCheck(g) {
  const { el } = modal(`<div class="qd imp">
    <header class="qd-head"><h2>${esc(tr('Mod check · {game}', { game: `${g.title} ${g.sub || ''}`.trim() }))}</h2>
      <div class="qd-sub">${tr('Looks through the installed mods for broken, incomplete or conflicting files.')}</div></header>
    <div class="imp-list"><div class="qd-none">${tr('Checking…')}</div></div>
    <footer class="qd-foot"><div class="qd-summary" id="health-sum"></div><button class="btn subtle small" data-close>${tr('Close')}</button></footer>
  </div>`, 'modal imp-modal');
  let found = [];
  try {
    found = await checkMods(g, getItems, state.paths);
    if (g.key === 'ac') {
      const content = [...await getItems(g, 'cars'), ...await getItems(g, 'tracks')];
      await acUpdates(content);
      for (const i of content.filter(i => i.update)) found.push({ level: 'update', item: i, problem: tr('Version {version} is available (you have {have}).', { version: i.update.version, have: i.version }) });
    }
  } catch (err) { log(`health: ${err?.stack || err}`); }
  if (!el.isConnected) return;
  const label = { error: tr('Problem'), warn: tr('Warning'), info: tr('Note'), update: tr('Update') };
  el.querySelector('.imp-list').innerHTML = found.map((f, i) => `<div class="imp-row health-row">
      <span class="health-level ${f.level}">${label[f.level]}</span>
      <div class="imp-info"><b>${esc(f.item.title)}${f.item.subtitle ? ` <small>${esc(f.item.subtitle)}</small>` : ''}</b><span>${esc(f.problem)}</span></div>
      ${f.level === 'update' ? `<button class="btn primary small" data-get="${i}">${tr('Get update')} ↗</button>` : ''}
      ${f.item.toggle === 'rally' && f.item.incompatible && f.item.enabled ? `<button class="btn primary small" data-off="${i}">${tr('Disable')}</button>` : ''}
      ${f.item.id && f.item.game ? `<button class="btn subtle small" data-show="${i}">${tr('Details')}</button>` : ''}
      <button class="btn subtle small" data-dir="${i}">${tr('Open folder')}</button>
    </div>`).join('') || `<div class="qd-none">${tr('No problems found.')}</div>`;
  const n = lvl => found.filter(f => f.level === lvl).length;
  el.querySelector('#health-sum').textContent = found.length ? [
    n('error') && trn(n('error'), '1 problem', '{n} problems'),
    n('warn') && trn(n('warn'), '1 warning', '{n} warnings'),
    n('info') && trn(n('info'), '1 note', '{n} notes'),
    n('update') && trn(n('update'), '1 update', '{n} updates'),
  ].filter(Boolean).join(' · ') : tr('Everything looks fine.');
  el.addEventListener('click', async e => {
    const b = e.target.closest('[data-get], [data-off], [data-show], [data-dir]');
    if (!b) return;
    const f = found[b.dataset.get ?? b.dataset.off ?? b.dataset.show ?? b.dataset.dir];
    if (b.dataset.get != null) openExternal(f.item.update.get);
    if (b.dataset.dir != null) openFolder(f.item.path.replace(/\/[^/]+\.(kspkg)(\.disabled)?$/i, ''));
    if (b.dataset.show != null) openDetail(g, f.item, () => { if (state.view === 'mods') render(); });
    if (b.dataset.off != null) {
      try {
        await setEnabled(f.item, false);
        f.item.enabled = false;
        f.item.meta.files = f.item.meta.files.map(x => x.replace(/\.disabled$/i, '') + '.disabled');
        b.remove(); toast(tr('Disabled {name}', { name: f.item.title }));
      } catch (err) { toast(tr('Could not disable {name}: {error}', { name: f.item.title, error: err?.message || tr('file in use?') }), true); }
    }
  });
}

// Rally crashes at startup while an enabled .pak livery was cooked for another
// game version (typically after a game update), so offer to disable those first.
// Resolves true to go ahead with the launch.
async function rallyPreflight(g) {
  let bad = [];
  // Car and stage packages (Cars / Tracks tabs) crash it the same way.
  try { bad = rallyIncompatible((await Promise.all(['liveries', 'cars', 'tracks'].map(t => getItems(g, t, true)))).flat()); } catch { return true; }
  if (!bad.length) return true;
  return new Promise(resolve => {
    let answered = false;
    const { el, close } = modal(`<div class="qd imp">
      <header class="qd-head"><h2>${trn(bad.length, 'A livery will crash Rally', '{n} liveries will crash Rally')}</h2>
        <div class="qd-sub">${trn(bad.length,
          'This .pak livery was built for another version of the game, and the game has updated since. Rally crashes while loading as long as it is enabled.',
          'These .pak liveries were built for another version of the game, and the game has updated since. Rally crashes while loading as long as they are enabled.')}</div>
      </header>
      <div class="imp-list">${bad.map(i => `<div class="imp-row">
        <div class="imp-thumb">${i.image ? imgTag(i.image, '') : '<img class="imp-logo" src="/img/logos/rally.png" alt="">'}</div>
        <div class="imp-info"><b>${esc(i.title)}</b><code>${esc(i.meta.files.join(', '))}</code></div>
      </div>`).join('')}</div>
      <footer class="qd-foot">
        <div class="qd-summary">${trn(bad.length,
          'Disabling is reversible: enable it again once the author releases an update.',
          'Disabling is reversible: enable them again once the author releases an update.')}</div>
        <button class="btn subtle small" data-close>${tr('Cancel')}</button>
        <button class="btn subtle small" data-v="play">${tr('Play anyway')}</button>
        <button class="btn primary small" data-v="fix">${tr('Disable and play')}</button>
      </footer>
    </div>`, 'modal imp-modal', () => { if (!answered) resolve(false); });
    el.addEventListener('click', async e => {
      const v = e.target.closest('[data-v]')?.dataset.v;
      if (!v) return;
      if (v === 'fix') {
        try {
          for (const i of bad) {
            await setEnabled(i, false);
            i.enabled = false;
            i.meta.files = i.meta.files.map(f => f.replace(/\.disabled$/i, '') + '.disabled');
          }
          toast(tr('Disabled {name}', { name: bad.map(i => i.title).join(', ') }));
          if (state.view === 'mods' && state.game === 'rally') render();
        } catch (err) {
          toast(tr('Could not disable the liveries: {error}', { error: err?.message || tr('file in use?') }), true);
          return;
        }
      }
      answered = true;
      close();
      resolve(true);
    });
  });
}

// ---------------------------------------------------------------------------
// Sidebar

function renderSidebar() {
  $('#game-list').innerHTML = GAMES.map(g => {
    const on = isInstalled(g);
    return `<button class="game-tile ${g.key === state.game ? 'active' : ''}" data-game="${g.key}">
      ${logoHTML(g)}
      <span class="status ${on ? 'on' : ''}" title="${on ? tr('Installed') : tr('Not installed')}"></span>
    </button>`;
  }).join('');
  updateNavQuickDrive();
}

$('#game-list').addEventListener('click', e => {
  const tile = e.target.closest('[data-game]');
  if (!tile) return;
  state.game = tile.dataset.game;
  state.search = '';
  state.settings.lastGame = state.game;
  saveSettings();
  renderSidebar();
  render();
});

// ---------------------------------------------------------------------------
// Games view

// Each game's background: the picture picked in Settings → Game backgrounds, else the bundled
// cover (img/covers/<key>.jpg). Picked pictures are copied to <app>/backgrounds, served at
// /m/backgrounds; settings.backgrounds[key] is the file name there. The cover stays as the layer
// under it, so a missing file shows the cover.
let bgDir = '';
async function backgroundsDir() {
  if (bgDir) return bgDir;
  let appDir = window.NL_PATH;
  try { appDir = await Neutralino.filesystem.getAbsolutePath(appDir); } catch { /* keep as is */ }
  const dir = join(appDir, 'backgrounds');
  try { await Neutralino.filesystem.createDirectory(dir); } catch { /* exists */ }
  if (await mountDir('/m/backgrounds', dir)) bgDir = dir;
  return dir;
}

function heroImage(g) {
  const own = state.settings.backgrounds?.[g.key];
  const url = own && bgDir ? fileUrl(join(bgDir, own)) : '';
  return `${url ? `url('${url}'), ` : ''}url('/img/covers/${g.key}.jpg')`;
}
// How much the background is darkened (0-80 %), so a bright picture keeps the text readable.
const heroDarken = g => (state.settings.bgDarken?.[g.key] || 0) / 100;

async function pickBackground(key) {
  let picked;
  try {
    picked = (await Neutralino.os.showOpenDialog('Choose a background', {
      filters: [{ name: 'Pictures', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
    }))?.[0];
  } catch (err) { log(`open dialog: ${err?.message || JSON.stringify(err)}`); }
  if (!picked) return;
  const dir = await backgroundsDir();
  const ext = (picked.match(/\.(jpe?g|png|webp)$/i)?.[1] || 'jpg').toLowerCase();
  // A new name each time, so the webview never shows the previous picture from its cache.
  const file = `${key}-${Date.now()}.${ext}`;
  try {
    await Neutralino.filesystem.copy(norm(picked), join(dir, file));
  } catch (err) {
    log(`background copy: ${err?.message || JSON.stringify(err)}`);
    return toast('Could not copy that picture', true);
  }
  await removeBackground(key);
  state.settings.backgrounds = { ...state.settings.backgrounds, [key]: file };
  saveSettings();
}

// Deletes the game's picked picture (the copy in <app>/backgrounds, never the original).
async function removeBackground(key) {
  const old = state.settings.backgrounds?.[key];
  if (!old) return;
  if (bgDir) await Neutralino.filesystem.remove(join(bgDir, old)).catch(() => {});
  const { [key]: _, ...rest } = state.settings.backgrounds;
  state.settings.backgrounds = rest;
  saveSettings();
}

function renderGames() {
  const g = gameByKey(state.game);
  const installed = isInstalled(g);
  main.innerHTML = `<div class="view games">
    <div class="hero-bg" style="background-image:${heroImage(g)}, url('${steamUrls.hero(g.appid)}'), linear-gradient(120deg,#2a2a2a,#111); --bg-darken:${heroDarken(g)}"></div>
    <div id="update-note"></div>
    <section class="hero">
      <div class="hero-top">
        <div class="hero-copy">
          ${logoHTML(g)}
          <h2>${esc(tr(g.headline))}</h2>
          <p class="blurb">${esc(tr(g.blurb))}</p>
          <div class="price" id="price"></div>
        </div>
        <div class="hero-actions">
          <div class="row">
            <button class="btn ghost" id="btn-trailer">${tr('Watch Trailer')}</button>
            ${installed
              ? `<button class="btn primary" id="btn-play" data-launch-game="${g.key}">▶&nbsp; ${tr('Play')}</button>`
              : `<button class="btn primary" id="btn-buy">${tr('Purchase')}</button>`}
          </div>
          ${installed ? '' : `<button class="link" id="btn-install">${tr('Already own it? Install via Steam')}</button>`}
        </div>
      </div>
      <div class="news-row" id="news-row">
        <div class="news-card skeleton"></div><div class="news-card skeleton"></div><div class="news-card skeleton"></div>
      </div>
    </section>
  </div>`;

  $('#btn-trailer').onclick = () => openTrailer(g);
  syncRunning();
  if (installed) $('#btn-play').onclick = () => launchGame(g);
  else {
    $('#btn-buy').onclick = () => openExternal(steamUrls.store(g.appid));
    $('#btn-install').onclick = () => openExternal(steamUrls.install(g.appid));
    getStoreDetails(g.appid).then(d => { if (d?.price && state.game === g.key) $('#price') && ($('#price').textContent = tr('Steam price: {price}', { price: d.price })); });
  }
  loadNewsRow(g);
  if (installed) showUpdateNote(g);
}

// News art: the post's own image, else the game's Steam header (then hero) art.
function newsBg(n, g) {
  const layers = n.image ? [n.image] : [steamUrls.header(g.appid), steamUrls.hero(g.appid)];
  return layers.map(u => `url('${esc(u)}')`).join(', ');
}

// News: the cached posts show at once; each game is checked for newer ones once
// per launch, in the background (refreshNews: a tiny request unless something is new).
const newsChecks = {};
function checkNews(appid) {
  return newsChecks[appid] ||= refreshNews(appid).catch(err => { log(`news: ${err?.message}`); return null; });
}
async function loadNewsRow(g) {
  const cached = await cachedNews(g.appid);
  if (cached) drawNewsRow(g, cached);
  const fresh = await checkNews(g.appid);
  if (fresh || !cached) drawNewsRow(g, fresh || cached || await getNews(g.appid));
}
function drawNewsRow(g, items) {
  state.news[g.appid] = items;
  const row = $('#news-row');
  if (!row || state.game !== g.key || state.view !== 'games') return;
  if (!items.length) {
    row.innerHTML = `<div class="news-card" style="grid-column:1/-1;height:120px;justify-content:center"><h3>${tr('News unavailable')}</h3><span class="when">${tr('Could not reach Steam. Check your connection.')}</span></div>`;
    return;
  }
  row.innerHTML = items.slice(0, 3).map((n, i) => `
    <button class="news-card" data-news="${i}" style="background-image:${newsBg(n, g)}">
      <span class="kicker">${esc(n.label === 'Community Announcements' ? tr('News') : n.label)}</span>
      <h3>${esc(n.title)}</h3>
      <span class="when">${timeAgo(n.date)}</span>
    </button>`).join('');
  row.onclick = e => {
    const c = e.target.closest('[data-news]');
    if (c) newsPageUrl(g.appid, items[+c.dataset.news]).then(openExternal);
  };
}

async function openTrailer(g) {
  const { el } = modal(`<video controls autoplay playsinline></video>`, 'trailer');
  const video = el.querySelector('video');
  const details = await getStoreDetails(g.appid);
  const movie = details?.movies?.find(m => m.highlight) || details?.movies?.[0];
  if (!movie) { toast(tr('No trailer available — opening the Steam store page.')); openExternal(steamUrls.storeWeb(g.appid)); $('#modal-root [data-close]')?.click(); return; }
  video.poster = movie.thumb || '';
  if (movie.mp4) { video.src = movie.mp4; return; }
  if (window.Hls?.isSupported()) {
    const hls = new Hls({ capLevelToPlayerSize: true });
    hls.loadSource(movie.hls);
    hls.attachMedia(video);
    $('#modal-root').__hls = hls;
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = movie.hls;
  } else {
    openExternal(steamUrls.storeWeb(g.appid));
  }
}

// ---------------------------------------------------------------------------
// Mods view

function currentTab(g) {
  return state.tab[g.key] || g.tabs[0].id;
}

async function getItems(g, tab, force = false, onProgress) {
  const key = `${g.key}:${tab}`;
  if (!force && state.cache[key]) return state.cache[key];
  const items = await SCANNERS[g.key][tab](state.paths, onProgress);
  if (g.key === 'rally' && (tab === 'cars' || tab === 'tracks')) await decorateRally(items, tab);
  if (tab === 'setups') await decorateSetups(g, items);
  state.cache[key] = items;
  return items;
}

// Setups cards (games.js lists a card per car): the car's name and picture as the
// game's other pages show them, the setups' track names, newest car first.
async function decorateSetups(g, items) {
  const cars = g.key === 'ac' && items.length ? await getItems(g, 'cars').catch(() => []) : [];
  const tracks = g.key === 'ac' && items.length ? await getItems(g, 'tracks').catch(() => []) : [];
  for (const i of items) {
    if (g.key === 'ac') {
      const c = cars.find(x => x.id.toLowerCase() === i.carId.toLowerCase());
      if (c) Object.assign(i, { title: c.title, image: c.image, fallbackImage: c.fallbackImage, badge: c.badge, brand: c.brand });
    } else if (g.key === 'acc') {
      const model = ACC_SETUP_CARS[i.carId.toLowerCase()];
      if (model != null) Object.assign(i, { title: ACC_CARS[model] || i.title, image: siteImage('acc', 'cars', String(model)) });
    } else if (g.key === 'rally') {
      const id = Object.keys(RALLY_CARS).find(k => k.toLowerCase() === i.carId.toLowerCase()) || i.carId;
      Object.assign(i, { title: rallyCarName(id), image: rallyCarImage(id) });
    }
    for (const s of i.setups) s.trackName = g.key === 'rally' ? rallyGroupName(s.track) || rallyStage(`${s.track}FullForward`).stage || s.track : setupTrackName(s, tracks);
    const where = [...new Set(i.setups.map(s => s.trackName).filter(Boolean))];
    i.subtitle = [trn(i.setups.length, '1 setup', '{n} setups'), where.length === 1 ? where[0] : where.length ? trn(where.length, '1 track', '{n} tracks') : ''].filter(Boolean).join(' · ');
    // The setups' names on the card, newest first.
    const names = i.setups.map(s => s.name);
    i.author = names.length > 3 ? `${names.slice(0, 3).join(', ')} ${tr('+{n} more', { n: names.length - 3 })}` : names.join(', ');
  }
  items.sort((a, b) => b.date - a.date);
}

// Rally's cars and stages (games.js lists them) get their pictures, flags and the
// game's own texts (rallydata.js) here, where the site pictures and flags live.
async function decorateRally(items, tab) {
  if (tab === 'cars') {
    // Brand logos (the card's badge) come later, from renderMods.
    const liveries = await getItems(gameByKey('rally'), 'liveries').catch(() => []);
    for (const i of items) {
      if (i.isMod) continue;
      i.image = rallyCarImage(i.carId);
      const text = rallyCarText(i.carId);
      i.description = text.description;
      i.rally = {
        livery: text.livery,
        liveries: liveries.filter(l => (l.meta?.car || l.carId) === i.carId).length,
      };
    }
  } else {
    for (const i of items) {
      if (i.isMod) continue;
      i.image = siteImage('rally', 'stages', i.rallyGroup) || i.image;
      i.flag = flagUrl(i.locationName === 'Wales' ? 'Wales' : i.country);
      i.subtitle = [i.locationName, countryName(i.country)].filter((x, n, a) => x && a.indexOf(x) === n).join(' · ');
      i.description = rallyGroupText(i.rallyGroup);
      // The stage map (where the site has one) over the picture, like EVO's circuit outlines.
      const map = siteImage('rally', 'maps', i.rallyGroup);
      if (map) i.overlay = map;
      // Each stage: the game's map of it (the part driven in red), else the site's outline.
      for (const l of i.layouts) {
        const m = rallyStageMedia(l.id);
        l.preview = m.map || map || i.image;
        l.outline = m.mapRemote || i.image;
      }
    }
  }
}

function emptyState(g, tab) {
  const folder = contentFolder(g.key, tab, state.paths);
  const installed = isInstalled(g);
  const btnInstall = `<button class="btn primary small" data-act="install">${tr('Install via Steam')}</button>`;
  const code = s => `<code>${esc(s)}</code>`;
  if (tab === 'setups') {
    const where = g.key === 'rally' ? tr("Rally's Personal setups (Car Setup › Save/Load Setup)") : code(folder);
    return `<h3>${tr('No setups yet')}</h3>${tr('Setups you save in the game show up here, one card per car, from {where}.', { where })}
      <br>${tr('Compare them, back them up, and share them: Export makes a file a friend can import.')}
      <br><button class="btn primary small" data-act="import-setup">＋ ${tr('Import setup')}</button>`;
  }
  switch (g.key) {
    case 'ac':
      if (!installed) return `<h3>${tr('Assetto Corsa not found')}</h3>${tr('Install it through Steam, or set its folder in Settings.')}<br>${btnInstall}`;
      return `<h3>${tr('No mods in {tab} yet', { tab: tr(g.tabs.find(x => x.id === tab)?.label || tab) })}</h3>${tr('Drop mod folders into {folder}. Each mod shows its preview image here automatically.', { folder: code(folder) })}`;
    case 'acc':
      return `<h3>${tr('No custom liveries found')}</h3>${tr('ACC reads liveries from {folder}. Each livery is a folder with {files} plus a car file in {cars}.', { folder: code(folder), files: `${code('decals.png')} / ${code('sponsors.png')}`, cars: code('Customs/Cars') })}`;
    case 'evo':
      if (tab === 'liveries') return `<h3>${tr('No external liveries yet')}</h3>${tr('EVO loads custom liveries from {folder}, together with their car in your garage ({garage}).', { folder: code(folder), garage: code('ProfileData\\…\\SavedCars') })}<br>${tr("Drop a livery's .zip (for example from LiveryLab Evo) on this window to install both.")}`;
      return `<h3>${tr('No EVO mods installed')}</h3>${tr('EVO loads community mods ({ext}) from {folder}.', { ext: code('.kspkg'), folder: code(folder) })}<br>${tr('Put an image with the same name next to a mod (e.g. {example}) to give it a preview here.', { example: code('my_car.png') })}
        <br><button class="btn primary small" data-act="mkdir">${tr('Create & open mods folder')}</button>`;
    case 'rally':
      if (!installed && !state.settings.overrides.rally_install) return `<h3>${tr('Assetto Corsa Rally not installed')}</h3>${tr('Rally liveries live inside the game folder ({folder}), so install the game first.', { folder: code('acr\\Content\\Paks') })}<br>${btnInstall}`;
      if (tab === 'cars' || tab === 'tracks') return `<h3>${tr(tab === 'cars' ? 'No car mods yet' : 'No stage mods yet')}</h3>${tr('Rally loads mods as {pak} packages from {folder}. One that adds a car or a stage shows up here; switch to All content to see the game\'s own.', { pak: `${code('.pak')} + ${code('.utoc')} + ${code('.ucas')}`, folder: code('acr\\Content\\Paks\\~mods') })}`;
      return `<h3>${tr('No custom liveries yet')}</h3>${tr('Custom liveries are folders with {files} in {folder}.', { files: `${code('livery.json')}, ${code('icon.png')}, ${code('body_livery_*.dds')}`, folder: code(`${folder}\\<Car>`) })}
        ${tr('Older {pak} liveries go in {folder}.', { pak: `${code('.pak')} + ${code('.utoc')} + ${code('.ucas')}`, folder: code('acr\\Content\\Paks') })}<br>${tr("Drop a livery's .zip, .rar or .7z on this window to install it.")}`;
  }
  return '';
}

function cardHTML(item, idx) {
  const content = item.kind === 'car' || item.kind === 'track';
  const flag = !item.enabled ? `<span class="flag off">${tr('Disabled')}</span>`
    : item.incompatible ? `<span class="flag">${tr('Crashes game')}</span>`
    : item.update ? `<span class="flag update">${tr('Update')} v${esc(item.update.version)}</span>`
    : item.game === 'ac' && content && !item.isMod ? '<span class="flag kunos">Kunos</span>'
    : (item.game === 'ac' || item.game === 'evo' || item.game === 'rally') && content && item.isMod ? `<span class="flag">${tr('Mod')}</span>` : '';
  // Official content added by the game's latest update (markFresh, games.js).
  const fresh = item.isNew ? `<span class="flag tag-new${item.flag || (item.badge && item.image) ? ' after-icon' : ''}">${tr('New')}</span>` : '';
  const num = item.kind === 'replay' ? '' : item.number != null ? `<div class="placeholder">#${esc(item.number)}</div>` : `<div class="placeholder">${initials(item.title)}</div>`;
  return `<button class="card ${item.enabled ? '' : 'disabled'}" data-idx="${idx}">
    <div class="thumb ${item.kind === 'replay' ? 'icon' : ''}">
      ${num}
      ${imgTag(item.image, item.fallbackImage)}
      ${item.overlay ? `<img class="overlay${item.game === 'rally' ? ' white' : ''}" src="${esc(item.overlay)}" loading="lazy" data-err="remove" alt="">` : ''}
      ${item.badge && item.image ? `<img class="badge" src="${esc(item.badge)}" loading="lazy" data-err="remove" alt="">` : ''}
      ${item.flag ? `<img class="flag-badge" src="${esc(item.flag)}" alt="">` : ''}
      ${fresh}${flag}
    </div>
    <div class="card-body">
      <div class="card-title">${esc(item.title)}</div>
      <div class="card-sub">${esc(item.subtitle || ' ')}</div>
      ${item.author ? `<div class="card-author">${esc(item.author)}${item.version ? ` · v${esc(item.version)}` : ''}</div>` : ''}
    </div>
  </button>`;
}

function filterItems(g, items) {
  let out = items;
  if (hasOfficialContent(g) && state.settings.acFilter === 'mods') out = out.filter(i => i.isMod);
  const q = state.search.trim().toLowerCase();
  if (q) out = out.filter(i => [i.title, i.subtitle, i.author, i.id, ...(i.tags || [])].join(' ').toLowerCase().includes(q));
  return out;
}

async function renderMods(force = false) {
  const g = gameByKey(state.game);
  const tab = currentTab(g);
  const folder = contentFolder(g.key, tab, state.paths);
  main.innerHTML = `<div class="view scaled mods">
    <div class="mods-head">
      ${logoHTML(g)}
      <div class="tabs">${g.tabs.map(t => `<button data-tab="${t.id}" class="${t.id === tab ? 'active' : ''}">${tr(t.label)}</button>`).join('')}</div>
      <div class="toolbar">
        <input class="search" id="search" placeholder="${esc(tr('Search…'))}" value="${esc(state.search)}">
        ${hasOfficialContent(g) ? `<div class="seg" id="ac-filter">
          <button data-f="mods" class="${state.settings.acFilter === 'mods' ? 'active' : ''}">${tr('Mods')}</button>
          <button data-f="all" class="${state.settings.acFilter === 'all' ? 'active' : ''}">${tr('All content')}</button></div>` : ''}
        ${tab === 'setups' ? '' : `<button class="btn small subtle" id="btn-health" title="${esc(tr('Look for broken, incomplete or conflicting mods'))}">${tr('Check mods')}</button>`}
        <button class="btn small subtle" id="btn-refresh" title="${esc(tr('Rescan folders'))}">↻ ${tr('Rescan')}</button>
        <button class="btn small subtle" id="btn-folder" ${folder ? '' : 'disabled'}>${tr('Open folder')}</button>
        ${tab === 'setups'
          ? `<button class="btn small subtle" id="btn-import-setup" title="${esc(tr('Add a setup file a friend shared (AC .ini, ACC .json, or a Rally setup exported by the launcher)'))}">＋ ${tr('Import setup')}</button>`
          : `<button class="btn small subtle" id="btn-install" title="${esc(tr('Install a mod from a .zip, .rar, .7z, .kspkg or .pak (or drop it on the window)'))}">＋ ${tr('Install mod')}</button>`}
        <button class="btn small primary" id="btn-play-mods" data-launch-game="${g.key}" ${isInstalled(g) ? '' : 'disabled'}>▶ ${tr('Play')}</button>
      </div>
    </div>
    <div class="mods-meta"><span id="count"></span><span class="path">${esc(folder)}</span></div>
    <div id="update-note"></div>
    <div id="grid-wrap"><div class="loading">${tr('Scanning…')}</div></div>
  </div>`;

  $('.tabs').onclick = e => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    state.tab[g.key] = b.dataset.tab;
    state.search = '';
    renderMods();
  };
  $('#btn-refresh').onclick = () => renderMods(true);
  if ($('#btn-health')) $('#btn-health').onclick = () => openHealthCheck(g);
  $('#btn-folder').onclick = () => openFolder(folder);
  if ($('#btn-install')) $('#btn-install').onclick = pickModFiles;
  if ($('#btn-import-setup')) $('#btn-import-setup').onclick = () => importSetupFlow();
  $('#btn-play-mods').onclick = () => launchGame(g);
  syncRunning();
  $('#ac-filter')?.addEventListener('click', e => {
    const b = e.target.closest('[data-f]');
    if (!b) return;
    state.settings.acFilter = b.dataset.f;
    saveSettings();
    renderMods();
  });

  let items;
  // First EVO scan extracts official car/track images from the game package; show progress.
  const progress = (done, total, label) => {
    const el = $('#grid-wrap .loading');
    if (el) el.textContent = total ? `${label} ${done}/${total}` : label;
  };
  try { items = await getItems(g, tab, force, progress); }
  catch (e) { log(`scan failed ${g.key}:${tab} ${e?.stack || JSON.stringify(e)}`); items = []; }
  if (state.view !== 'mods' || state.game !== g.key || currentTab(g) !== tab) return;
  showUpdateNote(g);
  // AC mods with a newer version in Content Manager's registry get an "Update" flag.
  if (g.key === 'ac' && (tab === 'cars' || tab === 'tracks')) {
    acUpdates(items).then(n => { if (n && state.view === 'mods' && state.game === g.key && currentTab(g) === tab) drawGrid(); }).catch(err => log(`updates: ${err?.message}`));
  }

  // Car pages get a brand rail, like Quick Drive's: AC uses each brand's car
  // badge, EVO its brand logos (cached by Quick Drive's extras; loaded in the background).
  const logos = new Map();
  if (tab === 'cars' && g.key === 'ac') for (const i of items) if (i.brand && i.badge && !logos.has(i.brand)) logos.set(i.brand, i.badge);
  // Rally cars: the brand logos Quick Drive uses (EVO's, AC's badges, the launcher's own).
  if (tab === 'cars' && g.key === 'rally') {
    loadBrandLogos(new Map()).then(m => {
      for (const i of items) {
        const logo = i.brand && m.get(brandKey(i.brand));
        if (!logo) continue;
        logos.set(i.brand, logo);
        i.badge ||= logo;
      }
      if (state.view === 'mods' && state.game === g.key && currentTab(g) === tab) drawGrid();
    });
  }
  if (tab === 'cars' && g.key === 'evo' && state.paths.evo.install) {
    const brands = [...new Set(items.map(i => i.brand).filter(Boolean))];
    evoCacheDir().then(dir => readEvoExtras({ brands, contentPkg: `${state.paths.evo.install}/content.kspkg` }, dir)).then(x => {
      for (const b of brands) { const f = x.brands[x.brandSlug(b)]; if (f) logos.set(b, fileUrl(f)); }
      // EVO cars have no badge of their own: their brand's logo stands in (card corner, detail page).
      for (const i of items) if (i.brand && logos.has(i.brand)) i.badge ||= logos.get(i.brand);
      if (state.view === 'mods' && state.game === g.key && currentTab(g) === tab) drawGrid();
    }).catch(err => log(`brand logos: ${err?.message || err}`));
  }
  const brandRail = list => {
    const names = [...new Set(list.map(i => i.brand).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    if (tab !== 'cars' || names.length < 2) return '';
    const on = state.brand[g.key] || '';
    return `<nav class="qd-brands mods-brands" id="mods-brands"><button class="qd-brand all ${on ? '' : 'active'}" data-brand="" title="${esc(tr('All brands'))}">${tr('All')}</button>${names.map(n => {
      const logo = logos.get(n);
      return `<button class="qd-brand ${n === on ? 'active' : ''}" data-brand="${esc(n)}" title="${esc(n)}">${logo
        ? `<img src="${esc(logo)}" alt="" data-err="initials" data-initials="${initials(n)}">`
        : `<span>${initials(n)}</span>`}</button>`;
    }).join('')}</nav>`;
  };

  const drawGrid = () => {
    const base = filterItems(g, items);
    const rail = brandRail(base);
    // A brand that is no longer listed (search, Mods filter) falls back to All.
    if (!rail || !base.some(i => i.brand === state.brand[g.key])) state.brand[g.key] = '';
    const list = state.brand[g.key] ? base.filter(i => i.brand === state.brand[g.key]) : base;
    $('.view.mods')?.classList.toggle('fill', !!rail);
    const media = tab === 'screens' || tab === 'replays';
    const total = media ? tr('{n} total', { n: items.length })
      : tab === 'setups' ? `${trn(items.length, '1 car', '{n} cars')} · ${trn(items.reduce((n, i) => n + i.setups.length, 0), '1 setup', '{n} setups')}`
      : hasOfficialContent(g) ? tr('{mods} mods · {n} total', { mods: items.filter(i => i.isMod).length, n: items.length })
      : tr('{n} installed', { n: items.length });
    $('#count').textContent = `${tr('{n} shown', { n: list.length })} · ${total}`;
    const wrap = $('#grid-wrap');
    if (!items.length || (!list.length && !state.search && hasOfficialContent(g) && state.settings.acFilter === 'mods')) {
      wrap.innerHTML = `<div class="empty">${emptyState(g, tab)}</div>`;
    } else if (!list.length) {
      wrap.innerHTML = `<div class="empty"><h3>${tr('No matches')}</h3>${esc(tr('Nothing matches “{search}”.', { search: state.search }))}</div>`;
    } else {
      // Rally liveries are square in the game (texture and icon), so their cards are too.
      const grid = `<div class="grid ${g.key === 'rally' && tab === 'liveries' ? 'square' : ''}">${list.map(i => cardHTML(i, items.indexOf(i))).join('')}</div>`;
      // Redrawing keeps the rail where it was scrolled to (the picked brand stays in view).
      const railY = $('#mods-brands')?.scrollTop || 0;
      wrap.innerHTML = rail ? `<div class="mods-cars">${brandRail(base)}${grid}</div>` : grid;
      if (rail) $('#mods-brands').scrollTop = railY;
    }
  };
  drawGrid();

  $('#search').oninput = e => { state.search = e.target.value; drawGrid(); };
  $('#grid-wrap').onclick = async e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'install') return openExternal(steamUrls.install(g.appid));
    if (act === 'import-setup') return importSetupFlow();
    if (act === 'mkdir') {
      try { await Neutralino.filesystem.createDirectory(folder); } catch { /* exists */ }
      return openFolder(folder);
    }
    const brand = e.target.closest('[data-brand]');
    if (brand) { state.brand[g.key] = brand.dataset.brand; drawGrid(); return; }
    const card = e.target.closest('[data-idx]');
    if (!card) return;
    const item = items[+card.dataset.idx];
    if (item.kind === 'setups') openSetups(g, item);
    else openDetail(g, item, () => drawGrid());
  };
}

// ---------------------------------------------------------------------------
// Setups (the Mods page's Setups tab): a window per car. Its setups on the left;
// on the right the one picked, a tab per group of the game's setup menu with the
// values at their wheel or axle on a drawing of the car, or two compared.

// A noted time's track: Rally's stage and its length; AC's "<track>-<layout>" as its Tracks page names it.
function runTrack(game, track, tracks) {
  if (game === 'rally') { const st = rallyStage(track); return { name: st.name || st.stage || track, sub: tr(st.length || '') }; }
  const t = tracks.find(x => x.id === track) || tracks.find(x => track.startsWith(`${x.id}-`));
  if (!t) return { name: prettifyId(track), sub: '' };
  const layout = t.id === track ? '' : track.slice(t.id.length + 1);
  const l = layout && t.layouts?.find(x => x.id === layout);
  return { name: t.title, sub: l?.name && l.name !== t.title ? l.name : '' };
}
const rallyBusy = game => game === 'rally' && isUp('rally');
const RALLY_OPEN = () => tr("Close Rally first: the launcher doesn't change Rally's setups while it's running.");

const SX_ICONS = {
  import: '<path d="M8 2.5v7.5m0 0L5 7m3 3 3-3M3 11.5v2h10v-2"/>',
  folder: '<path d="M2 4.5v7.75c0 .41.34.75.75.75h10.5c.41 0 .75-.34.75-.75V6.25a.75.75 0 0 0-.75-.75H8L6.5 3.75H2.75a.75.75 0 0 0-.75.75z"/>',
  export: '<path d="M8 10V2.5m0 0L5 5.5m3-3 3 3M3 11.5v2h10v-2"/>',
  duplicate: '<rect x="5.25" y="5.25" width="8.25" height="8.25" rx="1.5"/><path d="M10.75 5.25v-1.5c0-.83-.67-1.5-1.5-1.5h-5.5c-.83 0-1.5.67-1.5 1.5v5.5c0 .83.67 1.5 1.5 1.5h1.5"/>',
  rename: '<path d="M10.25 3.25l2.5 2.5L6 12.5H3.5V10z"/>',
  delete: '<path d="M2.75 4.25h10.5M6.25 4.25v-1.5h3.5v1.5M4.25 4.25l.6 9h6.3l.6-9"/>',
  compare: '<path d="M2.5 5.25h9.5m0 0L9.5 2.75M12 5.25 9.5 7.75M13.5 10.75H4m0 0 2.5-2.5M4 10.75l2.5 2.5"/>',
  pin: '<path d="M8 14s4.25-3.9 4.25-7.25a4.25 4.25 0 0 0-8.5 0C3.75 10.1 8 14 8 14z"/><circle cx="8" cy="6.75" r="1.5"/>',
  clock: '<circle cx="8" cy="8" r="5.75"/><path d="M8 5v3l2 1.25"/>',
  user: '<circle cx="8" cy="5.5" r="2.75"/><path d="M2.75 13.5c.6-2.4 2.7-3.75 5.25-3.75s4.65 1.35 5.25 3.75"/>',
  info: '<circle cx="8" cy="8" r="6"/><path d="M8 7.25v4"/><path d="M8 4.75v.01" stroke-width="2"/>',
  trophy: '<path d="M5 2.75h6v3.5a3 3 0 0 1-6 0zM5 4H2.75c0 1.75 1 2.75 2.4 2.9M11 4h2.25c0 1.75-1 2.75-2.4 2.9M8 9.25v2.5M5.5 13.25h5"/>',
  done: '<path d="M3.5 3.5l9 9M12.5 3.5l-9 9"/>',
};
const sxIcon = k => `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SX_ICONS[k]}</svg>`;
const SX_TAB = {}; // the group last looked at, per game

// The times noted with a setup (gameClosed), per track or stage: [{ track, best, n, last }], newest first.
function setupTimes(runs) {
  const by = new Map();
  for (const r of runs) by.set(r.track, [...(by.get(r.track) || []), r]);
  return [...by].map(([track, list]) => ({ track, best: Math.min(...list.map(r => r.ms)), n: list.length, last: Math.max(...list.map(r => r.at)) })).sort((a, b) => b.last - a.last);
}

// One group of a setup on a grid of four columns: a card per wheel (front left,
// front right, rear left, rear right), under them a card per axle (front under the
// two fronts, rear under the two rears), then the other values as tiles.
function setupGroupHTML(s, grp) {
  const card = (list, p, cls) => {
    const rows = list.filter(r => r.cells[p]).map(r => `<div><dt>${esc(r.label)}</dt><dd>${esc(r.cells[p])}</dd></div>`).join('');
    return rows ? `<div class="sx-card ${cls}"><h5>${esc(positionLabel(s.game, p))}</h5><dl>${rows}</dl></div>` : '';
  };
  const tiles = grp.singles.map(t => `<div class="sx-tile${String(t.value).length > 22 ? ' wide' : ''}">
      <small>${esc(t.label)}</small><b>${esc(t.value)}</b>${t.note ? `<i>${esc(t.note)}</i>` : ''}</div>`).join('');
  return `<div class="sx-grid">${['FL', 'FR', 'RL', 'RR'].map(p => card(grp.corners, p, 'wheel')).join('')}
    ${['F', 'R', 'C'].map(p => card(grp.axles, p, `axle axle-${p}`)).join('')}${tiles}</div>`;
}

function openSetups(g, item) {
  let current = 0, cmp = null, diffOnly = true, renaming = false, runs = null, tracks = [];
  const view = () => el.querySelector('#setups-view');
  const { el, close } = modal(`
    <header class="qd-head sx-head">
      ${item.image || item.fallbackImage ? `<div class="sx-head-img">${imgTag(item.image, item.fallbackImage)}</div>` : ''}
      <div class="sx-head-text">
        <small class="sx-kicker">${esc(`${g.title} ${g.sub || ''}`.trim())} · ${tr('Setups')}</small>
        <h2>${esc(item.title)}</h2>
        <div class="sx-head-sub" id="setups-sub"></div>
      </div>
      <div class="sx-head-actions">
        <button class="btn small subtle" data-s="import">${sxIcon('import')}${tr('Import setup')}</button>
        <button class="btn small subtle" data-s="folder">${sxIcon('folder')}${tr('Open folder')}</button>
      </div>
    </header>
    <div class="sx-body">
      <aside class="sx-list" id="setups-list"></aside>
      <div class="sx-view" id="setups-view"></div>
    </div>`, 'modal setups-modal');

  const timesOf = s => (runs ? setupTimes(runsOf(s, runs)) : []);
  const ago = s => (s.date ? timeAgo(s.date / 1000) : '');

  const listHTML = () => `<div class="sx-list-title">${tr('Your setups')} <small>${item.setups.length}</small></div>` + item.setups.map((s, i) => {
    const ab = cmp ? (cmp[0] === i ? 'a' : cmp[1] === i ? 'b' : '') : '';
    const n = timesOf(s).length;
    return `<button class="sx-item${!cmp && i === current ? ' active' : ''}${ab ? ` in-${ab}` : ''}" data-open="${i}">
      ${ab ? `<i class="sx-ab ${ab}">${ab.toUpperCase()}</i>` : ''}
      <span class="sx-item-name">${esc(s.name)}</span>
      <span class="sx-item-meta">${esc([s.trackName, ago(s)].filter(Boolean).join(' · '))}</span>
      ${n ? `<span class="sx-item-times">${sxIcon('trophy')}${esc(s.game === 'rally' ? trn(n, '1 stage time', '{n} stage times') : trn(n, '1 track time', '{n} track times'))}</span>` : ''}
    </button>`;
  }).join('');

  const timesHTML = s => {
    if (!runs || s.game === 'acc') return '';
    const list = timesOf(s);
    if (!list.length) {
      return `<p class="sx-hint">${sxIcon('trophy')}<span>${s.game === 'ac'
        ? tr('No times with it yet: drive with it, and when AC closes the launcher notes your best lap here.')
        : tr("No times with it yet: pick it in Quick Drive's session settings (Car Setup), and the stage bests you set with it are noted here.")}</span></p>`;
    }
    return `<section class="sx-times"><h4>${sxIcon('trophy')}${tr('Your times with this setup')}</h4><div class="sx-time-grid">${list.map(r => {
      const t = runTrack(s.game, r.track, tracks);
      const n = s.game === 'rally' ? trn(r.n, '1 stage best', '{n} stage bests') : trn(r.n, '1 session', '{n} sessions');
      return `<div class="sx-time"><div><b>${esc(t.name)}</b><small>${esc([t.sub, n, timeAgo(r.last / 1000)].filter(Boolean).join(' · '))}</small></div><span>${esc(lapTime(r.best))}</span></div>`;
    }).join('')}</div></section>`;
  };

  const singleHTML = s => {
    const groups = setupGroups(s);
    const tab = groups.find(x => x.id === SX_TAB[g.key]) || groups[0];
    const facts = [
      s.trackName && `<span>${sxIcon('pin')}${esc(s.trackName)}</span>`,
      s.date && `<span title="${esc(new Date(s.date).toLocaleString())}">${sxIcon('clock')}${esc(tr('Saved {when}', { when: ago(s) }))}</span>`,
      s.author && `<span>${sxIcon('user')}${esc(s.author)}</span>`,
      s.version && `<span>${esc(tr('Rally {version}', { version: s.version }))}</span>`,
    ].filter(Boolean).join('');
    const others = item.setups.map((x, i) => [x, i]).filter(([, i]) => i !== current);
    return `<div class="sx-top">
        <div class="sx-name">
          ${renaming
            ? `<div class="sx-rename"><input id="setup-rename" value="${esc(s.name)}" maxlength="60" aria-label="${esc(tr('New name'))}">
                <button class="btn small primary" data-s="rename-save">${tr('Save')}</button><button class="btn small subtle" data-s="rename-cancel">${tr('Cancel')}</button></div>`
            : `<h3>${esc(s.name)}</h3>`}
          <div class="sx-facts">${facts}</div>
        </div>
        <div class="sx-tools">
          ${others.length ? `<div class="sx-pick"><button class="sx-tool" data-s="compare-menu">${sxIcon('compare')}<span>${tr('Compare')}</span></button>
            <div class="sx-menu" hidden><small>${tr('Compare {name} with', { name: s.name })}</small>${others.map(([x, i]) => `<button data-cmp="${i}"><b>${esc(x.name)}</b><small>${esc([x.trackName, ago(x)].filter(Boolean).join(' · '))}</small></button>`).join('')}</div></div>` : ''}
          <button class="sx-tool" data-s="export">${sxIcon('export')}<span>${tr('Export')}</span></button>
          <button class="sx-tool" data-s="duplicate">${sxIcon('duplicate')}<span>${tr('Duplicate')}</span></button>
          <button class="sx-tool" data-s="rename">${sxIcon('rename')}<span>${tr('Rename')}</span></button>
          <button class="sx-tool danger" data-s="delete">${sxIcon('delete')}<span>${tr('Delete')}</span></button>
        </div>
      </div>
      ${s.game === 'rally' ? `<p class="sx-hint">${sxIcon('info')}<span>${tr('To drive with it, load it in Rally: Car Setup › Save/Load Setup › Personal.')}</span></p>` : ''}
      ${timesHTML(s)}
      ${groups.length > 1 ? `<nav class="sx-tabs">${groups.map(x => `<button data-tab="${esc(x.id)}" class="${x === tab ? 'active' : ''}">${esc(x.title)}</button>`).join('')}</nav>` : ''}
      <div class="sx-panel${groups.length > 1 ? '' : ' alone'}">${tab ? setupGroupHTML(s, tab) : `<p class="sx-hint">${sxIcon('info')}<span>${tr('This setup has no values.')}</span></p>`}</div>`;
  };

  // Two setups side by side, group by group: the values that differ highlighted,
  // with how much B changes them (B − A).
  const compareHTML = () => {
    const [a, b] = cmp.map(i => item.setups[i]);
    const groups = compareGroups(a, b);
    const diffs = groups.reduce((n, x) => n + x.rows.filter(r => !r.same).length, 0);
    const short = { F: tr('F'), C: tr('C'), R: tr('R') };
    const mini = (r, text, cls) => r.shape === 'one' ? `<span class="${cls('')}">${esc(text(''))}</span>`
      : `<div class="sx-mini ${r.shape}">${r.positions.map(p => `<span class="${cls(p)}" title="${esc(positionLabel(a.game, p))}">${r.shape === 'axles' ? `<i>${esc(short[p])}</i>` : ''}${esc(text(p))}</span>`).join('')}</div>`;
    const value = side => r => mini(r, p => r[side][p] || '—', p => (r.diff[p] ? 'd' : ''));
    const change = r => (r.same ? '' : mini(r, p => (r.diff[p] ? r.delta[p] || tr('changed') : '·'), p => (r.diff[p] ? 'd' : '')));
    const pick = (side, i) => `<select data-s="cmp-${side}" aria-label="${esc(side === 'a' ? tr('Setup A') : tr('Setup B'))}">${item.setups.map((x, j) => `<option value="${j}"${j === i ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select>`;
    const body = groups.map(x => {
      const rows = x.rows.filter(r => !diffOnly || !r.same);
      if (!rows.length) return '';
      const n = x.rows.filter(r => !r.same).length;
      return `<section class="sx-cmp-group"><h4>${esc(x.title)}${n ? `<small>${esc(trn(n, '1 difference', '{n} differences'))}</small>` : ''}</h4>
        ${rows.map(r => `<div class="sx-cmp-row${r.same ? '' : ' diff'}"><span class="sx-cmp-label">${esc(r.label)}${r.note ? `<small>${esc(r.note)}</small>` : ''}</span>
          <div>${value('a')(r)}</div><div>${value('b')(r)}</div><div class="sx-delta">${change(r)}</div></div>`).join('')}</section>`;
    }).join('');
    return `<div class="sx-top">
        <div class="sx-cmp-pick"><i class="sx-ab a">A</i>${pick('a', cmp[0])}<span class="sx-vs">${tr('vs')}</span><i class="sx-ab b">B</i>${pick('b', cmp[1])}</div>
        <div class="sx-tools">
          <div class="qd-seg sx-seg"><button data-diff="1" class="${diffOnly ? 'active' : ''}">${tr('Differences')}</button><button data-diff="0" class="${diffOnly ? '' : 'active'}">${tr('All values')}</button></div>
          <button class="sx-tool" data-s="cmp-done">${sxIcon('done')}<span>${tr('Done')}</span></button>
        </div>
      </div>
      <p class="sx-cmp-sum"><b>${esc(diffs ? trn(diffs, '1 setting differs', '{n} settings differ') : tr('These two setups are the same.'))}</b>
        ${groups.some(x => x.rows.some(r => r.shape === 'corners')) ? `<span class="sx-legend-note"><span class="sx-legend"><b>FL</b><b>FR</b><b>RL</b><b>RR</b></span>${tr('Values per wheel are laid out like this')}</span>` : ''}</p>
      ${body ? `<div class="sx-cmp"><div class="sx-cmp-head"><span>${tr('Setting')}</span><span><i class="sx-ab a">A</i>${esc(a.name)}</span><span><i class="sx-ab b">B</i>${esc(b.name)}</span><span>${tr('Change')}</span></div>${body}</div>` : ''}`;
  };

  const draw = () => {
    el.querySelector('#setups-sub').textContent = item.subtitle;
    el.querySelector('#setups-list').innerHTML = listHTML();
    view().innerHTML = cmp ? compareHTML() : singleHTML(item.setups[current]);
    if (renaming) { const i = el.querySelector('#setup-rename'); i.focus(); i.select(); }
  };
  // After a change: the tab and this window show the files as they are now.
  const refresh = async keep => {
    const items = await getItems(g, 'setups', true).catch(err => { toast(err.message, true); return []; });
    if (state.view === 'mods' && state.game === g.key && currentTab(g) === 'setups') renderMods();
    const next = items.find(i => i.id.toLowerCase() === item.id.toLowerCase());
    if (!next) { close(); return; }
    item = next;
    current = Math.max(0, item.setups.findIndex(s => s.name === keep));
    cmp = null; renaming = false;
    draw();
  };
  const run = async (job, keep, done) => {
    try { await job(); if (done) toast(done); await refresh(keep); }
    catch (err) { toast(err?.message || String(err), true); }
  };
  draw();
  // The times (and, for AC, the track names they're shown with) come in after.
  Promise.all([allSetupRuns().catch(() => []), g.key === 'ac' ? getItems(g, 'tracks').catch(() => []) : []])
    .then(([r, t]) => { runs = r; tracks = t; if (el.isConnected && !renaming) draw(); });

  el.addEventListener('change', e => {
    const side = e.target.dataset.s?.match(/^cmp-(a|b)$/)?.[1];
    if (!side) return;
    const i = +e.target.value, k = side === 'a' ? 0 : 1;
    // Picking the other side's setup swaps the two.
    if (cmp[1 - k] === i) cmp[1 - k] = cmp[k];
    cmp[k] = i;
    draw();
  });
  el.addEventListener('keydown', e => {
    if (e.target.id !== 'setup-rename') return;
    if (e.key === 'Enter') el.querySelector('[data-s="rename-save"]')?.click();
    if (e.key === 'Escape') { e.stopPropagation(); renaming = false; draw(); }
  });
  el.addEventListener('click', async e => {
    const menu = el.querySelector('.sx-menu');
    if (menu && !e.target.closest('.sx-pick')) menu.hidden = true;
    const open = e.target.closest('[data-open]');
    if (open) { current = +open.dataset.open; cmp = null; renaming = false; draw(); view().scrollTop = 0; return; }
    const tab = e.target.closest('[data-tab]');
    if (tab) { SX_TAB[g.key] = tab.dataset.tab; draw(); return; }
    const pickB = e.target.closest('[data-cmp]');
    if (pickB) { cmp = [current, +pickB.dataset.cmp]; renaming = false; draw(); view().scrollTop = 0; return; }
    const diff = e.target.closest('[data-diff]');
    if (diff) { diffOnly = diff.dataset.diff === '1'; draw(); return; }
    const b = e.target.closest('[data-s]');
    const act = b?.dataset.s;
    if (!act || /^cmp-[ab]$/.test(act)) return;
    if (act === 'compare-menu') { if (menu) menu.hidden = !menu.hidden; return; }
    if (act === 'cmp-done') { current = cmp[0]; cmp = null; draw(); return; }
    const s = item.setups[current];
    if (act === 'folder') return openFolder(g.key === 'rally' ? s.file.replace(/\/[^/]+$/, '') : item.path);
    if (act === 'import') return importSetupFlow(item);
    if (act === 'rename') { renaming = true; draw(); return; }
    if (act === 'rename-cancel') { renaming = false; draw(); return; }
    if (rallyBusy(g.key) && act !== 'export') { toast(RALLY_OPEN(), true); return; }
    if (act === 'rename-save') {
      const name = el.querySelector('#setup-rename').value.trim();
      return run(() => renameSetup(s, name), name, tr('Renamed to {name}', { name }));
    }
    if (act === 'duplicate') return run(() => duplicateSetup(s), s.name, tr('{name} duplicated', { name: s.name }));
    if (act === 'delete') {
      // Two-step, like Uninstall.
      const label = b.querySelector('span');
      if (!b.dataset.armed) {
        b.dataset.armed = '1';
        label.textContent = tr('Click again to delete');
        setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; label.textContent = tr('Delete'); } }, 4000);
        return;
      }
      const done = g.key === 'rally' ? tr('{name} deleted (a copy of the file before is kept as .launcher-backup)', { name: s.name }) : tr('{name} deleted (moved to the Recycle Bin)', { name: s.name });
      return run(() => deleteSetup(s), '', done);
    }
    if (act === 'export') {
      let target = '';
      try {
        target = await Neutralino.os.showSaveDialog(tr('Export setup'), { defaultPath: exportName(s), filters: [{ name: tr('Setup'), extensions: [s.game === 'ac' ? 'ini' : 'json'] }] });
      } catch (err) { log(`save dialog: ${err?.message || JSON.stringify(err)}`); }
      if (!target) return;
      try { await exportSetup(s, norm(target)); toast(tr('Exported {file}', { file: basename(norm(target)) })); }
      catch (err) { toast(tr('Could not export: {error}', { error: err?.message || err }), true); }
    }
  });
}

// Import: pick a setup file, then where it goes (AC/ACC: which track's folder).
// `into`: the Setups window it was asked from (it then shows the new setup).
async function importSetupFlow(into) {
  let picked;
  try {
    picked = await Neutralino.os.showOpenDialog(tr('Import a setup'), { filters: [{ name: tr('Setups'), extensions: ['ini', 'json'] }, { name: tr('All files'), extensions: ['*'] }] });
  } catch (err) { log(`open dialog: ${err?.message || JSON.stringify(err)}`); return; }
  if (!picked?.length) return;
  let s;
  try { s = await readSetupFile(norm(picked[0])); } catch (err) { toast(err.message, true); return; }
  const g = gameByKey(s.game);
  let tracks = [];
  if (s.game === 'ac') {
    const own = (await listDir(join(state.paths.ac.setups, s.car))).filter(e => e.type === 'DIRECTORY' && !/^\.+$/.test(e.entry)).map(e => e.entry);
    const installed = await getItems(g, 'tracks').catch(() => []);
    const ids = [...new Set([...own, ...installed.map(t => t.id)])].filter(id => id !== 'generic');
    tracks = [['generic', tr('Any track (generic)')], ...ids.map(id => [id, installed.find(t => t.id === id)?.title || prettifyId(id)]).sort((a, b) => a[1].localeCompare(b[1]))];
  } else if (s.game === 'acc') tracks = ACC_TRACKS.map(t => [t.id, t.name]);
  const existing = (await getItems(g, 'setups').catch(() => [])).find(i => i.carId.toLowerCase() === s.car.toLowerCase());
  const carName = existing?.title || (s.game === 'rally' ? rallyCarName(s.car) : s.game === 'acc' ? ACC_CARS[ACC_SETUP_CARS[s.car.toLowerCase()]] : '') || prettifyId(s.car);
  const versions = [...new Set((existing?.setups || []).map(x => x.version).filter(Boolean))];
  const oldVersion = s.game === 'rally' && s.version && versions.length && !versions.includes(s.version);
  const facts = [
    s.author && `<span>${sxIcon('user')}${esc(s.author)}</span>`,
    s.version && `<span>${esc(tr('Rally {version}', { version: s.version }))}</span>`,
    `<span>${esc(trn(s.values.length, '1 value', '{n} values'))}</span>`,
  ].filter(Boolean).join('');
  const { el, close } = modal(`<div class="setup-import">
      <small class="sx-kicker">${esc(`${g.title} ${g.sub || ''}`.trim())} · ${tr('Import setup')}</small>
      <h2>${esc(carName)}</h2>
      <div class="sx-facts">${facts}</div>
      <label>${tr('Name')}<input id="si-name" value="${esc(s.name)}" maxlength="60"></label>
      ${tracks.length ? `<label>${tr('Track')}<select id="si-track">${tracks.map(([id, name]) => `<option value="${esc(id)}">${esc(name)}</option>`).join('')}</select></label>` : ''}
      ${s.game === 'rally' ? `<p class="sx-hint">${sxIcon('info')}<span>${tr("It goes into Rally's Personal setups for this car: load it in Car Setup › Save/Load Setup.")}</span></p>` : ''}
      ${oldVersion ? `<p class="sx-hint warn">${sxIcon('info')}<span>${tr('Made with Rally {version}; your setups are from {yours}. Rally may change some values when it loads it.', { version: s.version, yours: versions.join(', ') })}</span></p>` : ''}
      <div class="detail-actions"><button class="btn small primary" data-imp>${tr('Import')}</button><button class="btn small subtle" data-close>${tr('Cancel')}</button></div>
    </div>`, 'modal slim setup-import-modal');
  el.querySelector('[data-imp]').onclick = async e => {
    if (rallyBusy(s.game)) { toast(RALLY_OPEN(), true); return; }
    e.target.disabled = true;
    try {
      const name = await importSetup(s, state.paths, el.querySelector('#si-track')?.value || '', el.querySelector('#si-name').value);
      close();
      toast(tr('{name} imported for {car}', { name, car: carName }));
      const items = await getItems(g, 'setups', true);
      if (state.view === 'mods' && state.game === g.key && currentTab(g) === 'setups') renderMods();
      const car = items.find(i => i.carId.toLowerCase() === s.car.toLowerCase());
      if (car && (into || state.view === 'mods')) openSetups(g, car);
    } catch (err) {
      e.target.disabled = false;
      toast(err?.message || String(err), true);
    }
  };
}

// ---------------------------------------------------------------------------
// Detail modal

function specsHTML(item) {
  const rows = [];
  const s = item.specs || {};
  const add = (k, v) => v && rows.push(`<dt>${tr(k)}</dt><dd>${esc(v)}</dd>`);
  if (item.game === 'rally' && !item.isMod && (item.kind === 'car' || item.kind === 'track')) {
    if (item.kind === 'car') {
      add('Brand', item.brand); add('Class', item.tags?.[0]);
      add('Default livery', item.rally?.livery); add('Your liveries', String(item.rally?.liveries || 0));
    } else {
      add('Location', item.locationName); add('Country', countryName(item.country)); add('Stages', String(item.layouts.length));
    }
    return `<dl class="specs">${rows.join('')}</dl>`;
  }
  if (item.kind === 'car') {
    add('Power', s.bhp); add('Torque', s.torque); add('Weight', s.weight); add('Top speed', s.topspeed);
    add('0-100', s.acceleration); add('P/W ratio', s.pwratio); add('Year', item.year); add('Country', item.country);
    add('Skins', String(item.skins?.length || 0));
  } else if (item.kind === 'track') {
    // EVO mod packages don't list layouts.
    const l = item.layouts?.[0] || {};
    add('Location', item.subtitle); add('Length', l.length); add('Pit boxes', l.pitboxes); add('Layouts', item.layouts ? String(item.layouts.length) : '');
  } else if (item.game === 'acc') {
    add('Car', item.subtitle); add('Race number', item.number != null ? `#${item.number}` : ''); add('Driver', item.author);
  }
  add('Author', item.author && item.kind !== 'livery' ? item.author : '');
  add('Version', item.version);
  add('Folder id', item.id);
  return rows.length ? `<dl class="specs">${rows.join('')}</dl>` : '';
}

function openDetail(g, item, onChange) {
  let selectedSkin = item.skins?.[0]?.id || '';
  const heroSrc = item.image;
  const actions = [];
  if (item.game === 'ac' && item.kind === 'car') actions.push(`<button class="btn primary small" data-a="drive">▶ ${tr('Drive this car')}</button>`);
  if (item.game === 'ac' && item.kind === 'track') actions.push(`<button class="btn primary small" data-a="drive">▶ ${tr('Drive here')}</button>`);
  if (item.game === 'evo' && item.kind === 'car' && item.carId) actions.push(`<button class="btn primary small" data-a="drive">▶ ${tr('Drive this car')}</button>`);
  if (item.game === 'evo' && item.evoTrack) actions.push(`<button class="btn primary small" data-a="drive">▶ ${tr('Quick Drive here')}</button>`);
  const isMedia = item.kind === 'screenshot' || item.kind === 'replay';
  const removeLabel = isMedia ? tr('Delete') : tr('Uninstall');
  if (item.kind === 'screenshot') actions.push(`<button class="btn primary small" data-a="open">${tr('Open picture')}</button>`);
  if (item.toggle) actions.push(`<button class="btn small ${item.enabled ? 'subtle' : 'primary'}" data-a="toggle">${item.enabled ? tr('Disable') : tr('Enable')}</button>`);
  actions.push(`<button class="btn small subtle" data-a="folder">${tr('Open folder')}</button>`);
  // The mod's "url": web pages only (a bare "www.…" gets https://).
  const authorUrl = /^https?:\/\//i.test(item.url || '') ? item.url : /^www\./i.test(item.url || '') ? `https://${item.url}` : '';
  if (authorUrl) actions.push(`<button class="btn small subtle" data-a="url">${tr('Author page')} ↗</button>`);
  if (item.update) actions.push(`<button class="btn small primary" data-a="update" title="${esc(tr("Opens the download Content Manager's update registry lists"))}">${tr('Get update')} v${esc(item.update.version)} ↗</button>`);
  if (uninstallPaths(item).length) actions.push(`<button class="btn small danger" data-a="uninstall" title="${esc(isMedia ? tr('Moves the file to the Recycle Bin') : tr("Moves the mod's files to the Recycle Bin"))}">${removeLabel}</button>`);

  const skins = item.skins?.length ? `<div class="section-title">${tr('Skins')} (${item.skins.length})</div>
    <div class="skins">${item.skins.map(s => `<button class="skin ${s.id === selectedSkin ? 'active' : ''}" data-skin="${esc(s.id)}">
      ${imgTag(s.image, s.livery)}<span>${esc(s.id)}</span></button>`).join('')}</div>` : '';

  const layouts = item.layouts?.length > 1 ? `<div class="section-title">${tr(item.game === 'rally' ? 'Stages' : 'Layouts')} (${item.layouts.length})</div>
    <div class="skins${item.game === 'rally' ? ' rally-maps' : ''}">${item.layouts.map(l => {
      const label = `${l.name || l.id || tr('Default')}${l.length ? ` · ${l.length}` : ''}`;
      return `<div class="skin" title="${esc(label)}">${imgTag(l.preview, l.outline)}<span>${esc(label)}</span></div>`;
    }).join('')}</div>` : '';

  const galleryItems = (item.gallery || []).map(g => typeof g === 'string' ? { src: g } : g);
  const gallery = galleryItems.length > 1 ? `<div class="section-title">${esc(tr(item.galleryTitle || 'Textures'))} (${galleryItems.length})</div>
    <div class="skins">${galleryItems.map((g, i) => `<button class="skin ${g.src === item.image ? 'active' : ''}" data-gal="${i}">
      ${imgTag(g.src, '')}${g.label ? `<span>${esc(tr(g.label))}</span>` : ''}</button>`).join('')}</div>` : '';

  const { el, close } = modal(`
    <div class="detail-hero ${item.kind === 'replay' ? 'icon' : ''}">
      ${item.number != null ? `<div class="thumb" style="position:absolute;inset:0"><div class="placeholder" style="font-size:140px">#${esc(item.number)}</div></div>` : ''}
      ${imgTag(heroSrc, item.fallbackImage)}
      ${item.overlay ? `<img class="overlay${item.game === 'rally' ? ' white' : ''}" src="${esc(item.overlay)}" data-err="remove" alt="">` : ''}
    </div>
    <div class="detail-body">
      ${item.kind === 'car' && item.badge ? `<img class="detail-logo" src="${esc(item.badge)}" data-err="remove" alt="">` : ''}
      <h2>${esc(item.title)}</h2>
      <div class="detail-sub">${esc(item.subtitle || '')}</div>
      <div class="detail-actions">${actions.join('')}</div>
      <div class="detail-grid">
        <div>
          <div class="detail-desc">${esc(item.description || tr('No description provided.'))}</div>
          ${item.tags?.length ? `<div class="chips">${item.tags.map(t => `<span class="chip">${esc(t)}</span>`).join('')}</div>` : ''}
        </div>
        ${specsHTML(item)}
      </div>
      ${skins}${layouts}${gallery}
    </div>`);

  if (item.update) cupDetails(item.kind, item.id).then(d => {
    const desc = el.querySelector('.detail-desc');
    if (d?.changelog && desc) desc.textContent += `\n\n${tr("What's new in v{version}:", { version: item.update.version })}\n${d.changelog}`;
  }).catch(() => {});

  const showHero = src => {
    const img = el.querySelector('.detail-hero img.main');
    if (img) { img.classList.remove('contain'); img.style.display = ''; img.src = src; }
  };
  el.addEventListener('click', async e => {
    const skin = e.target.closest('[data-skin]');
    if (skin) {
      selectedSkin = skin.dataset.skin;
      el.querySelectorAll('.skin').forEach(s => s.classList.toggle('active', s === skin));
      const s = item.skins.find(x => x.id === selectedSkin);
      if (s) showHero(s.image);
      return;
    }
    const gal = e.target.closest('[data-gal]');
    if (gal) {
      el.querySelectorAll('[data-gal]').forEach(s => s.classList.toggle('active', s === gal));
      showHero(galleryItems[+gal.dataset.gal].src);
      return;
    }
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'folder') openFolder(item.path.replace(/\/[^/]+\.(kspkg)(\.disabled)?$/i, ''));
    if (a === 'url') openExternal(authorUrl);
    if (a === 'open') openFile(item.meta.file);
    if (a === 'update') openExternal(item.update.get);
    if (a === 'toggle') {
      try {
        await setEnabled(item, !item.enabled);
        item.enabled = !item.enabled;
        if (item.toggle === 'evo') item.path = item.enabled ? item.path.replace(/\.disabled$/i, '') : item.path + '.disabled';
        if (item.toggle === 'rally') item.meta.files = item.meta.files.map(f => item.enabled ? f.replace(/\.disabled$/i, '') : f.replace(/\.disabled$/i, '') + '.disabled');
        toast(tr(item.enabled ? '{name} enabled' : '{name} disabled', { name: item.title }));
        close();
        onChange?.();
        if (item.game === 'evo' && item.kind === 'track') evoTrackSync();
      } catch (err) {
        toast(tr('Could not change {name}: {error}', { name: item.title, error: err?.message || tr('file in use?') }), true);
      }
    }
    if (a === 'uninstall') {
      // Two-step: the first click arms the button, the second one uninstalls.
      const b = e.target.closest('[data-a]');
      if (!b.dataset.armed) {
        b.dataset.armed = '1';
        b.textContent = isMedia ? tr('Click again to delete') : tr('Click again to uninstall');
        setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = removeLabel; } }, 4000);
        return;
      }
      b.disabled = true;
      try {
        await uninstallItem(item);
        for (const list of Object.values(state.cache)) { const i = list.indexOf(item); if (i >= 0) list.splice(i, 1); }
        toast(tr(isMedia ? '{name} deleted (moved to the Recycle Bin)' : '{name} uninstalled (moved to the Recycle Bin)', { name: item.title }));
        close();
        onChange?.();
        if (item.game === 'evo' && item.kind === 'track' && item.isMod) evoTrackSync();
      } catch (err) {
        b.disabled = false; delete b.dataset.armed; b.textContent = removeLabel;
        toast(tr('Could not uninstall {name}: {error}', { name: item.title, error: err?.message || tr('file in use?') }), true);
      }
    }
    if (a === 'drive') {
      close();
      if (item.game === 'evo') openQuickDriveFor('evo', item.kind === 'car' ? { car: item } : { track: item });
      else if (item.kind === 'car') openQuickDriveFor('ac', { car: item, skin: selectedSkin });
      else openQuickDriveFor('ac', { track: item });
    }
  });
}

// ---------------------------------------------------------------------------
// Quick Drive picker shared by AC and EVO: a tab per game, a session button
// (opens the session settings sheet), car column (brand rail, a compact row with
// the selected car's liveries/skins and the car grid) and track column (layouts +
// track grid), with a pinned footer.
//   o.game     key of the game tab shown as active
//   o.session  { summary(sel) -> { title, sub }, sections(sel) -> sheet sections, onChange(ui) }
//   o.cars     [{ key, title, sub, image, brand, flag, locked }]
//   o.brandLogo(name) -> image url ('' shows initials)
//   o.variants(carKey) -> [{ key, title, sub, image, livery?, spec?, specLabel? }]   (liveries / skins)
//              with specs (EVO: the same livery per mechanical preset), the row shows
//              each livery once in the chosen spec, and a Spec menu switches the whole row;
//              variants without a spec (Rally: a livery with no plates/no-plates twin) stay as they are
//   o.specName name of that menu ('Spec'; Rally: 'Plates')
//   o.tracks   [{ key, title, sub, image, flag, layouts: [{ key, name, sub, outline, preview }] }]
//   o.sel      { car, variant, track, layout }; o.defaultVariant(carKey)
//   o.onLocked(car), o.onLaunch(sel), o.onClose(sel) (also when switching game or launching)
// Returns { el, close, redraw, redrawTracks, sync } so async data can refresh it.

const QD_TABS = [['ac', 'Assetto Corsa'], ['evo', 'EVO'], ['acc', 'Competizione'], ['rally', 'Rally']];

// Quick Drive is a page of its own (no game sidebar). A game's page only
// replaces the current one if it's still the game asked for (state.qdWant):
// lists load asynchronously and the player may have switched again meanwhile.
// onLeave runs when the page is replaced or the player goes elsewhere.
function qdPage(game, html, onLeave) {
  const wrap = document.createElement('div');
  wrap.className = 'view scaled qd-view';
  wrap.innerHTML = html;
  if (state.qdWant !== game) return { el: wrap, close() {} };
  const root = $('#modal-root');
  root.__onClose?.(); root.__onClose = null; root.innerHTML = '';
  if (state.view !== 'quickdrive') { state.view = 'quickdrive'; syncChrome(); }
  main.__qdLeave?.();
  main.__qdLeave = onLeave;
  main.replaceChildren(wrap);
  return { el: wrap, close() {} };
}

function quickDriveModal(o) {
  const sel = { ...o.sel };
  const search = { car: '', track: '' };
  let brand = '', stripCar = null;
  const findCar = k => o.cars.find(c => c.key === k);
  const findTrack = k => o.tracks.find(t => t.key === k);
  const match = (q, text) => !q || text.toLowerCase().includes(q.toLowerCase());

  const tabs = QD_TABS.map(([k, label]) => {
    const why = quickDriveBlocker(k);
    return `<button class="qd-game ${k === o.game ? 'active' : ''} ${why ? 'off' : ''}" data-qd-game="${k}" title="${esc(why || tr('Quick Drive for {game}', { game: label }))}">${esc(label)}</button>`;
  }).join('');
  const { el, close } = qdPage(o.game, `<div class="qd evo" data-game="${o.game}">
    <header class="qd-head">
      <div class="qd-title"><h2>Quick Drive</h2><nav class="qd-games">${tabs}</nav>
        <button class="qd-session-btn" data-session title="${esc(tr('Game mode, opponents, time and weather'))}"></button>
        <button class="qd-presets-btn" data-surprise title="${esc(tr('Pick a random car and track you can drive'))}"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.75" y="1.75" width="12.5" height="12.5" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="5.3" cy="5.3" r="1.1" fill="currentColor"/><circle cx="10.7" cy="10.7" r="1.1" fill="currentColor"/><circle cx="8" cy="8" r="1.1" fill="currentColor"/></svg><span>${tr('Surprise me')}</span></button>
        <button class="qd-presets-btn" data-presets title="${esc(tr('Saved setups, recent sessions and your best times'))}"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 1.75h8c.41 0 .75.34.75.75v11.6l-4.75-3.1-4.75 3.1V2.5c0-.41.34-.75.75-.75z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg><span>${tr('Presets')}</span></button></div>
      <div class="qd-sub">${o.sub}</div>
    </header>
    <div class="qd-cols">
      <section class="qd-panel">
        <div class="qd-panel-head">
          <h3>${tr('Car')} <small>${esc(o.carCount)}</small></h3>
          <input class="search" id="qd-car-q" placeholder="${esc(tr('Search cars…'))}">
        </div>
        <div class="qd-variants" id="qd-variants"></div>
        <div class="qd-carbox">
          <nav class="qd-brands" id="qd-brands"></nav>
          <div class="qd-grid" id="qd-cars"></div>
        </div>
      </section>
      <section class="qd-panel">
        <div class="qd-panel-head">
          <h3>${tr('Track')} <small>${esc(o.trackCount)}</small></h3>
          <input class="search" id="qd-track-q" placeholder="${esc(tr('Search tracks…'))}">
        </div>
        <div class="qd-layouts" id="qd-layouts"></div>
        <div class="qd-grid" id="qd-tracks"></div>
      </section>
    </div>
    <footer class="qd-foot">
      <div class="qd-summary" id="qd-summary"></div>
      <button class="btn primary small" id="qd-go" data-launch-game="${o.game}">▶ ${esc(o.launchLabel)}</button>
    </footer>
  </div>`, () => o.onClose?.({ ...sel }));

  const card = (attrs, img, title, sub, flag = '', cls = '') => `<button class="qd-card ${cls}" ${attrs}>
    <div class="thumb">${imgTag(img, '')}${flag}</div>
    <div class="qd-card-body"><b>${esc(title)}</b><small>${esc(sub || '')}</small></div></button>`;
  const variantOf = () => (o.variants(sel.car) || []).find(v => v.key === sel.variant);
  // The livery row: with specs, every livery once, in the selected spec. A livery
  // the spec doesn't have shows the spec it comes with; picking it switches to it.
  // A variant without a spec is shown as it is; while one is selected, the menu
  // keeps the spec picked last (sel.spec).
  const specsOf = all => [...new Map(all.filter(x => x.spec).map(x => [x.spec, { key: x.spec, label: x.specLabel || x.spec }])).values()];
  const variantRow = () => {
    const all = o.variants(sel.car) || [];
    const specs = specsOf(all);
    if (specs.length < 2) return { variants: all, specs, spec: specs[0]?.key };
    const spec = all.find(x => x.key === sel.variant)?.spec ?? (specs.some(s => s.key === sel.spec) ? sel.spec : specs[0].key);
    const liveries = [...new Map(all.map(x => [x.spec ? x.livery : `key:${x.key}`, x])).values()];
    return {
      specs, spec,
      variants: liveries.map(l => !l.spec ? l : all.find(x => x.livery === l.livery && x.spec === spec)
        || { ...l, sub: [l.sub, l.specLabel !== l.title && l.specLabel].filter(Boolean).join(' · ') }),
    };
  };
  // Another spec: the same livery with it, else its first livery (a variant
  // without a spec stays selected).
  const pickSpec = spec => {
    const all = o.variants(sel.car) || [], cur = all.find(x => x.key === sel.variant);
    sel.spec = spec;
    if (cur && !cur.spec) return sel.variant;
    return (all.find(x => x.spec === spec && x.livery === cur?.livery) || all.find(x => x.spec === spec))?.key ?? sel.variant;
  };
  const withSpec = (v, all) => [v.title, specsOf(all).length > 1 && v.specLabel !== v.title && v.specLabel].filter(Boolean).join(' · ');
  const variantText = v => (v ? withSpec(v, o.variants(sel.car) || []) : '');

  const drawBrands = () => {
    const names = [...new Set(o.cars.map(c => c.brand).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    el.querySelector('#qd-brands').innerHTML = `<button class="qd-brand all ${brand ? '' : 'active'}" data-brand="" title="${esc(tr('All brands'))}">${tr('All')}</button>` +
      names.map(n => {
        const logo = o.brandLogo(n);
        return `<button class="qd-brand ${n === brand ? 'active' : ''}" data-brand="${esc(n)}" title="${esc(n)}">${logo
          ? `<img src="${esc(logo)}" alt="" data-err="initials" data-initials="${initials(n)}">`
          : `<span>${initials(n)}</span>`}</button>`;
      }).join('');
  };
  const drawCars = () => {
    const list = o.cars.filter(c => (!brand || c.brand === brand || c.key === '') && match(search.car, `${c.title} ${c.sub} ${c.brand} ${c.key}`));
    el.querySelector('#qd-cars').innerHTML = list.map(c => card(`data-car="${esc(c.key)}"`, c.image, c.title, c.sub, c.flag || '', c.locked ? 'locked' : '')).join('')
      || `<div class="qd-none">${tr('No cars match.')}</div>`;
    sync();
  };
  const drawTracks = () => {
    // The track list can change (per game mode); keep the selection valid.
    let t = findTrack(sel.track);
    if (!t) { t = o.tracks[0]; sel.track = t?.key ?? ''; }
    if (t && !t.layouts.some(l => l.key === sel.layout)) sel.layout = t.layouts[0]?.key ?? '';
    el.querySelector('#qd-tracks').innerHTML = o.tracks
      .filter(t => match(search.track, `${t.title} ${t.sub} ${t.layouts.map(l => l.name).join(' ')}`))
      .map(t => card(`data-track="${esc(t.key)}"`, t.image, t.title, t.sub, t.flag || '')).join('') || `<div class="qd-none">${tr('No tracks match.')}</div>`;
    sync();
  };
  const drawSession = () => {
    const s = o.session?.summary(sel);
    const btn = el.querySelector('[data-session]');
    btn.hidden = !s;
    if (s) btn.innerHTML = `<svg class="qd-session-gear" viewBox="0 0 24 24" aria-hidden="true"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.8"/></svg><span class="qd-session-edit">${tr('Session settings')}</span>`;
    return s;
  };
  const sync = () => {
    const c = findCar(sel.car), t = findTrack(sel.track), layout = t?.layouts.find(l => l.key === sel.layout), v = variantOf();
    // The selected car's card shows the chosen livery/skin (not in Rally: its
    // livery pictures are flat textures, the car's photo reads better).
    const vImage = o.keepCarImage ? '' : v?.image;
    el.querySelectorAll('#qd-cars [data-car]').forEach(b => {
      const on = b.dataset.car === sel.car;
      b.classList.toggle('active', on);
      const img = b.querySelector('img.main'), want = (on && vImage) || findCar(b.dataset.car)?.image;
      if (img && want && img.getAttribute('src') !== want) img.src = want;
    });
    el.querySelectorAll('#qd-tracks [data-track]').forEach(b => b.classList.toggle('active', b.dataset.track === sel.track));
    const { variants, specs, spec } = variantRow();
    // Keep the row's scroll position while picking within the same car.
    const keepX = stripCar === sel.car ? el.querySelector('.qd-variant-strip')?.scrollLeft || 0 : 0;
    stripCar = sel.car;
    const hint = o.variantHint?.(sel.car);
    const chevron = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const specName = tr(o.specName || 'Spec');
    const specMenu = specs.length > 1 ? `<div class="qd-spec"><button class="qd-spec-btn" data-spec-menu title="${esc(`${specName}: ${specs.find(s => s.key === spec)?.label || ''}`)}">${esc(specName)}${chevron}</button>
      <div class="qd-spec-menu" hidden><small>${esc(specName)}</small>${specs.map(s => `<button class="${s.key === spec ? 'active' : ''}" data-spec="${esc(s.key)}">${esc(s.label)}</button>`).join('')}</div></div>` : '';
    el.querySelector('#qd-variants').innerHTML = variants.length || hint
      ? `<span class="qd-layouts-name">${esc(tr(o.variantLabel))}</span>${specMenu}<div class="qd-variant-strip">${variants.map(x => `<button class="qd-variant ${x.key === sel.variant ? 'active' : ''}" data-variant="${esc(x.key)}" title="${esc([x.title, x.sub].filter(Boolean).join(' · '))}">
          <div class="thumb">${imgTag(x.image, '')}</div><span>${esc(x.title)}${x.sub ? `<small>${esc(x.sub)}</small>` : ''}</span></button>`).join('')}</div>
          ${hint ? `<span class="qd-variant-hint" data-tip="${esc(hint)}" aria-label="${esc(hint)}"><svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="8.2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10 9v5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="10" cy="6.2" r="1.1" fill="currentColor"/></svg></span>` : ''}`
      : '';
    const strip = el.querySelector('.qd-variant-strip');
    if (strip) strip.scrollLeft = keepX;
    // l.outlineColor: a picture in its own colours (Rally's stage maps, red part driven), not
    // an outline to draw white; l.outlineFallback: tried when l.outline doesn't load.
    el.querySelector('#qd-layouts').innerHTML = t ? `<span class="qd-layouts-name">${esc(t.title)}</span>` + t.layouts
      .map(l => `<button class="qd-layout ${l.key === sel.layout ? 'active' : ''}" data-layout="${esc(l.key)}">
        ${l.outline ? `<img ${l.outlineColor ? 'class="color" ' : ''}src="${esc(l.outline)}" alt="" data-err="remove"${l.outlineFallback ? ` data-fallback="${esc(l.outlineFallback)}"` : ''}>` : ''}<span>${esc(l.name)}${l.sub ? `<small>${esc(l.sub)}</small>` : ''}</span></button>`).join('') : '';
    const note = drawSession();
    const pb = o.best?.(sel);
    el.querySelector('#qd-summary').innerHTML = `
      <div class="qd-sum-img">${imgTag(vImage || c?.image, (c?.brand && o.brandLogo(c.brand)) || '')}</div>
      <div><b>${esc(c?.summaryTitle || c?.title || '')}</b><small>${esc(v ? variantText(v) : c?.sub || '')}</small></div>
      <div class="qd-sum-img">${imgTag(layout?.preview || t?.image, '')}</div>
      <div><b>${esc(t?.title || '')}</b><small>${esc([layout?.name, layout?.sub].filter(Boolean).join(' · '))}</small></div>
      ${pb ? `<div class="qd-pb" title="${esc(tr('Your personal best with this car here, as recorded by the game'))}${pb.at ? ` (${esc(timeAgo(pb.at / 1000))})` : ''}"><small>${tr('Your best')}</small><b>${esc(lapTime(pb.ms))}</b></div>` : ''}
      ${note ? `<button class="qd-sum-note" data-session><b>${esc(note.title)}</b><small>${esc(note.sub)}</small></button>` : ''}`;
  };
  const redraw = () => { drawBrands(); drawCars(); drawTracks(); };
  redraw();

  el.querySelector('.qd-games').onclick = e => {
    const b = e.target.closest('[data-qd-game]');
    if (!b || b.dataset.qdGame === o.game) return;
    const why = quickDriveBlocker(b.dataset.qdGame);
    if (why) { toast(why, true); return; }
    openQuickDriveFor(b.dataset.qdGame);
  };
  el.querySelector('#qd-car-q').oninput = e => { search.car = e.target.value.trim(); drawCars(); };
  el.querySelector('#qd-track-q').oninput = e => { search.track = e.target.value.trim(); drawTracks(); };
  el.querySelector('#qd-brands').onclick = e => {
    const b = e.target.closest('[data-brand]');
    if (!b) return;
    brand = b.dataset.brand;
    drawBrands(); drawCars();
    el.querySelector('#qd-cars').scrollTop = 0;
  };
  el.querySelector('#qd-cars').onclick = e => {
    const b = e.target.closest('[data-car]');
    if (!b) return;
    const c = findCar(b.dataset.car);
    if (c.locked) { o.onLocked?.(c); return; }
    sel.car = c.key; sel.variant = o.defaultVariant(c.key);
    sync();
  };
  el.querySelector('#qd-variants').onclick = e => {
    if (e.target.closest('[data-spec-menu]')) {
      const menu = el.querySelector('.qd-spec-menu');
      if (menu) menu.hidden = !menu.hidden;
      return;
    }
    const s = e.target.closest('[data-spec]');
    if (s) { sel.variant = pickSpec(s.dataset.spec); sync(); return; }
    const b = e.target.closest('[data-variant]');
    if (b) { sel.variant = b.dataset.variant; sync(); }
  };
  // The Spec menu closes on any other click.
  el.addEventListener('click', e => {
    if (!e.target.closest('.qd-spec')) { const m = el.querySelector('.qd-spec-menu'); if (m) m.hidden = true; }
  });
  // The livery row scrolls sideways; let the mouse wheel drive it.
  el.querySelector('#qd-variants').addEventListener('wheel', e => {
    const strip = e.target.closest('.qd-variant-strip');
    if (!strip || strip.scrollWidth <= strip.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    e.preventDefault();
    strip.scrollLeft += e.deltaY;
  }, { passive: false });
  el.querySelector('#qd-tracks').onclick = e => {
    const b = e.target.closest('[data-track]');
    if (b) { sel.track = b.dataset.track; sel.layout = findTrack(sel.track)?.layouts[0]?.key ?? ''; sync(); }
  };
  el.querySelector('#qd-layouts').onclick = e => {
    const b = e.target.closest('[data-layout]');
    if (b) { sel.layout = b.dataset.layout; sync(); }
  };
  // Scroll only the list itself (scrollIntoView would also scroll the dialog).
  const reveal = (box, item, axis = 'y') => {
    if (!box || !item) return;
    // Both lists are position: relative, so offsets are measured from the list itself.
    if (axis === 'y') box.scrollTop = item.offsetTop - 8;
    else box.scrollLeft = item.offsetLeft - 8;
  };
  const revealAll = () => {
    reveal(el.querySelector('#qd-cars'), el.querySelector('#qd-cars .active'));
    reveal(el.querySelector('#qd-tracks'), el.querySelector('#qd-tracks .active'));
    reveal(el.querySelector('.qd-variant-strip'), el.querySelector('.qd-variant.active'), 'x');
  };
  revealAll();

  const ui = {
    el, close, sync,
    redraw: () => { const y = el.querySelector('#qd-cars').scrollTop; redraw(); el.querySelector('#qd-cars').scrollTop = y; },
    setCars: cars => { o.cars = cars; ui.redraw(); },
    // Tracks changed (e.g. another game mode): redraw them and show the selection.
    redrawTracks: () => { drawTracks(); reveal(el.querySelector('#qd-tracks'), el.querySelector('#qd-tracks .active')); },
  };
  el.addEventListener('click', e => {
    if (e.target.closest('[data-session]') && o.session) openSessionSheet(el.querySelector('.qd'), o.session, () => ({ ...sel }), () => { o.session.onChange?.(ui); sync(); });
    if (e.target.closest('[data-presets]')) openPresets();
    if (e.target.closest('[data-surprise]')) surprise();
  });

  // Surprise me: a random car (and livery/skin) and a random track and layout
  // among the ones this game can start with; the session settings stay.
  const pick = list => list[Math.floor(Math.random() * list.length)];
  const surprise = () => {
    const cars = o.cars.filter(c => c.key !== '' && !c.locked && c.key !== sel.car);
    const tracks = o.tracks.filter(t => t.key !== sel.track || t.layouts.length > 1);
    if (!cars.length || !tracks.length) { toast(tr('Nothing else to pick from'), true); return; }
    const c = pick(cars), t = pick(tracks);
    const variants = o.variants(c.key) || [];
    const layouts = t.key === sel.track ? t.layouts.filter(l => l.key !== sel.layout) : t.layouts;
    sel.car = c.key; sel.variant = variants.length ? pick(variants).key : o.defaultVariant(c.key);
    sel.track = t.key; sel.layout = layouts.length ? pick(layouts).key : '';
    search.car = search.track = ''; brand = '';
    el.querySelector('#qd-car-q').value = el.querySelector('#qd-track-q').value = '';
    redraw(); revealAll();
    const l = t.layouts.find(x => x.key === sel.layout);
    toast(tr('Surprise: {car} at {track}', { car: c.summaryTitle || c.title, track: `${t.title}${l?.name ? ` · ${l.name}` : ''}` }));
  };

  // Presets (named setups) and recent sessions, per game: the selection plus the
  // session settings (o.session.get/set), with names for the list.
  const store = key => ((state.settings[key] ||= {})[o.game] ||= []);
  const describe = s => {
    const c = findCar(s.car), t = findTrack(s.track), l = t?.layouts.find(x => x.key === s.layout);
    const all = o.variants(s.car) || [], v = all.find(x => x.key === s.variant);
    return { car: c?.summaryTitle || c?.title || '', variant: v ? withSpec(v, all) : '', track: [t?.title, l?.name].filter(Boolean).join(' · '), session: o.session?.summary(s)?.title || '' };
  };
  const snapshot = () => ({ sel: { ...sel }, session: o.session?.get ? JSON.parse(JSON.stringify(o.session.get())) : null, label: describe(sel) });
  const same = (a, b) => JSON.stringify([a.sel, a.session]) === JSON.stringify([b.sel, b.session]);
  const apply = p => {
    const missing = [];
    if (p.session && o.session?.set) o.session.set(JSON.parse(JSON.stringify(p.session)));
    const c = findCar(p.sel.car);
    if (c && !c.locked) {
      sel.car = c.key;
      sel.variant = (o.variants(c.key) || []).some(v => v.key === p.sel.variant) ? p.sel.variant : o.defaultVariant(c.key);
    } else missing.push(tr('car'));
    o.session?.onChange?.(ui); // the session can change the track list (EVO, AC)
    const t = findTrack(p.sel.track);
    if (t) { sel.track = t.key; sel.layout = t.layouts.some(l => l.key === p.sel.layout) ? p.sel.layout : t.layouts[0]?.key ?? ''; } else missing.push(tr('track'));
    redraw(); revealAll();
    if (missing.length) toast(tr("Loaded, but the {what} isn't available any more", { what: missing.join(` ${tr('and')} `) }), true);
    else toast(p.message || (p.name ? tr('Loaded “{name}”', { name: p.name }) : tr('Loaded the session')));
  };
  const remember = () => {
    const recent = store('qdRecent'), entry = { ...snapshot(), at: Date.now() };
    const i = recent.findIndex(r => same(r, entry));
    if (i >= 0) recent.splice(i, 1);
    recent.unshift(entry);
    recent.length = Math.min(recent.length, 8);
    saveSettings();
  };
  const openPresets = () => {
    const host = el.querySelector('.qd');
    host.querySelector('.qd-sheet-wrap')?.remove();
    const wrap = document.createElement('div');
    wrap.className = 'qd-sheet-wrap';
    host.appendChild(wrap);
    const row = (p, i, kind) => `<div class="qd-preset">
      <div class="qd-preset-info"><b>${esc(kind === 'saved' ? p.name : p.label.car || tr('Session'))}</b>
        <small>${esc([kind === 'saved' && p.label.car, p.label.variant, p.label.track, p.label.session, kind === 'recent' && timeAgo(p.at / 1000)].filter(Boolean).join(' · '))}</small></div>
      <button class="btn primary small" data-load="${kind}:${i}">${tr('Load')}</button>
      ${kind === 'saved' ? `<button class="btn subtle small" data-del="${i}" title="${esc(tr('Delete this preset'))}">✕</button>` : `<button class="btn subtle small" data-keep="${i}" title="${esc(tr('Keep it as a preset'))}">${tr('Save')}</button>`}</div>`;
    const draw = () => {
      const saved = store('qdPresets'), recent = store('qdRecent');
      wrap.innerHTML = `<div class="qd-sheet qd-presets">
        <header><h3>${tr('Presets')}</h3><small>${esc(o.variantLabel
          ? tr('A preset keeps the car and {what}, the track and the session settings.', { what: tr(o.variantLabel).toLowerCase() })
          : tr('A preset keeps the car, the track and the session settings.'))}</small><button class="btn primary small" data-done>${tr('Done')}</button></header>
        <div class="qd-sheet-body">
          <section class="qd-sheet-sec"><h4>${tr('Saved')}</h4>
            <form class="qd-preset-new"><input class="search" maxlength="48" placeholder="${esc(tr('Name the current setup'))}"><button class="btn primary small">${tr('Save current')}</button></form>
            ${saved.map((p, i) => row(p, i, 'saved')).join('') || `<p class="qd-preset-empty">${tr('No presets yet.')}</p>`}</section>
          <section class="qd-sheet-sec"><h4>${tr('Recent sessions')}</h4>
            ${recent.map((p, i) => row(p, i, 'recent')).join('') || `<p class="qd-preset-empty">${tr('Sessions you start from here appear here.')}</p>`}</section>
          ${o.bests ? `<section class="qd-sheet-sec"><h4>${tr('Beat your time')}</h4>
            ${bests.map((b, i) => { const d = describe(b.sel); return `<div class="qd-preset">
              <div class="qd-preset-info"><b>${esc(lapTime(b.ms))} · ${esc(d.car)}</b><small>${esc([d.track, b.at && timeAgo(b.at / 1000)].filter(Boolean).join(' · '))}</small></div>
              <button class="btn primary small" data-beat="${i}" title="${esc(tr('Select this car and track'))}">${tr('Select')}</button></div>`; }).join('') || `<p class="qd-preset-empty">${tr('No personal bests recorded by the game yet.')}</p>`}</section>` : ''}
        </div></div>`;
    };
    // Personal bests with a car and track this dialog lists, newest first.
    const bests = (o.bests?.() || []).filter(b => findCar(b.sel.car) && findTrack(b.sel.track)).sort((a, b) => b.at - a.at).slice(0, 25);
    const save = (entry, name) => {
      const saved = store('qdPresets');
      const i = saved.findIndex(p => p.name.toLowerCase() === name.toLowerCase());
      if (i >= 0) saved.splice(i, 1);
      saved.unshift({ ...entry, name });
      saveSettings(); draw();
      toast(tr('Saved preset “{name}”', { name }));
    };
    wrap.addEventListener('submit', e => {
      e.preventDefault();
      const entry = snapshot();
      save(entry, e.target.querySelector('input').value.trim() || [entry.label.car, entry.label.track].filter(Boolean).join(' @ ') || tr('Preset'));
    });
    wrap.addEventListener('click', e => {
      if (e.target === wrap || e.target.closest('[data-done]')) { wrap.remove(); return; }
      const load = e.target.closest('[data-load]')?.dataset.load;
      if (load) { const [kind, i] = load.split(':'); wrap.remove(); apply(store(kind === 'saved' ? 'qdPresets' : 'qdRecent')[i]); return; }
      const del = e.target.closest('[data-del]')?.dataset.del;
      if (del != null) { store('qdPresets').splice(Number(del), 1); saveSettings(); draw(); return; }
      const beat = e.target.closest('[data-beat]')?.dataset.beat;
      if (beat != null) {
        const b = bests[beat];
        wrap.remove();
        apply({ sel: { variant: '', layout: '', ...b.sel }, session: null, message: tr('Selected · your best here is {time}', { time: lapTime(b.ms) }) });
        return;
      }
      const keep = e.target.closest('[data-keep]')?.dataset.keep;
      if (keep != null) { const r = store('qdRecent')[keep]; save({ sel: r.sel, session: r.session, label: r.label }, [r.label.car, r.label.track].filter(Boolean).join(' @ ') || tr('Preset')); }
    });
    draw();
    wrap.querySelector('.qd-preset-new input')?.focus();
  };

  syncRunning(el);
  el.querySelector('#qd-go').onclick = async () => {
    const go = el.querySelector('#qd-go');
    go.disabled = true;
    try {
      if (await o.onLaunch({ ...sel }) !== false) {
        markStarting(o.game);
        remember();
        o.onClose?.({ ...sel });
        close();
        if (state.settings.minimizeOnLaunch) setTimeout(() => Neutralino.window.minimize(), 1500);
      }
    } finally { go.disabled = false; }
  };
  return ui;
}

// Session settings sheet over the Quick Drive dialog. session.sections(sel) returns
//   [{ title, note?, wide?, fields: [{ label, hint?, icon?, disabled?, type: 'seg'|'select'|'date'|'range', options: [[value, label]], get(), set(value) }] }]
// ('date' has no options: its value is YYYY-MM-DD; 'range' is a slider with
// min, max, step and unit instead) and is rebuilt after every change, so fields
// can depend on each other. icon: a picture url, or an SVG (markup starting with
// "<"), or a function giving either for the current value.
function openSessionSheet(host, session, getSel, onChange) {
  host.querySelector('.qd-sheet-wrap')?.remove();
  const wrap = document.createElement('div');
  wrap.className = 'qd-sheet-wrap';
  host.appendChild(wrap);
  let fields = [];
  const iconHTML = f => {
    const icon = typeof f.icon === 'function' ? f.icon() : f.icon;
    return !icon ? '' : icon.startsWith('<') ? `<span class="qd-row-icon">${icon}</span>` : `<span class="qd-row-icon"><img src="${esc(icon)}" alt=""></span>`;
  };
  const fieldHTML = (f, i) => {
    const k = (f.options || []).findIndex(([v]) => v === f.get());
    const off = f.disabled ? ' disabled' : '';
    const control = f.type === 'date' ? `<input type="date" data-f="${i}" value="${esc(f.get())}"${off}>`
      : f.type === 'range'
      ? `<div class="qd-range"><input type="range" data-f="${i}" min="${f.min}" max="${f.max}" step="${f.step || 1}" value="${esc(f.get())}" style="--fill: ${((f.get() - f.min) / (f.max - f.min || 1)) * 100}%"${off}><output>${esc(f.get())}${esc(f.unit || '')}</output></div>`
      : f.type === 'seg'
      ? `<div class="qd-seg" data-f="${i}">${f.options.map(([, label], j) => `<button data-k="${j}" class="${j === k ? 'active' : ''}"${off}>${esc(tr(label))}</button>`).join('')}</div>`
      : `<select data-f="${i}"${off}>${f.options.map(([, label], j) => `<option value="${j}" ${j === k ? 'selected' : ''}>${esc(tr(label))}</option>`).join('')}</select>`;
    return `<div class="qd-row ${f.icon ? 'with-icon' : ''} ${f.disabled ? 'disabled' : ''}"><label>${iconHTML(f)}<span>${esc(tr(f.label))}${f.hint ? `<small>${esc(tr(f.hint))}</small>` : ''}</span></label>${control}</div>`;
  };
  const draw = () => {
    const y = wrap.querySelector('.qd-sheet-body')?.scrollTop || 0;
    fields = [];
    const sections = session.sections(getSel());
    wrap.innerHTML = `<div class="qd-sheet">
      <header><h3>${tr('Session settings')}</h3><small>${esc(tr(session.sheetNote || ''))}</small><button class="btn primary small" data-done>${tr('Done')}</button></header>
      <div class="qd-sheet-body">${sections.map(s => `<section class="qd-sheet-sec ${s.wide ? 'wide' : ''}">
        <h4>${esc(tr(s.title))}</h4>${s.note ? `<p class="qd-sheet-note">${esc(tr(s.note))}</p>` : ''}
        ${s.fields.map(f => fieldHTML(f, fields.push(f) - 1)).join('')}</section>`).join('')}</div>
    </div>`;
    wrap.querySelector('.qd-sheet-body').scrollTop = y;
  };
  const set = (i, j) => { const f = fields[i]; f.set(f.options[j][0]); draw(); onChange(); };
  wrap.addEventListener('click', e => {
    if (e.target === wrap || e.target.closest('[data-done]')) { wrap.remove(); return; }
    const b = e.target.closest('.qd-seg [data-k]');
    if (b) set(Number(b.parentElement.dataset.f), Number(b.dataset.k));
  });
  // A slider shows its value while dragged and applies it when let go.
  wrap.addEventListener('input', e => {
    if (!e.target.matches('input[type=range][data-f]')) return;
    const out = e.target.nextElementSibling, r = e.target;
    if (out) out.textContent = `${r.value}${fields[Number(r.dataset.f)].unit || ''}`;
    r.style.setProperty('--fill', `${((r.value - r.min) / (r.max - r.min || 1)) * 100}%`);
  });
  wrap.addEventListener('change', e => {
    if (e.target.matches('select[data-f]')) set(Number(e.target.dataset.f), Number(e.target.value));
    if (e.target.matches('input[type=range][data-f]')) { fields[Number(e.target.dataset.f)].set(Number(e.target.value)); draw(); onChange(); }
    if (e.target.matches('input[type=date][data-f]') && /^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) {
      fields[Number(e.target.dataset.f)].set(e.target.value); draw(); onChange();
    }
  });
  draw();
}

// Option lists for the session sheets; the current value is always listed.
const withCurrent = (options, value, label) => options.some(([v]) => v === value) ? options : [...options, [value, label(value)]].sort((a, b) => a[0] - b[0]);
const steps = (from, to, step) => Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => from + i * step);
const timeOptions = (value, from = 0, to = 23 * 60 + 45) => withCurrent(steps(from, to, 15).map(m => [m, hhmm(m)]), value, hhmm);
const minutes = m => tr('{n} min', { n: m });
const minuteOptions = (value, from, to, step, zeroLabel) => withCurrent(steps(from, to, step).map(m => [m, m === 0 && zeroLabel ? zeroLabel : minutes(m)]), value, minutes);
const countOptions = (value, from, to, unit) => withCurrent(steps(from, to, 1).map(n => [n, unit ? `${n} ${unit}` : String(n)]), value, n => String(n));
const hhmm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

// Merge saved settings over defaults, keeping only known keys of the right type.
function mergeSettings(base, saved) {
  if (!saved || typeof saved !== 'object') return base;
  for (const k of Object.keys(base)) {
    if (!(k in saved)) continue;
    if (base[k] && typeof base[k] === 'object') mergeSettings(base[k], saved[k]);
    else if (typeof saved[k] === typeof base[k] || (base[k] === 'auto' && typeof saved[k] === 'number')) base[k] = saved[k];
  }
  return base;
}

// ---------------------------------------------------------------------------
// Brand logos for games whose own car pictures can't be read (ACC, Rally):
// EVO's brand logos, else AC's car badges, else the launcher's own for brands
// neither game has (img/brands/<brandKey>.png), keyed by brandKey(name).

// Official site pictures of ACC cars and tracks and Rally stages (sitecatalog.js):
// the ones shipped in img/site/ (manifest.json), plus Rally stages the weekly sync
// found on the site since (cached in .cache/site, settings.siteExtra), so they
// show without a connection. Rally's cars use the game's own pictures (rallydata.js).
let siteManifest = { rally: { stages: {}, maps: {} }, acc: { cars: {}, tracks: {} } };
async function loadSiteImages() {
  try { siteManifest = await (await fetch('/img/site/manifest.json')).json(); } catch (err) { log(`site images: ${err?.message}`); }
  const dir = await appCacheDir('site').catch(() => '');
  // Pictures the launcher now ships aren't needed from the cache (older syncs also
  // took Greece's stage maps for photos: Greece now ships with real ones).
  // Rally cars synced by older launchers are left out: the game's pictures replace them.
  if (state.settings.siteExtra) state.settings.siteExtra = state.settings.siteExtra.filter(x => !(x.key && siteManifest[x.game]?.[x.kind]?.[x.key]) && !(x.game === 'rally' && x.kind === 'cars'));
  for (const x of state.settings.siteExtra || []) x.url = dir ? fileUrl(join(dir, x.file)) : '';
}
function siteImage(game, kind, key) {
  const rel = siteManifest[game]?.[kind]?.[key];
  if (rel) return `/img/site/${rel}`;
  return (state.settings.siteExtra || []).find(x => x.game === game && x.kind === kind && x.url && x.key === key)?.url || '';
}
const rallyCarImage = rallyCarPicture;

// Each launch (when online): look on the official Rally page for stages and stage
// maps added since this launcher was built, and keep their pictures (the
// game is in Early Access). The page is only downloaded when it changed since the
// last look (If-Modified-Since: the site then answers 304 with no body); a
// changed page is ~70 KB compressed. The site's date and picture addresses go on
// a command line, so only well-formed ones are used (HTTP_DATE, safeUrl).
const HTTP_DATE = /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/;
async function siteSync() {
  const since = HTTP_DATE.test(state.settings.siteModified || '') ? `-H "If-Modified-Since: ${state.settings.siteModified}"` : '';
  const res = await run(`${CURL} -s -i -L --compressed --max-time 20 -A "Mozilla/5.0" ${since} "${SITE_PAGES.rally}"`);
  if (res.exitCode !== 0) return;
  const split = res.stdOut.lastIndexOf('\r\n\r\n', res.stdOut.indexOf('<'));
  const head = res.stdOut.slice(0, split < 0 ? res.stdOut.length : split);
  const status = [...head.matchAll(/^HTTP\/[\d.]+ (\d+)/gm)].pop()?.[1];
  log(`site sync: ${status}`);
  if (status !== '200') return;
  const page = { stdOut: res.stdOut.slice(split + 4) };
  if (!page.stdOut.includes('id="cars"')) return;
  const modified = /^last-modified:\s*(.+?)\s*$/im.exec(head)?.[1] || '';
  const dir = await appCacheDir('site');
  const extra = state.settings.siteExtra ||= [];
  const known = (kind, key, name) => siteManifest.rally[kind]?.[key] || extra.some(x => x.kind === kind && (x.key === key || x.name === name));
  // Stages: known ones by name; stages added later by the save's stage ids
  // ("PortugalS1Arganil..." matches a caption naming Arganil).
  const stageIds = [...(state.settings.rallyStages || []), ...await rallyGameStages(state.paths, state.settings.rallyStages || []).catch(() => [])];
  const groups = [...new Set(stageIds.map(id => rallyStage(id).group).filter(Boolean))];
  const generic = /^(s\d+|full|short\d*|cut\d*|forward|reverse|stage|circuit|test|track\d*)$/;
  const groupOf = name => stageGroupOf(name) || groups.find(g => {
    const gw = new Set(words(g.replace(/(\d)([A-Z])/g, '$1 $2')));
    return words(name).some(w => w.length > 3 && !generic.test(w) && gw.has(w));
  }) || '';
  const jobs = [
    ...rallyStagePhotos(page.stdOut).map(p => ({ kind: 'stages', key: groupOf(p.name), name: p.name, img: p.img })).filter(p => p.key),
    ...siteMaps(page.stdOut).map(p => ({ kind: 'maps', key: groupOf(p.name), name: p.name, img: p.img })).filter(p => p.key),
  ].filter(j => !known(j.kind, j.key, j.name));
  for (const j of jobs) {
    const file = `rally-${j.kind}-${(j.key || j.name).replace(/[^A-Za-z0-9]+/g, '_')}.${j.kind === 'maps' ? 'png' : 'jpg'}`;
    for (const url of (j.kind === 'maps' ? [j.img] : imageSizes(j.img)).map(safeUrl).filter(Boolean)) {
      const r = await run(`${CURL} -s -L -f --max-time 30 -o "${join(dir, file)}" "${url}"`);
      if (r.exitCode === 0) { extra.push({ game: 'rally', kind: j.kind, key: j.key, name: j.name, file }); log(`site sync: ${j.name}`); break; }
    }
  }
  state.settings.siteSyncAt = Date.now();
  if (HTTP_DATE.test(modified)) state.settings.siteModified = modified;
  saveSettings();
  await loadSiteImages();
}

// Country flags (img/flags/<iso>.png, from flagcdn.com) for track cards.
const FLAGS = { Spain: 'es', 'United Kingdom': 'gb', USA: 'us', Hungary: 'hu', Italy: 'it', 'South Africa': 'za', Australia: 'au', Germany: 'de', France: 'fr', Austria: 'at', Belgium: 'be', Japan: 'jp', Netherlands: 'nl', Greece: 'gr', Wales: 'gb-wls' };
// img/flags has every country (flagcdn codes), so any English country name works:
// names come from the browser's own region list, built on first use.
let flagNames = null;
const flagCode = country => {
  if (FLAGS[country]) return FLAGS[country];
  if (!flagNames) {
    flagNames = new Map();
    try {
      const dn = new Intl.DisplayNames(['en'], { type: 'region' });
      for (let a = 65; a < 91; a++) for (let b = 65; b < 91; b++) {
        const code = String.fromCharCode(a, b), name = dn.of(code);
        if (name && name !== code) flagNames.set(name.toLowerCase(), code.toLowerCase());
      }
    } catch { /* no region names: only FLAGS */ }
  }
  return flagNames.get(String(country || '').toLowerCase()) || '';
};
const flagUrl = country => { const code = flagCode(country); return code ? `/img/flags/${code}.png` : ''; };
// A country's name in the launcher's language (the system's own region names), else as given.
const countryName = country => {
  const code = flagCode(country);
  if (!code || code.includes('-')) return tr(country || '');
  try { return new Intl.DisplayNames([lang], { type: 'region' }).of(code.toUpperCase()) || country; } catch { return country; }
};

const brandKey = b => String(b).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/-?(amg|benz)$/, '').replace(/[^a-z0-9]/g, '');
const BUNDLED_LOGOS = ['astonmartin', 'bentley', 'citroen', 'fiat', 'ginetta', 'jaguar', 'lexus', 'skoda', 'subaru'];

async function loadBrandLogos(logos) {
  try {
    const evo = gameByKey('evo'), ac = gameByKey('ac');
    const [evoCars, acCars] = await Promise.all([
      isInstalled(evo) ? getItems(evo, 'cars').catch(() => []) : [],
      isInstalled(ac) ? getItems(ac, 'cars').catch(() => []) : [],
    ]);
    for (const c of acCars) if (c.brand && c.badge && !logos.has(brandKey(c.brand))) logos.set(brandKey(c.brand), c.badge);
    if (isInstalled(evo) && state.paths.evo.install) {
      const brands = [...new Set(evoCars.map(c => c.brand).filter(Boolean))];
      const x = await readEvoExtras({ brands, contentPkg: `${state.paths.evo.install}/content.kspkg` }, await evoCacheDir()).catch(() => null);
      for (const b of brands) { const f = x?.brands[x.brandSlug(b)]; if (f) logos.set(brandKey(b), fileUrl(f)); }
    }
  } catch (err) { log(`brand logos: ${err?.message || err}`); }
  for (const k of BUNDLED_LOGOS) if (!logos.has(k)) logos.set(k, `/img/brands/${k}.png`);
  return logos;
}

// ---------------------------------------------------------------------------
// Quick drive (ACC): ACC can't be started on track from outside, so this sets
// up its Single Player menu (championship, mode, car, track, sessions,
// opponents, time, weather) in menuSettings.json and starts the game; the
// player then only presses Start (see acclaunch.js).

async function openAccQuickDrive() {
  let fromGame;
  try { fromGame = await readAccSession(state.paths); } catch (err) { toast(err.message, true); return; }
  // Cars of DLCs this Steam account doesn't own are left out (custom cars too).
  const owned = await accOwnedDlcs(state.steamPath, state.paths.acc.install);
  const customs = (await accCustomCars(state.paths).catch(err => { log(`acc cars: ${err?.message}`); return []; })).filter(c => accModelOwned(c.model, owned));
  state.settings.qdGame = 'acc';
  const saved = state.settings.accQD || {};
  const ss = mergeSettings(fromGame.session, saved.session);
  // Seasons, cars and tracks of DLCs this account doesn't own are left out.
  const ownedSeasons = fromGame.seasons.filter(id => accSeasonOwned(id, owned));
  const seasons = ownedSeasons.length ? ownedSeasons : [ss.season];
  if (!seasons.includes(ss.season)) ss.season = seasons[0];
  const racing = () => ss.mode === 'QuickRace' || ss.mode === 'CustomRace';
  const weatherName = () => tr(ACC_WEATHER.find(([id]) => id === ss.weather)?.[1] || ss.weather);
  const hour = h => `${String(h).padStart(2, '0')}:00`;
  const brandOf = model => { const n = ACC_CARS[model] || ''; return /^Aston Martin/.test(n) ? 'Aston Martin' : /Jaguar/.test(n) ? 'Jaguar' : n.split(' ')[0]; };

  // ACC's own car and track pictures are inside its encrypted package, so car
  // models show their brand logo (EVO's logos, AC's badges) and tracks initials.
  const placeholder = title => `<div class="placeholder">${esc(initials(title))}</div>`;
  const logos = new Map();
  const logoFlag = (brand, title) => logos.get(brandKey(brand)) ? `<img class="main contain" src="${esc(logos.get(brandKey(brand)))}" alt="">` : placeholder(title);
  const gameCar = fromGame.car && !/\.json$/i.test(fromGame.car) ? fromGame.car : '';
  // Car files the launcher made for a model show as that model.
  const madeByLauncher = file => /^Launcher - .*\.json$/i.test(file);
  const keyFor = k => { const c = madeByLauncher(k || '') && customs.find(x => x.file === k); return c ? `model:${c.model}` : k; };
  const models = Object.entries(ACC_CARS).map(([id, name]) => ({ id: Number(id), name })).filter(m => accModelOwned(m.id, owned)).sort((a, b) => a.name.localeCompare(b.name));
  const carEntries = () => [
    { key: '', title: tr('Car chosen in ACC'), sub: gameCar ? tr('Official entry {car}', { car: gameCar }) : tr("Keeps the car of ACC's menu"), brand: '', image: '', summaryTitle: tr("ACC's current car"), flag: placeholder('ACC') },
    ...customs.filter(c => !madeByLauncher(c.file)).map(c => ({
      key: c.file, title: c.team || c.file.replace(/\.json$/i, ''), brand: brandOf(c.model), image: siteImage('acc', 'cars', String(c.model)) || c.image,
      sub: [ACC_CARS[c.model] || tr('Car model #{n}', { n: c.model }), c.number != null && `#${c.number}`].filter(Boolean).join(' · '),
      flag: c.image || siteImage('acc', 'cars', String(c.model)) ? `<span class="flag">${tr('Custom')}</span>` : logoFlag(brandOf(c.model), c.team || c.file),
    })).sort((a, b) => a.title.localeCompare(b.title)),
    ...models.map(m => {
      const image = siteImage('acc', 'cars', String(m.id));
      return { key: `model:${m.id}`, title: m.name, sub: `${accModelClass(m.id)} · ${tr('plain paint')}`, brand: brandOf(m.id), image, flag: image ? '' : logoFlag(brandOf(m.id), m.name) };
    }),
  ];
  const cars = carEntries();
  // Track pictures from the official site, with the country's flag in the corner.
  const tracks = ACC_TRACKS.filter(t => accTrackOwned(t.id, owned)).map(t => {
    const photo = siteImage('acc', 'tracks', t.id), flag = flagUrl(t.country);
    return { key: t.id, title: t.name, sub: countryName(t.country), image: photo || flag, layouts: [],
      flag: photo && flag ? `<img class="flag-badge" src="${esc(flag)}" alt="">` : photo || flag ? '' : placeholder(t.name) };
  });

  const session = {
    summary: () => {
      const cond = `${hour(ss.time)} · ${weatherName()}`;
      const ai = racing() ? ` · ${tr('{n} AI', { n: ss.opponents })}` : '';
      const len = { Practice: minutes(ss.practice), Hotlap: '', Hotstint: tr('{n} min stint', { n: ss.stint }), QuickRace: minutes(ss.race),
        CustomRace: [ss.practice && `P ${ss.practice}'`, `Q ${ss.qualifying}'`, `R ${ss.race}'`].filter(Boolean).join(' · ') }[ss.mode];
      return { title: tr(ACC_MODES[ss.mode]), sub: [len, accSeasonName(ss.season)].filter(Boolean).join(' · ') + ai + ` · ${cond}` };
    },
    get: () => ss,
    set: d => { mergeSettings(ss, d); if (!seasons.includes(ss.season)) ss.season = seasons[0]; },
    sheetNote: tr("Set in ACC's Single Player menu: ACC opens with these choices and you press Start."),
    sections: () => [
      { title: tr('Game mode'), wide: true, fields: [
        { label: tr('Championship'), hint: tr('Season of the Single Player menu; it decides the official cars and teams. A car from another year or class may need Free selection'), type: 'select', options: seasons.map(id => [id, accSeasonName(id)]), get: () => ss.season, set: v => { ss.season = v; } },
        { label: tr('Mode'), type: 'seg', options: Object.entries(ACC_MODES), get: () => ss.mode, set: v => { ss.mode = v; } },
      ] },
      ...(ss.mode === 'Practice' ? [{ title: tr('Practice'), fields: [
        { label: tr('Length'), type: 'select', options: minuteOptions(ss.practice, 5, 120, 5), get: () => ss.practice, set: v => { ss.practice = v; } },
      ] }] : []),
      ...(ss.mode === 'Hotlap' ? [{ title: tr('Hotlap'), note: tr('Hotlap runs until you leave; only time and weather apply.'), fields: [] }] : []),
      ...(ss.mode === 'Hotstint' ? [{ title: tr('Hotstint'), fields: [
        { label: tr('Stint length'), type: 'select', options: minuteOptions(ss.stint, 5, 60, 5), get: () => ss.stint, set: v => { ss.stint = v; } },
      ] }] : []),
      ...(ss.mode === 'QuickRace' ? [{ title: tr('Race'), fields: [
        { label: tr('Race length'), type: 'select', options: minuteOptions(ss.race, 5, 120, 5), get: () => ss.race, set: v => { ss.race = v; } },
      ] }] : []),
      ...(ss.mode === 'CustomRace' ? [{ title: tr('Race weekend'), fields: [
        { label: tr('Practice'), type: 'select', options: minuteOptions(ss.practice, 0, 120, 5, tr('Skip')), get: () => ss.practice, set: v => { ss.practice = v; } },
        { label: tr('Qualifying'), type: 'select', options: minuteOptions(ss.qualifying, 5, 60, 5), get: () => ss.qualifying, set: v => { ss.qualifying = v; } },
        { label: tr('Race'), type: 'select', options: minuteOptions(ss.race, 5, 180, 5), get: () => ss.race, set: v => { ss.race = v; } },
      ] }] : []),
      ...(racing() ? [{ title: tr('Opponents'), fields: [
        { label: tr('Opponents'), hint: tr("ACC caps it at the track's pit boxes"), type: 'select', options: countOptions(ss.opponents, 1, 49), get: () => ss.opponents, set: v => { ss.opponents = v; } },
        { label: tr('Starting position'), type: 'select', get: () => (ss.startPos = Math.min(ss.startPos, ss.opponents + 1)), set: v => { ss.startPos = v; },
          options: steps(1, ss.opponents + 1, 1).map(n => [n, `P${n}`]) },
        { label: tr('Skill'), type: 'select', options: withCurrent(steps(50, 100, 1).map(n => [n, `${n}%`]), ss.skill, n => `${n}%`), get: () => ss.skill, set: v => { ss.skill = v; } },
        { label: tr('Aggression'), type: 'select', options: withCurrent(steps(0, 100, 5).map(n => [n, `${n}%`]), ss.aggro, n => `${n}%`), get: () => ss.aggro, set: v => { ss.aggro = v; } },
      ] }] : []),
      { title: tr('Conditions'), fields: [
        { label: tr('Time of day'), type: 'select', options: withCurrent(steps(0, 23, 1).map(h => [h, hour(h)]), ss.time, hour), get: () => ss.time, set: v => { ss.time = v; } },
        { label: tr('Time speed'), type: 'select', options: withCurrent(ACC_TIME_SPEEDS.map(x => [x, `${x}×`]), ss.speed, x => `${x}×`), get: () => ss.speed, set: v => { ss.speed = v; } },
        { label: tr('Weather'), type: 'select', options: ACC_WEATHER, get: () => ss.weather, set: v => { ss.weather = v; } },
      ] },
    ],
    onChange: () => { state.settings.accQD = { ...(state.settings.accQD || {}), session: ss }; saveSettings(); },
  };

  const pickCar = [saved.car, keyFor(fromGame.car)].find(k => k != null && cars.some(c => c.key === k)) ?? '';
  const pickTrack = [saved.track, fromGame.track].find(k => tracks.some(t => t.key === k)) || tracks[0].key;
  const ui = quickDriveModal({
    game: 'acc',
    sub: tr("ACC can't be started straight on track, so this sets up its Single Player menu and starts the game: just press Start there."),
    session,
    launchLabel: tr('Set up & start ACC'),
    carCount: tr('{models} models · {custom} custom', { models: models.length, custom: customs.filter(c => !madeByLauncher(c.file)).length }),
    trackCount: trn(tracks.length, '1 track', '{n} tracks'),
    cars,
    brandLogo: name => logos.get(brandKey(name)) || '',
    variantLabel: '',
    variants: () => [],
    defaultVariant: () => '',
    tracks,
    sel: { car: pickCar, variant: '', track: pickTrack, layout: '' },
    onClose: s => { state.settings.accQD = { car: s.car, track: s.track, session: ss }; saveSettings(); },
    onLaunch: async s => {
      try {
        // A car model gets a plain custom car file the first time it is driven.
        const model = /^model:(\d+)$/.exec(s.car);
        const car = model ? await ensureModelCar(state.paths, Number(model[1]), ACC_CARS[model[1]]) : s.car;
        await writeAccSession(state.paths, { session: ss, car, track: s.track });
        await openExternal(steamUrls.run(gameByKey('acc').appid));
        toast(tr('Starting ACC: {mode} at {track} is set up in Single Player.', { mode: tr(ACC_MODES[ss.mode]), track: tracks.find(t => t.key === s.track)?.title }));
      } catch (err) {
        toast(err.message || tr('Could not set up ACC'), true);
        return false;
      }
    },
  });

  // Background: brand logos.
  loadBrandLogos(logos).then(() => { if (ui.el.isConnected) ui.setCars(carEntries()); });
}

// ---------------------------------------------------------------------------
// Quick drive (Rally): Rally can't be started on a stage from outside, so this
// pre-selects its Free Practice menu (stage, car, start time) in the player's
// save and starts the game: Free Practice then opens on that selection. Stages
// are those Rally's save has mentioned, remembered by the launcher (see rallylaunch.js).

async function openRallyQuickDrive() {
  const g = gameByKey('rally');
  // A save the launcher can't read (none yet, never in Free Practice, or another
  // layout) still opens Quick Drive: Rally then starts without the stage and car set.
  let fromGame;
  try { fromGame = await readRallySave(state.paths); } catch (err) {
    log(`rally save: ${err?.message}`);
    fromGame = { stage: '', car: '', seconds: 36000, weather: null, stages: [], problem: 'layout' };
  }
  const SAVE_PROBLEMS = {
    missing: N_("Rally hasn't saved a Free Practice selection yet, so it starts on its own menu: pick the stage and car in Free Practice. Drive one stage there once and the launcher sets it up from then on."),
    empty: N_("Rally hasn't saved a Free Practice selection yet, so it starts on its own menu: pick the stage and car in Free Practice. Drive one stage there once and the launcher sets it up from then on."),
    layout: N_("Rally's save is laid out differently than the launcher knows, so it can't pre-select the stage and car: pick them in Free Practice. The rest (car in the main menu, livery, Weather & Time) is still set where the save allows."),
  };
  const saveProblem = fromGame.problem ? tr(SAVE_PROBLEMS[fromGame.problem] || SAVE_PROBLEMS.layout) : '';
  state.settings.qdGame = 'rally';
  const saved = state.settings.rallyQD || {};
  const remembered = [...new Set([...RALLY_KNOWN_STAGES, ...(state.settings.rallyStages || []), ...fromGame.stages, fromGame.stage].filter(Boolean))].sort();
  state.settings.rallyStages = remembered;
  saveSettings();
  // Plus every stage in the game's files (rallyfiles.js): ones an update added show
  // up before they're driven. Those get "New" for a while (markFresh).
  const fileStages = await rallyGameStages(state.paths, remembered).catch(err => { log(`rally stages: ${err?.message}`); return []; });
  const seen = [...new Set([...remembered, ...fileStages])].sort();
  const stageMarks = fileStages.map(id => ({ id }));
  await markFresh('rally_stages', stageMarks);
  const newStages = new Set(stageMarks.filter(x => x.isNew).map(x => x.id));
  const tagNew = (after = false) => `<span class="flag tag-new${after ? ' after-icon' : ''}">${tr('New')}</span>`;
  // Start time and Weather & Time settings: Rally's own (from the save), unless
  // they were changed here since and Rally still has what it had then.
  const weatherKey = w => w && JSON.stringify({ ...w, seconds: undefined });
  let minutes = Math.round((saved.minutes !== undefined && saved.minutesBase === fromGame.seconds ? saved.minutes : fromGame.seconds / 60) / 15) * 15 % (24 * 60);
  let weather = fromGame.weather && (saved.weather && saved.weatherBase === weatherKey(fromGame.weather) ? { ...fromGame.weather, ...saved.weather } : { ...fromGame.weather });
  // The Personal setup you'll drive (Rally can't be given one: the player loads it in
  // Car Setup). Noted per car, so the stage times set with it go to its times.
  const carSetups = await getItems(g, 'setups').catch(() => []);
  const setupsOf = car => carSetups.find(i => i.carId.toLowerCase() === String(car || '').toLowerCase())?.setups || [];
  const setupPick = { ...(saved.setups || {}) };
  const pickedSetup = car => setupsOf(car).find(x => x.name === setupPick[car]);
  const rememberSession = () => {
    state.settings.rallyQD = { ...(state.settings.rallyQD || {}), minutes, minutesBase: fromGame.seconds, weather, weatherBase: weatherKey(fromGame.weather), setups: setupPick };
  };

  const placeholder = title => `<div class="placeholder">${esc(initials(title))}</div>`;
  const logos = new Map();
  const brandOf = id => { const n = rallyCarName(id); return /^Alfa Romeo/.test(n) ? 'Alfa Romeo' : n.split(' ')[0]; };
  const logoFlag = (brand, title) => logos.get(brandKey(brand)) ? `<img class="main contain" src="${esc(logos.get(brandKey(brand)))}" alt="">` : placeholder(title);
  const carIds = await rallyCarIds(state.paths).catch(() => Object.keys(RALLY_CARS));
  const carMarks = carIds.map(id => ({ id }));
  await markFresh('rally_cars', carMarks);
  const newCars = new Set(carMarks.filter(x => x.isNew).map(x => x.id));
  const carEntries = () => carIds.map(id => {
    const image = rallyCarImage(id);
    return { key: id, title: rallyCarName(id), sub: brandOf(id), brand: brandOf(id), image, flag: (newCars.has(id) ? tagNew() : '') + (image ? '' : logoFlag(brandOf(id), rallyCarName(id))) };
  });
  const cars = carEntries();

  // Liveries: the car's own one (or the .pak livery that replaces it), the ones
  // in Documents\My Games\acr\Liveries ("usergen_<folder>"), and other liveries
  // the save has had selected (the game's alternative ones; their ids are learned).
  const [modLiveries, selectedLiveries] = await Promise.all([
    getItems(g, 'liveries').catch(() => []), rallySelectedLiveries(state.paths).catch(() => ({})),
  ]);
  const learned = state.settings.rallyLiveryIds ||= {};
  for (const [car, id] of Object.entries(selectedLiveries)) {
    if (id !== car && !id.startsWith('usergen_') && !(learned[car] ||= []).includes(id)) learned[car].push(id);
  }
  const liveryVariants = id => {
    const pak = modLiveries.find(i => i.toggle === 'rally' && i.enabled && !i.incompatible && i.subtitle?.startsWith(`${rallyCarName(id)} ·`));
    return [
      { key: id, title: pak ? pak.title : tr('Default livery'), sub: pak ? tr('.pak livery') : tr('Game livery'), image: pak?.image || rallyCarImage(id) },
      ...(learned[id] || []).map(l => ({ key: l, title: prettifyId(l.replace(new RegExp(`^${id}_?`), '')) || l, sub: tr('Game livery'), image: rallyCarImage(id) })),
      ...withPlates(modLiveries.filter(i => i.toggle === 'rally-folder' && i.enabled && i.meta.car === id)),
    ];
  };
  // Your liveries. A livery shipped twice, with and without the rally plates (the
  // same look, games.js rallyLiveryLook), is one tile with both versions: the
  // Plates menu picks which (Quick Drive's specs), with rally plates first.
  const withPlates = items => {
    const byLook = new Map();
    for (const i of items) if (i.meta.look && typeof i.meta.stickers === 'boolean') byLook.set(i.meta.look, [...(byLook.get(i.meta.look) || []), i]);
    const paired = new Map();
    for (const twins of byLook.values()) {
      if (twins.length !== 2 || twins[0].meta.stickers === twins[1].meta.stickers) continue;
      // The tile's name: the words both folder names start with ("Polo R5 Red Bull"
      // from "... Rally Plates" and "... No Rally Plates").
      const [a, b] = twins.map(i => i.title.split(/\s+/));
      let n = 0;
      while (n < a.length && n < b.length && a[n].toLowerCase() === b[n].toLowerCase()) n++;
      const title = a.slice(0, n).join(' ').replace(/[\s\-_(·]+$/, '') || twins[0].title;
      twins.sort((x, y) => Number(y.meta.stickers) - Number(x.meta.stickers));
      for (const i of twins) paired.set(i, { livery: `plates:${twins[0].meta.name}`, title, spec: i.meta.stickers ? 'plates' : 'no-plates', specLabel: i.meta.stickers ? tr('With rally plates') : tr('Without rally plates') });
    }
    const out = [];
    for (const i of items) {
      const p = paired.get(i);
      if (p && out.some(v => v.livery === p.livery)) continue; // added with its twin
      const twins = p ? items.filter(x => paired.get(x)?.livery === p.livery).sort((x, y) => Number(y.meta.stickers) - Number(x.meta.stickers)) : [i];
      for (const x of twins) out.push({ key: `usergen_${x.meta.name}`, title: x.title, sub: tr('Your livery'), image: x.image, ...paired.get(x) });
    }
    return out;
  };
  const liveryOf = id => {
    const v = liveryVariants(id), want = saved.liveries?.[id] || selectedLiveries[id];
    return v.some(x => x.key === want) ? want : v[0].key;
  };

  // Locations are the tracks, the stages driven there their layouts.
  const byLocation = new Map();
  for (const id of seen) {
    const st = rallyStage(id);
    // Stage pictures from the official site; locations show their first stage's
    // (or a photo of the place) with the flag in the corner (Wales: the Welsh flag).
    const stageImage = siteImage('rally', 'stages', st.group), map = siteImage('rally', 'maps', st.group);
    if (!byLocation.has(st.location)) {
      const flag = flagUrl(st.locationName === 'Wales' ? 'Wales' : st.country);
      byLocation.set(st.location, { key: st.location, title: st.locationName, sub: countryName(st.country), image: '', layouts: [], flagUrl: flag });
    }
    const loc = byLocation.get(st.location);
    if (!loc.image && stageImage) loc.image = stageImage;
    // The name Rally shows on top; the stage, its length and direction under it.
    const sub = [st.name && st.stage, tr(st.length), tr(st.direction || ''), newStages.has(id) && tr('New')];
    // The game's own map of this stage (white, the part driven in red) where the data
    // has one, else the site's outline of the whole stage.
    const media = rallyStageMedia(id);
    loc.layouts.push({
      key: id, name: st.name || [st.stage, tr(st.length)].filter(Boolean).join(' · '), sub: (st.name ? sub : sub.slice(2)).filter(Boolean).join(' · '), preview: stageImage,
      outline: media.chip || media.map || map, outlineColor: !!media.map, outlineFallback: media.chipRemote || media.mapRemote,
    });
  }
  const tracks = [...byLocation.values()].sort((a, b) => a.title.localeCompare(b.title));
  for (const t of tracks) {
    t.image ||= rallyCover(t.key);
    t.flag = t.image && t.flagUrl ? `<img class="flag-badge" src="${esc(t.flagUrl)}" alt="">` : t.image ? '' : t.flagUrl ? '' : placeholder(t.title);
    if (t.layouts.some(l => newStages.has(l.key))) t.flag += tagNew(!!(t.image && t.flagUrl));
    t.image ||= t.flagUrl;
    t.sub = `${t.sub ? `${t.sub} · ` : ''}${trn(t.layouts.length, '1 stage', '{n} stages')}`;
    t.layouts.sort((a, b) => a.name.localeCompare(b.name) || a.sub.localeCompare(b.sub));
  }
  const trackOf = stage => tracks.find(t => t.layouts.some(l => l.key === stage));

  // Free Practice's Weather & Time settings, laid out as Rally's screen. The
  // weather rows show the game's icon for the chosen weather; the weathers on
  // offer are the ones the stage's location has (no snow in Greece).
  const svg = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const ICONS = {
    speed: svg('<path d="M13 19l9-7-9-7v14zM2 19l9-7-9-7v14z"/>'),
    dynamic: svg('<path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M8 16H3v5"/>'),
    random: svg('<path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22M18 2l4 4-4 4M2 6h1.9c1.5 0 2.9.9 3.6 2.2M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8M18 14l4 4-4 4"/>'),
    probability: svg('<path d="M19 5L5 19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>'),
    persistence: svg('<path d="M5 22h14M5 2h14M17 22v-4.2a2 2 0 0 0-.6-1.4L12 12l-4.4 4.4a2 2 0 0 0-.6 1.4V22M7 2v4.2a2 2 0 0 0 .6 1.4L12 12l4.4-4.4a2 2 0 0 0 .6-1.4V2"/>'),
    wetness: svg('<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/>'),
    snow: svg('<path d="M12 2v20M4.9 7l14.2 10M4.9 17L19.1 7M9 4l3 2 3-2M9 20l3-2 3 2"/>'),
    grip: svg('<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>'),
  };
  const locationOf = s => (s?.layout ? rallyStage(s.layout).location : '');
  // The weather Rally will start with on that stage (another one when the location doesn't have it).
  const startWeather = s => rallyWeatherFor(locationOf(s), weather.weather);
  const weatherOptions = (s, random) => [...(random ? [[-1, N_('Random')]] : []), ...rallyLocationWeathers(locationOf(s)).map(v => [v, RALLY_WEATHERS[v].label])];
  const session = {
    summary: s => ({ title: tr('Free Practice'), sub: [tr('Starts at {time}', { time: hhmm(minutes) }), weather && tr(RALLY_WEATHERS[startWeather(s)].label), pickedSetup(s.car)?.name].filter(Boolean).join(' · ') }),
    get: () => ({ minutes, weather }),
    set: d => { if (Number.isFinite(d?.minutes)) minutes = d.minutes; if (weather && d?.weather) weather = { ...weather, ...d.weather }; },
    sheetNote: saveProblem || tr("Set in Rally's Free Practice menu: Rally opens it on this stage and car."),
    sections: s => {
      const time = { title: N_('Event Start Time'), fields: [
        { label: N_('Event start time'), icon: '/img/rally/weather/clock.png', type: 'select', options: timeOptions(minutes), get: () => minutes, set: v => { minutes = v; } },
      ] };
      const mine = setupsOf(s.car);
      const setup = { title: N_('Car Setup'), note: mine.length
        ? N_("Rally can't be given a setup: load it in Car Setup › Save/Load Setup. Picking it here notes the stage bests you set with it (Mods › Setups).")
        : N_("No Personal setups for this car yet: save one in Rally's Car Setup menu, and pick it here to note the stage bests you set with it."),
      fields: mine.length ? [{ label: N_("Setup you'll drive"), type: 'select', options: [['', N_('Not noted')], ...mine.map(x => [x.name, x.name])], get: () => pickedSetup(s.car)?.name || '', set: v => { setupPick[s.car] = v; } }] : [] };
      if (!weather) return [{ ...time, note: N_("Rally's save doesn't have its Weather & Time settings where the launcher expects them, so pick them in Free Practice's Weather & Time screen.") }, setup];
      const w = weather, start = startWeather(s), forecast = w.forecast === -1 ? -1 : rallyWeatherFor(locationOf(s), w.forecast);
      time.fields.push({ label: N_('Time acceleration'), icon: ICONS.speed, type: 'select', options: RALLY_TIME_SPEEDS.map((l, i) => [i, l]), get: () => w.speed, set: v => { w.speed = v; } });
      return [setup, time, {
        title: N_('Weather Forecast'),
        note: start !== w.weather ? tr('{weather} isn\'t possible in {location}: Rally starts with {other} there.', { weather: tr(RALLY_WEATHERS[w.weather].label), location: rallyStage(s.layout).locationName, other: tr(RALLY_WEATHERS[start].label) }) : '',
        fields: [
          { label: N_('Starting weather'), icon: () => RALLY_WEATHERS[start].icon, type: 'select', options: weatherOptions(s, false), get: () => start, set: v => { w.weather = v; } },
          { label: N_('Dynamic weather'), hint: N_('The weather changes over time'), icon: ICONS.dynamic, type: 'seg', options: [[false, N_('Off')], [true, N_('On')]], get: () => w.dynamic, set: v => { w.dynamic = v; } },
          // Like Rally's screen: the forecast settings only apply (and change) with dynamic weather on.
          { label: N_('Weather forecast'), disabled: !w.dynamic, icon: () => (forecast === -1 ? ICONS.random : RALLY_WEATHERS[forecast].icon), type: 'select', options: weatherOptions(s, true), get: () => forecast, set: v => { w.forecast = v; } },
          { label: N_('Forecast probability'), disabled: !w.dynamic, hint: N_('How likely the forecast is to happen'), icon: ICONS.probability, type: 'seg', options: RALLY_FORECAST_PROBABILITY.map((l, i) => [i, l]), get: () => w.probability, set: v => { w.probability = v; } },
          { label: N_('Weather persistence'), disabled: !w.dynamic, hint: N_('How long a weather lasts'), icon: ICONS.persistence, type: 'seg', options: RALLY_PERSISTENCE.map((l, i) => [i, l]), get: () => w.persistence, set: v => { w.persistence = v; } },
        ],
      }, {
        title: N_('Track Condition'), fields: [
          { label: N_('Starting road wetness'), icon: ICONS.wetness, type: 'range', min: 0, max: 100, get: () => w.wetness, set: v => { w.wetness = v; } },
          { label: N_('Starting snow level'), icon: ICONS.snow, type: 'range', min: 0, max: 100, get: () => w.snow, set: v => { w.snow = v; } },
          { label: N_('Starting grip level'), icon: ICONS.grip, type: 'seg', options: RALLY_GRIP.map((l, i) => [i, l]), get: () => w.grip, set: v => { w.grip = v; } },
        ],
      }];
    },
    onChange: () => { rememberSession(); saveSettings(); },
  };

  const pickStage = [saved.stage, fromGame.stage].find(k => k && trackOf(k)) || tracks[0]?.layouts[0]?.key || '';
  const pickCar = [saved.car, fromGame.car].find(k => k && cars.some(c => c.key === k)) || cars[0].key;
  let bests = new Map();
  const ui = quickDriveModal({
    game: 'rally',
    sub: saveProblem || tr("Rally can't be started straight on a stage, so this sets up its Free Practice menu (stage, car, livery, start time) and the main menu car, then starts the game: open Free Practice and press Start."),
    session,
    launchLabel: tr('Set up & start Rally'),
    specName: N_('Plates'),
    carCount: trn(cars.length, '1 car', '{n} cars'),
    trackCount: `${trn(tracks.length, '1 location', '{n} locations')} · ${trn(seen.length, '1 stage', '{n} stages')}`,
    cars,
    brandLogo: name => logos.get(brandKey(name)) || '',
    variantLabel: N_('Livery'),
    variants: liveryVariants,
    keepCarImage: true,
    variantHint: () => tr("Custom liveries only apply to cars you've driven or selected in Rally at least once. Until then, the game starts with the default livery."),
    defaultVariant: liveryOf,
    tracks,
    sel: { car: pickCar, variant: liveryOf(pickCar), track: trackOf(pickStage)?.key || '', layout: pickStage },
    onClose: s => {
      rememberSession();
      Object.assign(state.settings.rallyQD, { car: s.car, stage: s.layout, liveries: { ...(saved.liveries || {}), [s.car]: s.variant }, setups: setupPick });
      saveSettings();
    },
    onLaunch: async s => {
      try {
        if (!s.layout) throw new Error(tr('Drive a stage in Rally first: it shows up here afterwards.'));
        // The crash check may replace this dialog; nothing is written if it's cancelled.
        if (!(await rallyPreflight(g))) return false;
        // The weathers as Rally will have them on this stage (one the location doesn't have is swapped).
        const written = weather && { ...weather, weather: startWeather(s), forecast: weather.forecast === -1 ? -1 : rallyWeatherFor(locationOf(s), weather.forecast) };
        const { selected } = await writeRallySession(state.paths, { stage: s.layout, car: s.car, seconds: minutes * 60, livery: s.variant || s.car, weather: written });
        // With a setup noted: the stage records as they are now, to see later which are new.
        const pick = pickedSetup(s.car);
        if (pick) {
          const now = await rallyBests(state.paths).catch(() => new Map());
          nextLaunch.rally = { car: s.car, setup: { name: pick.name, sig: setupSig(pick.values) }, before: Object.fromEntries([...now].map(([k, v]) => [k, v.ms])) };
        }
        await openExternal(steamUrls.run(g.appid));
        const st = rallyStage(s.layout);
        const what = { stage: `${st.locationName}, ${st.name || st.stage}`, car: rallyCarName(s.car) };
        toast(selected ? tr('Starting Rally: Free Practice is set to {stage}, {car}.', what) : tr('Starting Rally: pick {stage} and the {car} in Free Practice.', what));
      } catch (err) {
        toast(err.message || tr('Could not set up Rally'), true);
        return false;
      }
    },
    // Best stage times from the save's stage records.
    best: s => bests.get(`${s.layout}|${s.car}`),
    bests: () => [...bests].flatMap(([k, v]) => {
      const [stage, car] = k.split('|'), t = trackOf(stage);
      return t ? [{ sel: { car, track: t.key, layout: stage }, ...v }] : [];
    }),
  });
  rallyBests(state.paths).then(m => { bests = m; if (ui.el.isConnected) ui.sync(); }).catch(err => log(`rally bests: ${err?.message}`));
  loadBrandLogos(logos).then(() => { if (ui.el.isConnected) ui.setCars(carEntries()); });
}

// ---------------------------------------------------------------------------
// Quick drive (EVO): pre-set the game mode with its sessions, AI grid and
// weather, the track/layout and the player car + livery, then start EVO. Cars
// and liveries are the configurations EVO has an ID for: every stock one, plus
// customised ones it has used (see evolaunch.js); their thumbnails and names
// come from the game package (readEvoExtras). The selection is remembered even
// when the dialog is closed without launching.

async function openEvoQuickDrive({ car, track } = {}) {
  const g = gameByKey('evo');
  const cacheDir = await evoCacheDir().catch(() => '');
  const contentPkg = state.paths.evo.install ? `${state.paths.evo.install}/content.kspkg` : '';
  const [cars, tracks, driven, fromGame, external, presets] = await Promise.all([
    getItems(g, 'cars'), getItems(g, 'tracks'),
    knownCars(cacheDir).catch(err => { log(`known cars: ${err?.message}`); return []; }),
    readEvoSession().catch(err => { log(`evo session: ${err?.message}`); return defaultEvoSession(); }),
    getItems(g, 'liveries').catch(() => []),
    contentPkg ? readCarPresets(contentPkg, cacheDir).catch(err => { log(`car presets: ${err?.message}`); return []; }) : [],
  ]);
  // Mod cars bring their presets in their own package.
  const modPkgs = [...new Set(cars.filter(c => c.isMod && c.carId && c.path).map(c => c.path))];
  const modPresets = (await Promise.all(modPkgs.map(p => readCarPresets(p, cacheDir).catch(err => { log(`car presets ${p}: ${err?.message}`); return []; })))).flat();
  const known = await withAllConfigs(driven, [...presets, ...modPresets]).catch(err => { log(`evo configs: ${err?.message}`); return driven; });
  const official = tracks.filter(t => t.evoTrack);
  if (!official.some(t => t.layouts.some(l => l.practice || l.race))) { toast(tr('No EVO tracks found. Check the EVO folder in Settings.'), true); return; }
  state.settings.qdGame = 'evo';

  // Session settings: the launcher's last choice, else what EVO currently has.
  const saved = state.settings.evoQD || {};
  const ss = mergeSettings(fromGame, saved.session);
  if (!saved.session && EVO_MODES[saved.mode]) { // older launcher versions saved only mode + weather
    ss.mode = saved.mode;
    if (EVO_WEATHER.some(w => w.id === saved.weather)) ss.weather.type = saved.weather;
  }
  const container = () => EVO_MODES[ss.mode].container;

  // Every car is listed; the ones driven come first, most recent on top, then the rest A-Z.
  const knownBy = new Map(known.map(k => [k.carId, k]));
  const rank = c => { const k = knownBy.get(c.carId); return k?.seen ? known.indexOf(k) : Infinity; };
  const carList = cars.filter(c => c.carId).sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title));
  const noId = carList.filter(c => !knownBy.has(c.carId));
  if (noId.length) log(`evo cars without an id yet: ${noId.map(c => `${c.carId}${c.isMod ? ' (mod)' : ''}`).join(', ')}`);
  const current = known.find(k => k.current);
  const currentConfig = current?.configs.find(c => c.current);
  const currentItem = current && carList.find(c => c.carId === current.carId);
  const pkgOf = c => c?.isMod ? c.path : contentPkg;
  const km = c => (c.length ? `${(c.length / 1000).toFixed(2)} km` : ''); // mod tracks don't say

  // Thumbnails/names of known liveries and the brand logos load in the background.
  let extras = { liveries: {}, brands: {}, liveryKey: () => '', brandSlug: () => '' };
  // Visual preset 99 is the slot EVO uses for an external (modded) livery; the
  // package only has a plain white car for it, so show the livery from
  // ExternalLiveries instead (Mods > Liveries; EVO records no link from a session
  // car to one livery, so a car with several shows the first).
  const externalBy = new Map();
  for (const l of external) if (l.meta?.carId && !externalBy.has(l.meta.carId)) externalBy.set(l.meta.carId, l);
  const thumb = (carId, cfg) => {
    if (!cfg?.visual) return null;
    const ext = /_visual_99$/i.test(cfg.visual) && externalBy.get(carId);
    if (ext) return { label: ext.title, mech: tr('Modded livery'), image: ext.image };
    const x = extras.liveries[extras.liveryKey({ carId, mech: cfg.mech, visual: cfg.visual })];
    return x && { ...x, image: x.image ? fileUrl(x.image) : '' };
  };
  // Pictures are decoded from the game package, so a car's other liveries load
  // when it's picked rather than all 250 at once; loads run one after another.
  const liveriesOf = carId => {
    const item = carList.find(c => c.carId === carId);
    return item ? (knownBy.get(carId)?.configs || []).filter(c => c.visual).map(c => ({ carId, mech: c.mech, visual: c.visual, pkgPath: pkgOf(item) })) : [];
  };
  let extrasQueue = Promise.resolve();
  const extrasAsked = new Set();
  // A picked car's liveries (rowOnly) update just the livery row, the summary and
  // the selected card's picture; the car grid is redrawn only when the background
  // load brings something new (a redraw reloads every card's picture).
  const loadExtras = (liveries, brands = [], { rowOnly = false } = {}) => {
    extrasQueue = extrasQueue.then(() => readEvoExtras({ liveries, brands, contentPkg }, cacheDir)).then(x => {
      const fresh = Object.keys(x.liveries).some(k => !(k in extras.liveries)) || Object.keys(x.brands).some(k => !(k in extras.brands));
      extras = { ...x, liveries: { ...extras.liveries, ...x.liveries }, brands: { ...extras.brands, ...x.brands } };
      if (!fresh || !ui?.el.isConnected) return;
      opts.cars = carEntries();
      if (rowOnly) ui.sync(); else ui.redraw();
    }).catch(err => log(`evo extras: ${err?.stack || err?.message || err}`));
  };
  // A configuration is a livery (visual preset) with a spec (mechanical preset:
  // "ABS TC", "No ABS No TC"…). Every one is listed, tagged with its livery and
  // spec; Quick Drive shows each livery once, in the chosen spec (variantRow).
  // Names not read from the package yet show as "Loading…", never as preset ids.
  const specName = (carId, mech) => {
    let read = false;
    for (const cfg of knownBy.get(carId)?.configs || []) {
      if (cfg.mech !== mech || !cfg.visual || /_visual_99$/i.test(cfg.visual)) continue;
      const x = extras.liveries[extras.liveryKey({ carId, mech: cfg.mech, visual: cfg.visual })];
      if (x?.mech) return x.mech;
      if (x) read = true;
    }
    return !read && mech ? 'Loading…' : mech ? prettifyId(mech.replace(/^preset_/, '')) : 'Default';
  };
  const variants = carId => {
    if (!extrasAsked.has(carId)) { extrasAsked.add(carId); const l = liveriesOf(carId); if (l.length) setTimeout(() => loadExtras(l, [], { rowOnly: true })); }
    const k = knownBy.get(carId), item = carList.find(c => c.carId === carId);
    return (k?.configs || []).map((cfg, i) => {
      const x = thumb(carId, cfg), modded = /_visual_99$/i.test(cfg.visual || '') && x;
      return {
        key: cfg.guid,
        title: x?.label || (cfg.visual ? (x ? prettifyId(cfg.visual.replace(/^preset_/, '')) : 'Loading…') : i ? `Livery ${i + 1}` : 'Last used livery'),
        sub: [modded && x.mech, cfg.current && 'current'].filter(Boolean).join(' · '),
        image: x?.image || item?.image,
        livery: cfg.visual || cfg.guid, spec: cfg.mech || '-', specLabel: specName(carId, cfg.mech),
      };
    });
  };

  const liveryCount = k => new Set(k.configs.map(c => c.visual || c.guid)).size; // each spec of a livery counts once
  const carEntries = () => [
    ...(currentItem ? [{
      key: '', title: 'Keep current car', sub: currentItem.title, summaryTitle: currentItem.title, brand: '',
      image: thumb(current.carId, currentConfig)?.image || currentItem.image,
      flag: '<span class="flag kunos">Current</span>',
    }] : []),
    ...carList.map(c => {
      const k = knownBy.get(c.carId), latest = thumb(c.carId, k?.configs[0]);
      return {
        key: c.carId, title: c.title, sub: c.subtitle, brand: c.brand || '', locked: !k,
        image: latest?.image || c.image,
        flag: (c.isNew ? '<span class="flag tag-new">New</span>' : '') + (!k ? '<span class="flag off">New to EVO</span>' : liveryCount(k) > 1 ? `<span class="flag kunos">${liveryCount(k)} liveries</span>` : ''),
      };
    }),
  ];
  // Practice uses each layout's Time Attack version, the races its Race version.
  const trackEntries = () => official.map(t => {
    const layouts = t.layouts.filter(l => l[container()]);
    return {
      key: t.id, title: t.title, sub: t.subtitle, image: t.image,
      flag: `${t.isNew ? '<span class="flag tag-new">New</span>' : ''}<span class="flag kunos">${layouts.length} layout${layouts.length > 1 ? 's' : ''}</span>`,
      // A mod layout without an AI line has Practice only (evotracks.js).
      layouts: layouts.map(l => ({ key: l.id, name: l.name, sub: km(l[container()]) || (l.noAiLine ? tr('No AI line: practice only') : ''), outline: l.outline, preview: l.preview })),
    };
  }).filter(t => t.layouts.length);

  // Session sheet. Ranges are the ones EVO's Game Mode page uses.
  const weatherName = () => EVO_WEATHER.find(w => w.id === ss.weather.type)?.label || 'Weather';
  const maxOpponents = s => {
    const l = official.find(t => t.id === s.track)?.layouts.find(x => x.id === s.layout)?.[container()];
    return Math.max(1, (l?.maxDrivers || 33) - 1);
  };
  const length = r => r.type === 'laps' ? `${r.laps} lap${r.laps > 1 ? 's' : ''}` : `${r.minutes} min`;
  const timing = (t, { lengths, zero }) => [
    { label: 'Length', type: 'select', options: minuteOptions(t.minutes, ...lengths, zero), get: () => t.minutes, set: v => { t.minutes = v; } },
    { label: 'Start time', type: 'select', options: timeOptions(t.start), get: () => t.start, set: v => { t.start = v; } },
    { label: 'Time speed', hint: 'In-game minutes per real minute', type: 'select', options: EVO_TIME_SPEEDS.map(x => [x, `${x}×`]), get: () => t.speed, set: v => { t.speed = v; } },
  ];
  const raceFields = (r, startPos, sel) => [
    { label: 'Race length', type: 'seg', options: [['laps', 'Laps'], ['time', 'Time']], get: () => r.type, set: v => { r.type = v; } },
    r.type === 'laps'
      ? { label: 'Laps', type: 'select', options: countOptions(r.laps, 1, 100), get: () => r.laps, set: v => { r.laps = v; } }
      : { label: 'Duration', type: 'select', options: minuteOptions(r.minutes, 5, 180, 5), get: () => r.minutes, set: v => { r.minutes = v; } },
    { label: 'Start time', type: 'select', options: timeOptions(r.start), get: () => r.start, set: v => { r.start = v; } },
    { label: 'Time speed', type: 'select', options: EVO_TIME_SPEEDS.map(x => [x, `${x}×`]), get: () => r.speed, set: v => { r.speed = v; } },
    ...(startPos ? [{
      // EVO keeps the slot within the grid (opponents + 1).
      label: 'Starting position', type: 'select', get: () => (r.startPos = Math.min(r.startPos, Math.min(r.grid.opponents, maxOpponents(sel)) + 1)), set: v => { r.startPos = v; },
      options: [[0, 'Random'], ...steps(1, Math.min(r.grid.opponents, maxOpponents(sel)) + 1, 1).map(n => [n, `P${n}`])],
    }] : []),
  ];
  const gridSection = (grid, sel) => ({
    title: 'Opponents',
    note: grid.custom ? 'Uses the grid you built in EVO (Edit grid). Switch to Automatic to set it here.' : '',
    fields: [
      { label: 'Grid', type: 'seg', options: [[false, 'Automatic'], [true, 'Custom (from EVO)']], get: () => grid.custom, set: v => { grid.custom = v; } },
      ...(grid.custom ? [] : [
        { label: 'Opponents', hint: `Up to ${maxOpponents(sel)} on this layout`, type: 'select', options: countOptions(Math.min(grid.opponents, maxOpponents(sel)), 1, maxOpponents(sel)), get: () => Math.min(grid.opponents, maxOpponents(sel)), set: v => { grid.opponents = v; } },
        { label: 'Skill from', type: 'select', options: steps(80, 100, 1).map(n => [n, `${n}%`]), get: () => grid.skillMin, set: v => { grid.skillMin = v; grid.skillMax = Math.max(grid.skillMax, v); } },
        { label: 'Skill to', type: 'select', options: steps(80, 100, 1).map(n => [n, `${n}%`]), get: () => grid.skillMax, set: v => { grid.skillMax = v; grid.skillMin = Math.min(grid.skillMin, v); } },
        { label: 'Single make', hint: 'Every AI car is the same model as yours', type: 'seg', options: [[false, 'Off'], [true, 'On']], get: () => grid.singleMake, set: v => { grid.singleMake = v; } },
      ]),
    ],
  });
  const session = {
    summary: () => {
      const w = weatherName();
      if (ss.mode === 'practice') return { title: 'Practice', sub: `${ss.practice.minutes} min · ${hhmm(ss.practice.start)} · ${w}` };
      const grid = ss.mode === 'race' ? ss.race.grid : ss.weekend.grid;
      const ai = grid.custom ? 'custom grid' : `${grid.opponents} AI`;
      if (ss.mode === 'race') return { title: 'Race', sub: `${length(ss.race)} · ${ai} · ${hhmm(ss.race.start)} · ${w}` };
      const wk = ss.weekend;
      return { title: 'Race Weekend', sub: [wk.practice.minutes && `P ${wk.practice.minutes}'`, `Q ${wk.qualifying.minutes}'`, wk.warmup.minutes && `WU ${wk.warmup.minutes}'`, `R ${length(wk.race)}`, ai, w].filter(Boolean).join(' · ') };
    },
    get: () => ss,
    set: d => { mergeSettings(ss, d); },
    sheetNote: "EVO's Single Player settings: they're saved into EVO when you launch.",
    sections: sel => [
      { title: 'Game mode', wide: true, fields: [{ label: 'Mode', type: 'seg', options: Object.entries(EVO_MODES).map(([k, m]) => [k, m.label]), get: () => ss.mode, set: v => { ss.mode = v; } }] },
      ...(ss.mode === 'practice' ? [{ title: 'Practice', fields: timing(ss.practice, { lengths: [5, 90, 5] }) }] : []),
      ...(ss.mode === 'race' ? [{ title: 'Race', fields: raceFields(ss.race, true, sel) }, gridSection(ss.race.grid, sel)] : []),
      ...(ss.mode === 'weekend' ? [
        { title: 'Practice', fields: timing(ss.weekend.practice, { lengths: [0, 90, 5], zero: 'Off' }) },
        { title: 'Qualifying', fields: timing(ss.weekend.qualifying, { lengths: [5, 90, 5] }) },
        { title: 'Warm-up', fields: timing(ss.weekend.warmup, { lengths: [0, 90, 5], zero: 'Off' }) },
        { title: 'Race', fields: raceFields(ss.weekend.race, false, sel) },
        gridSection(ss.weekend.grid, sel),
      ] : []),
      {
        title: 'Weather', fields: [
          { label: 'Weather', type: 'select', options: EVO_WEATHER.map(w => [w.id, w.label]), get: () => ss.weather.type, set: v => { ss.weather.type = v; } },
          { label: 'Changes', hint: 'Dynamic weather evolves during the session', type: 'seg', options: [[false, 'Static'], [true, 'Dynamic']], get: () => ss.weather.dynamic, set: v => { ss.weather.dynamic = v; } },
          { label: 'Initial grip', type: 'seg', options: EVO_GRIP, get: () => ss.weather.grip, set: v => { ss.weather.grip = v; } },
        ],
      },
    ],
    onChange: ui => {
      // The mode decides which layouts exist (Time Attack vs Race versions).
      const keys = trackEntries().map(t => `${t.key}:${t.layouts.map(l => l.key)}`).join();
      if (keys !== opts.tracks.map(t => `${t.key}:${t.layouts.map(l => l.key)}`).join()) { opts.tracks = trackEntries(); ui.redrawTracks(); }
      state.settings.evoQD = { ...(state.settings.evoQD || {}), session: ss };
      saveSettings();
    },
  };

  const opts = {
    game: 'evo',
    sub: "Sets up the session and starts EVO through Steam. In EVO, open <b>Single Player</b>: mode, track, car, livery and weather are already selected.",
    session,
    launchLabel: 'Launch EVO',
    carCount: `${known.filter(k => carList.some(c => c.carId === k.carId)).length} ready · ${carList.length} total`,
    trackCount: `${official.length} venues`,
    cars: carEntries(),
    brandLogo: name => { const f = extras.brands[extras.brandSlug(name)]; return f ? fileUrl(f) : ''; },
    variantLabel: 'Livery',
    variants: carKey => carKey ? variants(carKey) : [],
    // Mod cars only have the liveries EVO has used (their IDs come from its logs).
    variantHint: carKey => carKey && !knownBy.get(carKey)?.configs.some(c => c.stock) ? 'Only liveries you have picked in EVO are listed. Pick another one once in EVO and it shows up here.' : '',
    defaultVariant: carKey => knownBy.get(carKey)?.configs[0]?.guid || '',
    tracks: trackEntries(),
    sel: { car: '', variant: '', track: '', layout: '' },
    // EVO gives each car its IDs once it has listed it (new mods: after it next starts).
    onLocked: c => toast(`${c.title}: EVO hasn't set this car up yet. Start EVO and open its car list once, then it can be pre-selected here.`, true),
    onClose: s => {
      state.settings.evoQD = { car: s.car, variant: s.variant, track: s.track, layout: s.layout, session: ss };
      saveSettings();
    },
    onLaunch: async s => {
      const t = official.find(x => x.id === s.track), layout = t?.layouts.find(l => l.id === s.layout);
      if (!t || !layout) { toast('Pick a track first.', true); return false; }
      try {
        await evoTrackSync({ quiet: true });
        await launchEvo({
          steamPath: state.steamPath, installDir: state.paths.evo.install,
          session: ss, track: t.evoTrack, layout, carGuid: s.car ? s.variant : '',
        });
        toast(`Starting EVO · ${EVO_MODES[ss.mode].label} at ${t.title} ${layout.name}`);
      } catch (err) {
        toast(err.message || 'Could not start Assetto Corsa EVO', true);
        return false;
      }
    },
    // Personal bests from EVO's session results (matched by display names).
    best: s => {
      const t = official.find(x => x.id === s.track), l = t?.layouts.find(x => x.id === s.layout);
      const c = s.car ? carList.find(x => x.carId === s.car) : currentItem;
      return t && l && c ? bests.get(evoBestKey(t.title, l.name, c.title)) : undefined;
    },
    bests: () => {
      const out = [];
      for (const t of official) for (const l of t.layouts) for (const c of carList) {
        const b = bests.get(evoBestKey(t.title, l.name, c.title));
        if (b) out.push({ sel: { car: c.carId, track: t.id, layout: l.id }, ...b });
      }
      return out;
    },
  };
  let bests = new Map();
  evoBests(state.paths).then(m => { bests = m; ui?.el.isConnected && ui.sync(); }).catch(err => log(`evo bests: ${err?.message}`));

  // Car: the one asked for (detail page), else the last pick, else EVO's current car.
  const configOk = (carId, guid) => knownBy.get(carId)?.configs.some(c => c.guid === guid);
  if (car) {
    if (knownBy.has(car.carId) && !knownBy.get(car.carId).current) { opts.sel.car = car.carId; opts.sel.variant = opts.defaultVariant(car.carId); }
  } else if (saved.car && knownBy.has(saved.car)) {
    opts.sel.car = saved.car;
    opts.sel.variant = configOk(saved.car, saved.variant) ? saved.variant : opts.defaultVariant(saved.car);
  } else if (!currentItem && known[0] && carList.some(c => c.carId === known[0].carId)) {
    opts.sel.car = known[0].carId; opts.sel.variant = opts.defaultVariant(known[0].carId);
  }
  // Track: the one asked for, else the last pick (layout kept when this mode has it).
  const startTrack = opts.tracks.find(t => t.key === track?.id) || opts.tracks.find(t => t.key === (saved.track || state.settings.evoLastTrack)) || opts.tracks[0];
  opts.sel.track = startTrack.key;
  opts.sel.layout = (!track && startTrack.layouts.find(l => l.key === saved.layout)?.key) || startTrack.layouts[0]?.key || '';

  // Names, pictures and logos decoded before come from the cache before the first draw.
  const brands = [...new Set(carList.map(c => c.brand).filter(Boolean))];
  const cached = cacheDir ? await readEvoExtras({ liveries: carList.flatMap(c => liveriesOf(c.carId)), brands, contentPkg, cachedOnly: true }, cacheDir).catch(() => null) : null;
  if (cached) { extras = cached; opts.cars = carEntries(); }

  const ui = quickDriveModal(opts);
  if (car && !knownBy.has(car.carId)) opts.onLocked(car);

  // Background: livery thumbnails/names of the driven configurations + brand logos.
  loadExtras(known.filter(k => k.seen || k.current).flatMap(k => liveriesOf(k.carId)), brands);
}

// ---------------------------------------------------------------------------
// Quick drive (AC): car, skin, track and session (mode, AI opponents, time,
// weather, wind, temperatures, grip, assists) written to race.ini and assists.ini,
// then acs.exe. With CSP's WeatherFX the weather is one of CSP's types and the
// time any hour. The selection and session are remembered even when the dialog
// is closed without driving.

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const compass = deg => `${COMPASS[Math.round(((deg % 360) + 360) % 360 / 45) % 8]} · ${deg}°`;
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

async function openQuickDrive({ car, skin, track } = {}) {
  const g = gameByKey('ac');
  const [cars, allTracks, weathers, csp] = await Promise.all([
    getItems(g, 'cars'), getItems(g, 'tracks'),
    acWeathers(state.paths).catch(() => []),
    readCsp(state.paths).catch(() => ({ installed: false, features: {}, controllers: [] })),
  ]);
  const fromGame = await readAcSession(state.paths, csp).catch(() => defaultAcSession());
  // Tracks without models (unowned DLC placeholders) can't be loaded.
  const tracks = allTracks.filter(t => t.playable !== false);
  if (!cars.length || !tracks.length) { toast('No Assetto Corsa cars or tracks found. Check the folder in Settings.', true); return; }
  state.settings.qdGame = 'ac';
  const findCar = id => cars.find(c => c.id === id);
  const findTrack = id => tracks.find(t => t.id === id);
  // Brand logos: the badge of the first car of each brand.
  const badges = new Map();
  for (const c of cars) if (c.brand && c.badge && !badges.has(c.brand)) badges.set(c.brand, c.badge);

  // CSP: WeatherFX picks the weather by type; times outside 08:00-18:00 and a date need CSP too.
  const wfx = !!csp.wfx, h24 = !!csp.features.CONDITIONS_24H, dated = !!csp.features.CONDITIONS_SPECIFIC_DATE;
  const types = CSP_WEATHER_TYPES.filter(t => t.needs !== 'snow' || csp.features.SNOW);
  const ownWeather = csp.controllers.filter(c => !c.followsWeather); // Live, Schedule…: pick the weather themselves
  // Controllers for a chosen weather type. CSP's own "base" is the default slot ('');
  // with Pure, Pure Static takes that slot (readCsp: baseController). Pure's
  // controllers are only listed while a Pure style is in use (readCsp).
  const typeControllers = csp.controllers.filter(c => c.followsWeather && (c.id !== 'base' || csp.baseController === 'base'));
  const controllerName = () => (ss.cspWeather.startsWith('ctrl:') ? '' : csp.controllers.find(c => c.id === (ss.wfxController || csp.baseController))?.name);
  const ss = mergeSettings(fromGame, state.settings.acSession);
  const normalize = () => {
    if (weathers.length && !weathers.some(w => w.id === ss.weather)) ss.weather = weathers.find(w => w.id === '3_clear')?.id || weathers[0].id;
    const ok = ss.cspWeather.startsWith('ctrl:') ? ownWeather.some(c => `ctrl:${c.id}` === ss.cspWeather) : types.some(t => String(t.id) === ss.cspWeather);
    if (!ok) ss.cspWeather = '15';
    if (ss.wfxController === csp.baseController || !typeControllers.some(c => c.id === ss.wfxController)) ss.wfxController = '';
    if (!h24) ss.time = Math.min(18 * 60, Math.max(8 * 60, ss.time));
  };
  normalize();
  const racing = () => ss.mode === 'race' || ss.mode === 'weekend';
  const weather = () => weathers.find(w => w.id === ss.weather);
  const wfxType = () => (ss.cspWeather.startsWith('ctrl:') ? 15 : Number(ss.cspWeather));
  const weatherName = () => (wfx
    ? (ownWeather.find(c => `ctrl:${c.id}` === ss.cspWeather)?.name || cspWeatherLabel(ss.cspWeather))
    : (weather()?.name || ss.weather));
  const layoutOf = s => findTrack(s.track)?.layouts.find(l => l.id === s.layout);
  const maxOpponents = s => Math.max(1, Math.min(Number(layoutOf(s)?.pitboxes) || 20, 63) - 1);
  const roadNow = () => roadTemperature(ss.time, ss.air, (wfx ? presetForType(weathers, wfxType()) : weather())?.coeff);
  const assistPreset = () => Object.keys(AC_ASSIST_PRESETS).find(k => Object.entries(AC_ASSIST_PRESETS[k]).every(([key, v]) => ss.assists[key] === v)) || 'custom';
  const onOff = [[1, 'On'], [0, 'Off']];

  const trackEntries = () => tracks.map(t => ({
    key: t.id, title: t.title, sub: t.subtitle, image: t.image,
    flag: t.layouts.length > 1 ? `<span class="flag kunos">${t.layouts.length} layouts</span>` : '',
    layouts: t.layouts.map(l => ({
      key: l.id, name: l.name || 'Default', outline: l.outline, preview: l.preview,
      sub: [l.length && `${l.length}${/^\d+$/.test(l.length) ? ' m' : ''}`, racing() && !l.aiLine && 'no AI line'].filter(Boolean).join(' · '),
    })),
  }));

  const session = {
    summary: () => {
      const cond = `${hhmm(ss.time)} · ${weatherName()} · ${ss.air} °C`;
      if (ss.mode === 'practice') return { title: 'Practice', sub: `${ss.practice.minutes ? `${ss.practice.minutes} min` : 'Unlimited'} · ${cond}` };
      if (ss.mode === 'hotlap') return { title: 'Hotlap', sub: cond };
      if (ss.mode === 'race') return { title: 'Race', sub: `${ss.race.laps} laps · ${ss.ai.count} AI · ${cond}` };
      const wk = ss.weekend;
      return { title: 'Race Weekend', sub: [wk.practice && `P ${wk.practice}'`, `Q ${wk.qualifying}'`, `R ${wk.laps} laps`, `${ss.ai.count} AI`, cond].filter(Boolean).join(' · ') };
    },
    get: () => ss,
    set: d => { mergeSettings(ss, d); normalize(); },
    sheetNote: `Written to race.ini and assists.ini when you drive.${csp.installed ? ' Weather FX and Rain FX are in Settings.' : ''}`,
    sections: sel => {
      const max = maxOpponents(sel), layout = layoutOf(sel);
      return [
        { title: 'Game mode', wide: true, fields: [{ label: 'Mode', type: 'seg', options: Object.entries(AC_MODES), get: () => ss.mode, set: v => { ss.mode = v; } }] },
        ...(ss.mode === 'practice' ? [{ title: 'Practice', fields: [
          { label: 'Length', type: 'select', options: minuteOptions(ss.practice.minutes, 0, 120, 5, 'Unlimited'), get: () => ss.practice.minutes, set: v => { ss.practice.minutes = v; } },
        ] }] : []),
        ...(ss.mode === 'race' ? [{ title: 'Race', fields: [
          { label: 'Laps', type: 'select', options: countOptions(ss.race.laps, 1, 100), get: () => ss.race.laps, set: v => { ss.race.laps = v; } },
          { label: 'Starting position', type: 'select', get: () => ss.race.startPos, set: v => { ss.race.startPos = v; },
            options: [[0, 'Last'], [-1, 'Random'], ...steps(1, Math.min(ss.ai.count, max) + 1, 1).map(n => [n, `P${n}`])] },
        ] }] : []),
        ...(ss.mode === 'weekend' ? [{ title: 'Weekend', fields: [
          { label: 'Practice', type: 'select', options: minuteOptions(ss.weekend.practice, 0, 90, 5, 'Skip'), get: () => ss.weekend.practice, set: v => { ss.weekend.practice = v; } },
          { label: 'Qualifying', type: 'select', options: minuteOptions(ss.weekend.qualifying, 5, 90, 5), get: () => ss.weekend.qualifying, set: v => { ss.weekend.qualifying = v; } },
          { label: 'Race laps', type: 'select', options: countOptions(ss.weekend.laps, 1, 100), get: () => ss.weekend.laps, set: v => { ss.weekend.laps = v; } },
        ] }] : []),
        ...(racing() ? [{
          title: 'Opponents',
          note: layout && !layout.aiLine ? "This layout has no AI line (ai/fast_lane.ai), so it can't have opponents. Pick another layout or track." : 'Same car as yours, in its other skins.',
          fields: [
            { label: 'Opponents', hint: `Up to ${max} (pit boxes on this layout)`, type: 'select', options: countOptions(Math.min(ss.ai.count, max), 1, max), get: () => Math.min(ss.ai.count, max), set: v => { ss.ai.count = v; } },
            { label: 'Strength', type: 'select', options: steps(80, 100, 1).map(n => [n, `${n}%`]), get: () => ss.ai.strength, set: v => { ss.ai.strength = v; } },
            { label: 'Variation', hint: 'How much each AI driver differs', type: 'select', options: steps(0, 5, 1).map(n => [n, `${n}%`]), get: () => ss.ai.variation, set: v => { ss.ai.variation = v; } },
            { label: 'Aggression', type: 'select', options: steps(0, 100, 10).map(n => [n, `${n}%`]), get: () => ss.ai.aggression, set: v => { ss.ai.aggression = v; } },
          ],
        }] : []),
        {
          title: 'Conditions',
          note: wfx && isWetWeather(wfxType()) && !csp.rainFx ? 'Rain FX is off (Settings → Custom Shaders Patch), so the track stays dry.' : '',
          fields: [
            { label: 'Time of day', hint: h24 ? 'Any hour with Custom Shaders Patch' : '', type: 'select', options: timeOptions(ss.time, h24 ? 0 : 8 * 60, h24 ? 23 * 60 + 45 : 18 * 60), get: () => ss.time, set: v => { ss.time = v; } },
            { label: 'Time speed', type: 'select', options: withCurrent([1, 2, 4, 8, 16, 30, 60].map(x => [x, `${x}×`]), ss.speed, x => `${x}×`), get: () => ss.speed, set: v => { ss.speed = v; } },
            ...(dated ? [
              { label: 'Date', hint: 'Sun position and season (CSP)', type: 'seg', options: [[false, 'Today'], [true, 'Pick a day']], get: () => !!ss.date, set: v => { ss.date = v ? (ss.date || todayIso()) : ''; } },
              ...(ss.date ? [{ label: 'Day', type: 'date', get: () => ss.date, set: v => { ss.date = v; } }] : []),
            ] : []),
            wfx
              ? { label: 'Weather', hint: ['CSP Weather FX', csp.style !== 'base' && (csp.styles.find(s => s.id === csp.style)?.name || csp.style), controllerName() !== 'Default' && controllerName()].filter(Boolean).join(' · '),
                type: 'select', get: () => ss.cspWeather, set: v => { ss.cspWeather = v; },
                options: [...types.map(t => [String(t.id), t.label]), ...ownWeather.map(c => [`ctrl:${c.id}`, `${c.name} (controller)`])] }
              : { label: 'Weather', type: 'select', options: weathers.length ? weathers.map(w => [w.id, w.name]) : [[ss.weather, ss.weather]], get: () => ss.weather, set: v => { ss.weather = v; } },
            // Default unless the user picks another one (with Pure: Pure Static, readCsp).
            ...(wfx && !ss.cspWeather.startsWith('ctrl:') ? [{
              label: 'Weather controller', hint: 'Script that sets the conditions from the weather', type: 'select', get: () => ss.wfxController, set: v => { ss.wfxController = v; },
              options: [['', 'Default'], ...typeControllers.filter(c => c.id !== csp.baseController).map(c => [c.id, c.name])],
            }] : []),
            { label: 'Air temperature', type: 'select', options: withCurrent(steps(10, 36, 1).map(n => [n, `${n} °C`]), ss.air, n => `${n} °C`), get: () => ss.air, set: v => { ss.air = v; } },
            { label: 'Track temperature', hint: 'Auto uses the formula of AC\'s launcher (air, time, weather)', type: 'select', get: () => ss.road, set: v => { ss.road = v; },
              options: [['auto', `Auto · ${roadNow()} °C`], ...steps(10, 60, 1).map(n => [n, `${n} °C`])] },
            { label: 'Track grip', type: 'select', options: AC_GRIP.map(x => [x.id, x.label]), get: () => ss.grip, set: v => { ss.grip = v; } },
            { label: 'Penalties', type: 'seg', options: [[true, 'On'], [false, 'Off']], get: () => ss.penalties, set: v => { ss.penalties = v; } },
          ],
        },
        {
          title: 'Wind', fields: [
            { label: 'Wind speed', type: 'select', get: () => ss.wind.speed, set: v => { ss.wind.speed = v; },
              options: withCurrent(steps(0, 60, 5).map(n => [n, n ? `${n} km/h` : 'Calm']), ss.wind.speed, n => `${n} km/h`) },
            ...(ss.wind.speed > 0 ? [
              { label: 'Gusts', type: 'select', get: () => ss.wind.gusts, set: v => { ss.wind.gusts = v; },
                options: withCurrent([[0, 'Steady'], [5, '+5 km/h'], [10, '+10 km/h'], [20, '+20 km/h']], ss.wind.gusts, n => `+${n} km/h`) },
              { label: 'Direction', type: 'select', get: () => ss.wind.dir, set: v => { ss.wind.dir = v; },
                options: withCurrent(steps(0, 315, 45).map(d => [d, compass(d)]), ss.wind.dir, compass) },
            ] : []),
          ],
        },
        {
          title: 'Assists', wide: true, fields: [
            { label: 'Preset', hint: "AC's own presets", type: 'seg', get: assistPreset, set: v => { if (AC_ASSIST_PRESETS[v]) Object.assign(ss.assists, AC_ASSIST_PRESETS[v]); },
              options: [['gamer', 'Gamer'], ['racer', 'Racer'], ['pro', 'Pro'], ['custom', 'Custom']] },
          ],
        },
        {
          title: 'Driving aids', fields: [
            { label: 'ABS', type: 'seg', options: [[0, 'Off'], [1, 'Factory'], [2, 'On']], get: () => ss.assists.abs, set: v => { ss.assists.abs = v; } },
            { label: 'Traction control', type: 'seg', options: [[0, 'Off'], [1, 'Factory'], [2, 'On']], get: () => ss.assists.tc, set: v => { ss.assists.tc = v; } },
            { label: 'Stability control', type: 'select', get: () => ss.assists.stability, set: v => { ss.assists.stability = v; },
              options: withCurrent(steps(0, 100, 10).map(n => [n, n ? `${n}%` : 'Off']), ss.assists.stability, n => `${n}%`) },
            { label: 'Clutch', type: 'seg', options: [[1, 'Auto'], [0, 'Manual']], get: () => ss.assists.autoClutch, set: v => { ss.assists.autoClutch = v; } },
            { label: 'Gear shifts', type: 'seg', options: [[1, 'Auto'], [0, 'Manual']], get: () => ss.assists.autoShift, set: v => { ss.assists.autoShift = v; } },
            { label: 'Auto blip', hint: 'Throttle blips on downshifts', type: 'seg', options: onOff, get: () => ss.assists.autoBlip, set: v => { ss.assists.autoBlip = v; } },
            { label: 'Ideal line', type: 'seg', options: onOff, get: () => ss.assists.ideal, set: v => { ss.assists.ideal = v; } },
          ],
        },
        {
          title: 'Realism', fields: [
            { label: 'Mechanical damage', type: 'select', get: () => ss.assists.damage, set: v => { ss.assists.damage = v; },
              options: withCurrent(steps(0, 100, 10).map(n => [n, n ? `${n}%` : 'Off']), ss.assists.damage, n => `${n}%`) },
            { label: 'Visual damage', type: 'seg', options: onOff, get: () => ss.assists.visualDamage, set: v => { ss.assists.visualDamage = v; } },
            { label: 'Fuel use', type: 'seg', options: onOff, get: () => ss.assists.fuel, set: v => { ss.assists.fuel = v; } },
            { label: 'Tyre wear', type: 'seg', options: [[0, 'Off'], [1, '1×'], [2, '2×'], [3, '3×']], get: () => ss.assists.tyreWear, set: v => { ss.assists.tyreWear = v; } },
            { label: 'Tyre blankets', type: 'seg', options: onOff, get: () => ss.assists.blankets, set: v => { ss.assists.blankets = v; } },
            { label: 'Slipstream', type: 'select', get: () => ss.assists.slipstream, set: v => { ss.assists.slipstream = v; },
              options: withCurrent(steps(1, 5, 1).map(n => [n, `${n}×`]), ss.assists.slipstream, n => `${n}×`) },
          ],
        },
      ];
    },
    onChange: ui => {
      // Layout notes ("no AI line") depend on the mode.
      opts.tracks = trackEntries(); ui.redrawTracks();
      state.settings.acSession = ss;
      saveSettings();
    },
  };

  const last = state.settings;
  const startCar = findCar(car?.id) || findCar(last.lastCar) || cars[0];
  const startTrack = findTrack(track?.id) || findTrack(last.lastTrack) || tracks[0];
  const skinOk = id => startCar.skins?.some(s => s.id === id);
  const opts = {
    game: 'ac',
    sub: 'Starts Assetto Corsa directly with the session and assists below.',
    session,
    launchLabel: 'Drive',
    carCount: `${cars.length} cars`,
    trackCount: `${tracks.length} tracks`,
    cars: cars.map(c => ({ key: c.id, title: c.title, sub: c.subtitle, brand: c.brand || '', image: c.image || c.fallbackImage, flag: c.isMod ? '<span class="flag">Mod</span>' : '' })),
    brandLogo: name => badges.get(name) || '',
    variantLabel: 'Skin',
    variants: id => (findCar(id)?.skins || []).map(s => ({ key: s.id, title: prettifyId(s.id), image: s.image })),
    defaultVariant: id => findCar(id)?.skins?.[0]?.id || '',
    tracks: trackEntries(),
    sel: {
      car: startCar.id,
      variant: (car && skin) || (startCar.id === last.lastCar && skinOk(last.lastSkin) && last.lastSkin) || startCar.skins?.[0]?.id || '',
      track: startTrack.id,
      layout: (!track && startTrack.id === last.lastTrack && startTrack.layouts.some(l => l.id === last.lastLayout) && last.lastLayout) || startTrack.layouts[0]?.id || '',
    },
    onClose: s => {
      Object.assign(state.settings, { lastCar: s.car, lastSkin: s.variant, lastTrack: s.track, lastLayout: s.layout, acSession: ss });
      saveSettings();
    },
    onLaunch: async s => {
      try {
        await quickDrive(state.paths, {
          car: s.car, skin: s.variant, skins: (findCar(s.car)?.skins || []).map(x => x.id),
          track: s.track, layout: s.layout, session: ss, maxOpponents: maxOpponents(s), csp,
        });
        toast(`Starting ${findCar(s.car)?.title} at ${findTrack(s.track)?.title}…`);
      } catch (err) {
        toast(err.message || 'Could not start Assetto Corsa', true);
        return false;
      }
    },
    // Personal bests from AC's personalbest.ini.
    best: s => bests.get(acBestKey(s.car, s.track, s.layout)),
    bests: () => {
      const places = new Map(tracks.flatMap(t => t.layouts.map(l => [acBestKey('', t.id, l.id).slice(1), { track: t.id, layout: l.id }])));
      const carIds = new Map(cars.map(c => [c.id.toUpperCase(), c.id]));
      return [...bests].flatMap(([k, v]) => {
        const i = k.indexOf('@'), car = carIds.get(k.slice(0, i)), place = places.get(k.slice(i + 1));
        return car && place ? [{ sel: { car, ...place }, ...v }] : [];
      });
    },
  };
  let bests = new Map();
  const ui = quickDriveModal(opts);
  acBests(state.paths).then(m => { bests = m; if (ui.el.isConnected) ui.sync(); }).catch(err => log(`ac bests: ${err?.message}`));
}

// ---------------------------------------------------------------------------
// Mod installer: drop archives/mod files anywhere on the window, or use
// "Install mod". installer.js works out the game and folder for each piece.

const dropOverlay = document.createElement('div');
dropOverlay.id = 'drop-overlay';
dropOverlay.innerHTML = `<div class="drop-box"><div class="drop-icon">＋</div><b>Drop to install</b>
  <span>.zip · .rar · .7z · .kspkg · .pak<br>The launcher detects the game and puts the mod in the right folder.</span></div>`;
document.body.appendChild(dropOverlay);

let dragDepth = 0;
const draggingFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
// Nothing inside the window can be dragged (cards, pictures, links): an image drag
// carries a file, which would open the install overlay. Files dragged in from
// outside still work.
document.addEventListener('dragstart', e => e.preventDefault());
window.addEventListener('dragenter', e => { if (!draggingFiles(e)) return; e.preventDefault(); dragDepth++; dropOverlay.classList.add('show'); });
window.addEventListener('dragover', e => { if (!draggingFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
window.addEventListener('dragleave', e => { if (draggingFiles(e) && --dragDepth <= 0) { dragDepth = 0; dropOverlay.classList.remove('show'); } });
window.addEventListener('drop', e => {
  e.preventDefault();
  dragDepth = 0; dropOverlay.classList.remove('show');
  const files = [...(e.dataTransfer?.files || [])];
  if (files.length) importSources(files.map(file => ({ file })));
});

async function pickModFiles() {
  try {
    const picked = await Neutralino.os.showOpenDialog('Install mods', {
      multiSelections: true,
      filters: [{ name: 'Mods', extensions: ['zip', 'rar', '7z', 'kspkg', 'pak', 'json'] }, { name: 'All files', extensions: ['*'] }],
    });
    if (picked?.length) importSources(picked.map(path => ({ path: norm(path) })));
  } catch (err) { log(`open dialog: ${err?.message || JSON.stringify(err)}`); }
}

function progressModal(text) {
  const { el, close } = modal(`<div class="imp-progress"><div class="spinner"></div><span>${esc(text)}</span></div>`, 'modal imp-modal slim');
  el.dataset.busy = '1';
  const set = t => { const s = el.querySelector('.imp-progress span'); if (s) s.textContent = t; };
  set.close = () => { delete el.dataset.busy; close(); };
  return set;
}

let importing = false;
async function importSources(sources) {
  if (importing) { toast('Still working on the previous mod…', true); return; }
  importing = true;
  const status = progressModal('Preparing…');
  const items = [], problems = [], sessions = [];
  try {
    const evoCache = await evoCacheDir().catch(() => '');
    for (const s of sources) {
      const label = s.file?.name || basename(s.path);
      if (!IMPORT_RE.test(label)) { problems.push(`${label}: not a mod archive or mod file`); continue; }
      try {
        const src = s.file
          ? await resolveDropped(s.file, (done, total) => status(`Reading ${label}… ${Math.round(done / total * 100)}%`))
          : { path: s.path, temp: false };
        const r = await prepareImport(src, state.paths, { evoCache, onStatus: status });
        sessions.push(...r.session);
        items.push(...r.items);
        if (!r.items.length) problems.push(`${label}: no Assetto Corsa mod recognised inside`);
      } catch (err) {
        log(`import ${label}: ${err?.stack || err?.message || JSON.stringify(err)}`);
        problems.push(`${label}: ${err?.message || 'could not be read'}`);
      }
    }
  } finally {
    importing = false;
  }
  status.close();
  await openInstallReview(items, problems, sessions);
}

const KIND_LABEL = { car: 'Car', track: 'Track', skin: 'Skin', extras: 'Extras', livery: 'Livery', 'car file': 'Car file', 'pp filter': 'PP filter' };

async function openInstallReview(items, problems, sessions) {
  // Install hands the staging to the install queue, which discards it when done.
  let handed = false;
  const cleanup = () => { if (!handed) sessions.forEach(discardImport); };
  const problemList = problems.length ? `<ul class="imp-problems">${problems.map(p => `<li>${esc(p)}</li>`).join('')}</ul>` : '';
  if (!items.length) {
    modal(`<div class="qd imp">
      <h2>Nothing to install</h2>
      ${problemList}
      <div class="qd-sub">Supported: Assetto Corsa cars, tracks, skins, apps, CSP and PP filters · ACC liveries · EVO <code>.kspkg</code> and track folders · Rally <code>.pak</code> liveries,
      as files or inside <code>.zip</code>, <code>.rar</code> and <code>.7z</code> archives.</div>
    </div>`, 'modal imp-modal', cleanup);
    return;
  }

  const choices = {};
  for (const kind of new Set(items.map(i => i.carPick).filter(Boolean))) {
    choices[kind] = await carChoices(kind, state.paths, kind === 'ac' ? await getItems(gameByKey('ac'), 'cars').catch(() => []) : []);
  }
  const gameName = key => { const g = gameByKey(key); return `${g.title} ${g.sub || ''}`.trim(); };
  // The cars a livery's design points to (not sure enough to pick one) come first.
  const carOptions = i => {
    const all = choices[i.carPick], likely = (i.likely || []).map(id => all.find(c => c.id === id)).filter(Boolean);
    return [...likely.map(c => ({ ...c, likely: true })), ...all.filter(c => !likely.includes(c))];
  };
  const tag = i => i.missing ? `<span class="imp-tag bad">${esc(i.missing)}</span>`
    : i.exists ? '<span class="imp-tag upd">Update</span>' : '<span class="imp-tag new">New</span>';
  const row = (i, idx) => `<div class="imp-row ${i.missing ? 'off' : ''}" data-row="${idx}">
    <input type="checkbox" data-i="${idx}" ${i.selected && !i.missing ? 'checked' : ''} ${i.missing ? 'disabled' : ''}>
    <div class="imp-thumb">${i.image ? imgTag(i.image, '') : `<img class="imp-logo" src="/img/logos/${i.game}.png" alt="">`}</div>
    <div class="imp-info">
      <b>${esc(i.title)}</b>
      <small>${esc(gameName(i.game))} · ${KIND_LABEL[i.kind] || i.kind}${i.sub ? ` · ${esc(i.sub)}` : ''}</small>
      <code>${esc(i.detail)}</code>
      ${i.note ? `<small class="imp-note">${esc(i.note)}</small>` : ''}
      ${i.carPick ? `<select data-car="${idx}"><option value="">Choose the car for this ${i.kind === 'skin' ? 'skin' : 'livery'}…</option>
        ${carOptions(i).map(c => `<option value="${esc(c.id)}" ${c.id === i.car ? 'selected' : ''}>${esc(c.title)}${i.carPick === 'ac' ? ` (${esc(c.id)})` : ''}${c.likely ? ' · probably' : ''}</option>`).join('')}</select>` : ''}
    </div>
    <span data-tag="${idx}">${tag(i)}</span>
  </div>`;

  const { el } = modal(`<div class="qd imp">
    <header class="qd-head"><h2>Install mods</h2>
      <div class="qd-sub">Found ${items.length} item${items.length > 1 ? 's' : ''}. Each goes to its game's folder; updates are copied over the existing mod.</div>
    </header>
    ${problemList}
    <div class="imp-list">${items.map(row).join('')}</div>
    <footer class="qd-foot">
      <div class="qd-summary" id="imp-note"></div>
      <button class="btn subtle small" data-close>Cancel</button>
      <button class="btn primary small" id="imp-go">Install</button>
    </footer>
  </div>`, 'modal imp-modal', cleanup);

  const selected = () => items.filter((i, idx) => el.querySelector(`[data-i="${idx}"]`)?.checked);
  const refresh = () => {
    const n = selected().length;
    const go = el.querySelector('#imp-go');
    go.textContent = n ? `Install ${n}` : 'Install';
    go.disabled = !n;
  };
  refresh();
  el.querySelector('.imp-list').addEventListener('click', e => {
    const r = e.target.closest('[data-row]');
    if (!r || e.target.closest('input, select')) return;
    const cb = r.querySelector('input[type=checkbox]');
    if (!cb.disabled) { cb.checked = !cb.checked; refresh(); }
  });
  el.querySelector('.imp-list').addEventListener('change', async e => {
    if (e.target.matches('[data-i]')) refresh();
    const sel = e.target.closest('[data-car]');
    if (sel) {
      const i = items[+sel.dataset.car];
      await setItemCar(i, state.paths, sel.value);
      el.querySelector(`[data-row="${sel.dataset.car}"] code`).textContent = i.detail;
      el.querySelector(`[data-row="${sel.dataset.car}"] small`).textContent = `${gameName(i.game)} · ${KIND_LABEL[i.kind] || i.kind}${i.sub ? ` · ${i.sub}` : ''}`;
      el.querySelector(`[data-tag="${sel.dataset.car}"]`).innerHTML = tag(i);
    }
  });

  el.querySelector('#imp-go').onclick = () => {
    const todo = selected();
    const unassigned = todo.find(i => i.carPick && !i.car);
    if (unassigned) { toast(`Choose the car for "${unassigned.title}"`, true); return; }
    handed = true;
    queueInstalls(todo, sessions);
  };
}

// ---------------------------------------------------------------------------
// Install queue. The review's Install hands its mods here, and they install one
// after another in the background: the progress dialog can be hidden at any time
// and the launcher used meanwhile. The title bar's pill shows how far it is and
// opens the dialog again; mods dropped meanwhile wait in line. The staging (the
// extracted archives, the rows' pictures) is discarded once the queue is done.
// Closing the launcher meanwhile asks first (requestExit).

const INST = { list: [], sessions: [], running: false, abort: false, dialog: null, timer: 0 };
const sizeText = n => n >= 1073741824 ? `${(n / 1073741824).toFixed(1)} GB` : n >= 1048576 ? `${Math.round(n / 1048576)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
const instPct = e => (e.total ? Math.floor(e.done / e.total * 100) : 0);

function queueInstalls(items, sessions) {
  INST.list.push(...items.map(item => ({ item, state: 'wait', done: 0, total: 0, started: 0, error: '' })));
  INST.sessions.push(...sessions);
  openInstallDialog();
  installUI();
  if (!INST.running) runInstalls();
}

async function runInstalls() {
  INST.running = true;
  for (let e; !INST.abort && (e = INST.list.find(x => x.state === 'wait'));) {
    e.state = 'run'; e.started = Date.now();
    installUI();
    try {
      await installItem(e.item, (done, total) => {
        if (INST.abort) throw new Error('stopped');
        e.done = done; e.total = total;
        installUI(true);
      });
      e.state = 'done';
    } catch (err) {
      e.state = 'fail'; e.error = err?.message || 'failed';
      if (!INST.abort) log(`install ${e.item.title}: ${err?.stack || err?.message || JSON.stringify(err)}`);
    }
    for (const k of Object.keys(state.cache)) if (k.startsWith(`${e.item.game}:`)) delete state.cache[k];
    installUI();
  }
  INST.running = false;
  if (!INST.abort) installsDone();
}

function installsDone() {
  const list = INST.list.splice(0), wasOpen = !!INST.dialog;
  INST.dialog?.close();
  INST.sessions.splice(0).forEach(discardImport);
  installUI();
  const done = list.filter(e => e.state === 'done').map(e => e.item);
  const failed = list.filter(e => e.state === 'fail').map(e => `${e.item.title}: ${e.error}`);
  if (failed.length) toast(`Could not install ${failed.join('; ')}`, true);
  else if (done.length && done.every(i => i.kind === 'pp filter')) toast(`Installed ${done.map(i => i.title).join(', ')}. Pick it in Settings → Assetto Corsa · Video.`);
  else toast(`Installed ${done.length} mod${done.length > 1 ? 's' : ''}`);
  if (done.some(i => i.game === 'evo' && i.kind === 'track')) evoTrackSync({ force: true });
  if (state.view === 'academy') { AY.data = {}; drawAcademy(); return; }
  // The new mod's tab, if the dialog was watched to the end; otherwise the page
  // being looked at stays, refreshed.
  const first = done.find(i => i.tab);
  if (wasOpen && first) {
    state.game = first.game; state.tab[first.game] = first.tab; state.search = ''; state.view = 'mods';
    saveSettings(); renderSidebar(); render();
  } else if (state.view === 'mods') render();
  else if (state.view === 'settings') renderSettings();
}

// soon: from a progress tick, drawn at most every 120 ms.
function installUI(soon = false) {
  if (soon) {
    if (!INST.timer) INST.timer = setTimeout(() => { INST.timer = 0; installUI(); }, 120);
    return;
  }
  clearTimeout(INST.timer); INST.timer = 0;
  drawInstallPill();
  drawInstallDialog();
}

// "240 MB of 530 MB · about 40 s left", from the item's pace so far.
function installLine(e) {
  if (e.state === 'wait') return 'Waiting for the mods before it';
  if (e.state === 'done') return 'Installed';
  if (e.state === 'fail') return e.error;
  const pack = e.item.mode === 'evo-pack' ? 'Packing for EVO · ' : '';
  if (!e.total) return `${pack || 'Copying · '}starting…`;
  const t = (Date.now() - e.started) / 1000, f = e.done / e.total, rest = t / f - t;
  const left = t < 3 || f < 0.03 || f >= 1 ? '' : rest < 60 ? ` · about ${Math.max(5, Math.round(rest / 5) * 5)} s left` : ` · about ${Math.round(rest / 60)} min left`;
  return `${pack}${sizeText(e.done)} of ${sizeText(e.total)}${left}`;
}

const INST_TAG = { wait: ['wait', 'Waiting'], done: ['new', 'Installed'], fail: ['bad', 'Failed'] };

function openInstallDialog() {
  const { el, close } = modal(`<div class="qd imp">
    <header class="qd-head"><h2>Installing mods</h2><div class="qd-sub" data-q-sub></div></header>
    <div class="imp-list"></div>
    <footer class="qd-foot">
      <div class="qd-summary imp-hint">Hide this to keep using the launcher. The mods go on installing, and the bar at the top shows how far they are.</div>
      <button class="btn subtle small" data-close>Hide</button>
    </footer>
  </div>`, 'modal imp-modal', () => { INST.dialog = null; });
  INST.dialog = { el, close };
  drawInstallDialog();
}

// Rows are added as mods join the queue and updated in place (their pictures
// stay loaded; a moved mod's staging picture is gone, so the game's logo shows).
function drawInstallDialog() {
  const el = INST.dialog?.el;
  if (!el?.isConnected) return;
  const list = el.querySelector('.imp-list'), gameName = key => { const g = gameByKey(key); return `${g.title} ${g.sub || ''}`.trim(); };
  INST.list.forEach((e, idx) => {
    let row = list.querySelector(`[data-q="${idx}"]`);
    if (!row) {
      const i = e.item;
      list.insertAdjacentHTML('beforeend', `<div class="imp-row imp-q" data-q="${idx}">
        <div class="imp-thumb">${i.image ? imgTag(i.image, `/img/logos/${i.game}.png`) : `<img class="imp-logo" src="/img/logos/${i.game}.png" alt="">`}</div>
        <div class="imp-info">
          <b>${esc(i.title)}</b>
          <small>${esc(gameName(i.game))} · ${KIND_LABEL[i.kind] || i.kind}${i.sub ? ` · ${esc(i.sub)}` : ''}</small>
          <small class="imp-q-line"></small>
          <div class="imp-bar"><i></i></div>
        </div>
        <span class="imp-tag"></span>
      </div>`);
      row = list.lastElementChild;
    }
    row.classList.remove('wait', 'run', 'done', 'fail');
    row.classList.add(e.state);
    row.querySelector('.imp-q-line').textContent = installLine(e);
    row.querySelector('.imp-bar i').style.width = `${instPct(e)}%`;
    const [cls, text] = INST_TAG[e.state] || ['run', e.total ? `${instPct(e)}%` : '…'];
    const tag = row.querySelector('.imp-tag');
    tag.className = `imp-tag ${cls}`;
    tag.textContent = text;
  });
  const n = INST.list.length, finished = INST.list.filter(e => e.state === 'done' || e.state === 'fail').length;
  el.querySelector('[data-q-sub]').textContent = n > 1 ? `${finished} of ${n} done. One mod installs at a time.` : 'This can take a while for a big mod.';
}

function drawInstallPill() {
  const pill = $('#install-pill');
  const cur = INST.running && INST.list.find(e => e.state === 'run');
  pill.hidden = !cur;
  if (!cur) return;
  if (!pill.firstChild) pill.innerHTML = '<span class="ip-spin"></span><span class="ip-name"></span><b></b><i></i>';
  const n = INST.list.length, at = INST.list.indexOf(cur) + 1;
  pill.querySelector('.ip-name').textContent = `${n > 1 ? `${at} of ${n} · ` : ''}${cur.item.title}`;
  pill.querySelector('b').textContent = cur.total ? `${instPct(cur)}%` : '…';
  pill.querySelector('i').style.width = `${instPct(cur)}%`;
  pill.title = `Installing ${cur.item.title}: ${installLine(cur)}. Click for the list.`;
}

// EVO's track list (evotracks.js) follows the mod tracks installed: after one is
// installed, enabled, disabled or uninstalled, before EVO starts from here, and at
// startup (a game update replaces content.kspkg, and with it the list). quiet: a
// failure is only logged, as it's tried again next time. force: also after the
// list was restored in Settings, which stops the automatic updates.
async function evoTrackSync({ force = false, quiet = false } = {}) {
  if (!state.paths?.evo?.install || !state.paths.evo.mods) return null;
  try {
    const r = await syncEvoTrackList(state.paths, { force });
    if (r.changed) toast(r.listed.length ? `${r.listed.join(', ')} ${r.listed.length > 1 ? 'are' : 'is'} now in EVO's track list` : "EVO's track list is back to the original");
    return r;
  } catch (err) {
    log(`evo track list: ${err?.stack || err?.message || err}`);
    if (!quiet) toast(`Couldn't update EVO's track list: ${err?.message || err} It's tried again when EVO next starts from the launcher.`, true);
    return null;
  }
}

// Closing the launcher while mods install asks first. Closing anyway stops the
// install at the next file and removes what the unfinished mod left behind
// (installItem's leftovers: a new mod's files, a half-written EVO package).
function requestExit() {
  const cur = INST.running && INST.list.find(e => e.state === 'run');
  if (!cur) return Neutralino.app.exit();
  const after = INST.list.filter(e => e.state === 'wait').length;
  const { el } = modal(`<div class="qd imp">
    <h2>Still installing ${esc(cur.item.title)}</h2>
    <div class="qd-sub">If the launcher closes now, this mod won't be installed${after ? ` and neither will the ${after === 1 ? 'one' : after} after it` : ''}. What it copied so far is removed.</div>
    <footer class="qd-foot">
      <div class="qd-summary"></div>
      <button class="btn subtle small" data-close>Keep installing</button>
      <button class="btn primary small" id="exit-anyway">Close anyway</button>
    </footer>
  </div>`, 'modal imp-modal slim');
  el.querySelector('#exit-anyway').onclick = async e => {
    el.dataset.busy = '1';
    el.querySelectorAll('button').forEach(b => { b.disabled = true; });
    e.currentTarget.textContent = 'Closing…';
    INST.abort = true;
    // A single big file can't be stopped half way: up to 30 s for it to end.
    for (let i = 0; i < 600 && INST.running; i++) await new Promise(r => setTimeout(r, 50));
    if (cur.state !== 'done') for (const p of cur.item.leftovers || []) await Neutralino.filesystem.remove(p).catch(() => {});
    for (const s of INST.sessions) await discardImport(s);
    Neutralino.app.exit();
  };
}

// ---------------------------------------------------------------------------
// Community view

// ---------------------------------------------------------------------------
// Academy: a page per game (AC, EVO, Rally) of events with bronze, silver and
// gold targets (academy.js). Assetto Corsa's "Original" part is Kunos's career
// (levels of series, unlocked in Kunos's order) and special events; EVO and Rally
// have the launcher's own levels (academy-data.js), each opened by medals from
// the one before. An event's window sets the game up and starts it; when the
// game closes, the launcher reads the result, saves the medal and shows it
// (gameClosed). Only drives started here count.

const ACADEMY_GAMES = [['ac', 'Assetto Corsa'], ['evo', 'EVO'], ['rally', 'Rally']];
// The levels and games this version doesn't show yet (academy-data.js) are there in
// the dev build (run from the project folder: run-dev.bat's --load-dir-res), to drive
// and check their targets, and for --check-academy. Released builds hide them.
const ayEvery = () => (window.NL_ARGS || []).some(a => a === '--check-academy' || a === '--load-dir-res');
const ayLater = game => game === 'rally' && !RALLY_RELEASED && !ayEvery();
const AY = { game: '', part: 'original', series: '', special: 'all', missing: false, data: {} };
const AY_KIND = { race: N_('Race'), weekend: N_('Race weekend'), qualify: N_('Qualifying'), hotlap: N_('Hotlap'), timeattack: N_('Time attack'), drift: N_('Drift'), drag: N_('Drag race'), practice: N_('Practice'), timetrial: N_('Time trial'), sprint: N_('Sprint'), stage: N_('Stage') };
const AY_TIER = ['', N_('Bronze'), N_('Silver'), N_('Gold'), N_('Platinum')];
const ayGameOf = key => String(key).split('/')[0];
const ayGameName = game => ({ ac: 'Assetto Corsa', evo: 'EVO', rally: 'Rally' })[game] || game;

Object.assign(SX_ICONS, {
  lock: '<rect x="3.5" y="7.25" width="9" height="6.25" rx="1.25"/><path d="M5.5 7.25V5.5a2.5 2.5 0 0 1 5 0v1.75"/>',
  back: '<path d="M10 3.5 5.5 8l4.5 4.5"/>',
  check: '<path d="M3.5 8.5 6.5 11.5 12.5 4.75"/>',
  play: '<path d="M5 3.25v9.5L12.5 8z" fill="currentColor" stroke="none"/>',
  flag: '<path d="M3.75 14V2.75m0 .5h8l-1.75 2.75 1.75 2.75h-8"/>',
  retry: '<path d="M3 8a5 5 0 1 0 1.5-3.55M3 2.75v2.5h2.5"/>',
  star: '<path d="M8 2.25 9.75 5.9l4 .5-2.95 2.75.75 3.95L8 11.15 4.45 13.1l.75-3.95L2.25 6.4l4-.5z"/>',
});

// { all: every event, career/special (AC) or levels (EVO, Rally) }, loaded once per game.
async function academyData(game, force = false) {
  if (!force && AY.data[game]) return AY.data[game];
  const g = gameByKey(game);
  if (game === 'ac') {
    const [career, special, cars, tracks] = await Promise.all([
      acCareer(state.paths), acSpecialEvents(state.paths),
      getItems(g, 'cars').catch(() => []), getItems(g, 'tracks').catch(() => []),
    ]);
    const byId = (list, id) => list.find(x => x.id.toLowerCase() === String(id || '').toLowerCase());
    for (const ev of [...career.flatMap(s => s.events), ...special]) {
      const c = byId(cars, ev.car), t = byId(tracks, ev.track);
      const l = t && (ev.layout ? t.layouts.find(x => x.id.toLowerCase() === ev.layout.toLowerCase()) : t.layouts[0]);
      ev.carName = c?.title || prettifyId(ev.car);
      ev.carImage = c?.skins?.find(s => s.id.toLowerCase() === ev.skin.toLowerCase())?.image || c?.image || '';
      ev.trackName = l?.name || t?.title || prettifyId(ev.track);
      ev.outline = l?.outline || '';
      ev.missing = !c ? 'car' : !t || !t.playable || !l ? 'track' : '';
    }
    const classes = acClasses({ cars, tracks });
    AY.layouts = await storageGet('academyLayouts', {});
    return (AY.data.ac = { career, special, classes, all: [...career.flatMap(s => s.events), ...special, ...classes.flatMap(c => c.events)] });
  }
  if (game === 'evo') {
    // A car is started by one of its configuration IDs (evolaunch.js): the one driven last, else its first;
    // a sprint's with the mechanical preset Kunos set it with.
    const cacheDir = await evoCacheDir().catch(() => '');
    const pkg = state.paths.evo.install ? `${state.paths.evo.install}/content.kspkg` : '';
    const [cars, tracks, driven, presets] = await Promise.all([
      getItems(g, 'cars').catch(() => []), getItems(g, 'tracks').catch(() => []),
      knownCars(cacheDir).catch(() => []), pkg ? readCarPresets(pkg, cacheDir).catch(() => []) : [],
    ]);
    const known = await withAllConfigs(driven, presets).catch(() => driven);
    const levels = evoAcademy({ cars, tracks, every: ayEvery() });
    const all = levels.flatMap(levelEvents);
    for (const ev of all) {
      const configs = known.find(k => k.carId === ev.car)?.configs || [];
      ev.guid = ((ev.mech && configs.find(c => c.mech === ev.mech)) || configs[0])?.guid || '';
      if (!ev.missing && !ev.guid) ev.missing = 'setup';
    }
    return (AY.data.evo = { levels, all });
  }
  if (game === 'rally') {
    const [cars, tracks] = await Promise.all([getItems(g, 'cars').catch(() => []), getItems(g, 'tracks').catch(() => [])]);
    const car = id => cars.find(c => !c.isMod && c.carId?.toLowerCase() === id.toLowerCase());
    const track = id => tracks.find(t => !t.isMod && t.layouts?.some(l => l.id === id));
    const names = {
      carName: id => car(id)?.title || rallyCarName(id), carImage: id => car(id)?.image || rallyCarImage(id),
      stageName: id => { const st = rallyStage(id); return [st.name || st.stage, st.locationName].filter(Boolean).join(' · '); },
      stageImage: id => track(id)?.image || rallyCover(rallyStage(id).location), stageMap: id => rallyStageMedia(id).map || '',
    };
    const levels = rallyAcademy({ aiTime: rallyAiTime, ...names });
    const all = levels.flatMap(levelEvents);
    for (const ev of all) if (!car(ev.car)) ev.missing = 'car';
    return (AY.data.rally = { levels, all });
  }
  return null;
}
const academyEvent = (d, key) => d?.all.find(e => e.key === key);
const aySeries = (d, key) => d?.career?.find(s => s.key === key);
const ayClass = (d, ev) => ev?.group === 'modded' ? d?.classes?.find(c => c.id === ev.classId) : null;
const ayLevelOf = (d, ev) => d?.levels?.findIndex(l => l.id === ev.level) ?? -1;

// The number an event is marked by (championship rounds: finishing position).
const ayType = ev => ev.goal?.type || 'position';
// One dot per medal the event has (four with platinum).
const medalDots = (tier, count = 3) => `<span class="ay-dots" aria-label="${esc(tier ? tr(AY_TIER[tier]) : tr('No medal'))}">${TIERS.slice(0, count).map((t, i) => `<i class="ay-dot ${t}${tier > i ? ' on' : ''}"></i>`).join('')}</span>`;
// A goal's tier indices, best first.
const tiersDown = goal => goal.tiers.map((_, i) => i).reverse();
const medalDisc = (tier, cls = '') => `<i class="ay-medal ${TIERS[tier - 1] || 'none'} ${cls}"${tier ? ` title="${esc(tr(AY_TIER[tier]))}"` : ''}></i>`; // its name on hover
const ayClock = min => `${String(Math.floor(((min % 1440) + 1440) % 1440 / 60)).padStart(2, '0')}:${String(((min % 60) + 60) % 60).padStart(2, '0')}`;
const ayWeather = ev => ev.game === 'rally' ? tr(RALLY_WEATHERS[ev.weather]?.label || 'Clear') : ev.game === 'evo' ? tr('Clear') : prettifyId(String(ev.weather || '').replace(/^\d+_/, ''));

function ayKindText(ev) {
  const kind = tr(AY_KIND[ev.kind] || ev.kind);
  if (ev.kind === 'race' || ev.kind === 'weekend') return `${kind} · ${trn(ev.laps, '1 lap', '{n} laps')}`;
  if (ev.game === 'rally') return [kind, ev.night ? tr('Night') : '', ev.weather >= 5 ? tr(RALLY_WEATHERS[ev.weather]?.label) : ''].filter(Boolean).join(' · ');
  return kind;
}
// The session in words, for the event window.
function aySessionText(ev, series) {
  const opp = series?.champ ? series.opponents.length : ev.opponents;
  const grid = opp ? trn(opp, '1 opponent', '{n} opponents') : '';
  const ai = ev.skill ? tr('AI {min}–{max}%', { min: ev.skill[0], max: ev.skill[1] }) : '';
  if (ev.game === 'rally') return tr('Free Practice: one run, your stage time counts');
  if (ev.kind === 'timetrial') return ev.flying
    ? tr('Alone on track, {n} min, starting near the line: your best clean lap counts', { n: ev.minutes })
    : tr('Practice, {n} min: your best clean lap counts', { n: ev.minutes });
  if (ev.kind === 'sprint') return tr('From the start arch on the lights: your time to the finish arch counts');
  if (ev.group === 'modded') {
    const ai = tr('AI {n}%', { n: ev.aiLevel });
    if (ev.kind === 'qualify') return [tr('{n} min: your place on the grid counts', { n: ev.minutes }), grid, ai].join(' · ');
    if (ev.kind === 'weekend') return [tr('qualifying {n} min', { n: ev.minutes }), tr('race {n} laps', { n: ev.laps }), grid, ai].join(' · ');
    return [trn(ev.laps, '1 lap', '{n} laps'), grid, ai, tr('from the back')].join(' · ');
  }
  if (ev.kind === 'race') return [trn(ev.laps, '1 lap', '{n} laps'), grid, ai, ev.start ? tr('start {pos}', { pos: scoreText('position', ev.start) }) : ''].filter(Boolean).join(' · ');
  if (ev.kind === 'weekend') {
    if (ev.game === 'evo') return [tr('qualifying {n} min', { n: ev.qualifying }), tr('race {n} laps', { n: ev.laps }), grid, ai].join(' · ');
    const p = ev.sessions.find(s => s.type === 1), q = ev.sessions.find(s => s.type === 2);
    return [p ? tr('practice {n} min', { n: p.minutes }) : '', q ? tr('qualifying {n} min', { n: q.minutes }) : '', tr('race {n} laps', { n: ev.laps }), grid].filter(Boolean).join(' · ');
  }
  return {
    hotlap: tr('Your best clean lap counts'),
    timeattack: tr('Points for each checkpoint you reach in time'),
    drift: tr('Points for your drifts'),
    drag: tr('Best of several runs against one opponent'),
  }[ev.kind] || '';
}
function ayConditions(ev) {
  if (ev.game === 'ac') return `${ayClock(ev.time)} · ${ayWeather(ev)} · ${ev.ambient}°C ${tr('air')}${ev.road ? `, ${ev.road}°C ${tr('road')}` : ''}`;
  return [ayClock(ev.time), ev.night ? tr('night') : '', ayWeather(ev)].filter(Boolean).join(' · ');
}

// ---- The page

function renderAcademy() {
  const ok = k => isInstalled(gameByKey(k));
  AY.game = [AY.game, state.game, 'ac', 'evo', 'rally'].find(k => ACADEMY_GAMES.some(([x]) => x === k) && ok(k)) || 'ac';
  main.innerHTML = `<div class="view scaled academy" data-game="${AY.game}">
    <header class="ay-top">
      <h1>${tr('Academy')}</h1>
      <div class="qd-games">${ACADEMY_GAMES.map(([k, label]) => `<button class="qd-game${k === AY.game ? ' active' : ''}${ok(k) ? '' : ' off'}" data-ay-game="${k}"${ok(k) ? '' : ` title="${esc(tr("{game} isn't installed", { game: label }))}"`}>${esc(tr(label))}</button>`).join('')}</div>
      <div class="ay-tally" id="ay-tally"></div>
    </header>
    <div id="ay-running"></div>
    <div id="ay-page"><div class="loading">${tr('Loading the Academy…')}</div></div>
  </div>`;
  const view = main.querySelector('.view.academy');
  view.addEventListener('click', e => {
    const b = e.target.closest('[data-ay-game], [data-ay], [data-series], [data-ev], [data-ay-special], [data-ay-get], [data-ay-layout], [data-ay-layout-clear]');
    if (!b) return;
    if (b.dataset.ayGet) { openExternal(b.dataset.ayGet); return; }
    if (b.dataset.ayLayout) { saveClassLayout(b.dataset.ayLayout); return; }
    if (b.dataset.ayLayoutClear) { clearClassLayout(b.dataset.ayLayoutClear); return; }
    if (b.dataset.ay === 'install') { pickModFiles(); return; }
    if (b.dataset.ayGame) {
      if (b.classList.contains('off') || b.dataset.ayGame === AY.game) return;
      AY.game = b.dataset.ayGame; AY.series = '';
      renderAcademy();
    } else if (b.dataset.series) { AY.series = b.dataset.series; drawAcademy(true); }
    else if (b.dataset.ev) openAcademyEvent(b.dataset.ev);
    else if (b.dataset.aySpecial) { AY.special = b.dataset.aySpecial; drawAcademy(); }
    else if (b.dataset.ay === 'back') { AY.series = ''; drawAcademy(true); }
    else if (b.dataset.ay === 'part') { AY.part = b.dataset.part; drawAcademy(); }
    else if (b.dataset.ay === 'missing') { AY.missing = !AY.missing; drawAcademy(); }
    else if (b.dataset.ay === 'restart') restartSeries(b);
  });
  drawAcademy();
}

// Draws the current game's page into #ay-page (top: scroll back up, for a new page).
async function drawAcademy(top = false) {
  const game = AY.game;
  if (!$('#ay-page')) return;
  drawAcademyRunning();
  if (ayLater(game)) {
    $('#ay-tally').innerHTML = '';
    $('#ay-page').innerHTML = `<div class="ay-empty">${esc(tr("Rally's Academy comes in a later version: its targets are being checked stage by stage."))}</div>`;
    return;
  }
  let d;
  try { d = await academyData(game); } catch (err) { log(`academy ${game}: ${err?.stack || err}`); }
  const p = await academyProgress();
  const page = $('#ay-page');
  if (state.view !== 'academy' || AY.game !== game || !page) return;
  if (!d?.all.length) {
    page.innerHTML = `<div class="ay-empty">${game === 'ac' ? tr("Assetto Corsa's career and special events weren't found in its content folder.") : tr("The Academy couldn't read {game}'s cars and tracks. Check its folder in Settings.", { game: ayGameName(game) })}</div>`;
    return;
  }
  $('#ay-tally').innerHTML = ayTallyHTML(d.all.filter(e => e.goal && !e.missing), p, game);
  if (game === 'ac') {
    const s = AY.series && aySeries(d, AY.series);
    page.innerHTML = s ? aySeriesHTML(s, d, p) : acAcademyHTML(d, p);
  } else page.innerHTML = ayLevelsHTML(game, d, p);
  if (top) main.querySelector('.view.academy')?.scrollTo(0, 0);
}

// DR (the driver level) and SR (the safety rating), in the look of the cards over
// the game (css/overlay.css): a slanted plate (the level in red, the grade in its
// colour) beside a bar to the next step, which is named at the bar's end. `big`:
// the result window's.
const ayLevelPlate = (level, big = false) => `<span class="ay-plate lv${big ? ' big' : ''}">${level}</span>`;
const ayGradePlate = (sr, big = false) => `<span class="ay-plate g-${srGrade(sr).toLowerCase()}${big ? ' big' : ''}">${srGrade(sr)}</span>`;
const SR_NEXT = { E: 'D', D: 'C', C: 'B', B: 'A', A: 'S' };
// The bar: filled to `at` (0 to 1); `from` (before this event): what it lost shows
// red, what it gained brighter. `next`: the step at its end.
function ayStepBar(at, next, from = at) {
  const pc = n => `${(Math.max(0, Math.min(1, n)) * 100).toFixed(1)}%`, lo = Math.min(at, from), hi = Math.max(at, from);
  return `<span class="ay-step"><span class="ay-step-bar"><i class="fill" style="width:${pc(lo)}"></i>${hi > lo ? `<i class="${at < from ? 'lost' : 'won'}" style="left:${pc(lo)};width:${pc(hi - Math.max(0, lo))}"></i>` : ''}</span>${next ? `<em>${esc(String(next))}</em>` : ''}</span>`;
}
// DR's bar: the points into this level, to the next one. from: the points before this event.
const ayDrBar = (dl, from = dl.into) => ayStepBar(dl.into / dl.need, dl.level + 1, from / dl.need);
// SR's bar: through this grade, to the next one (full at S). from: the rating before this event.
function aySrBar(to, from = to) {
  const g = srGrade(to), next = SR_NEXT[g], min = srGradeMin(g), span = next ? srGradeMin(next) - min : 1;
  return ayStepBar(next ? (to - min) / span : 1, next, next ? (from - min) / span : 1);
}
const ayDrTitle = dl => tr('DR, your driver level: {level}. {into} of {need} points to level {next}. Bronze 1, silver 2, gold 3, platinum 5, in every game.', { level: dl.level, into: dl.into, need: dl.need, next: dl.level + 1 });
function aySrTitle(sr) {
  const next = SR_NEXT[srGrade(sr)];
  return [tr('SR, your safety rating: {n} of 99, grade {g}.', { n: sr, g: srGrade(sr) }), next ? tr('{n} more to {g}.', { n: srGradeMin(next) - sr, g: next }) : '',
    tr('In Academy races and weekends: impacts, wheels off the track, cuts and penalties take it down, clean laps raise it.')].filter(Boolean).join(' ');
}

function ayTallyHTML(events, p, game) {
  const n = [0, 0, 0, 0, 0];
  for (const e of events) n[eventTier(p, e.key)]++;
  const shown = events.some(e => e.goal?.tiers.length > 3) ? [4, 3, 2, 1] : [3, 2, 1];
  // DR: every game's medals. EVO's page: SR too.
  const dl = driverLevel(p), sr = srOf(p);
  return `<span class="ay-stat" title="${esc(ayDrTitle(dl))}">
      ${ayLevelPlate(dl.level)}
      <span class="ay-stat-text"><small>DR</small>${ayDrBar(dl)}</span>
    </span>
    ${game === 'evo' ? `<span class="ay-stat" title="${esc(aySrTitle(sr))}">
      ${ayGradePlate(sr)}
      <span class="ay-stat-text"><small>SR<em>${sr}</em></small>${aySrBar(sr)}</span>
    </span>` : ''}
    ${shown.map(t => `<span class="ay-count" title="${esc(tr(AY_TIER[t]))}">${medalDisc(t)}<b>${n[t]}</b></span>`).join('')}
    <span class="ay-tally-of">${esc(tr('{n} of {total} events with a medal', { n: n[1] + n[2] + n[3] + n[4], total: events.length }))}</span>`;
}

// While an Academy event runs: what's being driven, and the game's Close button.
function drawAcademyRunning() {
  const el = $('#ay-running');
  if (!el) return;
  const game = ['ac', 'evo', 'rally'].find(k => launches[k]?.academy && isUp(k));
  const a = game && launches[game].academy, ev = a ? academyEvent(AY.data[game], a.key) : null;
  if (!ev) { el.innerHTML = ''; return; }
  const targets = ev.goal && ev.goal.type !== 'ai' ? ev.goal.tiers.map((v, i) => `${tr(AY_TIER[i + 1])} ${goalValue(ev.goal.type, v)}`).reverse().join(' · ') : '';
  const hint = {
    ac: tr('Drive it, then close Assetto Corsa: the launcher reads your result and gives your medal.'),
    evo: tr("In EVO, open Single Player: this event is set up, press Start. Drive it, then close EVO: the launcher reads your result."),
    rally: tr('In Rally, open Free Practice: this stage, car, time and weather are set, press Start. Drive the stage, then close Rally: the launcher reads your time.'),
  }[game];
  el.innerHTML = `<section class="ay-running">
    <div class="ay-running-img">${imgTag(ev.carImage, ev.image)}</div>
    <div class="ay-running-text">
      <small class="ay-live"><i></i>${tr('Event in progress')} · ${esc(ayGameName(game))}</small>
      <b>${esc(ev.name)}</b>
      <span>${esc([ev.carName, ev.trackName, a.ai ? tr('AI {n}%', { n: a.ai }) : '', targets].filter(Boolean).join(' · '))}</span>
      <span class="ay-running-hint">${esc(hint)}</span>
    </div>
    <button class="btn small primary" data-launch-game="${game}">${tr('Close')}</button>
  </section>`;
  syncRunning(el);
}

// The next thing to drive: the event started last in this game (until it has
// gold, then the next one of its series or level), else the first open one.
function ayContinueHTML(game, d, p) {
  let ev = academyEvent(d, p.lastBy?.[game] || (ayGameOf(p.last) === game ? p.last : ''));
  const started = !!ev;
  const open = e => !e.missing && (game === 'ac' ? !(e.series && seriesLocked(aySeries(d, e.series), d.career, p))
    : !levelLocked(d.levels, ayLevelOf(d, e), p) && !(e.bonus && bonusLocked(d.levels[ayLevelOf(d, e)], p)));
  if (game === 'ac' && AY.part === 'modded') {
    const cls = ayClass(d, ev);
    if (!cls) ev = null;
    else if (eventTier(p, ev.key) === 3) ev = cls.events.find(e => !e.missing && !classEventLocked(cls, e, p) && eventTier(p, e.key) < 3) || null;
    if (!ev) ev = d.classes.flatMap(c => c.events.filter(e => !e.missing && !classEventLocked(c, e, p))).find(e => eventTier(p, e.key) < 3);
  } else if (game === 'ac') {
    if (ev?.group === 'modded') ev = null;
    const s = ev?.series && aySeries(d, ev.series);
    if (s?.champ) { const r = nextRound(s, p); ev = r >= 0 ? s.events[r] : null; }
    else if (ev && eventTier(p, ev.key) === 3) ev = s ? s.events.find(e => eventTier(p, e.key) < 3) : null;
    if (!ev) ev = d.career.filter(x => !seriesLocked(x, d.career, p)).flatMap(x => (x.champ ? [x.events[nextRound(x, p)]].filter(Boolean) : x.events)).find(e => !e.missing && eventTier(p, e.key) < 3);
  } else {
    if (ev && eventTier(p, ev.key) >= 3) ev = levelEvents(d.levels[ayLevelOf(d, ev)]).find(e => open(e) && eventTier(p, e.key) < 3) || null;
    if (!ev) ev = d.all.find(e => open(e) && eventTier(p, e.key) < 3);
  }
  if (!ev) return '';
  const series = game === 'ac' && ev.series && aySeries(d, ev.series), level = game !== 'ac' && d.levels[ayLevelOf(d, ev)], cls = ayClass(d, ev);
  const group = series ? series.name : level ? tr(level.name) : cls ? tr(cls.name) : '', list = (series || level || cls)?.events;
  const st = p.events[ev.key];
  // Where it is in its series or level: a step per event, in the colour of the medal won.
  const steps = group ? `<span class="ay-steps">${list.map(e => `<i class="${e === ev ? 'now' : TIERS[eventTier(p, e.key) - 1] || ''}"></i>`).join('')}</span>` : '';
  const where = ev.bonus ? tr('Bonus event') : group ? tr('Event {n} of {total}', { n: ev.index + 1, total: list.length }) : tr('Special event');
  return `<button class="ay-continue" data-ev="${esc(ev.key)}">
    <div class="ay-continue-bg">${imgTag(ev.image, ev.carImage)}</div>
    <div class="ay-continue-body">
      <small class="ay-continue-kicker"><em>${esc(started ? tr('Continue') : tr('Start here'))}</em>${group ? ` · ${esc(group)}` : ''}</small>
      <b class="ay-continue-name">${esc(tr(ev.name))}</b>
      <span class="ay-continue-meta">${esc([ev.carName, ev.trackName, ayKindText(ev)].join(' · '))}</span>
      <span class="ay-continue-progress">${steps}<span>${esc(where)}${st?.best != null ? ` · ${esc(tr('your best {v}', { v: scoreText(ayType(ev), st.best) }))}` : ''}</span></span>
    </div>
    <span class="ay-continue-go btn small primary">▶ ${esc(started ? tr('Continue') : tr('Start'))}</span>
  </button>`;
}

function ayEventCard(ev, p, { n = 0, locked = '', round = null } = {}) {
  const st = p.events[ev.key], tier = st?.tier || 0;
  const best = st?.best != null ? tr('Best {v}', { v: scoreText(ayType(ev), st.best) }) : '';
  const note = ev.missing ? tr({ car: 'Needs the car', track: 'Needs the track', setup: 'Open the car in EVO once' }[ev.missing]) : locked || '';
  const foot = round
    ? `<span class="ay-round-res">${round.pos ? `${esc(scoreText('position', round.pos))} · +${round.points} ${tr('pts')}` : esc(tr('Not finished'))}</span>`
    : ev.goal ? medalDots(tier, ev.goal.tiers.length) : '';
  return `<button class="ay-ev${note ? ' locked' : ''}${round ? ' driven' : ''}" data-ev="${esc(ev.key)}">
    <div class="ay-ev-img">${imgTag(ev.image, ev.carImage)}${n ? `<span class="ay-num">${n}</span>` : ''}<span class="ay-kind">${esc(ayKindText(ev))}</span></div>
    <div class="ay-ev-body">
      <b>${esc(tr(ev.name))}</b>
      <small>${esc(`${ev.carName} · ${ev.trackName}`)}</small>
      <div class="ay-ev-foot">${foot}<span class="ay-ev-note">${note ? `${sxIcon('lock')}${esc(note)}` : esc(round ? '' : best || tr('Not driven'))}</span></div>
    </div>
  </button>`;
}

// ---- Assetto Corsa: the home page

function acAcademyHTML(d, p) {
  const seg = `<div class="qd-seg ay-part">${[['original', tr('Original')], ['modded', tr('Modded')]].map(([id, label]) => `<button data-ay="part" data-part="${id}" class="${AY.part === id ? 'active' : ''}">${esc(label)}</button>`).join('')}</div>`;
  if (AY.part === 'modded') {
    const lead = tr("Classes made for the launcher with mods from their makers, on Kunos's own tracks. Install a class's cars, then drive its events in order: each one opens with a medal in the one before. Medals come from where you qualify and finish against the AI.");
    return `<div class="ay-bar">${seg}<p class="ay-lead">${esc(lead)}</p></div>
      ${ayContinueHTML('ac', d, p)}
      ${d.classes.map(c => ayClassHTML(c, p)).join('')}`;
  }
  const lead = tr("Kunos's own career and special events, with their targets. Only drives started here count.");
  return `<div class="ay-bar">${seg}<p class="ay-lead">${esc(lead)}</p></div>
    ${ayContinueHTML('ac', d, p)}
    ${AC_LEVELS.map(level => {
      const list = d.career.filter(s => s.level === level.id);
      if (!list.length) return '';
      const done = list.filter(s => seriesState(s, p).done).length;
      return `<section class="ay-level">
        <div class="ay-level-head"><h3>${esc(tr(level.name))}</h3><small>${esc(tr('{n} of {total} series done', { n: done, total: list.length }))}</small></div>
        <div class="ay-series-grid">${list.map(s => aySeriesCard(s, d, p)).join('')}</div>
      </section>`;
    }).join('')}
    ${aySpecialHTML(d, p)}`;
}

function aySeriesCard(s, d, p) {
  const locked = seriesLocked(s, d.career, p), st = seriesState(s, p);
  const needs = locked ? s.requires.map(id => d.career.find(x => x.id === id)?.name || id) : [];
  const foot = locked
    ? `<span class="ay-needs">${sxIcon('lock')}${esc(tr('Finish {list}', { list: needs.join(s.requiresAny ? tr(' or ') : ', ') }))}</span>`
    : s.champ
      ? `<span class="ay-pts"><b>${st.points}</b> / ${s.goal.points || '—'} ${tr('pts')}</span><span>${esc(tr('Round {n} of {total}', { n: Math.min(st.rounds + 1, s.events.length), total: s.events.length }))}</span>`
      : `<span class="ay-counts">${[3, 2, 1].map(t => `<span class="ay-count">${medalDisc(t)}${st.medals[t - 1]}</span>`).join('')}</span>`;
  return `<button class="ay-series${locked ? ' locked' : ''}${st.done ? ' done' : ''}" data-series="${esc(s.key)}">
    <div class="ay-series-img">${imgTag(s.banner, s.image)}<span class="ay-code">${esc(s.code)}</span>${st.done ? `<span class="ay-state">${sxIcon('check')}${tr('Done')}</span>` : ''}</div>
    <div class="ay-series-body">
      <b>${esc(s.name)}</b>
      <small>${esc(s.champ ? trn(s.events.length, 'Championship · 1 round', 'Championship · {n} rounds') : trn(s.events.length, '1 event', '{n} events'))}</small>
      <div class="ay-series-foot">${foot}</div>
    </div>
  </button>`;
}

function aySpecialHTML(d, p) {
  const kinds = ['hotlap', 'race', 'timeattack', 'drift', 'drag'];
  const have = d.special.filter(e => !e.missing), missing = d.special.length - have.length;
  const shown = (AY.missing ? d.special : have).filter(e => AY.special === 'all' || e.kind === AY.special);
  const done = have.filter(e => eventTier(p, e.key)).length;
  return `<section class="ay-level ay-special">
    <div class="ay-level-head"><h3>${tr('Special events')}</h3><small>${esc(tr('{n} of {total} with a medal', { n: done, total: have.length }))}</small>
      <div class="qd-seg">${['all', ...kinds].map(k => `<button data-ay-special="${k}" class="${AY.special === k ? 'active' : ''}">${esc(k === 'all' ? tr('All') : tr(AY_KIND[k]))}</button>`).join('')}</div>
    </div>
    <div class="ay-ev-grid">${shown.map(e => ayEventCard(e, p)).join('') || `<div class="ay-none">${tr('None of this kind.')}</div>`}</div>
    ${missing ? `<p class="ay-missing-note">${esc(trn(missing, '1 more needs a car or track you don\'t have (DLC).', '{n} more need cars or tracks you don\'t have (DLC).'))} <button class="ay-link" data-ay="missing">${AY.missing ? tr('Hide them') : tr('Show them')}</button></p>` : ''}
  </section>`;
}

// ---- Assetto Corsa: Modded classes

function ayClassHTML(c, p) {
  const have = c.cars.filter(m => m.installed).length, medals = c.events.filter(e => eventTier(p, e.key)).length;
  const layout = AY.layouts?.[c.id];
  return `<section class="ay-level ay-class">
    <div class="ay-level-head"><h3>${esc(tr(c.name))}</h3><small>${esc(tr(c.blurb))}</small>
      <span class="ay-level-state">${have ? esc(tr('{n} of {total} with a medal', { n: medals, total: c.events.length })) : `${sxIcon('lock')}${esc(tr('Install one of its cars to start'))}`}</span></div>
    <div class="ay-mods">
      ${c.cars.map(m => `<div class="ay-mod${m.installed ? ' have' : ''}">
        <span class="ay-mod-mark">${sxIcon(m.installed ? 'check' : 'import')}</span>
        <div class="ay-mod-text"><b>${esc(m.installed ? m.title : m.name)}</b><small>${esc([m.author, m.free ? tr('free') : m.paid ? tr('paid') : '', m.installed ? tr('installed') : ''].filter(Boolean).join(' · '))}</small></div>
        ${m.installed ? '' : `<button class="btn small subtle" data-ay-get="${esc(m.get)}" title="${esc(m.get)}">${tr('Get it')} ↗</button>`}
      </div>`).join('')}
    </div>
    <div class="ay-mod-tools">
      ${have < c.cars.length ? `<button class="btn small subtle" data-ay="install" title="${esc(tr('Pick the file you downloaded (.zip, .rar, .7z): the launcher installs it. Dropping it on the window works too.'))}">${sxIcon('import')}${tr('Install a downloaded mod…')}</button>` : ''}
      <button class="btn small subtle" data-ay-layout="${c.id}" title="${esc(tr('Saves the AC apps you have open now and where they are. {cls} events start with them, and your own layout comes back when AC closes.', { cls: tr(c.name) }))}">${sxIcon('duplicate')}${layout ? tr('Replace its app layout') : tr('Save my app layout for {cls}', { cls: tr(c.name) })}</button>
      ${layout ? `<span class="ay-layout-note">${sxIcon('check')}${esc(tr('{cls} events use their own app layout, saved {when}.', { cls: tr(c.name), when: timeAgo(layout.at / 1000) }))}</span><button class="ay-link" data-ay-layout-clear="${c.id}">${tr('Remove it')}</button>` : ''}
    </div>
    <div class="ay-ev-grid">${c.events.map((e, n) => ayEventCard(e, p, { n: n + 1, locked: !have ? tr('Needs a car') : classEventLocked(c, e, p) ? tr('After event {n}', { n }) : '' })).join('')}</div>
  </section>`;
}

// A class's app layout: AC's acos.ini (Kunos, Python and Lua app windows) and
// python.ini (which Python apps are on), saved in the launcher's storage.
async function saveClassLayout(id) {
  const cfg = state.paths.ac.cfg;
  const acos = await readText(join(cfg, 'acos.ini')), python = await readText(join(cfg, 'python.ini'));
  if (acos == null) { toast(tr("AC hasn't saved an app layout yet: drive once, place your apps, and try again."), true); return; }
  AY.layouts = { ...(await storageGet('academyLayouts', {})), [id]: { acos, python, at: Date.now() } };
  await storageSet('academyLayouts', AY.layouts);
  toast(tr('Saved: these events start with the apps you have open now.'));
  drawAcademy();
}
async function clearClassLayout(id) {
  AY.layouts = await storageGet('academyLayouts', {});
  delete AY.layouts[id];
  await storageSet('academyLayouts', AY.layouts);
  drawAcademy();
}
// Before a class event: the player's own layout is kept aside and the class's put in place.
async function applyClassLayout(id) {
  const lay = (await storageGet('academyLayouts', {}))[id];
  if (!lay) return '';
  const cfg = state.paths.ac.cfg;
  if (!(await storageGet('academyLayoutRestore', null))) {
    await storageSet('academyLayoutRestore', { acos: await readText(join(cfg, 'acos.ini')), python: await readText(join(cfg, 'python.ini')), at: Date.now() });
  }
  if (lay.acos != null) await writeText(join(cfg, 'acos.ini'), lay.acos);
  if (lay.python != null) await writeText(join(cfg, 'python.ini'), lay.python);
  log(`academy: app layout of ${id} in place`);
  return id;
}
// After AC closes (or at startup, when the launcher was closed meanwhile): what AC
// saved goes back to the class (apps moved during the event stay moved), then the
// player's own layout comes back.
async function restoreClassLayout(id = '') {
  const own = await storageGet('academyLayoutRestore', null);
  if (!own) return;
  const cfg = state.paths.ac.cfg;
  if (id) {
    const layouts = await storageGet('academyLayouts', {});
    if (layouts[id]) {
      layouts[id] = { acos: (await readText(join(cfg, 'acos.ini'))) ?? layouts[id].acos, python: (await readText(join(cfg, 'python.ini'))) ?? layouts[id].python, at: layouts[id].at };
      await storageSet('academyLayouts', layouts);
      AY.layouts = layouts;
    }
  }
  if (own.acos != null) await writeText(join(cfg, 'acos.ini'), own.acos);
  if (own.python != null) await writeText(join(cfg, 'python.ini'), own.python);
  await storageSet('academyLayoutRestore', null);
  log('academy: own app layout back');
}

// ---- Assetto Corsa: a series

function aySeriesHTML(s, d, p) {
  const locked = seriesLocked(s, d.career, p), st = seriesState(s, p);
  const level = AC_LEVELS.find(l => l.id === s.level);
  const next = s.champ ? nextRound(s, p) : -1, rounds = p.rounds[s.key] || [];
  const status = locked
    ? `${sxIcon('lock')}${esc(tr('Locked: finish {list} first.', { list: s.requires.map(id => d.career.find(x => x.id === id)?.name || id).join(s.requiresAny ? tr(' or ') : ', ') }))}`
    : st.done ? `${sxIcon('check')}${esc(tr('Done: the series it opens are unlocked.'))}`
    : s.champ ? esc(tr('{points} points so far, {rank} in the standings.', { points: st.points, rank: scoreText('position', st.rank) })) : '';
  const cards = s.events.map((e, i) => {
    if (!s.champ) return ayEventCard(e, p, { n: i + 1, locked: locked ? tr('Series locked') : '' });
    const lockedRound = locked ? tr('Series locked') : i > next && next >= 0 ? tr('After round {n}', { n: i }) : '';
    return ayEventCard(e, p, { n: i + 1, locked: next === -1 || i < rounds.length ? '' : lockedRound, round: rounds[i] || null });
  }).join('');
  return `<div class="ay-sp">
    <button class="ay-back" data-ay="back">${sxIcon('back')}${tr('Academy')}</button>
    <header class="ay-sp-head">
      <div class="ay-sp-img">${imgTag(s.banner, s.image)}</div>
      <div class="ay-sp-text">
        <small class="sx-kicker">${esc([tr(level?.name || ''), s.code].filter(Boolean).join(' · '))}</small>
        <h2>${esc(s.name)}</h2>
        ${s.description ? `<p>${esc(s.description)}</p>` : ''}
        <div class="ay-goal">${sxIcon('trophy')}<span><b>${esc(tr('Goal'))}:</b> ${esc(seriesGoalText(s))}</span></div>
        ${status ? `<div class="ay-sp-status${st.done ? ' done' : ''}">${status}</div>` : ''}
      </div>
    </header>
    <div class="ay-sp-body${s.champ ? ' champ' : ''}">
      <div class="ay-ev-grid">${cards}</div>
      ${s.champ ? ayStandingsHTML(s, p) : ''}
    </div>
  </div>`;
}

function ayStandingsHTML(s, p) {
  const rows = standings(s, p), rounds = (p.rounds[s.key] || []).length;
  return `<aside class="ay-standings">
    <h4>${tr('Standings')}<small>${esc(tr('after {n} of {total} rounds', { n: rounds, total: s.events.length }))}</small></h4>
    <ol>${rows.map((r, i) => `<li class="${r.player ? 'you' : ''}"><span class="pos">${i + 1}</span><span class="name">${esc(r.player ? tr('You') : r.name)}</span><span class="pts">${r.points}</span></li>`).join('')}</ol>
    <small class="ay-points-table">${esc(tr('Points: {list}', { list: s.points.join(', ') }))}</small>
    ${rounds ? `<button class="btn small subtle" data-ay="restart">${sxIcon('retry')}<span>${tr('Restart championship')}</span></button>` : ''}
  </aside>`;
}

async function restartSeries(b) {
  const s = aySeries(AY.data.ac, AY.series);
  if (!s) return;
  if (!b.dataset.armed) {
    b.dataset.armed = '1';
    b.querySelector('span').textContent = tr('Click again: clears its rounds');
    setTimeout(() => { if (b.isConnected && b.dataset.armed) { delete b.dataset.armed; b.querySelector('span').textContent = tr('Restart championship'); } }, 4000);
    return;
  }
  await restartChampionship(s);
  drawAcademy();
}

// ---- EVO and Rally: levels

function ayLevelsHTML(game, d, p) {
  const unlock = d.levels.find(l => l.unlock)?.unlock;
  const lead = game === 'evo'
    ? unlock ? tr("Time trials and races with EVO's current cars, and Kunos's own academy sprints. The AI gets stronger with each level, and a level opens with {n} medals from the one before.", { n: unlock })
      : tr("Time trials and races with EVO's current cars, and Kunos's own academy sprints. More levels come in later versions.")
    : tr("Stages from front-wheel drive classics to Rally2. Targets are Rally's own: its AI time for the car and stage, with the game's medal margins.");
  return `<div class="ay-bar"><p class="ay-lead">${esc(lead)}</p></div>
    ${ayContinueHTML(game, d, p)}
    ${d.levels.map((level, i) => {
      const locked = levelLocked(d.levels, i, p), medals = levelMedals(level, p), from = levelBefore(d.levels, i);
      const need = locked ? ayLockText(level, from, p) : '';
      return `<section class="ay-level${locked ? ' locked' : ''}">
        <div class="ay-level-head"><h3>${esc(tr(level.name))}</h3><small>${esc(tr(level.blurb))}</small>
          <span class="ay-level-state">${locked ? `${sxIcon('lock')}${esc(need)}` : esc(tr('{n} of {total} with a medal', { n: medals, total: level.events.length }))}</span></div>
        <div class="ay-ev-grid">${level.events.map((e, n) => ayEventCard(e, p, { n: n + 1, locked: locked ? tr('Level locked') : '' })).join('')}</div>
        ${level.bonus ? ayBonusHTML(level, p) : ''}
      </section>`;
    }).join('')}`;
}

// What a locked level still needs: medals in the one before, a safety rating grade.
function ayLockText(level, from, p) {
  const medals = from && levelMedals(from, p) < level.unlock, sr = srShort(level, p);
  const srText = tr('safety rating {grade} (yours: {now})', { grade: level.srGrade, now: `${srGrade(srOf(p))} ${srOf(p)}` });
  return medals && sr ? tr('Opens with {n} medals in {level} ({have} so far) and {sr}', { n: level.unlock, level: tr(from.name), have: levelMedals(from, p), sr: srText })
    : medals ? tr('Opens with {n} medals in {level} ({have} so far)', { n: level.unlock, level: tr(from.name), have: levelMedals(from, p) })
    : tr('Opens with {sr}', { sr: srText });
}

// A level's bonus event: a strip under its six, dimmed until all six have gold.
function ayBonusHTML(level, p) {
  const ev = level.bonus, locked = bonusLocked(level, p), st = p.events[ev.key];
  const state = locked ? `${sxIcon('lock')}${esc(tr('Gold on all six to unlock · {n} of {total} so far', { n: levelGolds(level, p), total: level.events.length }))}`
    : ev.missing ? esc(tr({ car: 'Needs the car', track: 'Needs the track', setup: 'Open the car in EVO once' }[ev.missing]))
    : `${ev.goal ? medalDots(st?.tier || 0, ev.goal.tiers.length) : ''}<span>${esc(st?.best != null ? tr('Best {v}', { v: scoreText(ayType(ev), st.best) }) : tr('Not driven'))}</span>`;
  return `<button class="ay-bonus${locked ? ' locked' : ''}" data-ev="${esc(ev.key)}">
    <div class="ay-bonus-img">${imgTag(ev.image, ev.carImage)}</div>
    <span class="ay-bonus-tag">${sxIcon('star')}${esc(tr('Bonus'))}</span>
    <div class="ay-bonus-text"><b>${esc(tr(ev.name))}</b><small>${esc([ev.carName, ev.trackName, ayKindText(ev)].join(' · '))}</small></div>
    <span class="ay-bonus-state">${state}</span>
  </button>`;
}

// ---- An event's window

async function openAcademyEvent(key) {
  const game = ayGameOf(key);
  if (ayLater(game)) return;
  const d = await academyData(game), p = await academyProgress();
  const ev = academyEvent(d, key);
  if (!ev) return;
  const series = game === 'ac' && ev.series ? aySeries(d, ev.series) : null, cls = ayClass(d, ev);
  const li = game === 'ac' ? -1 : ayLevelOf(d, ev), level = li >= 0 ? d.levels[li] : null;
  // Class events: the player drives any installed car of the class (the last one picked first).
  const classCars = cls ? cls.cars.filter(m => m.installed) : [];
  let carPick = cls ? (classCars.find(m => m.id === state.settings.academyCars?.[cls.id]) || classCars[0])?.id : '';
  const pickedCar = () => classCars.find(m => m.id === carPick);
  const round = series?.champ ? nextRound(series, p) : -1;
  const st = p.events[ev.key], tier = st?.tier || 0, type = ayType(ev);
  const driven = series?.champ ? (p.rounds[series.key] || [])[ev.index] : null;
  const where = list => list.map(id => d.career.find(x => x.id === id)?.name || id).join(series?.requiresAny ? tr(' or ') : ', ');
  // Why it can't be started, if it can't.
  const blocker = !isInstalled(gameByKey(game)) ? tr("{game} isn't installed.", { game: `${gameByKey(game).title} ${gameByKey(game).sub || ''}`.trim() })
    : ev.missing === 'car' && !cls ? tr(game === 'ac' ? "You don't have this car ({id})." : "This car isn't in your {game} ({id}).", { id: ev.car, game: ayGameName(game) })
    : ev.missing === 'track' ? tr(game === 'ac' ? "You don't have this track ({id})." : "This track isn't in your {game} ({id}).", { id: [ev.track, ev.layout].filter(Boolean).join(' / '), game: ayGameName(game) })
    : ev.missing === 'setup' ? tr("EVO hasn't set this car up yet: start EVO and open its car list once, then it can be pre-selected.")
    : cls && !classCars.length ? tr('Install one of the {cls} cars first: the Academy page lists them with where to get them.', { cls: tr(cls.name) })
    : cls && classEventLocked(cls, ev, p) ? tr('Win a medal in event {n} first: the events of a class open in order.', { n: ev.index })
    : series && seriesLocked(series, d.career, p) ? tr('This series is locked: finish {list} first.', { list: where(series.requires) })
    : level && levelLocked(d.levels, li, p) ? `${tr('This level is locked.')} ${ayLockText(level, levelBefore(d.levels, li), p)}.`
    : ev.bonus && bonusLocked(level, p) ? tr('The bonus event opens with gold or better on all {total} events of {level}: you have {n}.', { total: level.events.length, level: tr(level.name), n: levelGolds(level, p) })
    : series?.champ && round !== ev.index ? (driven ? tr('Round {n} is driven. Restart the championship to drive it again.', { n: ev.index + 1 }) : tr('Drive round {n} first: championship rounds go in order.', { n: round + 1 }))
    : !ev.goal && !series?.champ ? tr("There's no reference time for this car and stage, so it can't give medals.")
    : '';
  // AI-level goals: the player picks the level (the next medal up by default).
  let ai = ev.goal?.type === 'ai' ? ev.goal.tiers[Math.min(tier, 2)] : 0;
  const kicker = series ? (series.champ ? tr('{series} · round {n} of {total}', { series: series.name, n: ev.index + 1, total: series.events.length }) : tr('{series} · event {n} of {total}', { series: series.name, n: ev.index + 1, total: series.events.length }))
    : level && ev.bonus ? tr('{series} · bonus event', { series: tr(level.name) })
    : level ? tr('{series} · event {n} of {total}', { series: tr(level.name), n: ev.index + 1, total: level.events.length })
    : cls ? tr('{series} · event {n} of {total}', { series: tr(cls.name), n: ev.index + 1, total: cls.events.length })
    : tr('Special event · {kind}', { kind: tr(AY_KIND[ev.kind]) });
  const facts = [
    [tr('Car'), cls ? pickedCar()?.title || tr('One of the class cars') : ev.carName],
    [game === 'rally' ? tr('Stage') : tr('Track'), ev.trackName],
    [game === 'rally' ? tr('Session') : tr(AY_KIND[ev.kind] || 'Session'), aySessionText(ev, series)],
    [tr('Conditions'), ayConditions(ev)],
  ];
  const hint = blocker || {
    ac: cls
      ? tr('Assetto Corsa starts straight on track, with the AI in the other {cls} cars. Drive it, then close the game: the launcher reads your result. Your Quick Drive assists are used.', { cls: tr(cls.name) })
      : tr('Assetto Corsa starts straight on track with this event. Drive it, then close the game: the launcher reads your result. Your Quick Drive assists are used.'),
    evo: ev.kind === 'timetrial'
      ? ev.flying
        ? tr("EVO starts on its menu with this event set up: open Single Player and press Start. It's a race on your own: you start on the lights just before the line, and after the short run to it every lap is a flying one. Drive until the time runs out, or close EVO when you're done: the launcher keeps your best clean lap. Only this car on this track counts.")
        : tr('EVO starts on its menu with this event set up: open Single Player and press Start. Drive it, then close EVO: the launcher reads your best lap. Only this car on this track counts.')
      : ev.kind === 'sprint'
        ? tr("EVO starts on its menu with this event set up: open Single Player and press Start. Go on green and through the finish arch, then close EVO: the launcher reads your time from EVO's log. EVO's clock keeps running after the arch; restart from the pause menu for another try, your best counts.")
        : tr("EVO starts on its menu with this event set up: open Single Player and press Start. Drive it, then close EVO: the launcher reads your result. Only this car on this track counts, against this AI."),
    rally: tr("Rally starts with Free Practice set to this stage, car, time and weather: open Free Practice and press Start. When you close Rally, a new stage record with this car, in this weather, is your result."),
  }[game];
  const targetsHTML = () => {
    if (series?.champ) {
      const rows = standings(series, p).slice(0, 6);
      return `<div class="ay-targets champ"><h5>${tr('Championship')}<small>${esc(tr('Goal: {goal}', { goal: seriesGoalText(series) }))}</small></h5>
        ${driven ? `<div class="ay-target"><span>${tr('Your result')}</span><b>${driven.pos ? `${esc(scoreText('position', driven.pos))} · +${driven.points} ${tr('pts')}` : esc(tr('Not finished'))}</b></div>` : ''}
        <div class="ay-target"><span>${tr('Points for 1st to last')}</span><b>${esc(series.points.join(' · '))}</b></div>
        <ol class="ay-mini-standings">${rows.map((r, i) => `<li class="${r.player ? 'you' : ''}"><span>${i + 1}</span><span>${esc(r.player ? tr('You') : r.name)}</span><b>${r.points}</b></li>`).join('')}</ol></div>`;
    }
    if (!ev.goal) return '';
    const note = ev.goal.type === 'ai' ? tr('Win the race. Pick the AI level you race against:') : game === 'rally' && ev.ref ? tr("Rally's AI time here is {t}.", { t: lapTime(ev.ref) }) : '';
    return `<div class="ay-targets"><h5>${tr('Targets')}${note ? `<small>${esc(note)}</small>` : ''}</h5>
      ${tiersDown(ev.goal).map(i => {
        const v = ev.goal.tiers[i], have = tier > i;
        const pick = ev.goal.type === 'ai';
        return `<${pick ? 'button' : 'div'} class="ay-target${pick && v === ai ? ' picked' : ''}${have ? ' have' : ''}"${pick ? ` data-ai="${v}"` : ''}>
          ${medalDisc(i + 1)}<b>${esc(goalValue(ev.goal.type, v))}</b>${have ? `<small class="ay-have" title="${esc(tr('Won'))}">${sxIcon('check')}</small>` : ''}
        </${pick ? 'button' : 'div'}>`;
      }).join('')}
    </div>`;
  };
  const { el, close } = modal(`
    <header class="qd-head ay-ev-head">
      <small class="sx-kicker">${esc(kicker)}</small>
      <h2>${esc(tr(ev.name))}</h2>
    </header>
    <div class="ay-ev-cols">
      <div class="ay-ev-left">
        <div class="ay-ev-pic" id="ay-ev-pic">${imgTag(cls ? pickedCar()?.image || ev.image : ev.carImage, ev.image)}</div>
        <div class="ay-ev-track">${ev.outline ? `<img class="overlay ay-outline${game === 'rally' ? ' color' : ''}" src="${esc(ev.outline)}" alt="" data-err="remove">` : ''}<div><b>${esc(ev.trackName)}</b><small>${esc(ev.carName)}</small></div></div>
        ${ev.description && ev.group !== 'special' ? `<p class="ay-ev-desc">${esc(tr(ev.description))}</p>` : ''}
      </div>
      <div class="ay-ev-right">
        ${classCars.length > 1 ? `<div class="ay-carpick"><small>${tr('Your car')}</small><div class="qd-seg">${classCars.map(m => `<button data-ay-car="${esc(m.id)}" class="${m.id === carPick ? 'active' : ''}">${esc(m.title)}</button>`).join('')}</div></div>` : ''}
        <div class="ay-facts">${facts.map(([k, v], i) => `<div class="ay-fact"${i === 0 ? ' id="ay-fact-car"' : ''}><small>${esc(k)}</small><span>${esc(v)}</span></div>`).join('')}</div>
        <div id="ay-targets">${targetsHTML()}</div>
        ${st?.best != null && !series?.champ ? `<div class="ay-best"><span>${tr('Your best')}</span>${medalDisc(tier)}<b>${esc(scoreText(type, st.best))}</b><small>${esc(trn(st.tries || 1, '1 try', '{n} tries'))}</small></div>` : ''}
        <p class="ay-ev-hint${blocker ? ' warn' : ''}">${esc(hint)}</p>
      </div>
    </div>
    <footer class="ay-ev-foot-bar">
      <button class="btn small subtle" data-close>${tr('Back')}</button>
      <button class="btn small primary" id="ay-start" data-launch-game="${game}" ${blocker ? 'disabled' : ''}>${sxIcon('play')}${series?.champ ? tr('Start round') : tr('Start event')}</button>
    </footer>`, 'modal ay-modal');
  el.addEventListener('click', e => {
    const c = e.target.closest('[data-ay-car]');
    if (c) {
      carPick = c.dataset.ayCar;
      el.querySelectorAll('[data-ay-car]').forEach(x => x.classList.toggle('active', x.dataset.ayCar === carPick));
      el.querySelector('#ay-fact-car span').textContent = pickedCar()?.title || '';
      el.querySelector('#ay-ev-pic').innerHTML = imgTag(pickedCar()?.image || ev.image, ev.image);
      return;
    }
    const b = e.target.closest('[data-ai]');
    if (!b) return;
    ai = Number(b.dataset.ai);
    el.querySelectorAll('[data-ai]').forEach(x => x.classList.toggle('picked', Number(x.dataset.ai) === ai));
  });
  syncRunning(el);
  el.querySelector('#ay-start').onclick = async () => {
    const go = el.querySelector('#ay-start');
    if (game === 'evo') primeChime(); // the card's chime may sound only after a click here
    go.disabled = true;
    try {
      if (cls) { state.settings.academyCars = { ...(state.settings.academyCars || {}), [cls.id]: carPick }; saveSettings(); }
      const launch = await startAcademyEvent(ev, { ai, series, cls, car: pickedCar() });
      if (!launch) { go.disabled = false; return; }
      const pNow = await academyProgress();
      nextLaunch[game] = { academy: { key: ev.key, ai, driver: driverLevel(pNow), sr: srOf(pNow), ...launch } };
      markStarting(game);
      if (game === 'evo') academyWatch(ev, launches[game]);
      await setLastEvent(ev.key);
      toast(tr('Starting {name}…', { name: tr(ev.name) }));
    } catch (err) {
      toast(err.message || tr('Could not start {game}', { game: ayGameName(game) }), true);
      go.disabled = false;
      return;
    }
    close();
    if (state.view === 'academy') drawAcademy();
    if (state.settings.minimizeOnLaunch) setTimeout(() => Neutralino.window.minimize(), 1500);
  };
}

// Sets the game up for an event and starts it. Returns what the result needs to
// know later (merged into the launch), or null when the player backed out.
async function startAcademyEvent(ev, { ai = 0, series = null, cls = null, car = null } = {}) {
  if (ev.game === 'ac' && cls) {
    const skin = car.skins[0]?.id || '';
    const csp = await readCsp(state.paths).catch(() => null);
    const base = await readAcSession(state.paths, csp).catch(() => defaultAcSession());
    const max = Math.max(1, Math.min(ev.pitboxes || 20, 63) - 1);
    const grid = classGrid(cls, Math.min(ev.opponents, max), car.id, skin);
    const layout = await applyClassLayout(cls.id);
    try {
      await quickDrive(state.paths, { car: car.id, skin, skins: car.skins.map(s => s.id), track: ev.track, layout: ev.layout, session: classSession(ev, base), maxOpponents: max, csp, grid });
    } catch (err) { if (layout) await restoreClassLayout(); throw err; }
    return { car: car.id, layout };
  }
  if (ev.game === 'ac') {
    await startAcEvent(state.paths, ev, { ai, opponents: series?.champ ? series.opponents : null });
    return {};
  }
  if (ev.game === 'evo') {
    const session = evoSessionFor(ev, defaultEvoSession());
    await evoTrackSync({ quiet: true });
    await launchEvo({ steamPath: state.steamPath, installDir: state.paths.evo.install, session, track: ev.evoTrack, layout: ev.evoLayout, carGuid: ev.guid });
    return {};
  }
  if (ev.game === 'rally') {
    const g = gameByKey('rally');
    if (!(await rallyPreflight(g))) return null;
    const loc = rallyStage(ev.stage).location, weather = rallyWeatherFor(loc, ev.weather);
    const save = await readRallySave(state.paths).catch(() => null);
    const liveries = await rallySelectedLiveries(state.paths).catch(() => ({}));
    const w = save?.weather && { ...save.weather, weather, forecast: weather, dynamic: false, speed: 0, grip: 4, wetness: weather >= 5 && weather <= 7 ? 70 : 0, snow: weather >= 8 ? 70 : 0 };
    // The record with this car on this stage in this weather before the run: a better one afterwards is the result.
    const wt = RALLY_WEATHER_IDS[weather];
    const before = (await rallyRecords(state.paths).catch(() => [])).filter(r => r.stage === ev.stage && r.car.toLowerCase() === ev.car.toLowerCase() && r.weather === wt).reduce((m, r) => Math.min(m, r.ms), Infinity);
    await writeRallySession(state.paths, { stage: ev.stage, car: ev.car, seconds: ev.time * 60, livery: liveries[ev.car] || ev.car, weather: w });
    await openExternal(steamUrls.run(g.appid));
    return { weather: wt, before: Number.isFinite(before) ? before : null };
  }
  return null;
}

// ---- After the game closes

// A game closed after an Academy start: its result, the medal saved, and the window that says so.
async function academyClosed(game, l) {
  const d = await academyData(game), p = await academyProgress();
  const ev = academyEvent(d, l.academy.key);
  if (!ev) return;
  const name = tr(ev.name);
  // The driver level when the event started: results saved over the game may have raised it.
  const driverFrom = l.academy.driver || driverLevel(p);
  // The safety rating when an EVO race or weekend started (it changes while EVO races).
  const srFrom = game === 'evo' && (ev.kind === 'race' || ev.kind === 'weekend') ? l.academy.sr ?? null : null;
  const levelUpToast = () => {
    const now = driverLevel(p);
    if (now.level > driverFrom.level) toast(tr('Driver level {n}! Your medals took you up from level {was}.', { n: now.level, was: driverFrom.level }));
    if (srFrom != null && srOf(p) !== srFrom) toast(tr('Safety rating {grade} {n} ({change})', { grade: srGrade(srOf(p)), n: srOf(p), change: srChange(srOf(p) - srFrom) }));
  };
  let r = null;
  if (game === 'ac') {
    r = await readAcResult(state.paths, ev, l.at - 5000);
    if (!r || (!r.laps && !r.points && !r.wins && !r.pos)) r = null;
  } else if (game === 'evo' && ev.kind === 'sprint') {
    r = await readEvoSprint(join(state.paths.evo.profiles.replace(/\/[^/]+$/, ''), 'Logs'), ev, l.at - 5000);
    // Runs already saved and shown over EVO (academyWatch) aren't saved again.
    // Runs not counted there (EVO marked them invalid) are among the handled ones.
    // The rest came with the log's last block, as EVO closed: EVO's live data
    // still says which of them it marked invalid (l.academy.voidAt).
    const live = l.academy.live || 0, saved = live - (l.academy.liveVoid || 0);
    const late = r.found.slice(live), rest = late.filter(x => !l.academy.voidAt?.(x.at)).map(x => x.ms);
    if (late.length > rest.length) log(`academy ${ev.key}: ${late.length - rest.length} run(s) EVO marked invalid, not saved`);
    if (!rest.length) {
      if (saved) toast(trn(saved, '{name}: 1 run saved, your best is {v}.', '{name}: {n} runs saved, your best is {v}.', { name, v: lapTime(p.events[ev.key]?.best) }));
      else if (live || late.length) toast(tr("{name}: no run counted: EVO marked them invalid.", { name }));
      else toast(r.mismatch && !r.files ? tr("{name}: EVO was driven with another {what}, so it doesn't count.", { name, what: r.mismatch === 'car' ? tr('car') : tr('track') }) : tr('No result from {name}: no run reached the finish arch, so nothing was saved.', { name }));
      levelUpToast();
      return;
    }
    r = { ...r, times: rest, ms: Math.min(...rest), runs: rest.length, laps: rest.length };
  } else if (game === 'evo') {
    // Results already saved and shown over EVO (academyWatch) aren't saved again.
    const shown = l.academy.liveFiles || [];
    r = await readEvoResult(join(state.paths.evo.profiles.replace(/\/[^/]+$/, ''), 'Results'), ev, l.at - 5000, new Set(shown));
    // A flying time trial: the best clean lap seen live counts (its race's file may count
    // the run to the line or a cut lap, and a race left early may save none).
    if (ev.flying && l.academy.liveBest && !r.mismatch) r = { ...r, ms: l.academy.liveBest, laps: Math.max(r.laps, l.academy.liveLaps || 0), files: r.files || 1 };
    if (!r.files) {
      if (!shown.length) toast(r.mismatch ? tr("{name}: EVO was driven with another {what}, so it doesn't count.", { name, what: r.mismatch === 'car' ? tr('car') : tr('track') }) : tr('No result from {name}: nothing was driven, so nothing was saved.', { name }));
      levelUpToast();
      return;
    }
    // The AI made easier in EVO's menu: the run doesn't count.
    if (ev.kind !== 'timetrial' && await evoAiEasier(ev)) {
      toast(tr("{name}: the AI was changed in EVO's menu, so the race doesn't count.", { name }), true);
      return;
    }
  } else if (game === 'rally') {
    const rec = (await rallyRecords(state.paths).catch(() => []))
      .filter(x => x.stage === ev.stage && x.car.toLowerCase() === ev.car.toLowerCase() && x.weather === l.academy.weather && (l.academy.before == null || x.ms < l.academy.before))
      .sort((a, b) => a.ms - b.ms)[0];
    if (!rec) {
      toast(tr('{name}: no new stage record with this car in this weather, so nothing was saved. Only a time that beats your best there counts.', { name }));
      return;
    }
    r = { ms: rec.ms, penalty: rec.penalty, laps: 1 };
  }
  log(`academy result ${ev.key}: ${JSON.stringify(r && { ...r, names: undefined })}`);
  if (!r) { toast(tr('No result from {name}: nothing was driven, so nothing was saved.', { name })); return; }
  const series = game === 'ac' && ev.series ? aySeries(d, ev.series) : null;
  const openBefore = game === 'ac' ? new Set(d.career.filter(s => !seriesLocked(s, d.career, p)).map(s => s.key)) : new Set(d.levels.filter((x, i) => !levelLocked(d.levels, i, p)).map(x => x.key));
  const bonusBefore = new Set((d.levels || []).filter(x => x.bonus && !bonusLocked(x, p)).map(x => x.key));
  const doneBefore = series && seriesState(series, p).done;
  const res = await recordResult(ev, r, { ai: l.academy.ai, series });
  if (!res) return;
  const unlocked = game === 'ac' ? d.career.filter(s => !openBefore.has(s.key) && !seriesLocked(s, d.career, p)).map(s => s.name)
    : [...d.levels.filter((x, i) => !openBefore.has(x.key) && !levelLocked(d.levels, i, p)).map(x => tr(x.name)),
      ...d.levels.filter(x => x.bonus && !bonusBefore.has(x.key) && !bonusLocked(x, p)).map(x => tr('Bonus event: {name}', { name: tr(x.bonus.name) }))];
  const finished = series && !doneBefore && seriesState(series, p).done;
  if (state.view === 'academy') drawAcademy();
  showAcademyResult(ev, r, res, { series, unlocked, finished, ai: l.academy.ai, p, driver: { from: driverFrom, to: driverLevel(p) }, sr: srFrom != null ? { from: srFrom, to: srOf(p) } : null });
}

const srChange = n => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '±0');

// SR in the result window: its grade, the rating and how much the event changed it,
// on its bar.
function aySrHTML({ from, to }) {
  const d = to - from, next = SR_NEXT[srGrade(to)];
  return `<div class="ay-result-stat" title="${esc(aySrTitle(to))}">
    ${ayGradePlate(to, true)}
    <div>
      <span class="ay-result-stat-head"><small>SR</small><b>${to}</b>${d ? `<em class="${d < 0 ? 'down' : 'up'}">${srChange(d)}</em>` : ''}</span>
      ${aySrBar(to, from)}
      <small>${esc([d < 0 ? tr('Impacts, cuts and penalties in this event') : d > 0 ? tr('Clean laps in this event') : tr('A clean drive keeps it, clean laps raise it'), next ? tr('{n} more to {g}', { n: srGradeMin(next) - to, g: next }) : ''].filter(Boolean).join(' · '))}</small>
    </div>
  </div>`;
}

// DR in the result window: the points this event brought, and a level gained
// since the event started.
function ayDriverHTML({ from, to }) {
  const up = to.level > from.level, gained = to.points - from.points;
  return `<div class="ay-result-stat${up ? ' up' : ''}" title="${esc(ayDrTitle(to))}">
    ${ayLevelPlate(to.level, true)}
    <div>
      <span class="ay-result-stat-head"><small>DR</small>${up ? `<b>${esc(tr('Level up!'))}</b>` : ''}${gained > 0 ? `<em class="up">${esc(trn(gained, '+1 point', '+{n} points'))}</em>` : ''}</span>
      ${ayDrBar(to, up ? 0 : from.into)}
      <small>${esc(tr('{into} of {need} points to level {next}', { into: to.into, need: to.need, next: to.level + 1 }))}</small>
    </div>
  </div>`;
}

function showAcademyResult(ev, r, res, { series, unlocked = [], finished = false, ai = 0, p, driver = null, sr = null }) {
  const type = res.type;
  const champ = series?.champ;
  const tier = champ ? 0 : res.gained;
  const d = AY.data[ev.game], level = ev.level && d?.levels ? d.levels[ayLevelOf(d, ev)] : null;
  const title = champ ? (r.pos ? tr('Finished {pos}', { pos: scoreText('position', r.pos) }) : tr('Not finished'))
    : tier ? tr(AY_TIER[tier]) : tr('No medal this time');
  const scoreLine = champ ? (r.pos ? tr('+{n} points', { n: res.points }) : tr('Retired before the flag: no points'))
    : type === 'ai' ? (r.pos ? tr('Finished {pos} against AI {n}%', { pos: scoreText('position', r.pos), n: ai }) : tr('Not finished'))
    : type === 'position' ? (r.pos ? tr('Finished {pos}', { pos: scoreText('position', r.pos) }) : r.dsq ? tr('Disqualified') : tr('Not finished'))
    : res.score != null ? scoreText(type, res.score) : type === 'time' ? tr('No clean lap') : '';
  const was = res.prevBest, now = res.score;
  const sub = champ ? '' : [
    now == null ? '' : was == null ? tr('First result') : betterScore(type, was, now) === now && now !== was ? tr('New personal best (was {v})', { v: scoreText(type, was) }) : tr('Your best is {v}', { v: scoreText(type, was) }),
    r.penalty ? tr('{s} s of penalties included', { s: (r.penalty / 1000).toFixed(1) }) : '',
  ].filter(Boolean).join(' · ');
  const list = series ? series.events : level ? level.events : null;
  // After a level's last event, its bonus once open.
  const next = (list && list[ev.index + 1]) || (level?.bonus && !ev.bonus && !bonusLocked(level, p) && eventTier(p, level.bonus.key) < 3 ? level.bonus : null);
  const standing = champ ? seriesState(series, p) : null;
  const notes = [
    finished ? `${sxIcon('trophy')}<span>${esc(tr('{series} is done.', { series: series.name }))}</span>` : '',
    unlocked.length ? `${sxIcon('lock')}<span>${esc(tr('Unlocked: {list}', { list: unlocked.join(', ') }))}</span>` : '',
  ].filter(Boolean);
  const { el, close } = modal(`
    <div class="ay-result">
      <small class="sx-kicker">${esc([series?.name || (level && tr(level.name)), tr(ev.name)].filter(Boolean).join(' · '))}</small>
      <div class="ay-result-medal ${champ ? 'champ' : TIERS[tier - 1] || 'none'}">${sxIcon(champ ? 'flag' : 'trophy')}</div>
      <h2>${esc(title)}</h2>
      ${scoreLine ? `<b class="ay-result-score">${esc(scoreLine)}</b>` : ''}
      ${sub ? `<span class="ay-result-sub">${esc(sub)}</span>` : ''}
      ${!champ && ev.goal ? `<div class="ay-result-tiers">${tiersDown(ev.goal).map(i => {
        const got = res.gained > i, had = res.before > i;
        return `<div class="${got ? 'got' : ''}">${medalDisc(i + 1)}<span>${esc(goalValue(ev.goal.type, ev.goal.tiers[i]))}</span><small>${got && !had ? tr('Earned now') : had ? tr('Already yours') : '—'}</small></div>`;
      }).join('')}</div>` : ''}
      ${champ ? `<div class="ay-result-tiers">
        <div><span>${esc(tr('Championship points'))}</span><small>${standing.points} / ${series.goal.points || '—'}</small></div>
        <div><span>${esc(tr('Standings'))}</span><small>${esc(tr('{pos} after {n} of {total} rounds', { pos: scoreText('position', standing.rank), n: standing.rounds, total: series.events.length }))}</small></div>
      </div>` : ''}
      ${driver ? ayDriverHTML(driver) : ''}
      ${sr ? aySrHTML(sr) : ''}
      ${notes.length ? `<div class="ay-result-notes">${notes.map(n => `<div>${n}</div>`).join('')}</div>` : ''}
      <div class="ay-result-actions">
        <button class="btn small subtle" data-close>${tr('Close')}</button>
        ${champ ? '' : `<button class="btn small subtle" data-r="again">${sxIcon('retry')}${tr('Try again')}</button>`}
        ${next ? `<button class="btn small primary" data-r="next">${champ ? tr('Next round') : tr('Next event')}</button>` : ''}
      </div>
    </div>`, 'modal ay-result-modal');
  el.addEventListener('click', e => {
    const b = e.target.closest('[data-r]');
    if (!b) return;
    close();
    openAcademyEvent(b.dataset.r === 'next' ? next.key : ev.key);
  });
}

// ---- EVO: each result over the game as it comes

// While EVO runs an event started from the Academy, the launcher reads what EVO
// adds to its newest log every WATCH_TICK ms. A sprint's run is there the moment
// the car crosses the finish arch (sprintReader), and so are a race's finish
// (raceReader) and a time trial's laps (lapReader); any session's result when EVO saves it, logged as
// `SessionResults saved into "<results file>"` (a race some 11 s after the
// player's finish, once the field is in; a practice when it ends). Each is shown
// on a card over the game: a small window of its own process (overlay.html,
// always on top, started hidden with the event) that reads what to show from
// util.js overlayFile, with a sound from the launcher's window (chime.js). A
// race's card comes at the finish line, a time trial's at each lap's line; the
// result is saved from EVO's file, with a card then only if it came out different. When EVO closes, academyClosed
// only saves what this didn't.
const WATCH_TICK = 100, OVERLAY_BEAT = 5000;
// The result banner (css/overlay.css) is 520 px wide and about 90 tall; it sits
// OVERLAY_TOP of the way down the screen, under the game's own top HUD, and its
// window reaches up to the screen's top edge, which it slides down from. The
// safety rating's tile, on the right edge half way down, is 104 by about 200.
const OVERLAY_TOP = 0.12;
const OVERLAY_BASE = { title: 'Assetto Launcher', minWidth: 100, minHeight: 80, borderless: true, transparent: true, alwaysOnTop: true, skipTaskbar: true, hidden: true, resizable: false, exitProcessOnClose: true, enableInspector: false };
const overlayTopPx = () => Math.round(screen.height * OVERLAY_TOP);
const overlayWindow = () => ({ ...OVERLAY_BASE, width: Math.ceil(580 * devicePixelRatio), height: Math.ceil((overlayTopPx() + 150) * devicePixelRatio) });
const overlaySrWindow = () => ({ ...OVERLAY_BASE, width: Math.ceil(170 * devicePixelRatio), height: Math.ceil(250 * devicePixelRatio) });
let watch = null;

// o: a card window's state, { overlay (its file), sid, n, beat }: the watch's own
// (the result card), or its `sr.ov` (the safety rating's).
async function overlaySend(o, msg) {
  if (!o?.overlay) return;
  o.n++; o.beat = Date.now();
  await writeText(o.overlay, JSON.stringify({ ...msg, sid: o.sid, n: o.n, at: Date.now() })).catch(err => log(`overlay: ${err?.message || err}`));
}

// The card, and the sound with it.
async function overlayShow(s, card) {
  if (!s.overlay) return;
  await overlaySend(s, { show: card, seconds: state.settings.academyCardSeconds || 8 });
  if (state.settings.academyCardSound !== false) playChime().catch(() => {});
}

// A card window of its own process, told what to show through its file (side: '' or 'right').
async function overlayOpen(o, side) {
  try {
    o.overlay = await overlayFile(side);
    await overlaySend(o, { beat: true });
    await Neutralino.window.create(side ? `/overlay.html?side=${side}` : `/overlay.html?top=${overlayTopPx()}`, side ? overlaySrWindow() : overlayWindow());
  } catch (err) { log(`academy card ${side}: ${err?.message || err}`); o.overlay = ''; }
}

async function academyWatch(ev, l) {
  watchStop();
  const s = watch = { ev, l, reader: ev.kind === 'sprint' ? sprintReader(ev) : null, race: ev.kind === 'race' ? raceReader(ev) : null, laps: ev.kind === 'timetrial' ? lapReader(ev) : null, early: null, texts: new Set(), gfx: false, validity: [], liveRuns: [], runs: [], finishAt: ev.kind === 'sprint' ? archFinish(ev) : null, liveLaps: false, telStop: null, dir: join(state.paths.evo.profiles.replace(/\/[^/]+$/, ''), 'Logs'), file: '', pos: 0, rest: '', decoder: new TextDecoder(), look: 0, n: 0, beat: 0, overlay: '', clock: null, busy: false, sid: Date.now() };
  l.academy.live = 0; l.academy.liveVoid = 0; l.academy.liveFiles = []; l.academy.liveBest = 0; l.academy.liveLaps = 0;
  l.academy.voidAt = at => sprintVoid(s, at); // for the runs the log gives only when EVO closes (academyClosed)
  const cards = state.settings.academyCard !== false;
  if (cards) await overlayOpen(s, '');
  // Races and weekends: the safety rating, from EVO's live data and the log.
  if (ev.kind === 'race' || ev.kind === 'weekend') {
    s.sr = { reader: srReader(), active: false, lost: false, cutAt: 0, offAt: 0, hitAt: 0, hitCost: 0, ov: { overlay: '', sid: s.sid, n: 0, beat: 0 } };
    if (cards) await overlayOpen(s.sr.ov, 'right');
  }
  // EVO's live data: the safety rating's impacts and cuts, and laps the moment
  // they're done (liveDataLap).
  s.telStop = await startTelemetry(e => evoLive(s, e), undefined, undefined, { pos: ev.kind === 'sprint' }).catch(err => { log(`evo telemetry: ${err?.message || err}`); return null; });
  if (s.stopped) { s.telStop?.(); return; } // stopped while the helper started: watchStop didn't have it
  // The clock runs in a worker: with the game in front, the web view slows this
  // page's own timers (to once a minute after a few minutes), not a worker's.
  s.clock = new Worker(URL.createObjectURL(new Blob([`setInterval(() => postMessage(0), ${WATCH_TICK});`], { type: 'text/javascript' })));
  s.clock.onmessage = () => { if (!s.busy) watchTick(); };
}

function watchStop() {
  const s = watch;
  if (!s) return;
  watch = null; s.stopped = true;
  s.clock?.terminate();
  s.telStop?.();
  for (const o of [s, s.sr?.ov]) if (o?.overlay) writeText(o.overlay, JSON.stringify({ quit: true, sid: o.sid, n: o.n + 1, at: Date.now() })).catch(() => {});
}

// ---- The safety rating while EVO races (academy.js srReader, srLoss; evotelemetry.js)

// The safety rating's tile (overlay-card.js): down, lit by how much (1: green, 2
// or 3: amber, more: red), or up.
const srCard = n => ({ sr: n > 0 ? { dir: 'up', level: 1 } : { dir: 'down', level: n >= -1 ? 1 : n >= -3 ? 2 : 3 } });
const SR_CUT_GAP = 8000; // a cut and what EVO says of it (a penalty, the lap marked invalid) are one thing
const SR_HIT_GAP = 2000; // impacts less than this apart are one incident (taps while rubbing, a car bouncing off)

// What an impact costs on top of its incident so far: an incident costs its worst
// impact, once. sr: { hitAt, hitCost }, now: ms.
function srHitExtra(sr, e, now) {
  const n = srLoss(e), same = now - sr.hitAt < SR_HIT_GAP;
  sr.hitAt = now;
  const extra = same ? Math.max(0, n - sr.hitCost) : n;
  sr.hitCost = same ? Math.max(sr.hitCost, n) : n;
  return extra;
}

// What EVO's live data says (evotelemetry.js): laps for the cards, the rest for
// the safety rating.
function evoLive(s, e) {
  if (e.t === 'open') log('evo telemetry: reading EVO\'s live data');
  else if (e.t === 'gfx') { s.gfx = !!e.ok; log(`evo telemetry: lap validity ${e.ok ? 'read' : `not read (${e.why})`}`); }
  else if (e.t === 'pos') sprintPos(s, e);
  else if (e.t === 'valid') {
    log(`evo telemetry: lap ${e.v ? 'valid' : 'invalid'}`);
    s.validity.push({ at: Date.now(), v: e.v }); // for a sprint's run (sprintVoid)
    if (s.validity.length > 400) s.validity.splice(0, 200); // the last runs' are enough
  }
  else if (e.t === 'lap') liveDataLap(s, e).catch(err => log(`academy live lap: ${err?.message || err}`));
  else if (s.sr) srTelemetry(s, e);
}

// From EVO's live data: an impact, wheels off the track (a cut if the lap was
// marked invalid then), a lap marked invalid, while the rating counts.
function srTelemetry(s, e) {
  const sr = s.sr;
  if (!sr.active || s.stopped) return;
  if (e.t === 'hit') srLose(s, srHitExtra(sr, e, Date.now()), e.d < 8 ? tr('Light contact') : e.d < 18 ? tr('Contact') : tr('Heavy contact'), e);
  else if (e.t === 'off' && !e.cut) { sr.offAt = Date.now(); srLose(s, srLoss(e), tr('Track limits'), e); }
  else srCut(s, e);
}

// A corner cut, from the live data or (when that can't say) the log: once per
// cut, less what going off the track there already took.
function srCut(s, e) {
  const sr = s.sr, now = Date.now();
  if (now - sr.cutAt < SR_CUT_GAP) return;
  sr.cutAt = now;
  srLose(s, srLoss({ t: 'cut' }) - (now - sr.offAt < SR_CUT_GAP ? srLoss({ t: 'off' }) : 0), tr('Corner cut'), e);
}

// From the log: the green (it counts from then), the end, laps, penalties, cuts.
async function srLog(s, e) {
  const sr = s.sr;
  if (e.t === 'green') { sr.active = true; sr.lost = false; }
  else if (e.t === 'stop') sr.active = false;
  else if (e.t === 'cut' && sr.active && !s.gfx) srCut(s, e);
  else if (e.t === 'penalty' && e.jump) await srLose(s, srLoss(e), tr('Jump start'), e);
  else if (e.t === 'penalty' && sr.active && Date.now() - sr.cutAt >= SR_CUT_GAP) await srLose(s, srLoss(e), tr('Penalty'), e);
  else if (e.t === 'lap' && sr.active) {
    if (!sr.lost) {
      const now = await changeSR(1);
      log(`academy sr +1 clean lap: ${now}`);
      await overlaySend(sr.ov, { show: srCard(1), seconds: 3 });
    }
    sr.lost = false;
  }
}

// A loss: saved, and its tile on the right (no sound).
async function srLose(s, n, reason, e) {
  if (n <= 0) return;
  s.sr.lost = true;
  const now = await changeSR(-n);
  log(`academy sr -${n} ${reason} ${JSON.stringify(e)}: ${now}`);
  await overlaySend(s.sr.ov, { show: srCard(-n), seconds: 3 });
}

// What the log has gained since the last read, read up to its real end (the size
// Windows reports for a file another program is writing can lag behind).
async function logAppend(s) {
  const buf = await Neutralino.filesystem.readBinaryFile(s.file, { pos: s.pos }).catch(() => null);
  if (!buf?.byteLength) return '';
  s.pos += buf.byteLength;
  return s.decoder.decode(buf, { stream: true });
}

// When EVO started, from its log's name (log-yymmdd-hhmmss, local time); 0 if it isn't one.
const evoLogStart = f => {
  const m = /^log-(\d\d)(\d\d)(\d\d)-(\d\d)(\d\d)(\d\d)/i.exec(f);
  return m ? new Date(2000 + +m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() : 0;
};

async function watchTick() {
  const s = watch;
  if (!s || s.stopped) return;
  s.busy = true;
  try {
    for (const o of [s, s.sr?.ov]) if (o?.overlay && Date.now() - o.beat > OVERLAY_BEAT) await overlaySend(o, { beat: true });
    if (!s.file && Date.now() >= s.look) {
      // This session's log: EVO's newest, started since the launch. Its name is the time
      // EVO started (log-yymmdd-hhmmss); the last session's log, still being written
      // moments before when EVO was closed just before the launch, isn't it.
      s.look = Date.now() + 1000;
      const f = (await listDir(s.dir)).map(e => e.entry).filter(e => /^log-.*\.txt$/i.test(e)).sort().pop();
      if (f && evoLogStart(f) >= s.l.at - 5000) { s.file = join(s.dir, f); log(`academy watch: reading ${f}`); }
    } else if (s.file && Date.now() >= s.look) {
      // EVO started again (a newer log): this event's session is over, whether or not
      // this launcher saw EVO close (a minimized launcher checks seldom, and another
      // launcher window may have started the new one). Its live data is the new
      // session's now, so the watch ends.
      s.look = Date.now() + 3000;
      const f = (await listDir(s.dir)).map(e => e.entry).filter(e => /^log-.*\.txt$/i.test(e)).sort().pop();
      if (f && evoLogStart(f) > evoLogStart(basename(s.file))) {
        log(`academy watch: EVO started again (${f}), ${s.ev.key}'s watch ends`);
        watchStop();
        return;
      }
    }
    if (s.file) {
      const text = await logAppend(s);
      if (text) {
        const lines = (s.rest + text).split('\n');
        s.rest = lines.pop();
        if (s.sr) for (const e of s.sr.reader.feed(`${lines.join('\n')}\n`)) if (!s.stopped) await srLog(s, e);
        if (s.reader) {
          const jumps = s.reader.state.jumps;
          for (const ms of s.reader.feed(`${lines.join('\n')}\n`)) {
            const at = s.reader.state.runs.findLast(x => x.ms === ms)?.at;
            sprintLearn(s, ms, at);
            // Its card shown already, from the live data (sprintPos): saved now with the
            // log's exact time, a card again only when that gives another medal.
            const i = s.liveRuns.findIndex(x => Math.abs(x.ms - ms) <= LIVE_RUN_MS && (!at || Math.abs(x.at - at) < 5000));
            const shown = i >= 0 ? s.liveRuns.splice(i, 1)[0] : null;
            if (s.stopped) continue;
            if (shown ? shown.void : sprintVoid(s, at)) await liveVoidRun(s, ms, !shown);
            else await liveResult(s, { ms, runs: 1, laps: 1 }, !shown || tierFor(s.ev, { ms: shown.ms }) !== tierFor(s.ev, { ms }));
          }
          if (s.reader.state.jumps > jumps) await liveNote(s, tr('Jump start'), tr("The run doesn't count."));
        } else {
          if (s.race) for (const r of s.race.feed(`${lines.join('\n')}\n`)) if (!s.stopped) await liveFinish(s, r);
          if (s.laps) for (const lap of s.laps.feed(`${lines.join('\n')}\n`)) if (!s.stopped && !s.liveLaps) await liveLap(s, lap);
          for (const line of lines) {
            const saved = /SessionResults saved into "(.+?\.sessionresults\.json)"/.exec(line);
            if (saved && !s.stopped) await liveResultsFile(s, saved[1].replace(/\\\\/g, '\\'));
          }
        }
      }
    }
  } catch (err) { log(`academy watch: ${err?.message || err}`); }
  s.busy = false;
}

const liveNote = (s, title, sub) => overlayShow(s, { kicker: ayCardKicker(s.ev), title, tier: 'void', time: '', sub });

// A sprint's run that EVO marked invalid (off the track: its timer turns red). EVO's
// log doesn't say so, but its live data does: the lap-valid flag (evoLive) still
// invalid just before the finish (the log's time, at). The short invalid spell
// while EVO puts the car on the start arch is long over by then. Without the
// live data the run counts, as before.
function sprintVoid(s, at) {
  if (!s.gfx || !at) return false;
  const before = (s.validity || []).filter(x => x.at <= at - 300).pop();
  return !!before && !before.v;
}

// Not saved, but counted as handled: when EVO closes, the runs it reads from the
// log after the ones handled here are the new ones (academyClosed).
async function liveVoidRun(s, ms, card = true) {
  s.l.academy.live++; s.l.academy.liveVoid++;
  log(`academy live ${s.ev.key}: run ${lapTime(ms)} not counted (EVO marked it invalid)${card ? '' : ' (its card already shown)'}`);
  if (card) await voidRunCard(s, ms);
}
const voidRunCard = (s, ms) => overlayShow(s, { kicker: ayCardKicker(s.ev), title: tr('Not counted'), tier: 'void', time: lapTime(ms), sub: tr('Off the track: EVO marked the run invalid.') });

// ---- A sprint's finish the moment it's crossed. EVO writes its log in 4 KB blocks,
// so with little happening on track a run's line can wait there until the pause
// menu adds more; and its live data has nothing at the finish arch (no lap, no
// time, the timer runs on). What it has is where the car is (npos, 0-1 round the
// lap) and the timer since the green: the arch is a place on the lap, learnt from
// the first run the log gives (sprintLearn) and kept in the settings by arch.
// Crossing it shows the card with the timer's time there; the log's run, when it
// comes, saves the exact time (watchTick).
const LIVE_RUN_MS = 150;   // the live time and the log's of one run: a few ms apart
const POS_GAP = 250;       // reads further apart than this (a pause between) aren't a crossing
const POS_KEEP = 6000;     // reads kept for each run (5 min at 20 a second), of the last 3 runs
// The arch's place: the middle one of the last five learnt, else the one the
// launcher ships (`finish` in academy-data.js), else null: the first run's card
// then waits for the log.
function archFinish(ev) {
  const seen = state.settings.evoArchFinish?.[ev.arch] || [];
  return seen.length ? [...seen].sort((a, b) => a - b)[seen.length >> 1] : ev.finish ?? null;
}
// From one read to the next, forward (round the lap's end too); 0 when it isn't a
// step the car could have driven.
function posStep(a, b) {
  let d = b.n - a.n;
  if (d < -0.5) d += 1;
  return b.ms > a.ms && b.ms - a.ms <= POS_GAP && d > 0 && d < 0.02 ? d : 0;
}
function sprintPos(s, e) {
  if (s.stopped || !(e.ms > 0) || !(e.n >= 0 && e.n <= 1)) return;
  let run = s.runs.at(-1), prev = run?.reads.at(-1);
  if (!run || e.ms < prev.ms - 200) { // the timer went back: restarted
    run = { reads: [], done: false }; prev = null;
    s.runs.push(run);
    if (s.runs.length > 3) s.runs.shift();
  }
  const read = { at: Date.now(), n: e.n, ms: e.ms };
  if (run.reads.length < POS_KEEP) run.reads.push(read);
  const f = s.finishAt, d = prev ? posStep(prev, read) : 0;
  if (f == null || run.done || !d) return;
  const to = ((f - prev.n) % 1 + 1) % 1;
  if (!(to > 0 && to <= d)) return;
  const ms = Math.round(prev.ms + (read.ms - prev.ms) * to / d);
  if (ms < sprintLeast(s.ev)) return; // not a run to the arch (a place passed near the start)
  run.done = true;
  liveSprintRun(s, ms, read.at).catch(err => log(`academy live run: ${err?.message || err}`));
}
const sprintLeast = ev => Math.round((ev.goal?.tiers?.at(-1) || 0) * 0.6); // as academy.js sprintReader
async function liveSprintRun(s, ms, at) {
  const v = sprintVoid(s, at);
  s.liveRuns.push({ ms, at, void: v });
  if (s.liveRuns.length > 20) s.liveRuns.shift();
  if (v) {
    log(`academy live ${s.ev.key}: run ${lapTime(ms)} at the arch, not counted (EVO marked it invalid)`);
    return voidRunCard(s, ms);
  }
  const r = { ms, runs: 1, laps: 1 }, res = await recordResult(s.ev, r, { save: false });
  log(`academy live ${s.ev.key}: run ${lapTime(ms)} at the arch, medal ${res.gained}`);
  await overlayShow(s, resultCard(s.ev, r, res));
}
// The log's run (its time, and when by the log's clock): where the car was then,
// from the reads around that time on the timer.
function sprintLearn(s, ms, at) {
  if (!at || s.ev.kind !== 'sprint') return;
  for (const run of s.runs) {
    const i = run.reads.findIndex((b, j) => j > 0 && b.ms >= ms && run.reads[j - 1].ms <= ms);
    const a = run.reads[i - 1], b = run.reads[i], d = a && posStep(a, b);
    if (!d || Math.abs(b.at - at) > 3000) continue;
    const n = (a.n + d * (ms - a.ms) / (b.ms - a.ms)) % 1, was = s.finishAt;
    const all = state.settings.evoArchFinish ||= {};
    all[s.ev.arch] = [...(all[s.ev.arch] || []), Number(n.toFixed(6))].slice(-5);
    saveSettings();
    s.finishAt = archFinish(s.ev);
    log(`academy sprint ${s.ev.arch}: finish arch at ${n.toFixed(5)} of the lap${was == null ? ' (learnt)' : ` (was ${was.toFixed(5)})`}`);
    return;
  }
}
const AI_EASIER = () => tr("The AI was made easier in EVO's menu.");

// The player has just crossed the line in a race (raceReader): the card now, from
// the log. The result is saved when EVO saves it (liveResultsFile).
async function liveFinish(s, r) {
  const ev = s.ev;
  if (s.sr) s.sr.active = false; // the lap after the flag doesn't count for the safety rating
  if (await evoAiEasier(ev)) { s.early = { easier: true }; return liveNote(s, tr("Doesn't count"), AI_EASIER()); }
  const res = await recordResult(ev, r, { save: false });
  s.early = r;
  log(`academy live ${ev.key} finish: ${JSON.stringify(r)} medal ${res.gained}`);
  await overlayShow(s, resultCard(ev, r, res));
}

// A lap from EVO's live data, the moment it's done (the log can be many seconds
// behind when little happens on track): a sprint's run (the log's, when it comes,
// saves it without a second card), a time trial's lap (the log's then go unused).
async function liveDataLap(s, e) {
  const ev = s.ev;
  log(`academy live data lap: ${JSON.stringify(e)}`);
  if (s.stopped || !(e.ms > 0)) return;
  if (ev.kind === 'sprint') {
    if (e.kmh < 20) return; // not the finish arch: the run starts from a standstill
    if (e.valid === false) return; // marked invalid: the log's run gets the card (sprintVoid)
    s.liveRuns.push({ ms: e.ms, at: Date.now(), void: false });
    const r = { ms: e.ms, runs: 1, laps: 1 }, res = await recordResult(ev, r, { save: false });
    log(`academy live ${ev.key} run: ${lapTime(e.ms)} medal ${res.gained}`);
    await overlayShow(s, resultCard(ev, r, res));
  } else if (ev.kind === 'timetrial' && !e.pit) { // the out-lap: from the pits
    s.liveLaps = true;
    await liveLap(s, { ms: e.ms, n: e.n, cut: !e.valid });
  }
}

// A time trial's lap (liveDataLap, or the log's lapReader): its card now, with the lap's medal. The
// session's best lap (s.early) is saved when EVO saves the session's result
// (liveResultsFile), at its end or when EVO closes. A flying time trial's best clean
// lap is also kept for the close (l.academy.liveBest), should EVO save no file when
// its race is left early.
async function liveLap(s, lap) {
  const ev = s.ev;
  log(`academy live ${ev.key} lap ${lap.n}: ${lapTime(lap.ms)}${lap.cut ? ' (not counted)' : ''}${evoLapTooShort(ev, lap.ms) ? ' (too short: the run to the line from a flying start)' : ''}`);
  if (evoLapTooShort(ev, lap.ms)) return;
  if (lap.cut) return overlayShow(s, { kicker: ayCardKicker(ev), title: tr('Not counted'), tier: 'void', time: lapTime(lap.ms) });
  const r = { ms: lap.ms, laps: lap.n }, res = await recordResult(ev, r, { save: false });
  if (!s.early?.ms || lap.ms < s.early.ms) s.early = { ms: lap.ms };
  if (ev.flying) Object.assign(s.l.academy, { liveBest: s.early.ms, liveLaps: lap.n });
  await overlayShow(s, resultCard(ev, r, res));
}

// A results file EVO has just saved: the event's result, or why it doesn't count.
async function liveResultsFile(s, path) {
  const ev = s.ev;
  let text = '', j = null;
  for (let i = 0; i < 5 && !j; i++) {
    try { text = await readText(path); j = JSON.parse(text || 'null'); } catch { /* still being written */ }
    if (!j) await new Promise(r => setTimeout(r, 200));
  }
  const one = evoResultFile(j, ev);
  log(`academy live ${basename(path)}: ${one ? JSON.stringify(one) : j ? 'another session' : 'unreadable'}`);
  if (!one) return; // another session: a weekend's practice or qualifying
  s.l.academy.liveFiles.push(basename(path));
  if (s.texts.has(text)) return; // a race saved again, the same, when its results screen is left
  s.texts.add(text);
  const early = s.early;
  s.early = null;
  if (one.mismatch) return liveNote(s, tr("Doesn't count"), one.mismatch === 'car' ? tr('It was driven with another car.') : tr('It was driven on another track.'));
  if (ev.kind !== 'timetrial' && await evoAiEasier(ev)) return early?.easier ? undefined : liveNote(s, tr("Doesn't count"), AI_EASIER());
  // A flying time trial's file is a race's: its best lap may be the run to the line or
  // a cut lap, so the best clean lap seen live counts (the file's when none was seen).
  const got = ev.flying && early?.ms ? { ...one, ms: early.ms } : one;
  if (ev.flying) s.l.academy.liveBest = 0;
  // Shown at the finish line (or the best lap at its line) already: saved without a
  // card, unless it came out different.
  const same = !!early && !early.easier && (ev.kind === 'timetrial' ? Math.abs(early.ms - got.ms) <= 5 : early.pos === got.pos && early.finished === got.finished);
  await liveResult(s, { ...got, files: 1 }, !same);
}

async function liveResult(s, r, card = true) {
  const ev = s.ev, res = await recordResult(ev, r, {});
  if (!res) return;
  const run = ++s.l.academy.live;
  log(`academy live ${ev.key} #${run}: ${JSON.stringify(r)} medal ${res.gained}${card ? '' : ' (its card already shown)'}`);
  if (card) await overlayShow(s, resultCard(ev, r, res));
  if (state.view === 'academy') drawAcademy();
}

// The AI made easier in EVO's menu than the event set it: the race doesn't count.
async function evoAiEasier(ev) {
  const now = await readEvoSession().catch(() => null), grid = now && (ev.kind === 'race' ? now.race.grid : now.weekend.grid);
  const want = Math.min(ev.opponents, Math.max(1, (ev.evoLayout?.race?.maxDrivers || 33) - 1));
  return !!(grid && (grid.custom || grid.skillMin < ev.skill[0] || grid.opponents < want));
}

const ayCardKicker = ev => { const d = AY.data[ev.game], level = d?.levels?.[ayLevelOf(d, ev)]; return [level && tr(level.name), tr(ev.name)].filter(Boolean).join(' · '); };

// The card's text (overlay.js): the medal, the time or place, the level and event.
function resultCard(ev, r, res) {
  const got = res.gained;
  const value = res.type === 'time' ? (r.ms ? lapTime(r.ms) : tr('No clean lap')) : r.pos ? tr('Finished {pos}', { pos: scoreText('position', r.pos) }) : r.dsq ? tr('Disqualified') : tr('Not finished');
  return { kicker: ayCardKicker(ev), title: got ? tr(AY_TIER[got]) : tr('No medal'), tier: TIERS[got - 1] || '', time: value };
}

function renderCommunity() {
  const g = gameByKey(state.game);
  const links = [
    ['Steam Community Hub', 'Screenshots, videos, guides and discussions.', steamUrls.hub(g.appid)],
    ['Discussions', 'Ask questions and talk with other drivers.', `${steamUrls.hub(g.appid)}/discussions/`],
    ['Guides', 'Setup, controller and modding guides.', `${steamUrls.hub(g.appid)}/guides/`],
    ['All Steam news', 'Patch notes and announcements from Kunos.', steamUrls.news(g.appid)],
    ['OverTake downloads', 'The largest sim-racing mod library: cars, tracks, liveries.', 'https://www.overtake.gg/downloads/'],
    ['Official website', 'Kunos Simulazioni news and roadmap.', 'https://www.assettocorsa.gg/'],
  ];
  main.innerHTML = `<div class="view scaled"><div class="page">
    <h1>${esc(g.title)} ${esc(g.sub)} · Community</h1>
    <p class="lead">Jump into the community and catch up on the latest official news.</p>
    <div class="link-grid">${links.map(([t, d, u]) => `<button class="link-card" data-url="${esc(u)}"><b>${esc(t)} ↗</b><span>${esc(d)}</span></button>`).join('')}</div>
    <div class="section-title" style="margin-top:36px">Latest news</div>
    <div class="news-list" id="news-list"><div class="loading">Loading news…</div></div>
  </div></div>`;
  main.querySelector('.page').addEventListener('click', e => {
    const u = e.target.closest('[data-url]')?.dataset.url;
    if (u) openExternal(u);
  });
  const draw = items => {
    const list = $('#news-list');
    if (!list || state.view !== 'community' || state.game !== g.key) return;
    list.innerHTML = items.length ? items.map(n => `<button class="news-item" data-url="${esc(n.url)}">
      <div class="img" style="background-image:${newsBg(n, g)}"></div>
      <div class="txt"><b>${esc(n.title)}</b><span>${esc(n.summary)}…</span><small>${timeAgo(n.date)}</small></div></button>`).join('')
      : '<div class="empty">News unavailable — could not reach Steam.</div>';
  };
  (async () => {
    const cached = await cachedNews(g.appid);
    if (cached) draw(cached);
    const fresh = await checkNews(g.appid);
    if (fresh || !cached) draw(fresh || cached || await getNews(g.appid));
  })();
}

// ---------------------------------------------------------------------------
// Settings view

const PATH_SETTINGS = [
  { game: 'ac', key: 'ac_install', label: 'Assetto Corsa folder', get: p => p.ac.install },
  { game: 'acc', key: 'acc_customs', label: 'ACC Customs folder', get: p => p.acc.customs },
  { game: 'evo', key: 'evo_mods', label: 'EVO mods folder', get: p => p.evo.mods },
  { game: 'rally', key: 'rally_install', label: 'Rally game folder', get: p => p.rally.install },
];

const REPO_URL = 'https://github.com/Zelbrad/AssettoLauncher';
const KOFI_URL = 'https://ko-fi.com/gperpas';

// ---------------------------------------------------------------------------
// Settings for Assetto Corsa: Custom Shaders Patch (install/update from
// acstuff.club, Weather FX and its style, Rain FX, Sol and Pure) and the main
// video settings. CSP's are written where Content Manager writes them.

const CSP_TOGGLES = [
  ['wfxEnabled', 'Weather FX', 'Dynamic sky, light and weather. Sol and Pure need it.', 'weather_fx.ini', 'BASIC', 'ENABLED'],
  ['style'],
  ['rainFxEnabled', 'Rain FX', 'Rain, wet track and puddles.', 'rain_fx.ini', 'BASIC', 'ENABLED'],
  ['rainTyres', 'Rain tyres at the start', 'Fits wet tyres when the drive starts in the rain.', 'rain_fx.ini', 'BASIC', 'AUTOSELECT_RAIN_TYRES'],
  ['autoWipers', 'Automatic wipers', 'Wipers switch on and off by themselves.', 'weather_fx.ini', 'MISCELLANEOUS', 'SWITCH_WIPERS_WITH_AI'],
  ['aiHeadlights', 'AI headlights', 'AI cars always drive with their headlights on.', 'weather_fx.ini', 'MISCELLANEOUS', 'FORCE_HEADLIGHTS'],
];
let shownCsp = null; // the CSP state the Settings page shows

// The CSP row: the installed version, and the public versions (acstuff.club,
// read once per run) in a picker coloured by the developer's tags: green the
// newest stable, red unstable (buggy), gray older or not rated yet; "Latest" on
// the newest, "Installed" on yours. The button installs the picked version.
const CSP_KIND = { stable: 'Stable', unstable: 'Unstable', previous: 'Previous', untested: 'Untested' };
const cspPicked = () => state.cspVersions?.list.find(v => v.version === state.cspPick);

function cspStatus(csp, versions) {
  if (state.cspInstalling) return { val: state.cspInstalling, btns: '' };
  const preview = csp.installed && /preview/i.test(csp.version);
  const parts = [csp.installed ? `v${csp.version}${preview ? ' (preview)' : ''}` : 'Not installed'];
  if (versions === undefined) parts.push('checking acstuff.club…');
  else if (!versions) parts.push("couldn't reach acstuff.club");
  else if (csp.installed) {
    const cmp = compareVersions(versions.recommended, csp.version);
    parts.push(cmp > 0 ? `${versions.recommended} available` : cmp < 0 ? `newer than the stable ${versions.recommended}` : 'up to date');
  }
  if (!versions) return { val: parts.join(' · '), btns: `<button class="btn small subtle" data-url="${CSP_PAGE}">acstuff.club ↗</button>` };

  const pick = cspPicked() || versions.list.find(v => v.version === versions.recommended) || versions.list[0];
  state.cspPick = pick.version;
  const cmp = csp.installed ? compareVersions(pick.version, csp.version) : 1;
  const action = !csp.installed ? 'Install' : cmp > 0 ? 'Update to' : cmp < 0 ? 'Downgrade to' : 'Reinstall';
  const tags = v => `<span class="csp-tag ${v.kind}">${CSP_KIND[v.kind]}</span>${v.version === versions.latest ? '<span class="csp-badge latest">Latest</span>' : ''}${csp.installed && v.version === csp.version ? '<span class="csp-badge">Installed</span>' : ''}`;
  const options = versions.list.map(v => `<button class="csp-opt ${v.version === pick.version ? 'sel' : ''}" data-csp-version="${esc(v.version)}"><b>${esc(v.version)}</b>${tags(v)}<small>${esc(v.size)}</small></button>`);
  // A preview (Patreon) or custom build isn't on the public list: shown, not installable.
  if (csp.installed && !versions.list.some(v => v.version === csp.version)) {
    options.unshift(`<div class="csp-opt off"><b>${esc(csp.version)}</b><span class="csp-tag previous">${preview ? 'Preview' : 'Custom'}</span><span class="csp-badge">Installed</span><small>${preview ? 'Patreon build' : ''}</small></div>`);
  }
  options.push(`<button class="csp-opt csp-link" data-url="${CSP_PAGE}">All versions on acstuff.club ↗</button>`);
  const btns = `<div class="csp-picker"><button class="btn small subtle csp-pick" data-act="csp-menu"><b>${esc(pick.version)}</b>${tags(pick)}<span class="csp-caret">▾</span></button><div class="csp-menu" hidden>${options.join('')}</div></div>
    <button class="btn small ${pick.kind === 'unstable' || cmp < 0 ? 'subtle' : 'primary'}" data-act="csp-install">${action} ${esc(pick.version)}</button>
    <button class="btn small subtle" data-act="csp-changes">What's new</button>`;
  return { val: parts.join(' · '), btns };
}

function updateCspRow() {
  const row = document.getElementById('csp-row');
  if (!row || !shownCsp) return;
  const st = cspStatus(shownCsp, state.cspVersions);
  row.querySelector('.val').textContent = st.val;
  row.querySelector('.btns').innerHTML = st.btns;
}

// The picked version's changelog (acstuff.club/patch/?info=<version>), under the CSP row.
async function showCspChanges() {
  const panel = document.getElementById('csp-changes');
  const v = state.cspPick;
  if (!panel || !v) return;
  panel.hidden = false;
  panel.innerHTML = `<p class="settings-note">Loading what's new in ${esc(v)}…</p>`;
  const info = await cspVersionInfo(v).catch(() => null);
  if (state.cspPick !== v || !panel.isConnected) return;
  panel.innerHTML = info?.changes.length
    ? `<h4>What's new in ${esc(v)}${info.build ? ` <small>build ${info.build}</small>` : ''}</h4>
      <ul>${info.changes.map(c => `<li style="margin-left:${c.depth * 18}px">${esc(c.text)}</li>`).join('')}</ul>`
    : `<p class="settings-note">${info ? `No changelog listed for ${esc(v)}.` : "Couldn't load the changelog from acstuff.club."}</p>`;
}

async function cspSettingsHTML() {
  if (!state.paths?.ac.install) return '';
  if (!state.cspVersionsP) state.cspVersionsP = cspVersions().catch(() => null).then(r => { state.cspVersions = r; updateCspRow(); return r; });
  const csp = shownCsp = await readCsp(state.paths).catch(() => ({ installed: false, styles: [], settings: {} }));
  const st = cspStatus(csp, state.cspVersions);
  const note = (text, warn) => `<div class="val note ${warn ? 'warn' : ''}">${esc(text)}</div>`;
  const rows = [
    `<div class="setting" id="csp-row"><label>Custom Shaders Patch</label><div class="val">${esc(st.val)}</div><div class="btns">${st.btns}</div></div>`,
    `<div class="csp-changes" id="csp-changes" hidden></div>`,
  ];
  if (csp.installed) {
    for (const [k, label, hint, file, section, key] of CSP_TOGGLES) {
      if (k === 'style') {
        const styles = csp.styles.some(s => s.id === csp.style) ? csp.styles : [...csp.styles, { id: csp.style, name: `${csp.style} (missing)` }];
        rows.push(`<div class="setting"><label>Weather style</label>${note('How the sky, light and clouds look (Weather FX).')}
          <select data-csp-style>${styles.map(s => `<option value="${esc(s.id)}" ${s.id === csp.style ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>`);
        continue;
      }
      rows.push(`<div class="setting"><label>${label}</label>${note(hint)}<button class="toggle ${csp.settings[k] ? 'on' : ''}" data-csp="${file}|${section}|${key}"></button></div>`);
    }
  }
  // Peter Boese's weather mods: Sol (free, discontinued) and Pure (Patreon). Neither
  // can be downloaded by the launcher (Get opens their page); dropping their zip
  // installs them. Installed: Use, or Selected (in use) with Deselect (back to
  // AC's Default style), and Uninstall (Recycle Bin, second click confirms).
  const inUse = mod => mod?.styles.find(s => s.id === csp.style && csp.settings.wfxEnabled);
  const modRow = (key, name, mod, url, about, warn) => {
    const used = inUse(mod);
    const text = !mod ? about
      : [used ? `In use · ${used.name}` : `Installed · ${mod.styles.map(s => s.name).join(', ')}`, mod.version && `v${mod.version}`, warn].filter(Boolean).join(' · ');
    const btns = !mod ? `<button class="btn small subtle" data-url="${url}">Get ${name} ↗</button>`
      : [
        !csp.installed ? '' : used
          ? `<button class="btn small primary csp-selected" disabled>✓ Selected</button><button class="btn small subtle" data-csp-deselect="${key}">Deselect</button>`
          : `<button class="btn small primary" data-csp-use="${esc(mod.styles[0].id)}">Use ${name}</button>`,
        `<button class="btn small danger" data-csp-uninstall="${key}" title="Moves ${name}'s files to the Recycle Bin">Uninstall</button>`,
      ].join('');
    return `<div class="setting"><label>${name}</label>${note(text, !!warn)}<div class="btns">${btns}</div></div>`;
  };
  rows.push(modRow('sol', 'Sol', csp.sol, SOL_URL,
    'Free and no longer updated (last version 2.2.9). Overtake needs an account to download it; then drop the zip on the launcher.',
    csp.solBroken && `doesn't work with CSP ${csp.version}: Sol needs CSP 0.2.9 or older, or 0.3`));
  rows.push(modRow('pure', 'Pure', csp.pure, PURE_URL,
    "Peter Boese's current weather and graphics mod, for his Patreon supporters. Drop its zip on the launcher to install it."));
  if (IS_LINUX && csp.installed) {
    const opt = `WINEDLLOVERRIDES="${PROTON_DLL_OVERRIDE}" %command%`;
    rows.push(`<div class="setting"><label>Steam launch option</label><div class="val" title="Quick Drive sets this itself; Steam needs it to load CSP when you start AC from Steam.">${esc(opt)}</div><div class="btns"><button class="btn small subtle" data-copy="${esc(opt)}">Copy</button></div></div>`);
  }
  return `<div class="settings-group"><h3>Assetto Corsa · Custom Shaders Patch</h3>
    <p class="settings-note">Saved in AC's cfg/extension folder in Documents, the same files Content Manager uses. AC reads them when it starts.${csp.installed ? '' : ` CSP needs Microsoft's <button class="link" data-url="${VCREDIST_URL}">Visual C++ 2015 (x86) runtime</button>.`}</p>
    ${rows.join('')}</div>`;
}

async function videoSettingsHTML() {
  if (!state.paths?.ac.install) return '';
  const head = '<div class="settings-group"><h3>Assetto Corsa · Video</h3>';
  const v = await readVideo(state.paths).catch(() => null);
  if (!v) return `${head}<p class="settings-note">Start Assetto Corsa once so it creates its video settings.</p></div>`;
  const modes = [...await displayModes()];
  if (!modes.some(m => m.width === v.width && m.height === v.height)) modes.unshift({ width: v.width, height: v.height, rates: [] });
  const rates = [...new Set([...(modes.find(m => m.width === v.width && m.height === v.height)?.rates || []), v.refresh])].sort((a, b) => b - a);
  const sel = (key, options, value) => `<select data-video="${key}">${options.map(([val, label]) => `<option value="${esc(val)}" ${String(val) === String(value) ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select>`;
  const row = (label, hint, control) => `<div class="setting"><label>${label}</label><div class="val note">${esc(hint)}</div>${control}</div>`;
  const known = (list, value, label) => (list.some(([x]) => x === value) ? list : [...list, [value, label(value)]]);
  return `${head}
    <p class="settings-note">AC's video.ini in Documents; AC reads it when it starts. The first change keeps the original as video.ini.launcher-backup. Content Manager has the rest.</p>
    ${row('Display', '', sel('fullscreen', [[1, 'Fullscreen'], [0, 'Windowed']], v.fullscreen ? 1 : 0))}
    ${row('Resolution', '', sel('resolution', modes.map(m => [`${m.width}x${m.height}`, `${m.width} × ${m.height}`]), `${v.width}x${v.height}`))}
    ${row('Refresh rate', '', sel('refresh', rates.map(r => [r, `${r} Hz`]), v.refresh))}
    ${row('Vertical sync', 'Matches frames to the screen: no tearing, a little more input lag.', `<button class="toggle ${v.vsync ? 'on' : ''}" data-video-toggle="vsync"></button>`)}
    ${row('Frame rate limit', '', sel('fps', known(FPS_LIMITS.map(n => [n, n ? `${n} FPS` : 'No limit']), v.fps, n => `${n} FPS`), v.fps))}
    ${row('Anti-aliasing', 'MSAA: smoother edges, costs performance.', sel('aa', known(AA_LEVELS, v.aa, n => `${n}×`), v.aa))}
    ${row('Anisotropic filtering', 'Sharper textures at an angle.', sel('aniso', known(ANISO_LEVELS, v.aniso, n => `${n}×`), v.aniso))}
    ${row('Shadows', 'Shadow map resolution.', sel('shadows', known(SHADOW_SIZES, v.shadows, n => `${n} px`), v.shadows))}
    ${await ppFilterRow().catch(err => { log(`settings pp filters: ${err?.message || err}`); return ''; })}
  </div>`;
}

// AC's post-processing filter (ppfilters.js), a row of the Video group: a list of
// the installed filters (Off = [POST_PROCESS] ENABLED=0), with Restore when the
// chosen one has a backup and Uninstall (backed up, then Recycle Bin) unless it
// comes with AC or with Pure.
let shownPp = null;
async function ppFilterRow() {
  const pp = shownPp = await listPpFilters(state.paths);
  const installed = pp.filters.filter(f => f.installed);
  const current = pp.enabled ? installed.find(f => f.id.toLowerCase() === pp.active.toLowerCase()) : null;
  const opt = f => `<option value="${esc(f.id)}" ${f === current ? 'selected' : ''}>${esc(f.id)}${f.author && !f.builtin && !f.owner ? ` · ${esc(f.author)}` : ''}</option>`;
  const group = (label, list) => (list.length ? `<optgroup label="${label}">${list.map(opt).join('')}</optgroup>` : '');
  const missing = pp.enabled && !current ? `<option selected>${esc(pp.active)} (missing)</option>` : '';
  const select = `<select data-video="ppfilter"><option value="" ${pp.enabled ? '' : 'selected'}>Off</option>${missing}
    ${group('Added', installed.filter(f => !f.builtin && !f.owner))}${group('Pure', installed.filter(f => f.owner))}${group('Assetto Corsa', installed.filter(f => f.builtin))}</select>`;
  const last = current?.backups[0];
  const btns = [
    last && `<button class="btn small subtle" data-pp-restore="${esc(current.id)}" title="Puts back the version from ${esc(new Date(last.at).toLocaleString())}; the installed one is backed up first">Restore</button>`,
    current && !current.builtin && !current.owner && `<button class="btn small danger" data-pp-uninstall="${esc(current.id)}" title="Backed up, then moved to the Recycle Bin">Uninstall</button>`,
  ].filter(Boolean).join('');
  return `<div class="setting"><label>Post-processing filter</label><div class="val note">Drop a filter's zip or .ini on the launcher to install it. Replacing or uninstalling one keeps a backup.</div><div class="btns">${select}${btns}</div></div>`;
}

async function runCspInstall() {
  const pick = cspPicked();
  if (!pick || state.cspInstalling) return;
  const status = text => { state.cspInstalling = text; updateCspRow(); };
  status('Backing up AC settings…');
  try {
    await createBackup('ac', state.paths).catch(err => log(`csp: backup before install failed: ${err?.message || err}`));
    const version = await installCsp(state.paths, pick, p => status(
      p.stage === 'download' ? `Downloading ${pick.version}… ${p.total ? `${Math.floor(p.done / p.total * 100)} %` : `${Math.round(p.done / 1048576)} MB`}`
        : p.stage === 'extract' ? 'Unpacking…' : p.stage === 'copy' ? 'Copying into the AC folder…' : 'Finishing…'));
    toast(`Custom Shaders Patch ${version} installed`);
  } catch (err) {
    toast(err.message || 'Could not install Custom Shaders Patch', true);
  } finally {
    state.cspInstalling = '';
    if (state.view === 'settings') renderSettings();
  }
}

// Shown once there's a mod track (or the list was changed or restored).
async function evoTracksSettingsHTML() {
  if (!state.paths?.evo?.install) return '';
  const s = await evoTrackListStatus(state.paths);
  if (!s.listed.length && !s.waiting.length && !s.skipped.length && !s.off) return '';
  const val = [
    s.listed.length ? `In EVO's track list: ${s.listed.join(', ')}` : s.off ? 'EVO has its original track list (restored here)' : '',
    s.waiting.length ? `Not added yet: ${s.waiting.join(', ')}` : '',
    ...s.skipped.map(x => `Can't be added: ${x.file} (${x.why})`),
  ].filter(Boolean).map(esc).join('<br>');
  return `<div class="settings-group"><h3>Assetto Corsa EVO · Mod tracks</h3>
    <p class="settings-note">EVO only lists the tracks in its own track list, inside its game file <code>content.kspkg</code>. The launcher adds your mod tracks to it when you install one and before EVO starts from here, and keeps a copy of what it changes. Restore puts the file back exactly as it was, as Steam's Verify integrity also does.</p>
    <div class="setting"><label>Track list</label><div class="val">${val}</div>
      <div class="btns">
        <button class="btn small subtle" data-act="evo-tracks-add" ${s.waiting.length ? '' : 'disabled'}>Add to EVO</button>
        <button class="btn small subtle" data-act="evo-tracks-restore" ${s.listed.length ? '' : 'disabled'}>Restore original</button>
      </div></div></div>`;
}

async function renderSettings() {
  const [cspGroup, videoGroup, evoTracksGroup] = await Promise.all([
    cspSettingsHTML().catch(err => { log(`settings csp: ${err?.message || err}`); return ''; }),
    videoSettingsHTML().catch(err => { log(`settings video: ${err?.message || err}`); return ''; }),
    evoTracksSettingsHTML().catch(err => { log(`settings evo tracks: ${err?.message || err}`); return ''; }),
  ]);
  const rows = await Promise.all(PATH_SETTINGS.map(async s => {
    const v = s.get(state.paths);
    const ok = v && await exists(v);
    const custom = !!state.settings.overrides[s.key];
    return `<div class="setting">
      <label>${s.label}</label>
      <div class="val ${ok ? '' : 'missing'}" title="${esc(v)}">${esc(v || 'Not found')}<span class="tag">${custom ? 'custom' : ok ? 'auto-detected' : 'missing'}</span></div>
      <div class="btns">
        <button class="btn small subtle" data-browse="${s.key}">Change…</button>
        ${custom ? `<button class="btn small subtle" data-reset="${s.key}">Reset</button>` : ''}
        ${ok ? `<button class="btn small subtle" data-open="${esc(v)}">Open</button>` : ''}
      </div></div>`;
  }));
  const backupRows = await Promise.all(GAMES.filter(isInstalled).map(async g => {
    const list = await listBackups(g.key).catch(() => []);
    return `<div class="setting"><label>${esc(`${g.title} ${g.sub || ''}`.trim())}</label>
      <div class="val">${list.length ? `Last backup ${esc(timeAgo(list[0].at / 1000))} · ${list.length} kept` : 'No backup yet'}</div>
      <div class="btns">
        <button class="btn small subtle" data-backup="${g.key}">Back up now</button>
        <button class="btn small subtle" data-restore="${g.key}" ${list.length ? '' : 'disabled'}>Restore…</button>
      </div></div>`;
  }));
  if (state.settings.backgrounds && Object.keys(state.settings.backgrounds).length) await backgroundsDir();
  const bgRows = GAMES.map(g => {
    const own = state.settings.backgrounds?.[g.key];
    const dark = Math.round(heroDarken(g) * 100);
    return `<div class="setting bg-setting"><label>${esc(`${g.title} ${g.sub || ''}`.trim())}</label>
      <div class="val note bg-val"><span class="bg-thumb" style="background-image:${heroImage(g)}"><i style="opacity:${dark / 100}"></i></span>${own ? 'Your picture' : 'Default picture'}</div>
      <div class="btns">
        <label class="bg-darken" title="Darkens the picture so the text on it stays readable">Darken
          <input type="range" min="0" max="80" step="5" value="${dark}" data-darken="${g.key}" style="--fill: ${dark / 0.8}%"><output>${dark}%</output></label>
        <button class="btn small subtle" data-bg-pick="${g.key}">Choose image…</button>
        <button class="btn small subtle" data-bg-reset="${g.key}" ${own ? '' : 'disabled'}>Reset</button>
      </div></div>`;
  });
  if (state.view !== 'settings') return;
  // Drawn again after a change: same scroll position, no fade.
  const again = $('#app').classList.contains('settings-mode') ? main.querySelector('.view.settings') : null;
  const scroll = again?.scrollTop || 0;
  $('#app').classList.add('settings-mode');
  main.innerHTML = `<div class="view scaled settings ${again ? 'still' : ''}"><div class="page">
    <h1>Settings</h1>
    <p class="lead">Folders are detected from your Steam libraries. Override any of them if you moved things around.</p>
    <div class="settings-group"><h3>Game folders</h3>${rows.join('')}</div>
    <div class="settings-group"><h3>Game backgrounds</h3>
      <p class="settings-note">The picture behind each game on the Games tab. Yours is copied into the launcher, so you can move or delete the original.</p>
      ${bgRows.join('')}</div>
    ${cspGroup}${videoGroup}${evoTracksGroup}
    <div class="settings-group"><h3>Game settings backups</h3>
      <p class="settings-note">Controls, graphics, audio, car setups and progress, never mods. The launcher also makes one automatically each week and keeps the last 4 automatic ones. <button class="link" data-act="open-backups">Open backups folder</button></p>
      ${backupRows.join('')}</div>
    <div class="settings-group"><h3>Behaviour</h3>
      <div class="setting"><label>Minimize when a game starts</label><div class="val"></div>
        <button class="toggle ${state.settings.minimizeOnLaunch ? 'on' : ''}" data-toggle="minimizeOnLaunch"></button></div>
      <div class="setting"><label>Academy results over EVO</label><div class="val">A small card over the game with your medal and time or place: as you cross a sprint's finish arch, or when EVO saves a session's result</div>
        <button class="toggle ${state.settings.academyCard !== false ? 'on' : ''}" data-toggle="academyCard"></button></div>
      <div class="setting"><label>Card shown for</label><div class="val"></div><div class="btns"><div class="qd-seg">${[5, 8, 15].map(n => `<button data-card-secs="${n}" class="${(state.settings.academyCardSeconds || 8) === n ? 'active' : ''}">${n} s</button>`).join('')}</div></div></div>
      <div class="setting"><label>Sound with the card</label><div class="val">A short notification sound</div>
        <div class="btns"><button class="btn small subtle" data-act="chime-test">Play</button><button class="toggle ${state.settings.academyCardSound !== false ? 'on' : ''}" data-toggle="academyCardSound"></button></div></div>
    </div>
    <div class="settings-group"><h3>Data</h3>
      <div class="setting"><label>Steam</label><div class="val">${esc(state.steamPath)}</div><div class="btns"><button class="btn small subtle" data-act="rescan">Re-detect games</button></div></div>
      <div class="setting"><label>News</label><div class="val">Checked for new posts each time the launcher opens</div><div class="btns"><button class="btn small subtle" data-act="clear-cache">Refresh now</button></div></div>
    </div>
    <div class="settings-group"><h3>About</h3>
      <div class="setting"><label>Version</label><div class="val">${esc(window.NL_APPVERSION || '')} · Neutralino ${esc(window.NL_VERSION || '')}</div><div class="btns"><button class="btn small subtle" data-act="check-update">Check for updates</button></div></div>
      <div class="setting"><label>Source code</label><div class="val">Open source (MIT). Feedback and ideas are welcome.</div><div class="btns"><button class="btn small subtle" data-url="${REPO_URL}">GitHub ↗</button></div></div>
      <div class="setting"><label>Support</label><div class="val">The launcher is free. If you'd like to support it, you can buy me a coffee.</div><div class="btns"><button class="btn small primary" data-url="${KOFI_URL}">Support on Ko-fi ↗</button></div></div>
    </div>
  </div></div>`;
  if (scroll) main.querySelector('.view').scrollTop = scroll;

  main.querySelector('.page').onclick = async e => {
    // Any click but the picker's own button closes the CSP version list.
    if (!e.target.closest('[data-act="csp-menu"]')) for (const m of main.querySelectorAll('.csp-menu')) m.hidden = true;
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.browse) {
      const picked = await Neutralino.os.showFolderDialog('Select folder').catch(() => '');
      if (!picked) return;
      state.settings.overrides[t.dataset.browse] = norm(picked);
      await applyPaths();
    } else if (t.dataset.reset) {
      delete state.settings.overrides[t.dataset.reset];
      await applyPaths();
    } else if (t.dataset.open) {
      openFolder(t.dataset.open);
    } else if (t.dataset.url) {
      openExternal(t.dataset.url);
    } else if (t.dataset.toggle) {
      state.settings[t.dataset.toggle] = !state.settings[t.dataset.toggle];
      saveSettings();
      t.classList.toggle('on');
    } else if (t.dataset.cardSecs) {
      state.settings.academyCardSeconds = Number(t.dataset.cardSecs);
      saveSettings();
      t.parentElement.querySelectorAll('button').forEach(b => b.classList.toggle('active', b === t));
    } else if (t.dataset.bgPick) {
      await pickBackground(t.dataset.bgPick);
      renderSettings();
    } else if (t.dataset.bgReset) {
      await removeBackground(t.dataset.bgReset);
      renderSettings();
    } else if (t.dataset.act === 'evo-tracks-add') {
      t.disabled = true; t.textContent = 'Adding…';
      await evoTrackSync({ force: true });
      renderSettings();
    } else if (t.dataset.act === 'evo-tracks-restore') {
      t.disabled = true; t.textContent = 'Restoring…';
      try {
        await restoreEvoTrackList(state.paths);
        toast("EVO's track list is back to the original. Mod tracks stay installed; Add to EVO lists them again.");
      } catch (err) { toast(err?.message || 'Could not restore the track list', true); }
      renderSettings();
    } else if (t.dataset.act === 'chime-test') {
      playChime().then(st => log(`chime: ${st}`));
    } else if (t.dataset.act === 'rescan') {
      await detect();
      toast('Games re-detected');
    } else if (t.dataset.act === 'check-update') {
      t.disabled = true; t.textContent = 'Checking…';
      const rel = await checkAppUpdate({ manual: true });
      if (!rel) toast(`You're up to date (${window.NL_APPVERSION || ''})`);
      t.disabled = false; t.textContent = 'Check for updates';
    } else if (t.dataset.act === 'clear-cache') {
      for (const g of GAMES) { await getNews(g.appid, { force: true }); }
      toast('News refreshed');
    } else if (t.dataset.act === 'open-backups') {
      const dir = await backupsRoot();
      await Neutralino.filesystem.createDirectory(dir).catch(() => {});
      openFolder(dir);
    } else if (t.dataset.backup) {
      t.disabled = true; t.textContent = 'Backing up…';
      try { await createBackup(t.dataset.backup, state.paths); toast('Backup created'); }
      catch (err) { toast(err.message || 'Backup failed', true); }
      if (state.view === 'settings') renderSettings();
    } else if (t.dataset.restore) {
      openRestoreDialog(gameByKey(t.dataset.restore));
    } else if (t.dataset.act === 'csp-menu') {
      const menu = t.parentElement.querySelector('.csp-menu');
      menu.hidden = !menu.hidden;
      if (!menu.hidden) menu.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
    } else if (t.dataset.cspVersion) {
      state.cspPick = t.dataset.cspVersion;
      updateCspRow();
      if (!document.getElementById('csp-changes')?.hidden) showCspChanges();
    } else if (t.dataset.act === 'csp-changes') {
      const panel = document.getElementById('csp-changes');
      if (panel && !panel.hidden) panel.hidden = true;
      else showCspChanges();
    } else if (t.dataset.act === 'csp-install') {
      // Unstable versions and downgrades take a second click to confirm.
      const pick = cspPicked(), downgrade = shownCsp?.installed && pick && compareVersions(pick.version, shownCsp.version) < 0;
      if (pick && (pick.kind === 'unstable' || downgrade) && !t.dataset.armed) {
        t.dataset.armed = '1';
        t.textContent = pick.kind === 'unstable' ? `${pick.version} is marked buggy. Install anyway?` : `Downgrade to ${pick.version}? Your CSP settings stay.`;
        return;
      }
      runCspInstall();
    } else if (t.dataset.cspDeselect) {
      try {
        await deselectWeatherMod(state.paths, t.dataset.cspDeselect);
        toast("Back to AC's Default weather style. It applies the next time AC starts.");
      } catch (err) { toast(err.message || 'Could not save the setting', true); }
      renderSettings();
    } else if (t.dataset.cspUninstall) {
      const name = t.dataset.cspUninstall === 'pure' ? 'Pure' : 'Sol';
      if (!t.dataset.armed) { t.dataset.armed = '1'; t.textContent = `Uninstall ${name}?`; return; }
      t.disabled = true; t.textContent = 'Uninstalling…';
      try {
        const n = await uninstallWeatherMod(state.paths, t.dataset.cspUninstall);
        toast(`${name} uninstalled (${n} folders and files moved to the Recycle Bin)`);
      } catch (err) { toast(err.message || `Could not uninstall ${name}`, true); }
      renderSettings();
    } else if (t.dataset.csp) {
      const [file, section, key] = t.dataset.csp.split('|');
      const on = !t.classList.contains('on');
      try { await writeCspSetting(state.paths, file, section, key, on ? 1 : 0); t.classList.toggle('on', on); }
      catch (err) { toast(err.message || 'Could not save the setting', true); }
    } else if (t.dataset.cspUse) {
      try {
        await writeCspSetting(state.paths, 'weather_fx.ini', 'BASIC', 'IMPLEMENTATION', t.dataset.cspUse);
        await writeCspSetting(state.paths, 'weather_fx.ini', 'BASIC', 'ENABLED', 1);
        toast('Weather style set. It applies the next time AC starts.');
      } catch (err) { toast(err.message || 'Could not save the setting', true); }
      renderSettings();
    } else if (t.dataset.ppUninstall) {
      const id = t.dataset.ppUninstall;
      if (!t.dataset.armed) { t.dataset.armed = '1'; t.textContent = `Uninstall ${id}?`; return; }
      t.disabled = true; t.textContent = 'Uninstalling…';
      try { await uninstallPpFilter(state.paths, id); toast(`${id} uninstalled. A backup is kept: Restore puts it back.`); }
      catch (err) { toast(err.message || `Could not uninstall ${id}`, true); }
      renderSettings();
    } else if (t.dataset.ppRestore) {
      const f = shownPp?.filters.find(x => x.id === t.dataset.ppRestore);
      if (!f?.backups[0]) return;
      t.disabled = true; t.textContent = 'Restoring…';
      try { await restorePpFilter(state.paths, f.backups[0]); toast(`${f.id} restored from the backup of ${new Date(f.backups[0].at).toLocaleString()}`); }
      catch (err) { toast(err.message || `Could not restore ${f.id}`, true); }
      renderSettings();
    } else if (t.dataset.videoToggle) {
      const on = !t.classList.contains('on');
      try { await writeVideo(state.paths, { [t.dataset.videoToggle]: on }); t.classList.toggle('on', on); }
      catch (err) { toast(err.message || 'Could not save the setting', true); }
    } else if (t.dataset.copy) {
      const text = t.dataset.copy;
      navigator.clipboard?.writeText(text).then(() => toast('Copied. Paste it in AC\'s Properties → Launch options in Steam.'), () => toast(text));
    }
  };
  // The darken slider shows its value and the preview while dragged, and is saved on release.
  main.querySelector('.page').oninput = e => {
    const r = e.target.closest('[data-darken]');
    if (!r) return;
    r.nextElementSibling.textContent = `${r.value}%`;
    r.style.setProperty('--fill', `${(r.value / r.max) * 100}%`);
    const shade = r.closest('.setting').querySelector('.bg-thumb i');
    if (shade) shade.style.opacity = r.value / 100;
  };
  main.querySelector('.page').onchange = async e => {
    const r = e.target.closest('[data-darken]');
    if (r) {
      state.settings.bgDarken = { ...state.settings.bgDarken, [r.dataset.darken]: Number(r.value) };
      saveSettings();
      return;
    }
    const s = e.target.closest('select');
    if (!s) return;
    try {
      if (s.matches('[data-csp-style]')) {
        await writeCspSetting(state.paths, 'weather_fx.ini', 'BASIC', 'IMPLEMENTATION', s.value);
        renderSettings();
      } else if (s.dataset.video === 'resolution') {
        const [width, height] = s.value.split('x').map(Number);
        const rates = (await displayModes()).find(m => m.width === width && m.height === height)?.rates || [];
        const current = (await readVideo(state.paths))?.refresh;
        await writeVideo(state.paths, { width, height, ...(rates.length && !rates.includes(current) ? { refresh: rates[0] } : {}) });
        renderSettings();
      } else if (s.dataset.video === 'ppfilter') {
        // Off turns post-processing off; a filter turns it on.
        await writeVideo(state.paths, s.value ? { filter: s.value, pp: true } : { pp: false });
        renderSettings();
      } else if (s.dataset.video) {
        await writeVideo(state.paths, { [s.dataset.video]: Number(s.value) });
      }
    } catch (err) { toast(err.message || 'Could not save the setting', true); }
  };
}

// Pick a settings backup to restore (backups.js). Restoring first backs up the
// current settings, so it can be undone from the same list.
async function openRestoreDialog(g) {
  const kinds = { manual: 'Manual', auto: 'Automatic (weekly)', restore: 'Before a restore' };
  const draw = async () => {
    const list = await listBackups(g.key);
    el.querySelector('.imp-list').innerHTML = list.map((b, i) => `<div class="imp-row">
      <div class="imp-info"><b>${esc(new Date(b.at).toLocaleString())} · ${esc(kinds[b.kind] || b.kind)}</b><code>${esc(b.items.join(', '))}</code></div>
      <button class="btn subtle small" data-open="${i}">Open</button>
      <button class="btn subtle small" data-del="${i}" title="Delete this backup">✕</button>
      <button class="btn primary small" data-restore="${i}">Restore</button>
    </div>`).join('') || '<div class="qd-none">No backups.</div>';
    return list;
  };
  const { el } = modal(`<div class="qd imp">
    <header class="qd-head"><h2>Restore ${esc(`${g.title} ${g.sub || ''}`.trim())} settings</h2>
      <div class="qd-sub">Copies the backup's files over the game's current ones. Your current settings are backed up first, so this can be undone. Close the game before restoring.</div></header>
    <div class="imp-list"></div>
    <footer class="qd-foot"><div class="qd-summary"></div><button class="btn subtle small" data-close>Close</button></footer>
  </div>`, 'modal imp-modal');
  let list = await draw();
  el.addEventListener('click', async e => {
    const b = e.target.closest('[data-open], [data-del], [data-restore]');
    if (!b) return;
    const item = list[b.dataset.open ?? b.dataset.del ?? b.dataset.restore];
    if (b.dataset.open != null) { openFolder(item.dir); return; }
    // Deleting and restoring take a second click to confirm.
    if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = b.dataset.del != null ? 'Delete?' : 'Confirm restore'; return; }
    b.disabled = true;
    try {
      if (b.dataset.del != null) { await deleteBackup(item); toast('Backup deleted'); }
      else { await restoreBackup(g.key, state.paths, item); toast(`Restored ${g.title} ${g.sub || ''} settings from ${new Date(item.at).toLocaleString()}`); }
    } catch (err) { toast(err.message || 'Failed', true); }
    list = await draw();
  });
}

async function applyPaths() {
  saveSettings();
  state.paths = await resolvePaths(state.installed, state.settings.overrides, state.steamPath);
  state.paths.steam = state.steamPath; // Steam screenshots (media.js)
  state.cache = {};
  renderSidebar();
  render();
}

// ---------------------------------------------------------------------------
// Routing / boot

// Navbar highlight, and the game sidebar hidden on the Quick Drive page and on
// Settings (which cover every game). Settings drops it when its page is drawn
// (renderSettings), so the page being left doesn't stretch while Settings loads.
function syncChrome() {
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('active', b.dataset.view === state.view));
  $('#app').classList.toggle('qd-mode', state.view === 'quickdrive' || state.view === 'academy');
  if (state.view !== 'settings') $('#app').classList.remove('settings-mode');
}

function render() {
  syncChrome();
  $('#modal-root').innerHTML = '';
  main.__qdLeave?.(); main.__qdLeave = null;
  if (state.view === 'quickdrive') { openQuickDriveDialog(); return; }
  state.qdWant = '';
  if (state.view === 'games') renderGames();
  else if (state.view === 'mods') renderMods();
  else if (state.view === 'academy') renderAcademy();
  else if (state.view === 'community') renderCommunity();
  else if (state.view === 'settings') renderSettings();
}

$('#nav').addEventListener('click', e => {
  const b = e.target.closest('[data-view]');
  if (!b) return;
  state.view = b.dataset.view;
  render();
});

// Quick Drive lives in the navbar, independent of the sidebar's game: the dialog
// has a tab per game and opens on the sidebar's game, else on the one used last.
const QUICK_DRIVE_GAMES = new Set(['ac', 'evo', 'acc', 'rally']);
function quickDriveBlocker(key) {
  const g = gameByKey(key);
  if (!QUICK_DRIVE_GAMES.has(key)) return 'Quick Drive is available for Assetto Corsa, Competizione, AC EVO and Rally';
  if (!isInstalled(g)) return `${g.title} ${g.sub || ''} isn't installed`.replace(/\s+/g, ' ');
  return '';
}
function updateNavQuickDrive() {
  const ready = [...QUICK_DRIVE_GAMES].some(k => !quickDriveBlocker(k));
  const b = $('#nav-qd');
  b.classList.toggle('off', !ready);
  b.title = ready ? 'Set up a session and start one of your Assetto Corsa games' : 'Quick Drive needs an Assetto Corsa game installed';
}
// Open (or switch) the Quick Drive page to a game, optionally with a car or track
// to pre-select. While the game's lists load, the current page stays, dimmed,
// with the new tab already active.
async function openQuickDriveFor(key, args) {
  state.qdWant = key;
  const cur = main.querySelector('.qd-view .qd');
  if (cur) {
    cur.classList.add('switching');
    cur.querySelectorAll('[data-qd-game]').forEach(b => b.classList.toggle('active', b.dataset.qdGame === key));
  } else {
    if (state.view !== 'quickdrive') { state.view = 'quickdrive'; syncChrome(); }
    main.__qdLeave?.(); main.__qdLeave = null;
    main.innerHTML = '<div class="view qd-view"><div class="loading">Loading Quick Drive…</div></div>';
  }
  const open = { evo: openEvoQuickDrive, acc: openAccQuickDrive, rally: openRallyQuickDrive }[key] || openQuickDrive;
  try { await open(args); } catch (err) { log(`quick drive ${key}: ${err?.stack || err}`); toast(`Quick Drive couldn't open: ${err?.message || err}`, true); }
  const now = main.querySelector('.qd-view .qd');
  // The tab's game becomes the selected one, so Mods (and Games) open on it next.
  if (now?.dataset.game === key && state.game !== key) {
    state.game = key; state.search = '';
    state.settings.lastGame = key;
    saveSettings();
    renderSidebar();
  }
  // The game couldn't open (it said why): stay on the page that was there.
  if (state.qdWant === key && now?.dataset.game !== key) {
    if (now) {
      now.classList.remove('switching');
      now.querySelectorAll('[data-qd-game]').forEach(b => b.classList.toggle('active', b.dataset.qdGame === now.dataset.game));
      state.qdWant = now.dataset.game;
    } else if (state.view === 'quickdrive') main.innerHTML = `<div class="view qd-view"><div class="loading">Quick Drive couldn't open for ${esc(gameByKey(key).title)} ${esc(gameByKey(key).sub || '')}.</div></div>`;
  }
}
function openQuickDriveDialog() {
  const key = [state.game, state.settings.qdGame, 'ac', 'evo', 'acc', 'rally'].find(k => QUICK_DRIVE_GAMES.has(k) && !quickDriveBlocker(k));
  if (!key) { main.innerHTML = '<div class="view qd-view"><div class="loading">Quick Drive needs an Assetto Corsa game installed.</div></div>'; return; }
  openQuickDriveFor(key);
}

// Offline: everything local works (mods, Quick Drive, pictures shipped with the
// launcher); news, store prices, mod update checks and the site sync need the
// internet, so a small note says so. OFFLINE_NOTICE_PREVIEW shows it while online too.
const OFFLINE_NOTICE_PREVIEW = false;
async function checkOnline() {
  const r = await run(`${CURL} -s -I --max-time 6 -o ${NULL_DEV} -w "%{http_code}" https://store.steampowered.com/`);
  return r.exitCode === 0 && /^[23]/.test(r.stdOut.trim());
}
function showOfflineNotice() {
  if ($('#net-note')) return;
  const el = document.createElement('div');
  el.id = 'net-note';
  el.innerHTML = `<span>You're offline. News, store prices and mod updates won't load.</span>
    <button class="net-close" title="Close" aria-label="Close"><svg viewBox="0 0 12 12"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>`;
  const hide = () => { el.classList.add('hide'); setTimeout(() => el.remove(), 200); };
  el.querySelector('.net-close').onclick = hide;
  setTimeout(hide, 10000);
  document.body.appendChild(el);
}

// A newer launcher on GitHub (appupdate.js): a red bar along the bottom offers to
// install it, skip that version (not offered again) or close it (offered again next
// launch). While it shows, the page is that much shorter (fitToWindow), so it covers nothing.
async function checkAppUpdate({ manual = false } = {}) {
  const rel = await latestRelease().catch(() => null);
  if (!rel || !isNewer(rel.version, window.NL_APPVERSION || '0')) return null;
  if (manual || state.settings.skipVersion !== rel.version) showUpdateOffer(rel, await isInstalledCopy());
  return rel;
}
const UPDATE_BAR_H = 50; // design px, as in app.css
function showUpdateOffer(rel, installed) {
  $('#app-update-bar')?.remove();
  const el = document.createElement('div');
  el.id = 'app-update-bar';
  el.innerHTML = `<span class="upd-bar-text"><b>Assetto Launcher ${esc(rel.version)} is available.</b> You have ${esc(window.NL_APPVERSION || '')}.</span>
    <button class="upd-bar-main" data-u="install">${installed && rel.setup ? 'Update now' : 'Download ↗'}</button>
    <button class="upd-bar-link" data-u="notes">What's new ↗</button>
    <button class="upd-bar-link" data-u="skip">Skip this version</button>
    <button class="upd-bar-close" data-u="close" title="Not now" aria-label="Not now"><svg viewBox="0 0 12 12"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>`;
  const close = () => { el.remove(); fitToWindow(); };
  el.onclick = async e => {
    const b = e.target.closest('[data-u]');
    if (!b) return;
    const act = b.dataset.u;
    if (act === 'notes') openExternal(rel.page);
    if (act === 'close') close();
    if (act === 'skip') { state.settings.skipVersion = rel.version; saveSettings(); close(); }
    if (act === 'install') {
      if (!installed || !rel.setup) { openExternal(rel.page); return; }
      b.disabled = true; b.textContent = 'Downloading…';
      try {
        await installUpdate(rel.setup);
        b.textContent = 'Installing…';
        // The installer takes over from here and starts the new version.
        setTimeout(() => Neutralino.app.exit(), 800);
      } catch (err) {
        toast(err.message || 'The update failed', true);
        b.disabled = false; b.textContent = 'Update now';
      }
    }
  };
  document.body.appendChild(el);
  fitToWindow();
}

// Snapshot runs click through dialogs; they mustn't change the user's settings.
function saveSettings() { if (!state.snapshotRun) storageSet('settings', state.settings); }

async function detect() {
  state.steamPath = await findSteamPath();
  state.installed = await findInstalledApps(state.steamPath);
  state.paths = await resolvePaths(state.installed, state.settings.overrides, state.steamPath);
  state.paths.steam = state.steamPath; // Steam screenshots (media.js)
  state.cache = {};
  checkGameUpdates();
  renderSidebar();
  render();
}

// Scale the 1920x991 design canvas to the window. The canvas keeps Figma pixel
// sizes; extra width or height in the window becomes extra canvas space.
// The UI is laid out on the 1920x991 design canvas, zoomed to fit the smallest
// (and default) window, MIN_WIN. A bigger window (maximized or resized) keeps that
// zoom and gets more room instead: the navbar, sidebar, buttons and news cards stay
// the same size, the hero image grows and the mod grids get more columns. Smaller
// windows zoom out. The zoom comes from MIN_WIN, not from the window at startup:
// the window reopens at its last size, maximized too, which would make it bigger.
const DESIGN_W = 1920, DESIGN_H = 991;
// k: window px per CSS px (Windows display scaling); devicePixelRatio until the
// window's real size is known (setupWindow).
const minWindowZoom = k => Math.min(MIN_WIN.width / k / DESIGN_W, MIN_WIN.height / k / DESIGN_H);
let baseZoom = minWindowZoom(window.devicePixelRatio || 1);
function fitToWindow() {
  const fit = Math.min(innerWidth / DESIGN_W, innerHeight / DESIGN_H);
  const z = fit > 0 ? Math.min(fit, baseZoom) : baseZoom;
  document.body.style.zoom = z;
  // The home page's logo and text grow with the extra room (a little less than it).
  const grow = Math.min(innerWidth / z / DESIGN_W, innerHeight / z / DESIGN_H);
  document.documentElement.style.setProperty('--hero-scale', (1 + Math.max(0, grow - 1) * 0.75).toFixed(3));
  const root = document.documentElement.style;
  root.setProperty('--app-w', `${innerWidth / z}px`);
  root.setProperty('--app-h', `${innerHeight / z - ($('#app-update-bar') ? UPDATE_BAR_H : 0)}px`);
}
fitToWindow();
window.addEventListener('resize', fitToWindow);

async function setupWindow() {
  $('#win-min').onclick = () => Neutralino.window.minimize();
  $('#win-max').onclick = async () => (await Neutralino.window.isMaximized()) ? Neutralino.window.unmaximize() : Neutralino.window.maximize();
  $('#win-close').onclick = requestExit;
  $('#install-pill').onclick = openInstallDialog;
  $('#titlebar').ondblclick = e => { if (!e.target.closest('button')) $('#win-max').click(); };
  windowGrips();
  await dropResizeFrame();
  try {
    const k = (await Neutralino.window.getSize()).width / outerWidth;
    if (k > 0.5 && k < 5) { baseZoom = minWindowZoom(k); fitToWindow(); }
  } catch (err) { log(`window scale: ${JSON.stringify(err)}`); }
  syncMaximized();
  window.addEventListener('resize', syncMaximized);
  try {
    await Neutralino.window.setDraggableRegion('titlebar', { exclude: [$('#nav'), $('.win-controls'), $('#install-pill')] });
  } catch (e) { log(`drag region failed ${JSON.stringify(e)}`); }
}

Neutralino.events.on('ready', async () => {
  try {
    $('#app-version').textContent = `v${window.NL_APPVERSION || ''}`;
    await setupWindow();
    state.settings = { ...DEFAULT_SETTINGS, ...(await storageGet('settings', {})) };
    if (state.settings.backgrounds && Object.keys(state.settings.backgrounds).length) await backgroundsDir();
    state.game = gameByKey(state.settings.lastGame) ? state.settings.lastGame : 'rally';
    renderSidebar();
    await detect();
    if (!state.snapshotRun && !(await runningProcesses(['acs']).catch(() => new Set())).has('acs')) restoreClassLayout().catch(err => log(`academy layout: ${err?.message || err}`));
    await loadSiteImages();
    const rallyCache = await appCacheDir('rally').catch(() => '');
    await loadRallyData(rallyCache);
    checkOnline().then(online => {
      // Online: every game's news and the official Rally page are checked for
      // anything new, in the background (a few KB when nothing changed).
      if (online) {
        if (!state.snapshotRun) checkAppUpdate();
        for (const g of GAMES) checkNews(g.appid);
        siteSync().catch(err => log(`site sync: ${err?.message}`));
        // Rally's texts (rallydata.js): a newer file on GitHub replaces the shipped one.
        if (rallyCache) refreshRallyData(rallyCache).then(changed => {
          if (!changed) return;
          delete state.cache['rally:cars']; delete state.cache['rally:tracks']; delete AY.data.rally;
          if (state.view === 'mods' && state.game === 'rally') render();
        }).catch(err => log(`rally data: ${err?.message}`));
      }
      if (!online || OFFLINE_NOTICE_PREVIEW) showOfflineNotice();
    });
    const snapArg = (window.NL_ARGS || []).find(a => a.startsWith('--snapshots='));
    if (snapArg) { state.snapshotRun = true; runSnapshots(snapArg.slice('--snapshots='.length)); }
    else setTimeout(() => autoBackups(GAMES.filter(isInstalled).map(g => g.key), state.paths), 15000);
    // The display's modes take a PowerShell / xrandr call; asked early so Settings opens at once.
    if (state.paths?.ac.install) setTimeout(() => displayModes().catch(() => {}), 4000);
    // Not in test runs: they must never write to the game.
    if (!(window.NL_ARGS || []).some(a => /^--(import-test|snapshots|check-|preview-)/.test(a))) setTimeout(() => evoTrackSync({ quiet: true }), 8000);
    const importArg = (window.NL_ARGS || []).find(a => a.startsWith('--import-test='));
    if (importArg) import('./dev-import-test.js').then(m => m.runImportTest(importArg.slice('--import-test='.length), {
      // The UI install test installs into its sandbox folders and saves no settings.
      usePaths: paths => { state.paths = paths; state.cache = {}; state.snapshotRun = true; },
    }));
  } catch (e) {
    log(`boot failed: ${e?.stack || JSON.stringify(e)}`);
    toast('Startup error — see neutralinojs.log', true);
  }
});

// Dev aid: `--snapshots=<dir>` walks every game/view, saves window snapshots, then exits.
async function runSnapshots(dir) {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const snap = async name => { await wait(2500); await Neutralino.window.snapshot(`${norm(dir)}/${name}.png`); log(`snapshot ${name}`); };
  // Open the session sheet, switch it to Race, snapshot, close it.
  const snapSession = async prefix => {
    $('#main .qd-session-btn')?.click(); await snap(`${prefix}-session`);
    [...document.querySelectorAll('.qd-sheet .qd-seg button')].find(b => b.textContent === 'Race')?.click();
    await snap(`${prefix}-session-race`);
    $('.qd-sheet [data-done]')?.click();
  };
  // --check-academy: the Academy page, a series, an event's window; race.ini for a
  // few kinds of event, written to <snapshots>/academy-sandbox/cfg instead of AC's;
  // made-up race_out.json results read from there and saved under a test key (the
  // player's own progress is left alone), with the windows that show them.
  if ((window.NL_ARGS || []).includes('--check-academy')) {
    useAcademyStore('academy-check');
    await storageSet('academy-check', null);
    // Rally: the player's stage records against the AI's time for that car and stage.
    for (const [k, v] of await rallyBests(state.paths).catch(() => new Map())) {
      const [stage, car] = k.split('|'), ai = rallyAiTime(stage, car);
      log(`check-academy rally record ${stage} ${car}: ${lapTime(v.ms)} (penalty ${v.penalty}) ai ${ai ? lapTime(ai) : '-'} ratio ${ai ? (v.ms / ai).toFixed(3) : '-'}`);
    }
    const sb = `${norm(dir)}/academy-sandbox`;
    await ensureDir(`${sb}/cfg`); await ensureDir(`${sb}/out`);
    await writeText(`${sb}/cfg/race.ini`, '[CAR_0]\r\nDRIVER_NAME=Test Driver\r\nNATIONALITY=Italy\r\n\r\n[OPTIONS]\r\nUSE_MPH=1\r\n');
    const sandbox = { ...state.paths, ac: { ...state.paths.ac, cfg: `${sb}/cfg` } };
    state.view = 'academy'; AY.game = 'ac'; render(); await wait(8000);
    await snap('academy-ac');
    const d = await academyData('ac');
    const kinds = {};
    for (const e of d.all) kinds[`${e.group}:${e.kind}:${e.goal?.type || '-'}`] = (kinds[`${e.group}:${e.kind}:${e.goal?.type || '-'}`] || 0) + 1;
    log(`check-academy: ${d.career.length} series, ${d.career.reduce((n, s) => n + s.events.length, 0)} career events, ${d.special.length} special (${d.special.filter(e => e.missing).length} missing); ${JSON.stringify(kinds)}`);
    log(`check-academy missing tracks: ${d.special.filter(e => e.missing === 'track').map(e => `${e.key.split('/').pop()} ${e.track}/${e.layout}`).join(', ')}`);
    for (const s of d.career) log(`check-academy series ${s.id} ${s.code} "${s.name}" ${s.level} champ ${s.champ} goal ${JSON.stringify(s.goal)} needs ${s.requires.join('+') || '-'} events ${s.events.length} missing ${s.events.filter(e => e.missing).map(e => `${e.car}@${e.track}`).join(',') || '-'} opp ${s.opponents.length}`);
    const view = main.querySelector('.view.academy');
    view.scrollTop = view.scrollHeight; await snap('academy-ac-special');
    view.scrollTop = 0;

    const series = id => d.career.find(s => s.id === id);
    const special = test => d.special.find(e => !e.missing && test(e));
    const picks = {
      timeattack: series('series0').events[0],
      race: series('series1').events[1],
      champ: series('series9').events[0],
      weekend: series('series13').events[0],
      hotlap: special(e => e.kind === 'hotlap'),
      ai: special(e => e.goal?.type === 'ai'),
      drift: special(e => e.kind === 'drift'),
      drag: special(e => e.kind === 'drag'),
    };
    const brief = ini => ini.split(/\r\n/).filter(l => /^\[(RACE|CAR_0|CAR_1|SESSION_\d|SPECIAL_EVENT|OPTIONS)\]|^(MODEL|SKIN|TRACK|CONFIG_TRACK|CARS|AI_LEVEL|DRIVER_NAME|NATIONALITY|TYPE|LAPS|STARTING_POSITION|GUID|USE_MPH|DURATION_MINUTES)=/.test(l)).join(' ');
    for (const [name, ev] of Object.entries(picks)) {
      if (!ev) { log(`check-academy ini ${name}: no event`); continue; }
      const s = ev.series && aySeries(d, ev.series);
      const ini = await writeAcEvent(sandbox, ev, { ai: name === 'ai' ? ev.goal.tiers[1] : 0, opponents: s?.champ ? s.opponents : null });
      log(`check-academy ini ${name} (${ev.key} "${ev.name}", goal ${JSON.stringify(ev.goal)}): ${brief(ini)} | ${ini.split('\r\n').filter(l => /^\[CAR_\d+\]/.test(l)).length} cars`);
    }

    // Results: race_out.json as AC writes it, then the window that shows it.
    const out = (type, extra = {}) => writeText(`${sb}/out/race_out.json`, JSON.stringify({ track: 'x', players: [{ name: 'Test', car: 'x' }], sessions: [{ event: 0, name: 'S', type, lapsCount: extra.lapsCount || 0, laps: extra.laps || [], lapstotal: extra.lapstotal || [], raceResult: extra.raceResult }], extras: extra.extras || [] }));
    const result = async (name, ev, opts = {}) => {
      const r = await readAcResult(sandbox, ev, 0);
      const s = ev.series && aySeries(d, ev.series);
      const res = await recordResult(ev, r, { ai: opts.ai || 0, series: s });
      log(`check-academy result ${name}: read ${JSON.stringify({ ...r, names: undefined })} saved ${JSON.stringify(res)}`);
      showAcademyResult(ev, r, res, { series: s, ai: opts.ai || 0, p: await academyProgress(), unlocked: opts.unlocked || [], finished: !!opts.finished });
      await snap(`academy-result-${name}`);
      $('#modal-root [data-close]')?.click();
    };
    const lap = (time, cuts = 0, car = 0) => ({ car, time, cuts });
    await out(5, { extras: [{ name: 'timeattack', points: 2400 }] });
    await result('timeattack', picks.timeattack, { unlocked: [series('series1')] });
    await out(3, { lapsCount: 3, laps: [lap(98000), lap(96500), lap(97000)], lapstotal: [3, 3, 3], raceResult: [3, 0, 1, 2] });
    await result('race-2nd', picks.race);
    await out(3, { lapsCount: 3, laps: [lap(98000)], lapstotal: [1, 3], raceResult: [1, 0] });
    await result('race-dnf', picks.race);
    await out(4, { laps: [lap(85500, 2), lap(87100), lap(86400)] });
    if (picks.hotlap) await result('hotlap', picks.hotlap);
    await out(3, { lapsCount: 5, laps: [lap(90000)], lapstotal: [5, 5], raceResult: [0, 4, 2] });
    if (picks.ai) await result('ai-win', picks.ai, { ai: picks.ai.goal.tiers[1] });
    await out(3, { lapsCount: 6, laps: [lap(110000)], lapstotal: [6, 6], raceResult: [2, 5, 0, 1, 3, 4, 6, 7, 8, 9] });
    await result('champ-round1', picks.champ);

    // A championship after a round, a plain series, an event's window.
    AY.series = picks.champ.series; drawAcademy(true); await wait(500); await snap('academy-champ');
    AY.series = picks.race.series; drawAcademy(true); await wait(500); await snap('academy-series');
    await openAcademyEvent(picks.race.key); await snap('academy-event');
    $('#modal-root [data-close]')?.click();
    if (picks.ai) { await openAcademyEvent(picks.ai.key); await snap('academy-event-ai'); $('#modal-root [data-close]')?.click(); }
    await openAcademyEvent(series('series9').events[1].key); await snap('academy-event-round2');
    $('#modal-root [data-close]')?.click();
    // EVO: the levels against EVO's lists, the session written for each kind, results read from made-up files.
    if (isInstalled(gameByKey('evo'))) {
      AY.game = 'evo'; renderAcademy(); await wait(8000); await snap('academy-evo');
      const de = await academyData('evo');
      for (const e of de.all) log(`check-academy evo ${e.key} ${e.kind} ${e.car}@${e.track}/${e.layout}: ${e.carName} · ${e.trackName} missing ${e.missing || '-'} guid ${e.guid ? 'yes' : 'no'} goal ${JSON.stringify(e.goal)}`);
      for (const kind of ['timetrial', 'race', 'weekend']) {
        const e = de.all.find(x => x.kind === kind);
        const s = evoSessionFor(e, defaultEvoSession());
        log(`check-academy evo session ${kind} ${e.key}: ${JSON.stringify({ mode: s.mode, practice: s.mode === 'practice' ? s.practice : undefined, flying: s.flying ? e.evoLayout.hotstint.container : undefined, hotstint: e.evoLayout?.hotstint?.container, race: s.mode === 'race' ? s.race : undefined, weekend: s.mode === 'weekend' ? s.weekend : undefined, weather: s.weather })}`);
      }
      const rd = `${sb}/evo-results`;
      await ensureDir(rd);
      const tt = de.all.find(x => x.kind === 'timetrial'), race = de.all.find(x => x.kind === 'race');
      const drv = (name, car, pos, laps, best) => ({ driver_name: name, driver_surname: 'X', car_name: car, position: pos, laps, best_lap: best, is_current_driver: false });
      await writeText(`${rd}/261010-1000_SP_Practice.sessionresults.json`, JSON.stringify({ session: tt.flying ? 'Race' : 'Practice', track: tt.trackTitle, layout: tt.flying ? tt.evoLayout.hotstint.container : `${tt.layoutName} Time Attack`, drivers: [drv('Test', tt.carName, 0, 5, lapTime(tt.goal.tiers[1] - 300).padStart(9, '0'))] }));
      await writeText(`${rd}/261010-1010_SP_Race.sessionresults.json`, JSON.stringify({ session: 'Race', track: race.trackTitle, layout: `${race.layoutName} Race`, drivers: [drv('•Ai', race.carName, 0, race.laps, '01:00.000'), drv('•Bi', race.carName, 1, race.laps, '01:00.000'), drv('Test', race.carName, 2, race.laps, '01:01.000')] }));
      log(`check-academy evo result timetrial: ${JSON.stringify(await readEvoResult(rd, tt, 0))} (a flying start's 8 s run to the line too short: ${evoLapTooShort(tt, 8000)})`);
      log(`check-academy evo result race: ${JSON.stringify(await readEvoResult(rd, race, 0))}`);
      log(`check-academy evo result other car: ${JSON.stringify(await readEvoResult(rd, { ...race, carName: 'Other car' }, 0))}`);
      const r = await readEvoResult(rd, race, 0);
      const res = await recordResult(race, r, {});
      showAcademyResult(race, r, res, { p: await academyProgress() }); await snap('academy-evo-result'); $('#modal-root [data-close]')?.click();
      await openAcademyEvent(race.key); await snap('academy-evo-event'); $('#modal-root [data-close]')?.click();
      await openAcademyEvent(tt.key); await snap('academy-evo-event-tt'); $('#modal-root [data-close]')?.click();
      await openAcademyEvent(de.levels.find(l => l.unlock).events[0].key); await snap('academy-evo-event-locked'); $('#modal-root [data-close]')?.click();
      // The bonus event: locked, then gold on all six of the first level opens it (the result
      // window says so, with the driver level), and its strip under the level.
      const rookie = de.levels[0], dl0 = driverLevel(await academyProgress());
      await openAcademyEvent(rookie.bonus.key); await snap('academy-evo-bonus-locked'); $('#modal-root [data-close]')?.click();
      const goldOf = e => e.goal.type === 'time' ? { ms: e.goal.tiers[2] - 100, laps: 3 } : { pos: 1, finished: true, laps: e.laps };
      for (const e of rookie.events.slice(0, 5)) await recordResult(e, goldOf(e), {});
      const last = rookie.events[5], pb = await academyProgress(), was = bonusLocked(rookie, pb);
      const lres = await recordResult(last, goldOf(last), {});
      log(`check-academy evo bonus: locked before ${was}, after ${bonusLocked(rookie, pb)}; driver ${JSON.stringify(dl0)} -> ${JSON.stringify(driverLevel(pb))}`);
      const sr0 = srOf(pb); await changeSR(-4);
      showAcademyResult(last, goldOf(last), lres, { p: pb, unlocked: [tr('Bonus event: {name}', { name: tr(rookie.bonus.name) })], driver: { from: dl0, to: driverLevel(pb) }, sr: { from: sr0, to: srOf(pb) } });
      await wait(1500); await snap('academy-evo-bonus-result'); $('#modal-root [data-close]')?.click();
      drawAcademy(); await wait(2500);
      main.querySelector('.view.academy').scrollTop = 160; await snap('academy-evo-bonus');
      // Sprints: the session, and the time read from a made-up EVO log (a run, a restart, a
      // quicker run, then a lap on past the finish arch that doesn't count).
      const sp = de.all.find(x => x.kind === 'sprint');
      if (sp) {
        const s = evoSessionFor(sp, defaultEvoSession());
        log(`check-academy evo session sprint ${sp.key}: ${JSON.stringify({ mode: s.mode, arch: s.arch, race: s.race })} arches here ${JSON.stringify(sp.evoLayout?.arches?.map(a => a.container) || [])}`);
        const ld = `${sb}/evo-logs`;
        await ensureDir(ld);
        const gold = sp.goal.tiers[2], at = ms => `[${new Date(Date.UTC(2026, 9, 10, 10) + ms).toISOString().replace('T', ' ').replace('Z', '')}] [gameplay] [info] `;
        const lines = [`${at(0)}Game Started! GameModeType_INSTANT_RACE | ${sp.trackTitle} ${sp.arch} Race  1 laps @2014/8/15 7:0:0 | ${sp.car} | GameModeSelectionWeatherType_CLEAR | 0 opponents | AssistPresetListType_EXPERT`];
        let t = 0;
        for (const ms of [gold + 990, gold - 200]) {
          t += 10000;
          lines.push(`${at(t)}changing session phase 4 -> 50`, `${at(t + 9)}Split completed for car c0ffee: (45458 ms, splitindex 0) lap:0`, `${at(t + ms + 12)}Split completed for car c0ffee: (${ms} ms, splitindex 0) lap:0`);
          t += ms + 30000;
          lines.push(`${at(t)}[CLIENT] onGameModeStep session_phase_changed: Session -> Waiting_For_Players`);
        }
        lines.splice(-1, 0, `${at(t - 5000)}Split completed for car c0ffee: (${gold * 3} ms, splitindex 0) lap:0`);
        await writeText(`${ld}/log-261010-100000.txt`, lines.join('\r\n'));
        log(`check-academy evo sprint log: ${JSON.stringify(await readEvoSprint(ld, sp, 0))} (want ${gold - 200} from 2 runs)`);
        log(`check-academy evo sprint other car: ${JSON.stringify(await readEvoSprint(ld, { ...sp, car: 'ks_other_car' }, 0))}`);
        // As EVO writes it: the same log fed in uneven pieces.
        const whole = lines.join('\r\n'), reader = sprintReader(sp), live = [];
        for (let i = 0, k = 1; i < whole.length; i += k, k = k * 3 % 97 + 1) live.push(...reader.feed(whole.slice(i, i + k)));
        log(`check-academy evo sprint live: ${JSON.stringify(live)} (want ${JSON.stringify([gold + 990, gold - 200])})`);
        const sr = await readEvoSprint(ld, sp, 0), sres = await recordResult(sp, sr, {});
        showAcademyResult(sp, sr, sres, { p: await academyProgress() }); await snap('academy-evo-sprint-result'); $('#modal-root [data-close]')?.click();
        // The card over the game: its own window, started as for a sprint, with a picture of it.
        const ov = { overlay: '', sid: Date.now(), n: 0, beat: 0 }, pic = `${norm(dir)}/academy-evo-overlay.png`;
        await overlayOpen(ov, '');
        await wait(4000);
        await overlaySend(ov, { show: resultCard(sp, { ms: gold - 200 }, { gained: 3, type: 'time' }), seconds: 3, snap: pic });
        await wait(3000);
        log(`check-academy overlay picture: ${await exists(pic)}`);
        await overlaySend(ov, { quit: true });
        // The safety rating's tile: its own window, on the right.
        const ovr = { overlay: '', sid: Date.now(), n: 0, beat: 0 }, picR = `${norm(dir)}/academy-evo-overlay-sr.png`;
        await overlayOpen(ovr, 'right');
        await wait(4000);
        await overlaySend(ovr, { show: srCard(-3), seconds: 3, snap: picR });
        await wait(3000);
        log(`check-academy sr card picture: ${await exists(picR)}`);
        await overlaySend(ovr, { quit: true });
        // A race while EVO is open: the finish read from a made-up log as EVO writes
        // it (the player 3rd of 3), its card; then the result as EVO saves it (saved,
        // no second card), and the same file again when its results screen is left.
        const lr = { ev: race, l: { academy: { live: 0, liveFiles: [] } }, race: raceReader(race), early: null, texts: new Set(), overlay: '', n: 0, beat: 0 };
        const rl = [`${at(0)}[VehicleSystem][c0ffee] SpawnVehicle(Player)`, `${at(1)}Game Started! GameModeType_INSTANT_RACE | ${race.trackTitle} ${race.layoutName} Race  ${race.laps} laps @2014/8/15 18:0:0 | ${race.car} | GameModeSelectionWeatherType_CLEAR | 2 opponents`, `${at(2)}changing session phase 4 -> 50`];
        for (let lap = 1; lap <= race.laps; lap++) for (const car of ['a1', 'b2', 'c0ffee']) rl.push(`${at(lap * 70000)}New lap carId ${car}: 01:${String(10 + lap).padStart(2, '0')}.250`);
        const fin = lr.race.feed(`${rl.join('\r\n')}\r\n`);
        for (const x of fin) await liveFinish(lr, x);
        const raceFile = await readText(`${rd}/261010-1010_SP_Race.sessionresults.json`);
        await writeText(`${rd}/261010-1011_SP_Race.sessionresults.json`, raceFile);
        await liveResultsFile(lr, `${rd}/261010-1010_SP_Race.sessionresults.json`);
        await liveResultsFile(lr, `${rd}/261010-1011_SP_Race.sessionresults.json`);
        log(`check-academy evo live race: finish ${JSON.stringify(fin)} (want pos 3) then ${JSON.stringify(lr.l.academy)} (want live 1, 2 files) card ${JSON.stringify(resultCard(race, r, res))}`);
        // A time trial while EVO is open: three laps from a made-up log (the second
        // with a penalty shown, so not counted), a card each; then the session's
        // file with the third as its best (saved, no second card).
        const lt = { ev: tt, l: { academy: { live: 0, liveFiles: [] } }, laps: lapReader(tt), early: null, texts: new Set(), overlay: '', n: 0, beat: 0 };
        const evoLap = ms => `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${((ms % 60000) / 1000).toFixed(3).padStart(6, '0')}`;
        const tl = [`${at(0)}[VehicleSystem][c0ffee] SpawnVehicle(Player)`, `${at(1)}Game Started! ${tt.flying ? `GameModeType_INSTANT_RACE | ${tt.trackTitle} ${tt.evoLayout.hotstint.container} Race  900 seconds` : `GameModeType_PRACTICE | ${tt.trackTitle} ${tt.layoutName} Time Attack Practice  900 seconds`} @2014/8/15 10:30:0 | ${tt.car} | GameModeSelectionWeatherType_CLEAR | 0 opponents`,
          `${at(120000)}New lap carId c0ffee: ${evoLap(tt.goal.tiers[1] + 2000)}`, `${at(180000)}UINotification UINotificationType_SessionPenalty `, `${at(180001)}true {PENALTY_ADDED_KEY} #0`, `${at(220000)}New lap carId c0ffee: ${evoLap(tt.goal.tiers[0] - 3000)}`, `${at(320000)}New lap carId c0ffee: ${evoLap(tt.goal.tiers[1] - 300)}`];
        const laps = lt.laps.feed(`${tl.join('\r\n')}\r\n`);
        for (const x of laps) await liveLap(lt, x);
        const lapBest = lt.early?.ms;
        await liveResultsFile(lt, `${rd}/261010-1000_SP_Practice.sessionresults.json`);
        log(`check-academy evo live laps: ${JSON.stringify(laps)} (want 3, the 2nd cut) best ${lapTime(lapBest)} then ${JSON.stringify(lt.l.academy)} (want live 1, 1 file)`);
        // Reading a log as EVO writes it: what's new each time, a character split between reads kept whole.
        const lg = `${sb}/evo-logs/log-append.txt`, la = { file: lg, pos: 0, decoder: new TextDecoder() };
        await writeText(lg, 'line one\n');
        const a1 = await logAppend(la);
        await writeText(lg, 'line one\nPérez é');
        const a2 = await logAppend(la), a3 = await logAppend(la);
        log(`check-academy log append: ${JSON.stringify([a1, a2, a3])} (want ["line one\\n","Pérez é",""])`);
        // A sprint run after a jump start (EVO's start check at the arch) doesn't count.
        const jr = sprintReader(sp), jl = [`${at(0)}Game Started! GameModeType_INSTANT_RACE | ${sp.trackTitle} ${sp.arch} Race  1 laps @2014/8/15 7:0:0 | ${sp.car} | x |`,
          `${at(10000)}changing session phase 4 -> 50`, `${at(10010)}DetectorWrongPositionOnStart::onStart - CurrentTranslation: 1 ,2 ,3 (Penalty: true)`, `${at(10015)}Split completed for car c0ffee: (100 ms, splitindex 0) lap:0`,
          `${at(10000 + gold)}Split completed for car c0ffee: (${gold} ms, splitindex 0) lap:0`];
        log(`check-academy sprint jump: runs ${JSON.stringify(jr.feed(`${jl.join('\n')}\n`))} jumps ${jr.state.jumps} (want [] 1)`);
        // The safety rating's log reader: green, a clean lap, a penalty (a jump start), laps, the end.
        const sl = [`${at(0)}[VehicleSystem][c0ffee] SpawnVehicle(Player)`, `${at(1)}changing session phase 4 -> 50`, `${at(2)}DetectorWrongPositionOnStart::onStart - x (Penalty: true)`, `${at(3)}true {PENALTY_ADDED_KEY} #0`,
          `${at(60000)}New lap carId c0ffee: 01:00.000`, `${at(60100)}New lap carId a1: 01:00.100`, `${at(90000)}false {PENALTY_CLEARED_KEY} #0`, `${at(120000)}New lap carId c0ffee: 01:00.000`, `${at(130000)}changing session phase 71 -> 72`];
        log(`check-academy sr log: ${JSON.stringify(srReader().feed(`${sl.join('\n')}\n`))} grades ${[0, 19, 20, 50, 60, 80, 99].map(n => srGrade(n)).join('')} (want EEDCBAS)`);
        // EVO's live data, through the launcher's helper: a stand-in page (never EVO's)
        // written by another process: a light hit, a heavy one, wheels off, wheels off
        // with the lap marked invalid (a cut), the lap marked invalid with the wheels on.
        const tev = [], stopT = await startTelemetry(e => tev.push(e), 'Local\\acevo_launcher_check', 'Local\\acevo_launcher_check_gfx');
        await Neutralino.os.spawnProcess(powershellEncodedCommand(`$m = [IO.MemoryMappedFiles.MemoryMappedFile]::CreateNew('Local\\acevo_launcher_check', 4096); $v = $m.CreateViewAccessor(0, 4096);
          $gm = [IO.MemoryMappedFiles.MemoryMappedFile]::CreateNew('Local\\acevo_launcher_check_gfx', 8192); $g = $gm.CreateViewAccessor(0, 8192);
          $g.Write(4, [int]2); $car = [Text.Encoding]::ASCII.GetBytes('ks_check_car'); $g.WriteArray(3086, $car, 0, $car.Length); $g.Write(3121, [byte]1); Start-Sleep -Milliseconds 2500;
          $v.Write(224, [float]0.6); $v.Write(240, [float]0.6); Start-Sleep -Milliseconds 900; $v.Write(224, [float]6); $v.Write(240, [float]6); Start-Sleep -Milliseconds 900;
          $v.Write(244, [int]4); Start-Sleep -Milliseconds 700; $v.Write(244, [int]0); Start-Sleep -Milliseconds 2000;
          $v.Write(244, [int]4); Start-Sleep -Milliseconds 500; $g.Write(3121, [byte]0); Start-Sleep -Milliseconds 300; $v.Write(244, [int]0); Start-Sleep -Milliseconds 2000;
          $g.Write(3121, [byte]1); Start-Sleep -Milliseconds 300; $g.Write(3121, [byte]0); Start-Sleep -Milliseconds 600;
          $v.Write(28, [float]150); $g.Write(2396, [int]34040); $g.Write(2384, [int]1); Start-Sleep -Milliseconds 700; $g.Write(2384, [int]0); $g.Write(3121, [byte]1); Start-Sleep -Milliseconds 700;
          $g.Write(2384, [int]1); Start-Sleep -Milliseconds 100; $g.Write(2396, [int]33000); Start-Sleep -Milliseconds 700; $v.Dispose(); $m.Dispose(); $g.Dispose(); $gm.Dispose()`));
        await wait(17000); stopT();
        log(`check-academy telemetry: ${JSON.stringify(tev)} (want open, gfx ok ks_check_car, hit 1.2, hit 10.8, off 4 no cut, off 4 cut, cut, lap 1 34040 invalid at 150, lap 1 33000 valid; losses ${tev.map(srLoss).filter(Boolean).join(' ')} want 1 3 1 2 2)`);
        // Impacts close together are one incident: three taps 0.6 s apart, a hard hit 1 s later, then a tap 3 s on.
        const inc = { hitAt: 0, hitCost: 0 }, hits = [[3, 10000], [3, 10600], [4, 11200], [25, 12200], [3, 15200]].map(([d, at]) => srHitExtra(inc, { t: 'hit', d }, at));
        log(`check-academy sr incidents: ${hits.join(' ')} (want 1 0 0 4 1)`);
        // EVO's race settings as they are now (read-only) against Hot hatch scrap: does it look made easier?
        const hh = de.all.find(x => x.def?.id === 'e4' && x.level === 'rookie'), now = await readEvoSession().catch(err => ({ error: err?.message }));
        log(`check-academy evo session now: race ${JSON.stringify(now?.race?.grid || now)} maxDrivers ${hh?.evoLayout?.race?.maxDrivers} want ${Math.min(hh.opponents, Math.max(1, (hh.evoLayout?.race?.maxDrivers || 33) - 1))} skill ${JSON.stringify(hh.skill)} easier ${await evoAiEasier(hh)}`);
        const au = await (await fetch('/sounds/academy-card.mp3')).arrayBuffer();
        log(`check-academy sound: ${au.byteLength} bytes, ${(await new OfflineAudioContext(2, 48000, 48000).decodeAudioData(au)).duration.toFixed(2)} s`);
        log(`check-academy chime: ${await playChime()}`);
        state.view = 'settings'; render(); await wait(1500);
        main.querySelector('.view').scrollTop = 99999; await snap('academy-settings-overlay');
        state.view = 'academy'; render(); await wait(1500);
        await openAcademyEvent(sp.key); await snap('academy-evo-event-sprint'); $('#modal-root [data-close]')?.click();
        AY.game = 'evo'; renderAcademy(); await wait(3000);
        main.querySelector('.view.academy').scrollTop = 620; await snap('academy-evo-sprints');
      }
    }
    // Rally: the levels with their reference times.
    if (isInstalled(gameByKey('rally'))) {
      AY.game = 'rally'; renderAcademy(); await wait(6000); await snap('academy-rally');
      const dr = await academyData('rally');
      for (const e of dr.all) log(`check-academy rally ${e.key} ${e.car}@${e.stage} ${ayClock(e.time)} w${e.weather}: ${e.carName} · ${e.trackName} ref ${e.ref ? lapTime(e.ref) : '-'} targets ${e.goal ? e.goal.tiers.map(lapTime).join('/') : '-'} missing ${e.missing || '-'}`);
      await openAcademyEvent(dr.all[0].key); await snap('academy-rally-event'); $('#modal-root [data-close]')?.click();
      await openAcademyEvent(dr.all.find(e => e.night).key); await snap('academy-rally-event-night'); $('#modal-root [data-close]')?.click();
      const e = dr.all[0], r = { ms: e.goal.tiers[2] - 500, penalty: 2000, laps: 1 };
      const res = await recordResult(e, r, {});
      showAcademyResult(e, r, res, { p: await academyProgress(), unlocked: [tr(dr.levels[1].name)] }); await snap('academy-rally-result'); $('#modal-root [data-close]')?.click();
    }
    // AC Modded: the classes against the cars installed, a class event written to the sandbox (not started).
    AY.game = 'ac'; AY.part = 'modded'; AY.series = ''; render(); await wait(4000); await snap('academy-modded');
    main.querySelector('.view.academy').scrollTop = 700; await snap('academy-modded-2');
    for (const c of d.classes) log(`check-academy class ${c.id}: ${c.cars.map(m => `${m.id}${m.installed ? `(${m.skins.length} liveries)` : ' missing'}`).join(', ')}; events ${c.events.map(e => `${e.kind}@${e.track}/${e.layout || '-'}${e.missing ? ` missing ${e.missing}` : ''} pits ${e.pitboxes}`).join(' | ')}`);
    const f2 = d.classes.find(c => c.id === 'f2'), fev = f2?.events.find(e => e.kind === 'weekend');
    if (fev && f2.cars[0].installed) {
      const car = f2.cars[0], skin = car.skins[0].id, max = Math.max(1, Math.min(fev.pitboxes || 20, 63) - 1);
      const grid = classGrid(f2, Math.min(fev.opponents, max), car.id, skin);
      const session = classSession(fev, defaultAcSession());
      log(`check-academy class grid ${f2.id}: ${grid.length} cars, ${new Set(grid.map(g => g.skin)).size} liveries, mine ${skin} in it ${grid.some(g => g.skin === skin)}; session ${JSON.stringify({ mode: session.mode, weekend: session.weekend, ai: session.ai, time: session.time })}`);
      await quickDrive(sandbox, { car: car.id, skin, skins: car.skins.map(x => x.id), track: fev.track, layout: fev.layout, session, maxOpponents: max, csp: null, grid, start: false });
      log(`check-academy class ini: ${brief(await readText(`${sb}/cfg/race.ini`))}`);
      await openAcademyEvent(fev.key); await snap('academy-modded-event'); $('#modal-root [data-close]')?.click();
      await out(2, { laps: [lap(101000), lap(99500, 0, 1), lap(98000, 1, 0), lap(99800, 0, 2), lap(100500, 0, 0), lap(99000, 0, 3)] });
      log(`check-academy class qualify result: ${JSON.stringify(await readAcResult(sandbox, { ...f2.events[0] }, 0))}`);
    }
    const tcr = d.classes.find(c => c.id === 'tcr');
    if (tcr) { await openAcademyEvent(tcr.events[0].key); await snap('academy-modded-event-missing'); $('#modal-root [data-close]')?.click(); }
    AY.part = 'original'; render(); await wait(2000);
    // Running: the banner while AC is (pretend) up with an Academy event.
    launches.ac = { at: Date.now(), academy: { key: picks.race.key, ai: 0 } }; starting.set('ac', Date.now());
    AY.series = ''; drawAcademy(true); await wait(500); await snap('academy-running');
    starting.delete('ac'); delete launches.ac;
    await storageSet('academy-check', null);
    await Neutralino.app.exit();
    return;
  }
  // --check-livery=<dir>: Rally car detection on copies laid out as <dir>\<CorrectCar>\<livery>\ (read only).
  const liveryArg = (window.NL_ARGS || []).find(a => a.startsWith('--check-livery='));
  if (liveryArg) {
    const dir = norm(liveryArg.slice('--check-livery='.length)), ids = await rallyCarIds(state.paths);
    let t = performance.now();
    const { guessLiveryCar } = await import('./rallylivery.js');
    for (const car of (await listDir(dir)).filter(e => e.type === 'DIRECTORY' && !e.entry.startsWith('.'))) {
      for (const l of (await listDir(join(dir, car.entry))).filter(e => e.type === 'DIRECTORY' && !e.entry.startsWith('.'))) {
        const g = await guessLiveryCar(join(dir, car.entry, l.entry), state.paths, ids).catch(err => ({ error: err?.message || String(err) }));
        const ok = g?.car?.toLowerCase() === car.entry.toLowerCase();
        log(`check-livery ${car.entry}/${l.entry}: ${g?.error ? `error ${g.error}` : `${ok ? 'RIGHT' : 'WRONG'} ${g?.car || '-'} ${g?.sure ? 'sure' : 'unsure'} likely ${g?.likely?.join(',')}`} ${Math.round(performance.now() - t)}ms`);
        t = performance.now();
      }
    }
    await Neutralino.app.exit();
    return;
  }
  // --preview-update: the update bar with a made-up newer version.
  if ((window.NL_ARGS || []).includes('--preview-update')) {
    showUpdateOffer({ version: '0.3.0', page: '', setup: 'preview' }, true);
    state.game = 'ac'; renderSidebar(); state.view = 'games'; render(); await snap('update-bar-games');
    state.view = 'mods'; render(); await snap('update-bar-mods');
    const h = () => getComputedStyle(document.documentElement).getPropertyValue('--app-h');
    log(`preview-update: page height ${h()} with the bar`);
    $('#app-update-bar [data-u="close"]').click();
    log(`preview-update: page height ${h()} after closing it`);
    await Neutralino.app.exit();
    return;
  }
  // --preview-backgrounds: AC with Rally's cover as its picked background, darkened 40 %
  // (Games tab and Settings). Snapshot runs don't save settings; the copied file is deleted after.
  if ((window.NL_ARGS || []).includes('--preview-backgrounds')) {
    const dir = await backgroundsDir(), file = 'ac-preview.jpg';
    let appDir = window.NL_PATH;
    try { appDir = await Neutralino.filesystem.getAbsolutePath(appDir); } catch { /* keep as is */ }
    await Neutralino.filesystem.copy(join(appDir, 'resources/img/covers/rally.jpg'), join(dir, file)).catch(err => log(`preview-backgrounds copy: ${JSON.stringify(err)}`));
    state.settings.backgrounds = { ac: file };
    state.settings.bgDarken = { ac: 40 };
    state.game = 'ac'; renderSidebar(); state.view = 'games'; render(); await snap('backgrounds-games');
    state.view = 'settings'; render(); await snap('backgrounds-settings');
    await Neutralino.filesystem.remove(join(dir, file)).catch(() => {});
    await Neutralino.app.exit();
    return;
  }
  // --check-zoom: the zoom and window size at startup (the same at any startup size, maximized or not).
  if ((window.NL_ARGS || []).includes('--check-zoom')) {
    await wait(1500);
    log(`check-zoom: maximized ${await Neutralino.window.isMaximized()}, inner ${innerWidth}x${innerHeight}, dpr ${devicePixelRatio}, zoom ${document.body.style.zoom}`);
    await snap('check-zoom');
    await Neutralino.app.exit();
    return;
  }
  // --maximize: a short pass in a maximized window (layout with more room than the canvas).
  if ((window.NL_ARGS || []).includes('--maximize')) {
    await Neutralino.window.maximize(); await wait(1000);
    for (const key of ['ac', 'evo']) { state.game = key; renderSidebar(); state.view = 'games'; render(); await snap(`max-${key}-games`); }
    state.game = 'ac'; renderSidebar(); state.view = 'mods'; state.settings.acFilter = 'all'; render(); await snap('max-ac-mods');
    openQuickDriveDialog(); await wait(4000); await snap('max-quickdrive');
    await snapSession('max');
    await Neutralino.app.exit();
    return;
  }
  // --check13: launcher updates (GitHub check, version order, offer, download + hash check).
  if ((window.NL_ARGS || []).includes('--check13')) {
    log(`check13 latest: ${JSON.stringify(await latestRelease())}; installed copy ${await isInstalledCopy()}`);
    log(`check13 order: ${[['0.2.0', '0.1.0'], ['0.10.0', '0.9.9'], ['v0.1.0', '0.1.0'], ['0.1.0', '0.2.0']].map(([a, b]) => `${a}>${b}=${isNewer(a, b)}`).join(' ')}`);
    showUpdateOffer({ version: '0.2.0', page: 'https://github.com/Zelbrad/AssettoLauncher/releases', setup: { name: 'x.exe' } }, true);
    await snap('check13-offer');
    try {
      await installUpdate({ name: 'check13-LICENSE.txt', url: 'https://github.com/Zelbrad/AssettoLauncher/raw/main/LICENSE', sha256: '00' });
      log('check13 install: NOT refused');
    } catch (err) { log(`check13 install refused: ${err.message}`); }
    await Neutralino.app.exit();
    return;
  }
  // --check14: Assetto Corsa's CSP and video settings and the AC session sheet
  // (WeatherFX weather, 24 hours, date, wind, assists). Writes nothing.
  if ((window.NL_ARGS || []).includes('--check14')) {
    const csp = await readCsp(state.paths);
    log(`check14 csp: ${JSON.stringify({ ...csp, styles: csp.styles.map(s => s.id), controllers: csp.controllers.map(c => `${c.id}:${c.followsWeather}`) })}`);
    const versions = await cspVersions();
    log(`check14 versions: ${versions?.list.map(v => `${v.version}:${v.kind}`).join(' ')}; latest ${versions?.latest}; stable ${versions?.recommended}`);
    const info = await cspVersionInfo('0.2.10');
    log(`check14 info 0.2.10: build ${info?.build}, ${info?.changes.length} items, first ${JSON.stringify(info?.changes.slice(0, 3))}`);
    const { weatherModFiles } = await import('./csp.js');
    log(`check14 pure files: ${(await weatherModFiles(state.paths, 'pure')).join(' | ')}; sol files: ${(await weatherModFiles(state.paths, 'sol')).join(' | ')}`);
    log(`check14 video ${JSON.stringify(await readVideo(state.paths))}; modes ${(await displayModes()).slice(0, 4).map(m => `${m.width}x${m.height}@${m.rates.join('/')}`).join(' ')}`);
    // Games -> Settings: the sidebar stays until Settings is drawn, then both change in one frame.
    state.view = 'games'; render(); await wait(2500);
    const t0 = performance.now();
    $('#nav [data-view="settings"]').click();
    const atClick = $('#app').classList.contains('settings-mode');
    await new Promise(res => { const tick = () => (main.querySelector('.view.settings') ? res() : requestAnimationFrame(tick)); tick(); });
    log(`check14 to settings: sidebar hidden at click ${atClick}, drawn after ${Math.round(performance.now() - t0)}ms, sidebar hidden then ${$('#app').classList.contains('settings-mode')}`);
    await wait(1000);
    main.querySelector('.view').scrollTop = 900;
    await renderSettings();
    log(`check14 redraw: scroll ${main.querySelector('.view').scrollTop}, still ${main.querySelector('.view').classList.contains('still')}`);
    main.querySelector('.view').scrollTop = 0;
    const group = [...document.querySelectorAll('.settings-group h3')].find(h => /Custom Shaders/.test(h.textContent));
    group?.scrollIntoView(); await snap('check14-settings-csp');
    $('#csp-row [data-act="csp-menu"]')?.click(); await snap('check14-csp-picker');
    $('#csp-row [data-act="csp-changes"]')?.click(); await wait(1500);
    log(`check14 version list after What's new: ${[...document.querySelectorAll('.csp-menu')].map(m => getComputedStyle(m).display).join(',')}`);
    for (const el of [main, $('#main .view')]) if (el) el.scrollTop += 1; // repaint before the snapshot
    await snap('check14-csp-changes');
    $('#csp-row [data-act="csp-changes"]')?.click();
    for (const el of [main, $('#main .view')]) if (el) el.scrollTop = [...document.querySelectorAll('.settings-group')].find(g => /Video/.test(g.textContent))?.offsetTop || 0;
    await snap('check14-settings-video');
    const ppl = await listPpFilters(state.paths);
    log(`check14 pp filters: active ${ppl.active}, enabled ${ppl.enabled}; ${ppl.filters.map(f => `${f.id}${f.builtin ? '(ac)' : f.owner ? `(${f.owner})` : ''}`).join(' ')}`);
    const ppRow = $('[data-video="ppfilter"]')?.closest('.setting');
    log(`check14 pp row: ${ppRow ? [...ppRow.querySelectorAll('option, optgroup')].map(o => o.label || o.textContent).join(' | ') : 'missing'}`);
    for (const el of [main, $('#main .view')]) if (el) el.scrollTop = Math.max(0, (ppRow?.offsetTop || 0) - 400);
    await snap('check14-settings-pp');
    state.game = 'ac'; renderSidebar(); openQuickDriveDialog(); await wait(4000);
    $('#main .qd-session-btn')?.click(); await snap('check14-session');
    const body = $('.qd-sheet-body');
    if (body) { body.scrollTop = body.scrollHeight; await snap('check14-session-bottom'); }
    $('.qd-sheet [data-done]')?.click();
    await Neutralino.app.exit();
    return;
  }
  // --check15: CSP install end to end (acstuff.club download, unpack, copy,
  // installed.log) into <snapshots>/csp-sandbox instead of the real AC folder.
  if ((window.NL_ARGS || []).includes('--check15')) {
    const ac = `${norm(dir)}/csp-sandbox`;
    await Neutralino.filesystem.remove(ac).catch(() => {});
    await Neutralino.filesystem.createDirectory(ac).catch(() => {});
    await Neutralino.filesystem.writeFile(`${ac}/acs.exe`, '');
    const sandbox = { ac: { install: ac, content: `${ac}/content`, cfg: `${ac}/cfg` } };
    const versions = await cspVersions();
    const latest = versions?.list.find(v => v.version === versions.recommended);
    log(`check15 latest ${JSON.stringify(latest)}`);
    let last = '';
    const t0 = Date.now();
    try {
      const v = await installCsp(sandbox, latest, p => { const s = p.stage === 'download' ? `download ${p.total ? Math.floor(p.done / p.total * 10) * 10 : 0}%` : p.stage; if (s !== last) log(`check15 ${s} at ${Date.now() - t0} ms`); last = s; });
      const csp = await readCsp(sandbox);
      const logText = await Neutralino.filesystem.readFile(`${ac}/extension/installed.log`);
      log(`check15 installed ${v} in ${Date.now() - t0} ms; readCsp ${csp.installed} ${csp.version} ${csp.build}, styles ${csp.styles.map(s => s.id)}; log lines ${logText.split('\n').length}; head ${JSON.stringify(logText.split('\n').slice(2, 6))}`);
    } catch (err) { log(`check15 failed: ${err?.message || err}`); }
    await Neutralino.app.exit();
    return;
  }
  // --check12: EVO Quick Drive with no decoded pictures (fresh install): how soon
  // the page shows, and pictures filling in (visible ones first, then the rest).
  if ((window.NL_ARGS || []).includes('--check12')) {
    const t0 = Date.now();
    state.game = 'evo'; renderSidebar(); state.view = 'quickdrive'; render();
    while (!document.querySelector('#main .qd[data-game="evo"] #qd-cars [data-car]') && Date.now() - t0 < 120000) await wait(100);
    log(`check12 page shown after ${Date.now() - t0} ms`);
    const shown = () => [...document.querySelectorAll('#qd-cars img.main, #qd-tracks img.main')].filter(i => i.complete && i.naturalWidth && i.style.visibility !== 'hidden').length;
    for (const s of [1, 3, 8, 20]) {
      await wait(s === 1 ? 1000 : (s - [1, 3, 8, 20][[1, 3, 8, 20].indexOf(s) - 1]) * 1000);
      log(`check12 ${s}s: ${shown()} pictures shown of ${document.querySelectorAll('#qd-cars [data-car], #qd-tracks [data-track]').length} cards`);
      if (s === 3) await snap('check12-evo-3s');
    }
    $('#qd-cars').scrollTop = 2000; await wait(4000); await snap('check12-evo-scrolled');
    await Neutralino.app.exit();
    return;
  }
  // --check11: resize through a grip and stay open (the window's own pixels are
  // then read from outside, title bar edge included).
  if ((window.NL_ARGS || []).includes('--check11')) {
    const se = $('#win-grips .rz-se'), at = (x, y) => ({ screenX: x, screenY: y, button: 0, bubbles: true });
    se.dispatchEvent(new PointerEvent('pointerdown', at(1000, 700))); await wait(300);
    se.dispatchEvent(new PointerEvent('pointermove', at(1100, 760))); await wait(1500);
    se.dispatchEvent(new PointerEvent('pointerup', at(1100, 760)));
    log(`check11 resized ${JSON.stringify(await Neutralino.window.getSize())} inner ${innerWidth}x${innerHeight} outer ${outerWidth}x${outerHeight}`);
    await wait(12000);
    $('#win-max').click(); await wait(1500);
    log(`check11 maximized ${await Neutralino.window.isMaximized()} ${innerWidth}x${innerHeight}`);
    $('#win-max').click(); await wait(1500);
    log(`check11 restored ${await Neutralino.window.isMaximized()} ${innerWidth}x${innerHeight}`);
    await setWindowSize(1540, 795);
    await Neutralino.app.exit();
    return;
  }
  // --check-setups: the Setups tab of AC, ACC and Rally on COPIES in <snapshots>/setups
  // (Rally: the real Personal setups file copied; AC and ACC: sample setups), then
  // every change (duplicate, compare, rename, delete, export and import) on those copies.
  if ((window.NL_ARGS || []).includes('--check-setups')) {
    const root = `${norm(dir)}/setups`;
    for (const d of ['rally', 'ac/acrm_mitsubishi_evo6_gsr/pk_akina', 'acc/mclaren_720s_gt3_evo/monza']) await ensureDir(`${root}/${d}`);
    await Neutralino.filesystem.copy(state.paths.rally.setups, `${root}/rally/CarSetupsDataSaveSlot.sav`, { overwrite: true });
    const acLast = (await readText(`${state.paths.ac.setups}/acrm_mitsubishi_evo6_gsr/generic/last.ini`)) || '[CAR]\nMODEL=acrm_mitsubishi_evo6_gsr\n[PRESSURE_LF]\nVALUE=31\n';
    await writeText(`${root}/ac/acrm_mitsubishi_evo6_gsr/pk_akina/Akina dry.ini`, acLast);
    await writeText(`${root}/ac/acrm_mitsubishi_evo6_gsr/pk_akina/Akina wet.ini`, acLast.replace(/(\[PRESSURE_\w+\]\r?\nVALUE=)\d+/g, '$127').replace(/(\[CAMBER_LF\]\r?\nVALUE=)-?\d+/, '$1-20'));
    await writeText(`${root}/acc/mclaren_720s_gt3_evo/monza/Quali.json`, JSON.stringify({ carName: 'mclaren_720s_gt3_evo', basicSetup: { tyres: { tyreCompound: 0, tyrePressure: [55, 55, 52, 52] }, alignment: { camber: [8, 8, 6, 6], toe: [40, 40, 44, 44], casterLF: 10, casterRF: 10, steerRatio: 3 }, electronics: { tC1: 4, tC2: 4, abs: 3, eCUMap: 1, fuelMix: 0, telemetryLaps: 0 }, strategy: { fuel: 40, nPitStops: 0, tyreSet: 0, frontBrakePadCompound: 1, rearBrakePadCompound: 1, pitStrategy: [], fuelPerLap: 3.1 } }, advancedSetup: { mechanicalBalance: { aRBFront: 6, aRBRear: 3, wheelRate: [2, 2, 3, 3], bumpStopRateUp: [4, 4, 4, 4], bumpStopRateDn: [4, 4, 4, 4], bumpStopWindow: [10, 10, 12, 12], brakeTorque: 20, brakeBias: 32 }, dampers: { bumpSlow: [10, 10, 8, 8], bumpFast: [12, 12, 10, 10], reboundSlow: [11, 11, 9, 9], reboundFast: [14, 14, 12, 12] }, aeroBalance: { rideHeight: [5, 0, 0, 12], rodLength: [0, 0, 0, 0], splitter: 0, rearWing: 6, brakeDuct: [3, 3] }, drivetrain: { preload: 9 } }, trackBCName: 'monza' }));
    state.paths.rally.setups = `${root}/rally/CarSetupsDataSaveSlot.sav`;
    state.paths.ac.setups = `${root}/ac`;
    state.paths.acc.setups = `${root}/acc`;
    const names = () => [...document.querySelectorAll('#setups-list .sx-item-name')].map(b => b.textContent).join(' | ');
    // Opens the first setup, then Compare › the second one.
    const pickTwo = async () => {
      for (const sel of ['#setups-list [data-open="0"]', '[data-s="compare-menu"]', '[data-cmp="1"]']) { $(sel)?.click(); await wait(300); }
    };
    const compared = () => `${$('.sx-cmp-sum')?.textContent.replace(/\s+/g, ' ').trim()} | ${[...document.querySelectorAll('.sx-cmp-row.diff')].map(r => r.textContent.replace(/\s+/g, ' ').trim()).join(' ; ')}`;
    for (const key of ['ac', 'acc', 'rally']) {
      state.game = key; state.tab[key] = 'setups'; renderSidebar(); state.view = 'mods'; render(); await wait(4000);
      log(`setups ${key}: ${[...document.querySelectorAll('#grid-wrap .card')].map(c => `${c.querySelector('.card-title')?.textContent} / ${c.querySelector('.card-sub')?.textContent} / ${c.querySelector('.card-author')?.textContent}`).join(' ; ')}`);
      await snap(`setups-${key}`);
      $('#grid-wrap .card')?.click(); await wait(800);
      log(`setups ${key} window: ${names()} | groups ${[...document.querySelectorAll('.sx-tabs button')].map(h => h.textContent).join(', ')}`);
      await snap(`setups-${key}-window`);
      // Each group's tab (Rally: all; the others: the second one).
      const tabs = [...document.querySelectorAll('.sx-tabs [data-tab]')].map(b => b.dataset.tab);
      for (const t of key === 'rally' ? tabs.slice(1) : tabs.slice(1, 2)) {
        $(`.sx-tabs [data-tab="${t}"]`)?.click(); await wait(300);
        log(`setups ${key} ${t}: ${$('.sx-panel')?.textContent.replace(/\s+/g, ' ').trim().slice(0, 160)}`);
        await snap(`setups-${key}-tab-${t}`);
      }
      $('.sx-tabs [data-tab]')?.click(); await wait(200);
      if (key === 'ac') {
        await pickTwo();
        log(`setups ac compare: ${compared()}`);
        await snap('setups-ac-compare');
        $('[data-diff="0"]')?.click(); await wait(300);
        await snap('setups-ac-compare-all');
      }
      $('#modal-root [data-close]')?.click(); await wait(300);
    }
    // Rally: every change, on the copy.
    const click = async sel => { $(sel)?.click(); await wait(1500); };
    $('#grid-wrap .card')?.click(); await wait(800);
    await click('[data-s="duplicate"]');
    log(`rally after duplicate: ${names()}`);
    await pickTwo();
    log(`rally compare: ${compared()}`);
    $('#setups-list [data-open="1"]')?.click(); await wait(300);
    await click('[data-s="rename"]');
    $('#setup-rename').value = 'Grava ñ Fast';
    await click('[data-s="rename-save"]');
    log(`rally after rename: ${names()}`);
    await snap('setups-rally-renamed');
    const item = state.cache['rally:setups'].find(i => i.setups.some(s => s.name === 'Grava ñ Fast'));
    const s = item.setups.find(x => x.name === 'Grava ñ Fast');
    await exportSetup(s, `${root}/shared.rallysetup.json`);
    const back = await readSetupFile(`${root}/shared.rallysetup.json`);
    log(`rally export: ${back.car} ${back.name} ${back.values.length} values`);
    const saved = await importSetup({ ...back, car: 'LanciaStratosHF' }, state.paths, '', back.name);
    log(`rally import into Stratos as: ${saved}`);
    $('#modal-root [data-close]')?.click(); await wait(300);
    render(); await wait(3000);
    $('#grid-wrap .card')?.click(); await wait(800);
    const del = [...document.querySelectorAll('#setups-list [data-open]')].find(b => /Fast \(|copy/i.test(b.textContent)) || $('#setups-list [data-open="1"]');
    del?.click(); await wait(300);
    await click('[data-s="delete"]'); await click('[data-s="delete"]');
    log(`rally after delete: ${names()} | file ${state.paths.rally.setups}`);
    await snap('setups-rally-deleted');
    $('#modal-root [data-close]')?.click(); await wait(300);
    // Times per setup: an AC session (race_out.json and last.ini in the test folder)
    // and Rally's stage records (read only) as if each game had just closed. The
    // launcher's run log is put back as it was afterwards.
    const runsBefore = await storageGet('setupRuns', []);
    try {
      state.paths.ac.cfg = `${root}/acdocs/cfg`;
      await ensureDir(`${root}/acdocs/out`); await ensureDir(`${root}/ac/acrm_mitsubishi_evo6_gsr/generic`);
      await writeText(`${root}/ac/acrm_mitsubishi_evo6_gsr/generic/last.ini`, acLast);
      await writeText(`${root}/acdocs/out/race_out.json`, JSON.stringify({ track: 'pk_akina-akina_2way', players: [{ name: 'Test', car: 'acrm_mitsubishi_evo6_gsr' }], sessions: [{ name: 'Practice', laps: [{ lap: 0, car: 0, time: 158234, cuts: 0 }, { lap: 1, car: 0, time: 151002, cuts: 2 }, { lap: 2, car: 0, time: 154876, cuts: 0 }] }] }));
      await gameClosed('ac', { at: Date.now() - 60000 });
      const fabia = (await getItems(gameByKey('rally'), 'setups', true)).find(i => /fabia/i.test(i.carId));
      if (fabia) await gameClosed('rally', { car: fabia.carId, setup: { name: fabia.setups[0].name, sig: setupSig(fabia.setups[0].values) }, before: {} });
      log(`setup runs: ${(await storageGet('setupRuns', [])).slice(runsBefore.length).map(r => `${r.game} ${r.track} ${r.ms} ${r.name}`).join(' ; ')}`);
      state.game = 'ac'; state.tab.ac = 'setups'; renderSidebar(); state.view = 'mods'; render(); await wait(3000);
      $('#grid-wrap .card')?.click(); await wait(1500);
      log(`ac times: ${$('.sx-times')?.textContent.replace(/\s+/g, ' ').trim()}`);
      await snap('setups-ac-times');
      $('#modal-root [data-close]')?.click(); await wait(300);
      state.game = 'rally'; state.tab.rally = 'setups'; renderSidebar(); render(); await wait(3000);
      [...document.querySelectorAll('#grid-wrap .card')].find(c => /Fabia/.test(c.textContent))?.click(); await wait(1500);
      log(`rally times: ${$('.sx-times')?.textContent.replace(/\s+/g, ' ').trim()}`);
      await snap('setups-rally-times');
      $('#modal-root [data-close]')?.click(); await wait(300);
      // Rally Quick Drive's session settings: the Car Setup choice.
      state.settings.rallyQD = { ...(state.settings.rallyQD || {}), car: fabia?.carId };
      state.view = 'quickdrive'; render(); await wait(6000);
      $('#main .qd-session-btn')?.click(); await wait(800);
      log(`rally qd setup: ${$('.qd-sheet-sec')?.textContent.replace(/\s+/g, ' ').trim().slice(0, 200)}`);
      await snap('setups-rally-qd');
    } finally { await storageSet('setupRuns', runsBefore); }
    await Neutralino.app.exit();
    return;
  }
  // --check-outlines: every game's Tracks tab (All content), scrolled through, with
  // each outline's drawn size in the log. Reads only.
  if ((window.NL_ARGS || []).includes('--check-outlines')) {
    state.settings.acFilter = 'all';
    for (const key of ['ac', 'evo', 'rally']) {
      if (!gameByKey(key)) continue;
      state.game = key; state.tab[key] = 'tracks'; renderSidebar(); state.view = 'mods'; render(); await wait(7000);
      const imgs = [...document.querySelectorAll('#grid-wrap img.overlay')];
      log(`outlines ${key}: ${document.querySelectorAll('#grid-wrap .card').length} cards, ${imgs.length} outlines: ${imgs.slice(0, 40).map(i => `${i.closest('.card')?.querySelector('h3, .title, b')?.textContent?.trim().slice(0, 18)} ${i.naturalWidth}x${i.naturalHeight}->${Math.round(i.getBoundingClientRect().width)}x${Math.round(i.getBoundingClientRect().height)}`).join(' | ')}`);
      let box = $('#grid-wrap');
      while (box && box.scrollHeight <= box.clientHeight + 4) box = box.parentElement;
      for (let n = 0; n < 3; n++) {
        await snap(`outlines-${key}-${n}`);
        if (!box || box.scrollTop + box.clientHeight >= box.scrollHeight) break;
        box.scrollTop += box.clientHeight; await wait(1500);
      }
    }
    await Neutralino.app.exit();
    return;
  }
  // --check-rally-mods: Rally's Cars and Tracks tabs (All content), a car's and a
  // stage's detail page, and the Liveries tab still square. Reads only.
  if ((window.NL_ARGS || []).includes('--check-rally-mods')) {
    state.settings.acFilter = 'all';
    for (const tab of ['cars', 'tracks']) {
      state.game = 'rally'; state.tab.rally = tab; renderSidebar(); state.view = 'mods'; render(); await wait(6000);
      log(`rally ${tab}: ${document.querySelectorAll('#grid-wrap .card').length} cards, ${document.querySelectorAll('#grid-wrap .flag-badge').length} flags, ${document.querySelectorAll('#grid-wrap img.overlay').length} maps, ${$('#count')?.textContent}`);
      await snap(`rally-${tab}`);
      const card = tab === 'cars' ? [...document.querySelectorAll('#grid-wrap .card')].find(c => /Fabia/.test(c.textContent)) : [...document.querySelectorAll('#grid-wrap .card')].find(c => /Turini/.test(c.textContent));
      card?.click(); await snap(`rally-${tab}-detail`);
      log(`rally ${tab} detail: ${$('#modal-root h2')?.textContent} | ${$('#modal-root .detail-desc')?.textContent.slice(0, 80)} | ${[...document.querySelectorAll('#modal-root .specs dd')].map(d => d.textContent).join(' / ')}`);
      if (tab === 'tracks') {
        log(`rally stages: ${[...document.querySelectorAll('#modal-root .skin span')].map(s => s.textContent).join(' | ')}`);
        document.querySelectorAll('#modal-root *').forEach(n => { if (n.scrollHeight > n.clientHeight + 20) n.scrollTop = n.scrollHeight; });
        await snap('rally-tracks-stages');
      }
      $('#modal-root [data-close]')?.click(); await wait(300);
    }
    state.tab.rally = 'liveries'; render(); await wait(3000); await snap('rally-liveries');
    log(`rally liveries: ${document.querySelectorAll('#grid-wrap .card').length} cards, square ${!!$('#grid-wrap .grid.square')}`);
    // Quick Drive: Greece's stages with the game's maps.
    state.view = 'quickdrive'; render(); await wait(5000);
    [...document.querySelectorAll('#qd-tracks [data-track]')].find(b => b.dataset.track === 'Greece')?.click(); await wait(500);
    log(`rally qd: ${document.querySelectorAll('#qd-layouts img.color').length} stage maps`);
    await snap('rally-qd-greece');
    await Neutralino.app.exit();
    return;
  }
  // --check10: window grips (resize), Rally stage outlines (white, none on the
  // location cards), replay icon, detail logo, news and site checks (see the log).
  if ((window.NL_ARGS || []).includes('--check10')) {
    const before = await Neutralino.window.getSize();
    const se = $('#win-grips .rz-se'), at = (x, y) => ({ screenX: x, screenY: y, button: 0, bubbles: true });
    se.dispatchEvent(new PointerEvent('pointerdown', at(1000, 700))); await wait(300);
    se.dispatchEvent(new PointerEvent('pointermove', at(1060, 740))); await wait(1500);
    se.dispatchEvent(new PointerEvent('pointerup', at(1060, 740)));
    const after = await Neutralino.window.getSize();
    log(`grips: ${document.querySelectorAll('#win-grips .rz').length}; window ${before.width}x${before.height} -> ${after.width}x${after.height}`);
    await setWindowSize(before.width, before.height); await wait(300);
    state.game = 'rally'; renderSidebar(); state.view = 'quickdrive'; render(); await wait(4000);
    $('#main [data-car="LanciaStratosHF"]')?.click(); await wait(300);
    [...document.querySelectorAll('#qd-tracks [data-track]')].find(b => b.dataset.track === 'Greece')?.click();
    const lay = $('#qd-layouts img');
    log(`rally: card maps ${document.querySelectorAll('#qd-tracks .qd-card-maps').length}, layout outlines ${document.querySelectorAll('#qd-layouts img').length}, filter ${lay ? getComputedStyle(lay).filter : '-'}`);
    await snap('check10-rally');
    state.game = 'ac'; state.tab.ac = 'replays'; renderSidebar(); state.view = 'mods'; render(); await wait(3000); await snap('check10-ac-replays');
    $('#grid-wrap .card')?.click(); await snap('check10-replay-detail'); $('#modal-root [data-close]')?.click();
    state.game = 'acc'; renderSidebar(); state.view = 'games'; render(); await wait(4000);
    log(`news row: ${document.querySelectorAll('#news-row .news-card:not(.skeleton)').length} cards; checks ${Object.keys(newsChecks).join(',')}`);
    await snap('check10-acc-games');
    await Neutralino.app.exit();
    return;
  }
  // --check17=<dir with a copy of PlayerDataSaveSlot.sav>: Rally's Weather & Time
  // settings in the session sheet (snapshots), then written to that copy and read back.
  const c17 = (window.NL_ARGS || []).find(a => a.startsWith('--check17='));
  if (c17) {
    state.paths.rally.save = join(norm(c17.slice(10)), 'PlayerDataSaveSlot.sav');
    log(`check17 read: ${JSON.stringify(await readRallySave(state.paths).then(r => ({ ...r, stages: r.stages.length })))}`);
    state.game = 'rally'; renderSidebar(); state.view = 'quickdrive'; render(); await wait(4000);
    const summary = () => $('.qd-session-btn')?.textContent.replace(/\s+/g, ' ').trim();
    const rows = () => [...document.querySelectorAll('.qd-sheet .qd-row')].map(r => `${r.querySelector('label span')?.firstChild?.textContent}=${r.querySelector('select') ? r.querySelector('select').selectedOptions[0]?.textContent : r.querySelector('.qd-seg .active')?.textContent || r.querySelector('output')?.textContent}${r.querySelector('.qd-row-icon img') ? ` [${r.querySelector('.qd-row-icon img').getAttribute('src').split('/').pop()}]` : ''}`).join(' | ');
    log(`check17 summary: ${summary()}`);
    $('.qd-session-btn')?.click(); await wait(600);
    log(`check17 sheet: ${rows()}`); await snap('check17-sheet');
    const pick = (label, text) => {
      const row = [...document.querySelectorAll('.qd-sheet .qd-row')].find(r => r.textContent.includes(label)), sel = row?.querySelector('select');
      const opt = [...(sel?.options || [])].find(o => o.textContent === text);
      if (opt) { sel.value = opt.value; sel.dispatchEvent(new Event('change', { bubbles: true })); }
    };
    pick('Starting weather', 'Snow Blizzard'); pick('Weather forecast', 'Storm'); await wait(400);
    log(`check17 after picking: ${rows()}`); await snap('check17-sheet-blizzard');
    $('.qd-sheet [data-done]')?.click(); await wait(300);
    log(`check17 summary now: ${summary()}`);
    // Greece has no snow: the sheet shows what Rally will start with there.
    [...document.querySelectorAll('#qd-tracks [data-track]')].find(b => b.dataset.track === 'Greece')?.click(); await wait(400);
    log(`check17 greece summary: ${summary()}`);
    $('.qd-session-btn')?.click(); await wait(600);
    log(`check17 greece sheet: ${rows()} | note ${$('.qd-sheet .qd-sheet-note')?.textContent}`); await snap('check17-sheet-greece');
    // Dynamic weather off: the forecast rows are locked, as in Rally.
    const dynRow = () => [...document.querySelectorAll('.qd-sheet .qd-row')].find(r => r.textContent.includes('Dynamic weather'));
    [...dynRow().querySelectorAll('.qd-seg button')].find(b => b.textContent === 'Off')?.click(); await wait(300);
    const locked = () => [...document.querySelectorAll('.qd-sheet .qd-row.disabled')].map(r => r.querySelector('label span')?.firstChild?.textContent).join(', ');
    log(`check17 dynamic off: locked ${locked()}`); await snap('check17-sheet-static');
    [...document.querySelectorAll('.qd-sheet .qd-row.disabled .qd-seg button')].find(b => b.textContent === 'Maximum')?.click(); await wait(200);
    log(`check17 clicking a locked button: probability still ${[...document.querySelectorAll('.qd-sheet .qd-row')].find(r => r.textContent.includes('Forecast probability'))?.querySelector('.active')?.textContent}`);
    [...dynRow().querySelectorAll('.qd-seg button')].find(b => b.textContent === 'On')?.click(); await wait(300);
    log(`check17 dynamic on: locked "${locked()}"`);
    $('.qd-sheet [data-done]')?.click();
    const w = { weather: 10, forecast: 7, probability: 3, persistence: 1, dynamic: true, wetness: 40, snow: 80, speed: 0, grip: 1 };
    try {
      const before = await readRallySave(state.paths);
      await writeRallySession(state.paths, { stage: 'AlsaceS2MunsterFullReverse', car: before.car, seconds: 7 * 3600 + 15 * 60, weather: w });
      const after = await readRallySave(state.paths);
      log(`check17 written: ${JSON.stringify(after.weather)} start ${after.seconds} stage ${after.stage} -> ${Object.keys(w).every(k => after.weather[k] === w[k]) && after.weather.seconds === 26100 ? 'OK' : 'MISMATCH'}`);
    } catch (err) { log(`check17 write: ${err?.message || err}`); }
    await Neutralino.app.exit();
    return;
  }
  // --check18=<dir>: Rally Quick Drive with the save in that dir, which may be
  // missing or in a layout the launcher doesn't know: it still opens (snapshot),
  // and writing sets what the save allows. Doesn't launch.
  const c18 = (window.NL_ARGS || []).find(a => a.startsWith('--check18='));
  if (c18) {
    state.paths.rally.save = join(norm(c18.slice(10)), 'PlayerDataSaveSlot.sav');
    const r = await readRallySave(state.paths);
    log(`check18 read: ${JSON.stringify({ ...r, stages: r.stages.length })}`);
    state.game = 'rally'; renderSidebar(); state.view = 'quickdrive'; render(); await wait(4000);
    log(`check18 open: ${!!$('.qd-session-btn')} | ${$('#modal-root .qd-sub, #modal-root .modal-sub')?.textContent || ''} | session ${$('.qd-session-btn')?.textContent.replace(/\s+/g, ' ').trim()}`);
    await snap('check18-open');
    try {
      const res = await writeRallySession(state.paths, { stage: 'AlsaceS2MunsterFullReverse', car: 'AlpineA110', seconds: 7 * 3600, livery: 'AlpineA110', weather: r.weather && { ...r.weather, weather: 7 } });
      const after = await readRallySave(state.paths);
      log(`check18 written: ${JSON.stringify(res)} -> ${after.problem || 'ok'} ${after.stage} ${after.car} ${after.seconds}s weather ${after.weather?.weather}`);
    } catch (err) { log(`check18 write: ${err?.message || err}`); }
    await Neutralino.app.exit();
    return;
  }
  // --check16[=<Liveries copy>]: Rally liveries shipped with and without plates (one
  // tile, Plates menu), read from a copy of the Liveries folder when given. Doesn't launch.
  const c16 = (window.NL_ARGS || []).find(a => a === '--check16' || a.startsWith('--check16='));
  if (c16) {
    if (c16.includes('=')) { state.paths.rally.liveries = norm(c16.slice(c16.indexOf('=') + 1)); state.cache = {}; }
    state.game = 'rally'; renderSidebar(); state.view = 'quickdrive'; render(); await wait(4000);
    $('#main [data-car="VWPoloGTIR5"]')?.click(); await wait(500);
    const row = () => `${$('.qd-spec-btn')?.title || 'no menu'} | ${[...document.querySelectorAll('.qd-variant')].map(b => `${b.classList.contains('active') ? '*' : ''}${b.dataset.variant}`).join(' | ')} | summary ${$('#qd-summary small')?.textContent}`;
    log(`check16 polo: ${row()}`);
    for (const i of (await getItems(GAMES.find(g => g.key === 'rally'), 'liveries')).filter(i => /polo/i.test(i.id))) log(`check16 item ${i.id} toggle ${i.toggle} enabled ${i.enabled} car ${i.meta?.car} stickers ${i.meta?.stickers} look ${String(i.meta?.look).slice(0, 40)}…${String(i.meta?.look).slice(-60)}`);
    await snap('check16-polo');
    $('[data-spec-menu]')?.click(); await wait(300);
    log(`check16 menu: ${[...document.querySelectorAll('[data-spec]')].map(b => `${b.classList.contains('active') ? '*' : ''}${b.textContent}`).join(' | ')}`);
    await snap('check16-polo-menu');
    const pair = [...document.querySelectorAll('.qd-variant')].find(b => /Rally_?Plates|Rally Plates/i.test(b.dataset.variant));
    pair?.click(); await wait(300); log(`check16 picked a pair: ${row()}`);
    $('[data-spec-menu]')?.click(); await wait(200);
    [...document.querySelectorAll('[data-spec]')].find(b => !b.classList.contains('active'))?.click(); await wait(300);
    log(`check16 switched: ${row()}`); await snap('check16-polo-switched');
    $('.qd-variant')?.click(); await wait(300); log(`check16 default livery: ${row()}`);
    $('#main [data-car="LanciaStratosHF"]')?.click(); await wait(500); log(`check16 stratos: ${row()}`);
    await Neutralino.app.exit();
    return;
  }
  // --check8: site pictures (Rally, ACC), all Rally stages, Rally liveries, replay icon, offline note.
  if ((window.NL_ARGS || []).includes('--check8')) {
    showOfflineNotice();
    state.game = 'rally'; renderSidebar(); state.view = 'quickdrive'; render(); await wait(4000);
    $('#main [data-car="LanciaStratosHF"]')?.click(); await wait(300);
    [...document.querySelectorAll('#qd-tracks [data-track]')].find(b => b.dataset.track === 'Greece')?.click();
    await snap('check8-rally');
    // The livery hint's popup, shown as on hover.
    const tipStyle = document.createElement('style');
    tipStyle.textContent = '.qd-variant-hint::after { opacity: 1 !important; transform: none !important; }';
    document.head.append(tipStyle); await wait(300); await snap('check8-rally-hint'); tipStyle.remove();
    log(`rally: ${$('#main .qd-panel-head h3 small')?.textContent} | tracks ${[...document.querySelectorAll('#qd-tracks [data-track] b')].map(b => b.textContent).join(', ')} | greece ${document.querySelectorAll('#qd-layouts [data-layout]').length} | liveries ${[...document.querySelectorAll('.qd-variant')].map(b => b.title).join(' | ')}`);
    openQuickDriveFor('acc'); await wait(5000); await snap('check8-acc');
    state.game = 'ac'; state.tab.ac = 'replays'; renderSidebar(); state.view = 'mods'; render(); await wait(3000); await snap('check8-ac-replays');
    await Neutralino.app.exit();
    return;
  }
  // --check7: screenshots/replays tabs, mod checks, Surprise me.
  if ((window.NL_ARGS || []).includes('--check7')) {
    for (const [key, tab] of [['ac', 'screens'], ['ac', 'replays'], ['evo', 'screens'], ['acc', 'replays']]) {
      state.game = key; state.tab[key] = tab; renderSidebar(); state.view = 'mods'; render(); await wait(3000);
      log(`${key} ${tab}: ${document.querySelectorAll('#grid-wrap .card').length} cards; first ${$('#grid-wrap .card .card-title')?.textContent} | ${$('#grid-wrap .card .card-sub')?.textContent}`);
      await snap(`check7-${key}-${tab}`);
    }
    for (const g of GAMES) {
      state.game = g.key; state.tab[g.key] = g.tabs[0].id; renderSidebar(); render(); await wait(2500);
      $('#btn-health').click(); await wait(g.key === 'evo' ? 9000 : 5000);
      log(`health ${g.key}: ${$('#health-sum')?.textContent} | ${[...document.querySelectorAll('.health-row .imp-info')].slice(0, 6).map(r => r.textContent.replace(/\s+/g, ' ').trim()).join(' || ')}`);
      await snap(`check7-health-${g.key}`);
      $('#modal-root [data-close]')?.click();
    }
    state.game = 'ac'; renderSidebar(); state.view = 'quickdrive'; render(); await wait(5000);
    $('#main [data-surprise]')?.click(); await snap('check7-surprise');
    log(`surprise: ${$('#toast')?.textContent}`);
    await Neutralino.app.exit();
    return;
  }
  // --check6: Quick Drive page: Rally (covers, Greece), switching to EVO (dimmed while loading), sheet.
  if ((window.NL_ARGS || []).includes('--check6')) {
    state.game = 'rally'; renderSidebar(); state.view = 'quickdrive'; render(); await wait(3000); await snap('check6-rally-page');
    log(`rally tracks: ${[...document.querySelectorAll('#qd-tracks [data-track] b')].map(b => b.textContent).join(' | ')}; sidebar hidden ${$('#app').classList.contains('qd-mode')}`);
    $('#main [data-qd-game="evo"]')?.click(); await wait(300); await Neutralino.window.snapshot(`${norm(dir)}/check6-switching.png`);
    log(`switching: ${!!$('#main .qd.switching')} active ${$('#main .qd-game.active')?.dataset.qdGame}`);
    await wait(9000); await snap('check6-evo-page');
    $('#main .qd-session-btn')?.click(); await snap('check6-evo-session');
    $('.qd-sheet [data-done]')?.click();
    openQuickDriveFor('acc'); await wait(5000); await snap('check6-acc-page');
    $('#main [data-presets]')?.click(); await snap('check6-acc-presets');
    state.view = 'mods'; render(); await wait(2000); log(`after leaving: qd-mode ${$('#app').classList.contains('qd-mode')}`);
    await Neutralino.app.exit();
    return;
  }
  // --check5: Mods car pages (AC, EVO).
  if ((window.NL_ARGS || []).includes('--check5')) {
    for (const key of ['ac', 'evo']) {
      state.game = key; state.tab[key] = 'cars'; renderSidebar(); state.view = 'mods'; state.settings.acFilter = 'all'; render(); await wait(6000); await snap(`check5-${key}-cars`);
      const img = $('#grid-wrap .card img.main');
      log(`${key} cards: ${document.querySelectorAll('#grid-wrap .card').length}; first img ${img?.getAttribute('src')?.slice(0, 120)} ${img?.naturalWidth}x${img?.naturalHeight} shown ${img?.offsetWidth}x${img?.offsetHeight}`);
    }
    await Neutralino.app.exit();
    return;
  }
  // --check4: update notes, presets/recent/bests sheets, settings backups (backup
  // of ACC restored into <snapshots>/restore-sandbox, then the test backups deleted).
  if ((window.NL_ARGS || []).includes('--check4')) {
    const now = Math.floor(Date.now() / 1000);
    state.settings.updateNotes = { evo: { at: now - 86400 }, ac: { at: now - 3 * 86400 } };
    state.game = 'evo'; renderSidebar(); state.view = 'games'; render(); await wait(2000); await snap('check4-evo-update');
    state.view = 'mods'; render(); await wait(3000); await snap('check4-evo-mods-update');
    state.game = 'rally'; renderSidebar(); state.view = 'games'; render();
    openQuickDriveFor('rally'); await wait(3000);
    $('#main [data-car="SkodaFabiaRSRally2"]')?.click(); await snap('check4-rally-pb');
    log(`rally pb: ${$('#main .qd-pb')?.textContent.replace(/\s+/g, ' ')}`);
    $('#main [data-presets]')?.click(); await snap('check4-rally-presets');
    log(`rally bests: ${document.querySelectorAll('[data-beat]').length}`);
    $('#main [data-beat="0"]')?.click(); await snap('check4-rally-beat');
    $('#main [data-presets]')?.click(); await wait(500);
    const form = $('.qd-preset-new'); if (form) { form.querySelector('input').value = 'Test preset'; form.requestSubmit(); }
    await snap('check4-rally-saved');
    openQuickDriveFor('ac'); await wait(5000);
    $('#main [data-presets]')?.click(); await snap('check4-ac-presets');
    log(`ac bests: ${document.querySelectorAll('[data-beat]').length}`);
    $('#main [data-beat="0"]')?.click(); await snap('check4-ac-beat');
    log(`ac pb: ${$('#main .qd-pb')?.textContent.replace(/\s+/g, ' ')}`);
    openQuickDriveFor('evo'); await wait(9000);
    $('#main [data-presets]')?.click(); await snap('check4-evo-presets');
    log(`evo bests: ${document.querySelectorAll('[data-beat]').length}; tracks ${[...document.querySelectorAll('#qd-tracks [data-track] b')].map(b => b.textContent).join(' | ')}`);
    $('#modal-root [data-close]')?.click();
    try {
      const made = await createBackup('acc', state.paths);
      const sandbox = { ...state.paths, acc: { ...state.paths.acc, config: `${norm(dir)}/restore-sandbox/Config` } };
      const list = await listBackups('acc');
      await restoreBackup('acc', sandbox, list.find(b => b.dir === made));
      log(`backup: ${made} items ${list[0]?.items}; restored menuSettings: ${await exists(`${norm(dir)}/restore-sandbox/Config/menuSettings.json`)}; launcher-backup copied: ${await exists(`${made}/Config/menuSettings.json.launcher-backup`)}`);
      for (const b of await listBackups('acc')) if (b.at >= Date.now() - 120000) await deleteBackup(b);
    } catch (err) { log(`backup test: ${err?.message}`); }
    state.view = 'settings'; render(); await wait(3000); await snap('check4-settings');
    await Neutralino.app.exit();
    return;
  }
  // --check3: Rally Quick Drive (dialog, session sheet, save writer on a copy in <snapshots>/rally-sandbox).
  if ((window.NL_ARGS || []).includes('--check3')) {
    state.game = 'rally'; renderSidebar(); state.view = 'games'; render();
    openQuickDriveDialog(); await wait(5000); await snap('check3-rally-qd');
    log(`rally tracks: ${[...document.querySelectorAll('#qd-tracks [data-track]')].map(b => b.querySelector('b')?.textContent).join(' | ')}`);
    log(`rally stages: ${[...document.querySelectorAll('#qd-layouts [data-layout]')].map(b => b.textContent.replace(/\s+/g, ' ').trim()).join(' | ')}`);
    [...document.querySelectorAll('#qd-tracks [data-track]')].find(b => b.dataset.track === 'Weles')?.click(); await snap('check3-rally-wales');
    $('#main .qd-session-btn')?.click(); await snap('check3-rally-session');
    $('.qd-sheet [data-done]')?.click();
    try {
      const sandbox = { ...state.paths, rally: { ...state.paths.rally, save: `${norm(dir)}/rally-sandbox/PlayerDataSaveSlot.sav` } };
      const before = await readRallySave(sandbox);
      await writeRallySession(sandbox, { stage: 'MonteCarloS1BolleneFullReverse', car: 'AlpineA110', seconds: 8 * 3600 + 45 * 60 });
      const after = await readRallySave(sandbox);
      log(`rally write: ${before.stage}/${before.car}/${before.seconds} -> ${after.stage}/${after.car}/${after.seconds}`);
    } catch (err) { log(`rally write: ${err?.message}`); }
    await Neutralino.app.exit();
    return;
  }
  // --check2: brand rails on the Mods car pages and EVO Quick Drive liveries (992 Cup).
  if ((window.NL_ARGS || []).includes('--check2')) {
    state.game = 'ac'; renderSidebar(); state.view = 'mods'; state.tab.ac = 'cars'; state.settings.acFilter = 'all'; render(); await snap('check2-ac-brands');
    $('#mods-brands [data-brand]:nth-child(3)')?.click(); await snap('check2-ac-brand-picked');
    state.game = 'evo'; state.tab.evo = 'cars'; renderSidebar(); render(); await wait(4000); await snap('check2-evo-brands');
    const cup = (await getItems(gameByKey('evo'), 'cars')).find(i => i.carId === 'ks_porsche_992_gt3_cup');
    const known = await knownCars(await evoCacheDir());
    log(`992 cup configs: ${JSON.stringify(known.find(k => k.carId === 'ks_porsche_992_gt3_cup')?.configs)}`);
    await openQuickDriveFor('evo', { car: cup }); await wait(8000); await snap('check2-evo-cup');
    log(`cup variants: ${[...document.querySelectorAll('.qd-variant')].map(b => b.title).join(' | ')}`);
    log(`cup flag: ${$('#qd-cars .active .flag.kunos')?.textContent}; spec ${$('.qd-spec-btn')?.textContent.trim()}; specs ${[...document.querySelectorAll('[data-spec]')].map(b => b.textContent).join(' | ')}`);
    $('[data-spec-menu]')?.click(); await wait(300); await snap('check2-evo-cup-specs');
    [...document.querySelectorAll('[data-spec]')].find(b => !b.classList.contains('active'))?.click(); await wait(500);
    log(`cup selected: ${$('#qd-cars .active')?.dataset.car}`);
    log(`cup after spec switch: menu hidden ${$('.qd-spec-menu')?.hidden}; ${$('.qd-spec-btn')?.title} | ${[...document.querySelectorAll('.qd-variant')].map(b => `${b.disabled ? '(off) ' : ''}${b.title}`).join(' | ')} | summary ${$('#qd-summary small')?.textContent}`);
    await snap('check2-evo-cup-switched');
    // Another car: its liveries on the first draw (cached names, no preset ids) and after loading.
    const m2 = [...document.querySelectorAll('#qd-cars [data-car]')].find(b => /m2/i.test(b.dataset.car));
    if (m2) {
      m2.click();
      log(`m2 (${m2.dataset.car}) first draw: ${[...document.querySelectorAll('.qd-variant')].map(b => b.title).join(' | ')}; spec ${$('.qd-spec-btn')?.title || '-'}`);
      await wait(4000);
      log(`m2 after 4s: ${[...document.querySelectorAll('.qd-variant')].map(b => b.title).join(' | ')}; spec ${$('.qd-spec-btn')?.title || '-'}; specs ${[...document.querySelectorAll('[data-spec]')].map(b => b.textContent).join(' | ')}`);
      // A livery shown with another spec: clicking it switches the spec.
      const other = [...document.querySelectorAll('.qd-variant')].find(b => !b.classList.contains('active'));
      other?.click();
      log(`m2 picked "${other?.title}": spec now ${$('.qd-spec-btn')?.title || '-'}, summary ${$('#qd-summary small')?.textContent}`);
    }
    // A car whose liveries aren't decoded yet: they load into the row while the car grid stays (no redraw).
    for (const b of [...document.querySelectorAll('#qd-cars [data-car]')].filter(x => !x.querySelector('.flag.off'))) {
      b.click();
      if (![...document.querySelectorAll('.qd-variant')].some(v => /Loading/.test(v.title))) continue;
      const cards = [...document.querySelectorAll('#qd-cars [data-car]')];
      await wait(6000);
      log(`uncached ${b.dataset.car}: grid kept ${cards.every(c => c.isConnected)}; row ${[...document.querySelectorAll('.qd-variant')].map(v => v.title).join(' | ')}`);
      break;
    }
    $('#modal-root [data-close]')?.click();
    state.game = 'ac'; state.tab.ac = 'cars'; renderSidebar(); render(); await wait(1500);
    const rail = $('#mods-brands'); if (rail) rail.scrollTop = rail.scrollHeight;
    [...document.querySelectorAll('#mods-brands [data-brand]')].find(x => /maserati/i.test(x.dataset.brand))?.click();
    log(`rail after click: ${$('#mods-brands')?.scrollTop} view: ${$('.view.mods')?.scrollTop}`);
    await snap('check2-ac-maserati');
    openQuickDriveFor('acc'); await wait(8000); await snap('check2-acc-models');
    log(`acc tracks listed: ${[...document.querySelectorAll('#qd-tracks [data-track]')].map(b => b.dataset.track).join(' ')}`);
    log(`acc cars listed: ${[...document.querySelectorAll('#qd-cars [data-car]')].map(b => b.querySelector('b')?.textContent).join(' | ')}`);
    await Neutralino.app.exit();
    return;
  }
  // --check: Rally .pak compatibility (card flags, launch dialog) and wheel scrolling of the livery row.
  if ((window.NL_ARGS || []).includes('--check')) {
    const rally = gameByKey('rally');
    state.game = 'rally'; renderSidebar(); state.view = 'mods'; render(); await snap('check-rally-mods');
    const folderLivery = (await getItems(rally, 'liveries')).find(i => i.toggle === 'rally-folder');
    if (folderLivery) { openDetail(rally, folderLivery); await snap('check-rally-detail'); $('#modal-root [data-close]')?.click(); }
    rallyPreflight(rally).then(go => log(`preflight: ${go}`)); await snap('check-rally-preflight');
    $('#modal-root [data-close]')?.click();
    openQuickDriveFor('ac'); await wait(5000);
    const strip = $('.qd-variant-strip');
    strip?.dispatchEvent(new WheelEvent('wheel', { deltaY: 300, bubbles: true, cancelable: true }));
    log(`wheel: scrollLeft ${strip?.scrollLeft} of ${strip && strip.scrollWidth - strip.clientWidth}`);
    await snap('check-wheel');
    openQuickDriveFor('acc'); await wait(3000); await snap('check-acc');
    $('#main .qd-session-btn')?.click(); await snap('check-acc-session');
    [...document.querySelectorAll('.qd-sheet .qd-seg button')].find(b => b.textContent === 'Race Weekend')?.click(); await snap('check-acc-weekend');
    // Writer test on a copy of menuSettings.json in <snapshots>/acc-sandbox.
    try {
      const sandbox = { ...state.paths, acc: { ...state.paths.acc, config: `${norm(dir)}/acc-sandbox` } };
      const { session } = await readAccSession(sandbox);
      Object.assign(session, { season: 'BP_2023', mode: 'QuickRace', race: 25, opponents: 19, startPos: 7, skill: 93, aggro: 40, time: 17, speed: 2, weather: 'LightRain' });
      await writeAccSession(sandbox, { session, car: 'Aston Martin Honda Concept (AMR).json', track: 'spa' });
      log('acc write: ok');
    } catch (err) { log(`acc write: ${err?.message}`); }
    await Neutralino.app.exit();
    return;
  }
  for (const g of GAMES) {
    state.game = g.key; renderSidebar();
    state.view = 'games'; render(); await snap(`${g.key}-games`);
    state.view = 'mods'; render(); await snap(`${g.key}-mods`);
  }
  const evo = (await getItems(gameByKey('evo'), 'cars')).find(i => i.isMod);
  if (evo) { state.game = 'evo'; renderSidebar(); state.view = 'mods'; render(); await wait(500); openDetail(gameByKey('evo'), evo); await snap('evo-detail'); }
  state.game = 'evo'; renderSidebar(); state.view = 'mods'; state.settings.acFilter = 'all';
  state.tab.evo = 'cars'; render(); await snap('evo-cars-all');
  state.tab.evo = 'tracks'; render(); await snap('evo-tracks-all');
  const evoTrack = (await getItems(gameByKey('evo'), 'tracks')).find(t => t.layouts?.length > 1);
  if (evoTrack) { openDetail(gameByKey('evo'), evoTrack); await snap('evo-track-detail'); }
  const cup = (await getItems(gameByKey('evo'), 'cars')).find(c => c.carId === 'ks_porsche_992_gt3_cup');
  await openQuickDriveFor('evo', { car: cup, track: evoTrack }); await wait(15000); await snap('evo-quickdrive');
  await snapSession('evo');
  $('[data-qd-game="ac"]')?.click(); await wait(4000); await snap('qd-tab-ac');
  await snapSession('ac');
  $('#modal-root').innerHTML = '';
  state.tab.evo = 'cars';
  state.game = 'ac'; renderSidebar();
  state.view = 'mods'; state.settings.acFilter = 'all'; render(); await snap('ac-mods-all');
  const items = state.cache['ac:cars'] || [];
  const mod = items.find(i => i.isMod);
  if (mod) { openDetail(gameByKey('ac'), mod); await snap('ac-detail'); openQuickDriveFor('ac', { car: mod, skin: mod.skins[0]?.id }); await snap('ac-quickdrive'); }
  state.tab.ac = 'tracks'; state.settings.acFilter = 'mods'; state.view = 'mods'; render(); await snap('ac-tracks');
  state.game = 'acc'; renderSidebar(); state.view = 'mods'; render(); await wait(800);
  $('#grid-wrap .card')?.click(); await snap('acc-detail');
  state.view = 'community'; render(); await snap('community');
  state.view = 'settings'; render(); await snap('settings');
  await Neutralino.app.exit();
}

Neutralino.events.on('windowClose', requestExit);
window.addEventListener('error', e => log(`ui error: ${e.message} @ ${e.filename}:${e.lineno}`));
window.addEventListener('unhandledrejection', e => log(`ui rejection: ${e.reason?.stack || JSON.stringify(e.reason)}`));
