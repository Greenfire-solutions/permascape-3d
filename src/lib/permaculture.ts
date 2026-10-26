// The permaculture design tools that work on the plan rather than the ground: guilds, hedgerows,
// keyline patterns, sun and wind sectors, the water budget, the design review, and applying a
// list of proposed changes (from the AI designer or a review fix) to the design in one step.
// Pure functions: everything here runs in node for the tests.
import type { AiAction, DesignState, Feature, Site, SiteObject, Animal } from './types.ts';
import { LIBRARY, LIBRARY_BY_ID } from './library.ts';
import type { Species, Layer } from './library.ts';
import type { Grid } from './terrain.ts';
import { heightAt, contourThrough, applyEarthwork, digPond, polygonArea, polylineLength, pointInPolygon, slopeGrid } from './terrain.ts';
import { sunPosition } from './sun.ts';
import { plantChecks, sitingChecks, CONFLICTS } from './checks.ts';
import { isHouse } from './estimate.ts';

/** The home the zones and sectors radiate from: the house by name, else a house-sized dwelling, else the first building. */
export const homeOf = (objects: SiteObject[]) => objects.find((o) => o.type === 'building' && /house|home|cabin|cottage|farmhouse/i.test(o.name) && !/green|hen|guest|pump|well|bath|out/i.test(o.name.replace(/house \d+$/i, 'house')))
  || objects.find((o) => o.type === 'building' && isHouse(o)) || objects.find((o) => o.type === 'building');
import type { Check } from './checks.ts';

/** The hardiness zone every check uses: the person's own, else the USDA map for the ZIP, else the climate estimate. */
export function effectiveZone(site: Pick<Site, 'climate' | 'overrides'> | null | undefined): number | null {
  const label = site?.overrides?.zone || site?.climate?.zoneOfficial?.label;
  const m = label ? String(label).match(/^(\d{1,2})/) : null;
  if (m) return Number(m[1]);
  return site?.climate?.zone?.zone ?? null;
}

const fits = (sp: Species, zone: number | null) => zone == null || (zone >= sp.zoneMin && zone <= sp.zoneMax);
const has = (sp: Species, ...fn: string[]) => sp.functions.some((f) => fn.some((k) => f.toLowerCase().includes(k)));

// ---------------------------------------------------------------- guilds

export interface GuildMember { role: string; species: Species; x: number; y: number }

const GUILD_ROLES: { role: string; pick: (s: Species) => boolean; count: number; ring: number }[] = [
  { role: 'Nitrogen fixer', pick: (s) => has(s, 'nitrogen') && ['shrub', 'herb', 'subcanopy'].includes(s.layer) && s.life === 'perennial', count: 2, ring: 0.95 },
  { role: 'Nutrient miner', pick: (s) => has(s, 'dynamic accumulator') && s.life === 'perennial', count: 2, ring: 0.6 },
  { role: 'Pollinator and insect attractor', pick: (s) => has(s, 'pollinator', 'beneficial', 'bee forage') && ['herb', 'groundcover', 'shrub'].includes(s.layer) && s.life === 'perennial' && s.heightM <= 2, count: 2, ring: 0.75 },
  { role: 'Pest confuser', pick: (s) => has(s, 'pest confuser') && s.life === 'perennial', count: 2, ring: 0.45 },
  { role: 'Living mulch', pick: (s) => s.layer === 'groundcover' && s.life === 'perennial', count: 2, ring: 0.85 },
];

/**
 * How well a plant suits this exact site (climate, humidity, soil), from the plant advisor.
 * Optional so the pure tests can run on hardiness zone alone.
 */
export type FitFn = (id: string) => 'good' | 'possible' | 'no';
const rank = (fit: FitFn | undefined, sp: Species) => (fit ? { good: 0, possible: 1, no: 2 }[fit(sp.id)] : 0);
const usable = (fit: FitFn | undefined, sp: Species) => !fit || fit(sp.id) !== 'no';

/** Plants that would host a disease of, or poison, something already in the design. */
export function conflictsWith(presentIds: Iterable<string>) {
  const present = new Set(presentIds), bad = new Set<string>();
  for (const c of CONFLICTS) {
    if (c.hurts.some((h) => present.has(h))) bad.add(c.host);
    if (present.has(c.host)) for (const h of c.hurts) bad.add(h);
  }
  return bad;
}

/** Support species that fit this site's zone, best match per role. */
export function guildSpecies(center: Species, zone: number | null, fit?: FitFn) {
  const out: { role: string; species: Species; count: number; ring: number }[] = [];
  const used = new Set<string>([center.id]);
  const avoid = conflictsWith([center.id]);
  for (const r of GUILD_ROLES) {
    const pool = LIBRARY.filter((s) => r.pick(s) && fits(s, zone) && usable(fit, s) && !avoid.has(s.id) && !used.has(s.id) && s.heightM < center.heightM * 0.8)
      .sort((a, b) => rank(fit, a) - rank(fit, b) || b.functions.length - a.functions.length || a.heightM - b.heightM);
    if (!pool.length) continue;
    used.add(pool[0].id);
    out.push({ role: r.role, species: pool[0], count: r.count, ring: r.ring });
  }
  return out;
}

/** A tree with its support plants placed in rings around the drip line. */
export function buildGuild(centerId: string, x: number, y: number, zone: number | null, fit?: FitFn): GuildMember[] {
  const center = LIBRARY_BY_ID[centerId];
  if (!center) return [];
  const R = Math.max(1.2, center.spreadM / 2);
  const members: GuildMember[] = [{ role: 'Centre', species: center, x, y }];
  let k = 0;
  const roles = guildSpecies(center, zone, fit);
  const total = roles.reduce((s, r) => s + r.count, 0);
  for (const r of roles) {
    for (let i = 0; i < r.count; i++, k++) {
      const a = (k / Math.max(1, total)) * Math.PI * 2 + (r.ring < 0.7 ? 0.3 : 0);
      members.push({ role: r.role, species: r.species, x: x + Math.cos(a) * R * r.ring, y: y + Math.sin(a) * R * r.ring });
    }
  }
  return members;
}

