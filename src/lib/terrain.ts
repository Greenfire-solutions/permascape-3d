// Terrain analysis on the (n+1) x (n+1) height grid. Row 0 is north, column 0 is west.
// Pure functions only, so they run in the browser, in the worker and under node --test.

export interface Grid { heights: Float32Array; n: number; size: number }

export const cellSize = (g: Grid) => g.size / g.n;

export function toGrid(g: Grid, x: number, y: number) {
  return { c: ((x + g.size / 2) / g.size) * g.n, r: ((g.size / 2 - y) / g.size) * g.n };
}

export function toLocal(g: Grid, c: number, r: number): [number, number] {
  return [(c / g.n) * g.size - g.size / 2, g.size / 2 - (r / g.n) * g.size];
}

/** Bilinear height at local x, y. Returns NaN outside the site. */
export function heightAt(g: Grid, x: number, y: number): number {
  const { c, r } = toGrid(g, x, y);
  if (c < 0 || r < 0 || c > g.n || r > g.n) return NaN;
  const w = g.n + 1;
  const c0 = Math.min(g.n - 1, Math.floor(c)), r0 = Math.min(g.n - 1, Math.floor(r));
  const u = c - c0, v = r - r0;
  const h = g.heights;
  const a = h[r0 * w + c0], b = h[r0 * w + c0 + 1], d = h[(r0 + 1) * w + c0], e = h[(r0 + 1) * w + c0 + 1];
  return (a * (1 - u) + b * u) * (1 - v) + (d * (1 - u) + e * u) * v;
}

/** Gradient (rise per metre east, rise per metre north) at a vertex. */
export function gradientAt(g: Grid, r: number, c: number): [number, number] {
  const w = g.n + 1, h = g.heights, cs = cellSize(g);
  const cl = Math.max(0, c - 1), cr = Math.min(g.n, c + 1);
  const ru = Math.max(0, r - 1), rd = Math.min(g.n, r + 1);
  const gx = (h[r * w + cr] - h[r * w + cl]) / ((cr - cl) * cs);
  const gy = (h[ru * w + c] - h[rd * w + c]) / ((rd - ru) * cs);
  return [gx, gy];
}

/** Slope in percent and aspect as a compass bearing of the downhill direction (null when flat). */
export function slopeAspectAt(g: Grid, x: number, y: number) {
  const { c, r } = toGrid(g, x, y);
  const rr = Math.max(0, Math.min(g.n, Math.round(r))), cc = Math.max(0, Math.min(g.n, Math.round(c)));
  const [gx, gy] = gradientAt(g, rr, cc);
  const slope = 100 * Math.hypot(gx, gy);
  const aspect = slope < 1 ? null : (Math.atan2(-gx, -gy) * 180 / Math.PI + 360) % 360;
  return { slope, aspect };
}

export function slopeGrid(g: Grid) {
  const w = g.n + 1, out = new Float32Array(w * w), asp = new Float32Array(w * w);
  for (let r = 0; r < w; r++) for (let c = 0; c < w; c++) {
    const [gx, gy] = gradientAt(g, r, c);
    const s = 100 * Math.hypot(gx, gy);
    out[r * w + c] = s;
    asp[r * w + c] = s < 1 ? -1 : (Math.atan2(-gx, -gy) * 180 / Math.PI + 360) % 360;
  }
  return { slope: out, aspect: asp };
}

export const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export const compassName = (deg: number | null) => (deg == null ? 'flat' : COMPASS[Math.round(deg / 45) % 8]);

