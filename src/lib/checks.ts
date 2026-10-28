// The checks a senior designer runs before a client sees a plan: plants that harm each other,
// plants that escape, and things sited where water, slope or law will cause trouble.
// Pure functions over the design, so the review, the AI critic and the tests share one source.
import type { Feature, Site, SiteObject } from './types.ts';
import { LIBRARY_BY_ID } from './library.ts';
import { polylineLength, pointInPolygon, distanceToPolyline, polygonArea } from './terrain.ts';

/** Which map a siting check was made against; 'site' is the land itself (slope, drainage, property line). */
export type LayerKey = 'flood' | 'wetlands' | 'streams' | 'soils' | 'osm';
export interface Check { level: 'warn' | 'tip'; area: 'plants' | 'siting'; text: string; ids: string[]; layer?: LayerKey | 'site' }

// ---------------------------------------------------------------- plants that harm each other

/**
 * Pairs where one plant hosts a disease of the other, or poisons the soil around it.
 * Distances are how far apart they need to be for the risk to drop off; rust spores travel
 * further, so for those any planting on the same site counts.
 */
export const CONFLICTS: { host: string; hurts: string[]; withinM: number; text: string }[] = [
  { host: 'redcedar', hurts: ['apple', 'quince', 'pear', 'asianpear', 'saskatoon'], withinM: 400, text: 'Eastern red cedar is the alternate host of cedar-apple and cedar-quince rust, which spots the leaves and fruit of {hurts}. Swap the cedar for a non-host windbreak (white pine, hazelnut, Douglas fir) or choose rust-resistant varieties.' },
  { host: 'walnut', hurts: ['tomato', 'potato', 'pepper', 'eggplant', 'tomatillo', 'apple', 'pear', 'asianpear', 'blueberry', 'alfalfa', 'asparagus'], withinM: 20, text: 'Black walnut roots release juglone, which wilts {hurts} within about 60 ft of the trunk. Move them out of its reach.' },
  { host: 'pine', hurts: ['currant', 'gooseberry'], withinM: 400, text: 'Currants and gooseberries host white pine blister rust, which kills eastern white pine. Some states restrict planting them together; use rust-resistant currants or keep them well apart.' },
  { host: 'koreanpine', hurts: ['currant', 'gooseberry'], withinM: 400, text: 'Currants and gooseberries host white pine blister rust, which also attacks Korean pine. Use rust-resistant currant varieties or plant them well apart.' },
];

/** Plants that spread beyond where they are put, or are listed as invasive in parts of the US. */
export const INVASIVE: Record<string, { level: 'warn' | 'tip'; text: string; west?: boolean }> = {
  timberbamboo: { level: 'warn', text: 'Running bamboo spreads by underground runners and is listed invasive in several states. Only plant it inside a deep root barrier, or use clumping bamboo.' },
  mulberry: { level: 'tip', text: 'White mulberry seeds into woods and is listed invasive in several states, where it crosses with native red mulberry. Choose red mulberry or a named fruiting variety, and keep birds from spreading seed into wild land.' },
  peashrub: { level: 'tip', text: 'Siberian pea shrub naturalizes and is listed invasive in parts of the northern Plains and Canada. Keep it trimmed and away from prairie and woodland edges.' },
  seabuckthorn: { level: 'tip', text: 'Sea buckthorn suckers hard and forms thickets where it escapes. It also struggles with hot, humid summers and acid soil.' },
  blacklocust: { level: 'tip', text: 'Black locust suckers widely and is invasive outside its native Appalachian and Ozark range, including much of the West and New England.', west: true },
  alder: { level: 'tip', text: 'European black alder is listed invasive in parts of the Midwest and Northeast. A native alder does the same nitrogen work.' },
  bermuda: { level: 'tip', text: 'Bermudagrass creeps into beds by runners and seed. Keep it out of zones 1 and 2.' },
  mint: { level: 'tip', text: 'Mint takes over a bed by runners. Grow it in a pot or a bed of its own.' },
  sunchoke: { level: 'tip', text: 'Sunchokes come back from every tuber left in the ground. Give them a corner they can have for good.' },
  horseradish: { level: 'tip', text: 'Horseradish regrows from any root piece. Plant it where it can stay.' },
  tagasaste: { level: 'tip', text: 'Tree lucerne is a broom and goes weedy in dry climates. Coppice it hard so it does not set seed.' },
  taro: { level: 'tip', text: 'Wild taro chokes streams and is listed invasive in Florida and Texas waterways. Keep it away from creek banks.' },
};

