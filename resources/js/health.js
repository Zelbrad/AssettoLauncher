// Mod health checks: problems the launcher can see in the files of installed
// mods, per game. Each finding is { level: 'error' | 'warn' | 'info', item, problem }.
//   AC     car without data.acd / data folder or without a .kn5 model, car without
//          skins; track without a .kn5 (DLC placeholder or incomplete), layouts
//          without an AI line (no opponents)
//   EVO    packages that can't be read, two enabled packages adding the same car
//   ACC    liveries no car file uses, car files pointing at a missing livery folder
//   Rally  .pak liveries for another game version (crash) or missing their
//          .utoc/.ucas, several .pak liveries for the same car, folder liveries
//          without their texture or icon
import { join, listDir, readTextAnyEncoding, parseLooseJson } from './util.js';
import { rallyCarName } from './games.js';

export async function checkMods(game, getItems, paths) {
  const out = [];
  const add = (level, item, problem) => out.push({ level, item, problem });
  if (game.key === 'ac') {
    for (const c of (await getItems(game, 'cars')).filter(i => i.isMod)) {
      const files = await listDir(c.path);
      const has = re => files.some(e => re.test(e.entry));
      if (!has(/^data\.acd$/i) && !files.some(e => e.type === 'DIRECTORY' && /^data$/i.test(e.entry))) add('error', c, 'No data.acd or data folder: AC can\'t load this car.');
      if (!has(/\.kn5$/i)) add('error', c, 'No 3D model (.kn5): the download is incomplete.');
      if (!c.skins?.length) add('warn', c, 'No skins: the car has no paint to show.');
    }
    for (const t of (await getItems(game, 'tracks')).filter(i => i.isMod)) {
      if (t.playable === false) add('error', t, 'No track model (.kn5): it\'s an extra layout for a track (or DLC) you don\'t have, or the download is incomplete.');
      const noAi = (t.layouts || []).filter(l => !l.aiLine);
      if (t.playable !== false && noAi.length) add('info', t, `No AI line on ${noAi.length === t.layouts.length ? 'any layout' : noAi.map(l => l.name || l.id || 'default').join(', ')}: practice only, no opponents.`);
    }
  }
  if (game.key === 'evo') {
    const mods = [...await getItems(game, 'cars'), ...await getItems(game, 'tracks')].filter(i => i.isMod && i.toggle === 'evo');
    for (const m of mods) if (m.unreadable) add('error', m, 'The package can\'t be read: it\'s damaged or made for another EVO version.');
    const byCar = new Map();
    for (const m of mods.filter(m => m.enabled && m.carId)) byCar.set(m.carId, [...(byCar.get(m.carId) || []), m]);
    for (const [id, list] of byCar) if (list.length > 1) for (const m of list) add('warn', m, `${list.length} enabled packages add the same car (${id}): EVO loads only one of them.`);
  }
  if (game.key === 'acc') {
    const liveries = await getItems(game, 'liveries');
    // Unused livery folders are common (packs ship several), so many become one note.
    const unused = liveries.filter(l => !l.meta?.carFile);
    if (unused.length > 3) add('info', { title: `${unused.length} livery folders`, subtitle: 'Customs/Liveries', path: join(paths.acc.customs, 'Liveries') }, `No car file uses them, so they don't show up in ACC (${unused.slice(0, 4).map(l => l.title).join(', ')}…). The Liveries tab tags them "Livery only".`);
    else for (const l of unused) add('info', l, 'No car file uses this livery, so it doesn\'t show up in ACC.');
    const names = new Set(liveries.map(l => l.id.toLowerCase()));
    const carsDir = join(paths.acc.customs, 'Cars');
    for (const f of (await listDir(carsDir)).filter(e => /\.json$/i.test(e.entry))) {
      const car = parseLooseJson(await readTextAnyEncoding(join(carsDir, f.entry)));
      if (car?.customSkinName && !names.has(String(car.customSkinName).toLowerCase())) {
        add('warn', { title: f.entry.replace(/\.json$/i, ''), subtitle: 'Custom car', path: carsDir }, `Points at the livery folder "${car.customSkinName}", which is missing: ACC shows the car without it.`);
      }
    }
  }
  if (game.key === 'rally') {
    const liveries = await getItems(game, 'liveries');
    const paks = liveries.filter(i => i.toggle === 'rally');
    // Car and stage packages (Cars / Tracks tabs) can crash the game the same way.
    const content = [...await getItems(game, 'cars'), ...await getItems(game, 'tracks')].filter(i => i.toggle === 'rally');
    for (const p of [...paks, ...content]) {
      if (p.incompatible && p.enabled) add('error', p, 'Built for another version of Rally: the game crashes at startup while it\'s enabled. Disable it until the author updates it.');
      if (p.tags?.includes('missing files')) add('error', p, 'The .pak, .utoc or .ucas file is missing, so Rally can\'t load it.');
    }
    const byCar = new Map();
    for (const p of paks.filter(p => p.enabled && !p.incompatible)) {
      const car = /^(.*) · \.pak livery$/.exec(p.subtitle || '')?.[1];
      if (car) byCar.set(car, [...(byCar.get(car) || []), p]);
    }
    for (const [car, list] of byCar) if (list.length > 1) for (const p of list) add('warn', p, `${list.length} enabled .pak liveries replace the ${car}'s livery: only one of them shows.`);
    for (const f of liveries.filter(i => i.toggle === 'rally-folder')) {
      const files = (await listDir(f.path)).map(e => e.entry);
      if (!files.some(n => /^body_livery_albedo\.dds$/i.test(n))) add('error', f, `No body_livery_albedo.dds: the ${rallyCarName(f.meta.car)} shows without this paint.`);
      if (!files.some(n => /^icon\.(png|jpe?g)$/i.test(n))) add('info', f, 'No icon.png: Rally\'s livery menu shows it without a picture.');
    }
  }
  const order = { error: 0, warn: 1, info: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level] || a.item.title.localeCompare(b.item.title));
}
