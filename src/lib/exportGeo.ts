// The design as files other tools open: GeoJSON and KML (QGIS, ArcGIS, Google Earth, county GIS)
// in real longitude and latitude, and DXF (AutoCAD, Vectorworks, SketchUp) in site metres.
// Pure functions so the tests can check the coordinates round-trip.
import type { Feature, SiteObject, Site } from './types.ts';
import { LIBRARY_BY_ID } from './library.ts';

function metresPerDegree(lat: number) {
  const p = (lat * Math.PI) / 180;
  return { lat: 111132.92 - 559.82 * Math.cos(2 * p) + 1.175 * Math.cos(4 * p), lon: 111412.84 * Math.cos(p) - 93.5 * Math.cos(3 * p) };
}

/** Local metres (x east, y north of the centre) to [lon, lat]. */
export function toLonLat(site: Pick<Site, 'lat' | 'lon'>) {
  const m = metresPerDegree(site.lat ?? 0);
  return ([x, y]: [number, number]): [number, number] => [+((site.lon ?? 0) + x / m.lon).toFixed(7), +((site.lat ?? 0) + y / m.lat).toFixed(7)];
}
/** [lon, lat] to local metres. */
export function fromLonLat(site: Pick<Site, 'lat' | 'lon'>) {
  const m = metresPerDegree(site.lat ?? 0);
  return ([lon, lat]: number[]): [number, number] => [+((lon - (site.lon ?? 0)) * m.lon).toFixed(2), +((lat - (site.lat ?? 0)) * m.lat).toFixed(2)];
}

