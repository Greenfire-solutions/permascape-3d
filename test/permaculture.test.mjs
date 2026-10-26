// The design tools that work on the plan: guilds, hedgerows, keylines, sectors, the water
// budget, the design review, applying a proposal, and the wind rose.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../src/lib/permaculture.ts';
import { LIBRARY_BY_ID } from '../src/lib/library.ts';
import { windRose } from '../server/sources.mjs';
import { scrubDashes, buildPrompt } from '../server/ai.mjs';

// a slope rising to the south, 10%
function slope(n = 64, size = 100) {
  const w = n + 1, h = new Float32Array(w * w);
  for (let r = 0; r < w; r++) for (let c = 0; c < w; c++) h[r * w + c] = 0.1 * (r / n) * size;
  return { heights: h, n, size };
}
let k = 0;
const id = () => `id${k++}`;

test('a guild puts suited support plants around the tree, each one fitting the zone', () => {
  const g = P.buildGuild('apple', 10, 5, 6);
  assert.equal(g[0].species.id, 'apple');
  assert.ok(g.length >= 7, `${g.length} members`);
  const roles = new Set(g.map((m) => m.role));
  assert.ok(roles.has('Nitrogen fixer') && roles.has('Living mulch'));
  for (const m of g.slice(1)) {
    assert.ok(m.species.zoneMin <= 6 && m.species.zoneMax >= 6, `${m.species.id} fits zone 6`);
    assert.ok(Math.hypot(m.x - 10, m.y - 5) <= LIBRARY_BY_ID.apple.spreadM / 2 + 0.01, 'inside the drip line');
  }
  // a cold site gets cold-hardy helpers or none, never tender ones
  for (const m of P.buildGuild('apple', 0, 0, 3).slice(1)) assert.ok(m.species.zoneMin <= 3);
});

test('a hedgerow spaces trees along the line and staggers a shrub row beside it', () => {
  const h = P.buildHedge([[-50, 0], [50, 0]], 6);
  assert.ok(h.tall && h.low);
  const tall = h.plants.filter((p) => p.species === h.tall);
  const low = h.plants.filter((p) => p.species === h.low);
  assert.ok(tall.length >= 10 && low.length >= 10);
  assert.ok(tall.every((p) => Math.abs(p.y) < 1e-6), 'trees on the line');
  assert.ok(low.every((p) => Math.abs(Math.abs(p.y) - 1.6) < 1e-6), 'shrubs 1.6 m off it');
});

test('points along a line come at the asked spacing', () => {
  const pts = P.alongLine([[0, 0], [10, 0], [10, 10]], 2.5);
  assert.equal(pts.length, 9);
  for (let i = 1; i < pts.length; i++) assert.ok(Math.abs(Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]) - 2.5) < 1e-6 || i === 4);
});

test('the keyline pattern starts on contour and adds parallel lines either side', () => {
  const g = slope();
  const lines = P.keylinePattern(g, 0, 0, 8, 3, 80);
  assert.ok(lines.length >= 5, `${lines.length} lines`);
  // the first is level: every point at the same height on this plane
  const ys = lines[0].map((p) => p[1]);
  assert.ok(Math.max(...ys) - Math.min(...ys) < 0.5);
  // the others are 8 m apart
  const offsets = lines.slice(1).map((l) => Math.abs(l[Math.floor(l.length / 2)][1] - lines[0][0][1])).sort((a, b) => a - b);
  assert.ok(Math.abs(offsets[0] - 8) < 0.6, offsets.join(','));
});

test('sun sectors match the solstice sunrise and sunset in Austin', () => {
  const s = P.sunSectors(30.27, -97.74);
  // published: about 62 and 298 degrees at the June solstice, 117 and 243 in December
  assert.ok(Math.abs(s.summer.rise - 62.5) < 2.5 && Math.abs(s.summer.set - 297.5) < 2.5, JSON.stringify(s.summer));
  assert.ok(Math.abs(s.winter.rise - 117.5) < 2.5 && Math.abs(s.winter.set - 242.5) < 2.5, JSON.stringify(s.winter));
  assert.ok(Math.abs(s.summer.noonAlt - 83.2) < 1 && Math.abs(s.winter.noonAlt - 36.3) < 1);
  // the southern hemisphere's summer is December
  const syd = P.sunSectors(-33.87, 151.2);
  assert.ok(syd.summer.noonAlt > 75 && syd.winter.noonAlt < 35);
});