/** Trees whose roots seek water and break drains and foundations. */
const THIRSTY_ROOTS = ['willow', 'poplar'];

const nameOf = (id: string) => LIBRARY_BY_ID[id]?.name || id;
const list = (xs: string[]) => (xs.length <= 2 ? xs.join(' and ') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

export function plantChecks(objects: SiteObject[], site?: Pick<Site, 'lat' | 'lon'> | null): Check[] {
  const plants = objects.filter((o) => o.type === 'plant' || (o.type === 'garden' && o.crop));
  const sp = (o: SiteObject) => (o.type === 'garden' ? o.crop : o.species) || '';
  const out: Check[] = [];
  for (const c of CONFLICTS) {
    const hosts = plants.filter((o) => sp(o) === c.host);
    if (!hosts.length) continue;
    const victims = plants.filter((o) => c.hurts.includes(sp(o)) && hosts.some((h) => Math.hypot(h.x - o.x, h.y - o.y) <= c.withinM));
    if (!victims.length) continue;
    const kinds = [...new Set(victims.map(sp))].map(nameOf);
    out.push({ level: 'warn', area: 'plants', text: c.text.replace('{hurts}', list(kinds.map((k) => k.toLowerCase()))), ids: [...hosts.map((h) => h.id), ...victims.map((v) => v.id)] });
  }
  const west = site?.lon != null && site.lon < -100;
  const newEngland = site?.lat != null && site.lon != null && site.lat > 41 && site.lon > -75;
  const counted: Record<string, string[]> = {};
  for (const o of plants) { const id = sp(o); if (INVASIVE[id]) (counted[id] ||= []).push(o.id); }
  for (const [id, ids] of Object.entries(counted)) {
    const v = INVASIVE[id];
    if (id === 'blacklocust' && !west && !newEngland) continue; // native range: fine
    if (id === 'alder' && !(site?.lat != null && site.lat > 38 && site.lon != null && site.lon > -100)) continue; // listed in the Midwest and Northeast only
    out.push({ level: v.level, area: 'plants', text: `${ids.length} ${nameOf(id).toLowerCase()}: ${v.text}`, ids });
  }
  return out;
}

// ---------------------------------------------------------------- siting

export interface SitingInput {
  site: Site;
  objects: SiteObject[];
  features: Feature[];
  /** slope in percent at a point */
  slopeAt?: (x: number, y: number) => number;
  /** true where runoff gathers into a drainage line */
  wetAt?: (x: number, y: number) => boolean;
}

const STREAM_BUFFER_M = 15; // 50 ft: the usual minimum for structures and ponds
const MANURE_BUFFER_M = 30; // 100 ft: compost, coops and paddocks
const SEPTIC_ROOT_M = 15;

/** Points every few metres along a line, for slope and crossing checks. */
const sample = (pts: [number, number][], step = 3) => {
  const out: [number, number][] = [];
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    const L = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.ceil(L / step));
    for (let k = 0; k < n; k++) out.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]);
  }
  if (pts.length) out.push(pts[pts.length - 1]);
  return out;
};

function segmentsCross(a: [number, number][], b: [number, number][]) {
  const cross = (p: number[], q: number[], r: number[], s: number[]) => {
    const d = (q[0] - p[0]) * (s[1] - r[1]) - (q[1] - p[1]) * (s[0] - r[0]);
    if (Math.abs(d) < 1e-9) return false;
    const t = ((r[0] - p[0]) * (s[1] - r[1]) - (r[1] - p[1]) * (s[0] - r[0])) / d;
    const u = ((r[0] - p[0]) * (q[1] - p[1]) - (r[1] - p[1]) * (q[0] - p[0])) / d;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1;
  };
  for (let i = 1; i < a.length; i++) for (let j = 1; j < b.length; j++) if (cross(a[i - 1], a[i], b[j - 1], b[j])) return true;
  return false;
}

