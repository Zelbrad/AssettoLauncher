// The Academy's own levels for EVO and Rally (academy.js reads them). Each level
// unlocks with medals from the one before; its events go from short and gentle to
// long and hard, with better cars as the levels go up. A level's `bonus` event, a
// step up from it, opens with gold or better on all six (academy.js bonusLocked).
//
// EVO events are its own session types, set up as its Single Player menu would:
//   time trials: Practice on the layout's Time Attack version, best clean lap;
//     four targets from a platinum lap: gold 5 % slower, silver 10 %, bronze 15 %.
//     Platinum is meant to be hard: just under a quick, practised lap. Where the
//     player has driven the event, it's set from their best (`plat`, or by hand
//     with `times`: the S2000's and the Camaro's are the player's own pick); elsewhere
//     it's estimated from an older best of theirs with that car and layout
//     (`est`), made quicker the fewer laps it came from.
//   races: an Instant Race (or a weekend with qualifying) against a single-make AI
//     grid of the given skill range, from `start` on the grid; medals by finishing
//     position (`podium`: bronze, silver, gold places).
//   sprints: Kunos's own Driving Academy events, compiled into the EVO exe (the
//     list its "Licences" page is built from): a track container (`arch`,
//     "Academy R1-1") that puts a start arch with lights and a finish arch on the
//     layout, a car with its mechanical preset, a time of day, and gold, silver and
//     bronze times. The launcher's are 5 % quicker than Kunos's, with a platinum
//     (`kunos`: Kunos's bronze, silver, gold, then the platinum, in ms), or all four
//     set by the player after driving it (Racing licences 1 and 2). Run as an Instant
//     Race of one lap with no AI: standing start at the arch on the lights, timed
//     to the finish arch (academy.js readEvoSprint). `finish`: where the finish arch
//     is on the lap (EVO's npos, 0-1), measured on a drive, so the card shows as the
//     car crosses it from the first run (main.js archFinish; without it the first
//     run's card waits for EVO's log).
// Rally events are a stage in Free Practice with a car, time and weather. Targets
// come from the AI's time for that car and stage (rally-game.json "ai") with
// Rally's own medal margins (DT_MedalPercentageModifiers); platinum is beating
// the AI's time (RALLY_PLATINUM).

import { N_ } from './i18n.js';

// EVO: [bronze, silver, gold, platinum] from a platinum lap (to the tenth).
const lapMs = t => { const [m, s] = t.split(':'); return Math.round((Number(m) * 60 + Number(s)) * 1000); };
const fromPlat = ms => [1.15, 1.10, 1.05, 1].map(k => Math.round(ms * k / 100) * 100);
// Targets set by hand, as lap times.
const times = (...t) => t.map(lapMs);
// An estimate from an older best over `laps` laps: 5 % quicker from 1-2 laps,
// 4 % from 3-9, 3 % from 10-29, 2 % from 30 or more.
const est = (best, laps) => fromPlat(lapMs(best) * (laps <= 2 ? 0.95 : laps < 10 ? 0.96 : laps < 30 ? 0.97 : 0.98));
// A sprint's targets: Kunos's bronze, silver and gold made 5 % quicker (to the tenth), and the platinum.
const kunos = (bronze, silver, gold, plat) => [...[bronze, silver, gold].map(ms => Math.round(ms * 0.95 / 100) * 100), plat];

