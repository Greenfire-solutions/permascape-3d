import type { Project } from './types';
import { DEFAULT_SETTINGS } from './types';
import { fetchTerrain, fetchClimate, fetchSoil, slugId, f32ToB64 } from './api';

export type StepState = 'wait' | 'run' | 'ok' | 'warn' | 'fail';
export interface Step { key: string; label: string; state: StepState; detail?: string }

export const SITE_STEPS: Step[] = [
  { key: 'terrain', label: 'Real elevation and slope', state: 'wait' },
  { key: 'imagery', label: 'Satellite photo', state: 'wait' },
  { key: 'climate', label: 'Rainfall, frost dates, hardiness zone', state: 'wait' },
  { key: 'soil', label: 'Soil survey', state: 'wait' },
];

/**
 * Build a new project for a real place. Terrain is required; climate and soil are extras
 * that may be unavailable (soil is US only), so their failures are reported, not fatal.
 */
export async function buildSiteProject(
  opts: { name: string; address: string; lat: number; lon: number; size: number; n: number },
  onStep: (key: string, state: StepState, detail?: string) => void,
): Promise<Project> {
  onStep('terrain', 'run');
  const t = await fetchTerrain(opts.lat, opts.lon, opts.size, opts.n).catch((e) => { onStep('terrain', 'fail', e.message); throw e; });
  onStep('terrain', t.note ? 'warn' : 'ok', `${t.source}, ${t.sourceResM} m data. ${t.note}`.trim());

  onStep('climate', 'run');
  onStep('soil', 'run');
  const [climate, soil] = await Promise.all([
    fetchClimate(opts.lat, opts.lon).then((c) => { onStep('climate', 'ok', `${c.annualPrecipMm} mm a year, zone ${c.zone?.label ?? '?'}`); return c; })
      .catch((e) => { onStep('climate', 'warn', `Not available: ${e.message}`); return null; }),
    fetchSoil(opts.lat, opts.lon).then((s) => { onStep('soil', s.available ? 'ok' : 'warn', s.available ? s.mapUnit : s.note); return s; })
      .catch((e) => { onStep('soil', 'warn', `Not available: ${e.message}`); return null; }),
  ]);

  const now = new Date().toISOString();
  return {
    id: slugId(opts.name),
    name: opts.name,
    version: 1,
    created: now,
    site: {
      address: opts.address, lat: opts.lat, lon: opts.lon, size: opts.size, n: opts.n,
      base: t.base, source: t.source, sourceResM: t.sourceResM, note: t.note, climate, soil,
    },
    originalHeights: t.heights,
    heights: t.heights,
    objects: [],
    features: [],
    settings: { ...DEFAULT_SETTINGS, contourInterval: t.relief > 60 ? 5 : t.relief > 15 ? 2 : t.relief > 4 ? 1 : 0.5 },
  };
}

export function blankProject(name = 'Sandbox'): Project {
  const n = 128;
  const h = f32ToB64(new Float32Array((n + 1) * (n + 1)));
  return {
    id: slugId(name), name, version: 1, created: new Date().toISOString(),
    site: { address: '', lat: null, lon: null, size: 100, n, base: 0, source: 'Flat sandbox', sourceResM: null, climate: null, soil: null },
    originalHeights: h, heights: h, objects: [], features: [],
    settings: { ...DEFAULT_SETTINGS, satellite: false, grid: true, contours: false },
  };
}
