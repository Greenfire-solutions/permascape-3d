// Pure geography and raster helpers. No network, so the tests can drive them directly.

/** Metres per degree of latitude and longitude at a given latitude (WGS84 series). */
export function metresPerDegree(lat) {
  const p = (lat * Math.PI) / 180;
  return {
    lat: 111132.92 - 559.82 * Math.cos(2 * p) + 1.175 * Math.cos(4 * p),
    lon: 111412.84 * Math.cos(p) - 93.5 * Math.cos(3 * p),
  };
}

/**
 * The (n+1) x (n+1) sample grid for a square site of `size` metres centred on lat/lon.
 * Row 0 is the north edge, column 0 the west edge, matching THREE.PlaneGeometry vertex order.
 */
export function siteGrid(lat, lon, size, n) {
  const m = metresPerDegree(lat);
  const half = size / 2;
  return {
    north: lat + half / m.lat,
    south: lat - half / m.lat,
    west: lon - half / m.lon,
    east: lon + half / m.lon,
    cellDegLat: size / n / m.lat,
    cellDegLon: size / n / m.lon,
    pointLatLon(r, c) {
      return [lat + (half - (r * size) / n) / m.lat, lon + (-half + (c * size) / n) / m.lon];
    },
  };
}

/** Web Mercator global pixel coordinates at zoom z for 256 px tiles. */
export function lonLatToPixel(lon, lat, z) {
  const scale = 256 * 2 ** z;
  const s = Math.sin((lat * Math.PI) / 180);
  return {
    x: ((lon + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale,
  };
}

/** Terrarium encoding used by the AWS open terrain tiles. */
export function decodeTerrarium(r, g, b) {
  return r * 256 + g + b / 256 - 32768;
}

/**
 * Minimal reader for the uncompressed float32 TIFF the USGS 3DEP ImageServer returns.
 * Returns { width, height, data: Float32Array } or throws on anything it does not understand.
 */
export function readFloatTiff(buf) {
  const le = buf[0] === 0x49 && buf[1] === 0x49;
  if (!le && !(buf[0] === 0x4d && buf[1] === 0x4d)) throw new Error('not a TIFF');
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const u16 = (o) => dv.getUint16(o, le);
  const u32 = (o) => dv.getUint32(o, le);
  if (u16(2) !== 42) throw new Error('BigTIFF or bad magic');
  const ifd = u32(4);
  const count = u16(ifd);
  const tags = {};
  for (let i = 0; i < count; i++) {
    const e = ifd + 2 + i * 12;
    const tag = u16(e), type = u16(e + 2), n = u32(e + 4);
    if (type !== 3 && type !== 4) continue; // only SHORT and LONG tags matter here; GeoTIFF ASCII/DOUBLE tags are skipped
    const size = type === 3 ? 2 : 4;
    const read = (o) => (type === 3 ? u16(o) : u32(o));
    const vals = [];
    const base = n * size <= 4 ? e + 8 : u32(e + 8);
    for (let k = 0; k < n; k++) vals.push(read(base + k * size));
    tags[tag] = vals;
  }
  const width = tags[256]?.[0], height = tags[257]?.[0];
  if (!width || !height) throw new Error('TIFF missing size');
  if ((tags[259]?.[0] ?? 1) !== 1) throw new Error('compressed TIFF not supported');
  if ((tags[258]?.[0] ?? 0) !== 32) throw new Error('TIFF is not 32 bit');
  if ((tags[339]?.[0] ?? 1) !== 3) throw new Error('TIFF is not float');
  const data = new Float32Array(width * height);
  if (tags[322]) {
    // Tiled layout. An empty tile (byte count 0) is no-data, which is how the service says
    // "no survey here", so it becomes NaN rather than an error.
    const tw = tags[322][0], th = tags[323][0];
    const across = Math.ceil(width / tw);
    const offs = tags[324] || [], cnts = tags[325] || [];
    for (let t = 0; t < offs.length; t++) {
      const ox = (t % across) * tw, oy = Math.floor(t / across) * th;
      for (let y = 0; y < th && oy + y < height; y++) for (let x = 0; x < tw && ox + x < width; x++) {
        const o = offs[t] + (y * tw + x) * 4;
        data[(oy + y) * width + ox + x] = cnts[t] && o + 4 <= offs[t] + cnts[t] ? dv.getFloat32(o, le) : NaN;
      }
    }
    return { width, height, data };
  }
  const offsets = tags[273] || [];
  const counts = tags[279] || [];
  let k = 0;
  for (let s = 0; s < offsets.length; s++) {
    const end = offsets[s] + counts[s];
    for (let o = offsets[s]; o + 4 <= end && k < data.length; o += 4) data[k++] = dv.getFloat32(o, le);
  }
  if (k !== data.length) throw new Error(`TIFF short read ${k}/${data.length}`);
  return { width, height, data };
}

/** Bilinear sample of a row-major grid, clamped at the edges. */
export function bilinear(data, w, h, x, y) {
  x = Math.max(0, Math.min(w - 1, x));
  y = Math.max(0, Math.min(h - 1, y));
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
  const u = x - x0, v = y - y0;
  const a = data[y0 * w + x0], b = data[y0 * w + x1], c = data[y1 * w + x0], d = data[y1 * w + x1];
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

/** USDA hardiness zone from the mean annual extreme minimum temperature in Celsius. */
export function hardinessZone(minC) {
  const f = minC * 9 / 5 + 32;
  const idx = Math.floor((f + 60) / 5); // 5F half-zones starting at -60F = 1a
  const zone = Math.max(1, Math.min(13, Math.floor(idx / 2) + 1));
  const half = idx % 2 === 0 ? 'a' : 'b';
  return { zone, label: `${zone}${half}`, minF: Math.round(f) };
}

/**
 * Climate summary from daily series (ISO dates, min/max temperature C, precipitation mm).
 * Frost dates use 0 C. The growing season half of the year depends on the hemisphere.
 */
export function summariseClimate(daily, lat) {
  const years = {};
  daily.time.forEach((d, i) => {
    const y = d.slice(0, 4);
    (years[y] ||= []).push({ d, tmin: daily.temperature_2m_min[i], tmax: daily.temperature_2m_max[i], p: daily.precipitation_sum[i] });
  });
  const ys = Object.keys(years).filter((y) => years[y].length >= 360);
  const monthlyP = new Array(12).fill(0), monthlyTmin = new Array(12).fill(0), monthlyTmax = new Array(12).fill(0), monthlyN = new Array(12).fill(0);
  const annualP = [], annualMin = [], lastSpring = [], firstFall = [];
  const south = lat < 0;
  const unshift = (s) => (south ? ((s - 182 + 365 - 1) % 365) + 1 : s);
  for (const y of ys) {
    let p = 0, mn = Infinity, ls = null, ff = null;
    for (const day of years[y]) {
      const m = Number(day.d.slice(5, 7)) - 1;
      const doy = dayOfYear(day.d);
      if (day.p != null) { p += day.p; monthlyP[m] += day.p; }
      if (day.tmin != null) {
        mn = Math.min(mn, day.tmin);
        monthlyTmin[m] += day.tmin; monthlyTmax[m] += day.tmax ?? day.tmin; monthlyN[m]++;
        if (day.tmin <= 0) {
          // Shift the southern year by half so winter sits at the ends of the window as it does
          // in the north; then the last frost before mid-window is spring, the first after is fall.
          const s = south ? ((doy + 182 - 1) % 365) + 1 : doy;
          if (s < 182) ls = Math.max(ls ?? 0, s);
          else if (ff == null || s < ff) ff = s;
        }
      }
    }
    annualP.push(p); annualMin.push(mn);
    if (ls != null) lastSpring.push(ls);
    if (ff != null) firstFall.push(ff);
  }
  const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
  const minMean = mean(annualMin);
  const ls = mean(lastSpring), ff = mean(firstFall);
  const frostFree = lastSpring.length === 0 && firstFall.length === 0;
  return {
    years: ys.length,
    period: ys.length ? `${ys[0]} to ${ys[ys.length - 1]}` : '',
    annualPrecipMm: Math.round(mean(annualP) ?? 0),
    monthlyPrecipMm: monthlyP.map((v) => Math.round(v / Math.max(1, ys.length))),
    monthlyMeanMinC: monthlyTmin.map((v, i) => +(v / Math.max(1, monthlyN[i])).toFixed(1)),
    monthlyMeanMaxC: monthlyTmax.map((v, i) => +(v / Math.max(1, monthlyN[i])).toFixed(1)),
    meanAnnualMinC: minMean == null ? null : +minMean.toFixed(1),
    zone: minMean == null ? null : hardinessZone(minMean),
    frostFree,
    lastSpringFrost: !frostFree && ls != null ? doyToLabel(unshift(Math.round(ls))) : null,
    firstFallFrost: !frostFree && ff != null ? doyToLabel(unshift(Math.round(ff))) : null,
    growingSeasonDays: frostFree ? 365 : (ls != null && ff != null ? Math.round(ff - ls) : null),
  };
}

export function dayOfYear(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  return Math.floor((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000) + 1;
}

function doyToLabel(doy) {
  const d = new Date(Date.UTC(2023, 0, doy));
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

// ---------------------------------------------------------------- climate, version 2
// Everything the plant advisor needs to judge a place: safe frost dates (not just averages),
// winter chill, summer heat, growing degree days, wet seasons and the Koppen climate type.

const MONTH_MID = [15, 46, 74, 105, 135, 166, 196, 227, 258, 288, 319, 349];

function percentile(arr, p) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}

/** Per-year frost dates as day-of-year. Southern sites work in a half-year-shifted frame. */
export function frostDates(daily, lat) {
  const south = lat < 0;
  const shift = (doy) => (south ? ((doy + 182 - 1) % 365) + 1 : doy);
  const unshift = (s) => (south ? ((s - 182 + 365 - 1) % 365) + 1 : s);
  const years = {};
  daily.time.forEach((d, i) => {
    const t = daily.temperature_2m_min[i];
    if (t == null) return;
    // a southern "season year" runs July to June, so the winter is not split
    let y = Number(d.slice(0, 4));
    const doy = dayOfYear(d);
    if (south && doy < 182) y -= 1;
    (years[y] ||= { n: 0, last: null, first: null }).n++;
    if (t <= 0) {
      const s = shift(doy);
      const Y = years[y];
      if (s < 182) Y.last = Math.max(Y.last ?? 0, s);
      else if (Y.first == null || s < Y.first) Y.first = s;
    }
  });
  const full = Object.values(years).filter((y) => y.n >= 360);
  const lasts = full.map((y) => y.last).filter((v) => v != null);
  const firsts = full.map((y) => y.first).filter((v) => v != null);
  const frostYears = full.filter((y) => y.last != null || y.first != null).length;
  // fewer than one year in five with any frost: treat as frost free
  if (frostYears < Math.max(1, full.length * 0.2)) return { frostFree: true, years: full.length, frostYears };
  const r = (v) => (v == null ? null : unshift(Math.round(v)));
  return {
    frostFree: false, years: full.length, frostYears,
    lastMean: r(lasts.length ? lasts.reduce((a, b) => a + b, 0) / lasts.length : null),
    lastLate: r(percentile(lasts, 0.9)), // 9 years in 10 the last frost is before this
    firstMean: r(firsts.length ? firsts.reduce((a, b) => a + b, 0) / firsts.length : null),
    firstEarly: r(percentile(firsts, 0.1)), // 9 years in 10 the first frost is after this
    seasonSafe: lasts.length && firsts.length ? Math.round(percentile(firsts, 0.1) - percentile(lasts, 0.9)) : null,
  };
}

/** Hours between 0 and 7.2 C in the dormant season, averaged over the winters supplied. */
export function chillHours(hourly, lat) {
  const south = lat < 0;
  const winters = {};
  hourly.time.forEach((t, i) => {
    const v = hourly.temperature_2m[i];
    if (v == null) return;
    const m = Number(t.slice(5, 7));
    const y = Number(t.slice(0, 4));
    // leaf fall to bud break. North: Oct to Apr, keyed by the year the winter starts; south: Apr to Oct
    let key = null;
    if (!south && (m >= 10 || m <= 4)) key = m >= 10 ? y : y - 1;
    if (south && m >= 4 && m <= 10) key = y;
    if (key == null) return;
    const w = (winters[key] ||= { hours: 0, chill: 0 });
    w.hours++;
    if (v >= 0 && v <= 7.2) w.chill++;
  });
  const full = Object.values(winters).filter((w) => w.hours > 4000);
  return full.length ? Math.round(full.reduce((a, w) => a + w.chill, 0) / full.length) : null;
}

const KOPPEN = {
  Af: 'Tropical rainforest', Am: 'Tropical monsoon', Aw: 'Tropical savanna (wet and dry seasons)',
  BWh: 'Hot desert', BWk: 'Cold desert', BSh: 'Hot semi-arid steppe', BSk: 'Cold semi-arid steppe',
  Csa: 'Hot-summer Mediterranean', Csb: 'Warm-summer Mediterranean', Csc: 'Cool-summer Mediterranean',
  Cwa: 'Humid subtropical, dry winter', Cwb: 'Subtropical highland', Cwc: 'Cold subtropical highland',
  Cfa: 'Humid subtropical', Cfb: 'Temperate oceanic', Cfc: 'Subpolar oceanic',
  Dsa: 'Hot-summer continental, dry summer', Dsb: 'Warm-summer continental, dry summer', Dsc: 'Subarctic, dry summer', Dsd: 'Extremely cold subarctic, dry summer',
  Dwa: 'Hot-summer continental, dry winter', Dwb: 'Warm-summer continental, dry winter', Dwc: 'Subarctic, dry winter', Dwd: 'Extremely cold subarctic, dry winter',
  Dfa: 'Hot-summer humid continental', Dfb: 'Warm-summer humid continental', Dfc: 'Subarctic', Dfd: 'Extremely cold subarctic',
  ET: 'Tundra', EF: 'Ice cap',
};

/** Koppen-Geiger class from 12 monthly mean temperatures (C) and precipitation (mm), after Peel et al. 2007. */
export function koppen(T, P, lat) {
  const MAT = T.reduce((a, b) => a + b, 0) / 12, MAP = P.reduce((a, b) => a + b, 0);
  const Thot = Math.max(...T), Tcold = Math.min(...T);
  const summer = lat >= 0 ? [3, 4, 5, 6, 7, 8] : [9, 10, 11, 0, 1, 2];
  const winter = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].filter((m) => !summer.includes(m));
  const Ps = summer.reduce((a, m) => a + P[m], 0), Pw = MAP - Ps;
  const Psdry = Math.min(...summer.map((m) => P[m])), Pswet = Math.max(...summer.map((m) => P[m]));
  const Pwdry = Math.min(...winter.map((m) => P[m])), Pwwet = Math.max(...winter.map((m) => P[m]));
  const Pdry = Math.min(...P);
  const Pth = Pw >= 0.7 * MAP ? 2 * MAT : Ps >= 0.7 * MAP ? 2 * MAT + 28 : 2 * MAT + 14;
  let code;
  if (Thot < 10) code = Thot > 0 ? 'ET' : 'EF';
  else if (MAP < 10 * Pth) code = (MAP < 5 * Pth ? 'BW' : 'BS') + (MAT >= 18 ? 'h' : 'k');
  else if (Tcold >= 18) code = Pdry >= 60 ? 'Af' : Pdry >= 100 - MAP / 25 ? 'Am' : 'Aw';
  else {
    const second = Psdry < 40 && Psdry < Pwwet / 3 ? 's' : Pwdry < Pswet / 10 ? 'w' : 'f';
    const warm = T.filter((t) => t >= 10).length;
    const third = Thot >= 22 ? 'a' : warm >= 4 ? 'b' : Tcold < -38 ? 'd' : 'c';
    code = (Tcold > 0 ? 'C' : 'D') + second + (Tcold > 0 && third === 'd' ? 'c' : third);
  }
  return { code, name: KOPPEN[code] || code };
}

/**
 * Chill hours estimated from daily minimum and maximum, for when hourly data is unavailable:
 * each day is modelled as a sine from the minimum near dawn to the maximum mid-afternoon.
 */
export function chillHoursFromDaily(daily, lat) {
  const time = [], temp = [];
  daily.time.forEach((d, i) => {
    const lo = daily.temperature_2m_min[i], hi = daily.temperature_2m_max[i];
    if (lo == null || hi == null) return;
    for (let h = 0; h < 24; h++) {
      // minimum at 06:00, maximum at 15:00
      const x = h >= 6 && h < 15 ? (h - 6) / 9 : h >= 15 ? 1 - (h - 15) / 15 : 1 - (h + 9) / 15;
      time.push(`${d}T${String(h).padStart(2, '0')}:00`);
      temp.push(lo + (hi - lo) * (0.5 - 0.5 * Math.cos(Math.PI * x)));
    }
  });
  return chillHours({ time, temperature_2m: temp }, lat);
}

export function summariseClimateV2(daily, hourly, lat) {
  const base = summariseClimate(daily, lat);
  const fr = frostDates(daily, lat);
  const n = daily.time.length;
  const yrs = Math.max(1, n / 365.25);
  let gdd = 0, hot = 0, veryHot = 0;
  const mSum = new Array(12).fill(0), mN = new Array(12).fill(0);
  for (let i = 0; i < n; i++) {
    const lo = daily.temperature_2m_min[i], hi = daily.temperature_2m_max[i];
    if (lo == null || hi == null) continue;
    const mean = (lo + hi) / 2, m = Number(daily.time[i].slice(5, 7)) - 1;
    mSum[m] += mean; mN[m]++;
    gdd += Math.max(0, Math.min(30, mean) - 10);
    if (hi >= 32) hot++;
    if (hi >= 38) veryHot++;
  }
  const monthlyMeanC = mSum.map((s, i) => +(s / Math.max(1, mN[i])).toFixed(1));
  const P = base.monthlyPrecipMm;
  // the rainy season: the longest run of months with at least 60 mm (wrapping the year)
  const wet = P.map((p) => p >= 60);
  let best = { start: -1, len: 0 };
  for (let s = 0; s < 12; s++) {
    if (!wet[s] || wet[(s + 11) % 12]) continue;
    let len = 0; while (len < 12 && wet[(s + len) % 12]) len++;
    if (len > best.len) best = { start: s, len };
  }
  const allWet = wet.every(Boolean);
  return {
    ...base,
    version: 2,
    monthlyMeanC,
    frost: fr,
    gdd10: Math.round(gdd / yrs),
    hotDays: Math.round(hot / yrs),
    veryHotDays: Math.round(veryHot / yrs),
    chillHours: (hourly && chillHours(hourly, lat)) ?? chillHoursFromDaily(daily, lat),
    chillMethod: hourly && chillHours(hourly, lat) != null ? 'hourly' : 'estimated from daily highs and lows',
    koppen: koppen(monthlyMeanC, P, lat),
    wetSeason: allWet ? { allYear: true } : best.len ? { allYear: false, startMonth: best.start + 1, months: best.len } : { allYear: false, startMonth: null, months: 0 },
  };
}

export { MONTH_MID };
