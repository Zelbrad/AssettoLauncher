// Steam integration: install detection from local library manifests, plus
// public Web API calls (news, store details). The Steam API sends no CORS
// headers, so HTTP goes through the curl.exe that ships with Windows 10+.
import { norm, join, readText, run, powershell, log, storageGet, storageSet, cleanText } from './util.js';

export async function findSteamPath() {
  const r = await powershell("(Get-ItemProperty -LiteralPath 'HKCU:/Software/Valve/Steam' -ErrorAction SilentlyContinue).SteamPath");
  const p = r.stdOut.trim();
  if (p) return norm(p);
  return 'C:/Program Files (x86)/Steam';
}

// Steam build id and last update time (unix seconds) of each installed app, from its manifest.
export const appBuilds = {};

// Returns { appid: absoluteInstallDir } for every installed app across libraries.
export async function findInstalledApps(steamPath) {
  const vdf = await readText(join(steamPath, 'steamapps/libraryfolders.vdf'));
  const libs = new Set([norm(steamPath)]);
  if (vdf) for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) libs.add(norm(m[1].replace(/\\\\/g, '\\')));

  const installed = {};
  for (const lib of libs) {
    const apps = join(lib, 'steamapps');
    let entries = [];
    try { entries = await Neutralino.filesystem.readDirectory(apps); } catch { continue; }
    for (const e of entries) {
      const m = e.entry.match(/^appmanifest_(\d+)\.acf$/);
      if (!m) continue;
      const acf = await readText(join(apps, e.entry));
      const dir = acf?.match(/"installdir"\s+"([^"]+)"/);
      if (dir) installed[m[1]] = join(apps, 'common', dir[1]);
      const build = acf?.match(/"buildid"\s+"(\d+)"/), updated = acf?.match(/"LastUpdated"\s+"(\d+)"/);
      if (build) appBuilds[m[1]] = { build: build[1], updated: updated ? Number(updated[1]) : 0 };
    }
  }
  return installed;
}

async function curlJson(url) {
  const r = await run(`curl.exe -s -L --max-time 20 -H "Accept-Language: en" "${url}"`);
  if (r.exitCode !== 0 || !r.stdOut) return null;
  try { return JSON.parse(r.stdOut); } catch { log(`bad json from ${url}`); return null; }
}

const CLAN_IMG = 'https://clan.cloudflare.steamstatic.com/images/';

function firstImage(contents) {
  if (!contents) return '';
  const clan = contents.match(/\{STEAM_CLAN_IMAGE\}\/([^\s"\[\]<>]+?\.(?:jpe?g|png|gif|webp))/i);
  if (clan) return CLAN_IMG + clan[1];
  const url = contents.match(/https?:\/\/[^\s"\[\]<>]+?\.(?:jpe?g|png|webp)/i);
  if (url) return url[0];
  // Video-only posts embed a YouTube player; use its thumbnail.
  const yt = contents.match(/previewyoutube=([\w-]{6,})/i);
  return yt ? `https://i.ytimg.com/vi/${yt[1]}/hqdefault.jpg` : '';
}

function snippet(contents) {
  return cleanText(contents
    .replace(/\[img[^\]]*\][\s\S]*?\[\/img\]/gi, '')
    .replace(/\[\/?[a-z0-9]+[^\]]*\]/gi, ' ')
    .replace(/\{STEAM_CLAN_IMAGE\}\S*/g, '')
    .replace(/https?:\/\/\S+/g, ''))
    .replace(/\s+/g, ' ').slice(0, 220);
}

const NEWS_TTL = 30 * 60 * 1000;

// Official announcements only (feeds=steam_community_announcements), cached so
// the launcher shows the last known news instantly and works offline.
export async function getNews(appid, { force = false } = {}) {
  const key = `news2_${appid}`;
  const cached = await storageGet(key, null);
  if (!force && cached && Date.now() - cached.at < NEWS_TTL) return cached.items;

  const data = await curlJson(`https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${appid}&count=8&maxlength=0&feeds=steam_community_announcements`);
  const raw = data?.appnews?.newsitems;
  if (!raw) return cached?.items || [];

  const items = raw.map(n => ({
    gid: n.gid,
    title: n.title,
    date: n.date,
    label: n.feedlabel || 'News',
    image: firstImage(n.contents),
    summary: snippet(n.contents || ''),
    url: `https://store.steampowered.com/news/app/${appid}/view/${n.gid}`,
  }));
  await storageSet(key, { at: Date.now(), items });
  return items;
}

// Cached news only (null when there is none yet): shown at once, online or not.
export async function cachedNews(appid) {
  return (await storageGet(`news2_${appid}`, null))?.items || null;
}

// Is there a newer post than the cached ones? Asks Steam for just the latest
// post's id (~0.5 KB) and fetches the full list only when it changed. Returns
// the new items, or null when nothing changed or Steam can't be reached.
export async function refreshNews(appid) {
  const key = `news2_${appid}`;
  const cached = await storageGet(key, null);
  const r = await run(`curl.exe -s --max-time 8 "https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${appid}&count=1&maxlength=1&feeds=steam_community_announcements"`);
  let latest = '';
  try { latest = JSON.parse(r.stdOut).appnews.newsitems[0]?.gid || ''; } catch { return null; }
  if (cached?.items?.length && cached.items[0].gid === latest) {
    await storageSet(key, { ...cached, at: Date.now() });
    return null;
  }
  return getNews(appid, { force: true });
}

const DETAILS_TTL = 24 * 60 * 60 * 1000;

export async function getStoreDetails(appid) {
  const key = `details_${appid}`;
  const cached = await storageGet(key, null);
  if (cached && Date.now() - cached.at < DETAILS_TTL) return cached.data;

  const data = await curlJson(`https://store.steampowered.com/api/appdetails?appids=${appid}&filters=basic,movies,price_overview&l=english`);
  const d = data?.[appid]?.data;
  if (!d) return cached?.data || null;

  const movies = (d.movies || []).map(m => ({
    name: m.name,
    thumb: m.thumbnail,
    hls: m.hls_h264,
    mp4: m.mp4?.max || m.mp4?.['480'] || '',
    highlight: !!m.highlight,
  }));
  const out = {
    shortDescription: cleanText(d.short_description || ''),
    price: d.price_overview?.final_formatted || (d.is_free ? 'Free' : ''),
    movies,
  };
  await storageSet(key, { at: Date.now(), data: out });
  return out;
}

export const steamUrls = {
  run: appid => `steam://rungameid/${appid}`,
  install: appid => `steam://install/${appid}`,
  store: appid => `steam://store/${appid}`,
  storeWeb: appid => `https://store.steampowered.com/app/${appid}/`,
  hub: appid => `https://steamcommunity.com/app/${appid}`,
  news: appid => `https://store.steampowered.com/news/app/${appid}`,
  hero: appid => `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appid}/library_hero.jpg`,
  header: appid => `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appid}/header.jpg`,
};
