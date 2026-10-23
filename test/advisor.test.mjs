// The plant advisor against nine real places, checked against what local extension services
// and horticultural societies publish. Climates are frozen snapshots (test/fixtures), so this
// runs offline and a change to the model that breaks a known-good answer fails here.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildSiteClimate, advise, microclimate, dayLength, mmddToDoy } from '../src/lib/advisor.ts';
import { LIBRARY, LIBRARY_BY_ID } from '../src/lib/library.ts';

const FIX = JSON.parse(fs.readFileSync(new URL('./fixtures/climates.json', import.meta.url)));
const site = (k, o) => buildSiteClimate(FIX[k].climate, FIX[k].lat, o);
const A = (k, id, pz = id && LIBRARY_BY_ID[id].life === 'annual' ? 1 : 2, zc = null, o) => advise(LIBRARY_BY_ID[id], site(k, o), zc, pz, null);
const line = (a, kind) => a.calendar.find((l) => l.kind === kind);
const covers = (ranges, mmdd) => {
  const d = mmddToDoy(mmdd);
  return ranges.some((r) => ((d - r.start + 365) % 365) <= ((r.end - r.start + 365) % 365));
};
const plantOut = (a) => (line(a, 'transplant') || line(a, 'sow')).ranges;

test('the library is complete and well formed', () => {
  const ids = new Set();
  for (const p of LIBRARY) {
    assert.ok(!ids.has(p.id), `duplicate ${p.id}`); ids.add(p.id);
    assert.ok(p.pz.length, `${p.id} has no permaculture zone`);
    assert.ok(p.zoneMin <= p.zoneMax, `${p.id} zone range`);
    if (p.life === 'annual') assert.ok(p.crop, `${p.id} annual without crop timing`);
    if (p.crop) assert.ok(p.crop.days > 0 && p.crop.spacingCm > 0);
    for (const t of [p.notes, p.caution, ...(p.varieties || []).map((v) => v.text)]) assert.ok(!t || !t.includes('—'), `${p.id} has an em dash`);
  }
  assert.ok(LIBRARY.length >= 150, `library has ${LIBRARY.length}`);
  for (const z of [0, 1, 2, 3, 4]) assert.ok(LIBRARY.filter((p) => p.pz.includes(z)).length >= 15, `zone ${z} is thin`);
});

test('official USDA zone wins over the estimate in the US', () => {
  assert.equal(site('boulder').zoneLabel, '6a');
  assert.equal(site('fairbanks').zoneLabel, '3a');
  assert.match(site('boulder').zoneSource, /USDA/);
  assert.match(site('london').zoneSource, /Estimated/);
});

test('Austin, Texas (Travis County AgriLife calendar)', () => {
  const t = A('austin', 'tomato');
  assert.ok(covers(line(t, 'transplant').ranges, '03-20'), 'spring tomatoes in March');
  assert.ok(covers(line(t, 'transplant').ranges, '08-20'), 'fall tomatoes in August');
  assert.ok(!covers(line(t, 'transplant').ranges, '06-20'), 'not in midsummer');
  assert.ok(covers(plantOut(A('austin', 'lettuce')), '10-15') && !covers(plantOut(A('austin', 'lettuce')), '07-01'));
  assert.ok(covers(plantOut(A('austin', 'onion')), '01-25'), 'onion transplants in January');
  assert.match(A('austin', 'onion').variety, /Intermediate-day/);
  assert.match(A('austin', 'peach').variety, /Mid-chill/);
  assert.equal(A('austin', 'mango').status, 'no');
});

test('Boulder, Colorado (CSU Extension)', () => {
  assert.ok(covers(plantOut(A('boulder', 'tomato')), '06-01'));
  assert.ok(!covers(plantOut(A('boulder', 'tomato')), '04-20'), 'no tomatoes before last frost');
  assert.ok(covers(plantOut(A('boulder', 'peas')), '04-10'), 'peas in early spring');
  assert.ok(covers(plantOut(A('boulder', 'garlic')), '10-15'), 'garlic in October');
  assert.match(A('boulder', 'garlic').variety, /Hardneck/);
  assert.equal(A('boulder', 'citrus').status, 'no');
  assert.notEqual(A('boulder', 'apple').status, 'no');
});

test('Phoenix, Arizona (University of Arizona low-desert calendar)', () => {
  const t = plantOut(A('phoenix', 'tomato'));
  assert.ok(covers(t, '03-01') && !covers(t, '06-15'), 'tomatoes in late winter, never midsummer');
  assert.ok(covers(plantOut(A('phoenix', 'lettuce')), '11-15') && !covers(plantOut(A('phoenix', 'lettuce')), '06-15'));
  assert.ok(covers(plantOut(A('phoenix', 'okra')), '06-15'), 'okra loves the summer');
  assert.equal(A('phoenix', 'macadamia').status, 'no', 'desert heat');
  assert.equal(A('phoenix', 'datepalm').status, 'good');
});