/** Streams from the national map, or OpenStreetMap's waterways when that service was down. */
export function streamLines(site: Site): { name: string; line: [number, number][] }[] {
  const s = site.surroundings;
  if (!s) return [];
  const nhd = (s.streams || []).map((x) => ({ name: x.name || 'the stream', line: x.line }));
  if (nhd.length) return nhd;
  return (s.osm?.water || []).filter((w) => w.line && ['stream', 'river', 'canal', 'ditch', 'brook'].includes(w.kind)).map((w) => ({ name: w.name || `the ${w.kind}`, line: w.line! }));
}

/** Why a spot is no place to build or dig, or null: flood area, wetland, stream buffer, road, or outside the property line. */
export function groundProblem(site: Site, features: Feature[], x: number, y: number): string | null {
  const s = site.surroundings;
  if ((s?.flood || []).some((z) => z.sfha && pointInPolygon(x, y, z.ring))) return 'flood area';
  if ((s?.wetlands || []).some((w) => pointInPolygon(x, y, w.ring))) return 'wetland';
  if (streamLines(site).some((st) => distanceToPolyline(x, y, st.line) < STREAM_BUFFER_M)) return 'stream buffer';
  const road = (s?.osm?.roads || []).find((r) => distanceToPolyline(x, y, r.line) < roadHalfWidth(r) + 2);
  if (road) return roadWord(road);
  if ((s?.osm?.areas || []).some((a) => a.kind === 'parking' && pointInPolygon(x, y, a.ring))) return 'parking';
  if ((s?.osm?.buildings || []).some((b) => pointInPolygon(x, y, b.ring))) return 'existing building';
  const boundary = features.find((f) => f.kind === 'boundary');
  if (boundary && !pointInPolygon(x, y, boundary.points)) return 'outside the property line';
  return null;
}

/** Mean slope along a line, sampled every few metres. */
export const lineSlope = (pts: [number, number][], slopeAt: (x: number, y: number) => number) => {
  const ps = sample(pts, 4);
  return ps.reduce((t, p) => t + slopeAt(p[0], p[1]), 0) / Math.max(1, ps.length);
};

