// Mod installer, Content Manager style: drop (or pick) an archive or a mod file
// and the launcher works out which game it is for and where it goes.
//   Archives  .zip .rar .7z (and tar variants), extracted with Windows' tar.exe (Linux: bsdtar, 7-Zip, unzip or unrar)
//   Files     .kspkg (EVO), .pak/.utoc/.ucas (Rally), Customs car .json (ACC), PP filter .ini (AC)
// Layouts recognised at any depth inside an archive:
//   AC     car folder (ui/ui_car.json, data.acd or data/car.ini), track folder
//          (ui/[layout/]ui_track.json, models*.ini, or .kn5 + data/surfaces.ini),
//          skin folder (ui_skin.json, or livery.png + preview.jpg), or an AC-root
//          layout (content/..., apps/, extension/) that is merged into the install,
//          post-processing filter (.ini with AC's PP sections, plus its .lua or
//          <name>_scripts folder), loose or in a zip, installed to system/cfg/ppfilters
//   ACC    livery folder (decals/sponsors .json/.png), car file (*.json with carModelType)
//   EVO    *.kspkg, external livery folder (external_livery.json + its SavedCar)
//   Rally  livery folder (livery.json + icon.png / body_livery_*.dds), or *.pak + .utoc + .ucas
import {
  norm, join, basename, exists, listDir, readText, readTextAnyEncoding, parseLooseJson, cleanText,
  prettifyId, log, mountDir, fileUrl, extractArchive, ensureDir, IS_LINUX,
} from './util.js';
import { readModInfo } from './kspkg.js';
import { isPpFilterIni, ppFilterAbout, ppFilterCompanions, beforePpFilterInstall, KUNOS_FILTERS } from './ppfilters.js';
import { guessLiveryCar } from './rallylivery.js';
import { rallyCarIds, rallyCarName, guessRallyCar, evoSavedCarsDir, utocVersion, rallyGameTocVersion } from './games.js';

export const IMPORT_RE = /\.(zip|rar|7z|tar|tgz|gz|xz|bz2|kspkg|pak|utoc|ucas|json|ini)$/i;
const ARCHIVE_RE = /\.(zip|rar|7z|tar|tgz|gz|xz|bz2)$/i;
const IMG_RE = /\.(png|jpe?g|webp)$/i;
const MOUNT = '/m/import';

const AC_CONTENT_DIRS = new Set(['cars', 'tracks', 'weather', 'fonts', 'showroom', 'sfx', 'texture', 'gui', 'driver', 'objects3d', 'career']);
const AC_ROOT_DIRS = new Set(['apps', 'extension', 'system']);
const IGNORED_DIRS = /^(__macosx|\.git|\.svn)$/i;

const parentOf = p => norm(p).replace(/\/[^/]*$/, '');
const stem = f => f.replace(/\.[^.]+$/, '');
const safeId = s => stem(s).toLowerCase().replace(/[^a-z0-9_.-]+/g, '_').replace(/^_+|_+$/g, '') || 'mod';

// ---------------------------------------------------------------------------
// Staging folder (%TEMP%\acl-import), mounted so previews load. Names stay short:
// deep mod folders can otherwise hit Windows' 260-character path limit.

let stagingRoot = null;
async function staging() {
  if (stagingRoot) return stagingRoot;
  let tmp = '';
  try { tmp = await Neutralino.os.getPath('temp'); } catch { /* older runtime */ }
  if (!tmp) tmp = await Neutralino.os.getEnv(IS_LINUX ? 'TMPDIR' : 'TEMP').catch(() => '') || (IS_LINUX ? '/tmp' : '');
  const root = join(norm(tmp), 'acl-import');
  await Neutralino.filesystem.remove(root).catch(() => {}); // leftovers from a previous run
  await ensureDir(root);
  await mountDir(MOUNT, root);
  return (stagingRoot = root);
}

export async function discardImport(session) {
  if (session) await Neutralino.filesystem.remove(session).catch(err => log(`import cleanup: ${err?.message || JSON.stringify(err)}`));
}

// ---------------------------------------------------------------------------
// Dropped files: the webview gives File objects without a path. Mods are
// usually dropped straight from Downloads or the Desktop, so look there for the
// same file (name, size and first 64 KB); otherwise copy the bytes to staging.

export async function resolveDropped(file, onProgress) {
  const found = await locate(file).catch(() => '');
  if (found) return { path: found, temp: false };
  const dir = join(await staging(), `d${Date.now().toString(36)}`);
  await ensureDir(dir);
  const path = join(dir, file.name);
  const CHUNK = 8 << 20;
  let pos = 0;
  do {
    const buf = await file.slice(pos, pos + CHUNK).arrayBuffer();
    if (pos === 0) await Neutralino.filesystem.writeBinaryFile(path, buf);
    else await Neutralino.filesystem.appendBinaryFile(path, buf);
    pos += CHUNK;
    onProgress?.(Math.min(pos, file.size), file.size);
  } while (pos < file.size);
  return { path, temp: true, session: dir };
}