/** Marching squares: raw segments (grid coordinates [c, r]) for one level. */
export function contourSegments(g: Grid, level: number) {
  const w = g.n + 1, h = g.heights;
  const segs: number[] = []; // c1, r1, c2, r2, edgeA, edgeB
  const edgeId = (r: number, c: number, vertical: boolean) => (r * w + c) * 2 + (vertical ? 1 : 0);
  for (let r = 0; r < g.n; r++) for (let c = 0; c < g.n; c++) {
    const tl = h[r * w + c], tr = h[r * w + c + 1], br = h[(r + 1) * w + c + 1], bl = h[(r + 1) * w + c];
    const idx = (tl > level ? 8 : 0) | (tr > level ? 4 : 0) | (br > level ? 2 : 0) | (bl > level ? 1 : 0);
    if (idx === 0 || idx === 15) continue;
    const t = (a: number, b: number) => (a === b ? 0.5 : (level - a) / (b - a));
    // edge points and their ids: top, right, bottom, left
    const P = {
      T: [c + t(tl, tr), r, edgeId(r, c, false)],
      R: [c + 1, r + t(tr, br), edgeId(r, c + 1, true)],
      B: [c + t(bl, br), r + 1, edgeId(r + 1, c, false)],
      L: [c, r + t(tl, bl), edgeId(r, c, true)],
    } as Record<string, number[]>;
    const add = (a: string, b: string) => segs.push(P[a][0], P[a][1], P[b][0], P[b][1], P[a][2], P[b][2]);
    switch (idx) {
      case 1: case 14: add('L', 'B'); break;
      case 2: case 13: add('B', 'R'); break;
      case 3: case 12: add('L', 'R'); break;
      case 4: case 11: add('T', 'R'); break;
      case 6: case 9: add('T', 'B'); break;
      case 7: case 8: add('L', 'T'); break;
      case 5: add('L', 'T'); add('B', 'R'); break;
      case 10: add('T', 'R'); add('L', 'B'); break;
    }
  }
  return segs;
}

/** Chain marching-squares segments into polylines (grid coordinates). */
export function contourPolylines(g: Grid, level: number): [number, number][][] {
  const s = contourSegments(g, level);
  const count = s.length / 6;
  const byEdge = new Map<number, number[]>();
  for (let i = 0; i < count; i++) for (const e of [s[i * 6 + 4], s[i * 6 + 5]]) {
    const l = byEdge.get(e); if (l) l.push(i); else byEdge.set(e, [i]);
  }
  const used = new Uint8Array(count);
  const lines: [number, number][][] = [];
  const pt = (i: number, end: 0 | 1): [number, number] => [s[i * 6 + end * 2], s[i * 6 + end * 2 + 1]];
  const edge = (i: number, end: 0 | 1) => s[i * 6 + 4 + end];
  for (let i = 0; i < count; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const line: [number, number][] = [pt(i, 0), pt(i, 1)];
    // grow forward from end 1, then backward from end 0
    for (const dir of [1, 0] as const) {
      let e = edge(i, dir);
      for (;;) {
        const next = (byEdge.get(e) || []).find((j) => !used[j]);
        if (next == null) break;
        used[next] = 1;
        const enterEnd: 0 | 1 = edge(next, 0) === e ? 0 : 1;
        const exit: 0 | 1 = enterEnd === 0 ? 1 : 0;
        if (dir === 1) line.push(pt(next, exit)); else line.unshift(pt(next, exit));
        e = edge(next, exit);
      }
    }
    lines.push(line);
  }
  return lines;
}

/**
 * The stretch of contour through (x, y), `length` metres long and centred on the closest
 * point. This is how a swale is laid exactly on contour. Local coordinates.
 */
export function contourThrough(g: Grid, x: number, y: number, length: number): [number, number][] | null {
  const level = heightAt(g, x, y);
  if (!Number.isFinite(level)) return null;
  const lines = contourPolylines(g, level).map((l) => l.map(([c, r]) => toLocal(g, c, r)));
  let best: { line: [number, number][]; i: number; d: number } | null = null;
  for (const line of lines) line.forEach(([px, py], i) => {
    const d = Math.hypot(px - x, py - y);
    if (!best || d < best.d) best = { line, i, d };
  });
  if (!best || best.d > cellSize(g) * 3) return null;
  const { line, i } = best;
  const half = length / 2;
  const out: [number, number][] = [line[i]];
  let acc = 0;
  for (let k = i + 1; k < line.length && acc < half; k++) { acc += Math.hypot(line[k][0] - line[k - 1][0], line[k][1] - line[k - 1][1]); out.push(line[k]); }
  acc = 0;
  for (let k = i - 1; k >= 0 && acc < half; k--) { acc += Math.hypot(line[k][0] - line[k + 1][0], line[k][1] - line[k + 1][1]); out.unshift(line[k]); }
  return out.length > 1 ? out : null;
}