export function sitingChecks(d: SitingInput): Check[] {
  const out: Check[] = [];
  const proposed = (o: { status?: string }) => o.status !== 'existing';
  const s = d.site.surroundings;
  const label = (o: SiteObject) => o.name;

  // swales belong on gentle to moderate ground; on steep slopes they slump and can blow out
  if (d.slopeAt) for (const f of d.features.filter((f) => f.kind === 'swale' && proposed(f))) {
    const mean = lineSlope(f.points, d.slopeAt);
    if (mean > 20) out.push({ layer: 'site', level: 'warn', area: 'siting', text: `${f.name} sits on a ${mean.toFixed(0)}% slope. Swales on ground this steep slump and can blow out in a big storm. Use terraces, a narrow-based swale with a planted berm, or move it to gentler ground below.`, ids: [f.id] });
    else if (mean > 15) out.push({ layer: 'site', level: 'tip', area: 'siting', text: `${f.name} is on a ${mean.toFixed(0)}% slope, near the upper limit for swales. Keep it small, plant the berm at once, and give it a level spillway.`, ids: [f.id] });
  }
  if (d.slopeAt) for (const o of d.objects.filter((o) => ['building', 'greenhouse'].includes(o.type) && proposed(o))) {
    const sl = d.slopeAt(o.x, o.y);
    if (sl > 15) out.push({ layer: 'site', level: 'tip', area: 'siting', text: `${label(o)} stands on a ${sl.toFixed(0)}% slope. Expect cut and fill for a level pad, and plan where its runoff goes.`, ids: [o.id] });
  }

  // earthworks dug across a road or driveway
  const roads = s?.osm?.roads || [];
  for (const f of d.features.filter((f) => ['swale', 'berm', 'keyline'].includes(f.kind) && proposed(f))) {
    const road = roads.find((r) => segmentsCross(f.points, r.line));
    if (road && f.kind !== 'keyline') out.push({ layer: 'osm', level: 'warn', area: 'siting', text: `${f.name} crosses ${road.name || `the ${road.kind === 'service' ? 'driveway' : 'road'}`}. A swale there cuts access and sends water down the road. Stop it short and put a culvert or a rolling dip at the crossing.`, ids: [f.id] });
  }
  // anything built or dug over the roads, paths, parking, buildings or woods already on the map
  out.push(...overlapChecks(d));

  // streams: buffers for anything built, dug or manured
  const streams = streamLines(d.site);
  if (streams.length) {
    const near = (x: number, y: number) => Math.min(...streams.map((st) => distanceToPolyline(x, y, st.line)));
    for (const o of d.objects.filter(proposed)) {
      const dist = near(o.x, o.y);
      const manure = ['compost', 'coop'].includes(o.type);
      const built = ['building', 'greenhouse', 'tank', 'pond', 'hive'].includes(o.type);
      if (manure && dist < MANURE_BUFFER_M) out.push({ layer: 'streams', level: 'warn', area: 'siting', text: `${label(o)} is ${Math.round(dist * 3.28)} ft from the stream. Keep compost and animal housing at least 100 ft (30 m) back so nutrients do not wash in.`, ids: [o.id] });
      else if (built && dist < STREAM_BUFFER_M) out.push({ layer: 'streams', level: 'warn', area: 'siting', text: `${label(o)} is ${Math.round(dist * 3.28)} ft from the stream. Most counties want at least 50 ft (15 m) of undisturbed buffer, and banks move in floods.`, ids: [o.id] });
    }
    for (const f of d.features.filter((f) => f.kind === 'paddock' && proposed(f))) {
      const inside = streams.some((st) => st.line.some((p) => pointInPolygon(p[0], p[1], f.points)));
      const dist = Math.min(...f.points.map((p) => near(p[0], p[1])));
      if (inside || dist < MANURE_BUFFER_M / 2) out.push({ layer: 'streams', level: 'warn', area: 'siting', text: `${f.name} ${inside ? 'takes in the stream' : 'runs down to the stream'}. Fence livestock out of the stream and its banks (NRCS asks for a planted buffer of 35 ft or more) and give them a trough instead.`, ids: [f.id] });
    }
  }

  // FEMA flood areas and wetlands
  const flood = (s?.flood || []).filter((z) => z.sfha);
  const inFlood = (x: number, y: number) => flood.find((z) => pointInPolygon(x, y, z.ring));
  for (const o of d.objects.filter(proposed)) {
    const z = inFlood(o.x, o.y);
    if (!z) continue;
    if (['building', 'greenhouse', 'tank', 'coop', 'hive', 'compost'].includes(o.type)) out.push({ layer: 'flood', level: 'warn', area: 'siting', text: `${label(o)} is inside the mapped ${z.label.split(':')[0]} flood area${z.floodway ? ', in the floodway itself' : ''}. Building here usually needs a county floodplain permit, and floodwater will reach it. Move it above the flood line.`, ids: [o.id] });
    else if (o.type === 'pond') out.push({ layer: 'flood', level: 'tip', area: 'siting', text: `${label(o)} is in the mapped flood area. Digging there usually needs a floodplain permit, and a flood will silt it up. Keep the spoil out of the flood area.`, ids: [o.id] });
  }
  for (const f of d.features.filter((f) => ['swale', 'berm'].includes(f.kind) && proposed(f))) {
    const hit = flood.find((z) => f.points.some((p) => pointInPolygon(p[0], p[1], z.ring)));
    if (hit) out.push({ layer: 'flood', level: 'tip', area: 'siting', text: `${f.name} reaches into the mapped flood area. Fill or berms there can need a floodplain permit because they push floodwater onto neighbours.`, ids: [f.id] });
  }
  for (const w of s?.wetlands || []) {
    const hits = d.objects.filter((o) => proposed(o) && ['building', 'greenhouse', 'pond', 'tank', 'coop', 'compost'].includes(o.type) && pointInPolygon(o.x, o.y, w.ring));
    if (hits.length) out.push({ layer: 'wetlands', level: 'warn', area: 'siting', text: `${list(hits.map(label))} ${hits.length > 1 ? 'are' : 'is'} inside a mapped ${w.type.toLowerCase()} wetland. Filling or digging wetlands needs a federal permit (Clean Water Act section 404). Check with the county before any work.`, ids: hits.map((h) => h.id) });
  }

  // drainage lines
  if (d.wetAt) for (const o of d.objects.filter((o) => proposed(o) && ['building', 'greenhouse', 'coop'].includes(o.type))) {
    if (d.wetAt(o.x, o.y)) out.push({ layer: 'site', level: 'warn', area: 'siting', text: `${label(o)} sits on a natural drainage line. Runoff will pond against it or run under it. Shift it to the side, or plan a diversion swale above it.`, ids: [o.id] });
  }

  // thirsty roots near buildings, the boundary, and the soil map
  const buildings = d.objects.filter((o) => o.type === 'building');
  for (const o of d.objects.filter((o) => o.type === 'plant' && THIRSTY_ROOTS.includes(o.species || '') && proposed(o))) {
    const b = buildings.find((b) => Math.hypot(b.x - o.x, b.y - o.y) < SEPTIC_ROOT_M);
    if (b) { out.push({ layer: 'site', level: 'tip', area: 'siting', text: `${label(o)} is within 50 ft of ${b.name}. Willow and poplar roots hunt for water and break drains, septic lines and foundations.`, ids: [o.id] }); break; }
  }
  const boundary = d.features.find((f) => f.kind === 'boundary' && f.points.length >= 3);
  if (boundary) {
    const outside = [...d.objects.filter((o) => proposed(o) && !pointInPolygon(o.x, o.y, boundary.points)), ...d.features.filter((f) => proposed(f) && !['sector', 'boundary'].includes(f.kind) && f.points.some((p) => !pointInPolygon(p[0], p[1], boundary.points)))];
    if (outside.length) out.push({ layer: 'site', level: 'warn', area: 'siting', text: `${outside.length} thing${outside.length > 1 ? 's' : ''} in the design ${outside.length > 1 ? 'are' : 'is'} outside the property line, for example ${outside[0].name}.`, ids: outside.map((x) => x.id) });
  }
  const soils = s?.soils || [];
  const wetSoil = (x: number, y: number) => soils.find((u) => /poorly/i.test(u.drainage || '') && !/moderately/i.test(u.drainage || '') && u.rings.some((r) => pointInPolygon(x, y, r)));
  for (const o of d.objects.filter((o) => proposed(o) && ['building', 'greenhouse'].includes(o.type))) {
    const u = wetSoil(o.x, o.y);
    if (u) out.push({ layer: 'soils', level: 'tip', area: 'siting', text: `${label(o)} is on ${u.name.split(',')[0]}, mapped as ${u.drainage!.toLowerCase()}. Expect a high water table: raise the floor and drain around it.`, ids: [o.id] });
  }
  return out;
}

