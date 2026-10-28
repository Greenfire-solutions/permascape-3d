// The review is handed to clients, so it may only say what was really checked.
// Found by a buyer test on 2026-10-28: the soil map failed (502) yet the review said
// "soils are loaded and checked" and scored Siting 100; a house, beds and a field drawn over
// mapped parking, paths and woods got no flag; "No zones mapped" sat beside "Zone 1 sits next to
// the house"; an empty design scored 50 on Water with "Roof water is caught in a tank"; and the
// report named flood zone AE while saying 0 sq ft of the site was in it.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../src/lib/permaculture.ts';
import { sitingChecks, overlapChecks, groundProblem, layerStatus, floodOnSite, surroundingsBrief } from '../src/lib/checks.ts';
import { parseOsm, clipRing } from '../server/geo.mjs';

let k = 0;
const id = () => `h${k++}`;
const obj = (type, x, y, extra = {}) => ({ id: id(), type, name: type, x, y, rotation: 0, scale: 1, events: [], ...extra });
const site = (extra = {}) => ({
  address: 'Test', lat: 30.18, lon: -97.87, size: 200, n: 64, base: 250, source: 't', sourceResM: 1,
  climate: { years: 10, period: '', annualPrecipMm: 860, monthlyPrecipMm: Array(12).fill(72), monthlyMeanMinC: Array(12).fill(12), monthlyMeanMaxC: Array(12).fill(27),
    meanAnnualMinC: -6, zone: { zone: 8, label: '8b', minF: 15 }, frostFree: false, lastSpringFrost: null, firstFallFrost: null, growingSeasonDays: 260, source: 't' },
  ...extra,
});
const OSM = {
  buildings: [{ name: 'Visitor Center', kind: 'building', ring: [[40, 40], [60, 40], [60, 60], [40, 60]] }],
  roads: [
    { name: null, kind: 'footway', service: null, surface: null, line: [[-80, 0], [80, 0]] },
    { name: null, kind: 'service', service: 'parking_aisle', surface: null, line: [[-60, -60], [-20, -60]] },
  ],
  water: [],
  areas: [
    { name: null, kind: 'parking', ring: [[-70, -80], [-10, -80], [-10, -40], [-70, -40]] },
    { name: null, kind: 'woodland', ring: [[20, -90], [90, -90], [90, -20], [20, -20]] },
  ],
};
const loaded = (extra = {}) => ({ fetched: '', errors: {}, sources: {}, flood: [], wetlands: [], streams: [], soils: [], osm: OSM, ...extra });
const review = (s, objects, features = [], more = {}) => P.reviewDesign({ site: s, objects, features, zone: 8, meanSlope: 4, cutM3: 0, fillM3: 0, roofCatchL: 60000, ...more });
const siting = (r) => r.areas.find((a) => a.id === 'siting');
const texts = (a) => a.findings.map((f) => f.text).join(' | ');

test('a map that did not load is "not checked", never "loaded and checked", and is left out of the score', () => {
  const s = site({ surroundings: loaded({ soils: null, errors: { soils: 'soil service answered 502' } }) });
  const house = obj('building', 0, 30, { name: 'House', width: 10, depth: 12 });
  const r = review(s, [house, obj('tank', 8, 30)]);
  const a = siting(r);
  assert.match(texts(a), /Not checked: the soil map did not load \(the service answered with error 502\)/);
  assert.ok(!/soils are loaded and checked|Checked against the soil map/i.test(texts(a)), texts(a));
  assert.equal(layerStatus(s).find((l) => l.key === 'soils').loaded, false);
  // the score is the same as if the soil rule did not exist: the other maps still pass
  assert.ok(a.scored);
  const ok = review(site({ surroundings: loaded() }), [house, obj('tank', 8, 30)]);
  assert.match(texts(siting(ok)), /Checked against the soil map/);
  // nothing loaded at all: the area is not scored, and the overall does not count it
  const none = review(site(), [house]);
  assert.equal(siting(none).scored, false);
  assert.match(texts(siting(none)), /Not checked yet/);
  const scored = none.areas.filter((x) => x.scored);
  assert.equal(none.overall, Math.round(scored.reduce((t, x) => t + x.score, 0) / scored.length));
  // every map down: each one is named
  const down = site({ surroundings: { fetched: '', errors: { flood: 'answered 503', wetlands: 'x', streams: 'answered 502', soils: 'soil service answered 502', osm: 'answered 504' }, sources: {}, flood: null, wetlands: null, streams: null, soils: null, osm: null } });
  const t = texts(siting(review(down, [house])));
  for (const name of ['FEMA flood map', 'wetlands map', 'stream map', 'soil map', 'map of roads, paths, parking and buildings']) assert.match(t, new RegExp(`Not checked: the ${name}`));
  assert.ok(!/Checked against/.test(t));
  // the AI is told too
  assert.ok(surroundingsBrief(down).notLoaded.length === 5);
});

