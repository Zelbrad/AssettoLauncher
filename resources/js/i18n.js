// The launcher's language. Text is written in English in the code and wrapped in tr('…'); every
// other language is resources/i18n/<code>.json, an object from the English text to its
// translation. Anything missing falls back to English, so a new phrase never shows up blank.
// Variables are written {name} in both: tr('Uninstall {name}?', { name }).
// Static text in index.html carries data-i18n (text) or data-i18n-title (tooltip) instead.
// tools/i18n-check.mjs lists the phrases a language file is missing.

export const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Español' },
  { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' },
  { code: 'it', name: 'Italiano' },
  { code: 'pt-BR', name: 'Português (Brasil)' },
];

let dict = {};
export let lang = 'en';

// The system's language when the launcher has it (es-MX -> es, pt-PT -> pt-BR), else English.
export function systemLanguage() {
  for (const want of navigator.languages?.length ? navigator.languages : [navigator.language || 'en']) {
    const exact = LANGUAGES.find(l => l.code.toLowerCase() === want.toLowerCase());
    if (exact) return exact.code;
    const base = want.split('-')[0].toLowerCase();
    const near = LANGUAGES.find(l => l.code.split('-')[0] === base);
    if (near) return near.code;
  }
  return 'en';
}

export async function loadLanguage(code) {
  if (!LANGUAGES.some(l => l.code === code)) code = 'en';
  let next = {};
  if (code !== 'en') {
    try { next = await (await fetch(`/i18n/${code}.json`)).json(); }
    catch (e) { console.warn(`i18n: ${code} failed to load`, e); code = 'en'; }
  }
  dict = next;
  lang = code;
  document.documentElement.lang = code;
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = tr(el.dataset.i18n);
  for (const el of document.querySelectorAll('[data-i18n-title]')) el.title = tr(el.dataset.i18nTitle);
}

export function tr(text, vars) {
  let s = dict[text] || text;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  return s;
}

// Marks English text in tables built when a module loads (mode names, weather, tabs), so the
// checker finds it; it's translated where it's shown, with tr().
export const N_ = s => s;

// One or many: trn(n, '1 warning', '{n} warnings').
export const trn = (n, one, many, vars) => tr(n === 1 ? one : many, { n, ...vars });