// ---------------------------------------------------------------- what is already on the ground

type Road = NonNullable<NonNullable<Site['surroundings']>['osm']>['roads'][number];
const FOOT = ['footway', 'path', 'pedestrian', 'steps', 'cycleway', 'bridleway', 'corridor'];
/** Half the width of a mapped road or path in metres: how close counts as on it. */
export const roadHalfWidth = (r: Pick<Road, 'kind'>) =>
  FOOT.includes(r.kind) ? 1 : r.kind === 'track' ? 2 : ['motorway', 'trunk', 'primary'].includes(r.kind) ? 6 : ['secondary', 'tertiary'].includes(r.kind) ? 4.5 : 3;
/** What a person calls it: "the footpath", "the parking aisle", "the driveway", "Main Street". */
export function roadWord(r: Pick<Road, 'kind' | 'name'> & { service?: string | null }) {
  if (FOOT.includes(r.kind)) return r.name ? `the ${r.name} path` : r.kind === 'cycleway' ? 'a mapped bike path' : r.kind === 'steps' ? 'mapped steps' : 'a mapped footpath';
  if (r.kind === 'service' && r.service === 'parking_aisle') return 'a parking lot aisle';
  if (r.name) return r.name;
  if (r.kind === 'service') return r.service === 'driveway' || !r.service ? 'a driveway' : 'a service road';
  if (r.kind === 'track') return 'a farm track';
  return 'a mapped road';
}

