import { GAMES, gameByKey, resolvePaths, SCANNERS, setEnabled, contentFolder, evoCacheDir, uninstallPaths, uninstallItem, rallyIncompatible, ACC_CARS, RALLY_CARS, rallyCarName, rallyCarIds, appCacheDir } from './games.js';
import { ACC_TRACKS, ACC_MODES, ACC_WEATHER, ACC_TIME_SPEEDS, accSeasonName, accOwnedDlcs, accModelOwned, accTrackOwned, accSeasonOwned, accModelClass, readAccSession, accCustomCars, writeAccSession, ensureModelCar } from './acclaunch.js';
import { readRallySave, rallyStage, writeRallySession, rallyBests, RALLY_KNOWN_STAGES, rallyCover, rallySelectedLiveries } from './rallylaunch.js';
import { SITE_PAGES, siteCars, siteMaps, rallyStagePhotos, imageSizes, bestMatch, stageGroupOf, words } from './sitecatalog.js';
import { acBests, acBestKey, evoBests, evoBestKey, lapTime } from './bests.js';
import { checkMods } from './health.js';
import { acUpdates, cupDetails } from './updates.js';
import { listBackups, createBackup, restoreBackup, deleteBackup, autoBackups, backupsRoot } from './backups.js';
import { findSteamPath, findInstalledApps, getNews, cachedNews, refreshNews, getStoreDetails, steamUrls, appBuilds } from './steam.js';
import { quickDrive, readAcSession, defaultAcSession, acWeathers, roadTemperature, AC_MODES, AC_GRIP } from './quickdrive.js';
import { knownCars, launchEvo, readEvoSession, defaultEvoSession, EVO_MODES, EVO_WEATHER, EVO_GRIP, EVO_TIME_SPEEDS } from './evolaunch.js';
import { IMPORT_RE, resolveDropped, prepareImport, installItem, setItemCar, carChoices, discardImport } from './installer.js';
import { readEvoExtras, isLazyImage, lazyImage } from './kspkg.js';
import { esc, timeAgo, openExternal, openFolder, storageGet, storageSet, norm, log, exists, basename, prettifyId, fileUrl, listDir, join, run, powershellEncoded } from './util.js';

Neutralino.init();

const DEFAULT_SETTINGS = { overrides: {}, minimizeOnLaunch: true, lastGame: 'rally', acFilter: 'mods' };

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
async function syncMaximized() {
  try { document.body.classList.toggle('maximized', await Neutralino.window.isMaximized()); } catch { /* not ready */ }
}

