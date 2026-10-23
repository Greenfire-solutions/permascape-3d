// Pure-function tests: terrain analysis, earthworks, sun, plants, TIFF and climate parsing.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../src/lib/terrain.ts';
import { sunPosition, siteInstant } from '../src/lib/sun.ts';
import { sunHours } from '../src/lib/sunHours.ts';
import { growthFraction, zoneFit, SPECIES_BY_ID, leafState, seasonalMonth } from '../src/lib/plants.ts';
import { readFloatTiff, hardinessZone, summariseClimate, siteGrid, decodeTerrarium, lonLatToPixel } from '../server/geo.mjs';
import { parseCoordinates } from '../server/sources.mjs';

// a plane rising 10% to the east: h = 0.1 * (x + size/2)
function ramp(n = 64, size = 100, slope = 0.1) {
  const w = n + 1, h = new Float32Array(w * w);
  for (let r = 0; r < w; r++) for (let c = 0; c < w; c++) h[r * w + c] = slope * (c / n) * size;
  return { heights: h, n, size };
}

test('heightAt and slope on a known ramp', () => {
  const g = ramp();
  assert.ok(Math.abs(T.heightAt(g, 0, 0) - 5) < 1e-4);
  assert.ok(Number.isNaN(T.heightAt(g, 60, 0)));
  const { slope, aspect } = T.slopeAspectAt(g, 0, 0);
  assert.ok(Math.abs(slope - 10) < 0.01, `slope ${slope}`);
  assert.ok(Math.abs(aspect - 270) < 0.5, `rising east means it faces west, got ${aspect}`);
});

test('north/south orientation: row 0 is north', () => {
  const n = 32, size = 100, w = n + 1, h = new Float32Array(w * w);
  for (let r = 0; r < w; r++) for (let c = 0; c < w; c++) h[r * w + c] = (n - r); // high in the north
  const g = { heights: h, n, size };
  assert.ok(T.heightAt(g, 0, 40) > T.heightAt(g, 0, -40));
  assert.equal(T.compassName(T.slopeAspectAt(g, 0, 0).aspect), 'S'); // falls to the south, so it faces south
});

test('contour through a point runs level and the requested length', () => {
  const g = ramp();
  const path = T.contourThrough(g, 0, 0, 40);
  assert.ok(path && path.length > 5);
  for (const [x, y] of path) assert.ok(Math.abs(T.heightAt(g, x, y) - 5) < 0.01, 'every point sits on the 5 m contour');
  const len = T.polylineLength(path);
  assert.ok(len > 36 && len < 46, `length ${len}`);
  // on a slope rising east, a contour runs north to south
  const xs = path.map((p) => p[0]);
  assert.ok(Math.max(...xs) - Math.min(...xs) < 0.5);
});

test('flat ground has no contour to follow', () => {
  const n = 16, g = { heights: new Float32Array((n + 1) ** 2), n, size: 50 };
  assert.equal(T.contourThrough(g, 0, 0, 20), null);
});

test('swale digs a trench and puts the berm downhill', () => {
  const g = ramp(128, 100);
  const path = T.contourThrough(g, 0, 0, 60);
  const r = T.applyEarthwork(g, path, 'swale', { bermWidth: 2, bermHeight: 0.6, swaleWidth: 1.5, swaleDepth: 0.5, withBerm: true });
  assert.ok(r);
  const after = { ...g, heights: r.heights };
  assert.ok(T.heightAt(after, 0, 0) < T.heightAt(g, 0, 0) - 0.3, 'trench at the centre line');
  // downhill is west (x negative); berm must rise there, uphill side untouched
  const downhill = T.heightAt(after, -2.5, 0) - T.heightAt(g, -2.5, 0);
  const uphill = T.heightAt(after, 2.5, 0) - T.heightAt(g, 2.5, 0);
  assert.ok(downhill > 0.3, `downhill berm ${downhill}`);
  assert.ok(Math.abs(uphill) < 1e-3, `uphill untouched ${uphill}`);
  const st = T.terrainStats(after, g.heights);
  assert.ok(st.cutM3 > 10 && st.fillM3 > 10);
});