/** The ground a proposed object covers: its rotated rectangle, or a circle for ponds and tanks. */
export function footprintRing(o: SiteObject): [number, number][] {
  const round = o.type === 'pond' || o.type === 'tank' || o.type === 'hive';
  if (round) {
    const r = o.type === 'pond' ? (o.radius ?? 5) * o.scale : o.type === 'hive' ? 0.5 : Math.max(0.8, Math.sqrt((o.capacityL ?? 10000) / 1000 / 2 / Math.PI)) * o.scale;
    return Array.from({ length: 16 }, (_, k) => [o.x + r * Math.cos((k / 16) * 2 * Math.PI), o.y + r * Math.sin((k / 16) * 2 * Math.PI)] as [number, number]);
  }
  const dflt: Record<string, [number, number]> = { building: [6, 8], greenhouse: [4, 8], garden: [1.2, 4], coop: [2.4, 1.8], compost: [3, 1.5], irrigation: [1, 1] };
  const [dw, dd] = dflt[o.type] || [2, 2];
  const w = (o.width ?? dw) * o.scale, d = (o.depth ?? dd) * o.scale;
  const a = ((o.rotation || 0) * Math.PI) / 180, c = Math.cos(a), sn = Math.sin(a);
  return ([[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]] as [number, number][]).map(([u, v]) => [o.x + u * c + v * sn, o.y - u * sn + v * c]);
}

/** Points spread over a polygon (a grid inside it plus its corners and edges), each standing for about step x step of ground. */
function samplePolygon(ring: [number, number][], step: number): [number, number][] {
  const xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1]);
  const out: [number, number][] = [];
  for (let x = Math.min(...xs) + step / 2; x < Math.max(...xs); x += step) for (let y = Math.min(...ys) + step / 2; y < Math.max(...ys); y += step) if (pointInPolygon(x, y, ring)) out.push([x, y]);
  return out;
}

const STRUCTURES = ['building', 'greenhouse', 'pond', 'tank', 'coop', 'compost', 'hive'];
const fmtM2 = (m2: number) => `about ${Math.max(10, Math.round((m2 * 10.764) / 10) * 10).toLocaleString()} sq ft`;

/**
 * Proposed things put on top of what OpenStreetMap shows is already there: roads, driveways,
 * footpaths, parking lots and buildings (a real problem), and woodland (a soft warning: trees would
 * have to come down). Zones are plans for use, not things built, so only parking and woodland
 * inside zones 1 to 3 are mentioned. Existing things in the design are never judged.
 */