const circle = (x: number, y: number, r: number, n = 24): [number, number][] => Array.from({ length: n + 1 }, (_, i) => [x + Math.cos((i / n) * Math.PI * 2) * r, y + Math.sin((i / n) * Math.PI * 2) * r]);
const rect = (o: SiteObject, w: number, d: number): [number, number][] => {
  const a = ((o.rotation || 0) * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return ([[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2], [-w / 2, -d / 2]] as [number, number][]).map(([u, v]) => [o.x + u * c + v * s, o.y - u * s + v * c]);
};

/** Each element as a shape in local metres, with what a GIS table needs to know about it. */
export function designShapes(objects: SiteObject[], features: Feature[]) {
  const out: { layer: string; name: string; geom: 'Point' | 'LineString' | 'Polygon'; coords: [number, number][]; props: Record<string, any> }[] = [];
  for (const o of objects) {
    const base = { name: o.name, type: o.type, status: o.status || 'proposed', phase: o.phase ?? 1, planted: o.planted || null, notes: o.notes || null };
    if (o.type === 'plant') {
      const sp = LIBRARY_BY_ID[o.species || ''];
      out.push({ layer: 'plants', name: o.name, geom: 'Point', coords: [[o.x, o.y]], props: { ...base, species: sp?.name, latin: sp?.latin, matureHeightM: sp?.heightM, matureSpreadM: sp?.spreadM } });
    } else if (['building', 'greenhouse', 'garden'].includes(o.type)) out.push({ layer: o.type === 'garden' ? 'gardens' : 'structures', name: o.name, geom: 'Polygon', coords: rect(o, (o.width ?? 4) * o.scale, (o.depth ?? 4) * o.scale), props: { ...base, widthM: o.width, lengthM: o.depth, crop: o.crop ? LIBRARY_BY_ID[o.crop]?.name : undefined } });
    else if (o.type === 'pond') out.push({ layer: 'water', name: o.name, geom: 'Polygon', coords: circle(o.x, o.y, o.radius ?? 5), props: { ...base, radiusM: o.radius, depthM: o.depth } });
    else out.push({ layer: o.type === 'tank' || o.type === 'irrigation' ? 'water' : 'structures', name: o.name, geom: 'Point', coords: [[o.x, o.y]], props: { ...base, capacityL: o.capacityL } });
  }
  for (const f of features) {
    const closed = ['zone', 'paddock', 'boundary'].includes(f.kind);
    const props: Record<string, any> = { name: f.name, kind: f.kind, status: f.status || (f.kind === 'boundary' ? 'existing' : 'proposed'), phase: f.phase ?? 1, notes: f.notes || null };
    if (f.kind === 'zone') props.zone = f.zone ?? 1;
    if (f.kind === 'paddock') Object.assign(props, { animal: f.animal, head: f.head });
    if (f.kind === 'sector') Object.assign(props, { sector: f.sector, spreadDeg: f.spread });
    if (f.points.length < 2) continue;
    out.push({ layer: f.kind === 'boundary' ? 'boundary' : `${f.kind}s`, name: f.name, geom: closed && f.points.length >= 3 ? 'Polygon' : 'LineString', coords: closed && f.points.length >= 3 ? [...f.points, f.points[0]] : f.points, props });
  }
  return out;
}

export function toGeoJSON(site: Site, objects: SiteObject[], features: Feature[], name: string) {
  const ll = toLonLat(site);
  return {
    type: 'FeatureCollection', name,
    features: designShapes(objects, features).map((s) => ({
      type: 'Feature', properties: { layer: s.layer, ...s.props },
      geometry: s.geom === 'Point' ? { type: 'Point', coordinates: ll(s.coords[0]) } : s.geom === 'LineString' ? { type: 'LineString', coordinates: s.coords.map(ll) } : { type: 'Polygon', coordinates: [s.coords.map(ll)] },
    })),
  };
}

const esc = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const KML_COLOR: Record<string, string> = { plants: 'ff3c8f5a', structures: 'ffbfd9e9', gardens: 'ff3a5a7a', water: 'ffe8c37c', zones: 'ff0b9ef5', paddocks: 'ff5ca9d4', paths: 'ff8ab0c8', fences: 'ff1a2a3b', swales: 'fff8bd38', berms: 'ff0677d9', keylines: 'fffdc593', sectors: 'ff4ab9f5', boundary: 'ffffffff' };

export function toKML(site: Site, objects: SiteObject[], features: Feature[], name: string) {
  const ll = toLonLat(site);
  const shapes = designShapes(objects, features);
  const layers = [...new Set(shapes.map((s) => s.layer))];
  const coord = (c: [number, number][]) => c.map(ll).map(([x, y]) => `${x},${y},0`).join(' ');
  const styles = layers.map((l) => `<Style id="${l}"><LineStyle><color>${KML_COLOR[l] || 'ffffffff'}</color><width>2</width></LineStyle><PolyStyle><color>${(KML_COLOR[l] || 'ffffffff').replace(/^ff/, '55')}</color></PolyStyle><IconStyle><color>${KML_COLOR[l] || 'ffffffff'}</color><scale>0.6</scale></IconStyle></Style>`).join('');
  const folders = layers.map((l) => `<Folder><name>${esc(l)}</name>${shapes.filter((s) => s.layer === l).map((s) => {
    const desc = Object.entries(s.props).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${esc(k)}: ${esc(v)}`).join('<br/>');
    const g = s.geom === 'Point' ? `<Point><coordinates>${coord(s.coords)}</coordinates></Point>` : s.geom === 'LineString' ? `<LineString><tessellate>1</tessellate><coordinates>${coord(s.coords)}</coordinates></LineString>` : `<Polygon><outerBoundaryIs><LinearRing><coordinates>${coord(s.coords)}</coordinates></LinearRing></outerBoundaryIs></Polygon>`;
    return `<Placemark><name>${esc(s.name)}</name><description><![CDATA[${desc}]]></description><styleUrl>#${l}</styleUrl>${g}</Placemark>`;
  }).join('')}</Folder>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${esc(name)}</name>${styles}${folders}</Document></kml>\n`;
}

/** AutoCAD R12 DXF in site metres (or feet), one layer per kind, so any CAD program opens it. */
export function toDXF(objects: SiteObject[], features: Feature[], units: 'metric' | 'imperial') {
  const k = units === 'imperial' ? 3.28084 : 1;
  const out: string[] = ['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', units === 'imperial' ? '2' : '6', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES'];
  const layerName = (l: string) => l.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  const poly = (layer: string, pts: [number, number][], closed: boolean) => {
    out.push('0', 'POLYLINE', '8', layerName(layer), '66', '1', '70', closed ? '1' : '0');
    for (const [x, y] of pts) out.push('0', 'VERTEX', '8', layerName(layer), '10', (x * k).toFixed(3), '20', (y * k).toFixed(3), '30', '0');
    out.push('0', 'SEQEND', '8', layerName(layer));
  };
  const text = (layer: string, x: number, y: number, t: string, h = 0.6) => out.push('0', 'TEXT', '8', layerName(layer + '_labels'), '10', (x * k).toFixed(3), '20', (y * k).toFixed(3), '30', '0', '40', (h * k).toFixed(2), '1', t.replace(/[\r\n]/g, ' ').slice(0, 120));
  for (const s of designShapes(objects, features)) {
    if (s.geom === 'Point') {
      const [x, y] = s.coords[0];
      const r = s.layer === 'plants' ? Math.max(0.15, (s.props.matureSpreadM ?? 1) / 2) : 0.5;
      out.push('0', 'CIRCLE', '8', layerName(s.layer), '10', (x * k).toFixed(3), '20', (y * k).toFixed(3), '30', '0', '40', (r * k).toFixed(3));
      if (s.layer !== 'plants') text(s.layer, x + r, y, s.name);
    } else {
      poly(s.layer, s.geom === 'Polygon' ? s.coords.slice(0, -1) : s.coords, s.geom === 'Polygon');
      if (['structures', 'zones', 'paddocks', 'water'].includes(s.layer)) { const cx = s.coords.reduce((t, p) => t + p[0], 0) / s.coords.length, cy = s.coords.reduce((t, p) => t + p[1], 0) / s.coords.length; text(s.layer, cx, cy, s.name, 1); }
    }
  }
  out.push('0', 'ENDSEC', '0', 'EOF');
  return out.join('\n') + '\n';
}

/** A property line from a KML or GeoJSON file: the largest polygon in it, in local metres. */
export function boundaryFromFile(text: string, site: Pick<Site, 'lat' | 'lon'>): [number, number][] | null {
  const local = fromLonLat(site);
  const rings: number[][][] = [];
  const t = text.trim();
  if (t.startsWith('{')) {
    const j = JSON.parse(t);
    const walk = (g: any) => {
      if (!g) return;
      if (g.type === 'FeatureCollection') g.features.forEach((f: any) => walk(f.geometry));
      else if (g.type === 'Feature') walk(g.geometry);
      else if (g.type === 'Polygon') rings.push(g.coordinates[0]);
      else if (g.type === 'MultiPolygon') g.coordinates.forEach((p: any) => rings.push(p[0]));
      else if (g.type === 'LineString' && g.coordinates.length >= 4) rings.push(g.coordinates);
      else if (g.type === 'GeometryCollection') g.geometries.forEach(walk);
    };
    walk(j);
  } else {
    const re = /<coordinates>([\s\S]*?)<\/coordinates>/gi;
    let m;
    while ((m = re.exec(t))) { const pts = m[1].trim().split(/\s+/).map((c) => c.split(',').map(Number)).filter((p) => p.length >= 2 && p.every(Number.isFinite)); if (pts.length >= 4) rings.push(pts); }
  }
  if (!rings.length) return null;
  const area = (r: [number, number][]) => Math.abs(r.reduce((s, p, i) => { const q = r[(i + 1) % r.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2);
  const local2 = rings.map((r) => r.map((p) => local(p)));
  const best = local2.sort((a, b) => area(b) - area(a))[0];
  const pts = best.length > 1 && best[0][0] === best[best.length - 1][0] && best[0][1] === best[best.length - 1][1] ? best.slice(0, -1) : best;
  return pts.length >= 3 ? pts : null;
}
