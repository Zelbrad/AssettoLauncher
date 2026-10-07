// Backup and restore of each game's own settings: controls, graphics, audio,
// car setups and progress, never mods, logs, replays or crash dumps. A backup
// is a folder Documents\Assetto Launcher\Backups\<game>\<date>\ holding copies
// of the game's files at their relative paths, plus backup.json
// { at, kind: 'manual' | 'auto' | 'restore', items }. Restoring copies them back
// over the game's files (files the backup doesn't have are left alone), after a
// backup of the current state, and refuses while the game is running.
import { join, exists, listDir, log, powershell, psQuote, readText, norm, isProcessRunning, removeDirTree, IS_LINUX, sh, shQuote } from './util.js';

const up = p => p.replace(/\/[^/]+$/, '');

// root: the game's settings folder; items: what to copy (relative paths, folders
// or files); process: the game's process name.
function spec(key, paths) {
  if (key === 'ac') return { root: up(paths.ac.cfg), items: ['cfg', 'setups', 'champs', 'personalbest.ini'], process: 'acs' };
  if (key === 'acc') return { root: up(paths.acc.config), items: ['Config', 'Setups'], process: 'AC2-Win64-Shipping' };
  if (key === 'evo') return { root: up(paths.evo.profiles), exclude: /^(mods|ExternalLiveries|Logs|crashdumps|Replay|MoTec|Results)$|\.(pipelinelibrary|launcher-backup)$/i, process: 'AssettoCorsaEVO' };
  if (key === 'rally') return { root: up(up(paths.rally.save)), items: ['Config/Windows', 'SaveGames'], process: 'acr' };
  return null;
}

export const backupsRoot = async () => join(norm(await Neutralino.os.getPath('documents')), 'Assetto Launcher/Backups');

export async function isGameRunning(key, paths) {
  const s = spec(key, paths);
  if (!s) return false;
  return isProcessRunning(s.process);
}

// The items of a game that exist right now.
async function presentItems(s) {
  if (s.exclude) return (await listDir(s.root)).map(e => e.entry).filter(n => n !== '.' && n !== '..' && !s.exclude.test(n));
  const out = [];
  for (const i of s.items) if (await exists(join(s.root, i))) out.push(i);
  return out;
}

const stamp = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}-${String(d.getMinutes()).padStart(2, '0')}-${String(d.getSeconds()).padStart(2, '0')}`;

// Copy `items` from one root to another, merging into existing folders.
async function copyItems(from, to, items, intoBackup = false) {
  if (IS_LINUX) return copyItemsSh(from, to, items, intoBackup);
  const steps = [];
  for (const i of items) {
    const src = join(from, i), dst = join(to, i);
    const st = await Neutralino.filesystem.getStats(src).catch(() => null);
    if (!st) continue;
    steps.push(`New-Item -ItemType Directory -Force -Path ${psQuote(st.isDirectory ? dst : up(dst))} | Out-Null`);
    steps.push(st.isDirectory
      ? `Copy-Item -Path ${psQuote(`${src}/*`)} -Destination ${psQuote(dst)} -Recurse -Force`
      : `Copy-Item -LiteralPath ${psQuote(src)} -Destination ${psQuote(dst)} -Force`);
  }
  // The launcher's own safety copies in the game folders aren't part of a backup.
  if (intoBackup) steps.push(`Get-ChildItem -LiteralPath ${psQuote(to)} -Recurse -Filter '*.launcher-backup' -ErrorAction SilentlyContinue | Remove-Item -Force`);
  const r = await powershell(`$ErrorActionPreference='Stop'; ${steps.join('; ')}`);
  if (r.exitCode !== 0) throw new Error(r.stdErr.trim().split(/\r?\n/)[0] || 'Copy failed');
}

async function copyItemsSh(from, to, items, intoBackup) {
  const steps = [];
  for (const i of items) {
    const src = join(from, i), dst = join(to, i);
    const st = await Neutralino.filesystem.getStats(src).catch(() => null);
    if (!st) continue;
    steps.push(`mkdir -p ${shQuote(st.isDirectory ? dst : up(dst))}`);
    // "src/." copies the folder's contents, hidden files included, into dst.
    steps.push(st.isDirectory ? `cp -a ${shQuote(`${src}/.`)} ${shQuote(dst)}` : `cp -a ${shQuote(src)} ${shQuote(dst)}`);
  }
  if (intoBackup) steps.push(`find ${shQuote(to)} -name '*.launcher-backup' -type f -delete`);
  const r = await sh(`set -e; ${steps.join('; ')}`);
  if (r.exitCode !== 0) throw new Error(r.stdErr.trim().split(/\r?\n/)[0] || 'Copy failed');
}

export async function createBackup(key, paths, kind = 'manual') {
  const s = spec(key, paths);
  if (!s || !(await exists(s.root))) throw new Error('No settings found for this game yet');
  const items = await presentItems(s);
  if (!items.length) throw new Error('No settings found for this game yet');
  const at = new Date();
  const dir = join(await backupsRoot(), key, stamp(at) + (kind === 'manual' ? '' : ` ${kind}`));
  await copyItems(s.root, dir, s.exclude ? items : items.filter(i => !/\.launcher-backup$/i.test(i)), true);
  await Neutralino.filesystem.writeFile(join(dir, 'backup.json'), JSON.stringify({ at: at.getTime(), kind, items }, null, 2));
  log(`backup ${key}: ${dir}`);
  return dir;
}

// Newest first: [{ dir, at, kind, items }].
export async function listBackups(key) {
  const root = join(await backupsRoot(), key), out = [];
  for (const e of await listDir(root)) {
    if (e.type !== 'DIRECTORY' || e.entry === '.' || e.entry === '..') continue;
    try {
      const b = JSON.parse(await readText(join(root, e.entry, 'backup.json')));
      if (b?.at && Array.isArray(b.items)) out.push({ dir: join(root, e.entry), ...b });
    } catch { /* not a backup */ }
  }
  return out.sort((a, b) => b.at - a.at);
}

export async function restoreBackup(key, paths, backup) {
  if (await isGameRunning(key, paths)) throw new Error('Close the game first: it would save its settings over the restored ones.');
  const s = spec(key, paths);
  await createBackup(key, paths, 'restore').catch(err => log(`pre-restore backup: ${err?.message}`));
  await copyItems(backup.dir, s.root, backup.items);
  log(`restored ${key} from ${backup.dir}`);
}

export async function deleteBackup(backup) {
  if (!(await removeDirTree(backup.dir))) throw new Error('Could not delete the backup');
}

// A weekly automatic backup of each installed game; the last 4 automatic ones are kept.
export async function autoBackups(keys, paths) {
  for (const key of keys) {
    try {
      const list = await listBackups(key);
      if (list[0] && Date.now() - list[0].at < 7 * 864e5) continue;
      if (await isGameRunning(key, paths)) continue;
      await createBackup(key, paths, 'auto');
      for (const old of (await listBackups(key)).filter(b => b.kind === 'auto').slice(4)) await deleteBackup(old);
    } catch (err) { log(`auto backup ${key}: ${err?.message || err}`); }
  }
}