export const EVO_LEVELS = [
  {
    id: 'rookie', name: N_('Rookie'), blurb: N_('Road cars on short tracks, against a gentle field.'),
    events: [
      { id: 'e1', name: N_('Corkscrew basics'), kind: 'timetrial', car: 'ks_honda_s2000_ap1', track: 'laguna_seca', layout: 'gp', minutes: 15, start: 10 * 60 + 30, tiers: times('2:00.0', '1:55.0', '1:48.0', '1:43.380'), note: N_('Rear-wheel drive and a high-revving engine: be smooth on the throttle out of the slow corners.') },
      { id: 'e2', name: N_('Club night'), kind: 'race', car: 'ks_toyota_gr86', track: 'brands_hatch', layout: 'indy', laps: 4, opponents: 9, skill: [80, 84], startPos: 10, podium: [5, 3, 1], start: 18 * 60, note: N_('Ten GR86s on the short Indy circuit, starting from the back.') },
      { id: 'e3', name: N_('Light and nimble'), kind: 'timetrial', car: 'ks_alpine_a110_s', track: 'oulton_park', layout: 'international', minutes: 15, start: 11 * 60, tiers: times('2:03.0', '1:58.0', '1:53.0', '1:49.0'), note: N_('Mid-engined and light: carry speed in, the car turns on the brakes.') },
      { id: 'e4', name: N_('Hot hatch scrap'), kind: 'race', car: 'ks_volkswagen_golf_gti_mk8', track: 'donington', layout: 'national', laps: 3, opponents: 11, skill: [81, 85], startPos: 12, podium: [5, 3, 1], start: 14 * 60, note: N_('Front-wheel drive: be gentle with the throttle out of the hairpin.') },
      { id: 'e5', name: N_('Big V8, short brakes'), kind: 'timetrial', car: 'ks_chevrolet_camaro_zl1', track: 'brands_hatch', layout: 'gp', minutes: 15, start: 15 * 60, tiers: times('1:44.5', '1:42.0', '1:39.5', '1:37.0'), note: N_('Lots of power, lots of weight. Brake early into Paddock Hill.') },
      { id: 'e6', name: N_('Minis at Fosters'), kind: 'race', car: 'ks_mini_jcs_1990', track: 'oulton_park', layout: 'fosters', laps: 3, opponents: 11, skill: [82, 86], startPos: 12, podium: [5, 3, 1], start: 16 * 60, note: N_('A dozen Minis, close racing, no room for mistakes.') },
    ],
    bonus: { id: 'bonus', name: N_('Emira at sunset'), kind: 'race', car: 'ks_lotus_emira', track: 'oulton_park', layout: 'international', laps: 3, opponents: 11, skill: [83, 87], startPos: 12, podium: [5, 3, 1], start: 19 * 60 + 30, note: N_('A dozen Emiras on the full International loop as the sun goes down.') },
  },
  {
    // Open from the start, beside the others (`side`): one event from each of EVO's licence categories.
    id: 'sprints', side: true, name: N_('Sprints'), blurb: N_("EVO's own academy runs: from a start arch on the lights to a finish arch, with medal times a little quicker than Kunos's, and a platinum."),
    events: [
      { id: 's1', name: N_('Entry licence'), kind: 'sprint', arch: 'Academy SP-1', car: 'ks_audi_rs_3_sportback', mech: 'preset_rs3_mech_1', track: 'brands_hatch', layout: 'gp', start: 14 * 60, tiers: kunos(26000, 22300, 21500, 19500), finish: 0.18642 },
      { id: 's2', name: N_('Sportscar licence'), kind: 'sprint', arch: 'Academy SC-2', car: 'ks_alfa_romeo_giulia_gtam', mech: 'preset_gtam_mech_1', track: 'imola', layout: 'gp', start: 10 * 60, tiers: kunos(42000, 38300, 37000, 32700), finish: 0.52369 },
      { id: 's3', name: N_('Supercar licence'), kind: 'sprint', arch: 'Academy HC-1', car: 'ks_ferrari_296_gtb', mech: 'preset_296gtb_mech_1', track: 'laguna_seca', layout: 'gp', start: 8 * 60, tiers: kunos(43000, 39100, 37800, 33000), finish: 0.24900 },
      { id: 's4', name: N_('Racing licence 1'), kind: 'sprint', arch: 'Academy R1-1', car: 'ks_mazda_mx5_nd_cup', mech: 'preset_mx5ndcup_mech_1', track: 'suzuka', layout: 'gp', start: 7 * 60, tiers: [55000, 50100, 48700, 47800], finish: 0.28358, note: N_('From the start line to the middle of the Esses.') },
      { id: 's5', name: N_('Racing licence 2'), kind: 'sprint', arch: 'Academy R2-1', car: 'ks_bmw_m2_cs_racing', mech: 'preset_m2csr_mech_1', track: 'mount_panorama', layout: 'gp', start: 12 * 60, tiers: [59360, 54270, 50130, 48450], finish: 0.31454 },
      { id: 's6', name: N_('Racing licence 3'), kind: 'sprint', arch: 'Academy R3-4', car: 'ks_porsche_992_gt3_cup', mech: 'preset_992c_mech_2', track: 'suzuka', layout: 'gp', start: 16 * 60, tiers: kunos(143000, 133100, 131300, 118200), finish: 0.58112, note: N_("The longest of Suzuka's academy runs, in a Cup car.") },
    ],
  },
  {
    id: 'club', name: N_('Club'), blurb: N_('Cup cars and track-day specials. The AI gets quicker.'),
    events: [
      { id: 'e1', name: N_('Spec racer'), kind: 'timetrial', car: 'ks_mazda_mx5_nd_cup', track: 'laguna_seca', layout: 'gp', minutes: 15, start: 10 * 60, tiers: est('1:42.108', 16), note: N_('Little power, so every corner exit counts.') },
      { id: 'e2', name: N_('MX-5 Cup round'), kind: 'race', car: 'ks_mazda_mx5_nd_cup', track: 'laguna_seca', layout: 'gp', laps: 4, opponents: 13, skill: [88, 92], startPos: 14, podium: [5, 3, 1], start: 14 * 60, note: N_('Fourteen identical cars. Slipstream on the straights, pass on the brakes.') },
      { id: 'e3', name: N_('Featherweight'), kind: 'timetrial', car: 'ks_lotus_exige_v6_cup', track: 'brands_hatch', layout: 'gp', minutes: 15, start: 11 * 60, tiers: est('1:37.737', 4) },
      { id: 'e4', name: N_('M2 CS Racing'), kind: 'race', car: 'ks_bmw_m2_cs_racing', track: 'redbull_ring', layout: 'gp', laps: 4, opponents: 13, skill: [89, 93], startPos: 14, podium: [5, 3, 1], start: 15 * 60, note: N_('Three big stops: get them right and the straights do the rest.') },
      { id: 'e5', name: N_('GT4 RS on the GP loop'), kind: 'timetrial', car: 'ks_porsche_718_cayman_gt4_rs', track: 'brands_hatch', layout: 'gp', minutes: 15, start: 12 * 60, tiers: est('1:34.413', 30) },
      { id: 'e6', name: N_('Touring car legends'), kind: 'race', car: 'ks_bmw_m3_e30_evo_iii', track: 'donington', layout: 'gp', laps: 4, opponents: 15, skill: [89, 93], startPos: 16, podium: [5, 3, 1], start: 16 * 60, note: N_('The E30 at Donington, from the back of sixteen.') },
    ],
    bonus: { id: 'bonus', name: N_('Exige at the Mountain'), kind: 'race', car: 'ks_lotus_exige_v6_cup', track: 'mount_panorama', layout: 'gp', laps: 3, opponents: 15, skill: [86, 90], startPos: 16, podium: [5, 3, 1], start: 19 * 60, note: N_('Bathurst at dusk in a light car with a lot of grip. Mind the walls across the top.') },
  },
  {
    id: 'gt4', name: N_('GT4 and Cup'), blurb: N_('Race cars with slicks and aero. Longer races, stronger grids.'),
    events: [
      { id: 'e1', name: N_('Clubsport at Road Atlanta'), kind: 'timetrial', car: 'ks_porsche_718_cayman_gt4_cs_mr', track: 'road_atlanta', layout: 'gp', minutes: 15, start: 10 * 60, tiers: est('1:24.942', 6) },
      { id: 'e2', name: N_('GT4 sprint'), kind: 'race', car: 'ks_audi_r8_lms_gt4_evo', track: 'laguna_seca', layout: 'gp', laps: 8, opponents: 15, skill: [87, 91], startPos: 16, podium: [5, 3, 1], start: 14 * 60 },
      { id: 'e3', name: N_('Suzuka in the X-Bow'), kind: 'timetrial', car: 'ks_ktm_x_bow_gt4', track: 'suzuka', layout: 'gp', minutes: 20, start: 11 * 60, tiers: est('2:09.297', 4), note: N_('The Esses reward rhythm more than bravery.') },
      { id: 'e4', name: N_('Carrera Cup'), kind: 'race', car: 'ks_porsche_992_gt3_cup', track: 'donington', layout: 'gp', laps: 6, opponents: 17, skill: [88, 92], startPos: 18, podium: [5, 3, 1], start: 15 * 60 },
      { id: 'e5', name: N_('Imola in a Cup car'), kind: 'timetrial', car: 'ks_porsche_992_gt3_cup', track: 'imola', layout: 'gp', minutes: 15, start: 12 * 60, tiers: est('1:47.472', 16) },
      { id: 'e6', name: N_('Ferrari Challenge weekend'), kind: 'weekend', car: 'ks_ferrari_488_challenge_evo', track: 'imola', layout: 'gp', qualifying: 10, laps: 8, opponents: 17, skill: [88, 92], podium: [5, 3, 1], start: 14 * 60, note: N_('Qualify, then race from where you put yourself.') },
    ],
    bonus: { id: 'bonus', name: N_('Challenge at Suzuka'), kind: 'race', car: 'ks_ferrari_488_challenge_evo', track: 'suzuka', layout: 'gp', laps: 5, opponents: 19, skill: [89, 93], startPos: 20, podium: [5, 3, 1], start: 18 * 60 + 30, note: N_('Twenty 488s through the Esses, late in the day.') },
  },
  {
    id: 'gt3', name: N_('GT3 and GT2'), blurb: N_('The fastest GT cars, on the big circuits.'),
    events: [
      { id: 'e1', name: N_('Spa in a GT3'), kind: 'timetrial', car: 'ks_ferrari_296_gt3', track: 'spa', layout: 'gp', minutes: 20, start: 11 * 60, tiers: est('2:18.183', 20) },
      { id: 'e2', name: N_('GT3 at Spa'), kind: 'race', car: 'ks_bmw_m4_gt3', track: 'spa', layout: 'gp', laps: 4, opponents: 19, skill: [89, 93], startPos: 20, podium: [5, 3, 1], start: 15 * 60 },
      { id: 'e3', name: N_('GT2 at Imola'), kind: 'timetrial', car: 'ks_maserati_mc20_gt2', track: 'imola', layout: 'gp', minutes: 15, start: 10 * 60, tiers: est('1:44.208', 2) },
      { id: 'e4', name: N_('GT2 at Monza'), kind: 'race', car: 'ks_mercedes_amg_gt2', track: 'monza', layout: 'gp', laps: 6, opponents: 17, skill: [89, 93], startPos: 18, podium: [5, 3, 1], start: 16 * 60 },
      { id: 'e5', name: N_('Fuji GP Short'), kind: 'timetrial', car: 'ks_ferrari_296_gt3', track: 'fuji', layout: 'gp_short', minutes: 15, start: 12 * 60, tiers: est('1:37.026', 1) },
      { id: 'e6', name: N_('Bathurst weekend'), kind: 'weekend', car: 'ks_porsche_992_gt3_r_rennsport', track: 'mount_panorama', layout: 'gp', qualifying: 10, laps: 6, opponents: 19, skill: [90, 94], podium: [5, 3, 1], start: 14 * 60, note: N_('Qualifying, then six laps of the Mountain.') },
    ],
    bonus: { id: 'bonus', name: N_('V10 in the Green Hell'), kind: 'timetrial', car: 'ks_ferrari_f2004', track: 'nurburgring', layout: 'touristenfahrten', minutes: 30, start: 10 * 60, tiers: est('5:07.698', 2), note: N_('A 2004 Formula 1 car on the Nordschleife.') },
  },
  {
    // Also asks for a safety rating of B or better (academy.js levelLocked).
    id: 'masters', name: N_('Masters'), blurb: N_('Formula cars, the Nordschleife and the hardest grids.'), sr: 'B',
    events: [
      { id: 'e1', name: N_('V10 at Fuji'), kind: 'timetrial', car: 'ks_ferrari_f2004', track: 'fuji', layout: 'gp', minutes: 15, start: 11 * 60, tiers: est('1:22.353', 1) },
      { id: 'e2', name: N_('The Mountain'), kind: 'timetrial', car: 'ks_ferrari_f2004', track: 'mount_panorama', layout: 'gp', minutes: 15, start: 12 * 60, tiers: est('1:35.739', 1) },
      { id: 'e3', name: N_('Modern F1 at Spa'), kind: 'timetrial', car: 'ks_ferrari_sf_25', track: 'spa', layout: 'gp', minutes: 15, start: 13 * 60, tiers: est('1:46.989', 9) },
      { id: 'e4', name: N_('GT3 at Suzuka'), kind: 'race', car: 'ks_audi_r8_lms_gt3_evo_2', track: 'suzuka', layout: 'gp', laps: 6, opponents: 19, skill: [92, 96], startPos: 20, podium: [5, 3, 1], start: 15 * 60 },
      { id: 'e5', name: N_('Touristenfahrten'), kind: 'timetrial', car: 'ks_bmw_m4_gt3', track: 'nurburgring', layout: 'touristenfahrten', minutes: 30, start: 9 * 60, tiers: est('6:04.848', 47), note: N_('Almost twenty kilometres of the Nordschleife in a GT3.') },
      { id: 'e6', name: N_('The final'), kind: 'race', car: 'ks_porsche_992_gt3_r_rennsport', track: 'watkins_glen', layout: 'gp', laps: 8, opponents: 23, skill: [94, 98], startPos: 24, podium: [3, 2, 1], start: 16 * 60, note: N_('Twenty-four cars, the strongest AI, from the back. A podium is the least you need.') },
    ],
    bonus: { id: 'bonus', name: N_('Spa at night'), kind: 'race', car: 'ks_porsche_992_gt3_r_rennsport', track: 'spa', layout: 'gp', laps: 5, opponents: 23, skill: [94, 98], startPos: 24, podium: [3, 2, 1], start: 22 * 60, note: N_('Twenty-four GT3 Rs in the dark, from the back.') },
  },
];
// A level opens when the one before has this many events with a medal.
export const EVO_UNLOCK = 4;

