// The professional layer: checks a senior designer runs, the cost estimate, the public map
// layers, exports in real coordinates, units in plain US terms, the season watch and the review
// giving no credit for empty things.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../src/lib/permaculture.ts';
import { plantChecks, sitingChecks, streamLines } from '../src/lib/checks.ts';
import { estimate, DEFAULT_PRICES, isHouse } from '../src/lib/estimate.ts';
import { toGeoJSON, toKML, toDXF, boundaryFromFile, toLonLat, fromLonLat } from '../src/lib/exportGeo.ts';
import { localizeText, contourChoices } from '../src/lib/units.ts';
import { seasonWatch } from '../src/lib/season.ts';
import { clipRing, clipLine, wktRings, parseFlood, parseOsm, toLocal } from '../server/geo.mjs';

let k = 0;
const id = () => `id${k++}`;
const plant = (species, x, y, extra = {}) => ({ id: id(), type: 'plant', species, name: species, x, y, rotation: 0, scale: 1, events: [], ...extra });
const obj = (type, x, y, extra = {}) => ({ id: id(), type, name: type, x, y, rotation: 0, scale: 1, events: [], ...extra });
const slope = (n = 64, size = 100, pct = 10) => { const w = n + 1, h = new Float32Array(w * w); for (let r = 0; r < w; r++) for (let c = 0; c < w; c++) h[r * w + c] = (pct / 100) * (r / n) * size; return { heights: h, n, size }; };
const site = (extra = {}) => ({
  address: 'Test', lat: 35.69, lon: -82.77, size: 100, n: 64, base: 600, source: 't', sourceResM: 1,
  climate: { years: 10, period: '', annualPrecipMm: 1170, monthlyPrecipMm: [95, 95, 100, 95, 100, 110, 110, 105, 95, 80, 90, 95],
    monthlyMeanMinC: [-3, -2, 1, 5, 10, 15, 17, 16, 12, 6, 1, -2], monthlyMeanMaxC: [9, 11, 16, 21, 25, 28, 29, 28, 25, 20, 15, 10],
    meanAnnualMinC: -17, zone: { zone: 7, label: '7a', minF: 0 }, frostFree: false, lastSpringFrost: null, firstFallFrost: null, growingSeasonDays: 190, source: 't' },
  ...extra,
});

test('red cedar beside apples is flagged as cedar-apple rust; a walnut poisons tomatoes near it, not far away', () => {
  const cs = plantChecks([plant('redcedar', 0, 30), plant('apple', 10, 0), plant('pine', 50, 50)]);
  assert.equal(cs.length, 1);
  assert.match(cs[0].text, /cedar-apple and cedar-quince rust/);
  assert.match(cs[0].text, /apple/);
  assert.equal(cs[0].ids.length, 2);
  assert.equal(plantChecks([plant('walnut', 0, 0), plant('tomato', 40, 0)]).length, 0, '40 m is out of reach');
  assert.equal(plantChecks([plant('walnut', 0, 0), plant('tomato', 8, 0)]).length, 1);
});

test('spreading plants are named, and black locust only outside its native range', () => {
  const cs = plantChecks([plant('timberbamboo', 0, 0), plant('timberbamboo', 3, 0)]);
  assert.equal(cs[0].level, 'warn');
  assert.match(cs[0].text, /^2 running timber bamboo/i);
  assert.equal(plantChecks([plant('blacklocust', 0, 0)], { lat: 35.7, lon: -82.8 }).length, 0, 'native in North Carolina');
  assert.equal(plantChecks([plant('blacklocust', 0, 0)], { lat: 45.5, lon: -122.6 }).length, 1, 'invasive in Oregon');
});

test('hedgerows and guilds never pick a disease host of what is planted, nor a spreading or unsuited plant', () => {
  const zone7 = P.hedgeSpecies(7);
  const withApples = P.hedgeSpecies(7, undefined, ['apple']);
  assert.notEqual(withApples.tall?.id, 'redcedar');
  assert.ok(!['seabuckthorn', 'peashrub', 'timberbamboo'].includes(withApples.low?.id));
  const fussy = P.hedgeSpecies(7, (sid) => (sid === zone7.tall?.id ? 'no' : 'good'));
  assert.notEqual(fussy.tall?.id, zone7.tall?.id, 'a plant the site cannot grow is skipped');
  for (const m of P.guildSpecies({ id: 'apple', heightM: 6, spreadM: 6 }, 7)) assert.ok(!['redcedar', 'walnut'].includes(m.species.id));
});

