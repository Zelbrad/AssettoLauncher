// Assetto Corsa's post-processing filters: system/cfg/ppfilters/<name>.ini, the
// one in use picked by video.ini [POST_PROCESS] FILTER. A filter can ship a script
// next to it (<name>.lua, or a <name> / <name>_scripts folder); it goes with the
// filter. Replacing or uninstalling a filter first copies it to
// Documents\Assetto Launcher\Backups\ac\ppfilters\<date> <name>\ (filter.json
// { id, at, files }), so it can be put back; the last 3 of each filter are kept.
import { join, readTextAnyEncoding, exists, listDir, ensureDir, isProcessRunning, removeDirTree, log } from './util.js';
import { parseIni } from './ini.js';
import { backupsRoot } from './backups.js';
import { readVideoIni, writeVideo } from './acvideo.js';

// The filters that come with AC.
export const KUNOS_FILTERS = new Set(['b&w', 'blue_steel', 'default', 'default_bright', 'default_dark', 'movie', 'natural', 'photographic', 'sepia', 'vintage']);
const KEEP_BACKUPS = 3;

const stem = f => f.replace(/\.[^.]+$/, '');
const filterDir = paths => join(paths.ac.install, 'system/cfg/ppfilters');
const backupDir = async () => join(await backupsRoot(), 'ac/ppfilters');

// A filter's .ini has AC's post-processing sections; other .ini files (readmes,
// app settings) don't.
const PP_SECTIONS = /^(YEBIS|TONEMAPPING|COLOR|DOF|GODRAYS|AUTO_EXPOSURE|GLARE|VIGNETTING|CHROMATIC_ABERRATION|HEAT_SHIMMER|LENSDISTORTION|DIAPHRAGM|AIRYDISC|FEEDBACK|ANTIALIAS|EXT_.+)$/;
export function isPpFilterIni(text) {
  const sections = new Set([...String(text || '').matchAll(/^\s*\[([A-Za-z_]+)\]/gm)].map(m => m[1].toUpperCase()));
  return (sections.has('YEBIS') || sections.has('TONEMAPPING')) && [...sections].filter(s => PP_SECTIONS.test(s)).length >= 2;
}

// The [ABOUT] of a filter's .ini: { author, version }.
export const ppFilterAbout = text => {
  const a = parseIni(text || '').ABOUT || {};
  return { author: a.AUTHOR || '', version: a.VERSION || '' };
};

// The entries next to a filter's .ini that belong to it (names in `entries`).
export function ppFilterCompanions(entries, id, { dirs = true } = {}) {
  const lid = id.toLowerCase();
  return entries.filter(e => e.entry !== '.' && e.entry !== '..' && (e.type === 'DIRECTORY'
    ? dirs && [lid, `${lid}_scripts`].includes(e.entry.toLowerCase())
    : !/\.ini$/i.test(e.entry) && stem(e.entry).toLowerCase() === lid)).map(e => e.entry);
}

async function filterFiles(paths, id) {
  const entries = await listDir(filterDir(paths));
  const ini = entries.find(e => e.type !== 'DIRECTORY' && e.entry.toLowerCase() === `${id.toLowerCase()}.ini`);
  return ini ? [ini.entry, ...ppFilterCompanions(entries, id)] : [];
}

// Backups, newest first: [{ dir, id, at, files }].
export async function listPpBackups() {
  const root = await backupDir(), out = [];
  for (const e of await listDir(root)) {
    if (e.type !== 'DIRECTORY' || e.entry === '.' || e.entry === '..') continue;
    try {
      const b = JSON.parse(await readTextAnyEncoding(join(root, e.entry, 'filter.json')));
      if (b?.id && b.at && Array.isArray(b.files)) out.push({ dir: join(root, e.entry), ...b });
    } catch { /* not a backup */ }
  }
  return out.sort((a, b) => b.at - a.at);
}

