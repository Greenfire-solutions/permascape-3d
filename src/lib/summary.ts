import type { Feature, SiteObject, Site, JournalEvent } from './types';
import { SPECIES_BY_ID, LAYER_NAMES, Layer, seasonalMonth, zoneFit } from './plants';
import { polygonArea, polylineLength } from './terrain';
import { plantAge, ModelContext } from './models';
import { advise, jobsBetween, SiteClimate } from './advisor';
import { effectiveZone } from './permaculture';

export function designSummary(site: Site, objects: SiteObject[], features: Feature[]) {
  const precip = site.climate?.annualPrecipMm ?? null;
  const area = site.size * site.size;
  const plants = objects.filter((o) => o.type === 'plant');
  const byLayer: Partial<Record<Layer, number>> = {};
  let plantCost = 0, zoneMisfits = 0;
  for (const p of plants) {
    const sp = SPECIES_BY_ID[p.species || ''];
    if (!sp) continue;
    byLayer[sp.layer] = (byLayer[sp.layer] || 0) + 1;
    plantCost += p.cost ?? sp.costUSD;
    if (!zoneFit(sp, effectiveZone(site)).ok) zoneMisfits++;
  }
  const otherCost = objects.filter((o) => o.type !== 'plant').reduce((s, o) => s + (o.cost || 0), 0);
  const roofM2 = objects.filter((o) => ['building', 'greenhouse', 'coop'].includes(o.type))
    .reduce((s, o) => s + (o.type === 'coop' ? 2.4 * 1.8 : (o.width ?? 6) * (o.depth ?? 8)) * o.scale * o.scale, 0);
  const tankL = objects.filter((o) => o.type === 'tank').reduce((s, o) => s + (o.capacityL ?? 10000), 0);
  // a bowl holds about half its cylinder
  const pondL = objects.filter((o) => o.type === 'pond').reduce((s, o) => s + Math.PI * (o.radius ?? 5) ** 2 * (o.depth ?? 1.5) * 0.5 * 1000, 0);
  const swales = features.filter((f) => f.kind === 'swale');
  const swaleLen = swales.reduce((s, f) => s + polylineLength(f.points), 0);
  // the cos^2 cross-section of width 2w and depth d has area d * w
  const swaleL = swales.reduce((s, f) => s + polylineLength(f.points) * (f.width ?? 2) * (f.depth ?? 1) * 1000, 0);
  const berms = features.filter((f) => f.kind === 'berm');
  const zones = features.filter((f) => f.kind === 'zone');
  const zoneAreas: Record<number, number> = {};
  for (const z of zones) zoneAreas[z.zone ?? 1] = (zoneAreas[z.zone ?? 1] || 0) + polygonArea(z.points);
  const pathLen = features.filter((f) => f.kind === 'path').reduce((s, f) => s + polylineLength(f.points), 0);
  return {
    area,
    rainOnSiteL: precip != null ? area * precip : null,
    roofM2,
    roofCatchL: precip != null ? roofM2 * precip * 0.8 : null,
    tankL, pondL, swaleL, swaleLen,
    swaleCount: swales.length, bermCount: berms.length,
    bermLen: berms.reduce((s, f) => s + polylineLength(f.points), 0),
    plants: plants.length, byLayer, plantCost, otherCost, zoneMisfits,
    structures: objects.filter((o) => ['building', 'greenhouse', 'coop', 'compost', 'hive'].includes(o.type)).length,
    zones: zones.length, zoneAreas, pathLen,
    storageL: tankL + pondL + swaleL,
  };
}

export const layerLabel = (l: Layer) => LAYER_NAMES[l];

export interface Task {
  id: string;
  objectId: string; // the first one, for selecting
  objectIds: string[]; // every element the job covers (a hedgerow of 28 cedars is one job)
  taskIds: string[]; // each element's own task id, written into its journal when done
  label: string; type: JournalEvent['type']; why: string; done: boolean; count: number;
}

/**
 * Jobs that fall in the month shown on the timeline, from each plant's own calendar.
 * The same job on many plants of one kind is one line: "Mulch Eastern red cedar (28)".
 */
