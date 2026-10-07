import { GAMES, gameByKey, resolvePaths, SCANNERS, setEnabled, contentFolder, evoCacheDir, uninstallPaths, uninstallItem, rallyIncompatible, ACC_CARS, RALLY_CARS, rallyCarName, rallyCarIds, appCacheDir, rallyGameStages, markFresh } from './games.js';
import { ACC_TRACKS, ACC_MODES, ACC_WEATHER, ACC_TIME_SPEEDS, accSeasonName, accOwnedDlcs, accModelOwned, accTrackOwned, accSeasonOwned, accModelClass, readAccSession, accCustomCars, writeAccSession, ensureModelCar } from './acclaunch.js';
import { readRallySave, rallyStage, writeRallySession, rallyBests, RALLY_KNOWN_STAGES, rallyCover, rallySelectedLiveries } from './rallylaunch.js';
import { SITE_PAGES, siteCars, siteMaps, rallyStagePhotos, imageSizes, bestMatch, stageGroupOf, words } from './sitecatalog.js';
import { acBests, acBestKey, evoBests, evoBestKey, lapTime } from './bests.js';
import { checkMods } from './health.js';
import { acUpdates, cupDetails } from './updates.js';
import { listBackups, createBackup, restoreBackup, deleteBackup, autoBackups, backupsRoot } from './backups.js';
import { findSteamPath, findInstalledApps, getNews, cachedNews, refreshNews, getStoreDetails, steamUrls, appBuilds } from './steam.js';
import { quickDrive, readAcSession, defaultAcSession, acWeathers, roadTemperature, presetForType, AC_MODES, AC_GRIP, AC_ASSIST_PRESETS } from './quickdrive.js';
import { readCsp, cspVersions, cspVersionInfo, installCsp, uninstallWeatherMod, deselectWeatherMod, writeCspSetting, compareVersions, cspWeatherLabel, isWetWeather, CSP_WEATHER_TYPES, CSP_PAGE, VCREDIST_URL, SOL_URL, PURE_URL, PROTON_DLL_OVERRIDE } from './csp.js';
import { readVideo, writeVideo, displayModes, AA_LEVELS, ANISO_LEVELS, SHADOW_SIZES, FPS_LIMITS } from './acvideo.js';
import { listPpFilters, uninstallPpFilter, restorePpFilter } from './ppfilters.js';
import { knownCars, withAllConfigs, launchEvo, readEvoSession, defaultEvoSession, EVO_MODES, EVO_WEATHER, EVO_GRIP, EVO_TIME_SPEEDS } from './evolaunch.js';
import { IMPORT_RE, resolveDropped, prepareImport, installItem, setItemCar, carChoices, discardImport } from './installer.js';
import { readEvoExtras, readCarPresets, isLazyImage, lazyImage } from './kspkg.js';
import { latestRelease, isNewer, isInstalledCopy, installUpdate } from './appupdate.js';
import { esc, timeAgo, openExternal, openFolder, storageGet, storageSet, norm, log, exists, basename, prettifyId, fileUrl, listDir, join, run, CURL, NULL_DEV, IS_LINUX } from './util.js';

Neutralino.init();