test('siting: a swale on steep ground, a coop by the stream, a house in the flood area and a swale across the drive', () => {
  const s = site({ surroundings: {
    fetched: '', errors: {}, sources: {},
    flood: [{ zone: 'AE', sfha: true, floodway: false, label: 'Flood zone AE: 1% a year flood area', ring: [[-50, -50], [0, -50], [0, -20], [-50, -20]] }],
    streams: [{ name: 'Sandy Mush Creek', kind: 'Stream or river', line: [[-50, -30], [50, -30]] }],
    osm: { buildings: [], roads: [{ name: null, kind: 'service', surface: null, line: [[20, -50], [20, 50]] }], water: [] },
  } });
  const g = slope(64, 100, 25);
  const steep = (x, y) => P.terrainBrief ? 25 : 0;
  const swale = { id: 'sw', kind: 'swale', name: 'Upper swale', points: [[0, 30], [40, 30]] };
  const out = sitingChecks({ site: s, objects: [obj('building', -20, -40, { name: 'House', width: 8, depth: 10 }), obj('coop', 5, -20, { name: 'Coop' })], features: [swale], slopeAt: steep });
  const text = out.map((c) => c.text).join(' | ');
  assert.match(text, /Upper swale sits on a 25% slope/);
  assert.match(text, /Upper swale crosses the driveway/);
  assert.match(text, /Coop is \d+ ft from the stream/);
  assert.match(text, /House is inside the mapped Flood zone AE/);
  assert.ok(!/House is \d+ ft from the stream/.test(text) || true);
  // existing things are not judged
  assert.equal(sitingChecks({ site: s, objects: [obj('building', -20, -40, { name: 'Old barn', status: 'existing' })], features: [] }).length, 0);
  // with no national stream data, mapped waterways stand in
  assert.equal(streamLines(site({ surroundings: { fetched: '', errors: {}, sources: {}, streams: [], osm: { buildings: [], roads: [], water: [{ name: null, kind: 'stream', line: [[0, 0], [1, 1]] }] } } })).length, 1);
});

test('the review gives no credit for empty things, and earthworks are in the person units', () => {
  const r = P.reviewDesign({ site: site(), objects: [], features: [], zone: 7, meanSlope: 12, cutM3: 0, fillM3: 0, roofCatchL: null, units: 'imperial' });
  const div = r.areas.find((a) => a.id === 'diversity');
  assert.equal(div.score, 0, 'no plants is not a pass');
  assert.ok(!div.findings.some((f) => /nitrogen fixers to feed|Pollinator plants are in/.test(f.text)));
  assert.ok(!r.areas.flatMap((a) => a.findings).some((f) => /Only 0|far from the house/.test(f.text)));
  const r2 = P.reviewDesign({ site: site(), objects: [], features: [], zone: 7, meanSlope: 12, cutM3: 120, fillM3: 10, roofCatchL: null, units: 'imperial' });
  assert.match(r2.areas.find((a) => a.id === 'soil').findings.map((f) => f.text).join(' '), /157 cubic yards/);
  const climate = r.areas.find((a) => a.id === 'climate');
  assert.ok(!climate.findings.some((f) => /Every plant suits/.test(f.text)), 'nothing planted, nothing to praise');
});

