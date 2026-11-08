// The plant brain around the world: real climate snapshots (ERA5 via the app's own climate route,
// 2026-11-08) for 18 places from the lowland tropics to Fairbanks, checked against what growers
// there actually plant. Written after a worldwide test found the tropics judged "too warm".
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildSiteClimate, advise } from '../src/lib/advisor.ts';
import { LIBRARY_BY_ID } from '../src/lib/library.ts';
import { zoneFit } from '../src/lib/plants.ts';
import { guildSpecies, hedgeSpecies, reviewDesign } from '../src/lib/permaculture.ts';
import { plantChecks } from '../src/lib/checks.ts';
import { frostDates } from '../server/geo.mjs';

const W = JSON.parse(fs.readFileSync(new URL('./fixtures/world-climates.json', import.meta.url)));
const sc = (k) => buildSiteClimate(W[k].climate, W[k].lat);
const A = (k, id) => { const sp = LIBRARY_BY_ID[id]; return advise(sp, sc(k), null, sp.life === 'annual' ? 1 : 2, null); };
const fitFor = (k) => (id) => A(k, id).status;
const notNo = (k, ids) => { for (const id of ids) assert.notEqual(A(k, id).status, 'no', `${id} in ${k}: ${A(k, id).issues.map((i) => i.text).join(' ')}`); };
const no = (k, ids) => { for (const id of ids) assert.equal(A(k, id).status, 'no', `${id} in ${k}`); };

test('lowland tropics: the staples grow, temperate crops do not', () => {
  for (const k of ['costarica_limon', 'kerala_kochi', 'bali_ubud']) notNo(k, ['banana', 'coconut', 'mango']);
  notNo('costarica_limon', ['cassava', 'avocado']);
  assert.equal(A('costarica_limon', 'banana').status, 'good');
  no('costarica_limon', ['parsnip', 'oats', 'quinoa']);
  for (const id of ['cabbage', 'parsnip']) assert.ok(!A('kerala_kochi', id).issues.some((i) => /row cover/.test(i.text)), `${id}: protection is no help against heat`);
  assert.ok(zoneFit(LIBRARY_BY_ID.banana, 13).ok, 'zone 13 is not too warm for a banana');
});

test('tropical guilds and hedgerows are not empty, and never pick a weed', () => {
  for (const k of ['costarica_limon', 'bali_ubud', 'nairobi', 'hawaii_hilo']) {
    const g = guildSpecies(LIBRARY_BY_ID.mango, 13, fitFor(k), W[k]);
    assert.ok(g.length >= 1, `${k} guild`);
    assert.ok(!g.some((m) => m.species.id === 'bermuda'), `${k}: bermudagrass is not a living mulch`);
  }
  const h = hedgeSpecies(3, fitFor('minnesota_stcloud'), [], W.minnesota_stcloud);
  assert.notEqual(h.tall?.id, 'alder');
  assert.notEqual(h.low?.id, 'alder');
});

test('the review does not tell a tropical client their bananas will die', () => {
  const k = 'costarica_limon';
  const site = { lat: W[k].lat, lon: W[k].lon, size: 100, climate: W[k].climate, overrides: {} };
  const objects = ['banana', 'mango', 'coconut'].map((s, i) => ({ id: `p${i}`, type: 'plant', species: s, x: i * 5, y: 0, name: s }));
  const r = reviewDesign({ site, objects, features: [], zone: 13, meanSlope: 3, cutM3: 0, fillM3: 0, roofCatchL: null });
  const t = r.areas.flatMap((a) => a.findings).map((f) => f.text).join(' ');
  assert.ok(!/not suit|not survive/.test(t), t);
});

test('mild and oceanic climates: no fake "needs real winters"', () => {
  notNo('ireland_galway', ['currant', 'gooseberry', 'rhubarb']);
  no('ireland_galway', ['coffee', 'pineapple']);
  notNo('nairobi', ['strawberry', 'comfrey', 'asparagus']);
  notNo('india_pune', ['fig', 'pomegranate', 'grape', 'garlic']);
  notNo('melbourne', ['citrus']);
});