const DEFAULT_SETTINGS = { overrides: {}, minimizeOnLaunch: true, lastGame: 'rally', acFilter: 'all' };

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
const hasOfficialContent = g => g.key === 'ac' || g.key === 'evo';
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
window.__imgFail = img => {
  // An EVO picture not decoded yet: decode it now (cards only load near the
  // view), keep the card blank meanwhile, then show it.
  const src = img.getAttribute('src') || '';
  if (!img.dataset.lazy && isLazyImage(src)) {
    img.dataset.lazy = '1';
    img.style.visibility = 'hidden';
    lazyImage(src, true, img).then(ok => {
      if (!img.isConnected) return;
      img.style.visibility = '';
      if (ok) { img.removeAttribute('src'); img.src = src; } else window.__imgFail(img);
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
};

function imgTag(src, fallback, cls = 'main') {
  if (!src && !fallback) return '';
  const first = src || fallback;
  const fb = src ? (fallback || '') : '';
  return `<img class="${cls}${!src ? ' contain' : ''}" src="${esc(first)}" data-fallback="${esc(fb)}" loading="lazy" onerror="__imgFail(this)" alt="">`;
}

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

async function launchGame(g) {
  if (g.key === 'rally' && !(await rallyPreflight(g))) return;
  await openExternal(steamUrls.run(g.appid));
  toast(`Launching ${g.title} ${g.sub} via Steam…`);
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
    return bad.length ? `${bad.length > 1 ? `${bad.length} .pak liveries were` : 'A .pak livery was'} built for the previous version and will crash Rally while enabled (${bad.map(i => i.title).join(', ')}). Disable ${bad.length > 1 ? 'them' : 'it'} until the author releases an update.` : '';
  }
  if (g.key === 'evo') {
    const mods = (await listDir(state.paths.evo.mods)).filter(e => !['.', '..'].includes(e.entry));
    return mods.length ? `Updates can break mod packages (${mods.length} installed). If EVO crashes at start or mod cars or tracks are missing, disable mods here and look for updated versions.` : '';
  }
  if (g.key === 'ac') return 'Content Manager, Custom Shaders Patch and some mods may need an update for the new version.';
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
    <div><b>${esc(`${g.title} ${g.sub || ''}`.trim())} was updated ${esc(timeAgo(note.at))}</b><small>${esc(text)}</small></div>
    ${state.view === 'mods' ? '' : '<button class="btn subtle small" data-un="mods">Review mods</button>'}
    <button class="btn subtle small" data-un="ok">Got it</button></div>`;
  box.onclick = e => {
    const v = e.target.closest('[data-un]')?.dataset.un;
    if (v === 'mods') { state.view = 'mods'; render(); }
    if (v === 'ok') { delete state.settings.updateNotes[g.key]; saveSettings(); box.innerHTML = ''; }
  };
}

// Mod health check of the sidebar's game (health.js), plus available updates for AC.
async function openHealthCheck(g) {
  const { el } = modal(`<div class="qd imp">
    <header class="qd-head"><h2>Mod check · ${esc(`${g.title} ${g.sub || ''}`.trim())}</h2>
      <div class="qd-sub">Looks through the installed mods for broken, incomplete or conflicting files.</div></header>
    <div class="imp-list"><div class="qd-none">Checking…</div></div>
    <footer class="qd-foot"><div class="qd-summary" id="health-sum"></div><button class="btn subtle small" data-close>Close</button></footer>
  </div>`, 'modal imp-modal');
  let found = [];
  try {
    found = await checkMods(g, getItems, state.paths);
    if (g.key === 'ac') {
      const content = [...await getItems(g, 'cars'), ...await getItems(g, 'tracks')];
      await acUpdates(content);
      for (const i of content.filter(i => i.update)) found.push({ level: 'update', item: i, problem: `Version ${i.update.version} is available (you have ${i.version}).` });
    }
  } catch (err) { log(`health: ${err?.stack || err}`); }
  if (!el.isConnected) return;
  const label = { error: 'Problem', warn: 'Warning', info: 'Note', update: 'Update' };
  el.querySelector('.imp-list').innerHTML = found.map((f, i) => `<div class="imp-row health-row">
      <span class="health-level ${f.level}">${label[f.level]}</span>
      <div class="imp-info"><b>${esc(f.item.title)}${f.item.subtitle ? ` <small>${esc(f.item.subtitle)}</small>` : ''}</b><span>${esc(f.problem)}</span></div>
      ${f.level === 'update' ? `<button class="btn primary small" data-get="${i}">Get update ↗</button>` : ''}
      ${f.item.toggle === 'rally' && f.item.incompatible && f.item.enabled ? `<button class="btn primary small" data-off="${i}">Disable</button>` : ''}
      ${f.item.id && f.item.game ? `<button class="btn subtle small" data-show="${i}">Details</button>` : ''}
      <button class="btn subtle small" data-dir="${i}">Open folder</button>
    </div>`).join('') || '<div class="qd-none">No problems found.</div>';
  const n = lvl => found.filter(f => f.level === lvl).length;
  el.querySelector('#health-sum').textContent = found.length ? [n('error') && `${n('error')} problem${n('error') > 1 ? 's' : ''}`, n('warn') && `${n('warn')} warning${n('warn') > 1 ? 's' : ''}`, n('info') && `${n('info')} note${n('info') > 1 ? 's' : ''}`, n('update') && `${n('update')} update${n('update') > 1 ? 's' : ''}`].filter(Boolean).join(' · ') : 'Everything looks fine.';
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
        b.remove(); toast(`Disabled ${f.item.title}`);
      } catch (err) { toast(`Could not disable ${f.item.title}: ${err?.message || 'file in use?'}`, true); }
    }
  });
}

// Rally crashes at startup while an enabled .pak livery was cooked for another
// game version (typically after a game update), so offer to disable those first.
// Resolves true to go ahead with the launch.
async function rallyPreflight(g) {
  let bad = [];
  try { bad = rallyIncompatible(await getItems(g, 'liveries', true)); } catch { return true; }
  if (!bad.length) return true;
  return new Promise(resolve => {
    let answered = false;
    const { el, close } = modal(`<div class="qd imp">
      <header class="qd-head"><h2>${bad.length > 1 ? `${bad.length} liveries` : 'A livery'} will crash Rally</h2>
        <div class="qd-sub">${bad.length > 1 ? 'These .pak liveries were' : 'This .pak livery was'} built for another version of the game, and the game has updated since. Rally crashes while loading as long as ${bad.length > 1 ? 'they are' : 'it is'} enabled.</div>
      </header>
      <div class="imp-list">${bad.map(i => `<div class="imp-row">
        <div class="imp-thumb">${i.image ? imgTag(i.image, '') : '<img class="imp-logo" src="/img/logos/rally.png" alt="">'}</div>
        <div class="imp-info"><b>${esc(i.title)}</b><code>${esc(i.meta.files.join(', '))}</code></div>
      </div>`).join('')}</div>
      <footer class="qd-foot">
        <div class="qd-summary">Disabling is reversible: enable ${bad.length > 1 ? 'them' : 'it'} again once the author releases an update.</div>
        <button class="btn subtle small" data-close>Cancel</button>
        <button class="btn subtle small" data-v="play">Play anyway</button>
        <button class="btn primary small" data-v="fix">Disable and play</button>
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
          toast(`Disabled ${bad.map(i => i.title).join(', ')}`);
          if (state.view === 'mods' && state.game === 'rally') render();
        } catch (err) {
          toast(`Could not disable the liveries: ${err?.message || 'file in use?'}`, true);
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
      <span class="status ${on ? 'on' : ''}" title="${on ? 'Installed' : 'Not installed'}"></span>
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

// Bundled cover per game; drop img/covers/<key>.jpg to change it.
function heroImage(g) {
  return `/img/covers/${g.key}.jpg`;
}

function renderGames() {
  const g = gameByKey(state.game);
  const installed = isInstalled(g);
  main.innerHTML = `<div class="view games">
    <div class="hero-bg" style="background-image:url('${heroImage(g)}'), url('${steamUrls.hero(g.appid)}'), linear-gradient(120deg,#2a2a2a,#111)"></div>
    <div id="update-note"></div>
    <section class="hero">
      <div class="hero-top">
        <div class="hero-copy">
          ${logoHTML(g)}
          <h2>${esc(g.headline)}</h2>
          <p class="blurb">${esc(g.blurb)}</p>
          <div class="price" id="price"></div>
        </div>
        <div class="hero-actions">
          <div class="row">
            <button class="btn ghost" id="btn-trailer">Watch Trailer</button>
            ${installed
              ? `<button class="btn primary" id="btn-play">▶&nbsp; Play</button>`
              : `<button class="btn primary" id="btn-buy">Purchase</button>`}
          </div>
          ${installed ? '' : `<button class="link" id="btn-install">Already own it? Install via Steam</button>`}
        </div>
      </div>
      <div class="news-row" id="news-row">
        <div class="news-card skeleton"></div><div class="news-card skeleton"></div><div class="news-card skeleton"></div>
      </div>
    </section>
  </div>`;

  $('#btn-trailer').onclick = () => openTrailer(g);
  if (installed) $('#btn-play').onclick = () => launchGame(g);
  else {
    $('#btn-buy').onclick = () => openExternal(steamUrls.store(g.appid));
    $('#btn-install').onclick = () => openExternal(steamUrls.install(g.appid));
    getStoreDetails(g.appid).then(d => { if (d?.price && state.game === g.key) $('#price') && ($('#price').textContent = `Steam price: ${d.price}`); });
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
    row.innerHTML = `<div class="news-card" style="grid-column:1/-1;height:120px;justify-content:center"><h3>News unavailable</h3><span class="when">Could not reach Steam. Check your connection.</span></div>`;
    return;
  }
  row.innerHTML = items.slice(0, 3).map((n, i) => `
    <button class="news-card" data-news="${i}" style="background-image:${newsBg(n, g)}">
      <span class="kicker">${esc(n.label === 'Community Announcements' ? 'News' : n.label)}</span>
      <h3>${esc(n.title)}</h3>
      <span class="when">${timeAgo(n.date)}</span>
    </button>`).join('');
  row.onclick = e => {
    const c = e.target.closest('[data-news]');
    if (c) openExternal(items[+c.dataset.news].url);
  };
}

async function openTrailer(g) {
  const { el } = modal(`<video controls autoplay playsinline></video>`, 'trailer');
  const video = el.querySelector('video');
  const details = await getStoreDetails(g.appid);
  const movie = details?.movies?.find(m => m.highlight) || details?.movies?.[0];
  if (!movie) { toast('No trailer available — opening the Steam store page.'); openExternal(steamUrls.storeWeb(g.appid)); $('#modal-root [data-close]')?.click(); return; }
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
  state.cache[key] = items;
  return items;
}

function emptyState(g, tab) {
  const folder = contentFolder(g.key, tab, state.paths);
  const installed = isInstalled(g);
  const btnInstall = `<button class="btn primary small" data-act="install">Install via Steam</button>`;
  switch (g.key) {
    case 'ac':
      if (!installed) return `<h3>Assetto Corsa not found</h3>Install it through Steam, or set its folder in Settings.<br>${btnInstall}`;
      return `<h3>No ${tab} mods yet</h3>Drop mod folders into <code>${esc(folder)}</code>. Each mod shows its preview image here automatically.`;
    case 'acc':
      return `<h3>No custom liveries found</h3>ACC reads liveries from <code>${esc(folder)}</code>. Each livery is a folder with <code>decals.png</code> / <code>sponsors.png</code> plus a car file in <code>Customs/Cars</code>.`;
    case 'evo':
      if (tab === 'liveries') return `<h3>No external liveries yet</h3>EVO loads custom liveries from <code>${esc(folder)}</code>, together with their car in your garage (<code>ProfileData\\…\\SavedCars</code>).<br>Drop a livery's .zip (for example from LiveryLab Evo) on this window to install both.`;
      return `<h3>No EVO mods installed</h3>EVO loads community mods (<code>.kspkg</code>) from <code>${esc(folder)}</code>.<br>Put an image with the same name next to a mod (e.g. <code>my_car.png</code>) to give it a preview here.
        <br><button class="btn primary small" data-act="mkdir">Create &amp; open mods folder</button>`;
    case 'rally':
      if (!installed && !state.settings.overrides.rally_install) return `<h3>Assetto Corsa Rally not installed</h3>Rally liveries live inside the game folder (<code>acr\\Content\\Paks</code>), so install the game first.<br>${btnInstall}`;
      return `<h3>No custom liveries yet</h3>Custom liveries are folders with <code>livery.json</code>, <code>icon.png</code> and <code>body_livery_*.dds</code> in <code>${esc(folder)}\\&lt;Car&gt;</code>.
        Older <code>.pak</code> + <code>.utoc</code> + <code>.ucas</code> liveries go in <code>acr\\Content\\Paks</code>.<br>Drop a livery's .zip, .rar or .7z on this window to install it.`;
  }
  return '';
}

function cardHTML(item, idx) {
  const content = item.kind === 'car' || item.kind === 'track';
  const flag = !item.enabled ? '<span class="flag off">Disabled</span>'
    : item.incompatible ? '<span class="flag">Crashes game</span>'
    : item.update ? `<span class="flag update">Update v${esc(item.update.version)}</span>`
    : item.game === 'ac' && content && !item.isMod ? '<span class="flag kunos">Kunos</span>'
    : (item.game === 'ac' || item.game === 'evo') && content && item.isMod ? '<span class="flag">Mod</span>' : '';
  // Official content added by the game's latest update (markFresh, games.js).
  const fresh = item.isNew ? `<span class="flag tag-new${item.flag || (item.badge && item.image) ? ' after-icon' : ''}">New</span>` : '';
  const num = item.kind === 'replay' ? '' : item.number != null ? `<div class="placeholder">#${esc(item.number)}</div>` : `<div class="placeholder">${initials(item.title)}</div>`;
  return `<button class="card ${item.enabled ? '' : 'disabled'}" data-idx="${idx}">
    <div class="thumb ${item.kind === 'replay' ? 'icon' : ''}">
      ${num}
      ${imgTag(item.image, item.fallbackImage)}
      ${item.overlay ? `<img class="overlay" src="${esc(item.overlay)}" loading="lazy" onerror="this.remove()" alt="">` : ''}
      ${item.badge && item.image ? `<img class="badge" src="${esc(item.badge)}" loading="lazy" onerror="this.remove()" alt="">` : ''}
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
      <div class="tabs">${g.tabs.map(t => `<button data-tab="${t.id}" class="${t.id === tab ? 'active' : ''}">${t.label}</button>`).join('')}</div>
      <div class="toolbar">
        <input class="search" id="search" placeholder="Search ${tab}…" value="${esc(state.search)}">
        ${hasOfficialContent(g) ? `<div class="seg" id="ac-filter">
          <button data-f="mods" class="${state.settings.acFilter === 'mods' ? 'active' : ''}">Mods</button>
          <button data-f="all" class="${state.settings.acFilter === 'all' ? 'active' : ''}">All content</button></div>` : ''}
        <button class="btn small subtle" id="btn-health" title="Look for broken, incomplete or conflicting mods">Check mods</button>
        <button class="btn small subtle" id="btn-refresh" title="Rescan folders">↻ Rescan</button>
        <button class="btn small subtle" id="btn-folder" ${folder ? '' : 'disabled'}>Open folder</button>
        <button class="btn small subtle" id="btn-install" title="Install a mod from a .zip, .rar, .7z, .kspkg or .pak (or drop it on the window)">＋ Install mod</button>
        <button class="btn small primary" id="btn-play-mods" ${isInstalled(g) ? '' : 'disabled'}>▶ Play</button>
      </div>
    </div>
    <div class="mods-meta"><span id="count"></span><span class="path">${esc(folder)}</span></div>
    <div id="update-note"></div>
    <div id="grid-wrap"><div class="loading">Scanning ${esc(tab)}…</div></div>
  </div>`;

  $('.tabs').onclick = e => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    state.tab[g.key] = b.dataset.tab;
    state.search = '';
    renderMods();
  };
  $('#btn-refresh').onclick = () => renderMods(true);
  $('#btn-health').onclick = () => openHealthCheck(g);
  $('#btn-folder').onclick = () => openFolder(folder);
  $('#btn-install').onclick = pickModFiles;
  $('#btn-play-mods').onclick = () => launchGame(g);
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
    return `<nav class="qd-brands mods-brands" id="mods-brands"><button class="qd-brand all ${on ? '' : 'active'}" data-brand="" title="All brands">All</button>${names.map(n => {
      const logo = logos.get(n);
      return `<button class="qd-brand ${n === on ? 'active' : ''}" data-brand="${esc(n)}" title="${esc(n)}">${logo
        ? `<img src="${esc(logo)}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('span'),{textContent:'${esc(initials(n))}'}))">`
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
    const total = media ? `${items.length} total` : hasOfficialContent(g) ? `${items.filter(i => i.isMod).length} mods · ${items.length} total` : `${items.length} installed`;
    $('#count').textContent = `${list.length} shown · ${total}`;
    const wrap = $('#grid-wrap');
    if (!items.length || (!list.length && !state.search && hasOfficialContent(g) && state.settings.acFilter === 'mods')) {
      wrap.innerHTML = `<div class="empty">${emptyState(g, tab)}</div>`;
    } else if (!list.length) {
      wrap.innerHTML = `<div class="empty"><h3>No matches</h3>Nothing matches “${esc(state.search)}”.</div>`;
    } else {
      // Rally liveries are square in the game (texture and icon), so their cards are too.
      const grid = `<div class="grid ${g.key === 'rally' ? 'square' : ''}">${list.map(i => cardHTML(i, items.indexOf(i))).join('')}</div>`;
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
    if (act === 'mkdir') {
      try { await Neutralino.filesystem.createDirectory(folder); } catch { /* exists */ }
      return openFolder(folder);
    }
    const brand = e.target.closest('[data-brand]');
    if (brand) { state.brand[g.key] = brand.dataset.brand; drawGrid(); return; }
    const card = e.target.closest('[data-idx]');
    if (card) openDetail(g, items[+card.dataset.idx], () => drawGrid());
  };
}

// ---------------------------------------------------------------------------
// Detail modal

function specsHTML(item) {
  const rows = [];
  const s = item.specs || {};
  const add = (k, v) => v && rows.push(`<dt>${k}</dt><dd>${esc(v)}</dd>`);
  if (item.kind === 'car') {
    add('Power', s.bhp); add('Torque', s.torque); add('Weight', s.weight); add('Top speed', s.topspeed);
    add('0-100', s.acceleration); add('P/W ratio', s.pwratio); add('Year', item.year); add('Country', item.country);
    add('Skins', String(item.skins?.length || 0));
  } else if (item.kind === 'track') {
    const l = item.layouts[0];
    add('Location', item.subtitle); add('Length', l.length); add('Pit boxes', l.pitboxes); add('Layouts', String(item.layouts.length));
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
  if (item.game === 'ac' && item.kind === 'car') actions.push(`<button class="btn primary small" data-a="drive">▶ Drive this car</button>`);
  if (item.game === 'ac' && item.kind === 'track') actions.push(`<button class="btn primary small" data-a="drive">▶ Drive here</button>`);
  if (item.game === 'evo' && item.kind === 'car' && item.carId) actions.push(`<button class="btn primary small" data-a="drive">▶ Drive this car</button>`);
  if (item.game === 'evo' && item.evoTrack) actions.push(`<button class="btn primary small" data-a="drive">▶ Quick Drive here</button>`);
  const isMedia = item.kind === 'screenshot' || item.kind === 'replay';
  const removeLabel = isMedia ? 'Delete' : 'Uninstall';
  if (item.kind === 'screenshot') actions.push(`<button class="btn primary small" data-a="open">Open picture</button>`);
  if (item.toggle) actions.push(`<button class="btn small ${item.enabled ? 'subtle' : 'primary'}" data-a="toggle">${item.enabled ? 'Disable' : 'Enable'}</button>`);
  actions.push(`<button class="btn small subtle" data-a="folder">Open folder</button>`);
  if (item.url) actions.push(`<button class="btn small subtle" data-a="url">Author page ↗</button>`);
  if (item.update) actions.push(`<button class="btn small primary" data-a="update" title="Opens the download Content Manager's update registry lists">Get update v${esc(item.update.version)} ↗</button>`);
  if (uninstallPaths(item).length) actions.push(`<button class="btn small danger" data-a="uninstall" title="Moves the ${isMedia ? 'file' : "mod's files"} to the Recycle Bin">${removeLabel}</button>`);

  const skins = item.skins?.length ? `<div class="section-title">Skins (${item.skins.length})</div>
    <div class="skins">${item.skins.map(s => `<button class="skin ${s.id === selectedSkin ? 'active' : ''}" data-skin="${esc(s.id)}">
      ${imgTag(s.image, s.livery)}<span>${esc(s.id)}</span></button>`).join('')}</div>` : '';

  const layouts = item.layouts?.length > 1 ? `<div class="section-title">Layouts (${item.layouts.length})</div>
    <div class="skins">${item.layouts.map(l => `<div class="skin">${imgTag(l.preview, l.outline)}<span>${esc(l.name || l.id || 'Default')}${l.length ? ` · ${esc(l.length)}` : ''}</span></div>`).join('')}</div>` : '';

  const galleryItems = (item.gallery || []).map(g => typeof g === 'string' ? { src: g } : g);
  const gallery = galleryItems.length > 1 ? `<div class="section-title">${esc(item.galleryTitle || 'Textures')} (${galleryItems.length})</div>
    <div class="skins">${galleryItems.map((g, i) => `<button class="skin ${g.src === item.image ? 'active' : ''}" data-gal="${i}">
      ${imgTag(g.src, '')}${g.label ? `<span>${esc(g.label)}</span>` : ''}</button>`).join('')}</div>` : '';

  const { el, close } = modal(`
    <div class="detail-hero ${item.kind === 'replay' ? 'icon' : ''}">
      ${item.number != null ? `<div class="thumb" style="position:absolute;inset:0"><div class="placeholder" style="font-size:140px">#${esc(item.number)}</div></div>` : ''}
      ${imgTag(heroSrc, item.fallbackImage)}
      ${item.overlay ? `<img class="overlay" src="${esc(item.overlay)}" onerror="this.remove()" alt="">` : ''}
    </div>
    <div class="detail-body">
      ${item.kind === 'car' && item.badge ? `<img class="detail-logo" src="${esc(item.badge)}" onerror="this.remove()" alt="">` : ''}
      <h2>${esc(item.title)}</h2>
      <div class="detail-sub">${esc(item.subtitle || '')}</div>
      <div class="detail-actions">${actions.join('')}</div>
      <div class="detail-grid">
        <div>
          <div class="detail-desc">${esc(item.description || 'No description provided.')}</div>
          ${item.tags?.length ? `<div class="chips">${item.tags.map(t => `<span class="chip">${esc(t)}</span>`).join('')}</div>` : ''}
        </div>
        ${specsHTML(item)}
      </div>
      ${skins}${layouts}${gallery}
    </div>`);

  if (item.update) cupDetails(item.kind, item.id).then(d => {
    const desc = el.querySelector('.detail-desc');
    if (d?.changelog && desc) desc.textContent += `\n\nWhat's new in v${item.update.version}:\n${d.changelog}`;
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
    if (a === 'url') openExternal(item.url);
    if (a === 'open') openExternal(item.meta.file);
    if (a === 'update') openExternal(item.update.get);
    if (a === 'toggle') {
      try {
        await setEnabled(item, !item.enabled);
        item.enabled = !item.enabled;
        if (item.toggle === 'evo') item.path = item.enabled ? item.path.replace(/\.disabled$/i, '') : item.path + '.disabled';
        if (item.toggle === 'rally') item.meta.files = item.meta.files.map(f => item.enabled ? f.replace(/\.disabled$/i, '') : f.replace(/\.disabled$/i, '') + '.disabled');
        toast(`${item.title} ${item.enabled ? 'enabled' : 'disabled'}`);
        close();
        onChange?.();
      } catch (err) {
        toast(`Could not change ${item.title}: ${err?.message || 'file in use?'}`, true);
      }
    }
    if (a === 'uninstall') {
      // Two-step: the first click arms the button, the second one uninstalls.
      const b = e.target.closest('[data-a]');
      if (!b.dataset.armed) {
        b.dataset.armed = '1';
        b.textContent = `Click again to ${removeLabel.toLowerCase()}`;
        setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = removeLabel; } }, 4000);
        return;
      }
      b.disabled = true;
      try {
        await uninstallItem(item);
        for (const list of Object.values(state.cache)) { const i = list.indexOf(item); if (i >= 0) list.splice(i, 1); }
        toast(`${item.title} ${isMedia ? 'deleted' : 'uninstalled'} (moved to the Recycle Bin)`);
        close();
        onChange?.();
      } catch (err) {
        b.disabled = false; delete b.dataset.armed; b.textContent = removeLabel;
        toast(`Could not uninstall ${item.title}: ${err?.message || 'file in use?'}`, true);
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
//   o.session  { summary() -> { title, sub }, sections(sel) -> sheet sections, onChange(ui) }
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
    return `<button class="qd-game ${k === o.game ? 'active' : ''} ${why ? 'off' : ''}" data-qd-game="${k}" title="${esc(why || `Quick Drive for ${label}`)}">${esc(label)}</button>`;
  }).join('');
  const { el, close } = qdPage(o.game, `<div class="qd evo" data-game="${o.game}">
    <header class="qd-head">
      <div class="qd-title"><h2>Quick Drive</h2><nav class="qd-games">${tabs}</nav>
        <button class="qd-session-btn" data-session title="Game mode, opponents, time and weather"></button>
        <button class="qd-presets-btn" data-surprise title="Pick a random car and track you can drive"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.75" y="1.75" width="12.5" height="12.5" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="5.3" cy="5.3" r="1.1" fill="currentColor"/><circle cx="10.7" cy="10.7" r="1.1" fill="currentColor"/><circle cx="8" cy="8" r="1.1" fill="currentColor"/></svg><span>Surprise me</span></button>
        <button class="qd-presets-btn" data-presets title="Saved setups, recent sessions and your best times"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 1.75h8c.41 0 .75.34.75.75v11.6l-4.75-3.1-4.75 3.1V2.5c0-.41.34-.75.75-.75z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg><span>Presets</span></button></div>
      <div class="qd-sub">${o.sub}</div>
    </header>
    <div class="qd-cols">
      <section class="qd-panel">
        <div class="qd-panel-head">
          <h3>Car <small>${esc(o.carCount)}</small></h3>
          <input class="search" id="qd-car-q" placeholder="Search cars…">
        </div>
        <div class="qd-variants" id="qd-variants"></div>
        <div class="qd-carbox">
          <nav class="qd-brands" id="qd-brands"></nav>
          <div class="qd-grid" id="qd-cars"></div>
        </div>
      </section>
      <section class="qd-panel">
        <div class="qd-panel-head">
          <h3>Track <small>${esc(o.trackCount)}</small></h3>
          <input class="search" id="qd-track-q" placeholder="Search tracks…">
        </div>
        <div class="qd-layouts" id="qd-layouts"></div>
        <div class="qd-grid" id="qd-tracks"></div>
      </section>
    </div>
    <footer class="qd-foot">
      <div class="qd-summary" id="qd-summary"></div>
      <button class="btn primary small" id="qd-go">▶ ${esc(o.launchLabel)}</button>
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
    el.querySelector('#qd-brands').innerHTML = `<button class="qd-brand all ${brand ? '' : 'active'}" data-brand="" title="All brands">All</button>` +
      names.map(n => {
        const logo = o.brandLogo(n);
        return `<button class="qd-brand ${n === brand ? 'active' : ''}" data-brand="${esc(n)}" title="${esc(n)}">${logo
          ? `<img src="${esc(logo)}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('span'),{textContent:'${esc(initials(n))}'}))">`
          : `<span>${initials(n)}</span>`}</button>`;
      }).join('');
  };
  const drawCars = () => {
    const list = o.cars.filter(c => (!brand || c.brand === brand || c.key === '') && match(search.car, `${c.title} ${c.sub} ${c.brand} ${c.key}`));
    el.querySelector('#qd-cars').innerHTML = list.map(c => card(`data-car="${esc(c.key)}"`, c.image, c.title, c.sub, c.flag || '', c.locked ? 'locked' : '')).join('')
      || '<div class="qd-none">No cars match.</div>';
    sync();
  };
  const drawTracks = () => {
    // The track list can change (per game mode); keep the selection valid.
    let t = findTrack(sel.track);
    if (!t) { t = o.tracks[0]; sel.track = t?.key ?? ''; }
    if (t && !t.layouts.some(l => l.key === sel.layout)) sel.layout = t.layouts[0]?.key ?? '';
    el.querySelector('#qd-tracks').innerHTML = o.tracks
      .filter(t => match(search.track, `${t.title} ${t.sub} ${t.layouts.map(l => l.name).join(' ')}`))
      .map(t => card(`data-track="${esc(t.key)}"`, t.image, t.title, t.sub, t.flag || '')).join('') || '<div class="qd-none">No tracks match.</div>';
    sync();
  };
  const drawSession = () => {
    const s = o.session?.summary();
    const btn = el.querySelector('[data-session]');
    btn.hidden = !s;
    if (s) btn.innerHTML = `<svg class="qd-session-gear" viewBox="0 0 24 24" aria-hidden="true"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.8"/></svg><span class="qd-session-edit">Session settings</span>`;
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
    const specName = o.specName || 'Spec';
    const specMenu = specs.length > 1 ? `<div class="qd-spec"><button class="qd-spec-btn" data-spec-menu title="${esc(`${specName}: ${specs.find(s => s.key === spec)?.label || ''}`)}">${esc(specName)}${chevron}</button>
      <div class="qd-spec-menu" hidden><small>${esc(specName)}</small>${specs.map(s => `<button class="${s.key === spec ? 'active' : ''}" data-spec="${esc(s.key)}">${esc(s.label)}</button>`).join('')}</div></div>` : '';
    el.querySelector('#qd-variants').innerHTML = variants.length || hint
      ? `<span class="qd-layouts-name">${esc(o.variantLabel)}</span>${specMenu}<div class="qd-variant-strip">${variants.map(x => `<button class="qd-variant ${x.key === sel.variant ? 'active' : ''}" data-variant="${esc(x.key)}" title="${esc([x.title, x.sub].filter(Boolean).join(' · '))}">
          <div class="thumb">${imgTag(x.image, '')}</div><span>${esc(x.title)}${x.sub ? `<small>${esc(x.sub)}</small>` : ''}</span></button>`).join('')}</div>
          ${hint ? `<span class="qd-variant-hint" data-tip="${esc(hint)}" aria-label="${esc(hint)}"><svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="8.2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10 9v5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="10" cy="6.2" r="1.1" fill="currentColor"/></svg></span>` : ''}`
      : '';
    const strip = el.querySelector('.qd-variant-strip');
    if (strip) strip.scrollLeft = keepX;
    el.querySelector('#qd-layouts').innerHTML = t ? `<span class="qd-layouts-name">${esc(t.title)}</span>` + t.layouts
      .map(l => `<button class="qd-layout ${l.key === sel.layout ? 'active' : ''}" data-layout="${esc(l.key)}">
        ${l.outline ? `<img src="${esc(l.outline)}" alt="" onerror="this.remove()">` : ''}<span>${esc(l.name)}${l.sub ? `<small>${esc(l.sub)}</small>` : ''}</span></button>`).join('') : '';
    const note = drawSession();
    const pb = o.best?.(sel);
    el.querySelector('#qd-summary').innerHTML = `
      <div class="qd-sum-img">${imgTag(vImage || c?.image, (c?.brand && o.brandLogo(c.brand)) || '')}</div>
      <div><b>${esc(c?.summaryTitle || c?.title || '')}</b><small>${esc(v ? variantText(v) : c?.sub || '')}</small></div>
      <div class="qd-sum-img">${imgTag(layout?.preview || t?.image, '')}</div>
      <div><b>${esc(t?.title || '')}</b><small>${esc([layout?.name, layout?.sub].filter(Boolean).join(' · '))}</small></div>
      ${pb ? `<div class="qd-pb" title="Your personal best with this car here, as recorded by the game${pb.at ? ` (${esc(timeAgo(pb.at / 1000))})` : ''}"><small>Your best</small><b>${esc(lapTime(pb.ms))}</b></div>` : ''}
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
    if (!cars.length || !tracks.length) { toast('Nothing else to pick from', true); return; }
    const c = pick(cars), t = pick(tracks);
    const variants = o.variants(c.key) || [];
    const layouts = t.key === sel.track ? t.layouts.filter(l => l.key !== sel.layout) : t.layouts;
    sel.car = c.key; sel.variant = variants.length ? pick(variants).key : o.defaultVariant(c.key);
    sel.track = t.key; sel.layout = layouts.length ? pick(layouts).key : '';
    search.car = search.track = ''; brand = '';
    el.querySelector('#qd-car-q').value = el.querySelector('#qd-track-q').value = '';
    redraw(); revealAll();
    const l = t.layouts.find(x => x.key === sel.layout);
    toast(`Surprise: ${c.summaryTitle || c.title} at ${t.title}${l?.name ? ` · ${l.name}` : ''}`);
  };

  // Presets (named setups) and recent sessions, per game: the selection plus the
  // session settings (o.session.get/set), with names for the list.
  const store = key => ((state.settings[key] ||= {})[o.game] ||= []);
  const describe = s => {
    const c = findCar(s.car), t = findTrack(s.track), l = t?.layouts.find(x => x.key === s.layout);
    const all = o.variants(s.car) || [], v = all.find(x => x.key === s.variant);
    return { car: c?.summaryTitle || c?.title || '', variant: v ? withSpec(v, all) : '', track: [t?.title, l?.name].filter(Boolean).join(' · '), session: o.session?.summary()?.title || '' };
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
    } else missing.push('car');
    o.session?.onChange?.(ui); // the session can change the track list (EVO, AC)
    const t = findTrack(p.sel.track);
    if (t) { sel.track = t.key; sel.layout = t.layouts.some(l => l.key === p.sel.layout) ? p.sel.layout : t.layouts[0]?.key ?? ''; } else missing.push('track');
    redraw(); revealAll();
    if (missing.length) toast(`Loaded, but the ${missing.join(' and ')} isn't available any more`, true);
    else toast(p.message || `Loaded ${p.name ? `“${p.name}”` : 'the session'}`);
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
      <div class="qd-preset-info"><b>${esc(kind === 'saved' ? p.name : p.label.car || 'Session')}</b>
        <small>${esc([kind === 'saved' && p.label.car, p.label.variant, p.label.track, p.label.session, kind === 'recent' && timeAgo(p.at / 1000)].filter(Boolean).join(' · '))}</small></div>
      <button class="btn primary small" data-load="${kind}:${i}">Load</button>
      ${kind === 'saved' ? `<button class="btn subtle small" data-del="${i}" title="Delete this preset">✕</button>` : `<button class="btn subtle small" data-keep="${i}" title="Keep it as a preset">Save</button>`}</div>`;
    const draw = () => {
      const saved = store('qdPresets'), recent = store('qdRecent');
      wrap.innerHTML = `<div class="qd-sheet qd-presets">
        <header><h3>Presets</h3><small>A preset keeps the car${o.variantLabel ? ` and ${esc(o.variantLabel.toLowerCase())}` : ''}, the track and the session settings.</small><button class="btn primary small" data-done>Done</button></header>
        <div class="qd-sheet-body">
          <section class="qd-sheet-sec"><h4>Saved</h4>
            <form class="qd-preset-new"><input class="search" maxlength="48" placeholder="Name the current setup"><button class="btn primary small">Save current</button></form>
            ${saved.map((p, i) => row(p, i, 'saved')).join('') || '<p class="qd-preset-empty">No presets yet.</p>'}</section>
          <section class="qd-sheet-sec"><h4>Recent sessions</h4>
            ${recent.map((p, i) => row(p, i, 'recent')).join('') || '<p class="qd-preset-empty">Sessions you start from here appear here.</p>'}</section>
          ${o.bests ? `<section class="qd-sheet-sec"><h4>Beat your time</h4>
            ${bests.map((b, i) => { const d = describe(b.sel); return `<div class="qd-preset">
              <div class="qd-preset-info"><b>${esc(lapTime(b.ms))} · ${esc(d.car)}</b><small>${esc([d.track, b.at && timeAgo(b.at / 1000)].filter(Boolean).join(' · '))}</small></div>
              <button class="btn primary small" data-beat="${i}" title="Select this car and track">Select</button></div>`; }).join('') || '<p class="qd-preset-empty">No personal bests recorded by the game yet.</p>'}</section>` : ''}
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
      toast(`Saved preset “${name}”`);
    };
    wrap.addEventListener('submit', e => {
      e.preventDefault();
      const entry = snapshot();
      save(entry, e.target.querySelector('input').value.trim() || [entry.label.car, entry.label.track].filter(Boolean).join(' @ ') || 'Preset');
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
        apply({ sel: { variant: '', layout: '', ...b.sel }, session: null, message: `Selected · your best here is ${lapTime(b.ms)}` });
        return;
      }
      const keep = e.target.closest('[data-keep]')?.dataset.keep;
      if (keep != null) { const r = store('qdRecent')[keep]; save({ sel: r.sel, session: r.session, label: r.label }, [r.label.car, r.label.track].filter(Boolean).join(' @ ') || 'Preset'); }
    });
    draw();
    wrap.querySelector('.qd-preset-new input')?.focus();
  };

  el.querySelector('#qd-go').onclick = async () => {
    const go = el.querySelector('#qd-go');
    go.disabled = true;
    try {
      if (await o.onLaunch({ ...sel }) !== false) {
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
//   [{ title, note?, wide?, fields: [{ label, hint?, type: 'seg'|'select'|'date', options: [[value, label]], get(), set(value) }] }]
// ('date' has no options: its value is YYYY-MM-DD) and is rebuilt after every
// change, so fields can depend on each other.
function openSessionSheet(host, session, getSel, onChange) {
  host.querySelector('.qd-sheet-wrap')?.remove();
  const wrap = document.createElement('div');
  wrap.className = 'qd-sheet-wrap';
  host.appendChild(wrap);
  let fields = [];
  const fieldHTML = (f, i) => {
    const k = (f.options || []).findIndex(([v]) => v === f.get());
    const control = f.type === 'date' ? `<input type="date" data-f="${i}" value="${esc(f.get())}">`
      : f.type === 'seg'
      ? `<div class="qd-seg" data-f="${i}">${f.options.map(([, label], j) => `<button data-k="${j}" class="${j === k ? 'active' : ''}">${esc(label)}</button>`).join('')}</div>`
      : `<select data-f="${i}">${f.options.map(([, label], j) => `<option value="${j}" ${j === k ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select>`;
    return `<div class="qd-row"><label>${esc(f.label)}${f.hint ? `<small>${esc(f.hint)}</small>` : ''}</label>${control}</div>`;
  };
  const draw = () => {
    const y = wrap.querySelector('.qd-sheet-body')?.scrollTop || 0;
    fields = [];
    const sections = session.sections(getSel());
    wrap.innerHTML = `<div class="qd-sheet">
      <header><h3>Session settings</h3><small>${esc(session.sheetNote || '')}</small><button class="btn primary small" data-done>Done</button></header>
      <div class="qd-sheet-body">${sections.map(s => `<section class="qd-sheet-sec ${s.wide ? 'wide' : ''}">
        <h4>${esc(s.title)}</h4>${s.note ? `<p class="qd-sheet-note">${esc(s.note)}</p>` : ''}
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
  wrap.addEventListener('change', e => {
    if (e.target.matches('select[data-f]')) set(Number(e.target.dataset.f), Number(e.target.value));
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
const minuteOptions = (value, from, to, step, zeroLabel) => withCurrent(steps(from, to, step).map(m => [m, m === 0 && zeroLabel ? zeroLabel : `${m} min`]), value, m => `${m} min`);
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

// Official site pictures of ACC and Rally cars, stages and tracks (sitecatalog.js):
// the ones shipped in img/site/ (manifest.json), plus cars/stages the weekly sync
// found on the site since (cached in .cache/site, settings.siteExtra), so they
// show without a connection.
let siteManifest = { rally: { cars: {}, stages: {} }, acc: { cars: {}, tracks: {} } };
async function loadSiteImages() {
  try { siteManifest = await (await fetch('/img/site/manifest.json')).json(); } catch (err) { log(`site images: ${err?.message}`); }
  const dir = await appCacheDir('site').catch(() => '');
  // Pictures the launcher now ships aren't needed from the cache (older syncs also
  // took Greece's stage maps for photos: Greece now ships with real ones).
  if (state.settings.siteExtra) state.settings.siteExtra = state.settings.siteExtra.filter(x => !(x.key && siteManifest[x.game]?.[x.kind]?.[x.key]));
  for (const x of state.settings.siteExtra || []) x.url = dir ? fileUrl(join(dir, x.file)) : '';
}
function siteImage(game, kind, key, name = '') {
  const rel = siteManifest[game]?.[kind]?.[key];
  if (rel) return `/img/site/${rel}`;
  const extra = (state.settings.siteExtra || []).filter(x => x.game === game && x.kind === kind && x.url);
  if (kind === 'stages' || kind === 'maps') return extra.find(x => x.key === key)?.url || '';
  const k = name && bestMatch(name, extra.map(x => ({ key: x.url, name: x.name })));
  return k || '';
}
const rallyCarImage = id => siteImage('rally', 'cars', id, `${rallyCarName(id)} ${id}`);

// Each launch (when online): look on the official Rally page for cars, stages and
// stage maps added since this launcher was built, and keep their pictures (the
// game is in Early Access). The page is only downloaded when it changed since the
// last look (If-Modified-Since: the site then answers 304 with no body); a
// changed page is ~70 KB compressed.
async function siteSync() {
  const since = state.settings.siteModified ? `-H "If-Modified-Since: ${state.settings.siteModified}"` : '';
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
  const ids = (await rallyCarIds(state.paths).catch(() => Object.keys(RALLY_CARS))).map(k => ({ key: k, name: `${rallyCarName(k)} ${k}` }));
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
    ...siteCars(page.stdOut).map(c => ({ kind: 'cars', key: bestMatch(c.name, ids) || '', name: c.name, img: c.img })),
    ...rallyStagePhotos(page.stdOut).map(p => ({ kind: 'stages', key: groupOf(p.name), name: p.name, img: p.img })).filter(p => p.key),
    ...siteMaps(page.stdOut).map(p => ({ kind: 'maps', key: groupOf(p.name), name: p.name, img: p.img })).filter(p => p.key),
  ].filter(j => !known(j.kind, j.key, j.name));
  for (const j of jobs) {
    const file = `rally-${j.kind}-${(j.key || j.name).replace(/[^A-Za-z0-9]+/g, '_')}.${j.kind === 'maps' ? 'png' : 'jpg'}`;
    for (const url of j.kind === 'maps' ? [j.img] : imageSizes(j.img)) {
      const r = await run(`${CURL} -s -L -f --max-time 30 -o "${join(dir, file)}" "${url}"`);
      if (r.exitCode === 0) { extra.push({ game: 'rally', kind: j.kind, key: j.key, name: j.name, file }); log(`site sync: ${j.name}`); break; }
    }
  }
  state.settings.siteSyncAt = Date.now();
  if (modified) state.settings.siteModified = modified;
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
  const weatherName = () => ACC_WEATHER.find(([id]) => id === ss.weather)?.[1] || ss.weather;
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
    { key: '', title: 'Car chosen in ACC', sub: gameCar ? `Official entry ${gameCar}` : 'Keeps the car of ACC\x27s menu', brand: '', image: '', summaryTitle: 'ACC\x27s current car', flag: placeholder('ACC') },
    ...customs.filter(c => !madeByLauncher(c.file)).map(c => ({
      key: c.file, title: c.team || c.file.replace(/\.json$/i, ''), brand: brandOf(c.model), image: siteImage('acc', 'cars', String(c.model)) || c.image,
      sub: [ACC_CARS[c.model] || `Car model #${c.model}`, c.number != null && `#${c.number}`].filter(Boolean).join(' · '),
      flag: c.image || siteImage('acc', 'cars', String(c.model)) ? '<span class="flag">Custom</span>' : logoFlag(brandOf(c.model), c.team || c.file),
    })).sort((a, b) => a.title.localeCompare(b.title)),
    ...models.map(m => {
      const image = siteImage('acc', 'cars', String(m.id));
      return { key: `model:${m.id}`, title: m.name, sub: `${accModelClass(m.id)} · plain paint`, brand: brandOf(m.id), image, flag: image ? '' : logoFlag(brandOf(m.id), m.name) };
    }),
  ];
  const cars = carEntries();
  // Track pictures from the official site, with the country's flag in the corner.
  const tracks = ACC_TRACKS.filter(t => accTrackOwned(t.id, owned)).map(t => {
    const photo = siteImage('acc', 'tracks', t.id), flag = flagUrl(t.country);
    return { key: t.id, title: t.name, sub: t.country, image: photo || flag, layouts: [],
      flag: photo && flag ? `<img class="flag-badge" src="${esc(flag)}" alt="">` : photo || flag ? '' : placeholder(t.name) };
  });

  const session = {
    summary: () => {
      const cond = `${hour(ss.time)} · ${weatherName()}`;
      const ai = racing() ? ` · ${ss.opponents} AI` : '';
      const len = { Practice: `${ss.practice} min`, Hotlap: '', Hotstint: `${ss.stint} min stint`, QuickRace: `${ss.race} min`,
        CustomRace: [ss.practice && `P ${ss.practice}'`, `Q ${ss.qualifying}'`, `R ${ss.race}'`].filter(Boolean).join(' · ') }[ss.mode];
      return { title: ACC_MODES[ss.mode], sub: [len, accSeasonName(ss.season)].filter(Boolean).join(' · ') + ai + ` · ${cond}` };
    },
    get: () => ss,
    set: d => { mergeSettings(ss, d); if (!seasons.includes(ss.season)) ss.season = seasons[0]; },
    sheetNote: 'Set in ACC\'s Single Player menu: ACC opens with these choices and you press Start.',
    sections: () => [
      { title: 'Game mode', wide: true, fields: [
        { label: 'Championship', hint: 'Season of the Single Player menu; it decides the official cars and teams. A car from another year or class may need Free selection', type: 'select', options: seasons.map(id => [id, accSeasonName(id)]), get: () => ss.season, set: v => { ss.season = v; } },
        { label: 'Mode', type: 'seg', options: Object.entries(ACC_MODES), get: () => ss.mode, set: v => { ss.mode = v; } },
      ] },
      ...(ss.mode === 'Practice' ? [{ title: 'Practice', fields: [
        { label: 'Length', type: 'select', options: minuteOptions(ss.practice, 5, 120, 5), get: () => ss.practice, set: v => { ss.practice = v; } },
      ] }] : []),
      ...(ss.mode === 'Hotlap' ? [{ title: 'Hotlap', note: 'Hotlap runs until you leave; only time and weather apply.', fields: [] }] : []),
      ...(ss.mode === 'Hotstint' ? [{ title: 'Hotstint', fields: [
        { label: 'Stint length', type: 'select', options: minuteOptions(ss.stint, 5, 60, 5), get: () => ss.stint, set: v => { ss.stint = v; } },
      ] }] : []),
      ...(ss.mode === 'QuickRace' ? [{ title: 'Race', fields: [
        { label: 'Race length', type: 'select', options: minuteOptions(ss.race, 5, 120, 5), get: () => ss.race, set: v => { ss.race = v; } },
      ] }] : []),
      ...(ss.mode === 'CustomRace' ? [{ title: 'Race weekend', fields: [
        { label: 'Practice', type: 'select', options: minuteOptions(ss.practice, 0, 120, 5, 'Skip'), get: () => ss.practice, set: v => { ss.practice = v; } },
        { label: 'Qualifying', type: 'select', options: minuteOptions(ss.qualifying, 5, 60, 5), get: () => ss.qualifying, set: v => { ss.qualifying = v; } },
        { label: 'Race', type: 'select', options: minuteOptions(ss.race, 5, 180, 5), get: () => ss.race, set: v => { ss.race = v; } },
      ] }] : []),
      ...(racing() ? [{ title: 'Opponents', fields: [
        { label: 'Opponents', hint: 'ACC caps it at the track\'s pit boxes', type: 'select', options: countOptions(ss.opponents, 1, 49), get: () => ss.opponents, set: v => { ss.opponents = v; } },
        { label: 'Starting position', type: 'select', get: () => (ss.startPos = Math.min(ss.startPos, ss.opponents + 1)), set: v => { ss.startPos = v; },
          options: steps(1, ss.opponents + 1, 1).map(n => [n, `P${n}`]) },
        { label: 'Skill', type: 'select', options: withCurrent(steps(50, 100, 1).map(n => [n, `${n}%`]), ss.skill, n => `${n}%`), get: () => ss.skill, set: v => { ss.skill = v; } },
        { label: 'Aggression', type: 'select', options: withCurrent(steps(0, 100, 5).map(n => [n, `${n}%`]), ss.aggro, n => `${n}%`), get: () => ss.aggro, set: v => { ss.aggro = v; } },
      ] }] : []),
      { title: 'Conditions', fields: [
        { label: 'Time of day', type: 'select', options: withCurrent(steps(0, 23, 1).map(h => [h, hour(h)]), ss.time, hour), get: () => ss.time, set: v => { ss.time = v; } },
        { label: 'Time speed', type: 'select', options: withCurrent(ACC_TIME_SPEEDS.map(x => [x, `${x}×`]), ss.speed, x => `${x}×`), get: () => ss.speed, set: v => { ss.speed = v; } },
        { label: 'Weather', type: 'select', options: ACC_WEATHER, get: () => ss.weather, set: v => { ss.weather = v; } },
      ] },
    ],
    onChange: () => { state.settings.accQD = { ...(state.settings.accQD || {}), session: ss }; saveSettings(); },
  };

  const pickCar = [saved.car, keyFor(fromGame.car)].find(k => k != null && cars.some(c => c.key === k)) ?? '';
  const pickTrack = [saved.track, fromGame.track].find(k => tracks.some(t => t.key === k)) || tracks[0].key;
  const ui = quickDriveModal({
    game: 'acc',
    sub: 'ACC can\'t be started straight on track, so this sets up its Single Player menu and starts the game: just press Start there.',
    session,
    launchLabel: 'Set up & start ACC',
    carCount: `${models.length} models · ${customs.filter(c => !madeByLauncher(c.file)).length} custom`,
    trackCount: `${tracks.length} tracks`,
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
        toast(`Starting ACC: ${ACC_MODES[ss.mode]} at ${tracks.find(t => t.key === s.track)?.title} is set up in Single Player.`);
      } catch (err) {
        toast(err.message || 'Could not set up ACC', true);
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
  let fromGame;
  try { fromGame = await readRallySave(state.paths); } catch (err) { toast(err.message, true); return; }
  state.settings.qdGame = 'rally';
  const saved = state.settings.rallyQD || {};
  const remembered = [...new Set([...RALLY_KNOWN_STAGES, ...(state.settings.rallyStages || []), ...fromGame.stages, fromGame.stage])].sort();
  state.settings.rallyStages = remembered;
  saveSettings();
  // Plus every stage in the game's files (rallyfiles.js): ones an update added show
  // up before they're driven. Those get "New" for a while (markFresh).
  const fileStages = await rallyGameStages(state.paths, remembered).catch(err => { log(`rally stages: ${err?.message}`); return []; });
  const seen = [...new Set([...remembered, ...fileStages])].sort();
  const stageMarks = fileStages.map(id => ({ id }));
  await markFresh('rally_stages', stageMarks);
  const newStages = new Set(stageMarks.filter(x => x.isNew).map(x => x.id));
  const tagNew = (after = false) => `<span class="flag tag-new${after ? ' after-icon' : ''}">New</span>`;
  let minutes = Math.round((saved.minutes ?? fromGame.seconds / 60) / 15) * 15 % (24 * 60);

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
      { key: id, title: pak ? pak.title : 'Default livery', sub: pak ? '.pak livery' : 'Game livery', image: pak?.image || rallyCarImage(id) },
      ...(learned[id] || []).map(l => ({ key: l, title: prettifyId(l.replace(new RegExp(`^${id}_?`), '')) || l, sub: 'Game livery', image: rallyCarImage(id) })),
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
      for (const i of twins) paired.set(i, { livery: `plates:${twins[0].meta.name}`, title, spec: i.meta.stickers ? 'plates' : 'no-plates', specLabel: i.meta.stickers ? 'With rally plates' : 'Without rally plates' });
    }
    const out = [];
    for (const i of items) {
      const p = paired.get(i);
      if (p && out.some(v => v.livery === p.livery)) continue; // added with its twin
      const twins = p ? items.filter(x => paired.get(x)?.livery === p.livery).sort((x, y) => Number(y.meta.stickers) - Number(x.meta.stickers)) : [i];
      for (const x of twins) out.push({ key: `usergen_${x.meta.name}`, title: x.title, sub: 'Your livery', image: x.image, ...paired.get(x) });
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
      byLocation.set(st.location, { key: st.location, title: st.locationName, sub: st.country, image: '', layouts: [], flagUrl: flag });
    }
    const loc = byLocation.get(st.location);
    if (!loc.image && stageImage) loc.image = stageImage;
    loc.layouts.push({ key: id, name: [st.stage, st.length].filter(Boolean).join(' · '), sub: [st.direction, st.route, newStages.has(id) && 'New'].filter(Boolean).join(' · '), preview: stageImage, outline: map });
  }
  const tracks = [...byLocation.values()].sort((a, b) => a.title.localeCompare(b.title));
  for (const t of tracks) {
    t.image ||= rallyCover(t.key);
    t.flag = t.image && t.flagUrl ? `<img class="flag-badge" src="${esc(t.flagUrl)}" alt="">` : t.image ? '' : t.flagUrl ? '' : placeholder(t.title);
    if (t.layouts.some(l => newStages.has(l.key))) t.flag += tagNew(!!(t.image && t.flagUrl));
    t.image ||= t.flagUrl;
    t.sub = `${t.sub ? `${t.sub} · ` : ''}${t.layouts.length} stage${t.layouts.length > 1 ? 's' : ''}`;
    t.layouts.sort((a, b) => a.name.localeCompare(b.name) || a.sub.localeCompare(b.sub));
  }
  const trackOf = stage => tracks.find(t => t.layouts.some(l => l.key === stage));

  const session = {
    summary: () => ({ title: 'Free Practice', sub: `Starts at ${hhmm(minutes)}` }),
    get: () => ({ minutes }),
    set: d => { if (Number.isFinite(d?.minutes)) minutes = d.minutes; },
    sheetNote: 'Set in Rally\'s Free Practice menu: Rally opens it on this stage and car.',
    sections: () => [
      { title: 'Weather & time', note: 'Rally doesn\'t take the weather or time acceleration from outside: pick them in Free Practice\'s Weather & Time screen.', fields: [
        { label: 'Event start time', type: 'select', options: timeOptions(minutes), get: () => minutes, set: v => { minutes = v; } },
      ] },
    ],
    onChange: () => { state.settings.rallyQD = { ...(state.settings.rallyQD || {}), minutes }; saveSettings(); },
  };

  const pickStage = [saved.stage, fromGame.stage].find(k => k && trackOf(k)) || tracks[0]?.layouts[0]?.key || '';
  const pickCar = [saved.car, fromGame.car].find(k => k && cars.some(c => c.key === k)) || cars[0].key;
  let bests = new Map();
  const ui = quickDriveModal({
    game: 'rally',
    sub: 'Rally can\'t be started straight on a stage, so this sets up its Free Practice menu (stage, car, livery, start time) and the main menu car, then starts the game: open Free Practice and press Start.',
    session,
    launchLabel: 'Set up & start Rally',
    specName: 'Plates',
    carCount: `${cars.length} cars`,
    trackCount: `${tracks.length} locations · ${seen.length} stages`,
    cars,
    brandLogo: name => logos.get(brandKey(name)) || '',
    variantLabel: 'Livery',
    variants: liveryVariants,
    keepCarImage: true,
    variantHint: () => "Custom liveries only apply to cars you've driven or selected in Rally at least once. Until then, the game starts with the default livery.",
    defaultVariant: liveryOf,
    tracks,
    sel: { car: pickCar, variant: liveryOf(pickCar), track: trackOf(pickStage)?.key || '', layout: pickStage },
    onClose: s => {
      state.settings.rallyQD = { car: s.car, stage: s.layout, minutes, liveries: { ...(saved.liveries || {}), [s.car]: s.variant } };
      saveSettings();
    },
    onLaunch: async s => {
      try {
        if (!s.layout) throw new Error('Drive a stage in Rally first: it shows up here afterwards.');
        // The crash check may replace this dialog; nothing is written if it's cancelled.
        if (!(await rallyPreflight(g))) return false;
        await writeRallySession(state.paths, { stage: s.layout, car: s.car, seconds: minutes * 60, livery: s.variant || s.car });
        await openExternal(steamUrls.run(g.appid));
        const st = rallyStage(s.layout);
        toast(`Starting Rally: Free Practice is set to ${st.locationName}, ${st.stage}, ${rallyCarName(s.car)}.`);
      } catch (err) {
        toast(err.message || 'Could not set up Rally', true);
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
  if (!official.some(t => t.layouts.some(l => l.practice || l.race))) { toast('No EVO tracks found. Check the EVO folder in Settings.', true); return; }
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
  const current = known.find(k => k.current);
  const currentConfig = current?.configs.find(c => c.current);
  const currentItem = current && carList.find(c => c.carId === current.carId);
  const pkgOf = c => c?.isMod ? c.path : contentPkg;
  const km = c => `${(c.length / 1000).toFixed(2)} km`;

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
    if (ext) return { label: ext.title, mech: 'Modded livery', image: ext.image };
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
      layouts: layouts.map(l => ({ key: l.id, name: l.name, sub: km(l[container()]), outline: l.outline, preview: l.preview })),
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
  const cleanup = () => sessions.forEach(discardImport);
  const problemList = problems.length ? `<ul class="imp-problems">${problems.map(p => `<li>${esc(p)}</li>`).join('')}</ul>` : '';
  if (!items.length) {
    modal(`<div class="qd imp">
      <h2>Nothing to install</h2>
      ${problemList}
      <div class="qd-sub">Supported: Assetto Corsa cars, tracks, skins, apps, CSP and PP filters · ACC liveries · EVO <code>.kspkg</code> · Rally <code>.pak</code> liveries,
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

  const { el, close } = modal(`<div class="qd imp">
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

  el.querySelector('#imp-go').onclick = async () => {
    const todo = selected();
    const unassigned = todo.find(i => i.carPick && !i.car);
    if (unassigned) { toast(`Choose the car for "${unassigned.title}"`, true); return; }
    el.querySelectorAll('button, input, select').forEach(b => { b.disabled = true; });
    el.dataset.busy = '1';
    const note = el.querySelector('#imp-note');
    const done = [], failed = [];
    for (const i of todo) {
      note.textContent = `Installing ${i.title}…`;
      try { await installItem(i); done.push(i); }
      catch (err) { log(`install ${i.title}: ${err?.stack || err?.message || JSON.stringify(err)}`); failed.push(`${i.title}: ${err?.message || 'failed'}`); }
    }
    delete el.dataset.busy;
    close();
    for (const g of new Set(done.map(i => i.game))) for (const k of Object.keys(state.cache)) if (k.startsWith(`${g}:`)) delete state.cache[k];
    if (failed.length) toast(`Could not install ${failed.join('; ')}`, true);
    else if (done.length && done.every(i => i.kind === 'pp filter')) toast(`Installed ${done.map(i => i.title).join(', ')}. Pick it in Settings → Assetto Corsa · Video.`);
    else toast(`Installed ${done.length} mod${done.length > 1 ? 's' : ''}`);
    const first = done.find(i => i.tab);
    if (first) {
      state.game = first.game; state.tab[first.game] = first.tab; state.search = ''; state.view = 'mods';
      saveSettings(); renderSidebar(); render();
    } else if (state.view === 'mods') render();
    else if (state.view === 'settings') renderSettings();
  };
}

// ---------------------------------------------------------------------------
// Community view

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

async function renderSettings() {
  const [cspGroup, videoGroup] = await Promise.all([
    cspSettingsHTML().catch(err => { log(`settings csp: ${err?.message || err}`); return ''; }),
    videoSettingsHTML().catch(err => { log(`settings video: ${err?.message || err}`); return ''; }),
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
  if (state.view !== 'settings') return;
  // Drawn again after a change: same scroll position, no fade.
  const again = $('#app').classList.contains('settings-mode') ? main.querySelector('.view.settings') : null;
  const scroll = again?.scrollTop || 0;
  $('#app').classList.add('settings-mode');
  main.innerHTML = `<div class="view scaled settings ${again ? 'still' : ''}"><div class="page">
    <h1>Settings</h1>
    <p class="lead">Folders are detected from your Steam libraries. Override any of them if you moved things around.</p>
    <div class="settings-group"><h3>Game folders</h3>${rows.join('')}</div>
    ${cspGroup}${videoGroup}
    <div class="settings-group"><h3>Game settings backups</h3>
      <p class="settings-note">Controls, graphics, audio, car setups and progress, never mods. The launcher also makes one automatically each week and keeps the last 4 automatic ones. <button class="link" data-act="open-backups">Open backups folder</button></p>
      ${backupRows.join('')}</div>
    <div class="settings-group"><h3>Behaviour</h3>
      <div class="setting"><label>Minimize when a game starts</label><div class="val"></div>
        <button class="toggle ${state.settings.minimizeOnLaunch ? 'on' : ''}" data-toggle="minimizeOnLaunch"></button></div>
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
  main.querySelector('.page').onchange = async e => {
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
  $('#app').classList.toggle('qd-mode', state.view === 'quickdrive');
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
  // The game couldn't open (it said why): stay on the page that was there.
  const now = main.querySelector('.qd-view .qd');
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
  $('#win-close').onclick = () => Neutralino.app.exit();
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
    await Neutralino.window.setDraggableRegion('titlebar', { exclude: [$('#nav'), $('.win-controls')] });
  } catch (e) { log(`drag region failed ${JSON.stringify(e)}`); }
}

Neutralino.events.on('ready', async () => {
  try {
    $('#app-version').textContent = `v${window.NL_APPVERSION || ''}`;
    await setupWindow();
    state.settings = { ...DEFAULT_SETTINGS, ...(await storageGet('settings', {})) };
    state.game = gameByKey(state.settings.lastGame) ? state.settings.lastGame : 'rally';
    renderSidebar();
    await detect();
    await loadSiteImages();
    checkOnline().then(online => {
      // Online: every game's news and the official Rally page are checked for
      // anything new, in the background (a few KB when nothing changed).
      if (online) {
        if (!state.snapshotRun) checkAppUpdate();
        for (const g of GAMES) checkNews(g.appid);
        siteSync().catch(err => log(`site sync: ${err?.message}`));
      }
      if (!online || OFFLINE_NOTICE_PREVIEW) showOfflineNotice();
    });
    const snapArg = (window.NL_ARGS || []).find(a => a.startsWith('--snapshots='));
    if (snapArg) { state.snapshotRun = true; runSnapshots(snapArg.slice('--snapshots='.length)); }
    else setTimeout(() => autoBackups(GAMES.filter(isInstalled).map(g => g.key), state.paths), 15000);
    // The display's modes take a PowerShell / xrandr call; asked early so Settings opens at once.
    if (state.paths?.ac.install) setTimeout(() => displayModes().catch(() => {}), 4000);
    const importArg = (window.NL_ARGS || []).find(a => a.startsWith('--import-test='));
    if (importArg) import('./dev-import-test.js').then(m => m.runImportTest(importArg.slice('--import-test='.length)));
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

Neutralino.events.on('windowClose', () => Neutralino.app.exit());
window.addEventListener('error', e => log(`ui error: ${e.message} @ ${e.filename}:${e.lineno}`));
window.addEventListener('unhandledrejection', e => log(`ui rejection: ${e.reason?.stack || JSON.stringify(e.reason)}`));
