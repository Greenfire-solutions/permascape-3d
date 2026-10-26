// Every outside data source the app uses, with a disk cache in front of each.
// All are free and need no key: OpenStreetMap Nominatim and Overpass, the US Census geocoder,
// USGS 3DEP and National Hydrography, AWS Terrain Tiles, Esri World Imagery, Open-Meteo,
// FEMA flood maps, the US Fish and Wildlife wetlands inventory and USDA Soil Data Access.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { PNG } from 'pngjs';
import { siteGrid, lonLatToPixel, decodeTerrarium, readFloatTiff, bilinear, summariseClimateV2, parseFlood, parseWetlands, parseStreams, parseOsm, wktRings, toLocal, clipRing } from './geo.mjs';

const UA = 'Permascape3D/1.0 (local permaculture design app)';

export function makeSources(cacheDir) {
  fs.mkdirSync(cacheDir, { recursive: true });

  const cachePath = (kind, key, ext) => {
    const h = crypto.createHash('sha1').update(key).digest('hex');
    const dir = path.join(cacheDir, kind, h.slice(0, 2));
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, h + ext);
  };

  async function cachedJson(kind, key, fetcher) {
    const p = cachePath(kind, key, '.json');
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
    const v = await fetcher();
    fs.writeFileSync(p, JSON.stringify(v));
    return v;
  }

  async function cachedBytes(kind, key, url, timeout = 30000) {
    const p = cachePath(kind, key, '.bin');
    if (fs.existsSync(p)) return fs.readFileSync(p);
    const r = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(timeout) });
    if (!r.ok) throw new Error(`${kind} ${r.status}`);
    const b = Buffer.from(await r.arrayBuffer());
    fs.writeFileSync(p, b);
    return b;
  }

  // Nominatim asks for at most one request a second from one app.
  let lastNominatim = 0;
  async function nominatim(url) {
    const wait = lastNominatim + 1100 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastNominatim = Date.now();
    const r = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'en' }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`geocoder answered ${r.status}`);
    return r.json();
  }

  async function geocode(q) {
    const coords = parseCoordinates(q);
    if (coords) {
      return [{ lat: coords[0], lon: coords[1], label: `${coords[0].toFixed(5)}, ${coords[1].toFixed(5)}`, kind: 'coordinates' }];
    }
    return cachedJson('geocode2', q.trim().toLowerCase(), async () => {
      // a street address with a house number: the Census geocoder knows US rural addresses
      // that OpenStreetMap does not, so it goes first and OpenStreetMap fills in the rest
      const census = /^\s*\d+\s+\S/.test(q) ? await censusGeocode(q).catch(() => []) : [];
      const rows = await nominatim(`https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=6&q=${encodeURIComponent(q)}`).catch((e) => { if (census.length) return []; throw e; });
      return [...census, ...rows.map((r) => ({ lat: Number(r.lat), lon: Number(r.lon), label: r.display_name, kind: r.type }))];
    });
  }

  async function censusGeocode(q) {
    const r = await fetch('https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?benchmark=Public_AR_Current&format=json&address=' + encodeURIComponent(q), { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`census geocoder answered ${r.status}`);
    const j = await r.json();
    return (j.result?.addressMatches || []).slice(0, 3).map((m) => ({ lat: m.coordinates.y, lon: m.coordinates.x, label: titleCase(m.matchedAddress) + ', United States', kind: 'address' }));
  }

  async function reverse(lat, lon) {
    return cachedJson('reverse', `${lat.toFixed(5)},${lon.toFixed(5)}`, async () => {
      const r = await nominatim(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}`);
      return { label: r.display_name || `${lat.toFixed(5)}, ${lon.toFixed(5)}` };
    });
  }

  /** USGS 3DEP: lidar-derived, 1 m where flown, US only. Returns null outside coverage. */
  async function usgs3dep(lat, lon, size, n) {
    const g = siteGrid(lat, lon, size, n);
    // exportImage bbox is pixel edges; pad half a cell so pixel centres land on our grid points.
    const bbox = [g.west - g.cellDegLon / 2, g.south - g.cellDegLat / 2, g.east + g.cellDegLon / 2, g.north + g.cellDegLat / 2];
    const url = 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage?' +
      `bbox=${bbox.join(',')}&bboxSR=4326&imageSR=4326&size=${n + 1},${n + 1}&format=tiff&pixelType=F32` +
      '&interpolation=RSP_BilinearInterpolation&noData=-9999&f=image';
    const buf = await cachedBytes('dem3dep', url, url, 60000);
    const t = readFloatTiff(buf);
    if (t.width !== n + 1 || t.height !== n + 1) throw new Error('3DEP returned the wrong size');
    let bad = 0;
    for (const v of t.data) if (!(v > -500 && v < 9000)) bad++;
    if (bad > t.data.length * 0.01) return null;
    if (bad) fillGaps(t.data, n + 1);
    return { heights: t.data, source: 'USGS 3DEP lidar', sourceResM: 1 };
  }

  /** AWS open Terrain Tiles (Terrarium PNG), worldwide, about 3 to 30 m depending on the region. */
  async function terrarium(lat, lon, size, n) {
    const g = siteGrid(lat, lon, size, n);
    let z = 15;
    // Keep the tile count sane for very large sites.
    while (z > 8) {
      const a = lonLatToPixel(g.west, g.north, z), b = lonLatToPixel(g.east, g.south, z);
      if ((Math.floor(b.x / 256) - Math.floor(a.x / 256) + 1) * (Math.floor(b.y / 256) - Math.floor(a.y / 256) + 1) <= 36) break;
      z--;
    }
    const a = lonLatToPixel(g.west, g.north, z), b = lonLatToPixel(g.east, g.south, z);
    const tx0 = Math.floor(a.x / 256) , ty0 = Math.floor(a.y / 256);
    const tx1 = Math.floor(b.x / 256), ty1 = Math.floor(b.y / 256);
    const W = (tx1 - tx0 + 1) * 256, H = (ty1 - ty0 + 1) * 256;
    const mosaic = new Float32Array(W * H);
    const jobs = [];
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${tx}/${ty}.png`;
      jobs.push(cachedBytes('terrarium', url, url).then((buf) => {
        const png = PNG.sync.read(buf);
        const ox = (tx - tx0) * 256, oy = (ty - ty0) * 256;
        for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
          const i = (y * 256 + x) * 4;
          mosaic[(oy + y) * W + ox + x] = decodeTerrarium(png.data[i], png.data[i + 1], png.data[i + 2]);
        }
      }));
    }
    await Promise.all(jobs);
    const heights = new Float32Array((n + 1) * (n + 1));
    for (let r = 0; r <= n; r++) for (let c = 0; c <= n; c++) {
      const [la, lo] = g.pointLatLon(r, c);
      const p = lonLatToPixel(lo, la, z);
      heights[r * (n + 1) + c] = bilinear(mosaic, W, H, p.x - tx0 * 256 - 0.5, p.y - ty0 * 256 - 0.5);
    }
    const metresPerPx = (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;
    return { heights, source: 'AWS Terrain Tiles (SRTM, NED and others)', sourceResM: +metresPerPx.toFixed(1) };
  }

  async function terrain(lat, lon, size, n, prefer = 'auto') {
    let result = null, note = '';
    if (prefer !== 'tiles') {
      try { result = await usgs3dep(lat, lon, size, n); } catch (e) { note = `USGS lidar unavailable (${e.message}). `; }
      if (!result && !note) note = 'Outside USGS lidar coverage. ';
    }
    if (!result) result = await terrarium(lat, lon, size, n);
    let min = Infinity, max = -Infinity;
    for (const v of result.heights) { if (v < min) min = v; if (v > max) max = v; }
    const rel = new Float32Array(result.heights.length);
    for (let i = 0; i < rel.length; i++) rel[i] = result.heights[i] - min;
    return {
      n, size, lat, lon,
      base: +min.toFixed(2), relief: +(max - min).toFixed(2),
      source: result.source, sourceResM: result.sourceResM, note: note.trim(),
      heights: Buffer.from(rel.buffer).toString('base64'),
    };
  }

  async function tile(z, x, y) {
    const url = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
    return cachedBytes('imagery', url, url, 20000);
  }

  // Free services hiccup now and then (timeouts, a 429). One quiet retry saves a site from
  // being built without its climate or soil.
  // A 429 means slow down, so that retry waits longer.
  const retry = async (fn) => {
    try { return await fn(); } catch (e) {
      await new Promise((r) => setTimeout(r, /429/.test(String(e.message)) ? 20000 : 1500));
      return fn();
    }
  };

  /** Official USDA 2023 hardiness zone for US sites, via the ZIP code at the point. */
  async function usdaZone(lat, lon) {
    return cachedJson('usdazone', `${lat.toFixed(3)},${lon.toFixed(3)}`, async () => {
      const r = await nominatim(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&lat=${lat}&lon=${lon}`);
      const zip = (r.address?.postcode || '').match(/^\d{5}/)?.[0];
      if (r.address?.country_code !== 'us' || !zip) return null;
      const z = await retry(async () => {
        const res = await fetch(`https://phzmapi.org/${zip}.json`, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(15000) });
        if (!res.ok) throw new Error(`zone lookup answered ${res.status}`);
        return res.json();
      });
      return z?.zone ? { label: z.zone, zip, rangeF: z.temperature_range, source: 'USDA Plant Hardiness Zone Map 2023, by ZIP' } : null;
    }).catch(() => null);
  }

  async function climate(lat, lon) {
    const c = await climateData(lat, lon);
    const official = await usdaZone(lat, lon);
    return official ? { ...c, zoneOfficial: official } : c;
  }

  async function climateData(lat, lon) {
    const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
    return cachedJson('climate4', key, async () => {
      const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
        '&start_date=2015-01-01&end_date=2024-12-31&daily=temperature_2m_min,temperature_2m_max,precipitation_sum&timezone=auto';
      const j = await retry(async () => {
        const r = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(45000) });
        if (!r.ok) throw new Error(`climate service answered ${r.status}`);
        return r.json();
      });
      // three winters of hourly temperatures for chill hours
      const hurl = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
        '&start_date=2021-07-01&end_date=2024-06-30&hourly=temperature_2m&timezone=auto';
      const h = await retry(async () => {
        const r = await fetch(hurl, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(60000) });
        if (!r.ok) throw new Error(`climate service answered ${r.status}`);
        return r.json();
      }).catch(() => null);
      return { ...summariseClimateV2(j.daily, h?.hourly || null, lat), source: 'Open-Meteo ERA5 reanalysis, about 10 km cells', elevationM: j.elevation };
    });
  }

  async function soil(lat, lon) {
    const key = `${lat.toFixed(5)},${lon.toFixed(5)}`;
    return cachedJson('soil', key, async () => {
      const sda = (sql) => retry(() => sdaOnce(sql));
      const sdaOnce = async (sql) => {
        const r = await fetch('https://SDMDataAccess.sc.egov.usda.gov/Tabular/post.rest', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'user-agent': UA },
          body: JSON.stringify({ query: sql, format: 'JSON+COLUMNNAME' }),
          signal: AbortSignal.timeout(30000),
        });
        if (!r.ok) throw new Error(`soil service answered ${r.status}`);
        const text = await r.text();
        if (!text.trim()) return [];
        const j = JSON.parse(text);
        const [cols, ...rows] = j.Table || [];
        return rows.map((row) => Object.fromEntries(cols.map((c, i) => [c, row[i]])));
      };
      const comps = await sda(
        'SELECT TOP 3 mu.muname, mu.mukey, c.cokey, c.compname, c.comppct_r, c.drainagecl, c.hydgrp, c.taxorder, c.slope_r ' +
        'FROM mapunit mu INNER JOIN component c ON c.mukey = mu.mukey ' +
        `WHERE mu.mukey IN (SELECT * FROM SDA_Get_Mukey_from_intersection_with_WktWgs84('point(${lon} ${lat})')) ` +
        "AND c.majcompflag = 'Yes' ORDER BY c.comppct_r DESC");
      if (!comps.length) return { available: false, note: 'No USDA soil survey here (US only).' };
      const top = comps[0];
      const hz = await sda(
        'SELECT TOP 1 tg.texdesc, ch.ph1to1h2o_r, ch.om_r, ch.hzdepb_r FROM chorizon ch ' +
        "INNER JOIN chtexturegrp tg ON tg.chkey = ch.chkey AND tg.rvindicator = 'Yes' " +
        `WHERE ch.cokey = '${String(top.cokey).replace(/[^0-9]/g, '')}' ORDER BY ch.hzdept_r`);
      return {
        available: true,
        mapUnit: top.muname,
        components: comps.map((c) => ({ name: c.compname, percent: Number(c.comppct_r) || null })),
        drainage: top.drainagecl || null,
        hydrologicGroup: top.hydgrp || null,
        order: top.taxorder || null,
        topsoilTexture: hz[0]?.texdesc || null,
        pH: hz[0]?.ph1to1h2o_r != null ? Number(hz[0].ph1to1h2o_r) : null,
        organicMatterPct: hz[0]?.om_r != null ? Number(hz[0].om_r) : null,
        source: 'USDA NRCS Soil Data Access (SSURGO)',
      };
    });
  }

  /** Plant species recorded growing near the site (GBIF occurrence records), most recorded first. */
  async function wildPlants(lat, lon, radiusKm = 20) {
    const key = `${lat.toFixed(3)},${lon.toFixed(3)},${radiusKm}`;
    return cachedJson('wild', key, async () => {
      const get = async (url) => retry(async () => {
        const r = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(30000) });
        if (!r.ok) throw new Error(`GBIF answered ${r.status}`);
        return r.json();
      });
      // Tracheophyta only (vascular plants), so mosses and algae do not crowd the list
      const occ = await get(`https://api.gbif.org/v1/occurrence/search?geoDistance=${lat},${lon},${radiusKm}km&phylumKey=7707728&hasCoordinate=true&limit=0&facet=speciesKey&facetLimit=60`);
      const counts = occ.facets?.[0]?.counts || [];
      const species = await Promise.all(counts.map(async (c) => {
        try {
          const sp = await get(`https://api.gbif.org/v1/species/${c.name}`);
          return { key: Number(c.name), records: c.count, latin: sp.species || sp.scientificName, name: sp.vernacularName || null, family: sp.family || null, order: sp.order || null };
        } catch { return null; }
      }));
      return { total: occ.count, radiusKm, species: species.filter(Boolean), source: 'GBIF.org occurrence records' };
    });
  }

  /** Wind rose from five years of daily dominant wind direction and peak speed. */
  async function wind(lat, lon) {
    const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
    return cachedJson('wind', key, async () => {
      const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
        '&start_date=2020-01-01&end_date=2024-12-31&daily=wind_direction_10m_dominant,wind_speed_10m_max&wind_speed_unit=kmh&timezone=auto';
      const j = await retry(async () => {
        const r = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(45000) });
        if (!r.ok) throw new Error(`wind service answered ${r.status}`);
        return r.json();
      });
      return windRose(j.daily, lat);
    });
  }

  async function getJson(url, init = {}, timeout = 45000) {
    const r = await fetch(url, { ...init, headers: { 'user-agent': UA, ...(init.headers || {}) }, signal: AbortSignal.timeout(timeout) });
    if (!r.ok) throw new Error(`answered ${r.status}`);
    return r.json();
  }
  const envelope = (b) => `geometry=${b.west},${b.south},${b.east},${b.north}&geometryType=esriGeometryEnvelope&inSR=4326&outSR=4326&spatialRel=esriSpatialRelIntersects&returnGeometry=true&geometryPrecision=6&f=geojson`;

  /**
   * What is already on and around the land, from public maps: FEMA flood zones, wetlands,
   * streams, soil map units across the whole site, and OpenStreetMap buildings, roads and water.
   * Each source is fetched on its own, so one being down only leaves its layer empty.
   */
  async function surroundings(lat, lon, size) {
    const key = `${lat.toFixed(5)},${lon.toFixed(5)},${size}`;
    const b = siteGrid(lat, lon, size, 1);
    const pad = 0.0002; // a little beyond the square, so features crossing the edge are kept
    const bb = { west: b.west - pad, east: b.east + pad, south: b.south - pad, north: b.north + pad };
    // the federal map servers drop connections and time out under load: try a few times
    const patient = async (fn) => { let err; for (let k = 0; k < 4; k++) { try { return await fn(); } catch (e) { err = e; await new Promise((r) => setTimeout(r, 1500 * (k + 1))); } } throw err; };
    const part = (name, fn) => cachedJson('surround-' + name, key, fn).then((v) => [name, v, null]).catch((e) => [name, null, e.message]);
    const parts = await Promise.all([
      part('flood', async () => parseFlood(await patient(() => getJson(`https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query?outFields=FLD_ZONE,ZONE_SUBTY,SFHA_TF&maxAllowableOffset=0.00002&${envelope(bb)}`, {}, 60000)), lat, lon, size)),
      part('wetlands', async () => parseWetlands(await patient(() => getJson(`https://fwspublicservices.wim.usgs.gov/wetlandsmapservice/rest/services/Wetlands/MapServer/0/query?outFields=WETLAND_TYPE,ATTRIBUTE&maxAllowableOffset=0.00002&${envelope(bb)}`)), lat, lon, size)),
      part('streams', async () => parseStreams(await patient(() => getJson(`https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer/6/query?outFields=gnis_name,ftype,fcode&${envelope(bb)}`)), lat, lon, size)),
      part('soils', () => soilMap(lat, lon, size, bb)),
      part('osm', async () => parseOsm(await retry(() => getJson('https://overpass-api.de/api/interpreter', {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(`[out:json][timeout:25];(way["building"](${bb.south},${bb.west},${bb.north},${bb.east});way["highway"](${bb.south},${bb.west},${bb.north},${bb.east});way["waterway"](${bb.south},${bb.west},${bb.north},${bb.east});way["natural"="water"](${bb.south},${bb.west},${bb.north},${bb.east}););out geom;`),
      }, 40000)), lat, lon, size)),
    ]);
    const out = { fetched: new Date().toISOString(), errors: {} };
    for (const [name, v, err] of parts) { out[name] = v; if (err) out.errors[name] = err; }
    out.sources = {
      flood: 'FEMA National Flood Hazard Layer', wetlands: 'US Fish and Wildlife Service National Wetlands Inventory',
      streams: 'USGS National Hydrography Dataset', soils: 'USDA NRCS SSURGO soil map units', osm: '© OpenStreetMap contributors',
    };
    return out;
  }

  /** Every soil map unit on the site with its share of the area and what matters for design. */
  async function soilMap(lat, lon, size, bb) {
    const poly = `polygon((${bb.west} ${bb.south}, ${bb.east} ${bb.south}, ${bb.east} ${bb.north}, ${bb.west} ${bb.north}, ${bb.west} ${bb.south}))`;
    const rows = await retry(() => sdaQuery(
      `SELECT mupolygonkey, mukey, mupolygongeo.STIntersection(geometry::STGeomFromText('${poly.toUpperCase()}', 4326)).STAsText() AS wkt FROM mupolygon ` +
      `WHERE mupolygonkey IN (SELECT * FROM SDA_Get_Mupolygonkey_from_intersection_with_WktWgs84('${poly}'))`));
    if (!rows.length) return [];
    const keys = [...new Set(rows.map((r) => String(r.mukey).replace(/[^0-9]/g, '')))];
    const attrs = await retry(() => sdaQuery(`SELECT mukey, muname, drclassdcd, hydgrpdcd, flodfreqdcd, pondfreqprs, slopegradwta, brockdepmin, wtdepannmin FROM muaggatt WHERE mukey IN (${keys.map((k) => `'${k}'`).join(',')})`));
    const ph = await retry(() => sdaQuery(
      'SELECT c.mukey, ch.ph1to1h2o_r, ch.om_r FROM component c INNER JOIN chorizon ch ON ch.cokey = c.cokey ' +
      `WHERE c.mukey IN (${keys.map((k) => `'${k}'`).join(',')}) AND c.majcompflag = 'Yes' AND ch.hzdept_r = 0`)).catch(() => []);
    const local = toLocal(lat, lon), h = size / 2;
    const units = {};
    for (const a of attrs) {
      const p = ph.find((x) => String(x.mukey) === String(a.mukey));
      units[a.mukey] = {
        mukey: String(a.mukey), name: a.muname, drainage: a.drclassdcd || null, hydgrp: a.hydgrpdcd || null, flooding: a.flodfreqdcd || null,
        ponding: a.pondfreqprs != null ? Number(a.pondfreqprs) : null, slope: a.slopegradwta != null ? Number(a.slopegradwta) : null,
        bedrockCm: a.brockdepmin != null ? Number(a.brockdepmin) : null, waterTableCm: a.wtdepannmin != null ? Number(a.wtdepannmin) : null,
        pH: p?.ph1to1h2o_r != null ? Number(p.ph1to1h2o_r) : null, organicPct: p?.om_r != null ? Number(p.om_r) : null, rings: [],
      };
    }
    for (const r of rows) {
      const u = units[String(r.mukey)];
      if (!u) continue;
      for (const ring of wktRings(r.wkt)) { const c = clipRing(ring.map(local), h); if (c.length) u.rings.push(c); }
    }
    const area = (ring) => Math.abs(ring.reduce((s, p, i) => { const q = ring[(i + 1) % ring.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2);
    const list = Object.values(units).filter((u) => u.rings.length);
    for (const u of list) u.share = +(u.rings.reduce((s, r) => s + area(r), 0) / (size * size)).toFixed(3);
    return list.sort((a, b) => b.share - a.share);
  }

  async function sdaQuery(sql) {
    const r = await fetch('https://SDMDataAccess.sc.egov.usda.gov/Tabular/post.rest', {
      method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': UA },
      body: JSON.stringify({ query: sql, format: 'JSON+COLUMNNAME' }), signal: AbortSignal.timeout(45000),
    });
    if (!r.ok) throw new Error(`soil service answered ${r.status}`);
    const text = await r.text();
    if (!text.trim()) return [];
    const [cols, ...rows] = JSON.parse(text).Table || [];
    return rows.map((row) => Object.fromEntries(cols.map((c, i) => [c, row[i]])));
  }

  /** The next ten days, for the season watch: frost, heavy rain, heat and wind. Kept three hours. */
  const forecastMem = new Map();
  async function forecast(lat, lon) {
    const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
    const hit = forecastMem.get(key);
    if (hit && Date.now() - hit.at < 3 * 3600_000) return hit.v;
    const j = await retry(() => getJson(`https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&daily=temperature_2m_min,temperature_2m_max,precipitation_sum,wind_gusts_10m_max&timezone=auto&forecast_days=10`, {}, 20000));
    let alerts = [];
    try {
      const a = await getJson(`https://api.weather.gov/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`, { headers: { accept: 'application/geo+json' } }, 15000);
      alerts = (a.features || []).map((f) => ({ event: f.properties.event, headline: f.properties.headline, ends: f.properties.ends || f.properties.expires }));
    } catch { /* outside the US, or the service is down: the forecast still stands */ }
    const v = { days: j.daily.time.map((t, i) => ({ date: t, minC: j.daily.temperature_2m_min[i], maxC: j.daily.temperature_2m_max[i], rainMm: j.daily.precipitation_sum[i], gustKmh: j.daily.wind_gusts_10m_max[i] })), alerts, source: 'Open-Meteo forecast, National Weather Service alerts' };
    forecastMem.set(key, { at: Date.now(), v });
    return v;
  }

  return { geocode, reverse, terrain, tile, climate, soil, wildPlants, wind, surroundings, forecast };
}

const titleCase = (s) => String(s).toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\b(Nc|Ny|Ca|Tx|Va|Sc|Ga|Fl|Or|Wa|Co|Nm|Az|Ut|Id|Mt|Wy|Nd|Sd|Ne|Ks|Ok|Mn|Ia|Mo|Ar|La|Wi|Il|Mi|In|Oh|Ky|Tn|Ms|Al|Pa|Nj|De|Md|Dc|Wv|Ct|Ri|Ma|Vt|Nh|Me|Ak|Hi|Nv)\b/g, (m) => m.toUpperCase());

/** "40.1, -105.2", "40.1 -105.2" or a Google Maps link with @lat,lon. */
/**
 * Sixteen-point wind rose: share of days the wind came FROM each direction, all year, in the
 * cold half and the warm half of the year, plus the mean peak speed from each direction.
 */
export function windRose(daily, lat) {
  const blank = () => new Array(16).fill(0);
  const all = blank(), cold = blank(), warm = blank(), speed = blank(), strong = blank();
  let n = 0, nc = 0, nw = 0;
  const coldMonths = lat >= 0 ? [11, 12, 1, 2, 3] : [5, 6, 7, 8, 9];
  (daily?.time || []).forEach((t, i) => {
    const d = daily.wind_direction_10m_dominant[i], v = daily.wind_speed_10m_max[i];
    if (d == null || v == null) return;
    const k = Math.round(d / 22.5) % 16, m = Number(t.slice(5, 7));
    all[k]++; speed[k] += v; n++;
    if (v >= 35) strong[k]++;
    if (coldMonths.includes(m)) { cold[k]++; nc++; } else { warm[k]++; nw++; }
  });
  const peak = (a) => a.indexOf(Math.max(...a)) * 22.5;
  return {
    days: n,
    all: all.map((v) => v / (n || 1)), cold: cold.map((v) => v / (nc || 1)), warm: warm.map((v) => v / (nw || 1)),
    meanPeakKmh: speed.map((s, k) => (all[k] ? s / all[k] : 0)), strongDays: strong,
    prevailing: peak(all), prevailingCold: peak(cold), prevailingWarm: peak(warm), strongest: peak(strong),
    source: 'Open-Meteo ERA5 reanalysis, daily dominant wind 2020 to 2024',
  };
}

export function parseCoordinates(q) {
  const s = String(q).trim();
  const at = s.match(/@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/);
  const m = at || s.match(/^(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1]), lon = Number(m[2]);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return [lat, lon];
}

/** Replace isolated no-data samples with the mean of their valid neighbours. */
function fillGaps(data, w) {
  const ok = (v) => v > -500 && v < 9000;
  for (let pass = 0; pass < 8; pass++) {
    let left = 0;
    for (let i = 0; i < data.length; i++) {
      if (ok(data[i])) continue;
      const x = i % w, y = (i / w) | 0;
      let s = 0, k = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= w) continue;
        const v = data[yy * w + xx];
        if (ok(v)) { s += v; k++; }
      }
      if (k) data[i] = s / k; else left++;
    }
    if (!left) return;
  }
}
