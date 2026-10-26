// The checks a senior designer runs before a client sees a plan: plants that harm each other,
// plants that escape, and things sited where water, slope or law will cause trouble.
// Pure functions over the design, so the review, the AI critic and the tests share one source.
import type { Feature, Site, SiteObject } from './types.ts';
import { LIBRARY_BY_ID } from './library.ts';
import { polylineLength, pointInPolygon, distanceToPolyline } from './terrain.ts';

export interface Check { level: 'warn' | 'tip'; area: 'plants' | 'siting'; text: string; ids: string[] }

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

export function sitingChecks(d: SitingInput): Check[] {
  const out: Check[] = [];
  const proposed = (o: { status?: string }) => o.status !== 'existing';
  const s = d.site.surroundings;
  const label = (o: SiteObject) => o.name;

  // swales belong on gentle to moderate ground; on steep slopes they slump and can blow out
  if (d.slopeAt) for (const f of d.features.filter((f) => f.kind === 'swale' && proposed(f))) {
    const pts = sample(f.points, 4);
    const mean = pts.reduce((t, p) => t + d.slopeAt!(p[0], p[1]), 0) / Math.max(1, pts.length);
    if (mean > 20) out.push({ level: 'warn', area: 'siting', text: `${f.name} sits on a ${mean.toFixed(0)}% slope. Swales on ground this steep slump and can blow out in a big storm. Use terraces, a narrow-based swale with a planted berm, or move it to gentler ground below.`, ids: [f.id] });
    else if (mean > 15) out.push({ level: 'tip', area: 'siting', text: `${f.name} is on a ${mean.toFixed(0)}% slope, near the upper limit for swales. Keep it small, plant the berm at once, and give it a level spillway.`, ids: [f.id] });
  }
  if (d.slopeAt) for (const o of d.objects.filter((o) => ['building', 'greenhouse'].includes(o.type) && proposed(o))) {
    const sl = d.slopeAt(o.x, o.y);
    if (sl > 15) out.push({ level: 'tip', area: 'siting', text: `${label(o)} stands on a ${sl.toFixed(0)}% slope. Expect cut and fill for a level pad, and plan where its runoff goes.`, ids: [o.id] });
  }

  // earthworks dug across a road or driveway
  const roads = s?.osm?.roads || [];
  for (const f of d.features.filter((f) => ['swale', 'berm', 'keyline'].includes(f.kind) && proposed(f))) {
    const road = roads.find((r) => segmentsCross(f.points, r.line));
    if (road && f.kind !== 'keyline') out.push({ level: 'warn', area: 'siting', text: `${f.name} crosses ${road.name || `the ${road.kind === 'service' ? 'driveway' : 'road'}`}. A swale there cuts access and sends water down the road. Stop it short and put a culvert or a rolling dip at the crossing.`, ids: [f.id] });
  }
  for (const o of d.objects.filter((o) => o.type === 'pond' && proposed(o))) {
    const road = roads.find((r) => distanceToPolyline(o.x, o.y, r.line) < (o.radius ?? 5) + 2);
    if (road) out.push({ level: 'warn', area: 'siting', text: `${label(o)} overlaps ${road.name || 'a road'}. Move it clear of the road and its ditch.`, ids: [o.id] });
  }

  // streams: buffers for anything built, dug or manured
  const streams = streamLines(d.site);
  if (streams.length) {
    const near = (x: number, y: number) => Math.min(...streams.map((st) => distanceToPolyline(x, y, st.line)));
    for (const o of d.objects.filter(proposed)) {
      const dist = near(o.x, o.y);
      const manure = ['compost', 'coop'].includes(o.type);
      const built = ['building', 'greenhouse', 'tank', 'pond', 'hive'].includes(o.type);
      if (manure && dist < MANURE_BUFFER_M) out.push({ level: 'warn', area: 'siting', text: `${label(o)} is ${Math.round(dist * 3.28)} ft from the stream. Keep compost and animal housing at least 100 ft (30 m) back so nutrients do not wash in.`, ids: [o.id] });
      else if (built && dist < STREAM_BUFFER_M) out.push({ level: 'warn', area: 'siting', text: `${label(o)} is ${Math.round(dist * 3.28)} ft from the stream. Most counties want at least 50 ft (15 m) of undisturbed buffer, and banks move in floods.`, ids: [o.id] });
    }
    for (const f of d.features.filter((f) => f.kind === 'paddock' && proposed(f))) {
      const inside = streams.some((st) => st.line.some((p) => pointInPolygon(p[0], p[1], f.points)));
      const dist = Math.min(...f.points.map((p) => near(p[0], p[1])));
      if (inside || dist < MANURE_BUFFER_M / 2) out.push({ level: 'warn', area: 'siting', text: `${f.name} ${inside ? 'takes in the stream' : 'runs down to the stream'}. Fence livestock out of the stream and its banks (NRCS asks for a planted buffer of 35 ft or more) and give them a trough instead.`, ids: [f.id] });
    }
  }

  // FEMA flood areas and wetlands
  const flood = (s?.flood || []).filter((z) => z.sfha);
  const inFlood = (x: number, y: number) => flood.find((z) => pointInPolygon(x, y, z.ring));
  for (const o of d.objects.filter(proposed)) {
    const z = inFlood(o.x, o.y);
    if (!z) continue;
    if (['building', 'greenhouse', 'tank', 'coop', 'hive', 'compost'].includes(o.type)) out.push({ level: 'warn', area: 'siting', text: `${label(o)} is inside the mapped ${z.label.split(':')[0]} flood area${z.floodway ? ', in the floodway itself' : ''}. Building here usually needs a county floodplain permit, and floodwater will reach it. Move it above the flood line.`, ids: [o.id] });
    else if (o.type === 'pond') out.push({ level: 'tip', area: 'siting', text: `${label(o)} is in the mapped flood area. Digging there usually needs a floodplain permit, and a flood will silt it up. Keep the spoil out of the flood area.`, ids: [o.id] });
  }
  for (const f of d.features.filter((f) => ['swale', 'berm'].includes(f.kind) && proposed(f))) {
    const hit = flood.find((z) => f.points.some((p) => pointInPolygon(p[0], p[1], z.ring)));
    if (hit) out.push({ level: 'tip', area: 'siting', text: `${f.name} reaches into the mapped flood area. Fill or berms there can need a floodplain permit because they push floodwater onto neighbours.`, ids: [f.id] });
  }
  for (const w of s?.wetlands || []) {
    const hits = d.objects.filter((o) => proposed(o) && ['building', 'greenhouse', 'pond', 'tank', 'coop', 'compost'].includes(o.type) && pointInPolygon(o.x, o.y, w.ring));
    if (hits.length) out.push({ level: 'warn', area: 'siting', text: `${list(hits.map(label))} ${hits.length > 1 ? 'are' : 'is'} inside a mapped ${w.type.toLowerCase()} wetland. Filling or digging wetlands needs a federal permit (Clean Water Act section 404). Check with the county before any work.`, ids: hits.map((h) => h.id) });
  }

  // drainage lines
  if (d.wetAt) for (const o of d.objects.filter((o) => proposed(o) && ['building', 'greenhouse', 'coop'].includes(o.type))) {
    if (d.wetAt(o.x, o.y)) out.push({ level: 'warn', area: 'siting', text: `${label(o)} sits on a natural drainage line. Runoff will pond against it or run under it. Shift it to the side, or plan a diversion swale above it.`, ids: [o.id] });
  }

  // thirsty roots near buildings, the boundary, and the soil map
  const buildings = d.objects.filter((o) => o.type === 'building');
  for (const o of d.objects.filter((o) => o.type === 'plant' && THIRSTY_ROOTS.includes(o.species || '') && proposed(o))) {
    const b = buildings.find((b) => Math.hypot(b.x - o.x, b.y - o.y) < SEPTIC_ROOT_M);
    if (b) { out.push({ level: 'tip', area: 'siting', text: `${label(o)} is within 50 ft of ${b.name}. Willow and poplar roots hunt for water and break drains, septic lines and foundations.`, ids: [o.id] }); break; }
  }
  const boundary = d.features.find((f) => f.kind === 'boundary' && f.points.length >= 3);
  if (boundary) {
    const outside = [...d.objects.filter((o) => proposed(o) && !pointInPolygon(o.x, o.y, boundary.points)), ...d.features.filter((f) => proposed(f) && !['sector', 'boundary'].includes(f.kind) && f.points.some((p) => !pointInPolygon(p[0], p[1], boundary.points)))];
    if (outside.length) out.push({ level: 'warn', area: 'siting', text: `${outside.length} thing${outside.length > 1 ? 's' : ''} in the design ${outside.length > 1 ? 'are' : 'is'} outside the property line, for example ${outside[0].name}.`, ids: outside.map((x) => x.id) });
  }
  const soils = s?.soils || [];
  const wetSoil = (x: number, y: number) => soils.find((u) => /poorly/i.test(u.drainage || '') && !/moderately/i.test(u.drainage || '') && u.rings.some((r) => pointInPolygon(x, y, r)));
  for (const o of d.objects.filter((o) => proposed(o) && ['building', 'greenhouse'].includes(o.type))) {
    const u = wetSoil(o.x, o.y);
    if (u) out.push({ level: 'tip', area: 'siting', text: `${label(o)} is on ${u.name.split(',')[0]}, mapped as ${u.drainage!.toLowerCase()}. Expect a high water table: raise the floor and drain around it.`, ids: [o.id] });
  }
  return out;
}

