// Dev aid: `--import-test=<config.json>` runs archives through the installer into
// sandbox folders, exercises the drop path, snapshots the UI, writes a report, exits.
// config: { paths, archives: [path], evoCache, dropFiles: [{ path, name }], uiDrop, snapDir, out }
import { prepareImport, installItem, discardImport, setItemCar, resolveDropped } from './installer.js';
import { writeText, log, basename } from './util.js';
import { SCANNERS, uninstallPaths, uninstallItem } from './games.js';

const wait = ms => new Promise(r => setTimeout(r, ms));
const fileFrom = async (path, name) => new File([await Neutralino.filesystem.readBinaryFile(path)], name || basename(path));

export async function runImportTest(configPath) {
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

  await writeText(cfg.out, JSON.stringify(report, null, 1));
  log('import test done');
  await Neutralino.app.exit();
}