async function locate(file) {
  const home = norm(await Neutralino.os.getEnv(IS_LINUX ? 'HOME' : 'USERPROFILE'));
  const dirs = [];
  for (const k of ['downloads', 'desktop', 'documents']) {
    try { dirs.push(norm(await Neutralino.os.getPath(k))); } catch { /* unsupported */ }
  }
  dirs.push(join(home, 'Downloads'), join(home, 'Desktop'), home);
  // One level of sub-folders in Downloads and on the Desktop ("Downloads/mods/x.zip").
  for (const base of dirs.slice(0, 2)) {
    for (const e of await listDir(base)) {
      if (e.type === 'DIRECTORY' && e.entry !== '.' && e.entry !== '..') dirs.push(join(base, e.entry));
    }
  }
  const head = new Uint8Array(await file.slice(0, 65536).arrayBuffer());
  for (const d of new Set(dirs)) {
    const p = join(d, file.name);
    try {
      const st = await Neutralino.filesystem.getStats(p);
      if (!st.isFile || st.size !== file.size) continue;
      const disk = new Uint8Array(await Neutralino.filesystem.readBinaryFile(p, { pos: 0, size: head.length }));
      if (disk.length === head.length && disk.every((b, i) => b === head[i])) return p;
    } catch { /* not there */ }
  }
  return '';
}

// ---------------------------------------------------------------------------
// Detection

async function scanTree(root) {
  const nodes = new Map();
  const visit = async rel => {
    const n = { files: [], dirs: [] };
    nodes.set(rel, n);
    for (const e of await listDir(rel ? join(root, rel) : root)) {
      if (e.entry === '.' || e.entry === '..') continue;
      if (e.type === 'DIRECTORY') { if (!IGNORED_DIRS.test(e.entry)) n.dirs.push(e.entry); }
      else n.files.push(e.entry);
    }
    for (const d of n.dirs) await visit(rel ? `${rel}/${d}` : d);
  };
  await visit('');
  return nodes;
}

const kid = (n, name, type = 'dirs') => n?.[type].find(x => x.toLowerCase() === name);
const sub = (rel, name) => (rel ? `${rel}/${name}` : name);

// Item: { game, kind, tab, title, detail, image, mode: 'dir'|'files'|'merge', src, target, files, pairs, copyOnly, exists, missing }
class Detector {
  constructor(ctx) { Object.assign(this, ctx); this.items = []; }

  node(rel) { return this.nodes.get(rel); }
  abs(rel) { return rel ? join(this.root, rel) : this.root; }
  add(item) { this.items.push({ selected: true, copyOnly: this.copyOnly, ...item }); }
  folderId(rel) { return rel ? basename(rel) : safeId(this.archiveName); }

  isAcCar(rel) {
    const n = this.node(rel);
    if (kid(n, 'data.acd', 'files')) return true;
    const ui = kid(n, 'ui');
    if (ui && kid(this.node(sub(rel, ui)), 'ui_car.json', 'files')) return true;
    const data = kid(n, 'data');
    return !!(data && kid(this.node(sub(rel, data)), 'car.ini', 'files'));
  }

  isAcTrack(rel) {
    const n = this.node(rel);
    if (n.files.some(f => /^models(_.+)?\.ini$/i.test(f))) return true;
    const ui = kid(n, 'ui'), uiRel = ui && sub(rel, ui), un = ui && this.node(uiRel);
    if (un && (kid(un, 'ui_track.json', 'files') || un.dirs.some(d => kid(this.node(sub(uiRel, d)), 'ui_track.json', 'files')))) return true;
    if (!n.files.some(f => /\.kn5$/i.test(f))) return false;
    const surfaces = r => { const data = kid(this.node(r), 'data'); return !!(data && kid(this.node(sub(r, data)), 'surfaces.ini', 'files')); };
    return surfaces(rel) || n.dirs.some(d => surfaces(sub(rel, d)));
  }

  isAcRoot(rel) {
    const n = this.node(rel);
    const content = kid(n, 'content');
    if (content && this.node(sub(rel, content)).dirs.some(d => AC_CONTENT_DIRS.has(d.toLowerCase()))) return true;
    const apps = kid(n, 'apps');
    if (apps && this.node(sub(rel, apps)).dirs.some(d => /^(python|lua)$/i.test(d))) return true;
    return !!kid(n, 'extension');
  }

  isAccLivery(n) { return ['decals.json', 'sponsors.json', 'decals.png', 'sponsors.png'].some(f => kid(n, f, 'files')); }
  isEvoLivery(n) { return !!kid(n, 'external_livery.json', 'files'); }
  isRallyLivery(n) { return !!kid(n, 'livery.json', 'files') && n.files.some(f => /^(body_livery_.*\.dds|icon\.png)$/i.test(f)); }
  isAcSkin(n) { return !!kid(n, 'ui_skin.json', 'files') || (!!kid(n, 'livery.png', 'files') && !!kid(n, 'preview.jpg', 'files')); }