// Windows 11 rounds the corners of normal windows but not of borderless ones
// unless asked: DWMWA_WINDOW_CORNER_PREFERENCE (33) = DWMWCP_ROUNDSMALL (3), a
// ~4-5 px radius that keeps the window's shadow (not rounded while maximized).
// Older Windows ignores it.
async function roundCorners() {
  if (!window.NL_PID) return;
  const r = await powershellEncoded(`Add-Type -Namespace W -Name D -MemberDefinition '[DllImport("dwmapi.dll")] public static extern int DwmSetWindowAttribute(IntPtr h, int a, ref int v, int s);'
$h = (Get-Process -Id ${window.NL_PID}).MainWindowHandle; $v = 3
[W.D]::DwmSetWindowAttribute($h, 33, [ref]$v, 4)`).catch(err => ({ stdOut: '', stdErr: String(err?.message || err) }));
  log(`round corners: ${(r.stdOut || r.stdErr || '').trim()}`);
}

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
    : item.game === 'ac' && content ? '<span class="flag">Mod</span>' : '';
  const num = item.kind === 'replay' ? '' : item.number != null ? `<div class="placeholder">#${esc(item.number)}</div>` : `<div class="placeholder">${initials(item.title)}</div>`;
  return `<button class="card ${item.enabled ? '' : 'disabled'}" data-idx="${idx}">
    <div class="thumb ${item.kind === 'replay' ? 'icon' : ''}">
      ${num}
      ${imgTag(item.image, item.fallbackImage)}
      ${item.overlay ? `<img class="overlay" src="${esc(item.overlay)}" loading="lazy" onerror="this.remove()" alt="">` : ''}
      ${item.badge && item.image ? `<img class="badge" src="${esc(item.badge)}" loading="lazy" onerror="this.remove()" alt="">` : ''}
      ${flag}
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
//   o.variants(carKey) -> [{ key, title, sub, image }]   (liveries / skins)
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
    if (s) btn.innerHTML = `<span class="qd-session-gear">⚙</span><span class="qd-session-text"><b>${esc(s.title)}</b><small>${esc(s.sub)}</small></span><span class="qd-session-edit">Session settings</span>`;
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
    const variants = o.variants(sel.car) || [];
    // Keep the row's scroll position while picking within the same car.
    const keepX = stripCar === sel.car ? el.querySelector('.qd-variant-strip')?.scrollLeft || 0 : 0;
    stripCar = sel.car;
    const hint = o.variantHint?.(sel.car);
    el.querySelector('#qd-variants').innerHTML = variants.length || hint
      ? `<span class="qd-layouts-name">${esc(o.variantLabel)}</span><div class="qd-variant-strip">${variants.map(x => `<button class="qd-variant ${x.key === sel.variant ? 'active' : ''}" data-variant="${esc(x.key)}" title="${esc([x.title, x.sub].filter(Boolean).join(' · '))}">
          <div class="thumb">${imgTag(x.image, '')}</div><span>${esc(x.title)}${x.sub ? `<small>${esc(x.sub)}</small>` : ''}</span></button>`).join('')}</div>
          ${hint ? `<span class="qd-variant-hint" title="${esc(hint)}">ⓘ</span>` : ''}`
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
      <div><b>${esc(c?.summaryTitle || c?.title || '')}</b><small>${esc(v ? v.title : c?.sub || '')}</small></div>
      <div class="qd-sum-img">${imgTag(layout?.preview || t?.image, '')}</div>
      <div><b>${esc(t?.title || '')}</b><small>${esc([layout?.name, layout?.sub].filter(Boolean).join(' · '))}</small></div>
      ${pb ? `<div class="qd-pb" title="Your personal best with this car here, as recorded by the game"><small>Your best</small><b>${esc(lapTime(pb.ms))}</b><span>${esc(pb.at ? timeAgo(pb.at / 1000) : '')}</span></div>` : ''}
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
    const b = e.target.closest('[data-variant]');
    if (b) { sel.variant = b.dataset.variant; sync(); }
  };
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
    const v = (o.variants(s.car) || []).find(x => x.key === s.variant);
    return { car: c?.summaryTitle || c?.title || '', variant: v?.title || '', track: [t?.title, l?.name].filter(Boolean).join(' · '), session: o.session?.summary()?.title || '' };
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
//   [{ title, note?, wide?, fields: [{ label, hint?, type: 'seg'|'select', options: [[value, label]], get(), set(value) }] }]
// and is rebuilt after every change, so fields can depend on each other.
function openSessionSheet(host, session, getSel, onChange) {
  host.querySelector('.qd-sheet-wrap')?.remove();
  const wrap = document.createElement('div');
  wrap.className = 'qd-sheet-wrap';
  host.appendChild(wrap);
  let fields = [];
  const fieldHTML = (f, i) => {
    const k = f.options.findIndex(([v]) => v === f.get());
    const control = f.type === 'seg'
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
  const res = await run(`curl.exe -s -i -L --compressed --max-time 20 -A "Mozilla/5.0" ${since} "${SITE_PAGES.rally}"`);
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
  const ids = Object.keys(RALLY_CARS).map(k => ({ key: k, name: `${RALLY_CARS[k].name} ${k}` }));
  // Stages: known ones by name; stages added later by the save's stage ids
  // ("PortugalS1Arganil..." matches a caption naming Arganil).
  const groups = [...new Set((state.settings.rallyStages || []).map(id => rallyStage(id).group).filter(Boolean))];
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
      const r = await run(`curl.exe -s -L -f --max-time 30 -o "${join(dir, file)}" "${url}"`);
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
const flagUrl = country => FLAGS[country] ? `/img/flags/${FLAGS[country]}.png` : '';

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
  const seen = [...new Set([...RALLY_KNOWN_STAGES, ...(state.settings.rallyStages || []), ...fromGame.stages, fromGame.stage])].sort();
  state.settings.rallyStages = seen;
  saveSettings();
  let minutes = Math.round((saved.minutes ?? fromGame.seconds / 60) / 15) * 15 % (24 * 60);

  const placeholder = title => `<div class="placeholder">${esc(initials(title))}</div>`;
  const logos = new Map();
  const brandOf = id => { const n = rallyCarName(id); return /^Alfa Romeo/.test(n) ? 'Alfa Romeo' : n.split(' ')[0]; };
  const logoFlag = (brand, title) => logos.get(brandKey(brand)) ? `<img class="main contain" src="${esc(logos.get(brandKey(brand)))}" alt="">` : placeholder(title);
  const carIds = await rallyCarIds(state.paths).catch(() => Object.keys(RALLY_CARS));
  const carEntries = () => carIds.map(id => {
    const image = rallyCarImage(id);
    return { key: id, title: rallyCarName(id), sub: brandOf(id), brand: brandOf(id), image, flag: image ? '' : logoFlag(brandOf(id), rallyCarName(id)) };
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
      ...modLiveries.filter(i => i.toggle === 'rally-folder' && i.enabled && i.meta.car === id)
        .map(i => ({ key: `usergen_${i.meta.name}`, title: i.title, sub: 'Your livery', image: i.image })),
    ];
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
    loc.layouts.push({ key: id, name: [st.stage, st.length].filter(Boolean).join(' · '), sub: [st.direction, st.route].filter(Boolean).join(' · '), preview: stageImage, outline: map });
  }
  const tracks = [...byLocation.values()].sort((a, b) => a.title.localeCompare(b.title));
  for (const t of tracks) {
    t.image ||= rallyCover(t.key);
    t.flag = t.image && t.flagUrl ? `<img class="flag-badge" src="${esc(t.flagUrl)}" alt="">` : t.image ? '' : t.flagUrl ? '' : placeholder(t.title);
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
    carCount: `${cars.length} cars`,
    trackCount: `${tracks.length} locations · ${seen.length} stages`,
    cars,
    brandLogo: name => logos.get(brandKey(name)) || '',
    variantLabel: 'Livery',
    variants: liveryVariants,
    keepCarImage: true,
    variantHint: () => 'Your own liveries come from Documents\\My Games\\acr\\Liveries. The game\'s other liveries show up here once you\'ve picked them in Rally.',
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
// and liveries are limited to configurations EVO has already used (see
// evolaunch.js); their thumbnails and names come from the game package
// (readEvoExtras). The selection is remembered even when the dialog is closed
// without launching.

async function openEvoQuickDrive({ car, track } = {}) {
  const g = gameByKey('evo');
  const cacheDir = await evoCacheDir().catch(() => '');
  const [cars, tracks, known, fromGame, external] = await Promise.all([
    getItems(g, 'cars'), getItems(g, 'tracks'),
    knownCars(cacheDir).catch(err => { log(`known cars: ${err?.message}`); return []; }),
    readEvoSession().catch(err => { log(`evo session: ${err?.message}`); return defaultEvoSession(); }),
    getItems(g, 'liveries').catch(() => []),
  ]);
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

  // Every car is listed; the ones EVO has an ID for ("ready") come first, most recently driven on top.
  const knownBy = new Map(known.map(k => [k.carId, k]));
  const rank = c => { const k = knownBy.get(c.carId); return k ? known.indexOf(k) : Infinity; };
  const carList = cars.filter(c => c.carId).sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title));
  const current = known.find(k => k.current);
  const currentConfig = current?.configs.find(c => c.current);
  const currentItem = current && carList.find(c => c.carId === current.carId);
  const contentPkg = state.paths.evo.install ? `${state.paths.evo.install}/content.kspkg` : '';
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
  const variants = carId => {
    const k = knownBy.get(carId), item = carList.find(c => c.carId === carId);
    return (k?.configs || []).map((cfg, i) => {
      const x = thumb(carId, cfg);
      return {
        key: cfg.guid,
        title: x?.label || (cfg.visual ? prettifyId(cfg.visual.replace(/^preset_/, '')) : i ? `Livery ${i + 1}` : 'Last used livery'),
        sub: [x?.mech, cfg.current && 'current'].filter(Boolean).join(' · '),
        image: x?.image || item?.image,
      };
    });
  };

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
        flag: !k ? '<span class="flag off">Not used yet</span>' : k.configs.length > 1 ? `<span class="flag kunos">${k.configs.length} liveries</span>` : '',
      };
    }),
  ];
  // Practice uses each layout's Time Attack version, the races its Race version.
  const trackEntries = () => official.map(t => {
    const layouts = t.layouts.filter(l => l[container()]);
    return {
      key: t.id, title: t.title, sub: t.subtitle, image: t.image,
      flag: `<span class="flag kunos">${layouts.length} layout${layouts.length > 1 ? 's' : ''}</span>`,
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
    variantHint: carKey => carKey ? 'Only liveries you have picked in EVO are listed. Pick another one once in EVO and it shows up here.' : '',
    defaultVariant: carKey => knownBy.get(carKey)?.configs[0]?.guid || '',
    tracks: trackEntries(),
    sel: { car: '', variant: '', track: '', layout: '' },
    onLocked: c => toast(`${c.title}: pick it once in EVO's car menu, then it can be pre-selected here.`, true),
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

  const ui = quickDriveModal(opts);
  if (car && !knownBy.has(car.carId)) opts.onLocked(car);

  // Background: livery thumbnails/names for every known configuration + brand logos.
  const liveries = known.flatMap(k => {
    const item = carList.find(c => c.carId === k.carId);
    return item ? k.configs.filter(c => c.visual).map(c => ({ carId: k.carId, mech: c.mech, visual: c.visual, pkgPath: pkgOf(item) })) : [];
  });
  const brands = [...new Set(carList.map(c => c.brand).filter(Boolean))];
  readEvoExtras({ liveries, brands, contentPkg }, cacheDir).then(x => {
    extras = x;
    if (!ui.el.isConnected) return;
    opts.cars = carEntries();
    ui.redraw();
  }).catch(err => log(`evo extras: ${err?.stack || err?.message || err}`));
}

