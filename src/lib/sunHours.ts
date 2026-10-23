// Hours of direct sun per grid vertex for one day, counting shade from the terrain itself and
// from trees and buildings (passed in as an obstacle height grid). Runs in a worker.
import { sunPosition, siteInstant } from './sun.ts';

export interface SunJob { heights: Float32Array; obstacles: Float32Array; n: number; size: number; lat: number; lon: number; day: string }

export function sunHours(job: SunJob): { hours: Float32Array; max: number } {
  const { n, size } = job;
  // work on at most a 129 x 129 grid, then expand back
  const step = n > 128 ? n / 128 : 1;
  const m = n / step, w = m + 1, W = n + 1;
  const surf = new Float32Array(w * w), ground = new Float32Array(w * w);
  let maxH = -Infinity;
  for (let r = 0; r < w; r++) for (let c = 0; c < w; c++) {
    const i = r * step * W + c * step;
    ground[r * w + c] = job.heights[i];
    surf[r * w + c] = job.heights[i] + job.obstacles[i];
    maxH = Math.max(maxH, surf[r * w + c]);
  }
  const cell = size / m;
  const hours = new Float32Array(w * w);
  let total = 0;
  for (let t = 4; t <= 20.01; t += 0.5) {
    const { azimuth, altitude } = sunPosition(siteInstant(job.day, t, job.lon), job.lat, job.lon);
    if (altitude < 2) continue;
    total += 0.5;
    const tanA = Math.tan((altitude * Math.PI) / 180);
    const dc = Math.sin((azimuth * Math.PI) / 180), dr = -Math.cos((azimuth * Math.PI) / 180);
    const rise = tanA * cell;
    for (let r = 0; r < w; r++) for (let c = 0; c < w; c++) {
      let z = ground[r * w + c] + 0.4;
      let lit = true;
      for (let k = 1; ; k++) {
        z += rise;
        if (z > maxH) break;
        const rr = Math.round(r + dr * k), cc = Math.round(c + dc * k);
        if (rr < 0 || cc < 0 || rr >= w || cc >= w) break;
        if (surf[rr * w + cc] > z) { lit = false; break; }
      }
      if (lit) hours[r * w + c] += 0.5;
    }
  }
  if (step === 1) return { hours, max: total };
  const out = new Float32Array(W * W);
  for (let r = 0; r < W; r++) for (let c = 0; c < W; c++) out[r * W + c] = hours[Math.min(m, Math.round(r / step)) * w + Math.min(m, Math.round(c / step))];
  return { hours: out, max: total };
}