test('Miami, Florida (UF/IFAS south Florida calendar)', () => {
  const t = plantOut(A('miami', 'tomato'));
  assert.ok(covers(t, '10-15') && !covers(t, '07-01'), 'tomatoes in the dry season, not the wet summer');
  assert.ok(!covers(plantOut(A('miami', 'cucumber')), '07-15'), 'no temperate vegetables in the steamy summer');
  assert.ok(covers(plantOut(A('miami', 'okra')), '07-15'), 'okra takes the summer');
  for (const id of ['mango', 'avocado', 'banana', 'papaya']) assert.equal(A('miami', id).status, 'good', id);
  for (const id of ['apple', 'peach', 'blueberry', 'garlic']) assert.equal(A('miami', id).status, 'no', id);
});

test('Seattle and London: cool summers', () => {
  for (const k of ['seattle', 'london']) {
    for (const id of ['citrus', 'pomegranate', 'olive', 'ginger', 'mesquite', 'watermelon']) assert.notEqual(A(k, id).status, 'good', `${k} ${id}`);
    for (const id of ['apple', 'pear', 'raspberry', 'blueberry', 'rhubarb', 'kale']) assert.notEqual(A(k, id).status, 'no', `${k} ${id}`);
    assert.ok(!covers(plantOut(A(k, 'lettuce')), '12-15'), `${k} no lettuce sown in midwinter`);
  }
  assert.ok(covers(plantOut(A('london', 'tomato')), '06-05'), 'RHS: plant tomatoes out in early June');
  assert.match(A('seattle', 'blueberry').variety, /Northern highbush/);
});

test('Sydney: the southern hemisphere runs six months out', () => {
  const t = plantOut(A('sydney', 'tomato'));
  assert.ok(covers(t, '10-15') && !covers(t, '06-15'), 'spring is October');
  assert.ok(covers(plantOut(A('sydney', 'onion')), '07-15'), 'onions in winter');
  assert.equal(A('sydney', 'apple').status, 'no');
});

test('Nairobi: tropical highlands', () => {
  assert.equal(A('nairobi', 'coffee').status, 'good');
  assert.equal(A('nairobi', 'avocado').status, 'good');
  assert.notEqual(A('nairobi', 'onion').status, 'no', 'short-day onions near the equator');
  assert.notEqual(A('nairobi', 'jackfruit').status, 'good', 'too cool for lowland tropicals');
});

test('Fairbanks, Alaska: short, cold summers', () => {
  for (const id of ['haskap', 'saskatoon', 'currant', 'sourcherry', 'cabbage', 'potato', 'onion']) assert.notEqual(A('fairbanks', id).status, 'no', id);
  for (const id of ['grape', 'peach', 'sweetcorn', 'pepper', 'garlic']) assert.equal(A('fairbanks', id).status, 'no', id);
  assert.match(A('fairbanks', 'apple').variety, /Cold-hardy/);
});

test('zone 0 grows indoors whatever the weather', () => {
  const a = A('fairbanks', 'basil', 0);
  assert.equal(a.status, 'good');
  assert.ok(covers(line(a, 'sow').ranges, '01-15'));
  assert.notEqual(A('boulder', 'meyerlemon', 0).status, 'no', 'a Meyer lemon in a pot');
  assert.equal(A('boulder', 'meyerlemon', 2).status, 'no', 'but not planted outside');
});

test('your own frost dates and zone override the estimate', () => {
  const base = plantOut(A('london', 'tomato'));
  const late = plantOut(A('london', 'tomato', 1, null, { lastFrost: '06-01' }));
  assert.ok(covers(base, '06-05'));
  assert.ok(!covers(late, '06-05'), 'a later last frost pushes planting later');
  assert.equal(A('boulder', 'fig', 2, null, { zone: '8a' }).status === 'no', false);
});

test('microclimate: a warm slope helps, a frost pocket hurts, sun and wet ground count', () => {
  const warm = microclimate({ area: 400, meanSlope: 15, aspect: 180, aspectName: 'S', sunHours: 9, wetFraction: 0, lowSpot: false, elevMin: 0, elevMax: 5 }, 40);
  const pocket = microclimate({ area: 400, meanSlope: 1, aspect: null, aspectName: 'flat', sunHours: 9, wetFraction: 0.3, lowSpot: true, elevMin: 0, elevMax: 1 }, 40);
  assert.equal(warm.zoneShift, 0.5);
  assert.equal(pocket.zoneShift, -0.5);
  // Boulder 6a: a fig is at the edge on flat ground, better on a warm slope
  const flat = A('boulder', 'fig');
  const slope = A('boulder', 'fig', 2, warm);
  assert.equal(flat.status, 'no');
  assert.notEqual(slope.status, 'no');
  const shady = microclimate({ area: 400, meanSlope: 2, aspect: null, aspectName: 'flat', sunHours: 3, wetFraction: 0, lowSpot: false, elevMin: 0, elevMax: 1 }, 40);
  assert.equal(A('austin', 'tomato', 1, shady).status, 'no', 'tomatoes need sun');
  assert.ok(A('boulder', 'elderberry', 2, pocket).good.some((g) => /wet ground/.test(g)));
});

test('day length', () => {
  assert.ok(Math.abs(dayLength(0, 80) - 12.1) < 0.2);
  assert.ok(dayLength(40, 172) > 14.8 && dayLength(40, 172) < 15.2);
  assert.ok(dayLength(-34, 172) < 10);
  assert.equal(dayLength(70, 172), 24);
});
