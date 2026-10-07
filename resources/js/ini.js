// INI helpers for AC's cfg files (race.ini, assists.ini, video.ini) and CSP's
// settings. Edits keep every other line of the file as it is.

const lineSplit = text => text.split(/\r?\n/);
const isHeader = l => /^\s*\[.+\]\s*$/.test(l);

// Set key=value inside [section], adding the key or the section if missing.
export function setIni(text, section, key, value) {
  const lines = lineSplit(text);
  const header = `[${section.toUpperCase()}]`;
  let start = lines.findIndex(l => l.trim().toUpperCase() === header);
  if (start === -1) {
    lines.push('', header, `${key}=${value}`);
    return lines.join('\r\n');
  }
  let end = lines.findIndex((l, i) => i > start && isHeader(l));
  if (end === -1) end = lines.length;
  const re = new RegExp(`^\\s*${key}\\s*=`, 'i');
  for (let i = start + 1; i < end; i++) {
    if (re.test(lines[i])) { lines[i] = `${key}=${value}`; return lines.join('\r\n'); }
  }
  // Insert after the last non-blank line of the section.
  let at = end;
  while (at > start + 1 && !lines[at - 1].trim()) at--;
  lines.splice(at, 0, `${key}=${value}`);
  return lines.join('\r\n');
}

export function deleteKeys(text, section, keyRe) {
  let inSection = false;
  return lineSplit(text).filter(l => {
    if (isHeader(l)) { inSection = l.trim().toUpperCase() === `[${section.toUpperCase()}]`; return true; }
    return !(inSection && keyRe.test(l.split('=')[0].trim()));
  }).join('\r\n');
}

export function removeSections(text, nameRe) {
  let skip = false;
  const out = [];
  for (const l of lineSplit(text)) {
    if (isHeader(l)) skip = nameRe.test(l.trim().slice(1, -1));
    if (!skip) out.push(l);
  }
  return out.join('\r\n').replace(/(\r\n){3,}/g, '\r\n\r\n');
}

// { SECTION: { KEY: value } }, both upper-cased; comments after ";" are dropped
// and CSP's quoted values ('pureCtrl static') lose their quotes.
export function parseIni(text) {
  const out = {};
  let cur = null;
  for (const raw of lineSplit(text || '')) {
    const l = raw.replace(/;.*$/, '').trim();
    if (!l) continue;
    if (/^\[.+\]$/.test(l)) { cur = out[l.slice(1, -1).toUpperCase()] = out[l.slice(1, -1).toUpperCase()] || {}; continue; }
    const i = l.indexOf('=');
    if (cur && i > 0) cur[l.slice(0, i).trim().toUpperCase()] = l.slice(i + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}