test('pond bowl holds water below its rim', () => {
  const g = ramp(128, 100, 0.03);
  const { heights, level } = T.digPond(g, 0, 0, 6, 1.5);
  const after = { ...g, heights };
  assert.ok(T.heightAt(after, 0, 0) < level - 1);
  for (let a = 0; a < 16; a++) {
    const x = Math.cos(a / 16 * Math.PI * 2) * 6.5, y = Math.sin(a / 16 * Math.PI * 2) * 6.5;
    assert.ok(T.heightAt(after, x, y) >= level - 0.05, 'the rim is not below the water');
  }
});

test('flow accumulation gathers in a valley', () => {
  const n = 40, size = 100, w = n + 1, h = new Float32Array(w * w);
  for (let r = 0; r < w; r++) for (let c = 0; c < w; c++) h[r * w + c] = Math.abs(c - n / 2) * 0.5 + (n - r) * 0.1; // V valley draining south
  const acc = T.flowAccumulation({ heights: h, n, size });
  const valley = acc[(n - 1) * w + n / 2], side = acc[(n - 1) * w + 3];
  assert.ok(valley > 200, `valley ${valley}`);
  assert.ok(side < 20, `side ${side}`);
});

test('polygon area and point in polygon', () => {
  const sq = [[0, 0], [10, 0], [10, 10], [0, 10]];
  assert.equal(T.polygonArea(sq), 100);
  assert.ok(T.pointInPolygon(5, 5, sq));
  assert.ok(!T.pointInPolygon(15, 5, sq));
});

test('sun position matches known values', () => {
  // Boulder, CO at solar noon on the June solstice: altitude about 73.4, due south
  const noon = sunPosition(new Date(Date.UTC(2026, 5, 21, 19, 1)), 40.015, -105.27);
  assert.ok(Math.abs(noon.altitude - 73.4) < 0.6, `alt ${noon.altitude}`);
  assert.ok(Math.abs(noon.azimuth - 180) < 4, `az ${noon.azimuth}`);
  const morning = sunPosition(new Date(Date.UTC(2026, 2, 20, 14, 0)), 40.015, -105.27);
  assert.ok(morning.azimuth > 90 && morning.azimuth < 140, 'morning sun in the south-east');
  assert.ok(sunPosition(siteInstant('2026-12-21', 0, -105), 40, -105).altitude < -50, 'midnight is dark');
});

test('sun hours: a hill shades its north side in winter', () => {
  const n = 64, size = 200, w = n + 1, heights = new Float32Array(w * w);
  for (let r = 0; r < w; r++) for (let c = 0; c < w; c++) heights[r * w + c] = Math.max(0, 30 - Math.hypot(c - n / 2, r - n / 2) * 3);
  const { hours, max } = sunHours({ heights, obstacles: new Float32Array(w * w), n, size, lat: 45, lon: 0, day: '2026-12-21' });
  const north = hours[(n / 2 - 13) * w + n / 2], south = hours[(n / 2 + 13) * w + n / 2];
  assert.ok(max > 6 && max < 10, `winter day length ${max}`);
  assert.ok(south > north + 2, `south ${south} north ${north}`);
});

test('plants: growth, zones and seasons', () => {
  assert.ok(growthFraction(0, 6) < 0.15);
  assert.ok(growthFraction(6, 6) > 0.9);
  assert.equal(growthFraction(-1, 6), 0);
  assert.ok(!zoneFit(SPECIES_BY_ID.citrus, 5).ok);
  assert.ok(zoneFit(SPECIES_BY_ID.apple, 5).ok);
  assert.equal(leafState(SPECIES_BY_ID.apple, 1), 'bare');
  assert.equal(leafState(SPECIES_BY_ID.apple, 4), 'bloom');
  assert.equal(leafState(SPECIES_BY_ID.pine, 1), 'leaf');
  assert.equal(seasonalMonth(7, -33), 1, 'July in Sydney is like January up north');
});