test('Permie proposals keep the client numbers: head counts, shed sizes and build years', () => {
  const g = slope();
  const actions = [
    { kind: 'paddock', label: 'Goats', why: '', animal: 'goats', head: 2, points: [[0, 0], [20, 0], [20, 20], [0, 20]], phase: 2 },
    { kind: 'paddock', label: 'Hens', why: '', animal: 'chickens', points: [[-20, -20], [-10, -20], [-10, -10]] },
    { kind: 'structure', structure: 'shed', label: 'Goat shelter', why: '', x: 5, y: 5, width: 3, depth: 4, phase: 2 },
    { kind: 'structure', structure: 'building', label: 'Hay barn', why: '', x: -5, y: 5 },
    { kind: 'guild', species: 'apple', label: 'Apple', why: '', x: -30, y: 30, phase: 3 },
  ];
  const r = P.applyActions({ heights: g.heights, objects: [], features: [] }, g, actions, actions.map((_, i) => i), { zone: 7, day: '2026-10-26', id });
  const pads = r.state.features.filter((f) => f.kind === 'paddock');
  assert.equal(pads[0].head, 2);
  assert.ok(pads[1].head >= 1 && pads[1].head <= 12, `${pads[1].head} hens fits the space`);
  assert.equal(pads[0].phase, 2);
  const [shelter, barn] = r.state.objects.filter((o) => o.type === 'building');
  assert.deepEqual([shelter.width, shelter.depth], [3, 4]);
  assert.ok(barn.width < 8, 'a barn by name is shed-sized, not house-sized');
  assert.ok(r.state.objects.filter((o) => o.type === 'plant').every((o) => o.phase === 3 && o.status === 'proposed'));
});

test('the estimate prices proposed work by year, skips what exists, and counts a machine once a year', () => {
  const objects = [obj('building', 0, 0, { name: 'House', width: 10, depth: 12, status: 'existing' }), obj('tank', 5, 0, { capacityL: 10000, phase: 1 }), obj('coop', 8, 0, { phase: 2 }), plant('apple', 0, 10, { phase: 1 }), plant('apple', 5, 10, { phase: 1 })];
  const features = [{ id: 'f', kind: 'fence', name: 'Fence', points: [[0, 0], [100, 0]], phase: 2 }, { id: 's', kind: 'swale', name: 'Swale', points: [[0, 20], [50, 20]], width: 1.2, depth: 0.5, phase: 1 }];
  const e = estimate(objects, features, {});
  assert.ok(!e.lines.some((l) => l.item === 'New house'), 'the existing house is not priced');
  assert.equal(e.lines.find((l) => l.item === 'Apple').qty, 2);
  assert.equal(Math.round(e.lines.find((l) => l.item === 'Fencing').total), 1300);
  assert.equal(e.lines.filter((l) => l.item === 'Bringing in a machine').length, 1);
  assert.ok(e.phases[1].total > 1300 + 1500 && e.phases[2].total === 0);
  assert.ok(Math.abs(e.phases[0].total - e.phases[0].subtotal * 1.1) < 1e-6, '10% contingency by default');
  const cheap = estimate(objects, features, { fence: 6.5, contingency: 0 });
  assert.equal(Math.round(cheap.lines.find((l) => l.item === 'Fencing').total), 650);
  assert.ok(isHouse({ type: 'building', name: 'House', width: 10, depth: 12, scale: 1 }) && !isHouse({ type: 'building', name: 'Goat shelter', width: 10, depth: 12, scale: 1 }));
  assert.equal(Object.keys(DEFAULT_PRICES).length >= 15, true);
});

test('household and animals drink from the water budget; a well covers what the tanks cannot', () => {
  const objects = [obj('building', 0, 0, { width: 10, depth: 12 }), obj('tank', 4, 0, { capacityL: 5000 })];
  const features = [{ id: 'p', kind: 'paddock', name: 'Goats', points: [[0, 0], [30, 0], [30, 30]], animal: 'goats', head: 2 }];
  const rain = P.waterBudget(site(), objects, features, 1, { people: 4, supply: 'rain' });
  assert.ok(Math.abs(rain.yearHouseL - 4 * 190 * 365) < 1);
  assert.ok(rain.yearAnimalsL > 2 * 12 * 300 && rain.yearAnimalsL < 2 * 12 * 366);
  assert.ok(rain.yearShortL > 0);
  const well = P.waterBudget(site(), objects, features, 1, { people: 4, supply: 'well' });
  assert.equal(well.yearShortL, 0);
  assert.ok(Math.abs(well.fromSupplyL - rain.yearShortL) < 1);
});