test('bearing is a compass bearing', () => {
  assert.equal(Math.round(P.bearing([0, 0], [0, 10])), 0);
  assert.equal(Math.round(P.bearing([0, 0], [10, 0])), 90);
  assert.equal(Math.round(P.bearing([0, 0], [0, -10])), 180);
});

const site = (extra = {}) => ({
  address: 'Test', lat: 30.27, lon: -97.74, size: 100, n: 64, base: 150, source: 't', sourceResM: 1,
  climate: { years: 10, period: '', annualPrecipMm: 860, monthlyPrecipMm: [50, 50, 60, 60, 110, 100, 50, 60, 80, 100, 70, 60],
    monthlyMeanMinC: [5, 7, 11, 15, 19, 22, 23, 23, 20, 15, 10, 6], monthlyMeanMaxC: [17, 19, 23, 27, 31, 34, 36, 36, 33, 28, 22, 18],
    meanAnnualMinC: -7, zone: { zone: 8, label: '8b', minF: 15 }, frostFree: false, lastSpringFrost: null, firstFallFrost: null, growingSeasonDays: 260, source: 't' },
  ...extra,
});

test('the water budget: evaporation in a plausible range, roof water fills tanks, shortfall when tanks are small', () => {
  const objects = [
    { id: 'h', type: 'building', name: 'House', x: 0, y: 0, rotation: 0, scale: 1, width: 10, depth: 12, events: [] },
    ...Array.from({ length: 20 }, (_, i) => ({ id: 'p' + i, type: 'plant', species: 'fig', name: 'f', x: i * 3, y: 20, rotation: 0, scale: 1, events: [] })),
  ];
  const b = P.waterBudget(site(), objects, [], 1);
  assert.ok(b.yearEt0 > 1200 && b.yearEt0 < 2200, `Austin reference evaporation ${b.yearEt0.toFixed(0)} mm`);
  assert.ok(Math.abs(b.yearRoofL - 120 * 850 * 0.8) < 1, `${b.yearRoofL}`);
  assert.equal(b.tankL, 0);
  assert.ok(b.yearShortL > 0 && b.tankForDriestRunL > 0);
  const big = P.waterBudget(site(), [...objects, { id: 't', type: 'tank', name: 't', x: 5, y: 0, rotation: 0, scale: 1, capacityL: 1e6, events: [] }], [], 1);
  assert.ok(big.yearShortL < b.yearShortL);
  assert.equal(P.waterBudget({ ...site(), climate: null }, objects, [], 1), null);
});

test('the design review rewards water, diversity and zones, and every weak spot names a next step', () => {
  const empty = P.reviewDesign({ site: site(), objects: [], features: [], zone: 8, meanSlope: 8, cutM3: 0, fillM3: 0, roofCatchL: null });
  assert.equal(empty.areas.length, 5);
  const water = empty.areas.find((a) => a.id === 'water');
  assert.ok(water.findings.some((f) => f.fix === 'swales'), 'a sloping site with no swales is told to dig one');
  const g = slope();
  const proposal = [
    { kind: 'structure', structure: 'building', label: 'House', why: '', x: 0, y: 0 },
    { kind: 'structure', structure: 'tank', label: 'Tank', why: '', x: 6, y: 0, size: 20000 },
    { kind: 'structure', structure: 'compost', label: 'Compost', why: '', x: 8, y: -6 },
    { kind: 'zone', label: 'Zone 1', why: '', zone: 1, points: [[-10, -10], [10, -10], [10, 10], [-10, 10]] },
    { kind: 'zone', label: 'Zone 2', why: '', zone: 2, points: [[-30, -30], [30, -30], [30, 30], [-30, 30]] },
    { kind: 'swale', label: 'Swale', why: '', x: 0, y: 25, size: 60 },
    { kind: 'guild', label: 'Apple', why: '', species: 'apple', x: -20, y: 20 },
    { kind: 'guild', label: 'Pear', why: '', species: 'pear', x: 20, y: 20 },
    { kind: 'path', label: 'Path', why: '', points: [[0, 0], [0, -40]] },
  ];
  const r = P.applyActions({ heights: g.heights, objects: [], features: [] }, g, proposal, proposal.map((_, i) => i), { zone: 7, day: '2026-10-26', id });
  const full = P.reviewDesign({ site: site(), objects: r.state.objects, features: r.state.features, zone: 7, meanSlope: 8, cutM3: 5, fillM3: 4, roofCatchL: 82560 });
  assert.ok(full.overall > empty.overall + 25, `${empty.overall} -> ${full.overall}`);
  for (const a of full.areas) for (const f of a.findings) assert.ok(!/[—–]/.test(f.text), 'no dashes in what people read');
});