  async walk(rel = '') {
    const n = this.node(rel);
    if (!n) return;
    if (this.isAcCar(rel)) return this.addAcCar(rel);
    if (this.isAcTrack(rel)) return this.addAcTrack(rel);
    if (this.isAcRoot(rel)) return this.addAcRoot(rel);
    if (this.isEvoLivery(n)) return this.addEvoLivery(rel);
    if (this.isRallyLivery(n)) return this.addRallyLivery(rel);
    if (this.isAccLivery(n)) return this.addAccLivery(rel);
    if (this.isAcSkin(n)) return this.addAcSkin(rel, this.guessCar(rel));
    const filterDirs = await this.addPpFilters(rel);
    await this.addFiles(this.abs(rel), n.files);
    for (const d of n.dirs) if (!filterDirs.has(d)) await this.walk(sub(rel, d));
  }

  // Post-processing filters among the folder's .ini files, each with its script
  // (<name>.lua, or a <name> / <name>_scripts folder). Returns the folders used.
  async addPpFilters(rel) {
    const n = this.node(rel), used = new Set();
    const entries = [...n.files.map(entry => ({ entry, type: 'FILE' })), ...n.dirs.map(entry => ({ entry, type: 'DIRECTORY' }))];
    const dir = this.paths.ac.install && join(this.paths.ac.install, 'system/cfg/ppfilters');
    for (const f of n.files.filter(x => /\.ini$/i.test(x))) {
      const text = await readTextAnyEncoding(join(this.abs(rel), f));
      if (!isPpFilterIni(text)) continue;
      const id = stem(f), parts = [f, ...ppFilterCompanions(entries, id)];
      for (const p of parts) if (n.dirs.includes(p)) used.add(p);
      const { author, version } = ppFilterAbout(text);
      this.add({
        game: 'ac', kind: 'pp filter', tab: null, title: id,
        sub: [author && `by ${cleanText(author)}`, version && `v${version}`].filter(Boolean).join(' · '),
        detail: `system/cfg/ppfilters/${parts.join(', ')}`, mode: 'ppfilter', filterId: id, paths: this.paths,
        files: parts.map(p => ({ src: join(this.abs(rel), p), target: dir && join(dir, p), dir: n.dirs.includes(p) })),
        note: KUNOS_FILTERS.has(id.toLowerCase()) ? `Replaces AC's own ${id} filter.` : '',
        missing: dir ? '' : 'Assetto Corsa not found',
      });
    }
    return used;
  }

  // --- Assetto Corsa

  acMissing() { return this.paths.ac.content ? '' : 'Assetto Corsa not found'; }

  async addAcCar(rel, id = this.folderId(rel)) {
    const n = this.node(rel), ui = kid(n, 'ui');
    const info = ui && parseLooseJson(await readText(join(this.abs(rel), ui, 'ui_car.json')));
    const skins = kid(n, 'skins'), skinNode = skins && this.node(sub(rel, skins));
    const preview = skinNode?.dirs.map(s => [s, kid(this.node(sub(sub(rel, skins), s)), 'preview.jpg', 'files')]).find(([, p]) => p);
    this.add({
      game: 'ac', kind: 'car', tab: 'cars', title: cleanText(info?.name) || prettifyId(id),
      sub: [info?.brand, info?.author && `by ${cleanText(info.author)}`].filter(Boolean).join(' · '),
      detail: `content/cars/${id}`, mode: 'dir', src: this.abs(rel),
      target: this.paths.ac.content && join(this.paths.ac.content, 'cars', id),
      image: preview ? fileUrl(join(this.abs(rel), skins, preview[0], preview[1])) : '',
      missing: this.acMissing(),
    });
  }

  async addAcTrack(rel, id = this.folderId(rel)) {
    const n = this.node(rel), ui = kid(n, 'ui'), uiRel = ui && sub(rel, ui), un = ui && this.node(uiRel);
    let uiDir = un && kid(un, 'ui_track.json', 'files') ? uiRel : '';
    if (un && !uiDir) uiDir = un.dirs.map(d => sub(uiRel, d)).find(r => kid(this.node(r), 'ui_track.json', 'files')) || '';
    const info = uiDir && parseLooseJson(await readText(join(this.abs(uiDir), 'ui_track.json')));
    const preview = uiDir && kid(this.node(uiDir), 'preview.png', 'files');
    const layouts = un ? un.dirs.filter(d => kid(this.node(sub(uiRel, d)), 'ui_track.json', 'files')).length : 0;
    this.add({
      game: 'ac', kind: 'track', tab: 'tracks', title: cleanText(info?.name) || prettifyId(id),
      sub: [info?.country, layouts > 1 && `${layouts} layouts`, info?.author && `by ${cleanText(info.author)}`].filter(Boolean).join(' · '),
      detail: `content/tracks/${id}`, mode: 'dir', src: this.abs(rel),
      target: this.paths.ac.content && join(this.paths.ac.content, 'tracks', id),
      image: preview ? fileUrl(join(this.abs(uiDir), preview)) : '',
      missing: this.acMissing(),
    });
  }

