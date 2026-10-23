// Plant library helpers. The data itself lives in library.ts.
import { LIBRARY, LIBRARY_BY_ID } from './library.ts';
import type { Species, Layer, Form, Category } from './library.ts';

export type { Species, Layer, Form, Category };
export const SPECIES: Species[] = LIBRARY;

export const SPECIES_BY_ID: Record<string, Species> = LIBRARY_BY_ID;

export const LAYER_NAMES: Record<Layer, string> = {
  canopy: 'Canopy', subcanopy: 'Sub-canopy (fruit trees)', shrub: 'Shrubs', herb: 'Herbaceous',
  groundcover: 'Ground cover', vine: 'Vines', root: 'Root layer',
};

/** Fraction of mature size at a given age: saplings start near 12% and approach full size. */
export function growthFraction(ageYears: number, yearsToMature: number) {
  if (ageYears < 0) return 0;
  return Math.min(1, 0.12 + 0.88 * (1 - Math.exp((-2.6 * ageYears) / Math.max(0.5, yearsToMature))));
}

/** Northern-equivalent month for a site (southern sites are six months out of phase). */
export const seasonalMonth = (month: number, lat: number | null) => (lat != null && lat < 0 ? ((month + 5) % 12) + 1 : month);

export type LeafState = 'leaf' | 'bloom' | 'fall' | 'bare';

export function leafState(sp: Species, nMonth: number): LeafState {
  if (sp.bloom?.includes(nMonth)) return 'bloom';
  if (!sp.deciduous) return 'leaf';
  if ([12, 1, 2].includes(nMonth) || (nMonth === 3 && sp.layer !== 'groundcover')) return 'bare';
  if ([10, 11].includes(nMonth)) return 'fall';
  return 'leaf';
}

export function zoneFit(sp: Species, zone: number | null | undefined) {
  if (zone == null) return { ok: true, text: '' };
  if (zone < sp.zoneMin) return { ok: false, text: `Too cold: needs zone ${sp.zoneMin} or warmer, site is ${zone}` };
  if (zone > sp.zoneMax) return { ok: false, text: `Too warm: needs zone ${sp.zoneMax} or cooler, site is ${zone}` };
  return { ok: true, text: `Fits zone ${zone} (${sp.zoneMin} to ${sp.zoneMax})` };
}