/**
 * Flow accumulation: priority-flood depression filling (so water can always leave the site),
 * then each cell drains to its steepest lower neighbour (D8). Returns upslope cell counts.
 */
export function flowAccumulation(g: Grid): Float32Array {
  const w = g.n + 1, N = w * w, h = g.heights;
  const filled = new Float32Array(h);
  const done = new Uint8Array(N);
  // binary heap of cell indices keyed by filled height
  const heap: number[] = [];
  const push = (i: number) => {
    heap.push(i); let k = heap.length - 1;
    while (k > 0) { const p = (k - 1) >> 1; if (filled[heap[p]] <= filled[heap[k]]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop()!;
    if (heap.length) {
      heap[0] = last; let k = 0;
      for (;;) {
        const a = 2 * k + 1, b = a + 1; let m = k;
        if (a < heap.length && filled[heap[a]] < filled[heap[m]]) m = a;
        if (b < heap.length && filled[heap[b]] < filled[heap[m]]) m = b;
        if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m;
      }
    }
    return top;
  };
  for (let r = 0; r < w; r++) for (let c = 0; c < w; c++) if (r === 0 || c === 0 || r === g.n || c === g.n) { done[r * w + c] = 1; push(r * w + c); }
  const EPS = 1e-4;
  while (heap.length) {
    const i = pop(), r = (i / w) | 0, c = i % w;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const rr = r + dr, cc = c + dc;
      if (rr < 0 || cc < 0 || rr >= w || cc >= w) continue;
      const j = rr * w + cc;
      if (done[j]) continue;
      done[j] = 1;
      if (filled[j] <= filled[i]) filled[j] = filled[i] + EPS;
      push(j);
    }
  }
  const order = Array.from({ length: N }, (_, i) => i).sort((a, b) => filled[b] - filled[a]);
  const acc = new Float32Array(N).fill(1);
  for (const i of order) {
    const r = (i / w) | 0, c = i % w;
    let best = -1, drop = 0;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const rr = r + dr, cc = c + dc;
      if (rr < 0 || cc < 0 || rr >= w || cc >= w) continue;
      const j = rr * w + cc;
      const d = (filled[i] - filled[j]) / (dr && dc ? Math.SQRT2 : 1);
      if (d > drop) { drop = d; best = j; }
    }
    if (best >= 0) acc[best] += acc[i];
  }
  return acc;
}

export const SLOPE_CLASSES = [
  { max: 2, label: 'Flat (0 to 2%)', color: '#22c55e', use: 'Ponds, buildings, annual beds' },
  { max: 8, label: 'Gentle (2 to 8%)', color: '#a3e635', use: 'Gardens, orchards, keyline' },
  { max: 15, label: 'Moderate (8 to 15%)', color: '#facc15', use: 'Swales, orchards, pasture' },
  { max: 30, label: 'Steep (15 to 30%)', color: '#f97316', use: 'Terraces, food forest, timber' },
  { max: Infinity, label: 'Very steep (30%+)', color: '#ef4444', use: 'Permanent forest, erosion control' },
];