// ---------------------------------------------------------------------------
// Quick drive (AC): car, skin, track and session (mode, AI opponents, time,
// weather, temperatures, grip) written to race.ini, then acs.exe. The selection
// and session are remembered even when the dialog is closed without driving.

async function openQuickDrive({ car, skin, track } = {}) {
  const g = gameByKey('ac');
  const [cars, allTracks, weathers, fromGame] = await Promise.all([
    getItems(g, 'cars'), getItems(g, 'tracks'),
    acWeathers(state.paths).catch(() => []),
    readAcSession(state.paths).catch(() => defaultAcSession()),
  ]);
  // Tracks without models (unowned DLC placeholders) can't be loaded.
  const tracks = allTracks.filter(t => t.playable !== false);
  if (!cars.length || !tracks.length) { toast('No Assetto Corsa cars or tracks found. Check the folder in Settings.', true); return; }
  state.settings.qdGame = 'ac';
  const findCar = id => cars.find(c => c.id === id);
  const findTrack = id => tracks.find(t => t.id === id);
  // Brand logos: the badge of the first car of each brand.
  const badges = new Map();
  for (const c of cars) if (c.brand && c.badge && !badges.has(c.brand)) badges.set(c.brand, c.badge);

  const ss = mergeSettings(fromGame, state.settings.acSession);
  if (weathers.length && !weathers.some(w => w.id === ss.weather)) ss.weather = weathers.find(w => w.id === '3_clear')?.id || weathers[0].id;
  const racing = () => ss.mode === 'race' || ss.mode === 'weekend';
  const weather = () => weathers.find(w => w.id === ss.weather);
  const layoutOf = s => findTrack(s.track)?.layouts.find(l => l.id === s.layout);
  const maxOpponents = s => Math.max(1, Math.min(Number(layoutOf(s)?.pitboxes) || 20, 63) - 1);
  const roadNow = () => roadTemperature(ss.time, ss.air, weather()?.coeff);

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
      const cond = `${hhmm(ss.time)} · ${weather()?.name || ss.weather} · ${ss.air} °C`;
      if (ss.mode === 'practice') return { title: 'Practice', sub: `${ss.practice.minutes ? `${ss.practice.minutes} min` : 'Unlimited'} · ${cond}` };
      if (ss.mode === 'hotlap') return { title: 'Hotlap', sub: cond };
      if (ss.mode === 'race') return { title: 'Race', sub: `${ss.race.laps} laps · ${ss.ai.count} AI · ${cond}` };
      const wk = ss.weekend;
      return { title: 'Race Weekend', sub: [wk.practice && `P ${wk.practice}'`, `Q ${wk.qualifying}'`, `R ${wk.laps} laps`, `${ss.ai.count} AI`, cond].filter(Boolean).join(' · ') };
    },
    get: () => ss,
    set: d => {
      mergeSettings(ss, d);
      if (weathers.length && !weathers.some(w => w.id === ss.weather)) ss.weather = weathers.find(w => w.id === '3_clear')?.id || weathers[0].id;
    },
    sheetNote: 'Written to race.ini when you drive. Assists and CSP settings are left as they are.',
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
          title: 'Conditions', fields: [
            { label: 'Time of day', type: 'select', options: timeOptions(ss.time, 8 * 60, 18 * 60), get: () => ss.time, set: v => { ss.time = v; } },
            { label: 'Time speed', type: 'select', options: withCurrent([1, 2, 4, 8, 16, 30, 60].map(x => [x, `${x}×`]), ss.speed, x => `${x}×`), get: () => ss.speed, set: v => { ss.speed = v; } },
            { label: 'Weather', type: 'select', options: weathers.length ? weathers.map(w => [w.id, w.name]) : [[ss.weather, ss.weather]], get: () => ss.weather, set: v => { ss.weather = v; } },
            { label: 'Air temperature', type: 'select', options: withCurrent(steps(10, 36, 1).map(n => [n, `${n} °C`]), ss.air, n => `${n} °C`), get: () => ss.air, set: v => { ss.air = v; } },
            { label: 'Track temperature', hint: 'Auto uses the formula of AC\'s launcher (air, time, weather)', type: 'select', get: () => ss.road, set: v => { ss.road = v; },
              options: [['auto', `Auto · ${roadNow()} °C`], ...steps(10, 60, 1).map(n => [n, `${n} °C`])] },
            { label: 'Track grip', type: 'select', options: AC_GRIP.map(x => [x.id, x.label]), get: () => ss.grip, set: v => { ss.grip = v; } },
            { label: 'Penalties', type: 'seg', options: [[true, 'On'], [false, 'Off']], get: () => ss.penalties, set: v => { ss.penalties = v; } },
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
    sub: 'Starts Assetto Corsa directly with the session below. Assists and CSP settings stay as they are.',
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
          track: s.track, layout: s.layout, session: ss, maxOpponents: maxOpponents(s), weatherCoeff: weather()?.coeff,
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

const KIND_LABEL = { car: 'Car', track: 'Track', skin: 'Skin', extras: 'Extras', livery: 'Livery', 'car file': 'Car file' };

async function openInstallReview(items, problems, sessions) {
  const cleanup = () => sessions.forEach(discardImport);
  const problemList = problems.length ? `<ul class="imp-problems">${problems.map(p => `<li>${esc(p)}</li>`).join('')}</ul>` : '';
  if (!items.length) {
    modal(`<div class="qd imp">
      <h2>Nothing to install</h2>
      ${problemList}
      <div class="qd-sub">Supported: Assetto Corsa cars, tracks, skins, apps and CSP · ACC liveries · EVO <code>.kspkg</code> · Rally <code>.pak</code> liveries,
      as files or inside <code>.zip</code>, <code>.rar</code> and <code>.7z</code> archives.</div>
    </div>`, 'modal imp-modal', cleanup);
    return;
  }

  const choices = {};
  for (const kind of new Set(items.map(i => i.carPick).filter(Boolean))) {
    choices[kind] = await carChoices(kind, state.paths, kind === 'ac' ? await getItems(gameByKey('ac'), 'cars').catch(() => []) : []);
  }
  const gameName = key => { const g = gameByKey(key); return `${g.title} ${g.sub || ''}`.trim(); };
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
        ${choices[i.carPick].map(c => `<option value="${esc(c.id)}" ${c.id === i.car ? 'selected' : ''}>${esc(c.title)}${i.carPick === 'ac' ? ` (${esc(c.id)})` : ''}</option>`).join('')}</select>` : ''}
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
    else toast(`Installed ${done.length} mod${done.length > 1 ? 's' : ''}`);
    const first = done.find(i => i.tab);
    if (first) {
      state.game = first.game; state.tab[first.game] = first.tab; state.search = ''; state.view = 'mods';
      saveSettings(); renderSidebar(); render();
    } else if (state.view === 'mods') render();
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

async function renderSettings() {
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
  main.innerHTML = `<div class="view scaled"><div class="page">
    <h1>Settings</h1>
    <p class="lead">Folders are detected from your Steam libraries. Override any of them if you moved things around.</p>
    <div class="settings-group"><h3>Game folders</h3>${rows.join('')}</div>
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
      <div class="setting"><label>Version</label><div class="val">${esc(window.NL_APPVERSION || '')} · Neutralino ${esc(window.NL_VERSION || '')}</div><div></div></div>
      <div class="setting"><label>Source code</label><div class="val">Open source (MIT). Feedback and ideas are welcome.</div><div class="btns"><button class="btn small subtle" data-url="${REPO_URL}">GitHub ↗</button></div></div>
      <div class="setting"><label>Support</label><div class="val">The launcher is free. If you'd like to support it, you can buy me a coffee.</div><div class="btns"><button class="btn small primary" data-url="${KOFI_URL}">Support on Ko-fi ↗</button></div></div>
    </div>
  </div></div>`;

  main.querySelector('.page').onclick = async e => {
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
    }
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
  state.paths = await resolvePaths(state.installed, state.settings.overrides);
  state.paths.steam = state.steamPath; // Steam screenshots (media.js)
  state.cache = {};
  renderSidebar();
  render();
}

// ---------------------------------------------------------------------------
// Routing / boot

// Navbar highlight, and the game sidebar hidden on the Quick Drive page.
function syncChrome() {
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('active', b.dataset.view === state.view));
  $('#app').classList.toggle('qd-mode', state.view === 'quickdrive');
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
  const r = await run('curl.exe -s -I --max-time 6 -o NUL -w "%{http_code}" https://store.steampowered.com/');
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

// Snapshot runs click through dialogs; they mustn't change the user's settings.
function saveSettings() { if (!state.snapshotRun) storageSet('settings', state.settings); }

async function detect() {
  state.steamPath = await findSteamPath();
  state.installed = await findInstalledApps(state.steamPath);
  state.paths = await resolvePaths(state.installed, state.settings.overrides);
  state.paths.steam = state.steamPath; // Steam screenshots (media.js)
  state.cache = {};
  checkGameUpdates();
  renderSidebar();
  render();
}

// Scale the 1920x991 design canvas to the window. The canvas keeps Figma pixel
// sizes; extra width or height in the window becomes extra canvas space.
// The UI is laid out on the 1920x991 design canvas, zoomed to fit the startup
// window. A bigger window (maximized or resized) keeps that zoom and gets more
// room instead: the navbar, sidebar, buttons and news cards stay the same size,
// the hero image grows and the mod grids get more columns. Smaller windows zoom out.
const DESIGN_W = 1920, DESIGN_H = 991;
let baseZoom = 0;
function fitToWindow() {
  const fit = Math.min(innerWidth / DESIGN_W, innerHeight / DESIGN_H);
  if (!baseZoom && fit > 0.3) baseZoom = fit;
  const z = Math.min(fit, baseZoom || fit);
  document.body.style.zoom = z;
  // The home page's logo and text grow with the extra room (a little less than it).
  const grow = Math.min(innerWidth / z / DESIGN_W, innerHeight / z / DESIGN_H);
  document.documentElement.style.setProperty('--hero-scale', (1 + Math.max(0, grow - 1) * 0.75).toFixed(3));
  const root = document.documentElement.style;
  root.setProperty('--app-w', `${innerWidth / z}px`);
  root.setProperty('--app-h', `${innerHeight / z}px`);
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
  syncMaximized();
  window.addEventListener('resize', syncMaximized);
  roundCorners();
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
        for (const g of GAMES) checkNews(g.appid);
        siteSync().catch(err => log(`site sync: ${err?.message}`));
      }
      if (!online || OFFLINE_NOTICE_PREVIEW) showOfflineNotice();
    });
    const snapArg = (window.NL_ARGS || []).find(a => a.startsWith('--snapshots='));
    if (snapArg) { state.snapshotRun = true; runSnapshots(snapArg.slice('--snapshots='.length)); }
    else setTimeout(() => autoBackups(GAMES.filter(isInstalled).map(g => g.key), state.paths), 15000);
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
  // --check8: site pictures (Rally, ACC), all Rally stages, Rally liveries, replay icon, offline note.
  if ((window.NL_ARGS || []).includes('--check8')) {
    showOfflineNotice();
    state.game = 'rally'; renderSidebar(); state.view = 'quickdrive'; render(); await wait(4000);
    $('#main [data-car="LanciaStratosHF"]')?.click(); await wait(300);
    [...document.querySelectorAll('#qd-tracks [data-track]')].find(b => b.dataset.track === 'Greece')?.click();
    await snap('check8-rally');
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