  // A skin needs to know its car. Inside content/cars/<car>/skins the car is
  // known; otherwise guess from folder/archive names and let the user pick.
  addAcSkin(rel, car) {
    const id = this.folderId(rel), n = this.node(rel), preview = kid(n, 'preview.jpg', 'files');
    this.add({
      game: 'ac', kind: 'skin', tab: 'cars', title: prettifyId(id), skinId: id, car: car || '', carPick: 'ac',
      detail: `content/cars/${car || '<car>'}/skins/${id}`, mode: 'dir', src: this.abs(rel), target: '',
      image: preview ? fileUrl(join(this.abs(rel), preview)) : '', missing: this.acMissing(),
    });
  }

  // --- AC EVO external liveries (LiveryLab Evo packages and hand-made ones):
  //   <folder>\external_livery.json (+ livery_thumbnail.png, EXT_*.png textures)
  //   ...carfinalstatewithconsumable named <car id>_<car_guid>, usually in <folder>\SavedCar
  // The folder goes to Saved Games\ACE\ExternalLiveries, the car to the profile's SavedCars.

  async addEvoLivery(rel) {
    const id = rel ? basename(rel) : stem(this.archiveName), n = this.node(rel), abs = this.abs(rel);
    const json = parseLooseJson(await readText(join(abs, kid(n, 'external_livery.json', 'files')))) || {};
    const guid = String(json.car_guid || '').toLowerCase();
    // The car file can sit anywhere in the package; match it by the livery's car_guid.
    const saved = [...this.nodes].flatMap(([r, x]) => x.files.filter(f => /\.carfinalstatewithconsumable$/i.test(f)).map(f => ({ rel: r, file: f })))
      .filter(s => !guid || s.file.toLowerCase().includes(guid));
    // LiveryLab adds a manifest.json with the display name and car model.
    const manifest = await this.findManifest();
    const carId = manifest?.skin?.carModel || saved[0]?.file.replace(/_[0-9a-f-]{36}\..*$/i, '') || '';
    const thumb = kid(n, 'livery_thumbnail.png', 'files') || n.files.find(f => IMG_RE.test(f) && !/^EXT_/i.test(f));
    const missing = !this.paths.evo.install && !(await exists(this.paths.evo.profiles)) ? 'Assetto Corsa EVO not found' : '';
    this.add({
      game: 'evo', kind: 'livery', tab: 'liveries',
      title: manifest?.skin?.displayName || prettifyId(id),
      sub: [carId && prettifyId(carId), saved.length ? 'livery + garage car' : 'livery only (no car file: visible online, not drivable)'].filter(Boolean).join(' · '),
      detail: `ExternalLiveries/${id}${saved.length ? ' + SavedCars' : ''}`,
      mode: 'evo-livery', src: abs, target: join(this.paths.evo.liveries, id), paths: this.paths,
      savedCars: saved.map(s => ({ src: join(this.abs(s.rel), s.file), file: s.file })),
      image: thumb ? fileUrl(join(abs, thumb)) : '', missing,
    });
  }

  async findManifest() {
    if (this._manifest !== undefined) return this._manifest;
    this._manifest = null;
    for (const [rel, n] of this.nodes) {
      const f = kid(n, 'manifest.json', 'files');
      if (!f) continue;
      const m = parseLooseJson(await readText(join(this.abs(rel), f)));
      if (m?.skin) { this._manifest = m; break; }
    }
    return this._manifest;
  }

  // --- AC Rally native liveries: <Liveries>\<CarId>\<LiveryName>\ (livery.json,
  // icon.png, body_livery_*.dds). The folder doesn't say which car it is for.

  // The car comes from the livery's design (rallylivery.js) when that's sure, else
  // from the folder or archive name; when neither is, the likely cars are listed first.
  async addRallyLivery(rel) {
    const id = rel ? basename(rel) : stem(this.archiveName), n = this.node(rel);
    const icon = kid(n, 'icon.png', 'files') || n.files.find(f => IMG_RE.test(f));
    const byName = this.guessRallyCar([...(rel ? rel.split('/') : []), this.archiveName]);
    const byDesign = await guessLiveryCar(this.abs(rel), this.paths, this.rallyCars).catch(err => { log(`livery car: ${err?.message || err}`); return null; });
    this.add({
      game: 'rally', kind: 'livery', tab: 'liveries', title: id, skinId: id, carPick: 'rally',
      car: byDesign?.sure ? byDesign.car : byName,
      detected: byDesign?.sure ? byDesign.car : '',
      likely: byDesign && !byDesign.sure ? byDesign.likely : [],
      sub: 'Custom livery', detail: '', mode: 'dir', src: this.abs(rel), target: '',
      image: icon ? fileUrl(join(this.abs(rel), icon)) : '',
      missing: this.paths.rally.install || this.paths.rally.liveries ? '' : 'Assetto Corsa Rally not found',
    });
  }