// ---------------------------------------------------------------- lines: hedgerows, keylines

/** Points every `spacing` metres along a polyline. */
export function alongLine(points: [number, number][], spacing: number): [number, number][] {
  const out: [number, number][] = [];
  if (points.length < 2 || spacing <= 0) return points.slice(0, 1);
  let carry = 0;
  out.push(points[0]);
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1], [bx, by] = points[i];
    const L = Math.hypot(bx - ax, by - ay);
    let d = spacing - carry;
    while (d <= L) { out.push([ax + ((bx - ax) * d) / L, ay + ((by - ay) * d) / L]); d += spacing; }
    carry = L - (d - spacing);
  }
  return out;
}

/**
 * Shelterbelt species for the site: a tall row and a shrub row, windbreak plants first. Plants
 * that suit the climate and soil come before ones that only survive, and anything that would
 * host a disease of what is already planted (red cedar beside apples) is left out.
 */
export function hedgeSpecies(zone: number | null, fit?: FitFn, presentIds: Iterable<string> = []) {
  const avoid = conflictsWith(presentIds);
  const ok = (s: Species) => s.life === 'perennial' && fits(s, zone) && usable(fit, s) && !avoid.has(s.id) && !INVASIVE_HEDGE.includes(s.id);
  const wb = LIBRARY.filter((s) => ok(s) && has(s, 'windbreak', 'hedge'));
  const tall = wb.filter((s) => s.heightM >= 5).sort((a, b) => rank(fit, a) - rank(fit, b) || Number(has(b, 'nitrogen')) - Number(has(a, 'nitrogen')) || b.functions.length - a.functions.length);
  const low = LIBRARY.filter((s) => ok(s) && s.layer === 'shrub' && (has(s, 'windbreak', 'hedge', 'nitrogen', 'wildlife') || s.category === 'berry'))
    .sort((a, b) => rank(fit, a) - rank(fit, b) || Number(has(b, 'hedge', 'windbreak')) - Number(has(a, 'hedge', 'windbreak')) || b.functions.length - a.functions.length);
  return { tall: tall[0] ?? null, low: low[0] ?? null };
}
/** Never chosen automatically for a hedgerow: they spread past it. */
const INVASIVE_HEDGE = ['timberbamboo', 'seabuckthorn', 'peashrub', 'blacklocust'];

/** A hedgerow: tall trees on the line, shrubs staggered a metre and a half to one side. */
export function buildHedge(points: [number, number][], zone: number | null, tallId?: string, lowId?: string, fit?: FitFn, presentIds: Iterable<string> = []) {
  const picks = hedgeSpecies(zone, fit, presentIds);
  const tall = (tallId && LIBRARY_BY_ID[tallId]) || picks.tall;
  const low = (lowId && LIBRARY_BY_ID[lowId]) || picks.low;
  const out: { species: Species; x: number; y: number }[] = [];
  if (tall) for (const [x, y] of alongLine(points, Math.max(2.5, tall.spreadM * 0.7))) out.push({ species: tall, x, y });
  if (low) {
    const off = offsetPolyline(points, 1.6);
    const pts = alongLine(off, Math.max(1, low.spreadM * 0.8));
    for (const [x, y] of pts) out.push({ species: low, x, y });
  }
  return { plants: out, tall, low };
}

/** Parallel copy of a polyline, `d` metres to its left (negative for right). */
export function offsetPolyline(points: [number, number][], d: number): [number, number][] {
  if (points.length < 2) return points.slice();
  return points.map((p, i) => {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [p[0] - ((b[1] - a[1]) / L) * d, p[1] + ((b[0] - a[0]) / L) * d] as [number, number];
  });
}

/**
 * Keyline pattern: the level line through the clicked point, then parallel copies above and
 * below it. Parallel lines drift off contour, which is the point: worked or planted along them,
 * water is led from the wet valleys out onto the drier ridges.
 */
export function keylinePattern(g: Grid, x: number, y: number, spacing: number, count: number, length: number): [number, number][][] {
  const key = contourThrough(g, x, y, length);
  if (!key) return [];
  const half = g.size / 2;
  const inside = (p: [number, number]) => Math.abs(p[0]) <= half && Math.abs(p[1]) <= half;
  const lines: [number, number][][] = [key];
  for (let k = 1; k <= count; k++) for (const s of [1, -1]) {
    const off = offsetPolyline(key, s * k * spacing).filter(inside);
    if (off.length >= 2 && polylineLength(off) > spacing) lines.push(off);
  }
  return lines;
}

// ---------------------------------------------------------------- sectors

/** Sunrise and sunset bearings at the solstices, for the sun sector arcs. */
export function sunSectors(lat: number, lon: number) {
  const year = new Date().getUTCFullYear();
  const day = (m: number, d: number) => {
    let rise: number | null = null, set: number | null = null, prevAlt = -90, noonAlt = -90;
    for (let mins = 0; mins < 1440; mins += 4) {
      const t = new Date(Date.UTC(year, m - 1, d) + (mins - (lon / 15) * 60) * 60000);
      const p = sunPosition(t, lat, lon);
      if (prevAlt < 0 && p.altitude >= 0 && rise == null) rise = p.azimuth;
      if (prevAlt >= 0 && p.altitude < 0) set = p.azimuth;
      noonAlt = Math.max(noonAlt, p.altitude);
      prevAlt = p.altitude;
    }
    return { rise, set, noonAlt };
  };
  const north = lat >= 0;
  return { summer: north ? day(6, 21) : day(12, 21), winter: north ? day(12, 21) : day(6, 21) };
}