export function overlapChecks(d: Pick<SitingInput, 'site' | 'objects' | 'features'>): Check[] {
  const osm = d.site.surroundings?.osm;
  if (!osm) return [];
  const out: Check[] = [];
  const roads = osm.roads || [], buildings = osm.buildings || [];
  const parking = (osm.areas || []).filter((a) => a.kind === 'parking'), woods = (osm.areas || []).filter((a) => a.kind === 'woodland');
  const proposed = (x: { status?: string }) => x.status !== 'existing';
  type Hit = { what: string; m2: number; hard: boolean; foot: boolean };
  const hitsOn = (pts: [number, number][], cell: number, skip: { buildings?: boolean; roads?: boolean } = {}) => {
    const found: Record<string, Hit> = {};
    const add = (key: string, what: string, hard: boolean, foot = false) => { (found[key] ||= { what, m2: 0, hard, foot }).m2 += cell; };
    for (const [x, y] of pts) {
      if (!skip.roads) { const r = roads.find((r) => distanceToPolyline(x, y, r.line) < roadHalfWidth(r)); if (r) add('road:' + roadWord(r), roadWord(r), true, FOOT.includes(r.kind)); }
      const p = parking.find((a) => pointInPolygon(x, y, a.ring)); if (p) add('parking', p.name ? `the ${p.name} parking lot` : 'a mapped parking lot', true);
      if (!skip.buildings) { const b = buildings.find((b) => pointInPolygon(x, y, b.ring)); if (b) add('building', b.name ? `the existing ${b.name}` : `an existing ${b.kind === 'building' ? 'building' : b.kind}`, true); }
      const w = woods.find((a) => pointInPolygon(x, y, a.ring)); if (w) add('wood', w.name ? `${w.name} woodland` : 'mapped woodland', false);
    }
    return Object.values(found);
  };
  const words = (hs: Hit[]) => list(hs.map((h) => h.what));

  for (const o of d.objects.filter((o) => proposed(o) && (STRUCTURES.includes(o.type) || o.type === 'garden'))) {
    const ring = footprintRing(o);
    const area = Math.max(0.25, polygonArea(ring));
    const step = Math.max(0.4, Math.min(1, Math.sqrt(area) / 6));
    const pts = [...samplePolygon(ring, step), [o.x, o.y] as [number, number], ...ring];
    const hs = hitsOn(pts, step * step);
    const hard = hs.filter((h) => h.hard), soft = hs.filter((h) => !h.hard);
    const built = STRUCTURES.includes(o.type);
    if (hard.length) {
      const onlyPaths = hard.every((h) => h.foot);
      out.push({ layer: 'osm', level: built || !onlyPaths ? 'warn' : 'tip', area: 'siting', ids: [o.id], text: `${o.name} is drawn on top of ${words(hard)}, which the map shows is already there. ${built ? 'Move it clear, or note in the plan that the existing surface or building comes out first.' : 'Move the bed, or reroute the path and note it in the plan.'}` });
    }
    if (soft.length) out.push({ layer: 'osm', level: 'tip', area: 'siting', ids: [o.id], text: `${o.name} takes in ${fmtM2(soft.reduce((t, h) => t + h.m2, 0))} of ${words(soft)}. Trees would have to be cleared: check that is wanted, and whether the county needs a tree permit.` });
  }

  for (const f of d.features.filter((f) => proposed(f) && f.points.length >= 3 && (f.kind === 'paddock' || (f.kind === 'zone' && (f.zone ?? 1) <= 3)))) {
    const area = polygonArea(f.points);
    if (area < 4) continue;
    const step = Math.max(1, Math.min(3, Math.sqrt(area) / 12));
    const isZone = f.kind === 'zone';
    const hs = hitsOn(samplePolygon(f.points, step), step * step, { buildings: isZone, roads: isZone })
      .filter((h) => h.m2 >= Math.max(isZone ? 40 : 15, area * 0.05));
    const hard = hs.filter((h) => h.hard), soft = hs.filter((h) => !h.hard);
    const what = isZone ? `${f.name} (zone ${f.zone ?? 1})` : f.name;
    if (hard.length) out.push({ layer: 'osm', level: 'tip', area: 'siting', ids: [f.id], text: `${what} takes in ${list(hard.map((h) => `${fmtM2(h.m2)} of ${h.what}`))}. ${isZone ? 'Is the parking staying? If not, say so in the plan; if it is, draw the zone around it.' : 'Animals and fencing cannot go there: fence it out or move the paddock.'}` });
    if (soft.length) out.push({ layer: 'osm', level: 'tip', area: 'siting', ids: [f.id], text: `${what} takes in ${list(soft.map((h) => `${fmtM2(h.m2)} of ${h.what}`))}. ${isZone ? 'Using it as a busy zone means clearing trees: check that is wanted, or keep the woods as zone 4 or 5.' : 'Animals in woodland strip the young growth: decide if that is the plan.'}` });
  }
  return out;
}

// ---------------------------------------------------------------- which public maps were really checked