export function terrainStats(g: Grid, original?: Float32Array | null) {
  const w = g.n + 1, N = w * w, { slope, aspect } = slopeGrid(g);
  const cellA = cellSize(g) ** 2;
  let min = Infinity, max = -Infinity, sum = 0, steepest = 0;
  const classes = SLOPE_CLASSES.map(() => 0);
  const aspects = new Array(8).fill(0); let flat = 0;
  for (let i = 0; i < N; i++) {
    const h = g.heights[i];
    if (h < min) min = h; if (h > max) max = h;
    sum += slope[i]; if (slope[i] > steepest) steepest = slope[i];
    classes[SLOPE_CLASSES.findIndex((k) => slope[i] < k.max)]++;
    if (aspect[i] < 0) flat++; else aspects[Math.round(aspect[i] / 45) % 8]++;
  }
  let cut = 0, fill = 0;
  if (original && original.length === N) {
    for (let i = 0; i < N; i++) {
      const d = g.heights[i] - original[i];
      if (d > 0.005) fill += d * cellA; else if (d < -0.005) cut -= d * cellA;
    }
  }
  // a single lidar cell on a road cut or a wall can read 300%: the steepest 1% of the ground is
  // what a designer means by "the steepest part"
  const sorted = Float32Array.from(slope).sort();
  const steep99 = sorted[Math.min(N - 1, Math.floor(N * 0.99))];
  return {
    min, max, relief: max - min, meanSlope: sum / N, steepest: steep99, steepestCell: steepest,
    classes: classes.map((k) => k / N), aspects: aspects.map((k) => k / N), flat: flat / N,
    cutM3: cut, fillM3: fill,
  };
}

/** Point in polygon (ray casting), local coordinates. */
export function pointInPolygon(x: number, y: number, poly: [number, number][]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export const polygonArea = (p: [number, number][]) =>
  Math.abs(p.reduce((s, [x, y], i) => { const [x2, y2] = p[(i + 1) % p.length]; return s + x * y2 - x2 * y; }, 0)) / 2;

export const polylineLength = (p: [number, number][]) =>
  p.reduce((s, pt, i) => (i ? s + Math.hypot(pt[0] - p[i - 1][0], pt[1] - p[i - 1][1]) : 0), 0);

export function distanceToPolyline(x: number, y: number, p: [number, number][]) {
  let best = Infinity;
  for (let i = 0; i < p.length - 1; i++) {
    const [ax, ay] = p[i], [bx, by] = p[i + 1];
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy));
  }
  return best;
}

export type EarthworkKind = 'berm' | 'swale';

/**
 * Carve a berm or a swale along a path. The swale's spoil berm is always put on the downhill
 * side, which is where it belongs (the original tool picked a side from the drawing direction).
 * Returns the new heights, or null when nothing changed.
 */
