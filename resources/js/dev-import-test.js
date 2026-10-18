// Dev aid: `--import-test=<config.json>` runs archives through the installer into
// sandbox folders, exercises the drop path, snapshots the UI, writes a report, exits.
// config: { paths, archives: [path], evoCache, dropFiles: [{ path, name }], uiDrop,
//           uiInstall: { files: [path], exitAt }, snapDir, out }
import { prepareImport, installItem, discardImport, setItemCar, resolveDropped } from './installer.js';
import { writeText, log, basename, storageGet, storageSet } from './util.js';
import { SCANNERS, uninstallPaths, uninstallItem } from './games.js';
import { frameCar, readModInfo, readCarPresets, readEvoExtras, pruneCache } from './kspkg.js';

const wait = ms => new Promise(r => setTimeout(r, ms));
const fileFrom = async (path, name) => new File([await Neutralino.filesystem.readBinaryFile(path)], name || basename(path));

export async function runImportTest(configPath, hooks = {}) {
  const cfg = JSON.parse(await Neutralino.filesystem.readFile(configPath));
  const report = { archives: [], drops: [] };
  for (const a of cfg.archives) {
    const r = { archive: basename(a) };
    const t0 = Date.now();
    try {
      const p = await prepareImport({ path: a, temp: false }, cfg.paths, { evoCache: cfg.evoCache });
      r.items = p.items.map(i => ({ game: i.game, kind: i.kind, title: i.title, sub: i.sub, detail: i.detail, exists: i.exists, missing: i.missing || undefined, car: i.car, image: !!i.image }));
      for (const i of p.items) {
        if (i.carPick && !i.car) await setItemCar(i, cfg.paths, i.carPick === 'ac' ? 'ks_test_existing' : 'Peugeot206');
        await installItem(i);
      }
      for (const s of p.session) await discardImport(s);
    } catch (e) { r.error = e?.message || JSON.stringify(e); }
    r.ms = Date.now() - t0;
    report.archives.push(r);
  }

  for (const d of cfg.dropFiles || []) {
    const t0 = Date.now();
    try {
      const file = await fileFrom(d.path, d.name);
      const src = await resolveDropped(file);
      const st = await Neutralino.filesystem.getStats(src.path);
      report.drops.push({ name: file.name, resolved: src.path, temp: src.temp, sizeOk: st.size === file.size, ms: Date.now() - t0 });
      if (src.session) await discardImport(src.session);
    } catch (e) { report.drops.push({ name: d.name, error: e?.message || JSON.stringify(e) }); }
  }

  // Raw filesystem probes: [{ op: 'copy'|'remove'|'list', a, b?, opts? }]
  if (cfg.fs) {
    report.fs = [];
    for (const t of cfg.fs) {
      try {
        const r = t.op === 'copy' ? await Neutralino.filesystem.copy(t.a, t.b, t.opts || {})
          : t.op === 'remove' ? await Neutralino.filesystem.remove(t.a)
          : await Neutralino.filesystem.readDirectory(t.a);
        report.fs.push({ ...t, ok: true, r });
      } catch (e) { report.fs.push({ ...t, error: e }); }
    }
  }

  // Scan sandbox folders after installing; optionally uninstall what was found.
  if (cfg.scan) {
    report.scan = [];
    for (const { game, tab, uninstall } of cfg.scan) {
      const items = await SCANNERS[game][tab](cfg.paths);
      const r = { game, tab, items: items.map(i => ({ title: i.title, subtitle: i.subtitle, image: !!i.image, paths: uninstallPaths(i) })) };
      if (uninstall) {
        for (const i of items) { try { await uninstallItem(i); } catch (e) { r.uninstallError = e.message; } }
        r.afterUninstall = (await SCANNERS[game][tab](cfg.paths)).length;
      }
      report.scan.push(r);
    }
  }

  if (cfg.trash) {
    report.trash = [];
    for (const p of cfg.trash) {
      try { await Neutralino.os.trashItem(p); report.trash.push({ p, ok: true }); }
      catch (e) { report.trash.push({ p, error: e?.message || JSON.stringify(e) }); }
    }
  }

  // Opens a mod from the Mods page and uninstalls it through the detail dialog.
  if (cfg.uiUninstall) {
    const { game, title } = cfg.uiUninstall;
    document.querySelector(`#game-list [data-game="${game}"]`).click();
    await wait(300);
    document.querySelector('#nav [data-view="mods"]').click();
    let card = null;
    for (let i = 0; i < 80 && !card; i++) { await wait(250); card = [...document.querySelectorAll('.card')].find(c => c.querySelector('.card-title')?.textContent === title); }
    report.uninstall = { found: !!card };
    if (card) {
      card.click(); await wait(1200);
      await Neutralino.window.snapshot(`${cfg.snapDir}/uninstall-detail.png`);
      const btn = document.querySelector('[data-a="uninstall"]');
      report.uninstall.button = !!btn;
      btn?.click(); await wait(300);
      report.uninstall.armedText = btn?.textContent;
      btn?.click(); await wait(2500);
      report.uninstall.stillListed = [...document.querySelectorAll('.card-title')].some(t => t.textContent === title);
      report.uninstall.toast = document.querySelector('#toast')?.textContent;
      await Neutralino.window.snapshot(`${cfg.snapDir}/uninstall-after.png`);
    }
  }

  if (cfg.uiDrop) {
    const dt = new DataTransfer();
    dt.items.add(await fileFrom(cfg.uiDrop));
    window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true }));
    await wait(600);
    await Neutralino.window.snapshot(`${cfg.snapDir}/drop-overlay.png`);
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    for (let i = 0; i < 60 && !document.querySelector('.imp-list'); i++) await wait(250);
    await wait(1500);
    await Neutralino.window.snapshot(`${cfg.snapDir}/install-review.png`);
    report.ui = { reviewRows: document.querySelectorAll('.imp-row').length };
    document.querySelector('#modal-root [data-close]')?.click();
    await wait(500);
  }

  // The drop target with uiRead.dragCount files over it, then uiRead.paths read as
  // if dropped (hooks.importPaths): the reading window while it works, the review
  // when it opens. Nothing is installed.
  if (cfg.uiRead) {
    const u = cfg.uiRead, snap = name => Neutralino.window.snapshot(`${cfg.snapDir}/${name}.png`);
    const dt = new DataTransfer();
    for (let i = 0; i < (u.dragCount || 1); i++) dt.items.add(new File(['x'], `f${i}.zip`));
    window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true }));
    await wait(600); await snap('read-overlay');
    window.dispatchEvent(new DragEvent('dragleave', { dataTransfer: dt, bubbles: true }));
    hooks.importPaths(u.paths);
    for (const [k, ms] of (u.snapsAt || [1500]).entries()) { await wait(ms); await snap(`read-progress-${k}`); }
    for (let i = 0; i < 2400 && !document.querySelector('.imp-list input'); i++) await wait(250);
    await wait(2000); await snap('read-review');
    report.uiRead = { rows: [...document.querySelectorAll('.imp-row')].map(r => r.querySelector('b')?.textContent) };
    document.querySelector('#modal-root [data-close]')?.click();
    await wait(500);
  }

  // Installs through the UI into the sandbox (cfg.paths, through hooks.usePaths):
  // drops uiInstall.files one after another (the later ones while the first still
  // installs), snapshots the progress dialog and the title bar's pill, then waits
  // for the end; or, with exitAt (a percent), closes the launcher half way.
  if (cfg.uiInstall) {
    const u = cfg.uiInstall, snap = name => Neutralino.window.snapshot(`${cfg.snapDir}/${name}.png`);
    hooks.usePaths(cfg.paths);
    const pill = () => { const p = document.querySelector('#install-pill'); return p.hidden ? '' : p.textContent; };
    const pct = () => parseInt(document.querySelector('#install-pill:not([hidden]) b')?.textContent, 10) || 0;
    const rows = () => [...document.querySelectorAll('.imp-q')].map(r => `${r.querySelector('b').textContent}: ${r.querySelector('.imp-tag').textContent} | ${r.querySelector('.imp-q-line').textContent}`);
    report.install = { steps: [] };
    const step = async name => {
      report.install.steps.push({ name, t: Date.now(), pill: pill(), rows: rows(), toast: document.querySelector('#toast.show')?.textContent || '' });
      await snap(name);
    };
    const drop = async path => {
      const dt = new DataTransfer();
      dt.items.add(await fileFrom(path));
      window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
      for (let i = 0; i < 400 && !document.querySelector('#imp-go'); i++) await wait(250);
      await wait(500);
      document.querySelector('#imp-go')?.click();
      await wait(800);
    };
    await drop(u.files[0]);
    await wait(2500); await step('dialog-start');
    document.querySelector('#modal-root [data-close]')?.click();
    await wait(600); await step('hidden');
    for (const f of u.files.slice(1)) { await drop(f); await wait(1000); await step('queued'); }
    const until = async p => { for (let i = 0; i < 3000 && pill() && pct() < p; i++) await wait(100); };
    if (u.exitAt != null) {
      await until(u.exitAt);
      document.querySelector('#win-close').click();
      await wait(600); await step('exit-ask');
      await writeText(cfg.out, JSON.stringify(report, null, 1));
      document.querySelector('#exit-anyway').click();
      return; // the launcher closes itself
    }
    document.querySelector('#modal-root [data-close]')?.click();
    await until(45); await wait(300); await step('pill-mid');
    document.querySelector('#install-pill').click();
    await wait(800); await step('dialog-mid');
    for (let i = 0; i < 3000 && pill(); i++) await wait(100);
    await wait(300); await step('done');
  }

  // EVO mod tracks in Quick Drive: the track scan's items, then EVO's Quick Drive.
  if (cfg.evoQd) {
    hooks.usePaths(cfg.paths);
    const items = await SCANNERS.evo.tracks(cfg.paths);
    report.evoQd = { tracks: items.map(i => ({ title: i.title, sub: i.subtitle, isMod: i.isMod, evoTrack: i.evoTrack, layouts: (i.layouts || []).map(l => ({ id: l.id, name: l.name, practice: l.practice, race: l.race, outline: l.outline, preview: !!l.preview })) })) };
    document.querySelector('#game-list [data-game="evo"]')?.click();
    await wait(500);
    document.querySelector('#nav-qd')?.click();
    for (let i = 0; i < 80 && !document.querySelector('#modal-root .qd'); i++) await wait(250);
    await wait(2500);
    await Neutralino.window.snapshot(`${cfg.snapDir}/evo-qd.png`);
    report.evoQd.dialog = (document.querySelector('#modal-root')?.innerText || '').slice(0, 1500);
  }

  // EVO's track list (evotracks.js) on a stand-in content.kspkg (cfg.paths.evo.install):
  // add the mod tracks, sync again (nothing to do), restore, stay off, add again.
  // evoTracks.saveAt: a copy of the package as it is after the first add.
  if (cfg.evoTracks) {
    const m = await import('./evotracks.js'), r = report.evoTracks = {}, file = `${cfg.paths.evo.install}/content.kspkg`;
    const free = { isRunning: async () => false }; // the stand-in package isn't EVO's
    const step = async (name, fn) => { const t0 = Date.now(); try { r[name] = await fn(); } catch (e) { r[name] = { error: e?.message || String(e) }; } r[`${name}Ms`] = Date.now() - t0; };
    await step('status0', () => m.evoTrackListStatus(cfg.paths));
    await step('add', () => m.syncEvoTrackList(cfg.paths, { ...free, force: true }));
    await Neutralino.filesystem.copy(file, cfg.evoTracks.saveAt, { overwrite: true });
    await step('status1', () => m.evoTrackListStatus(cfg.paths));
    await step('again', () => m.syncEvoTrackList(cfg.paths, free));
    await step('restore', () => m.restoreEvoTrackList(cfg.paths, free));
    await step('status2', () => m.evoTrackListStatus(cfg.paths));
    await step('whileOff', () => m.syncEvoTrackList(cfg.paths, free));
    await step('forced', () => m.syncEvoTrackList(cfg.paths, { ...free, force: true }));
    if (cfg.snapDir) {
      hooks.usePaths(cfg.paths);
      document.querySelector('#nav [data-view="settings"]').click();
      for (let i = 0; i < 40 && !document.querySelector('[data-act="evo-tracks-restore"]'); i++) await wait(250);
      document.querySelector('[data-act="evo-tracks-restore"]')?.closest('.settings-group')?.scrollIntoView();
      await wait(600);
      await Neutralino.window.snapshot(`${cfg.snapDir}/settings-evo-tracks.png`);
    }
    await step('restore2', () => m.restoreEvoTrackList(cfg.paths, free));
    const all = await storageGet('evoTrackList', {});
    r.stateLeft = all[file] || null;
    delete all[file];
    await storageSet('evoTrackList', all);
  }

  // Mod car pictures: frameCar { files: [jpg], outDir } frames each picture as the
  // launcher does, timed; modInfo { files: [kspkg], cacheDir } reads packages as the
  // Mods page does; extras { pkg, cacheDir, count } makes Quick Drive's livery
  // pictures of a mod package; prune { dir, live: [key] } cleans a folder of files.
  if (cfg.frameCar) {
    report.frameCar = [];
    for (const f of cfg.frameCar.files) {
      const img = await createImageBitmap(new Blob([await Neutralino.filesystem.readBinaryFile(f)]));
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      c.getContext('2d').drawImage(img, 0, 0);
      const t0 = performance.now(), changed = frameCar(c), ms = performance.now() - t0;
      const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.88));
      await Neutralino.filesystem.writeBinaryFile(`${cfg.frameCar.outDir}/${basename(f)}`, await blob.arrayBuffer());
      report.frameCar.push({ file: basename(f), size: `${img.width}x${img.height}`, changed, ms: Math.round(ms * 10) / 10 });
    }
  }
  if (cfg.modInfo) {
    report.modInfo = [];
    for (const pass of ['first', 'cached']) {
      for (const f of cfg.modInfo.files) {
        const t0 = Date.now();
        try { const i = await readModInfo(f, cfg.modInfo.cacheDir); report.modInfo.push({ pass, file: basename(f), ms: Date.now() - t0, kind: i?.kind, framing: i?.framing, thumbs: i?.thumbs.map(t => t.file) }); }
        catch (e) { report.modInfo.push({ pass, file: basename(f), error: e?.message || String(e) }); }
      }
    }
  }
  if (cfg.extras) {
    const { pkg, cacheDir, count = 3 } = cfg.extras, name = p => basename(p.replace(/\\/g, '/')).replace(/\.\w+$/, '');
    const liveries = (await readCarPresets(pkg, cacheDir)).flatMap(p => p.visuals.map(v => ({ carId: p.carId, mech: name(p.mech), visual: name(v), pkgPath: pkg }))).slice(0, count);
    const run = async opts => { const t0 = Date.now(); const x = await readEvoExtras({ liveries, contentPkg: 'content.kspkg', ...opts }, cacheDir); return { ms: Date.now() - t0, liveries: x.liveries }; };
    report.extras = { cachedOnly: await run({ cachedOnly: true }), first: await run({}), again: await run({}), index: JSON.parse(await Neutralino.filesystem.readFile(`${cacheDir}/extras/index.json`)) };
  }
  // The Academy as players see it (what this version shows, academy-data.js):
  // each game's page, its level names, and a snapshot.
  if (cfg.academyPages) {
    const until = async sel => { for (let i = 0; i < 80 && !document.querySelector(sel); i++) await wait(250); return document.querySelector(sel); };
    const r = report.academyPages = {};
    (await until('#nav-academy')).click();
    for (const game of ['ac', 'evo', 'rally']) {
      (await until(`[data-ay-game="${game}"]`)).click();
      await wait(game === 'evo' ? 8000 : 3000);
      r[game] = { levels: [...document.querySelectorAll('.ay-level-head h3')].map(h => h.textContent), empty: document.querySelector('.ay-empty')?.textContent || '' };
      await Neutralino.window.snapshot(`${cfg.snapDir}/academy-page-${game}.png`);
    }
  }

  if (cfg.prune) {
    await pruneCache(cfg.prune.dir, new Set(cfg.prune.live));
    report.prune = (await Neutralino.filesystem.readDirectory(cfg.prune.dir)).filter(e => e.type === 'FILE').map(e => e.entry).sort();
  }

  await writeText(cfg.out, JSON.stringify(report, null, 1));
  log('import test done');
  await Neutralino.app.exit();
}
