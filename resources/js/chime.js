// The notification sound for the Academy's result card: sounds/academy-card.mp3
// ("New Notification 014" by Universfield, Pixabay; see sounds/CREDITS.txt),
// fetched and decoded once, then played through Web Audio.
//
// It plays from the launcher's window: the web view only lets a page make sound
// after a click in it, and an Academy event is always started with one (the
// small card window over the game never gets a click).

const SOUND = '/sounds/academy-card.mp3';

let ctx = null, buffer = null;

// The audio context, made (or woken) now, and the sound loaded: call it from a click.
export function primeChime() {
  try {
    ctx ||= new AudioContext();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    buffer ||= fetch(SOUND).then(r => r.arrayBuffer()).then(b => ctx.decodeAudioData(b)).catch(() => (buffer = null)); // tried again next time
  } catch { ctx = null; }
  return ctx?.state || 'none';
}

// Returns the audio context's state: "running" when it played ("suspended": the
// page wasn't allowed sound yet; its resume() would wait for a click forever, so
// it's given 300 ms). The file is quiet (peaks at -10 dB): the default volume
// brings it up to about -2 dB, to be heard over the game.
export async function playChime(volume = 2.5) {
  primeChime();
  if (!ctx) return 'none';
  if (ctx.state === 'suspended') await Promise.race([ctx.resume().catch(() => {}), new Promise(r => setTimeout(r, 300))]);
  if (ctx.state !== 'running') return ctx.state;
  const sound = await buffer;
  if (!sound) return 'no sound file';
  const src = ctx.createBufferSource(), out = ctx.createGain();
  src.buffer = sound;
  out.gain.value = volume;
  src.connect(out); out.connect(ctx.destination);
  src.onended = () => out.disconnect();
  src.start();
  return ctx.state;
}