export const LAYER_NAMES: Record<LayerKey, string> = {
  flood: 'the FEMA flood map', wetlands: 'the wetlands map', streams: 'the stream map', soils: 'the soil map', osm: 'the map of roads, paths, parking and buildings',
};

/** For each public map: did it load, so a check against it means something? */
export function layerStatus(site: Site): { key: LayerKey; name: string; loaded: boolean; error: string | null; note?: string }[] {
  const s = site.surroundings;
  return (Object.keys(LAYER_NAMES) as LayerKey[]).map((key) => {
    const error = s?.errors?.[key] || null;
    let loaded = !!s && s[key] != null && !error;
    let note: string | undefined;
    if (key === 'streams' && !loaded && s?.osm && !s.errors?.osm) { loaded = true; note = 'the national stream map did not load, so OpenStreetMap waterways stood in'; }
    return { key, name: LAYER_NAMES[key], loaded, error: s ? error || (loaded ? null : 'not loaded') : 'not loaded', note };
  });
}

/**
 * The flood facts as a client should read them. A FEMA flood area that only touches the edge of
 * the square (clipped down to a sliver of no area) is "nearby", never "on the site".
 */
export function floodOnSite(site: Site) {
  const s = site.surroundings;
  if (!s || !s.flood || s.errors?.flood) return null;
  const sfha = s.flood.filter((z) => z.sfha);
  const on = sfha.filter((z) => polygonArea(z.ring) >= 1);
  const name = (z: { label: string }) => z.label.split(':')[0];
  const onNames = [...new Set(on.map(name))];
  return {
    areaM2: on.reduce((t, z) => t + polygonArea(z.ring), 0),
    onLabels: [...new Set(on.map((z) => z.label))],
    onNames,
    nearNames: [...new Set(sfha.filter((z) => !on.includes(z)).map(name))].filter((n) => !onNames.includes(n)),
  };
}

/** Plain-language summary of what the land holds, for the AI's context and the report. */
export function surroundingsBrief(site: Site) {
  const s = site.surroundings;
  if (!s) return null;
  return {
    floodAreas: (s.flood || []).map((z) => ({ label: z.label, sfha: z.sfha, corners: z.ring.length > 12 ? undefined : z.ring.map((p) => p.map(Math.round)), centre: centre(z.ring) })),
    wetlands: (s.wetlands || []).map((w) => ({ type: w.type, centre: centre(w.ring) })),
    streams: streamLines(site).map((x) => ({ name: x.name, lengthM: Math.round(polylineLength(x.line)), points: thin(x.line, 8) })),
    roads: (s.osm?.roads || []).map((r) => ({ kind: r.kind, service: r.service || undefined, name: r.name, points: thin(r.line, 6) })),
    buildings: (s.osm?.buildings || []).map((b) => ({ kind: b.kind, centre: centre(b.ring), corners: b.ring.length > 10 ? undefined : b.ring.map((p) => p.map(Math.round)) })),
    parkingAndWoods: (s.osm?.areas || []).map((a) => ({ kind: a.kind, name: a.name, centre: centre(a.ring), corners: a.ring.length > 12 ? undefined : a.ring.map((p) => p.map(Math.round)) })),
    notLoaded: layerStatus(site).filter((l) => !l.loaded).map((l) => `${l.name} did not load, so nothing was checked against it`),
    soils: (s.soils || []).map((u) => ({ name: u.name, sharePct: Math.round(u.share * 100), drainage: u.drainage, flooding: u.flooding, pH: u.pH, centre: centre(u.rings[0] || []) })),
  };
}
const centre = (ring: [number, number][]) => (ring.length ? [Math.round(ring.reduce((t, p) => t + p[0], 0) / ring.length), Math.round(ring.reduce((t, p) => t + p[1], 0) / ring.length)] : null);
const thin = (line: [number, number][], n: number) => {
  if (line.length <= n) return line.map((p) => p.map(Math.round));
  return Array.from({ length: n }, (_, i) => line[Math.round((i / (n - 1)) * (line.length - 1))].map(Math.round));
};