test('things drawn over mapped parking, paths, buildings and woods are flagged; existing things are not', () => {
  const s = site({ surroundings: loaded() });
  const house = obj('building', -40, -60, { name: 'House', width: 10, depth: 12 });
  const bed = obj('garden', 0, 0, { name: 'Kitchen bed', width: 1.2, depth: 6 });
  const shed = obj('building', 50, 50, { name: 'Tool shed', width: 4, depth: 4 });
  const pond = obj('pond', 55, -55, { name: 'Pond', radius: 6 });
  const field = { id: id(), kind: 'zone', zone: 3, name: 'Grain field', points: [[-75, -85], [-5, -85], [-5, -35], [-75, -35]] };
  const pasture = { id: id(), kind: 'paddock', animal: 'goats', name: 'Goat paddock', points: [[25, -85], [85, -85], [85, -25], [25, -25]] };
  const out = sitingChecks({ site: s, objects: [house, bed, shed, pond], features: [field, pasture] });
  const t = out.map((c) => c.text).join(' | ');
  const of = (o) => out.filter((c) => c.ids.includes(o.id));
  assert.match(of(house).map((c) => c.text).join(' '), /House is drawn on top of .*parking/);
  assert.equal(of(house)[0].level, 'warn');
  assert.match(of(bed)[0].text, /Kitchen bed is drawn on top of a mapped footpath/);
  assert.equal(of(bed)[0].level, 'tip', 'a bed over a path is a tip, a building over one would be a warning');
  assert.match(of(shed)[0].text, /Tool shed is drawn on top of the existing Visitor Center/);
  assert.match(of(pond).map((c) => c.text).join(' '), /Pond takes in about .* sq ft of mapped woodland/);
  assert.match(t, /Grain field \(zone 3\) takes in about .* sq ft of a mapped parking lot/);
  assert.match(t, /Goat paddock takes in .*mapped woodland/);
  for (const c of out) assert.ok(!/[—–]/.test(c.text), 'no dashes');
  // existing things are what is there: never judged
  assert.equal(overlapChecks({ site: s, objects: [{ ...house, status: 'existing' }], features: [] }).length, 0);
  // a zone 1 around the house takes in the house and the drive without complaint
  const z1 = { id: id(), kind: 'zone', zone: 1, name: 'Zone 1', points: [[30, 30], [70, 30], [70, 70], [30, 70]] };
  assert.equal(overlapChecks({ site: s, objects: [], features: [z1] }).length, 0);
  // clear ground: nothing to say
  assert.equal(overlapChecks({ site: s, objects: [obj('building', -40, 40, { width: 8, depth: 10 })], features: [] }).length, 0);
  // the review: the warning costs the siting score and its "nothing built over them" line is not shown
  const r = siting(review(s, [house, bed]));
  assert.ok(r.findings.some((f) => /drawn on top of/.test(f.text)));
  assert.ok(!r.findings.some((f) => /nothing proposed is built over them/.test(f.text)));
  assert.ok(r.score < 100);
  // the AI's ground picker avoids parking, mapped buildings and paths too
  assert.equal(groundProblem(s, [], -40, -50), 'parking');
  assert.equal(groundProblem(s, [], 50, 50), 'existing building');
  assert.equal(groundProblem(s, [], 0, 0.5), 'a mapped footpath');
});

test('Permie critic sees the overlaps: a proposal over parking is checked like a hand-drawn one', () => {
  const s = site({ surroundings: loaded() });
  const n = 64, w = n + 1;
  const g = { heights: new Float32Array(w * w), n, size: 200 };
  const actions = [{ kind: 'structure', structure: 'building', label: 'House', why: '', x: -40, y: -60 }, { kind: 'garden', label: 'Bed', why: '', x: 0, y: 0, width: 1.2, depth: 6 }];
  const r = P.applyActions({ heights: g.heights, objects: [], features: [] }, g, actions, [0, 1], { zone: 8, day: '2026-10-28', id });
  const t = sitingChecks({ site: s, objects: r.state.objects, features: r.state.features }).map((c) => c.text).join(' | ');
  assert.match(t, /House is drawn on top of/);
  assert.match(t, /Bed is drawn on top of a mapped footpath/);
});

