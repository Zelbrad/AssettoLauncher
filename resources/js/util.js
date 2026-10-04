// Shared helpers. Neutralino mangles backslashes in paths, so every path that
// crosses the native bridge is normalized to forward slashes first.

export const norm = p => (p || '').replace(/\\/g, '/').replace(/\/+$/, '');
export const join = (...parts) => norm(parts.filter(Boolean).join('/')).replace(/\/{2,}/g, '/');
export const winPath = p => norm(p).replace(/\//g, '\\');
export const basename = p => norm(p).split('/').pop();

export const log = msg => { try { Neutralino.debug.log(String(msg)); } catch { /* not ready */ } };

export async function exists(path) {
  try { await Neutralino.filesystem.getStats(norm(path)); return true; } catch { return false; }
}

export async function listDir(path) {
  try { return await Neutralino.filesystem.readDirectory(norm(path)); } catch { return []; }
}

export async function readText(path) {
  try { return await Neutralino.filesystem.readFile(norm(path)); } catch { return null; }
}

// Reads text that may be UTF-16 (ACC writes its JSON as UTF-16 LE with BOM).
export async function readTextAnyEncoding(path) {
  try {
    const buf = new Uint8Array(await Neutralino.filesystem.readBinaryFile(norm(path)));
    if (buf[0] === 0xFF && buf[1] === 0xFE) return new TextDecoder('utf-16le').decode(buf.subarray(2));
    if (buf[0] === 0xFE && buf[1] === 0xFF) return new TextDecoder('utf-16be').decode(buf.subarray(2));
    // BOM-less UTF-16 LE: ASCII text with every second byte zero.
    if (buf.length > 3 && buf[0] !== 0 && buf[1] === 0 && buf[3] === 0) return new TextDecoder('utf-16le').decode(buf);
    return new TextDecoder('utf-8').decode(buf);
  } catch { return null; }
}

// Kunos ui_*.json files are frequently invalid JSON: raw newlines/tabs inside
// strings, trailing commas, BOMs. Escape control chars inside strings, drop
// trailing commas, then fall back to regex field extraction.
export function parseLooseJson(text) {
  if (!text) return null;
  text = text.replace(/^﻿/, '');
  try { return JSON.parse(text); } catch { /* fall through */ }

  let out = '', inStr = false, esc = false;
  for (const ch of text) {
    if (inStr) {
      if (esc) { out += ch; esc = false; continue; }
      if (ch === '\\') { out += ch; esc = true; continue; }
      if (ch === '"') { inStr = false; out += ch; continue; }
      if (ch === '\n') { out += '\\n'; continue; }
      if (ch === '\r') continue;
      if (ch === '\t') { out += ' '; continue; }
      if (ch < ' ') continue;
      out += ch;
    } else {
      if (ch === '"') inStr = true;
      out += ch;
    }
  }
  out = out.replace(/,\s*([}\]])/g, '$1');
  try { return JSON.parse(out); } catch { /* fall through */ }

  const pick = key => {
    const m = text.match(new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`, 'i'));
    return m ? m[1] : undefined;
  };
  const tags = text.match(/"tags"\s*:\s*\[([^\]]*)\]/i);
  return {
    name: pick('name'), brand: pick('brand'), description: pick('description'),
    author: pick('author'), version: pick('version'), url: pick('url'),
    class: pick('class'), country: pick('country'), length: pick('length'),
    tags: tags ? [...tags[1].matchAll(/"([^"]*)"/g)].map(m => m[1]) : [],
  };
}

// AC descriptions contain <br> and other light HTML; render as plain text.
export function cleanText(s) {
  if (!s) return '';
  return String(s)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function prettifyId(id) {
  return String(id)
    .replace(/\.(kspkg|pak)$/i, '')
    .replace(/^ks_/, '')
    .replace(/[_-]+/g, ' ')
    .trim()
    .split(/\s+/)
    // Short tokens and model codes read best uppercased: "gt3 rs" -> "GT3 RS".
    .map(w => (w.length <= 3 || /\d/.test(w)) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

export function timeAgo(unixSeconds) {
  const s = Math.max(1, Math.floor(Date.now() / 1000 - unixSeconds));
  const units = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
  for (const [name, secs] of units) {
    const n = Math.floor(s / secs);
    if (n >= 1) return `${n} ${name}${n > 1 ? 's' : ''} ago`;
  }
  return 'just now';
}

// Run async fn over items with bounded concurrency (keeps the native bridge responsive).
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try { results[idx] = await fn(items[idx], idx); } catch { results[idx] = null; }
    }
  });
  await Promise.all(workers);
  return results;
}

// Local folders are exposed to the webview via Neutralino server mounts, so
// images load as normal URLs instead of being copied or base64-encoded.
const mounts = new Map(); // urlPrefix -> fs root

export async function mountDir(prefix, fsRoot) {
  fsRoot = norm(fsRoot);
  if (mounts.get(prefix) === fsRoot) return true;
  try {
    if (mounts.has(prefix)) await Neutralino.server.unmount(prefix);
    await Neutralino.server.mount(prefix, fsRoot);
    mounts.set(prefix, fsRoot);
    return true;
  } catch (e) {
    log(`mount failed ${prefix} -> ${fsRoot}: ${JSON.stringify(e)}`);
    return false;
  }
}

export function fileUrl(absPath) {
  if (!absPath) return '';
  const p = norm(absPath);
  for (const [prefix, root] of mounts) {
    if (p.toLowerCase().startsWith(root.toLowerCase() + '/')) {
      const rel = p.slice(root.length + 1).split('/').map(encodeURIComponent).join('/');
      return `${prefix}/${rel}`;
    }
  }
  return '';
}

// Only for commands without filesystem paths (reg, curl). The native side strips
// single backslashes ("\S" -> "S"); doubling them gets registry keys through to
// reg.exe, which tolerates the result. Paths go through openFolder/startProcess.
export async function run(cmd, opts) {
  try { return await Neutralino.os.execCommand(cmd.replace(/\\/g, '\\\\'), opts); }
  catch (e) { log(`exec failed: ${cmd} ${JSON.stringify(e)}`); return { exitCode: -1, stdOut: '', stdErr: String(e?.message || e) }; }
}

export async function openExternal(target) {
  try { await Neutralino.os.open(target); } catch (e) { log(`open failed ${target}: ${JSON.stringify(e)}`); }
}

// Backslashes don't survive execCommand reliably (stripped or doubled depending
// on the command shape), so anything that takes a filesystem path goes through
// PowerShell with forward-slash paths in single-quoted literals.
export const psQuote = s => `'${norm(s).replace(/'/g, "''")}'`;