export function applyEarthwork(
  g: Grid, path: [number, number][], kind: EarthworkKind,
  o: { bermWidth: number; bermHeight: number; swaleWidth: number; swaleDepth: number; withBerm: boolean },
): { heights: Float32Array; downhillSide: number } | null {
  if (path.length < 2) return null;
  const w = g.n + 1;
  const src = g.heights, out = new Float32Array(src);
  const reach = (kind === 'berm' ? o.bermWidth : o.swaleWidth + (o.withBerm ? o.bermWidth : 0)) + cellSize(g);
  // which side of the path is downhill: compare heights a few metres either side of the middle
  const mid = Math.floor(path.length / 2);
  const [ax, ay] = path[Math.max(0, mid - 1)], [bx, by] = path[Math.min(path.length - 1, mid)];
  const len = Math.hypot(bx - ax, by - ay) || 1;
  const nx = -(by - ay) / len, ny = (bx - ax) / len; // left normal
  const off = Math.max(o.swaleWidth, 2);
  const hl = heightAt(g, (ax + bx) / 2 + nx * off, (ay + by) / 2 + ny * off);
  const hr = heightAt(g, (ax + bx) / 2 - nx * off, (ay + by) / 2 - ny * off);
  const downhillSide = (Number.isFinite(hl) && Number.isFinite(hr) && hl > hr) ? -1 : 1; // +1 = left of travel

  let minC = Infinity, maxC = -Infinity, minR = Infinity, maxR = -Infinity;
  for (const [x, y] of path) {
    const { c, r } = toGrid(g, x, y), pad = (reach / g.size) * g.n;
    minC = Math.min(minC, c - pad); maxC = Math.max(maxC, c + pad); minR = Math.min(minR, r - pad); maxR = Math.max(maxR, r + pad);
  }
  minC = Math.max(0, Math.floor(minC)); maxC = Math.min(g.n, Math.ceil(maxC));
  minR = Math.max(0, Math.floor(minR)); maxR = Math.min(g.n, Math.ceil(maxR));
  let changed = false;
  for (let r = minR; r <= maxR; r++) for (let c = minC; c <= maxC; c++) {
    const [gx, gy] = toLocal(g, c, r);
    let minDist = Infinity, side = 1;
    for (let i = 0; i < path.length - 1; i++) {
      const [px, py] = path[i], [qx, qy] = path[i + 1];
      const dx = qx - px, dy = qy - py, l2 = dx * dx + dy * dy;
      const t = l2 ? Math.max(0, Math.min(1, ((gx - px) * dx + (gy - py) * dy) / l2)) : 0;
      const d = Math.hypot(gx - px - t * dx, gy - py - t * dy);
      if (d < minDist) { minDist = d; side = Math.sign(dx * (gy - py) - dy * (gx - px)) || 1; }
    }
    const i = r * w + c;
    let h = out[i];
    if (kind === 'berm') {
      if (minDist < o.bermWidth) h += o.bermHeight * Math.cos((minDist / o.bermWidth) * Math.PI / 2) ** 2;
    } else if (minDist < o.swaleWidth) {
      h -= o.swaleDepth * Math.cos((minDist / o.swaleWidth) * Math.PI / 2) ** 2;
    } else if (o.withBerm && side === downhillSide) {
      const d = minDist - o.swaleWidth;
      if (d > 0 && d < o.bermWidth) h += o.bermHeight * Math.cos((Math.abs(d - o.bermWidth / 2) / (o.bermWidth / 2)) * Math.PI / 2) ** 2;
    }
    if (h !== out[i]) { out[i] = h; changed = true; }
  }
  return changed ? { heights: out, downhillSide } : null;
}

/** Bowl-shaped dig for a pond. Returns new heights and the water level that will hold. */
export function digPond(g: Grid, x: number, y: number, radius: number, depth: number) {
  const w = g.n + 1, out = new Float32Array(g.heights);
  // water fills to the lowest point of the rim, a touch below so it never spills
  let rim = Infinity;
  for (let a = 0; a < 32; a++) {
    const h = heightAt(g, x + Math.cos(a / 32 * Math.PI * 2) * radius, y + Math.sin(a / 32 * Math.PI * 2) * radius);
    if (Number.isFinite(h)) rim = Math.min(rim, h);
  }
  if (!Number.isFinite(rim)) rim = heightAt(g, x, y);
  const level = rim - Math.min(0.15, depth * 0.1);
  const { c: cc, r: rc } = toGrid(g, x, y), pad = (radius / g.size) * g.n + 1;
  for (let r = Math.max(0, Math.floor(rc - pad)); r <= Math.min(g.n, Math.ceil(rc + pad)); r++) {
    for (let c = Math.max(0, Math.floor(cc - pad)); c <= Math.min(g.n, Math.ceil(cc + pad)); c++) {
      const [gx, gy] = toLocal(g, c, r);
      const d = Math.hypot(gx - x, gy - y);
      if (d >= radius) continue;
      const floor = level - depth * Math.cos((d / radius) * Math.PI / 2) ** 0.8;
      const i = r * w + c;
      if (out[i] > floor) out[i] = Math.min(out[i], floor + (out[i] - floor) * (d / radius) ** 6);
    }
  }
  return { heights: out, level };
}