// What this version shows. A level comes out once its targets are checked by
// driving its events, as Rookie's and the Sprints' were; the rest stay here until
// then (the dev build and --check-academy still show them all). Rally's Academy is
// shown as coming later, for the same reason.
export const EVO_RELEASED = ['rookie', 'sprints'];
export const RALLY_RELEASED = false;

// Rally: stage id (save style), car id, start time (minutes), weather (RALLY_WEATHERS value).
const NIGHT = 22 * 60;
export const RALLY_LEVELS = [
  {
    id: 'fwd', name: N_('Front-wheel drive'), blurb: N_('Light front-wheel drive cars on short stages, in daylight.'),
    events: [
      { id: 'r1', name: N_('Warm-up at Livigno'), car: 'MiniCooperS1275', stage: 'LivignoTestTrack01FullForward', start: 11 * 60, weather: 0 },
      { id: 'r2', name: N_('Tarmac in Alsace'), car: 'Peugeot208Rally4', stage: 'AlsaceS4SaverneShort1Forward', start: 10 * 60, weather: 0 },
      { id: 'r3', name: N_('Greek gravel'), car: 'LanciaFulviaHF', stage: 'GreeceS3ElatiaCut2Forward', start: 12 * 60, weather: 0 },
      { id: 'r4', name: N_('Welsh forest'), car: 'MiniCooperS1275', stage: 'WelesS3HafrenNorthCut2Forward', start: 13 * 60, weather: 1 },
      { id: 'r5', name: N_('Loutraki'), car: 'Peugeot208Rally4', stage: 'GreeceS4LoutrakiCut1Forward', start: 15 * 60, weather: 0 },
      { id: 'r6', name: N_('Kit car in Munster'), car: 'Peugeot306IIMaxiKitCar', stage: 'AlsaceS2MunsterShort2Forward', start: 16 * 60, weather: 1 },
    ],
    bonus: { id: 'bonus', name: N_('Wales at night'), car: 'Peugeot208Rally4', stage: 'WelesS3HafrenNorthCut2Forward', start: NIGHT, weather: 0 },
  },
  {
    id: 'rwd', name: N_('Rear-wheel drive classics'), blurb: N_('Historic rear-wheel drive cars, and a first stage at night.'),
    events: [
      { id: 'c1', name: N_('Alfa in Alsace'), car: 'AlfaRomeoGTA1300', stage: 'AlsaceS2MunsterShort1Forward', start: 11 * 60, weather: 0 },
      { id: 'c2', name: N_('Alpine on the Turini'), car: 'AlpineA110', stage: 'MonteCarloS1BolleneCut2Forward', start: 12 * 60, weather: 0 },
      { id: 'c3', name: N_('124 on gravel'), car: 'Fiat124Abarth', stage: 'GreeceS3ElatiaCut1Forward', start: 10 * 60, weather: 0 },
      { id: 'c4', name: N_('131 in Wales'), car: 'Fiat131Abarth', stage: 'WelesS4HafrenSouthFullForward', start: 14 * 60, weather: 1 },
      { id: 'c5', name: N_('Stratos at Sisteron'), car: 'LanciaStratosHF', stage: 'MonteCarloS2SisteronCut2Forward', start: 15 * 60, weather: 0 },
      { id: 'c6', name: N_('Alpine after dark'), car: 'AlpineA110', stage: 'MonteCarloS1BolleneCut3Forward', start: NIGHT, weather: 0 },
    ],
    bonus: { id: 'bonus', name: N_('Stratos on snow'), car: 'LanciaStratosHF', stage: 'LivignoTestTrack01FullForward', start: 11 * 60, weather: 9 },
  },
  {
    id: 'groupb', name: N_('Group B and four-wheel drive'), blurb: N_('The wild ones, then the first all-wheel drive cars. Rain and night.'),
    events: [
      { id: 'b1', name: N_('037 at Saverne'), car: 'LanciaRally037Evo2', stage: 'AlsaceS4SaverneFullForward', start: 11 * 60, weather: 0 },
      { id: 'b2', name: N_('Quattro in Wales'), car: 'AudiQuattroGr4', stage: 'WelesS3HafrenNorthCut1Forward', start: 12 * 60, weather: 1 },
      { id: 'b3', name: N_('Delta at Loutraki'), car: 'LanciaDeltaIntegraleEvo', stage: 'GreeceS4LoutrakiCut2Forward', start: 13 * 60, weather: 0 },
      { id: 'b4', name: N_('Impreza at Elatia'), car: 'SubaruImprezaS3', stage: 'GreeceS3ElatiaFullForward', start: 10 * 60, weather: 0 },
      { id: 'b5', name: N_('Quattro in the rain'), car: 'AudiQuattroGr4', stage: 'AlsaceS2MunsterShort1Reverse', start: 15 * 60, weather: 6 },
      { id: 'b6', name: N_('Delta at night'), car: 'LanciaDeltaIntegraleEvo', stage: 'MonteCarloS2SisteronCut1Forward', start: NIGHT, weather: 0 },
    ],
    bonus: { id: 'bonus', name: N_('037 on the Turini at night'), car: 'LanciaRally037Evo2', stage: 'MonteCarloS1BolleneCut1Forward', start: NIGHT, weather: 0 },
  },
  {
    id: 'wrc', name: N_('World Rally Cars'), blurb: N_('Early 2000s WRC cars on full stages, snow included.'),
    events: [
      { id: 'w1', name: N_('206 at Elatia'), car: 'Peugeot206', stage: 'GreeceS3ElatiaCut1Reverse', start: 11 * 60, weather: 0 },
      { id: 'w2', name: N_('Xsara in Munster'), car: 'CitroenXsaraWRC', stage: 'AlsaceS2MunsterFullForward', start: 12 * 60, weather: 0 },
      { id: 'w3', name: N_('206 at Hafren'), car: 'Peugeot206', stage: 'WelesS3HafrenNorthFullForward', start: 13 * 60, weather: 2 },
      { id: 'w4', name: N_('Xsara on snow'), car: 'CitroenXsaraWRC', stage: 'LivignoTestTrack01FullReverse', start: 11 * 60, weather: 9 },
      { id: 'w5', name: N_('206 on the Turini'), car: 'Peugeot206', stage: 'MonteCarloS1BolleneCut1Forward', start: 14 * 60, weather: 0 },
      { id: 'w6', name: N_('Xsara at night'), car: 'CitroenXsaraWRC', stage: 'GreeceS4LoutrakiFullForward', start: NIGHT, weather: 0 },
    ],
    bonus: { id: 'bonus', name: N_('Xsara in the Welsh rain'), car: 'CitroenXsaraWRC', stage: 'WelesS4HafrenSouthFullForward', start: 13 * 60, weather: 6 },
  },
  {
    id: 'rally2', name: N_('Rally2 Masters'), blurb: N_('Modern Rally2 cars on the longest stages, ending on the full Turini.'),
    events: [
      { id: 'm1', name: N_('Fabia at Sisteron'), car: 'SkodaFabiaRSRally2', stage: 'MonteCarloS2SisteronFullForward', start: 11 * 60, weather: 0 },
      { id: 'm2', name: N_('i20 at Elatia'), car: 'Hyundaii20NRally2', stage: 'GreeceS3ElatiaFullReverse', start: 12 * 60, weather: 0 },
      { id: 'm3', name: N_('Polo at Loutraki'), car: 'VWPoloGTIR5', stage: 'GreeceS4LoutrakiFullReverse', start: 13 * 60, weather: 0 },
      { id: 'm4', name: N_('Fabia in the Welsh rain'), car: 'SkodaFabiaRSRally2', stage: 'WelesS3HafrenNorthFullReverse', start: 14 * 60, weather: 6 },
      { id: 'm5', name: N_('i20 at night'), car: 'Hyundaii20NRally2', stage: 'AlsaceS2MunsterFullReverse', start: NIGHT, weather: 0 },
      { id: 'm6', name: N_('The Turini'), car: 'SkodaFabiaRSRally2', stage: 'MonteCarloS1BolleneFullForward', start: 12 * 60, weather: 0 },
    ],
    bonus: { id: 'bonus', name: N_('The Turini at night'), car: 'SkodaFabiaRSRally2', stage: 'MonteCarloS1BolleneFullForward', start: NIGHT, weather: 0 },
  },
];
export const RALLY_UNLOCK = 4;