  guessRallyCar(names) { return guessRallyCar(names, this.rallyCars); }

  // Livery packs often ship the same livery twice: as the game's own livery folder
  // and as a .pak for older Rally versions (e.g. KRUUDA/ + 2014_Kruuda_208_P.pak).
  // Installing both shows the livery twice, so keep the folder (it adds a livery
  // instead of replacing an official one) and skip the pak with a matching name.
  dropRallyPakTwins() {
    const folders = this.items.filter(i => i.game === 'rally' && i.carPick === 'rally');
    const paks = this.items.filter(i => i.game === 'rally' && i.pakName);
    const words = s => (String(s).toLowerCase().match(/[a-z0-9]{3,}/g) || []).filter(w => /[a-z]/.test(w));
    for (const p of paks) {
      const pw = new Set(words(p.pakName));
      const twin = folders.find(f => words(f.skinId).some(w => pw.has(w))) || (folders.length === 1 && paks.length === 1 ? folders[0] : null);
      if (!twin) continue;
      this.items.splice(this.items.indexOf(p), 1);
      twin.note = `Also in the archive as ${p.pakName}.pak (for older Rally versions); that copy is skipped.`;
    }
  }

  guessCar(rel) {
    const names = [...(rel ? rel.split('/') : []), stem(this.archiveName)].map(s => s.toLowerCase());
    const exact = names.find(s => this.acCars.has(s));
    if (exact) return exact;
    // Longest installed car id contained in a folder or archive name.
    return [...this.acCars].filter(id => id.length > 4 && names.some(s => s.includes(id))).sort((a, b) => b.length - a.length)[0] || '';
  }

  async addAcRoot(rel) {
    const n = this.node(rel), extras = [];
    // A filter next to an AC-root layout ("X.ini" + extension/textures/...).
    await this.addPpFilters(rel);
    for (const d of n.dirs) {
      const dRel = sub(rel, d), dl = d.toLowerCase();
      if (dl === 'content') {
        for (const c of this.node(dRel).dirs) {
          const cRel = sub(dRel, c), cl = c.toLowerCase();
          if (cl !== 'cars' && cl !== 'tracks') { extras.push({ rel: cRel, to: `content/${c}` }); continue; }
          for (const x of this.node(cRel).dirs) {
            const xRel = sub(cRel, x), skins = kid(this.node(xRel), 'skins');
            if (cl === 'cars' && this.isAcCar(xRel)) await this.addAcCar(xRel, x);
            else if (cl === 'tracks' && this.isAcTrack(xRel)) await this.addAcTrack(xRel, x);
            else if (cl === 'cars' && skins) {
              // Skin pack: content/cars/<car>/skins/<skin>, without the car itself.
              for (const s of this.node(sub(xRel, skins)).dirs) this.addAcSkin(sub(sub(xRel, skins), s), x.toLowerCase());
            } else extras.push({ rel: xRel, to: `content/${cl}/${x}` });
          }
        }
      } else if (AC_ROOT_DIRS.has(dl)) extras.push({ rel: dRel, to: d });
    }
    // Custom Shaders Patch ships dwrite.dll next to extension/.
    if (kid(n, 'extension')) for (const f of n.files) if (/\.dll$/i.test(f)) extras.push({ rel: sub(rel, f), to: f, file: true });
    if (!extras.length) return;

    const apps = extras.filter(e => /^apps\/(python|lua)\/[^/]+/i.test(e.to) || /^apps$/i.test(e.to));
    const appNames = apps.length ? this.node(apps[0].rel).dirs.flatMap(k => this.node(sub(apps[0].rel, k))?.dirs || []) : [];
    // CSP weather styles (extension/weather/<style>): Peter Boese's Sol and Pure are named after themselves.
    const ext = kid(n, 'extension'), weatherDir = ext && kid(this.node(sub(rel, ext)), 'weather');
    const styles = [];
    if (weatherDir) {
      const wRel = sub(sub(rel, ext), weatherDir);
      for (const d of this.node(wRel).dirs) {
        const name = (await readText(this.abs(sub(sub(wRel, d), 'manifest.ini'))))?.match(/^\s*NAME\s*=\s*(.+?)\s*$/mi)?.[1];
        styles.push({ id: d, name: name || prettifyId(d) });
      }
    }
    const style = styles.find(s => /pure/i.test(`${s.id} ${s.name}`)) ? 'Pure' : styles.find(s => /^sol\b/i.test(s.id) || /^sol\b/i.test(s.name)) ? 'Sol' : '';
    const title = ext && extras.some(e => /\.dll$/i.test(e.to)) ? 'Custom Shaders Patch'
      : style ? `${style} by Peter Boese`
      : styles.length ? `Weather style: ${styles.map(s => s.name).join(', ')}`
      : appNames.length ? `App: ${appNames.map(prettifyId).join(', ')}` : 'Assetto Corsa extras';
    this.add({
      game: 'ac', kind: 'extras', tab: null, title,
      sub: styles.length && !/^Custom/.test(title) ? 'Merged into the Assetto Corsa folder. Pick it as the weather style in Settings (needs CSP).' : 'Merged into the Assetto Corsa folder',
      detail: extras.map(e => e.to).join(', '), mode: 'merge',
      pairs: extras.map(e => ({ src: this.abs(e.rel), target: this.paths.ac.install && join(this.paths.ac.install, e.to), file: !!e.file })),
      missing: this.paths.ac.install ? '' : 'Assetto Corsa not found',
    });
  }