export function monthTasks(objects: SiteObject[], ctx: ModelContext, sc?: SiteClimate | null): Task[] {
  const y = ctx.viewDate.getFullYear(), m = ctx.viewDate.getMonth() + 1;
  const ym = `${y}-${String(m).padStart(2, '0')}`;
  const nm = seasonalMonth(m, ctx.lat);
  const groups = new Map<string, { objs: SiteObject[]; type: JournalEvent['type']; verb: string; what: string; why: string }>();
  const add = (o: SiteObject, type: JournalEvent['type'], verb: string, what: string, why: string, key = what) => {
    const k = `${type}|${verb}|${key}`;
    const g = groups.get(k);
    if (g) g.objs.push(o); else groups.set(k, { objs: [o], type, verb, what, why });
  };
  const extra: Task[] = [];
  for (const o of objects) {
    if (o.status === 'existing' && o.type !== 'plant') continue;
    if (o.type === 'plant') {
      const sp = SPECIES_BY_ID[o.species || ''];
      if (!sp) continue;
      const age = plantAge(o, ctx);
      if (age < 0) {
        if (age > -1 / 12 - 0.001) add(o, 'planted', 'Plant', sp.name, 'Planned for this month');
        continue;
      }
      // formative pruning starts the first dormant season after planting
      if (sp.prune.includes(nm) && age >= 0.1) add(o, 'pruned', 'Prune', sp.name, age < 3 ? `Shape young ${sp.name.toLowerCase()} while it is dormant` : `${sp.name} is pruned this month`);
      if (sp.harvest.includes(nm) && age >= Math.min(2, sp.yearsToMature * 0.45)) add(o, 'harvested', 'Harvest', sp.name, `${sp.name} harvest window`);
      // watering and mulching are one round of the young trees and shrubs, not a job per kind
      const woody = ['canopy', 'subcanopy', 'shrub', 'vine'].includes(sp.layer);
      if (age < 2 && nm >= 5 && nm <= 9 && (woody || sp.life !== 'annual')) add(o, 'watered', 'Water deeply each week:', sp.name, 'Young plants need steady water for two summers', 'round');
      if (age < 3 && (nm === 4 || nm === 10) && woody) add(o, 'mulched', 'Mulch', sp.name, 'Refresh mulch out to the drip line', 'round');
      if (age < 3 && nm === 11 && ['canopy', 'subcanopy'].includes(sp.layer)) add(o, 'note', 'Check tree guards and stakes on', sp.name, 'Voles and deer do their damage in winter');
    } else if (o.type === 'garden' && o.crop && sc && SPECIES_BY_ID[o.crop]) {
      // the bed's crop: this month's jobs from the site's own planting calendar
      const sp = SPECIES_BY_ID[o.crop];
      const a = advise(sp, sc, null, 1, null);
      const first = Math.floor((Date.UTC(2023, m - 1, 1) - Date.UTC(2023, 0, 1)) / 86400000) + 1;
      const last = Math.floor((Date.UTC(2023, m, 0) - Date.UTC(2023, 0, 1)) / 86400000) + 1;
      for (const l of jobsBetween(a.calendar, first, last)) {
        const type: JournalEvent['type'] = l.kind === 'harvest' ? 'harvested' : l.kind === 'indoor' ? 'note' : 'planted';
        const tid = `${o.id}:${l.kind}:${ym}`;
        extra.push({ id: tid, objectId: o.id, objectIds: [o.id], taskIds: [tid], label: `${l.label}: ${sp.name} (${o.name})`, type, why: l.text || 'Your planting calendar', done: o.events.some((e) => e.taskId === tid), count: 1 });
      }
    } else if (o.type === 'garden') {
      if (nm === 3 || nm === 4) add(o, 'note', 'Prepare and sow', 'garden beds', 'Spring planting');
      if (nm === 10) add(o, 'mulched', 'Cover crop or mulch', 'garden beds', 'Protect the soil over winter');
    } else if (o.type === 'compost' && nm >= 4 && nm <= 10) {
      add(o, 'note', 'Turn', o.name, 'Monthly turning keeps it hot', o.id);
    } else if (o.type === 'tank' && (nm === 3 || nm === 9)) {
      add(o, 'note', 'Clean gutters and first-flush on', 'the tanks', 'Twice a year');
    } else if (o.type === 'hive' && nm >= 4 && nm <= 9) {
      add(o, 'note', 'Inspect', 'the hives', 'Check brood, stores and swarm cells');
    } else if (o.type === 'pond' && (nm === 4 || nm === 10)) {
      add(o, 'note', 'Walk the spillway and banks of', o.name, 'Clear debris and fill any rills before the wet season', o.id);
    }
  }
  const tasks: Task[] = [];
  for (const g of groups.values()) {
    const ids = g.objs.map((o) => `${o.id}:${g.type}:${ym}`);
    const one = g.objs.length === 1;
    const kinds = [...new Set(g.objs.map((o) => SPECIES_BY_ID[o.species || '']?.name).filter(Boolean))];
    const round = g.objs.length > 1 && (g.type === 'mulched' || g.type === 'watered') && kinds.length > 1;
    const what = round ? `the young trees and shrubs (${g.objs.length}): ${kinds.slice(0, 4).join(', ')}${kinds.length > 4 ? ` and ${kinds.length - 4} more kinds` : ''}`
      : one && g.objs[0].type === 'plant' ? g.objs[0].name : g.objs.length > 1 && g.what !== 'garden beds' && g.what !== 'the tanks' && g.what !== 'the hives' ? `${g.what} (${g.objs.length})` : g.what;
    tasks.push({
      id: ids[0] + (one ? '' : `+${g.objs.length}`), objectId: g.objs[0].id, objectIds: g.objs.map((o) => o.id), taskIds: ids,
      label: `${g.verb} ${what}`, type: g.type, why: g.why, count: g.objs.length,
      done: g.objs.every((o, i) => o.events.some((e) => e.taskId === ids[i])),
    });
  }
  return [...tasks, ...extra];
}