/** Plain-language summary of what the land holds, for the AI's context and the report. */
export function surroundingsBrief(site: Site) {
  const s = site.surroundings;
  if (!s) return null;
  return {
    floodAreas: (s.flood || []).map((z) => ({ label: z.label, sfha: z.sfha, corners: z.ring.length > 12 ? undefined : z.ring.map((p) => p.map(Math.round)), centre: centre(z.ring) })),
    wetlands: (s.wetlands || []).map((w) => ({ type: w.type, centre: centre(w.ring) })),
    streams: streamLines(site).map((x) => ({ name: x.name, lengthM: Math.round(polylineLength(x.line)), points: thin(x.line, 8) })),
    roads: (s.osm?.roads || []).map((r) => ({ kind: r.kind, name: r.name, points: thin(r.line, 6) })),
    buildings: (s.osm?.buildings || []).map((b) => ({ kind: b.kind, centre: centre(b.ring) })),
    soils: (s.soils || []).map((u) => ({ name: u.name, sharePct: Math.round(u.share * 100), drainage: u.drainage, flooding: u.flooding, pH: u.pH, centre: centre(u.rings[0] || []) })),
  };
}
const centre = (ring: [number, number][]) => (ring.length ? [Math.round(ring.reduce((t, p) => t + p[0], 0) / ring.length), Math.round(ring.reduce((t, p) => t + p[1], 0) / ring.length)] : null);
const thin = (line: [number, number][], n: number) => {
  if (line.length <= n) return line.map((p) => p.map(Math.round));
  return Array.from({ length: n }, (_, i) => line[Math.round((i / (n - 1)) * (line.length - 1))].map(Math.round));
};
