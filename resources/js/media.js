// Screenshots and replays per game, listed on the Mods page like mods:
//   screenshots  Steam's (F12): <Steam>\userdata\<account>\760\remote\<appid>\screenshots\*.jpg
//                AC's own:     Documents\Assetto Corsa\screens
//   replays      AC:  Documents\Assetto Corsa\replay\*.acreplay
//                ACC: Documents\Assetto Corsa Competizione\Replay\Saved|Highlights\*.rpy
//                EVO: Saved Games\ACE\Replay\Saved\*.rpy
//                Rally keeps none.
// Items have kind 'screenshot' | 'replay', path = their folder, meta.file = the file.
import { join, listDir, mountDir, fileUrl, prettifyId } from './util.js';

const up = p => p.replace(/\/[^/]+$/, '');
const APPIDS = { ac: 244210, acc: 805550, evo: 3058630, rally: 3917090 };

async function steamScreenshotDirs(paths, game) {
  const root = join(paths.steam || '', 'userdata');
  const out = [];
  for (const u of await listDir(root)) {
    if (u.type !== 'DIRECTORY' || !/^\d+$/.test(u.entry)) continue;
    const dir = join(root, u.entry, `760/remote/${APPIDS[game]}/screenshots`);
    if ((await listDir(dir)).length) out.push(dir);
  }
  return out;
}

export function mediaFolders(game, paths, kind) {
  if (kind === 'replays') {
    if (game === 'ac') return [join(up(paths.ac.cfg), 'replay')];
    if (game === 'acc') return ['Saved', 'Highlights'].map(d => join(up(paths.acc.config), 'Replay', d));
    if (game === 'evo') return [join(up(paths.evo.profiles), 'Replay/Saved')];
    return [];
  }
  return game === 'ac' ? [join(up(paths.ac.cfg), 'screens')] : [];
}

const when = ms => new Date(ms).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
const size = n => n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

async function filesIn(dir, re) {
  const out = [];
  for (const e of await listDir(dir)) {
    if (e.type !== 'FILE' || !re.test(e.entry)) continue;
    const st = await Neutralino.filesystem.getStats(join(dir, e.entry)).catch(() => null);
    if (st) out.push({ dir, name: e.entry, size: st.size, at: st.modifiedAt || st.createdAt || 0 });
  }
  return out;
}

export async function scanScreenshots(game, paths) {
  const dirs = [...mediaFolders(game, paths, 'screens'), ...await steamScreenshotDirs(paths, game)];
  const items = [];
  for (const [i, dir] of dirs.entries()) {
    await mountDir(`/m/${game}-shots-${i}`, dir);
    for (const f of await filesIn(dir, /\.(jpe?g|png|bmp)$/i)) {
      const steam = /\/760\/remote\//.test(dir);
      items.push({
        id: `${dir}/${f.name}`, kind: 'screenshot', game, title: when(f.at), subtitle: `${steam ? 'Steam screenshot' : 'In-game screenshot'} · ${size(f.size)}`,
        author: '', at: f.at, image: fileUrl(join(dir, f.name)), tags: [steam ? 'Steam' : 'Game'],
        description: `File: ${f.name}\nFolder: ${dir}`,
        isMod: true, enabled: true, path: dir,
        meta: { file: join(dir, f.name), extra: steam ? [join(dir, 'thumbnails', f.name)] : [] },
      });
    }
  }
  return items.sort((a, b) => b.at - a.at);
}

// "AC_090226-175331_O_<car>_<track>" / "ACEVO_251023-223545_T_<car>_<track>": the
// session letter and the car/track part (car and track ids can't be split reliably).
const SESSIONS = { R: 'Race', Q: 'Qualifying', P: 'Practice', T: 'Time attack', O: 'Online', H: 'Hotlap' };
function replayName(name) {
  const base = name.replace(/\.(acreplay|rpy)$/i, '');
  const m = /^(?:AC|ACC|ACEVO)_\d{6}-\d{6}_([A-Z])_(.+)$/.exec(base);
  return m ? { title: prettifyId(m[2]), session: SESSIONS[m[1]] || '' } : { title: prettifyId(base.replace(/_\d{6}-\d{6}$/, '')), session: '' };
}

export async function scanReplays(game, paths) {
  const items = [];
  for (const [i, dir] of mediaFolders(game, paths, 'replays').entries()) {
    await mountDir(`/m/${game}-replays-${i}`, dir);
    for (const f of await filesIn(dir, /\.(acreplay|rpy)$/i)) {
      const n = replayName(f.name), highlight = /highlights/i.test(dir);
      items.push({
        id: `${dir}/${f.name}`, kind: 'replay', game, title: n.title,
        subtitle: [n.session || (highlight ? 'Highlights' : 'Replay'), when(f.at), size(f.size)].join(' · '),
        author: '', at: f.at, image: '', fallbackImage: '/img/replay.png', tags: [highlight ? 'Highlights' : 'Replay'],
        description: `Load it from the game's replay menu.\nFile: ${f.name}\nFolder: ${dir}`,
        isMod: true, enabled: true, path: dir, meta: { file: join(dir, f.name), extra: [] },
      });
    }
  }
  return items.sort((a, b) => b.at - a.at);
}