test('OpenStreetMap parking, woods and multipolygon woods are read, and the path kind is kept', () => {
  const lat = 30.18, lon = -97.87, d = 0.0003;
  const sq = (cx, cy, r) => [[cx - r, cy - r], [cx + r, cy - r], [cx + r, cy + r], [cx - r, cy + r], [cx - r, cy - r]].map(([x, y]) => ({ lon: lon + x, lat: lat + y }));
  const j = { elements: [
    { type: 'way', tags: { amenity: 'parking' }, nodes: [1, 2, 3, 4, 1], geometry: sq(0, 0, d) },
    { type: 'way', tags: { highway: 'service', service: 'parking_aisle' }, nodes: [5, 6], geometry: [{ lon, lat }, { lon: lon + d, lat }] },
    { type: 'way', tags: { highway: 'footway' }, nodes: [7, 8], geometry: [{ lon, lat }, { lon, lat: lat + d }] },
    { type: 'relation', tags: { type: 'multipolygon', natural: 'wood', name: 'Oak grove' }, members: [
      { type: 'way', role: 'outer', geometry: sq(0.0005, 0.0005, 0.0002).slice(0, 3) },
      { type: 'way', role: 'outer', geometry: sq(0.0005, 0.0005, 0.0002).slice(2) },
    ] },
  ] };
  const o = parseOsm(j, lat, lon, 200);
  assert.equal(o.areas.filter((a) => a.kind === 'parking').length, 1);
  const wood = o.areas.find((a) => a.kind === 'woodland');
  assert.ok(wood, 'the two halves of the wood were joined into one ring');
  assert.equal(wood.name, 'Oak grove');
  assert.equal(o.roads.find((r) => r.kind === 'service').service, 'parking_aisle');
  assert.ok(o.roads.some((r) => r.kind === 'footway'));
});

test('one zone is "only one zone", never "no zones mapped" beside zone 1 praise', () => {
  const s = site({ surroundings: loaded() });
  const house = obj('building', 0, 0, { name: 'House', width: 8, depth: 10 });
  const z1 = { id: id(), kind: 'zone', zone: 1, name: 'Zone 1', points: [[-15, -15], [15, -15], [15, 15], [-15, 15]] };
  const t = texts(review(s, [house], [z1]).areas.find((a) => a.id === 'zones'));
  assert.ok(!/No zones mapped/.test(t), t);
  assert.match(t, /Only one zone is drawn \(Zone 1\)/);
  assert.match(t, /Zone 1 sits next to the house/);
  // no zones at all still says so
  assert.match(texts(review(s, [house]).areas.find((a) => a.id === 'zones')), /No zones mapped/);
  // a zone with no house does not crash
  assert.doesNotThrow(() => review(s, [], [z1]));
});

test('an empty design gets no water credit: no roof, no "roof water is caught"', () => {
  const small = site({ size: 50 });
  const r = P.reviewDesign({ site: small, objects: [], features: [], zone: 8, meanSlope: 1, cutM3: 0, fillM3: 0, roofCatchL: null });
  const w = r.areas.find((a) => a.id === 'water');
  assert.equal(w.scored, false, 'nothing to judge on gentle, small, empty land');
  assert.ok(!/Roof water is caught|Tank storage is in proportion/.test(texts(w)));
  // on a big sloping site an empty design scores zero, not fifty
  const big = review(site(), [], [], { meanSlope: 8 });
  assert.equal(big.areas.find((a) => a.id === 'water').score, 0);
  // a roof with no tank is a warning; a roof with a tank is the pass
  assert.match(texts(review(site(), [obj('building', 0, 0)]).areas.find((a) => a.id === 'water')), /roofs shed water that nothing catches/);
  assert.match(texts(review(site(), [obj('building', 0, 0), obj('tank', 5, 0, { capacityL: 20000 })]).areas.find((a) => a.id === 'water')), /Roof water is caught in a tank/);
});

test('a flood zone that only touches the edge of the square is "nearby", never "AE ... 0 sq ft"', () => {
  // FEMA returns the polygon because it touches the padded box; clipped to the site it is a sliver
  const sliver = clipRing([[100, -50], [140, -50], [140, 50], [100, 50]], 100);
  const s = site({ surroundings: loaded({ flood: [{ zone: 'AE', sfha: true, floodway: false, label: 'Flood zone AE: 1% a year flood area', ring: sliver.length ? sliver : [[100, -50], [100, -50], [100, 50]] }] }) });
  const f = floodOnSite(s);
  assert.deepEqual(f.onLabels, []);
  assert.deepEqual(f.nearNames, ['Flood zone AE']);
  const inside = site({ surroundings: loaded({ flood: [{ zone: 'AE', sfha: true, floodway: false, label: 'Flood zone AE: 1% a year flood area', ring: [[-50, -50], [0, -50], [0, 0], [-50, 0]] }] }) });
  const g = floodOnSite(inside);
  assert.deepEqual(g.onNames, ['Flood zone AE']);
  assert.ok(Math.abs(g.areaM2 - 2500) < 1);
  assert.equal(floodOnSite(site({ surroundings: loaded({ flood: null, errors: { flood: 'answered 503' } }) })), null, 'not loaded is not "none"');
});
