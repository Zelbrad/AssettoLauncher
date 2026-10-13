// Launcher updates from the GitHub repo's Releases. At startup (online, in the
// background) the latest release is compared with this version; a newer one
// offers Update now / Skip this version / later in a bar along the bottom (main.js, showUpdateOffer).
//   Install (installed copies): downloads the release's Assetto-Launcher-Setup-*.exe,
//     checks its SHA-256 against the one GitHub lists for the file, runs it silently
//     and quits; the installer updates in place (settings kept) and starts the
//     launcher again (build/installer.iss).
//   Portable copies (the zip) can't replace themselves: they open the release page.
import { run, log, join, exists, startProcess, norm, CURL, IS_LINUX, sha256File } from './util.js';

// This fork's own releases (the original is Zelbrad/AssettoLauncher).
export const REPO = 'tawndelli/AssettoLauncher';
const API = `https://api.github.com/repos/${REPO}/releases/latest`;
const SETUP_RE = /^Assetto-Launcher-Setup-.*\.exe$/i;
// A setup is only installed from this repo's own releases, with the SHA-256 GitHub
// lists for it; anything else opens the release page instead.
const SETUP_URL_RE = new RegExp(`^https://github\\.com/${REPO}/releases/download/[\\w.-]+/Assetto-Launcher-Setup-[\\w.-]+\\.exe$`, 'i');
const installable = s => !!s && SETUP_URL_RE.test(s.url) && /^[0-9a-f]{64}$/.test(s.sha256);

// "0.10.0" > "0.9.2"; a leading "v" is ignored.
export function isNewer(candidate, current) {
  const parts = v => String(v).replace(/^v/i, '').split(/[.+-]/).slice(0, 3).map(n => parseInt(n, 10) || 0);
  const a = parts(candidate), b = parts(current);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

// { version, notes, page, setup: { name, url, size, sha256 } | null } or null
// (no release yet, offline, or GitHub's hourly limit for anonymous calls).
export async function latestRelease() {
  const r = await run(`${CURL} -s -L --max-time 8 -H "Accept: application/vnd.github+json" -H "User-Agent: AssettoLauncher" ${API}`);
  if (r.exitCode !== 0) return null;
  let j;
  try { j = JSON.parse(r.stdOut); } catch { return null; }
  if (!j?.tag_name || j.draft || j.prerelease) return null;
  const a = (j.assets || []).find(x => SETUP_RE.test(x.name));
  const setup = a ? { name: a.name, url: String(a.browser_download_url || ''), size: a.size, sha256: String(a.digest || '').replace(/^sha256:/i, '').toLowerCase() } : null;
  if (setup && !installable(setup)) log(`update: ${setup.name} has no usable address or SHA-256, so it isn't installed from here`);
  return {
    version: j.tag_name.replace(/^v/i, ''),
    notes: String(j.body || '').trim(),
    page: j.html_url || `https://github.com/${REPO}/releases/latest`,
    setup: installable(setup) ? setup : null,
  };
}

// Installed by the setup (it leaves its uninstaller next to the exe), so a new
// setup can update it; otherwise it's the portable zip.
export async function isInstalledCopy() {
  if (IS_LINUX) return false; // Linux builds are portable: the release page has them
  let dir = window.NL_PATH;
  try { dir = await Neutralino.filesystem.getAbsolutePath(dir); } catch { /* keep */ }
  return exists(join(dir, 'unins000.exe'));
}

// Downloads, verifies and starts the setup; the caller quits right after.
export async function installUpdate(setup) {
  const temp = norm(await Neutralino.os.getEnv('TEMP'));
  const file = join(temp, setup.name.replace(/[^\w.-]/g, '_'));
  if (!installable(setup)) throw new Error('Unexpected download address');
  const dl = await run(`${CURL} -s -L -f --proto =https --proto-redir =https --max-time 300 -o "${file}" "${setup.url}"`);
  if (dl.exitCode !== 0) throw new Error('The download failed. Check your connection and try again.');
  const got = (await sha256File(file)).toLowerCase();
  if (got !== setup.sha256) {
    await Neutralino.filesystem.remove(file).catch(() => {});
    log(`update: hash mismatch ${got} vs ${setup.sha256}`);
    throw new Error('The downloaded file didn\'t match the release, so it wasn\'t installed.');
  }
  // /SILENT: progress window only; the installer closes this copy if needed,
  // updates it and starts the new version (installer.iss).
  await startProcess(file, temp, ['/SILENT', '/SP-', '/NOCANCEL', '/CLOSEAPPLICATIONS']);
}