export const SECTOR_STYLE: Record<string, { label: string; color: string; spread: number }> = {
  'sun-summer': { label: 'Summer sun', color: '#f5b94a', spread: 0 },
  'sun-winter': { label: 'Winter sun', color: '#f08a4b', spread: 0 },
  wind: { label: 'Prevailing wind', color: '#9fd8f0', spread: 50 },
  'cold-wind': { label: 'Cold winter wind', color: '#7aa7ff', spread: 50 },
  fire: { label: 'Wildfire risk', color: '#ef4444', spread: 70 },
  view: { label: 'View to keep', color: '#c084fc', spread: 40 },
  noise: { label: 'Noise or eyesore', color: '#a8a29e', spread: 40 },
  wildlife: { label: 'Wildlife corridor', color: '#8acf52', spread: 40 },
  flood: { label: 'Flood or runoff in', color: '#38bdf8', spread: 50 },
  frost: { label: 'Cold air drains in', color: '#e0f2fe', spread: 60 },
};

export const bearing = (from: [number, number], to: [number, number]) => ((Math.atan2(to[0] - from[0], to[1] - from[1]) * 180) / Math.PI + 360) % 360;

// ---------------------------------------------------------------- water budget

/** Mean extraterrestrial radiation for the middle of a month, in mm of water evaporated a day. */
function raMm(lat: number, month: number) {
  const doy = [17, 47, 75, 105, 135, 162, 198, 228, 258, 288, 318, 344][month];
  const phi = (lat * Math.PI) / 180;
  const dr = 1 + 0.033 * Math.cos((2 * Math.PI * doy) / 365);
  const dec = 0.409 * Math.sin((2 * Math.PI * doy) / 365 - 1.39);
  const ws = Math.acos(Math.max(-1, Math.min(1, -Math.tan(phi) * Math.tan(dec))));
  const ra = ((24 * 60) / Math.PI) * 0.082 * dr * (ws * Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.sin(ws));
  return ra * 0.408;
}

const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const KC = { low: 0.35, medium: 0.6, high: 0.85 };

export interface WaterMonth { month: number; rainMm: number; et0Mm: number; roofL: number; demandL: number; rainOnPlantsL: number; needL: number; storeL: number; shortL: number; houseL: number; animalsL: number }

/** People and animals drink too. Supply other than rain (a well, mains) covers what the tanks cannot. */
export interface WaterUseIn { people?: number; litresPerPerson?: number; supply?: 'rain' | 'well' | 'mains' | 'spring' | 'creek' }

/** Litres a day each animal drinks, roughly, in warm weather. */
export const DRINK_L: Record<Animal, number> = { chickens: 0.5, ducks: 1, geese: 1, rabbits: 0.5, goats: 12, sheep: 7, pigs: 15, cattle: 55, bees: 0 };

export function livestockLitresPerDay(objects: SiteObject[], features: Feature[]) {
  let l = 0, hens = 0;
  for (const f of features) if (f.kind === 'paddock') { l += (f.head ?? 0) * DRINK_L[f.animal || 'chickens']; if ((f.animal || 'chickens') === 'chickens') hens += f.head ?? 0; }
  // a coop with no chicken paddock still houses a small flock
  const coops = objects.filter((o) => o.type === 'coop').length;
  if (coops && !hens) l += coops * 8 * DRINK_L.chickens;
  return l;
}

/**
 * Month-by-month water balance: reference evaporation by Hargreaves (FAO-56), plant demand from
 * canopy area times a crop factor for each plant's water need, rain that lands on the planting,
 * roof runoff into storage, and a tank run through two years so the first year's start does not
 * decide the answer. Ponds and swales are counted as soil storage, not drawn on for irrigation.
 */