export function powershell(script, opts) {
  return Neutralino.os.execCommand(`powershell -NoProfile -NonInteractive -WindowStyle Hidden -Command "${script}"`, opts);
}

// For scripts with quotes or backslashes (C# signatures): passed base64 (UTF-16LE),
// so nothing in them is touched on the way.
export function powershellEncoded(script, opts) {
  let bin = '';
  for (let i = 0; i < script.length; i++) { const c = script.charCodeAt(i); bin += String.fromCharCode(c & 255, c >> 8); }
  return Neutralino.os.execCommand(`powershell -NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand ${btoa(bin)}`, opts);
}

export async function openFolder(path) {
  await powershell(`Invoke-Item -LiteralPath ${psQuote(path)}`, { background: true });
}

// Windows 10+ ships bsdtar (libarchive) as System32\tar.exe; it reads zip, 7z,
// rar and rar5, so the launcher doesn't need to bundle an extractor.
export async function extractArchive(archive, dest) {
  const r = await powershell(`& (Join-Path $env:SystemRoot 'System32/tar.exe') -xf ${psQuote(archive)} -C ${psQuote(dest)} 2>&1 | Out-String -Width 400; exit $LASTEXITCODE`);
  if (r.exitCode !== 0) {
    const out = r.stdOut + r.stdErr;
    if (/encrypt/i.test(out)) throw new Error('the archive is password-protected. Extract it with WinRAR or 7-Zip first, then drop the files.');
    const msg = out.split(/\r?\n/).map(s => s.replace(/^tar(\.exe)?:\s*/i, '').trim()).filter(s => s && !/^Error exit delayed/i.test(s))[0];
    throw new Error(msg || `could not extract ${basename(archive)}`);
  }
}

// Creates a folder and any missing parents.
export async function ensureDir(path) {
  const parts = norm(path).split('/');
  for (let i = 1; i <= parts.length; i++) {
    const p = parts.slice(0, i).join('/');
    if (!p || /^[a-z]:$/i.test(p)) continue;
    try { await Neutralino.filesystem.createDirectory(p); } catch { /* exists */ }
  }
}

export async function startProcess(exe, cwd, args = []) {
  const argList = args.length ? ` -ArgumentList ${args.map(a => `'${String(a).replace(/'/g, "''")}'`).join(',')}` : '';
  const r = await powershell(`Start-Process -FilePath ${psQuote(exe)} -WorkingDirectory ${psQuote(cwd)}${argList}`);
  if (r.exitCode !== 0) throw new Error(r.stdErr.trim() || `Could not start ${basename(exe)}`);
}

// Strings sent to the native side get their backslash escapes interpreted
// (and "\x"/"\u" sequences can wedge it), so anything that may contain a
// backslash travels as base64 or binary instead.
const toB64 = s => { const b = new TextEncoder().encode(s); let bin = ''; for (const x of b) bin += String.fromCharCode(x); return btoa(bin); };
const fromB64 = s => new TextDecoder().decode(Uint8Array.from(atob(s), c => c.charCodeAt(0)));

export async function storageGet(key, fallback) {
  try { return JSON.parse(fromB64(await Neutralino.storage.getData(key))); } catch { return fallback; }
}

export async function storageSet(key, value) {
  try { await Neutralino.storage.setData(key, toB64(JSON.stringify(value))); } catch (e) { log(`storage set failed ${key}`); }
}

export async function writeText(path, text) {
  await Neutralino.filesystem.writeBinaryFile(norm(path), new TextEncoder().encode(text).buffer);
}
