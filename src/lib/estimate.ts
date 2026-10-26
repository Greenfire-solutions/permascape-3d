// What the design costs to install, line by line and year by year, from unit prices the
// designer can set for their area. Only proposed work is priced: what is already on the land
// is not. Pure functions, run by the Budget page, the report, the AI context and the tests.
import type { Feature, SiteObject } from './types.ts';
import { LIBRARY_BY_ID } from './library.ts';
import { polylineLength, polygonArea } from './terrain.ts';

/**
 * Ballpark US installed prices, contractor rates for earthworks and materials for the rest.
 * They are starting points: every one is editable on the Budget page and saved with the project.
 */
export const PRICE_ITEMS: { id: string; label: string; unit: 'm' | 'm2' | 'm3' | 'L' | 'each'; value: number; note: string }[] = [
  { id: 'fence', label: 'Fencing (woven wire, posts, gates)', unit: 'm', value: 13, note: 'about $4 a foot installed' },
  { id: 'path', label: 'Paths (gravel or woodchip)', unit: 'm2', value: 25, note: 'about $2.30 a sq ft' },
  { id: 'earthwork', label: 'Excavator earthworks', unit: 'm3', value: 16, note: 'about $12 a cubic yard moved' },
  { id: 'mobilize', label: 'Bringing in a machine', unit: 'each', value: 600, note: 'once per year with earthworks' },
  { id: 'spillway', label: 'Pond spillway and liner work', unit: 'each', value: 1500, note: 'per pond' },
  { id: 'tank', label: 'Water tanks', unit: 'L', value: 0.3, note: 'about $1.15 a gallon with pad and plumbing' },
  { id: 'greenhouse', label: 'Greenhouse or hoop house', unit: 'm2', value: 110, note: 'about $10 a sq ft' },
  { id: 'shed', label: 'Shed, barn or animal shelter', unit: 'm2', value: 320, note: 'about $30 a sq ft' },
  { id: 'house', label: 'New house', unit: 'm2', value: 2200, note: 'about $200 a sq ft' },
  { id: 'coop', label: 'Chicken coop and run', unit: 'each', value: 1500, note: '' },
  { id: 'compost', label: 'Compost bays', unit: 'each', value: 400, note: 'three-bay pallet or timber' },
  { id: 'hive', label: 'Beehive with bees', unit: 'each', value: 550, note: 'hive, package bees, basic kit' },
  { id: 'bed', label: 'Garden beds (soil, edging, mulch)', unit: 'm2', value: 30, note: 'about $2.80 a sq ft' },
  { id: 'irrigation', label: 'Irrigation emitters and line', unit: 'each', value: 40, note: 'per emitter point' },
  { id: 'plantFactor', label: 'Plant prices (multiplier on list prices)', unit: 'each', value: 1, note: '1 = list price, 0.6 = wholesale' },
  { id: 'labour', label: 'Contractor labour on top (percent)', unit: 'each', value: 0, note: '0 if the owners build it' },
  { id: 'contingency', label: 'Contingency (percent)', unit: 'each', value: 10, note: 'for the unexpected' },
];
export const DEFAULT_PRICES: Record<string, number> = Object.fromEntries(PRICE_ITEMS.map((p) => [p.id, p.value]));

export interface CostLine { group: string; item: string; qty: number; unit: string; each: number; total: number; phase: number; ids: string[] }

const isProposed = (x: { status?: string }) => x.status !== 'existing';
const phaseOf = (x: { phase?: number }) => Math.max(1, Math.min(3, Math.round(x.phase ?? 1)));

/** Small buildings are sheds and shelters; a big one is a house. */
export const isHouse = (o: SiteObject) => o.type === 'building' && (o.width ?? 8) * (o.depth ?? 10) * o.scale * o.scale >= 60 && !/shed|barn|shelter|stable|coop|garage|workshop|studio|stand|chapel|church|school|store|shop|office|hall|warehouse/i.test(o.name);