  // --- ACC

  addAccLivery(rel) {
    const id = rel ? basename(rel) : stem(this.archiveName), n = this.node(rel);
    const img = kid(n, 'decals.png', 'files') || kid(n, 'sponsors.png', 'files');
    this.add({
      game: 'acc', kind: 'livery', tab: 'liveries', title: id, sub: 'Livery folder',
      detail: `Customs/Liveries/${id}`, mode: 'dir', src: this.abs(rel),
      target: join(this.paths.acc.customs, 'Liveries', id), image: img ? fileUrl(join(this.abs(rel), img)) : '',
    });
    // Car files sometimes sit inside the livery folder.
    return this.addFiles(this.abs(rel), n.files.filter(f => /\.json$/i.test(f) && !/^(decals|sponsors)\.json$/i.test(f)));
  }

  async addAccCar(dir, file) {
    const text = await readTextAnyEncoding(join(dir, file));
    if (!text || !/"carModelType"/.test(text)) return false;
    const json = parseLooseJson(text) || {};
    const title = [json.teamName, json.raceNumber != null && `#${json.raceNumber}`].filter(Boolean).join(' ') || stem(file);
    this.add({
      game: 'acc', kind: 'car file', tab: 'liveries', title, sub: json.customSkinName ? `Uses livery "${json.customSkinName}"` : 'Car file',
      detail: `Customs/Cars/${file}`, mode: 'files', files: [{ src: join(dir, file), target: join(this.paths.acc.customs, 'Cars', file) }],
    });
    return true;
  }

  // --- Loose files: EVO packages, Rally paks, ACC car files

  async addFiles(dir, files) {
    const lower = new Map(files.map(f => [f.toLowerCase(), f]));
    const sidecar = base => ['png', 'jpg', 'jpeg', 'webp'].map(x => lower.get(`${base.toLowerCase()}.${x}`)).find(Boolean);
    const paks = new Set();
    for (const f of files) {
      if (/\.kspkg$/i.test(f)) await this.addEvo(dir, f, sidecar(stem(f)));
      else if (/\.(pak|utoc|ucas)$/i.test(f)) paks.add(stem(f).toLowerCase());
      else if (/\.json$/i.test(f) && !/^(decals|sponsors)\.json$/i.test(f)) await this.addAccCar(dir, f);
    }
    // Archive previews for .pak liveries are rarely named after the pak ("00.jpg",
    // "preview.png"); use the most likely one and install it as <pak name>.<ext>.
    const preview = files.filter(f => IMG_RE.test(f))
      .sort((a, b) => +!/^(0*\d|preview|cover|thumb|screenshot|image)/i.test(a) - +!/^(0*\d|preview|cover|thumb|screenshot|image)/i.test(b) || a.localeCompare(b))[0];
    for (const base of paks) {
      const trio = ['pak', 'utoc', 'ucas'].map(x => lower.get(`${base}.${x}`)).filter(Boolean);
      if (!trio.some(f => /\.pak$/i.test(f))) continue;
      const name = stem(trio[0]);
      const img = sidecar(base) || preview;
      const modsDir = this.rallyMods;
      const utoc = trio.find(f => /\.utoc$/i.test(f));
      const [toc, gameToc] = await Promise.all([utoc ? utocVersion(join(dir, utoc)) : null, rallyGameTocVersion(this.paths)]);
      const stale = toc != null && gameToc != null && toc !== gameToc;
      this.add({
        ...(stale ? { selected: false, note: 'Built for another version of Rally: the game crashes at startup while it is installed, so it is unchecked.' } : {}),
        game: 'rally', kind: 'livery', tab: 'liveries', title: prettifyId(name.replace(/_P$/i, '')), pakName: name, sub: `Pak livery (${trio.map(f => f.split('.').pop()).join(' + ')})`,
        detail: modsDir ? `Paks/${basename(modsDir)}/${name}` : name, mode: 'files',
        files: [
          ...trio.map(f => ({ src: join(dir, f), target: modsDir && join(modsDir, f) })),
          ...(img ? [{ src: join(dir, img), target: modsDir && join(modsDir, `${name}.${img.split('.').pop().toLowerCase()}`), copy: true }] : []),
        ],
        image: img ? fileUrl(join(dir, img)) : '', missing: modsDir ? '' : 'Assetto Corsa Rally not found',
      });
    }
  }