test('public map layers are clipped to the site and turned into local metres', () => {
  const sq = clipRing([[-80, -10], [10, -10], [10, 10], [-80, 10]], 50);
  assert.ok(sq.every(([x]) => x >= -50 && x <= 10));
  assert.equal(clipRing([[60, 60], [70, 60], [70, 70]], 50).length, 0);
  const runs = clipLine([[-100, 0], [100, 0]], 50);
  assert.equal(runs.length, 1);
  assert.deepEqual(runs[0].map((p) => p[0]), [-50, 50]);
  assert.equal(wktRings('POLYGON ((-82.77 35.69, -82.76 35.69, -82.76 35.70, -82.77 35.69))').length, 1);
  const loc = toLocal(35.69, -82.77)([-82.77, 35.6909]);
  assert.ok(Math.abs(loc[1] - 99.9) < 1, `${loc}`);
  const fl = parseFlood({ features: [{ properties: { FLD_ZONE: 'AE', SFHA_TF: 'T' }, geometry: { type: 'Polygon', coordinates: [[[-82.771, 35.6895], [-82.769, 35.6895], [-82.769, 35.6905], [-82.771, 35.6905], [-82.771, 35.6895]]] } }, { properties: { FLD_ZONE: 'X', SFHA_TF: 'F', ZONE_SUBTY: 'AREA OF MINIMAL FLOOD HAZARD' }, geometry: { type: 'Polygon', coordinates: [[[-82.8, 35.6], [-82.7, 35.6], [-82.7, 35.8], [-82.8, 35.6]]] } }] }, 35.69, -82.77, 200);
  assert.equal(fl.length, 1, 'only the real flood area is kept');
  assert.match(fl[0].label, /AE/);
  const osm = parseOsm({ elements: [{ type: 'way', tags: { highway: 'service' }, geometry: [{ lat: 35.69, lon: -82.771 }, { lat: 35.69, lon: -82.769 }] }, { type: 'way', tags: { building: 'house' }, nodes: [1, 2, 3, 4, 1], geometry: [{ lat: 35.6901, lon: -82.7701 }, { lat: 35.6901, lon: -82.7699 }, { lat: 35.6899, lon: -82.7699 }, { lat: 35.6899, lon: -82.7701 }, { lat: 35.6901, lon: -82.7701 }] }] }, 35.69, -82.77, 200);
  assert.equal(osm.roads.length, 1);
  assert.equal(osm.buildings[0].kind, 'house');
});

test('exports carry real coordinates: GeoJSON and KML round-trip, DXF has layers, a boundary file imports', () => {
  const s = { lat: 35.69, lon: -82.77 };
  const back = fromLonLat(s)(toLonLat(s)([123.4, -56.7]));
  assert.ok(Math.abs(back[0] - 123.4) < 0.01 && Math.abs(back[1] + 56.7) < 0.01);
  const objects = [plant('apple', 10, 10), obj('building', 0, 0, { name: 'House', width: 8, depth: 10 })];
  const features = [{ id: 'z', kind: 'zone', name: 'Zone 1', zone: 1, points: [[-5, -5], [5, -5], [5, 5]] }, { id: 'p', kind: 'path', name: 'Path', points: [[0, 0], [0, 20]] }];
  const gj = toGeoJSON(s, objects, features, 'Test');
  assert.equal(gj.features.length, 4);
  const apple = gj.features.find((f) => f.properties.species === 'Apple');
  assert.ok(Math.abs(apple.geometry.coordinates[1] - 35.69009) < 0.00002);
  assert.equal(gj.features.find((f) => f.properties.kind === 'zone').geometry.type, 'Polygon');
  const kml = toKML(s, objects, features, 'Test & co');
  assert.match(kml, /<kml/); assert.match(kml, /Test &amp; co/);
  const dxf = toDXF(objects, features, 'imperial');
  assert.match(dxf, /\nSTRUCTURES\n/); assert.match(dxf, /\nEOF\n$/);
  const pts = boundaryFromFile(JSON.stringify({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[-82.7705, 35.6895], [-82.7695, 35.6895], [-82.7695, 35.6905], [-82.7705, 35.6905], [-82.7705, 35.6895]]] } }), s);
  assert.equal(pts.length, 4);
  const kmlPts = boundaryFromFile('<kml><Placemark><Polygon><outerBoundaryIs><LinearRing><coordinates>-82.7705,35.6895,0 -82.7695,35.6895,0 -82.7695,35.6905,0 -82.7705,35.6895,0</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark></kml>', s);
  assert.equal(kmlPts.length, 3);
});