// Rally's medal margins over the reference time (DT_MedalPercentageModifiers):
// [bronze, silver, gold] for day and night, dry and wet (rain or snow).
export const RALLY_MARGINS = {
  normal: [0.35, 0.20, 0.04], normalNight: [0.37, 0.21, 0.05],
  hard: [0.48, 0.26, 0.10], hardNight: [0.50, 0.28, 0.12],
};
// Platinum, the launcher's own: the AI's time (a little over it at night or in the wet).
export const RALLY_PLATINUM = { normal: 0, normalNight: 0.01, hard: 0.05, hardNight: 0.06 };

// Assetto Corsa "Modded": classes made for the launcher with mods from their
// makers, on Kunos's own tracks. Each class lists its cars (the player drives any
// of the ones installed; the AI grid mixes them all, each with its liveries) and
// six events in order: one opens with a medal in the one before. Events are
// marked against the AI, so no lap times need guessing:
//   qualify  a qualifying session with the grid: medals by your place on it
//   race     medals by finishing position (`start`: grid slot, 0 = last)
//   weekend  qualifying then the race, from where you qualified
// `free`: the mod costs nothing (Content Manager's registry, acstuff.club/cup,
// lists it without "limited"); `get` is where it's downloaded.
const cup = id => `https://acstuff.club/cup/car/${id}/get`;
const classEvents = (tracks, { ai = [86, 88, 90, 92, 95, 98], laps = [5, 8, 12] } = {}) => [
  { id: 'q1', name: N_('Qualifying'), kind: 'qualify', ...tracks[0], minutes: 10, opponents: 11, ai: ai[0], podium: [5, 3, 1], time: 11 * 60 },
  { id: 'r1', name: N_('Sprint race'), kind: 'race', ...tracks[1], laps: laps[0], opponents: 11, ai: ai[1], start: 0, podium: [5, 3, 1], time: 14 * 60 },
  { id: 'q2', name: N_('Qualifying, stronger field'), kind: 'qualify', ...tracks[2], minutes: 10, opponents: 13, ai: ai[2], podium: [5, 3, 1], time: 10 * 60 + 30 },
  { id: 'r2', name: N_('Feature race'), kind: 'race', ...tracks[3], laps: laps[1], opponents: 13, ai: ai[3], start: 0, podium: [5, 3, 1], time: 15 * 60 },
  { id: 'w1', name: N_('Race weekend'), kind: 'weekend', ...tracks[4], minutes: 10, laps: laps[1], opponents: 15, ai: ai[4], podium: [5, 3, 1], time: 13 * 60 },
  { id: 'r3', name: N_('Season finale'), kind: 'race', ...tracks[5], laps: laps[2], opponents: 15, ai: ai[5], start: 0, podium: [3, 2, 1], time: 16 * 60 },
];
const T = (track, layout = '') => ({ track, layout });