export function waterBudget(site: Site, objects: SiteObject[], features: Feature[], growth = 1, use: WaterUseIn = {}) {
  const c = site.climate;
  if (!c || site.lat == null) return null;
  const lat = site.lat;
  let canopyM2 = 0, demandWeight = 0;
  for (const o of objects) {
    if (o.type === 'plant') {
      const sp = LIBRARY_BY_ID[o.species || ''];
      if (!sp) continue;
      const a = Math.PI * ((sp.spreadM * o.scale * growth) / 2) ** 2;
      canopyM2 += a; demandWeight += a * KC[sp.water];
    } else if (o.type === 'garden') {
      const a = (o.width ?? 1.2) * (o.depth ?? 4) * o.scale * o.scale;
      canopyM2 += a; demandWeight += a * 0.8;
    }
  }
  const roofM2 = objects.filter((o) => ['building', 'greenhouse', 'coop'].includes(o.type))
    .reduce((s, o) => s + (o.type === 'coop' ? 2.4 * 1.8 : (o.width ?? 6) * (o.depth ?? 8)) * o.scale * o.scale, 0);
  const tankL = objects.filter((o) => o.type === 'tank').reduce((s, o) => s + (o.capacityL ?? 10000), 0);
  const pondL = objects.filter((o) => o.type === 'pond').reduce((s, o) => s + Math.PI * (o.radius ?? 5) ** 2 * (o.depth ?? 1.5) * 0.5 * 1000, 0);
  const swaleL = features.filter((f) => f.kind === 'swale').reduce((s, f) => s + polylineLength(f.points) * (f.width ?? 1.2) * (f.depth ?? 0.5) * 1000, 0);
  const supply = use.supply || 'rain';
  const housePerDay = (use.people ?? 0) * (use.litresPerPerson ?? 190);
  const animalsPerDay = livestockLitresPerDay(objects, features);
  const months: WaterMonth[] = [];
  for (let m = 0; m < 12; m++) {
    const tmax = c.monthlyMeanMaxC[m], tmin = c.monthlyMeanMinC[m], tmean = (tmax + tmin) / 2;
    const et0 = Math.max(0, 0.0023 * raMm(lat, m) * (tmean + 17.8) * Math.sqrt(Math.max(0, tmax - tmin))) * DAYS[m];
    const rain = c.monthlyPrecipMm[m];
    const dormant = tmean < 5 ? 0.25 : 1;
    const demand = demandWeight * et0 * dormant;
    const eff = canopyM2 * rain * 0.7;
    const houseL = housePerDay * DAYS[m], animalsL = animalsPerDay * DAYS[m] * (tmean < 5 ? 0.7 : 1);
    months.push({ month: m, rainMm: rain, et0Mm: et0, roofL: roofM2 * rain * 0.8, demandL: demand, rainOnPlantsL: eff, needL: Math.max(0, demand - eff) + houseL + animalsL, storeL: 0, shortL: 0, houseL, animalsL });
  }
  // run the tank for two years and report the second
  let store = tankL;
  for (let pass = 0; pass < 2; pass++) for (const w of months) {
    store = Math.min(tankL, store + w.roofL);
    const draw = Math.min(store, w.needL);
    store -= draw;
    if (pass === 1) { w.storeL = store; w.shortL = w.needL - draw; }
  }
  // the tank that would carry the driest run on roof water alone
  let run = 0, worst = 0;
  for (let pass = 0; pass < 2; pass++) for (const w of months) { run = Math.max(0, run + w.needL - w.roofL); worst = Math.max(worst, run); }
  const sum = (k: keyof WaterMonth) => months.reduce((s, w) => s + (w[k] as number), 0);
  // with a well or mains, what the tanks cannot give is drawn from that supply instead
  const fromSupplyL = supply === 'rain' ? 0 : sum('shortL');
  return {
    months, canopyM2, roofM2, tankL, pondL, swaleL, supply,
    yearRoofL: sum('roofL'), yearNeedL: sum('needL'), yearDemandL: sum('demandL'), yearShortL: supply === 'rain' ? sum('shortL') : 0, yearEt0: sum('et0Mm'), yearRain: sum('rainMm'),
    yearHouseL: sum('houseL'), yearAnimalsL: sum('animalsL'), fromSupplyL,
    tankForDriestRunL: worst,
    roofCanCover: sum('roofL') >= sum('needL'),
  };
}

// ---------------------------------------------------------------- design review

export type FixId = 'guilds' | 'tank' | 'zones' | 'swales' | 'compost' | 'pollinators' | 'nfixers' | 'misfits' | 'windbreak' | 'sectors' | 'house' | 'select' | 'read' | 'plants';
export interface Finding { level: 'good' | 'tip' | 'warn'; text: string; fix?: FixId; fixLabel?: string; ids?: string[] }
export interface ReviewArea { id: string; name: string; score: number; findings: Finding[] }

export interface ReviewInput {
  site: Site; objects: SiteObject[]; features: Feature[]; zone: number | null;
  meanSlope: number; cutM3: number; fillM3: number; roofCatchL: number | null;
  units?: 'metric' | 'imperial';
  slopeAt?: (x: number, y: number) => number;
  wetAt?: (x: number, y: number) => boolean;
}

/** One check: `na` leaves it out of the score entirely (nothing to judge yet). */
interface Rule { ok: boolean; w: number; good: string; bad: Finding; na?: boolean }

const vol = (m3: number, units?: string) => (units === 'metric' ? `${Math.round(m3).toLocaleString()} m³` : `${Math.round(m3 * 1.30795).toLocaleString()} cubic yards`);