const stamp = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}-${String(d.getMinutes()).padStart(2, '0')}-${String(d.getSeconds()).padStart(2, '0')}`;

// Copies a filter (its .ini and companions) to a new backup; null when it isn't installed.
export async function backupPpFilter(paths, id) {
  const files = await filterFiles(paths, id);
  if (!files.length) return null;
  const at = new Date();
  const base = join(await backupDir(), `${stamp(at)} ${id.replace(/[<>:"/\\|?*]/g, '_')}`);
  let dir = base;
  for (let n = 2; await exists(dir); n++) dir = `${base} (${n})`;
  await ensureDir(dir);
  for (const f of files) {
    const src = join(filterDir(paths), f), st = await Neutralino.filesystem.getStats(src);
    await Neutralino.filesystem.copy(src, join(dir, f), st.isDirectory ? { recursive: true, overwrite: true } : { overwrite: true });
  }
  await Neutralino.filesystem.writeFile(join(dir, 'filter.json'), JSON.stringify({ id, at: at.getTime(), files }, null, 2));
  for (const old of (await listPpBackups()).filter(b => b.id.toLowerCase() === id.toLowerCase()).slice(KEEP_BACKUPS)) await removeDirTree(old.dir);
  log(`ppfilter backup ${id}: ${dir}`);
  return dir;
}

export async function deletePpBackup(backup) {
  if (!(await removeDirTree(backup.dir))) throw new Error('Could not delete the backup');
}

// Pure's filters (pure*) belong to Pure while it is installed: they go with it
// (csp.js uninstallWeatherMod), not one by one.
const pureInstalled = async paths => (await listDir(join(paths.ac.install, 'extension/weather'))).some(e => e.type === 'DIRECTORY' && /pure/i.test(e.entry));
const isPureFilter = id => /^pure/i.test(id);

// Installed filters and the backups of filters, for Settings:
// { filters: [{ id, installed, author, version, builtin, owner, files, backups }], active, enabled }.
// owner 'pure': one of Pure's filters.
export async function listPpFilters(paths) {
  const entries = await listDir(filterDir(paths));
  const pure = await pureInstalled(paths);
  const backups = await listPpBackups();
  const byId = new Map();
  for (const e of entries) {
    if (e.type === 'DIRECTORY' || !/\.ini$/i.test(e.entry)) continue;
    const id = stem(e.entry), text = await readTextAnyEncoding(join(filterDir(paths), e.entry));
    byId.set(id.toLowerCase(), {
      id, installed: true, ...ppFilterAbout(text),
      builtin: KUNOS_FILTERS.has(id.toLowerCase()),
      owner: pure && isPureFilter(id) ? 'pure' : '',
      files: [e.entry, ...ppFilterCompanions(entries, id)], backups: [],
    });
  }
  for (const b of backups) {
    const k = b.id.toLowerCase();
    if (!byId.has(k)) byId.set(k, { id: b.id, installed: false, author: '', version: '', builtin: KUNOS_FILTERS.has(k), owner: '', files: [], backups: [] });
    byId.get(k).backups.push(b);
  }
  const video = parseIni(await readVideoIni(paths) || '');
  const rank = f => (f.builtin ? 2 : f.owner ? 1 : 0);
  return {
    filters: [...byId.values()].sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id, undefined, { sensitivity: 'base' })),
    active: String(video.POST_PROCESS?.FILTER || 'default'),
    enabled: String(video.POST_PROCESS?.ENABLED ?? '1') !== '0',
  };
}

// Before a dropped filter replaces an installed one (installer.js): the installed
// files are backed up, then removed, so a script the new version doesn't have
// isn't left behind.
export async function beforePpFilterInstall(paths, id) {
  const files = await filterFiles(paths, id);
  if (!files.length) return;
  await backupPpFilter(paths, id).catch(err => { throw new Error(`Could not back up the current ${id} (${err?.message || err})`); });
  for (const f of files) await Neutralino.filesystem.remove(join(filterDir(paths), f)).catch(() => {});
}

// Backs the filter up, then moves it to the Recycle Bin. AC goes back to its
// default filter when this one was in use.
export async function uninstallPpFilter(paths, id) {
  if (KUNOS_FILTERS.has(id.toLowerCase())) throw new Error(`${id} comes with Assetto Corsa.`);
  if (isPureFilter(id) && await pureInstalled(paths)) throw new Error(`${id} is part of Pure: uninstall Pure to remove it.`);
  if (await isProcessRunning('acs')) throw new Error('Close Assetto Corsa first.');
  const files = await filterFiles(paths, id);
  if (!files.length) throw new Error(`${id} was not found in system/cfg/ppfilters.`);
  await backupPpFilter(paths, id);
  const { active } = await listPpFilters(paths);
  if (active.toLowerCase() === id.toLowerCase()) await writeVideo(paths, { filter: 'default' });
  for (const f of files) {
    try { await Neutralino.os.trashItem(join(filterDir(paths), f)); }
    catch (err) { throw new Error(`Could not move ${f} to the Recycle Bin (${err?.message || err?.code || 'in use?'})`); }
  }
  log(`ppfilter uninstalled: ${id}`);
}

// Puts a backup back. The installed version (if any) is backed up first, and the
// restored backup is removed, so restoring again swaps the two back.
export async function restorePpFilter(paths, backup) {
  if (await isProcessRunning('acs')) throw new Error('Close Assetto Corsa first.');
  await backupPpFilter(paths, backup.id);
  for (const f of await filterFiles(paths, backup.id)) await Neutralino.os.trashItem(join(filterDir(paths), f)).catch(() => {});
  await ensureDir(filterDir(paths));
  for (const f of backup.files) {
    const src = join(backup.dir, f);
    if (!(await exists(src))) continue;
    const st = await Neutralino.filesystem.getStats(src);
    await Neutralino.filesystem.copy(src, join(filterDir(paths), f), st.isDirectory ? { recursive: true, overwrite: true } : { overwrite: true });
  }
  await deletePpBackup(backup);
  log(`ppfilter restored: ${backup.id} from ${backup.dir}`);
}