test('applying a proposal: clamps onto the site, skips unknown plants, digs swales on contour, one state', () => {
  const g = slope();
  const actions = [
    { kind: 'plant', label: 'Fig', why: '', species: 'fig', x: 999, y: -999 },
    { kind: 'plant', label: 'Mystery', why: '', species: 'not-a-plant', x: 0, y: 0 },
    { kind: 'swale', label: 'Swale', why: '', x: 0, y: 0, size: 50 },
    { kind: 'pond', label: 'Pond', why: '', x: 10, y: -30, size: 4 },
    { kind: 'hedge', label: 'Windbreak', why: '', points: [[-45, 45], [45, 45]] },
    { kind: 'paddock', label: 'Hens', why: '', animal: 'chickens', points: [[20, 20], [40, 20], [40, 40]] },
    { kind: 'zone', label: 'Too small', why: '', points: [[0, 0], [1, 0]] },
  ];
  const r = P.applyActions({ heights: g.heights, objects: [], features: [] }, g, actions, actions.map((_, i) => i), { zone: 8, day: '2026-10-26', id });
  assert.deepEqual(r.applied, [0, 2, 3, 4, 5]);
  assert.equal(r.notes.length, 2);
  const fig = r.state.objects.find((o) => o.species === 'fig');
  assert.ok(fig.x <= 50 && fig.y >= -50, 'clamped inside the square');
  const sw = r.state.features.find((f) => f.kind === 'swale');
  const ys = sw.points.map((p) => p[1]);
  assert.ok(Math.max(...ys) - Math.min(...ys) < 0.5, 'the swale is level');
  assert.notEqual(r.state.heights, g.heights, 'the ground was dug');
  assert.ok(r.state.objects.filter((o) => o.type === 'plant').length > 15, 'the hedge planted');
  assert.equal(r.state.features.find((f) => f.kind === 'paddock').animal, 'chickens');
});

test('the AI terrain brief describes slope and aspect cell by cell', () => {
  const b = P.terrainBrief(slope(), null, 4);
  assert.equal(b.rows.length, 4);
  assert.match(b.rows[0], /10%\/N/);
});

test('the wind rose counts where wind comes from, by season', () => {
  const time = [], dir = [], sp = [];
  for (let i = 0; i < 365; i++) { const d = new Date(Date.UTC(2023, 0, 1 + i)); time.push(d.toISOString().slice(0, 10)); const m = d.getUTCMonth() + 1; dir.push([11, 12, 1, 2, 3].includes(m) ? 0 : 180); sp.push(20); }
  const w = windRose({ time, wind_direction_10m_dominant: dir, wind_speed_10m_max: sp }, 40);
  assert.equal(w.prevailingCold, 0);
  assert.equal(w.prevailingWarm, 180);
  assert.ok(Math.abs(w.all.reduce((a, b) => a + b, 0) - 1) < 1e-9);
});

test('AI text never carries em or en dashes, and the prompt carries the rules and the land', () => {
  assert.equal(scrubDashes('Swales first — then trees'), 'Swales first, then trees');
  assert.equal(scrubDashes('May–June'), 'May, June');
  const p = buildPrompt({ mode: 'design', question: 'food forest', context: { site: { sizeM: 80 } } });
  assert.match(p, /Only use plant ids/);
  assert.match(p, /sizeM/);
  assert.match(p, /food forest/);
});