/** Scores the design against the core permaculture checks, each with a suggested next step. */
export function reviewDesign(d: ReviewInput) {
  const plants = d.objects.filter((o) => o.type === 'plant');
  const sp = plants.map((p) => LIBRARY_BY_ID[p.species || '']).filter(Boolean) as Species[];
  const trees = plants.filter((p) => { const s = LIBRARY_BY_ID[p.species || '']; return s && ['canopy', 'subcanopy'].includes(s.layer) && ['fruit-tree', 'nut-tree'].includes(s.category); });
  const areas: ReviewArea[] = [];
  const area = (id: string, name: string, all: Rule[], extra: Finding[] = [], penalty = 0) => {
    const checks = all.filter((c) => !c.na);
    const total = checks.reduce((s, c) => s + c.w, 0);
    const base = total ? (checks.reduce((s, c) => s + (c.ok ? c.w : 0), 0) / total) * 100 : 0;
    const score = Math.max(0, Math.round(base - penalty));
    areas.push({ id, name, score, findings: [...extra, ...checks.map((c) => (c.ok ? { level: 'good', text: c.good } as Finding : c.bad))] });
  };
  const checks: Check[] = [...plantChecks(d.objects, d.site), ...sitingChecks({ site: d.site, objects: d.objects, features: d.features, slopeAt: d.slopeAt, wetAt: d.wetAt })];
  const asFinding = (c: Check): Finding => ({ level: c.level, text: c.text, fix: 'select', fixLabel: 'Show me', ids: c.ids });
  const penaltyOf = (cs: Check[]) => cs.reduce((t, c) => t + (c.level === 'warn' ? 15 : 5), 0);

  // water: catch it, slow it, spread it, sink it, store it
  const tanks = d.objects.filter((o) => o.type === 'tank');
  const tankL = tanks.reduce((s, o) => s + (o.capacityL ?? 10000), 0);
  const roofs = d.objects.filter((o) => ['building', 'greenhouse'].includes(o.type));
  const swales = d.features.filter((f) => f.kind === 'swale');
  const ponds = d.objects.filter((o) => o.type === 'pond');
  const siteHa = (d.site.size * d.site.size) / 10000;
  area('water', 'Water', [
    { ok: roofs.length === 0 || tanks.length > 0, w: 3, good: 'Roof water is caught in a tank.', bad: { level: 'warn', text: 'The roofs shed water that nothing catches. A tank by the house is the cheapest water you will ever get.', fix: 'tank', fixLabel: 'Add a tank by the house' } },
    { ok: d.roofCatchL == null || tankL >= Math.min(d.roofCatchL * 0.15, 40000) || roofs.length === 0, w: 2, good: 'Tank storage is in proportion to the roof.', bad: { level: 'tip', text: 'The tanks hold little of what the roof sheds in a year. Size up, or open the Water budget to see the driest months.', fix: 'tank', fixLabel: 'Add another tank' } },
    { ok: d.meanSlope < 3 || swales.length > 0, w: 3, good: d.meanSlope < 3 ? 'The land is gentle; swales matter less here.' : 'Swales on contour slow the water and sink it into the slope.', bad: { level: 'warn', text: `The land averages a ${d.meanSlope.toFixed(0)}% slope and water runs straight off it. Dig a swale on contour above the planting.`, fix: 'swales', fixLabel: 'Use the contour swale tool' } },
    { ok: siteHa < 0.4 || ponds.length > 0, w: 2, good: siteHa < 0.4 ? 'A small site: tanks and soil hold the water.' : 'A pond stores water in the landscape for animals, fire and dry months.', bad: { level: 'tip', text: 'On this much land a pond in a low spot, fed by swale overflow, is the backbone of the water system.' } },
  ]);

  // diversity and stacking
  const species = new Set(sp.map((s) => s.id));
  const layers = new Set<Layer>(sp.map((s) => s.layer));
  const nfix = sp.filter((s) => has(s, 'nitrogen')).length;
  const pollin = sp.filter((s) => has(s, 'pollinator', 'bee forage', 'beneficial')).length;
  const counts: Record<string, number> = {};
  for (const s of sp) counts[s.id] = (counts[s.id] || 0) + 1;
  const topShare = sp.length ? Math.max(...Object.values(counts)) / sp.length : 0;
  const none = plants.length === 0;
  const plantIssues = checks.filter((c) => c.area === 'plants');
  area('diversity', 'Plants and diversity', [
    { ok: plants.length >= 5, w: 1, good: `${plants.length} plants placed.`, bad: { level: 'tip', text: none ? 'No plants yet. Start with a guild: one fruit tree and its helpers.' : `Only ${plants.length} plant${plants.length > 1 ? 's' : ''} so far. A guild puts a fruit tree in with all its helpers.`, fix: 'guilds', fixLabel: 'Show me the guild tool' } },
    { na: none, ok: species.size >= 8, w: 2, good: `${species.size} different species: resilient.`, bad: { level: 'tip', text: `${species.size} species so far. Diversity is insurance against pests, weather and a bad year.`, fix: 'plants', fixLabel: 'Open the plant library' } },
    { na: none, ok: layers.size >= 4, w: 2, good: `${layers.size} of the 7 forest layers are used.`, bad: { level: 'tip', text: `${layers.size} of 7 layers used. Add shrubs, herbs, ground covers and vines under the trees to stack yields.` } },
    { na: trees.length === 0, ok: nfix >= Math.ceil(trees.length / 2), w: 3, good: 'Enough nitrogen fixers to feed the trees.', bad: { level: 'warn', text: `${trees.length} fruit and nut trees but only ${nfix} nitrogen fixers. Aim for about one fixer for every two trees.`, fix: 'nfixers', fixLabel: 'Add fixers beside each tree' } },
    { na: none, ok: pollin >= Math.max(2, plants.length * 0.1), w: 2, good: 'Pollinator plants are in the mix.', bad: { level: 'tip', text: 'Few flowers for pollinators and predator insects. They set the fruit and eat the pests.', fix: 'pollinators', fixLabel: 'Add pollinator plants' } },
    { na: sp.length < 10, ok: topShare < 0.4, w: 1, good: 'No single species dominates.', bad: { level: 'tip', text: `${Math.round(topShare * 100)}% of the plants are one species: a monoculture in miniature.` } },
    { na: trees.length === 0, ok: guildedShare(d.objects) >= 0.6, w: 2, good: 'Most trees have support plants around them.', bad: { level: 'tip', text: 'Several trees stand alone. Guilds of support plants feed them, mulch them and keep pests in check.', fix: 'guilds', fixLabel: 'Grow guilds around lone trees' } },
    { na: none, ok: plantIssues.length === 0, w: 2, good: 'No plant hosts a disease of another, and nothing invasive.', bad: { level: 'tip', text: '' } },
  ], plantIssues.map(asFinding), penaltyOf(plantIssues.filter((c) => c.level === 'warn')));
  // the "no conflicts" rule's own bad text is never shown: the conflicts themselves are listed above
  const div = areas[areas.length - 1];
  div.findings = div.findings.filter((f) => f.text);

  // zones and flow
  const zones = d.features.filter((f) => f.kind === 'zone');
  const house = homeOf(d.objects);
  const z1 = zones.filter((z) => (z.zone ?? 1) <= 1);
  const near = (o: SiteObject | undefined, maxM: number, types: string[]) => !!o && d.objects.some((x) => types.includes(x.type) && Math.hypot(x.x - o.x, x.y - o.y) <= maxM);
  const zone1Near = z1.some((z) => { const c = centroid(z.points); return Math.hypot(c[0] - house!.x, c[1] - house!.y) < 45; });
  area('zones', 'Zones and flow', [
    { ok: !!house, w: 1, good: 'A home base is placed: zones radiate from it.', bad: { level: 'tip', text: 'No house or home base yet. Zones are planned outward from where you live and work.', fix: 'house', fixLabel: 'Place the house' } },
    { ok: zones.length >= 2, w: 3, good: `${zones.length} zones drawn.`, bad: { level: 'warn', text: 'No zones mapped. Draw zone 1 (daily visits) next to the house, then zones 2 and 3 further out.', fix: 'zones', fixLabel: 'Use the zone tool' } },
    { na: !house || !z1.length, ok: zone1Near, w: 2, good: 'Zone 1 sits next to the house, where you pass every day.', bad: { level: 'tip', text: 'Zone 1 is far from the house. Herbs and salad you visit daily belong at the back door.' } },
    { ok: d.objects.some((o) => o.type === 'compost') && (!house || near(house, 60, ['compost'])), w: 2, good: 'Compost is close enough to use.', bad: { level: 'tip', text: 'No compost near the kitchen and garden. It closes the nutrient loop.', fix: 'compost', fixLabel: 'Add compost bays' } },
    { ok: d.features.some((f) => f.kind === 'path'), w: 1, good: 'Paths connect the design.', bad: { level: 'tip', text: 'No paths drawn. Paths decide what gets visited and what gets forgotten.' } },
  ]);

  // climate fit
  const misfits = plants.filter((p) => { const s = LIBRARY_BY_ID[p.species || '']; return s && !fits(s, d.zone); });
  const sectors = d.features.filter((f) => f.kind === 'sector');
  const hedges = sp.filter((s) => has(s, 'windbreak', 'hedge')).length;
  area('climate', 'Climate and sectors', [
    { na: plants.length === 0, ok: misfits.length === 0, w: 3, good: d.zone != null ? `Every plant suits hardiness zone ${d.zone}.` : 'Set a real address to check plants against the climate.', bad: { level: 'warn', text: `${misfits.length} plant${misfits.length > 1 ? 's' : ''} will not survive zone ${d.zone}: ${[...new Set(misfits.map((m) => LIBRARY_BY_ID[m.species!]?.name))].slice(0, 4).join(', ')}.`, fix: 'misfits', fixLabel: 'Select the first one' } },
    { ok: sectors.length > 0, w: 2, good: 'Sectors are mapped: sun, wind and outside energies.', bad: { level: 'tip', text: 'Map the sectors: where sun, wind, fire and views come from decides where everything goes.', fix: 'sectors', fixLabel: 'Add sun and wind sectors' } },
    { ok: d.site.size < 40 || hedges >= 3, w: 1, good: 'Windbreak plants shelter the site.', bad: { level: 'tip', text: 'No windbreak yet. A hedgerow on the windward side warms the whole site and cuts water loss.', fix: 'windbreak', fixLabel: 'Use the hedgerow tool' } },
  ]);

  // soil and earth
  const moved = d.cutM3 + d.fillM3;
  area('soil', 'Soil and earthworks', [
    { na: moved < 1, ok: Math.abs(d.cutM3 - d.fillM3) / moved < 0.5, w: 2, good: 'Cut and fill roughly balance: no trucks of soil in or out.', bad: { level: 'tip', text: `The earthworks cut ${vol(d.cutM3, d.units)} and fill ${vol(d.fillM3, d.units)}. Use the spoil from ponds and swales for berms, pads or a dam wall so it does not have to be hauled.` } },
    { na: none, ok: sp.some((s) => s.layer === 'groundcover') || d.objects.some((o) => o.type === 'garden'), w: 1, good: 'Ground covers or beds keep the soil covered.', bad: { level: 'tip', text: 'Bare soil between the trees. Ground covers and mulch keep it alive.' } },
    { ok: d.objects.some((o) => ['coop'].includes(o.type)) || d.features.some((f) => f.kind === 'paddock'), w: 1, good: 'Animals cycle nutrients through the system.', bad: { level: 'tip', text: 'No animals yet. Even a few hens turn scraps into eggs and fertility.' } },
  ]);

  // siting: water, slope, flood and the law
  const siting = checks.filter((c) => c.area === 'siting');
  const s = d.site.surroundings;
  area('siting', 'Siting and safety', [
    { ok: !!s, w: 2, good: 'Flood maps, streams, wetlands and soils are loaded and checked.', bad: { level: 'tip', text: d.site.lat == null ? 'A sandbox has no public maps to check against.' : 'Load the flood maps, streams, wetlands and soil map for this land so the design can be checked against them.', fix: d.site.lat == null ? undefined : 'read', fixLabel: 'Load them in Site' } },
    { na: !d.objects.length && !d.features.some((f) => f.kind !== 'sector'), ok: siting.filter((c) => c.level === 'warn').length === 0, w: 3, good: 'Nothing sits in a flood area, a stream buffer, a wetland or a drainage line.', bad: { level: 'tip', text: '' } },
  ], siting.map(asFinding), penaltyOf(siting.filter((c) => c.level === 'tip')) / 2);
  const sit = areas[areas.length - 1];
  sit.findings = sit.findings.filter((f) => f.text);

  const overall = Math.round(areas.reduce((t, a) => t + a.score, 0) / areas.length);
  return { overall, areas, checks };
}

