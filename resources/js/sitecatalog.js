// Car and stage/track pictures from the official site (assettocorsa.gg), for the
// games whose own pictures are locked in their packages (ACC, Rally). The launcher
// ships them in img/site/ (tools/site-images.mjs) and, when online, checks the
// site once a week for cars or stages added since (siteSync in main.js), caching
// those next to the app, so everything works offline.
// Pure functions only: the build tool runs this file under Node too.

export const SITE_PAGES = {
  rally: 'https://assettocorsa.gg/assetto-corsa-rally/',
  acc: 'https://assettocorsa.gg/assetto-corsa-competizione/',
};

const decode = s => s.replace(/&ndash;/g, '-').replace(/&eacute;/g, 'é').replace(/&egrave;/g, 'è').replace(/&Scaron;/g, 'Š').replace(/&uuml;/g, 'ü').replace(/&amp;/g, '&').replace(/&#8211;/g, '-');

// Pictures and captions of a page section, in page order.
function tokens(html, from, to) {
  const i = html.indexOf(from);
  if (i < 0) return [];
  let j = to ? html.indexOf(to, i + from.length) : -1;
  if (j < 0) j = html.length;
  const sec = html.slice(i, j).replace(/<noscript>[\s\S]*?<\/noscript>/g, '');
  return [...sec.matchAll(/data-src="([^"]+)"|<(?:figcaption|h[2-6]|strong)[^>]*>([\s\S]*?)<\/(?:figcaption|h[2-6]|strong)>/g)]
    .map(m => m[1] ? { img: m[1] } : { text: decode(m[2].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim() })
    .filter(x => x.img || x.text);
}

// Cars: the picture comes before its caption ("Lancia Stratos Gr.4 - 1976").
export function siteCars(html) {
  const out = [];
  let img = '';
  for (const t of tokens(html, 'id="cars"', 'id="stages"') ) {
    if (t.img) img = t.img;
    else if (img && /(\d{4})\)?$/.test(t.text)) { out.push({ name: t.text, img }); img = ''; }
  }
  return out;
}

// Stages/tracks: the caption comes before its picture.
export function sitePlaces(html, section = 'id="stages"', end = '') {
  const out = [];
  let name = '';
  for (const t of tokens(html, section, end)) {
    if (t.text) name = t.text;
    else if (name) { out.push({ name, img: t.img }); name = ''; }
  }
  return out;
}

// Rally stage photos: the stages section also holds the stage maps (PNG), which
// aren't photos.
export const rallyStagePhotos = html => sitePlaces(html).filter(p => !/\.png$/i.test(p.img));

// Rally stage maps: red outlines on transparency (T_<stage>.png), each under a
// <p class="... font-script">Name</p> caption.
export function siteMaps(html) {
  const i = html.indexOf('id="stages"');
  if (i < 0) return [];
  return [...html.slice(i).matchAll(/<p class="[^"]*font-script[^"]*">([^<]+)<\/p>[\s\S]*?data-src="([^"]+)"/g)]
    .map(m => ({ name: decode(m[1]).trim(), img: m[2] })).filter(m => /\.png$/i.test(m.img));
}

// Larger renditions WordPress keeps of an upload: "-576x324.jpg" -> other sizes.
export function imageSizes(url) {
  const m = /^(.*?)(-\d+x\d+)?(\.[a-z]+)$/i.exec(url);
  if (!m) return [url];
  return [...new Set([`${m[1]}-576x324${m[3]}`, `${m[1]}-1080x608${m[3]}`, url, `${m[1]}${m[3]}`])];
}

export const words = s => [...new Set(String(s).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .split(/[^a-z0-9]+/).filter(w => w && !/^(gr|group|the|car|race|rally)$/.test(w)))];

// Best match of a site name among candidates { key, name } by shared words
// (years and model numbers weigh more); '' when nothing shares two words.
export function bestMatch(siteName, candidates) {
  const a = new Set(words(siteName));
  let best = '', score = 1;
  for (const c of candidates) {
    const b = words(c.name);
    const s = b.reduce((n, w) => n + (a.has(w) ? (/\d/.test(w) ? 2 : 1) : -0.5), 0);
    if (s > score) { best = c.key; score = s; }
  }
  return best;
}

// Rally stage groups by the stage's place name on the site.
export const RALLY_STAGE_WORDS = {
  AlsaceS2Munster: 'munster', AlsaceS4Saverne: 'saverne', GreeceS3Elatia: 'elatia', GreeceS4Loutraki: 'loutraki',
  LivignoTestTrack01: 'livigno', MonteCarloS1Bollene: 'bollene', MonteCarloS2Sisteron: 'sisteron',
  WelesS3HafrenNorth: 'hafren north', WelesS4HafrenSouth: 'hafren south',
};
export function stageGroupOf(siteName) {
  const n = words(siteName).join(' ');
  return Object.keys(RALLY_STAGE_WORDS).find(k => n.includes(RALLY_STAGE_WORDS[k])) || '';
}