export const AC_CLASSES = [
  {
    id: 'tcr', name: N_('TCR'), blurb: N_('Front-wheel drive touring cars: close racing, lots of contact.'),
    cars: [
      { id: 'fw_cupra_tcr_2024', name: 'Cupra Leon Competición 2024', author: 'Fuzo', free: true, get: cup('fw_cupra_tcr_2024') },
      { id: 'fw_audi_rs3_tcr_2024', name: 'Audi RS3 LMS 2024', author: 'Fuzo', free: true, get: cup('fw_audi_rs3_tcr_2024') },
      { id: 'fw_elantra_tcr_2024', name: 'Hyundai Elantra N TCR 2024', author: 'Fuzo', free: true, get: cup('fw_elantra_tcr_2024') },
    ],
    events: classEvents([T('ks_vallelunga', 'extended_circuit'), T('ks_vallelunga', 'extended_circuit'), T('imola'), T('ks_nurburgring', 'layout_gp_a'), T('monza'), T('spa')]),
  },
  {
    id: 'gt4', name: N_('GT4'), blurb: N_('Production-based sports cars on slicks, a big mixed grid.'),
    cars: [
      { id: 'gt4_porsche_cayman_718', name: 'Porsche Cayman 718 GT4', author: 'GUERILLA Mods', free: true, get: cup('gt4_porsche_cayman_718') },
      { id: 'gt4_bmw_m4', name: 'BMW M4 GT4', author: 'GUERILLA Mods', free: true, get: cup('gt4_bmw_m4') },
      { id: 'gt4_mercedes_amg', name: 'Mercedes AMG GT4', author: 'GUERILLA Mods', free: true, get: cup('gt4_mercedes_amg') },
      { id: 'gt4_aston_martin_vantage', name: 'Aston Martin Vantage GT4', author: 'GUERILLA Mods', free: true, get: cup('gt4_aston_martin_vantage') },
      { id: 'gt4_audi_r8', name: 'Audi R8 GT4', author: 'GUERILLA Mods', free: true, get: cup('gt4_audi_r8') },
      { id: 'gt4_mclaren_570s', name: 'McLaren 570S GT4', author: 'GUERILLA Mods', free: true, get: cup('gt4_mclaren_570s') },
    ],
    events: classEvents([T('ks_silverstone', 'national'), T('ks_silverstone', 'gp'), T('mugello'), T('ks_nurburgring', 'layout_gp_a'), T('imola'), T('spa')]),
  },
  {
    id: 'supercars', name: N_('Supercars'), blurb: N_('Australian V8 Supercars: heavy, loud and hard on the brakes.'),
    cars: [
      { id: 'z_supercars_ford_mustang', name: 'Ford Mustang Supercar', author: 'Z', free: true, get: cup('z_supercars_ford_mustang') },
      { id: 'z_supercars_holden_zb', name: 'Holden ZB Commodore Supercar', author: 'Z', free: true, get: cup('z_supercars_holden_zb') },
    ],
    events: classEvents([T('ks_vallelunga', 'extended_circuit'), T('magione'), T('ks_nurburgring', 'layout_sprint_a'), T('mugello'), T('ks_silverstone', 'gp'), T('imola')]),
  },
  {
    id: 'f2', name: N_('Formula 2'), blurb: N_('Single-seaters one step below Formula 1, all on the same car.'),
    cars: [{ id: 'rss_formula_rss_2_v6_2024', name: 'Formula RSS 2 V6 2024', author: 'Race Sim Studio', get: 'https://www.racesimstudio.com/' }],
    events: classEvents([T('imola'), T('ks_nurburgring', 'layout_gp_a'), T('mugello'), T('ks_silverstone', 'gp'), T('spa'), T('monza')], { ai: [88, 90, 92, 94, 96, 98], laps: [8, 12, 18] }),
  },
  {
    id: 'f1', name: N_('Formula 1 2026'), blurb: N_('The 2026 cars: the fastest thing in the Academy.'),
    cars: [{ id: 'vrc_formula_alpha_2026_csp', name: 'VRC Formula Alpha 2026', author: 'VRC Modding Team', paid: true, get: 'https://www.virtual-racing-cars.com/' }],
    events: classEvents([T('imola'), T('mugello'), T('ks_silverstone', 'gp'), T('ks_nurburgring', 'layout_gp_a'), T('spa'), T('monza')], { ai: [90, 92, 94, 96, 98, 100], laps: [8, 12, 20] }),
  },
  {
    id: 'indy', name: N_('IndyCar road courses'), blurb: N_('American open-wheelers on road courses, no ovals.'),
    cars: [{ id: 'vrc_formula_na_2021_road', name: 'VRC Formula NA 2021 (road kit)', author: 'VRC Modding Team', paid: true, get: 'https://www.virtual-racing-cars.com/' }],
    events: classEvents([T('ks_laguna_seca'), T('ks_laguna_seca'), T('ks_vallelunga', 'extended_circuit'), T('mugello'), T('ks_silverstone', 'gp'), T('imola')], { ai: [88, 90, 92, 94, 96, 98], laps: [8, 12, 18] }),
  },
];