test('cold winters: hardy fall crops survive, harvests stop at frost', () => {
  notNo('minnesota_stcloud', ['garlic', 'cerealrye']);
  for (const [k, id] of [['minnesota_stcloud', 'tomato'], ['fairbanks', 'kale']]) {
    const h = A(k, id).calendar.find((l) => l.kind === 'harvest');
    for (const r of h.ranges) assert.ok(r.end < 340 && r.end > 150, `${id} in ${k} harvest ends day ${r.end}`);
  }
});

test('frost dates: a winter whose frosts all fall in January still has a first and a last frost', () => {
  const time = [], mins = [];
  for (let y = 2015; y < 2025; y++) for (let d = 0; d < 365; d++) {
    const dt = new Date(Date.UTC(y, 0, 1 + d));
    time.push(dt.toISOString().slice(0, 10));
    mins.push(d >= 10 && d <= 40 && d % 5 === 0 ? -1 : 6); // frosts Jan 11 to Feb 10 only
  }
  const f = frostDates({ time, temperature_2m_min: mins }, 38.5);
  assert.equal(f.frostFree, false);
  assert.ok(f.firstMean >= 10 && f.firstMean <= 13, `first ${f.firstMean}`);
  assert.ok(f.lastMean >= 39 && f.lastMean <= 42, `last ${f.lastMean}`);
  assert.ok(f.seasonSafe > 330, `season ${f.seasonSafe}`);
  const s = frostDates({ time, temperature_2m_min: mins.map((_, i) => { const d = i % 365; return d >= 160 && d <= 220 && d % 5 === 0 ? -1 : 6; }) }, -37.8);
  assert.ok(s.firstMean > 150 && s.firstMean < 170 && s.lastMean > 210 && s.lastMean < 225, JSON.stringify(s));
});

test('invasive warnings follow the region', () => {
  const p = (id) => [{ id: 'a', type: 'plant', species: id, x: 0, y: 0 }];
  const flagged = (id, lat, lon) => plantChecks(p(id), { lat, lon }).some((c) => c.ids.includes('a'));
  assert.ok(flagged('blackberry', -33.9, 151.2), 'blackberry in Sydney');
  assert.ok(!flagged('blackberry', 51.5, -0.1), 'blackberry in London is native');
  assert.ok(flagged('blacklocust', -41.3, 174.8), 'black locust in New Zealand');
  assert.ok(!flagged('blacklocust', 36, -84), 'black locust in Tennessee is native');
  assert.ok(!flagged('alder', 53.3, -9), 'alder in Ireland is native');
  assert.ok(flagged('alder', 44, -73), 'alder in Vermont');
  assert.ok(flagged('guava', 19.7, -155.1), 'guava in Hawaii');
  assert.ok(flagged('mesquite', -23.7, 133.9), 'mesquite in Alice Springs');
  const rust = plantChecks([{ id: 'c', type: 'plant', species: 'redcedar', x: 0, y: 0 }, { id: 'd', type: 'plant', species: 'apple', x: 5, y: 0 }], { lat: 52, lon: 5 });
  assert.ok(!rust.some((c) => /rust/.test(c.text)), 'no cedar-apple rust in Europe');
});

test('outside the US, the US-only maps are "not available here", never "checked and clear"', async () => {
  const { layerStatus } = await import('../src/lib/checks.ts');
  const surroundings = { fetched: '', errors: { flood: 'US only', wetlands: 'US only', streams: 'US only', soils: 'US only' }, flood: null, wetlands: null, streams: null, soils: null, osm: { buildings: [], roads: [], water: [], areas: [] } };
  const site = { lat: -23.55, lon: -46.63, size: 100, surroundings };
  const ls = layerStatus(site);
  assert.ok(ls.find((l) => l.key === 'flood').usOnly && !ls.find((l) => l.key === 'flood').loaded);
  const r = reviewDesign({ site, objects: [{ id: 'h', type: 'building', name: 'House', x: 0, y: 0, w: 10, d: 10 }], features: [], zone: 11, meanSlope: 3, cutM3: 0, fillM3: 0, roofCatchL: null });
  const t = r.areas.flatMap((a) => a.findings).map((f) => f.text).join(' | ');
  assert.ok(!/Checked against the FEMA|Checked against the wetlands/.test(t), t);
  assert.match(t, /cover the United States only/);
});