export function estimate(objects: SiteObject[], features: Feature[], prices: Record<string, number> = {}, cutM3 = 0, fillM3 = 0) {
  const P = { ...DEFAULT_PRICES, ...prices };
  const lines: CostLine[] = [];
  const add = (group: string, item: string, qty: number, unit: string, each: number, phase: number, ids: string[]) => {
    if (qty <= 0) return;
    const key = lines.find((l) => l.group === group && l.item === item && l.phase === phase && l.unit === unit && l.each === each);
    if (key) { key.qty += qty; key.total += qty * each; key.ids.push(...ids); }
    else lines.push({ group, item, qty, unit, each, total: qty * each, phase, ids });
  };

  // plants: grouped by species and year
  for (const o of objects.filter((o) => o.type === 'plant' && isProposed(o))) {
    const sp = LIBRARY_BY_ID[o.species || ''];
    if (!sp) continue;
    add('Plants', sp.name, 1, 'each', (o.cost ?? sp.costUSD) * P.plantFactor, phaseOf(o), [o.id]);
  }
  // structures and water
  for (const o of objects.filter(isProposed)) {
    const ph = phaseOf(o), area = (o.width ?? 0) * (o.depth ?? 0) * o.scale * o.scale;
    if (o.cost != null && o.type !== 'plant') { add('Structures', o.name, 1, 'each', o.cost, ph, [o.id]); continue; }
    switch (o.type) {
      case 'building': isHouse(o) ? add('Structures', 'New house', area, 'm2', P.house, ph, [o.id]) : add('Structures', 'Sheds and shelters', area, 'm2', P.shed, ph, [o.id]); break;
      case 'greenhouse': add('Structures', 'Greenhouse', area, 'm2', P.greenhouse, ph, [o.id]); break;
      case 'coop': add('Animals', 'Chicken coop and run', 1, 'each', P.coop, ph, [o.id]); break;
      case 'hive': add('Animals', 'Beehive with bees', 1, 'each', P.hive, ph, [o.id]); break;
      case 'compost': add('Soil', 'Compost bays', 1, 'each', P.compost, ph, [o.id]); break;
      case 'garden': add('Soil', 'Garden beds', area || 4.8, 'm2', P.bed, ph, [o.id]); break;
      case 'tank': add('Water', 'Water tanks', o.capacityL ?? 10000, 'L', P.tank, ph, [o.id]); break;
      case 'irrigation': add('Water', 'Irrigation points', 1, 'each', P.irrigation, ph, [o.id]); break;
      case 'pond': {
        const r = o.radius ?? 5, depth = o.depth ?? 1.5;
        add('Earthworks', 'Pond digging', Math.PI * r * r * depth * 0.5, 'm3', P.earthwork, ph, [o.id]);
        add('Earthworks', 'Pond spillway and finishing', 1, 'each', P.spillway, ph, [o.id]);
        break;
      }
    }
  }
  // lines and areas
  for (const f of features.filter(isProposed)) {
    const ph = phaseOf(f), len = polylineLength(f.points);
    if (f.kind === 'fence') add('Fencing', 'Fencing', len, 'm', P.fence, ph, [f.id]);
    else if (f.kind === 'paddock') add('Fencing', 'Paddock fencing', len + Math.hypot(f.points[0][0] - f.points[f.points.length - 1][0], f.points[0][1] - f.points[f.points.length - 1][1]), 'm', P.fence, ph, [f.id]);
    else if (f.kind === 'path') add('Access', 'Paths', len * (f.width ?? 1.5), 'm2', P.path, ph, [f.id]);
    else if (f.kind === 'swale' || f.kind === 'berm') add('Earthworks', f.kind === 'swale' ? 'Swales' : 'Berms', len * (f.width ?? 1.2) * (f.depth ?? f.height ?? 0.5), 'm3', P.earthwork, ph, [f.id]);
  }
  // a machine comes once for each year with digging in it
  for (const ph of [...new Set(lines.filter((l) => l.group === 'Earthworks').map((l) => l.phase))]) add('Earthworks', 'Bringing in a machine', 1, 'each', P.mobilize, ph, []);
  // terrain shaped by hand with the brush, on top of the features above
  const brushed = Math.max(0, cutM3 + fillM3 - lines.filter((l) => l.group === 'Earthworks' && l.unit === 'm3').reduce((s, l) => s + l.qty, 0) * 1.6);
  if (brushed > 5) add('Earthworks', 'Other shaping (cut and fill)', brushed, 'm3', P.earthwork, 1, []);

  const phases = [1, 2, 3].map((ph) => {
    const sub = lines.filter((l) => l.phase === ph).reduce((s, l) => s + l.total, 0);
    const labour = sub * (P.labour / 100), cont = (sub + labour) * (P.contingency / 100);
    return { phase: ph, subtotal: sub, labour, contingency: cont, total: sub + labour + cont };
  });
  const groups: Record<string, number> = {};
  for (const l of lines) groups[l.group] = (groups[l.group] || 0) + l.total;
  return { lines: lines.sort((a, b) => a.phase - b.phase || a.group.localeCompare(b.group) || b.total - a.total), phases, groups, total: phases.reduce((s, p) => s + p.total, 0), prices: P };
}

/** Paddock perimeter in metres, closing the ring. */
export const ringLength = (pts: [number, number][]) => polylineLength([...pts, pts[0]]);
export const areaOf = polygonArea;
