// The Academy's result card over EVO (overlay.html): a small window of its own
// process, started hidden and always on top by the launcher when an EVO event
// starts (main.js academyWatch). The launcher writes what to do to a small JSON file
// (util.js overlayFile), which this window reads every 100 ms:
//   { n, at, show: { kicker, title, tier, time, sub }, seconds }
//                         show the card, hide it after `seconds` (or on a click)
//   { n, at, beat: true } the launcher is still there (every few seconds)
//   { n, at, quit: true } EVO closed: the window goes
//   snap: path            --check-academy: a picture of the card, then hidden
// Every message carries the sprint's `sid`: a window left from an earlier one goes
// when it sees another. With no word from the launcher for a while (it was
// closed), it goes on its own.
// The card itself (markup, slide in and out) is js/overlay-card.js; its look,
// css/overlay.css. The window is transparent: at the top centre of the screen,
// from the top edge down to the banner (?top=: how far down it sits, in pixels),
// so the banner slides down from above the screen.
// It's shown once, empty, when it starts (before the game's window is up): showing
// a window takes the focus, which must not happen to the game mid-lap. Between
// cards it waits off the screen (so it doesn't catch clicks over the game); a card
// moves it into place and slides in.
// ?side=right: the safety rating's window, on the right edge half way down, with
// its own file.
import { overlayFile, readText, log } from './util.js';

const POLL_MS = 100, QUIET_MS = 60000, AWAY = -32000;
const query = new URLSearchParams(location.search), root = document.getElementById('root'), side = query.get('side') || '';
let file = '', sid = 0, last = -1, heard = Date.now(), hideTimer = 0, busy = false, card = null, spot = { x: 0, y: 0 };

async function show(msg) {
  clearTimeout(hideTimer);
  const seconds = msg.seconds || 8;
  card = OverlayCard.render(root, msg.show, seconds);
  await Neutralino.window.move(spot.x, spot.y).catch(() => {});
  OverlayCard.enter(card);
  if (msg.snap) {
    await new Promise(r => setTimeout(r, 1200)); // slid in, chevrons lit
    await Neutralino.window.snapshot(msg.snap).catch(err => log(`overlay snapshot: ${err?.message || err}`));
  }
  hideTimer = setTimeout(hide, seconds * 1000);
}

async function hide() {
  clearTimeout(hideTimer);
  if (!card) return;
  await OverlayCard.leave(card);
  if (!card.classList.contains('in')) Neutralino.window.move(AWAY, AWAY).catch(() => {}); // unless another came meanwhile
}

async function poll() {
  if (busy) return;
  busy = true;
  try {
    const msg = JSON.parse((await readText(file)) || 'null');
    if (msg && (msg.sid !== sid || msg.n !== last)) {
      if (sid && msg.sid !== sid) return Neutralino.app.exit();
      sid = msg.sid; last = msg.n;
      heard = Date.now();
      if (msg.quit) return Neutralino.app.exit();
      if (msg.show) await show(msg);
    }
    if (Date.now() - heard > QUIET_MS) Neutralino.app.exit();
  } catch (err) {
    log(`overlay: ${err?.message || err}`);
  } finally {
    busy = false;
  }
}

Neutralino.init();
Neutralino.events.on('windowClose', () => Neutralino.app.exit());
Neutralino.events.on('ready', async () => {
  file = await overlayFile(side);
  // Where it goes, in the window's own units (k of them to a CSS pixel).
  const size = await Neutralino.window.getSize().catch(() => null) || { width: innerWidth, height: innerHeight };
  const k = size.width / innerWidth || 1;
  if (side === 'right') {
    document.body.classList.add('right');
    spot = { x: Math.round(screen.width * k - size.width), y: Math.round((screen.height * k - size.height) / 2) };
  } else {
    const top = Math.max(0, Math.min(Number(query.get('top')) || 0, innerHeight - 130));
    document.documentElement.style.setProperty('--top', `${top}px`);
    spot = { x: Math.round((screen.width * k - size.width) / 2), y: 0 };
  }
  // Shown now while there's nothing in it, off the screen until a card comes.
  await Neutralino.window.move(AWAY, AWAY).catch(() => {});
  await Neutralino.window.show().catch(() => {});
  await Neutralino.window.setAlwaysOnTop(true).catch(() => {});
  document.addEventListener('click', hide);
  document.addEventListener('visibilitychange', () => log(`overlay page ${document.visibilityState}`));
  // The poll's clock runs in a worker: the web view slows a hidden page's own
  // timers (down to once a minute after a while), not a worker's.
  const tick = new Worker(URL.createObjectURL(new Blob([`setInterval(() => postMessage(0), ${POLL_MS});`], { type: 'text/javascript' })));
  tick.onmessage = poll;
});