/** Share of fruit and nut trees with at least two other plants within their spread. */
export function guildedShare(objects: SiteObject[]) {
  const plants = objects.filter((o) => o.type === 'plant');
  const trees = plants.filter((p) => { const s = LIBRARY_BY_ID[p.species || '']; return s && ['canopy', 'subcanopy'].includes(s.layer) && ['fruit-tree', 'nut-tree'].includes(s.category); });
  if (!trees.length) return 1;
  const ok = trees.filter((t) => {
    const r = Math.max(1.5, (LIBRARY_BY_ID[t.species!]?.spreadM ?? 4) / 2 + 0.5);
    return plants.filter((p) => p !== t && Math.hypot(p.x - t.x, p.y - t.y) <= r).length >= 2;
  });
  return ok.length / trees.length;
}

export const centroid = (pts: [number, number][]): [number, number] => [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];

// ---------------------------------------------------------------- animals

export const ANIMALS: Record<Animal, { label: string; m2Each: number; restDays: number; note: string }> = {
  chickens: { label: 'Chickens', m2Each: 10, restDays: 30, note: 'About 10 m2 of forage each when rotated; move weekly.' },
  ducks: { label: 'Ducks', m2Each: 12, restDays: 30, note: 'Slug control; need water to dip their heads in.' },
  geese: { label: 'Geese', m2Each: 40, restDays: 30, note: 'Grazers; good orchard weeders.' },
  rabbits: { label: 'Rabbits', m2Each: 4, restDays: 21, note: 'In a moveable run over grass.' },
  goats: { label: 'Goats', m2Each: 600, restDays: 40, note: 'Browsers: keep them off young trees with good fencing.' },
  sheep: { label: 'Sheep', m2Each: 800, restDays: 40, note: 'Grazers; fine under mature orchards.' },
  pigs: { label: 'Pigs', m2Each: 400, restDays: 60, note: 'Tillers: use them to clear and dig a new bed.' },
  cattle: { label: 'Cattle', m2Each: 4000, restDays: 45, note: 'Rotate in small paddocks; long rests rebuild grass.' },
  bees: { label: 'Bee hives', m2Each: 0, restDays: 0, note: 'Hives forage up to 3 km out.' },
};
/** A sensible starting number when nobody said how many: what fits the paddock, capped low. */
export const defaultHead = (animal: Animal, areaM2: number) => Math.max(1, Math.min(animal === 'chickens' || animal === 'ducks' ? 12 : 6, Math.floor(areaM2 / Math.max(1, ANIMALS[animal].m2Each))));