  async addEvo(dir, file, img) {
    let info = null;
    try { info = this.evoCache && await readModInfo(join(dir, file), this.evoCache); } catch (err) { log(`import evo info: ${err?.message || err}`); }
    this.add({
      game: 'evo', kind: info?.kind === 'track' ? 'track' : 'car', tab: info?.kind === 'track' ? 'tracks' : 'cars',
      title: info?.name || prettifyId(file), sub: [info?.brand, 'EVO package'].filter(Boolean).join(' · '),
      detail: `mods/${file}`, mode: 'files',
      files: [file, img].filter(Boolean).map(f => ({ src: join(dir, f), target: join(this.paths.evo.mods, f) })),
      image: img ? fileUrl(join(dir, img)) : info?.thumbs?.[0] ? fileUrl(info.thumbs[0].path) : '',
    });
  }
}

// Rally liveries go to Paks\~mods (Unreal loads it after the base game paks).
async function rallyModsDir(paths) {
  if (!paths.rally.paks) return '';
  const existing = (await listDir(paths.rally.paks)).find(e => e.type === 'DIRECTORY' && /^~?mods$/i.test(e.entry));
  return join(paths.rally.paks, existing ? existing.entry : '~mods');
}

async function acCarIds(paths) {
  if (!paths.ac.content) return new Set();
  return new Set((await listDir(join(paths.ac.content, 'cars'))).filter(e => e.type === 'DIRECTORY').map(e => e.entry.toLowerCase()));
}

async function itemExists(item) {
  if (item.mode === 'dir' || item.mode === 'evo-livery') return !!item.target && exists(item.target);
  if (item.mode === 'files') {
    for (const f of item.files) if (f.target && (await exists(f.target) || await exists(`${f.target}.disabled`))) return true;
  }
  if (item.mode === 'ppfilter') return !!item.files[0].target && exists(item.files[0].target);
  return false;
}

// AC skins and Rally liveries go under a car folder the user can change.
export async function setItemCar(item, paths, car) {
  item.car = car;
  if (item.carPick === 'rally') {
    item.target = car && paths.rally.liveries ? join(paths.rally.liveries, car, item.skinId) : '';
    item.detail = `My Games/acr/Liveries/${car || '<car>'}/${item.skinId}`;
    item.sub = !car ? 'Custom livery · choose the car'
      : `Custom livery · ${rallyCarName(car)}${car === item.detected ? ' (detected)' : ''}`;
  } else {
    item.target = car && paths.ac.content ? join(paths.ac.content, 'cars', car, 'skins', item.skinId) : '';
    item.detail = `content/cars/${car || '<car>'}/skins/${item.skinId}`;
  }
  item.exists = await itemExists(item);
}

export async function carChoices(kind, paths, acCarItems = []) {
  if (kind === 'rally') return (await rallyCarIds(paths)).map(id => ({ id, title: rallyCarName(id) }));
  return acCarItems.map(c => ({ id: c.id.toLowerCase(), title: c.title })).sort((a, b) => a.title.localeCompare(b.title));
}

// source: { path, temp, session? } -> { session: [dirs to discard], items }
export async function prepareImport(source, paths, opts = {}) {
  const session = join(await staging(), `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 4)}`);
  await ensureDir(session);
  try {
    const items = await detectSource(source, session, paths, opts);
    return { session: source.session ? [session, source.session] : [session], items };
  } catch (err) {
    await discardImport(session);
    if (source.session) await discardImport(source.session);
    throw err;
  }
}