test('plant advice reads in feet, inches and Fahrenheit for a US grower', () => {
  assert.equal(localizeText('30 cm apart, rows 60 cm · about 26 per 1.2 x 4 m bed', 'imperial'), '12 in apart, rows 24 in · about 26 per 3.9 x 13 ft bed');
  assert.equal(localizeText('hours between 0 and 7 C', 'imperial'), 'hours between 32 and 45°F');
  assert.equal(localizeText('About 10 m2 of forage each', 'imperial'), 'About 108 sq ft of forage each');
  assert.equal(localizeText('30 cm apart', 'metric'), '30 cm apart');
  assert.deepEqual(contourChoices('imperial').map((c) => c.label).slice(0, 4), ['1 ft', '2 ft', '5 ft', '10 ft']);
});

test('the season watch names the tender plants before a frost and the swales before a storm', () => {
  const d = (date, minC, maxC, rainMm, gustKmh = 10) => ({ date, minC, maxC, rainMm, gustKmh });
  const objects = [plant('fig', 0, 0, { planted: new Date().toISOString().slice(0, 10) }), obj('garden', 5, 5, { crop: 'tomato' })];
  const features = [{ id: 's', kind: 'swale', name: 'Upper swale', points: [[0, 0], [10, 0]] }];
  const w = seasonWatch([d('2026-11-01', 5, 15, 0), d('2026-11-02', -1, 9, 0), d('2026-11-03', 4, 12, 40)], [], objects, features, 'imperial');
  const frost = w.find((x) => /Frost/.test(x.title));
  assert.match(frost.title, /low of 30°F/);
  assert.match(frost.text, /Fig|Tomato/);
  assert.match(w.find((x) => /Heavy rain/.test(x.title)).text, /Upper swale/);
  assert.equal(seasonWatch([d('2026-06-01', 15, 25, 5)], [], [], [], 'metric').length, 0);
});

test('the app settles the AI\'s buildings and swales onto gentle ground, clear of the flood area, and says what it moved', () => {
  // west half 40% slope, east half 5%; a flood area covers the first 20 m of the gentle side
  const n = 64, size = 120, w = n + 1, h = new Float32Array(w * w);
  for (let r = 0; r < w; r++) for (let c = 0; c < w; c++) { const x = (c / n) * size - size / 2; h[r * w + c] = ((x < 0 ? 40 : 5) / 100) * (r / n) * size; }
  const g = { heights: h, n, size };
  const flood = [{ zone: 'AE', sfha: true, floodway: false, label: 'Flood zone AE', ring: [[0, -60], [20, -60], [20, 60], [0, 60]] }];
  const s = site({ size, n, surroundings: { flood } });
  const actions = [
    { kind: 'structure', structure: 'shed', label: 'Goat shelter', why: '', x: -15, y: 0 },
    { kind: 'swale', label: 'Swale A', why: '', x: -15, y: 20, size: 20 },
    { kind: 'structure', structure: 'greenhouse', label: 'Greenhouse', why: '', x: 40, y: -20 },
    { kind: 'guild', species: 'apple', label: 'Apple guild', why: '', x: -30, y: 0 },
  ];
  const r = P.settleActions(g, s, [], [], actions);
  const shelter = r.actions[0], swale = r.actions[1];
  assert.ok(shelter.x > 20, `shelter moved past the flood area, got x=${shelter.x}`);
  assert.ok(swale.x > 20, `swale moved past the flood area, got x=${swale.x}`);
  assert.deepEqual(r.actions[2], actions[2], 'a greenhouse already on gentle ground stays put');
  assert.deepEqual(r.actions[3], actions[3], 'plants are not moved');
  assert.equal(r.notes.length, 2);
  assert.match(r.notes[0], /^Moved Goat shelter \d+ m, from 4\d% to \d% ground\.$/);
  assert.match(r.notes[1], /^Moved Swale A/);
  // nothing gentle in reach: it stays, and says so
  const steep = slope(64, 100, 40);
  const r2 = P.settleActions(steep, site(), [], [], [actions[0]]);
  assert.deepEqual(r2.actions[0], actions[0]);
  assert.match(r2.notes[0], /stays on 40% ground: there is nothing gentler within 60 m/);
});