// ---------------------------------------------------------------- applying proposals

export interface ApplyResult { state: DesignState; applied: number[]; notes: string[] }

/**
 * Applies a list of proposed changes as one design step (so one Undo takes them back).
 * Every coordinate is clamped onto the site, every species checked against the library;
 * a change that cannot be made is skipped with a note rather than half-made.
 */
export function applyActions(state: DesignState, g: Grid, actions: AiAction[], indices: number[], opts: { zone: number | null; day: string; id: () => string; fit?: FitFn }): ApplyResult {
  let heights = state.heights;
  const objects = [...state.objects];
  const features = [...state.features];
  const applied: number[] = [];
  const notes: string[] = [];
  const half = g.size / 2 - 0.5;
  const clampP = (x: number, y: number): [number, number] => [Math.max(-half, Math.min(half, Number(x) || 0)), Math.max(-half, Math.min(half, Number(y) || 0))];
  const pts = (p?: [number, number][]) => (p || []).filter((q) => Array.isArray(q) && q.length >= 2).map((q) => clampP(q[0], q[1]));
  const grid = () => ({ heights, n: g.n, size: g.size });
  const nameFor = (sp: Species) => `${sp.name} ${objects.filter((o) => o.species === sp.id).length + 1}`;
  let phase = 1;
  const addPlant = (sp: Species, x: number, y: number, note?: string) => {
    objects.push({ id: opts.id(), type: 'plant', species: sp.id, name: nameFor(sp), x, y, rotation: 0, scale: 1, planted: opts.day, phase, status: 'proposed', events: [{ id: opts.id(), date: opts.day, type: 'planted', text: note }] });
  };
  const ewOpts = { bermWidth: 2, bermHeight: 0.5, swaleWidth: 1.2, swaleDepth: 0.5, withBerm: true };

  for (const i of indices) {
    const a = actions[i];
    if (!a) continue;
    const [x, y] = clampP(a.x ?? 0, a.y ?? 0);
    const sp = a.species ? LIBRARY_BY_ID[a.species] : undefined;
    phase = Math.max(1, Math.min(3, Math.round(a.phase ?? 1)));
    const nObj = objects.length, nFeat = features.length;
    switch (a.kind) {
      case 'plant':
        if (!sp) { notes.push(`Skipped "${a.label}": unknown plant ${a.species}.`); continue; }
        addPlant(sp, x, y, a.why);
        break;
      case 'guild': {
        if (!sp) { notes.push(`Skipped "${a.label}": unknown tree ${a.species}.`); continue; }
        for (const m of buildGuild(sp.id, x, y, opts.zone, opts.fit)) { const [mx, my] = clampP(m.x, m.y); addPlant(m.species, mx, my, m.role === 'Centre' ? a.why : `${m.role} for the guild`); }
        break;
      }
      case 'hedge': {
        const line = pts(a.points);
        if (line.length < 2) { notes.push(`Skipped "${a.label}": a hedge needs a line.`); continue; }
        const h = buildHedge(line, opts.zone, sp?.id, undefined, opts.fit, objects.filter((o) => o.type === 'plant').map((o) => o.species || ''));
        for (const p of h.plants.slice(0, 150)) { const [px, py] = clampP(p.x, p.y); addPlant(p.species, px, py, 'hedgerow'); }
        break;
      }
      case 'zone': case 'paddock': {
        const poly = pts(a.points);
        if (poly.length < 3 || polygonArea(poly) < 1) { notes.push(`Skipped "${a.label}": an area needs three corners.`); continue; }
        if (a.kind === 'zone') features.push({ id: opts.id(), kind: 'zone', name: a.label || `Zone ${a.zone ?? 1}`, zone: Math.max(0, Math.min(5, Math.round(a.zone ?? 1))), points: poly, notes: a.why });
        else { const an = a.animal || 'chickens'; features.push({ id: opts.id(), kind: 'paddock', name: a.label || 'Paddock', animal: an, head: a.head != null ? Math.max(0, Math.round(a.head)) : defaultHead(an, polygonArea(poly)), restDays: ANIMALS[an].restDays, points: poly, notes: a.why }); }
        break;
      }
      case 'path': case 'fence': {
        const line = pts(a.points);
        if (line.length < 2) { notes.push(`Skipped "${a.label}": needs a line.`); continue; }
        features.push({ id: opts.id(), kind: a.kind, name: a.label, points: line, width: a.kind === 'path' ? (a.width ?? 1.5) : undefined, notes: a.why });
        break;
      }
      case 'swale': {
        const line = contourThrough(grid(), x, y, Math.max(8, Math.min(g.size * 1.5, a.size ?? 40)));
        if (!line) { notes.push(`Skipped "${a.label}": no slope at that spot for a swale.`); continue; }
        const r = applyEarthwork(grid(), line, 'swale', ewOpts);
        if (!r) { notes.push(`Skipped "${a.label}": nothing to dig there.`); continue; }
        heights = r.heights;
        features.push({ id: opts.id(), kind: 'swale', name: a.label || 'Swale', points: line, width: ewOpts.swaleWidth, depth: ewOpts.swaleDepth, height: ewOpts.bermHeight, notes: a.why });
        break;
      }
      case 'pond': {
        const radius = Math.max(1.5, Math.min(30, a.size ?? 5));
        const dug = digPond(grid(), x, y, radius, 1.5);
        heights = dug.heights;
        objects.push({ id: opts.id(), type: 'pond', name: a.label || 'Pond', x, y, rotation: 0, scale: 1, radius, depth: 1.5, waterLevel: dug.level, planted: opts.day, phase, status: 'proposed', notes: a.why, events: [{ id: opts.id(), date: opts.day, type: 'built' }] });
        break;
      }
      case 'structure': case 'garden': {
        const kind = a.kind === 'garden' ? 'garden' : a.structure;
        if (!kind || !['building', 'shed', 'greenhouse', 'tank', 'compost', 'coop', 'hive', 'garden'].includes(kind)) { notes.push(`Skipped "${a.label}": unknown structure.`); continue; }
        // a shed, barn or shelter is a small building; only a house gets house size by default
        const shed = kind === 'shed' || (kind === 'building' && /shed|barn|shelter|stable|garage|workshop|stand/i.test(a.label || ''));
        const type = (kind === 'shed' ? 'building' : kind) as SiteObject['type'];
        const o: SiteObject = { id: opts.id(), type, name: a.label || type, x, y, rotation: 0, scale: 1, planted: opts.day, notes: a.why, phase, status: 'proposed', events: [{ id: opts.id(), date: opts.day, type: 'built' }] };
        const dim = (v: number | undefined, d: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Number(v) || d));
        if (type === 'building') Object.assign(o, shed ? { width: dim(a.width, 4, 1.5, 20), depth: dim(a.depth, 5, 1.5, 30), height: 2.6 } : { width: dim(a.width, 8, 3, 30), depth: dim(a.depth, 10, 3, 40), height: 3 });
        if (type === 'greenhouse') Object.assign(o, { width: Math.min(10, a.width ?? 4), depth: a.depth ?? 8 });
        if (type === 'garden') Object.assign(o, { width: a.width ?? 1.2, depth: a.depth ?? 4, crop: sp?.id });
        if (type === 'tank') o.capacityL = Math.max(500, Math.min(200000, a.size ?? 10000));
        objects.push(o);
        break;
      }
      default:
        notes.push(`Skipped "${a.label}": unknown kind.`);
        continue;
    }
    // every feature this action made carries its build year
    for (let k = nFeat; k < features.length; k++) features[k] = { ...features[k], phase, status: 'proposed' };
    for (let k = nObj; k < objects.length; k++) if (objects[k].phase == null) objects[k] = { ...objects[k], phase, status: 'proposed' };
    applied.push(i);
  }
  return { state: { heights, objects, features }, applied, notes };
}