async function detectSource(source, session, paths, { evoCache, onStatus } = {}) {
  const name = basename(source.path);
  const ctx = {
    paths, archiveName: name, copyOnly: !source.temp, evoCache,
    acCars: await acCarIds(paths), rallyMods: await rallyModsDir(paths), rallyCars: await rallyCarIds(paths),
  };

  let det;
  if (ARCHIVE_RE.test(name)) {
    onStatus?.(`Extracting ${name}…`);
    const root = join(session, 'x');
    await ensureDir(root);
    await extractArchive(source.path, root);
    let nodes = await scanTree(root);
    // Packs sometimes wrap more archives; extract those once, in place.
    const inner = [...nodes].flatMap(([rel, n]) => n.files.filter(f => ARCHIVE_RE.test(f)).map(f => sub(rel, f)));
    if (inner.length && inner.length <= 20) {
      for (const rel of inner) {
        onStatus?.(`Extracting ${basename(rel)}…`);
        const out = join(root, `${rel}~`);
        await ensureDir(out);
        await extractArchive(join(root, rel), out).catch(err => log(`inner archive ${rel}: ${err.message}`));
      }
      nodes = await scanTree(root);
    }
    onStatus?.(`Looking inside ${name}…`);
    det = new Detector({ ...ctx, root, nodes, copyOnly: false });
    await det.walk('');
    det.dropRallyPakTwins();
  } else {
    // A single mod file: only it (and a Rally pak's .utoc/.ucas siblings) count.
    const dir = parentOf(source.path);
    let files = [name];
    if (/\.(pak|utoc|ucas)$/i.test(name)) {
      for (const x of ['pak', 'utoc', 'ucas', 'png', 'jpg']) {
        const f = `${stem(name)}.${x}`;
        if (f !== name && await exists(join(dir, f))) files.push(f);
      }
    }
    // A PP filter .ini, with its <name>.lua when it sits next to it.
    if (/\.ini$/i.test(name)) {
      for (const e of await listDir(dir)) if (e.type !== 'DIRECTORY' && e.entry !== name && ppFilterCompanions([e], stem(name)).length) files.push(e.entry);
    }
    det = new Detector({ ...ctx, root: dir, nodes: new Map([['', { files, dirs: [] }]]) });
    if (/\.ini$/i.test(name)) await det.addPpFilters('');
    else await det.addFiles(dir, files);
  }

  for (const item of det.items) {
    if (item.carPick) await setItemCar(item, paths, item.car);
    else item.exists = await itemExists(item);
    if (item.mode === 'ppfilter' && item.exists) item.note = [item.note, 'The installed version is backed up first.'].filter(Boolean).join(' ');
  }
  log(`import ${name}: ${det.items.map(i => `${i.game}/${i.kind} ${i.detail}`).join(' | ') || 'nothing recognised'}`);
  return det.items;
}

// ---------------------------------------------------------------------------
// Install. New folders are moved from staging when possible; updates are copied
// over the existing folder (merged), so nothing the user added is deleted.

async function placeDir(src, target, copyOnly) {
  await ensureDir(parentOf(target));
  if (!copyOnly && !(await exists(target))) {
    try { await Neutralino.filesystem.move(src, target); return; } catch { /* other drive: copy */ }
  }
  await ensureDir(target);
  await Neutralino.filesystem.copy(src, target, { recursive: true, overwrite: true });
}

async function placeFile(src, target, copyOnly) {
  await ensureDir(parentOf(target));
  // An older, disabled copy of the same mod would show up twice.
  await Neutralino.filesystem.remove(`${target}.disabled`).catch(() => {});
  if (!copyOnly) {
    await Neutralino.filesystem.remove(target).catch(() => {});
    try { await Neutralino.filesystem.move(src, target); return; } catch { /* other drive: copy */ }
  }
  await Neutralino.filesystem.copy(src, target, { overwrite: true });
}

export async function installItem(item) {
  if (item.missing) throw new Error(item.missing);
  if (item.mode === 'dir') {
    if (!item.target) throw new Error(item.carPick ? 'Pick the car first' : 'No target folder');
    await placeDir(item.src, item.target, item.copyOnly);
  } else if (item.mode === 'files') {
    for (const f of item.files) await placeFile(f.src, f.target, item.copyOnly || f.copy);
  } else if (item.mode === 'evo-livery') {
    // The garage car first (copied: it may live inside the livery folder), then the
    // livery folder itself, minus the SavedCar copy EVO doesn't need there.
    if (item.savedCars.length) {
      const dir = await evoSavedCarsDir(item.paths);
      if (!dir) throw new Error('no EVO profile found. Start EVO once, then install the livery again.');
      for (const s of item.savedCars) await placeFile(s.src, join(dir, s.file), true);
    }
    await placeDir(item.src, item.target, item.copyOnly);
    for (const e of await listDir(item.target)) {
      if (e.type === 'DIRECTORY' && /^savedcars?$/i.test(e.entry)) await Neutralino.filesystem.remove(join(item.target, e.entry)).catch(() => {});
    }
  } else if (item.mode === 'ppfilter') {
    // The installed version is backed up and removed first (ppfilters.js).
    await beforePpFilterInstall(item.paths, item.filterId);
    for (const f of item.files) {
      if (f.dir) { await ensureDir(f.target); await Neutralino.filesystem.copy(f.src, f.target, { recursive: true, overwrite: true }); }
      else await placeFile(f.src, f.target, item.copyOnly);
    }
  } else if (item.mode === 'merge') {
    for (const p of item.pairs) {
      if (p.file) await placeFile(p.src, p.target, true);
      else { await ensureDir(p.target); await Neutralino.filesystem.copy(p.src, p.target, { recursive: true, overwrite: true }); }
    }
  }
}