test('TIFF reader handles strips, tiles and empty tiles', () => {
  // build a tiny little-endian strip TIFF, 2x2 float
  const mk = (tiled, empty) => {
    const tags = tiled ? [[256, 3, 1, 2], [257, 3, 1, 2], [258, 3, 1, 32], [259, 3, 1, 1], [322, 3, 1, 2], [323, 3, 1, 2], [324, 4, 1, empty ? 0 : 200], [325, 4, 1, empty ? 0 : 16], [339, 3, 1, 3], [33550, 12, 3, 300]]
      : [[256, 3, 1, 2], [257, 3, 1, 2], [258, 3, 1, 32], [259, 3, 1, 1], [273, 4, 1, 200], [279, 4, 1, 16], [339, 3, 1, 3], [34737, 2, 238, 300]];
    const buf = Buffer.alloc(240);
    buf.write('II', 0); buf.writeUInt16LE(42, 2); buf.writeUInt32LE(8, 4); buf.writeUInt16LE(tags.length, 8);
    tags.forEach(([t, ty, n, v], i) => { const e = 10 + i * 12; buf.writeUInt16LE(t, e); buf.writeUInt16LE(ty, e + 2); buf.writeUInt32LE(n, e + 4); if (ty === 3) buf.writeUInt16LE(v, e + 8); else buf.writeUInt32LE(v, e + 8); });
    [1.5, 2.5, 3.5, 4.5].forEach((v, i) => buf.writeFloatLE(v, 200 + i * 4));
    return new Uint8Array(buf);
  };
  assert.deepEqual([...readFloatTiff(mk(false)).data], [1.5, 2.5, 3.5, 4.5]);
  assert.deepEqual([...readFloatTiff(mk(true)).data], [1.5, 2.5, 3.5, 4.5]);
  assert.ok(readFloatTiff(mk(true, true)).data.every(Number.isNaN), 'an empty tile is no-data');
});

test('geo helpers', () => {
  assert.equal(decodeTerrarium(128, 0, 0), 0);
  const p = lonLatToPixel(0, 0, 1);
  assert.equal(p.x, 256); assert.ok(Math.abs(p.y - 256) < 1e-6);
  const g = siteGrid(40, -105, 200, 4);
  const [la, lo] = g.pointLatLon(0, 0);
  assert.ok(la > 40 && lo < -105, 'row 0, col 0 is the north-west corner');
  assert.equal(hardinessZone(-27).label, '5a');
  assert.equal(hardinessZone(-16).label, '7a');
  assert.deepEqual(parseCoordinates('40.0150, -105.2705'), [40.015, -105.2705]);
  assert.deepEqual(parseCoordinates('https://www.google.com/maps/@37.77,-122.41,15z'), [37.77, -122.41]);
  assert.equal(parseCoordinates('12 Main Street'), null);
});

test('climate summary finds frost dates in both hemispheres', () => {
  const mk = (south) => {
    const time = [], tmin = [], tmax = [], p = [];
    for (let y = 2020; y <= 2021; y++) for (let d = 0; d < 365; d++) {
      const date = new Date(Date.UTC(y, 0, 1 + d));
      time.push(date.toISOString().slice(0, 10));
      // coldest mid-January in the north, mid-July in the south
      const phase = Math.cos(((d - (south ? 196 : 15)) / 365) * 2 * Math.PI);
      tmin.push(8 - 14 * phase); tmax.push(18 - 14 * phase); p.push(1);
    }
    return { time, temperature_2m_min: tmin, temperature_2m_max: tmax, precipitation_sum: p };
  };
  const n = summariseClimate(mk(false), 45);
  assert.equal(n.annualPrecipMm, 365);
  assert.match(n.lastSpringFrost, /Mar|Apr/);
  assert.match(n.firstFallFrost, /Oct|Nov/);
  const s = summariseClimate(mk(true), -40);
  assert.match(s.lastSpringFrost, /Sep|Oct/);
  assert.match(s.firstFallFrost, /Apr|May/);
  assert.ok(s.growingSeasonDays > 150 && s.growingSeasonDays < 260, `south season ${s.growingSeasonDays}`);
});