// ---------------------------------------------------------------- what the AI is told about the land

/** A compact text picture of the terrain: a coarse grid of elevation, slope, aspect and wet cells. */
export function terrainBrief(g: Grid, flow?: Float32Array | null, cells = 10) {
  const { slope, aspect } = slopeGrid(g);
  const w = g.n + 1, step = g.size / cells;
  let hmin = Infinity;
  for (const h of g.heights) hmin = Math.min(hmin, h);
  const rows: string[] = [];
  const thresh = flow ? Math.max(40, w * w * 0.003) : Infinity;
  for (let r = 0; r < cells; r++) {
    const cellsTxt: string[] = [];
    for (let c = 0; c < cells; c++) {
      const x = -g.size / 2 + (c + 0.5) * step, y = g.size / 2 - (r + 0.5) * step;
      const gc = Math.round(((x + g.size / 2) / g.size) * g.n), gr = Math.round(((g.size / 2 - y) / g.size) * g.n);
      const i = gr * w + gc;
      const asp = aspect[i] < 0 ? 'flat' : ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(aspect[i] / 45) % 8];
      cellsTxt.push(`${(heightAt(g, x, y) - hmin).toFixed(1)}m/${slope[i].toFixed(0)}%/${asp}${flow && flow[i] >= thresh ? '/wet' : ''}`);
    }
    rows.push(`y=${(g.size / 2 - (r + 0.5) * step).toFixed(0)}: ${cellsTxt.join(' ')}`);
  }
  return { cellM: step, rows, xs: Array.from({ length: cells }, (_, c) => +(-g.size / 2 + (c + 0.5) * step).toFixed(0)) };
}

export const inside = (x: number, y: number, poly: [number, number][]) => pointInPolygon(x, y, poly);
