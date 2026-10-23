// The planting advisor: judges every plant in the library against one site's real climate
// and one zone's microclimate, and works out planting dates for that exact place.
//
// Annual crops are simulated: for every day of the year it asks "if I planted on this day,
// would the plant survive frost, would the ground be warm enough, would it mature before
// heat makes it bolt or drop its flowers?" The days that pass become the planting windows.
// So the dates come from the place, in either hemisphere, in the tropics as much as the north.
import type { Climate, Soil } from './types';
import type { Species } from './library.ts';

// ---------------------------------------------------------------- the site's climate, ready to use

export interface SiteClimate {
  lat: number;
  zoneNum: number; // 6.5 for 6b
  zoneLabel: string;
  zoneSource: string;
  extremeMinC: number; // average coldest night of the year
  frostFree: boolean;
  lastMean: number | null; // day of year
  lastSafe: number | null;
  firstMean: number | null;
  firstSafe: number | null;
  frostFreeDays: number;
  chill: number | null;
  gdd: number | null;
  hottestMaxC: number;
  coldestMeanC: number;
  humid: boolean;
  arid: boolean;
  annualPrecipMm: number;
  wetSeason: Climate['wetSeason'];
  koppen: { code: string; name: string } | null;
  lo: (doy: number) => number;
  hi: (doy: number) => number;
  mean: (doy: number) => number;
  rain: (doy: number) => number; // mm a month around that day
  notes: string[];
}

/** Hours of daylight (sunrise to sunset, with refraction) on a day of the year. */
export function dayLength(lat: number, doy: number) {
  const decl = 23.44 * Math.sin(((2 * Math.PI) / 365) * (wrap(doy) - 81)) * Math.PI / 180;
  const phi = lat * Math.PI / 180;
  const x = (Math.sin(-0.833 * Math.PI / 180) - Math.sin(phi) * Math.sin(decl)) / (Math.cos(phi) * Math.cos(decl));
  if (x <= -1) return 24;
  if (x >= 1) return 0;
  return (2 * Math.acos(x) * 180 / Math.PI) / 15;
}

/** The day length that makes onions bulb, for the type that suits this latitude. */
export const onionTrigger = (lat: number) => {
  const a = Math.abs(lat);
  if (a < 28) return 11.5;
  if (a < 38) return 13;
  // long-day types: about 14.5 to 15 hours, but never more than the longest day here allows
  return Math.min(15, dayLength(a, 172) - 0.5);
};

export interface Overrides { zone?: string; lastFrost?: string; firstFrost?: string }

const MID = [15, 46, 74, 105, 135, 166, 196, 227, 258, 288, 319, 349];
const wrap = (d: number) => ((Math.round(d) - 1) % 365 + 365) % 365 + 1;

function curve(monthly: number[]) {
  return (doy: number) => {
    const d = wrap(doy);
    let i = MID.findIndex((m) => m > d);
    if (i === -1) i = 12;
    const a = (i + 11) % 12, b = i % 12;
    const da = i === 0 ? MID[11] - 365 : MID[a], db = i === 12 ? MID[0] + 365 : MID[b];
    const t = (d - da) / (db - da);
    return monthly[a] + (monthly[b] - monthly[a]) * t;
  };
}

export const zoneToNum = (label: string) => {
  const m = String(label).trim().match(/^(\d{1,2})([ab])?$/i);
  return m ? Number(m[1]) + (m[2]?.toLowerCase() === 'b' ? 0.5 : 0) : NaN;
};
/** The lower bound of a zone's average coldest night, in Celsius. */
export const zoneMinC = (z: number) => ((-60 + (z - 1) * 10) - 32) * 5 / 9;

export function mmddToDoy(s: string) {
  const m = s.match(/^(\d{1,2})-(\d{1,2})$/);
  if (!m) return null;
  return Math.floor((Date.UTC(2023, Number(m[1]) - 1, Number(m[2])) - Date.UTC(2023, 0, 1)) / 86400000) + 1;
}

export function doyLabel(doy: number) {
  return new Date(Date.UTC(2023, 0, wrap(doy))).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function buildSiteClimate(c: Climate, lat: number, o: Overrides = {}): SiteClimate | null {
  if (!c || c.version !== 2) return null;
  const notes: string[] = [];
  let zoneNum = c.zone ? c.zone.zone + (c.zone.label.endsWith('b') ? 0.5 : 0) : 7;
  let zoneLabel = c.zone?.label ?? '?', zoneSource = 'Estimated from 10 years of ERA5 reanalysis';
  if (c.zoneOfficial?.label) { zoneNum = zoneToNum(c.zoneOfficial.label); zoneLabel = c.zoneOfficial.label; zoneSource = c.zoneOfficial.source; }
  if (o.zone && Number.isFinite(zoneToNum(o.zone))) { zoneNum = zoneToNum(o.zone); zoneLabel = o.zone; zoneSource = 'Set by you'; }

  const f = c.frost;
  let frostFree = !!f?.frostFree;
  let lastMean = f?.lastMean ?? null, lastSafe = f?.lastLate ?? null, firstMean = f?.firstMean ?? null, firstSafe = f?.firstEarly ?? null;
  const lo = o.lastFrost ? mmddToDoy(o.lastFrost) : null, fo = o.firstFrost ? mmddToDoy(o.firstFrost) : null;
  if (lo) { lastMean = lo; lastSafe = wrap(lo + 14); frostFree = false; }
  if (fo) { firstMean = fo; firstSafe = wrap(fo - 14); frostFree = false; }
  if (!frostFree && (lastSafe == null || firstSafe == null)) frostFree = true;
  const frostFreeDays = frostFree ? 365 : ((firstSafe! - lastSafe! + 365) % 365);

  const monthlyMin = c.monthlyMeanMinC, monthlyMax = c.monthlyMeanMaxC;
  const meanM = monthlyMin.map((v, i) => (v + monthlyMax[i]) / 2);
  const P = c.monthlyPrecipMm;
  // humid summers: the three warmest months average at least 70 mm of rain and run warm
  const warmest = meanM.map((t, i) => [t, i]).sort((a, b) => b[0] - a[0]).slice(0, 3).map((x) => x[1]);
  const summerRain = warmest.reduce((s, i) => s + P[i], 0) / 3;
  const humid = summerRain >= 70 && Math.max(...meanM) >= 21;
  const arid = (c.koppen?.code || '').startsWith('B');
  if (c.chillMethod && c.chillMethod !== 'hourly') notes.push('Chill hours are estimated from daily highs and lows.');
  notes.push('Climate cells are about 10 km across, so valleys can be colder and hilltops milder than shown. If you know your local zone or frost dates, set them in the Site panel.');

  return {
    lat, zoneNum, zoneLabel, zoneSource, extremeMinC: zoneMinC(zoneNum),
    frostFree, lastMean, lastSafe, firstMean, firstSafe, frostFreeDays,
    chill: c.chillHours ?? null, gdd: c.gdd10 ?? null,
    hottestMaxC: Math.max(...monthlyMax), coldestMeanC: Math.min(...meanM),
    humid, arid, annualPrecipMm: c.annualPrecipMm, wetSeason: c.wetSeason, koppen: c.koppen ?? null,
    lo: curve(monthlyMin), hi: curve(monthlyMax), mean: curve(meanM), rain: curve(P), notes,
  };
}

// ---------------------------------------------------------------- the zone's microclimate

export interface ZoneConditions {
  area: number;
  meanSlope: number;
  aspect: number | null; // compass degrees the zone faces, null when flat
  aspectName: string;
  sunHours: number | null; // average daily direct sun through the growing season
  wetFraction: number; // share of the zone on natural drainage lines
  lowSpot: boolean; // sits in the bottom of the land, where cold air pools
  elevMin: number;
  elevMax: number;
  zoneShift: number; // half-zone adjustments for warm slopes and frost pockets
  frostShiftDays: number; // later spring frost, earlier fall frost when negative
  notes: string[];
}

export function microclimate(z: Omit<ZoneConditions, 'zoneShift' | 'frostShiftDays' | 'notes'>, lat: number, soil?: Soil | null): ZoneConditions {
  const notes: string[] = [];
  let zoneShift = 0, frostShiftDays = 0;
  const sunward = lat >= 0 ? 180 : 0;
  if (z.aspect != null && z.meanSlope >= 8) {
    const off = Math.abs(((z.aspect - sunward + 540) % 360) - 180);
    if (off <= 50) { zoneShift += 0.5; frostShiftDays += 7; notes.push(`Faces the sun on a ${z.meanSlope.toFixed(0)}% slope: warmer, earlier, about half a zone milder.`); }
    else if (off >= 130) { zoneShift -= 0.5; frostShiftDays -= 7; notes.push(`Faces away from the sun on a ${z.meanSlope.toFixed(0)}% slope: cooler and later; good for plants that bloom too early elsewhere.`); }
  }
  if (z.lowSpot) { zoneShift -= 0.5; frostShiftDays -= 10; notes.push('Sits low in the land where cold air drains and pools: a frost pocket. Avoid early-blooming fruit here.'); }
  if (z.wetFraction > 0.15) notes.push('Natural drainage lines run through it: wetter ground, good for plants that like moisture.');
  const poorDrainage = /poorly|very poorly/i.test(soil?.drainage || '');
  if (poorDrainage) notes.push(`The soil survey says ${String(soil!.drainage).toLowerCase()}: raise beds or mound trees that hate wet feet.`);
  if (z.meanSlope > 25) notes.push('Steep: terrace or contour beds before planting annuals.');
  if (z.sunHours != null && z.sunHours < 6) notes.push(`About ${z.sunHours.toFixed(1)} hours of direct sun a day: shade-tolerant plants do best.`);
  return { ...z, zoneShift, frostShiftDays, notes };
}

// ---------------------------------------------------------------- results

export type Status = 'good' | 'possible' | 'no';
export interface Range { start: number; end: number }
export interface CalendarLine { kind: 'indoor' | 'sow' | 'transplant' | 'plant' | 'harvest' | 'note'; label: string; ranges: Range[]; text?: string }
export interface Advice {
  species: Species;
  status: Status;
  good: string[];
  issues: { level: 'info' | 'warn' | 'fail'; text: string }[];
  calendar: CalendarLine[];
  variety: string | null;
  spacing: string;
  fits: number | null;
}

const fmtRange = (r: Range) => (r.end - r.start + 365) % 365 >= 355 ? 'any time of year' : `${doyLabel(r.start)} to ${doyLabel(r.end)}`;
export const rangesText = (rs: Range[]) => rs.map(fmtRange).join(', and ');

// ---------------------------------------------------------------- annual crop simulation

interface SimOpts { protect: boolean; shift: number }

function frostFreeOn(sc: SiteClimate, d: number, o: SimOpts) {
  if (sc.frostFree) return true;
  const ext = (o.protect ? 14 : 0) + o.shift;
  const start = wrap(sc.lastSafe! - ext), end = wrap(sc.firstSafe! + ext);
  const len = (end - start + 365) % 365;
  return ((wrap(d) - start + 365) % 365) <= len;
}

// Thermal time: a crop needs warmth, not days. "70 days" is measured in a decent season, so
// it becomes degree-days above a base temperature; cool weather stretches the real time.
const TT = { cool: { base: 4, ref: 15, cap: 22 }, warm: { base: 10, ref: 21, cap: 30 } };

interface Sim { plant: Range[]; mature: Range[] }

/** Valid days of the year to plant (or transplant), and when those plantings come ready. */
function plantingWindows(sc: SiteClimate, sp: Species, days: number, o: SimOpts): Sim {
  const c = sp.crop!;
  const tt = TT[c.season];
  const need = days * (tt.ref - tt.base);
  const warmAdj = o.protect ? 3 : 0;
  const ok = new Array(366).fill(false), ready = new Array(366).fill(false);
  const transplant = days === c.days && (c.method === 'transplant' || c.method === 'either');
  const trigger = c.daylengthBulb ? onionTrigger(sc.lat) : 0;
  // hot, wet tropical months (warm nights and heavy rain): disease and rot for temperate crops
  const steamy = (d: number) => sc.lo(d) >= 23.5 && sc.rain(d) >= 120;
  for (let p = 1; p <= 365; p++) {
    // transplants go out a little cooler than seed needs to germinate
    if (sc.mean(p) + warmAdj < c.plantMinC - (transplant ? 2 : 0)) continue;
    // walk forward accumulating warmth until the crop is ready, or give up
    let acc = 0, t = p, limit = p + Math.round(days * 2.2);
    while (acc < need && t <= limit) { acc += Math.max(0, Math.min(tt.cap, sc.mean(t) + warmAdj) - tt.base); t++; }
    if (acc < need) continue;
    const mat = t;
    let pass = true;
    for (let d = p + (c.emergeDays || 0); d <= mat; d += 2) {
      const lo = sc.lo(d) + warmAdj;
      if (c.killC >= -1.5) {
        // tender: no frost at all, and nights not near the kill temperature
        if (!frostFreeOn(sc, d, o) || lo < c.killC + 3) { pass = false; break; }
      } else if (lo < c.killC + 2) { pass = false; break; }
    }
    if (!pass) continue;
    // Warm crops flower and set fruit through the middle of their life; cool crops bolt as they
    // near maturity. Check heat and nights over the stretch that matters for each.
    const [f0, f1] = c.season === 'warm' ? [0.3, 0.8] : [0.5, 1];
    let hi = 0, lo = 0, n = 0;
    for (let d = p + Math.round((mat - p) * f0); d <= p + Math.round((mat - p) * f1); d += 2) { hi += sc.hi(d); lo += sc.lo(d) + warmAdj; n++; }
    if (c.daylengthBulb && Math.abs(sc.lat) >= 15 && Math.abs(sc.lat) < 50) {
      // Near the equator days stay about 12 hours and short-day onions bulb whenever grown; far
      // north the whole season is past the trigger, so long-day onions bulb as they mature.
      // Elsewhere: plant in shorter days, give it a month or more of leaf growth, and the
      // lengthening days must pass the trigger while it is still growing.
      if (dayLength(sc.lat, p) >= trigger) continue;
      let cross = -1;
      for (let d = p; d <= mat; d++) if (dayLength(sc.lat, d) >= trigger) { cross = d; break; }
      if (cross < 0 || cross - p < 30 || cross - p > 150) continue;
    }
    if (!c.tropicalOk && !o.protect) {
      let wet = 0, m = 0;
      for (let d = p + Math.round((mat - p) * 0.3); d <= mat; d += 3) { if (steamy(d)) wet++; m++; }
      if (m && wet / m > 0.4) continue;
    }
    if (n) {
      if (hi / n > c.growMaxC) continue;
      if (c.setMinNightC != null && lo / n < c.setMinNightC) continue;
      if (c.nightMaxC != null && lo / n > c.nightMaxC) continue;
    }
    ok[p] = true;
    for (let d = mat; d <= mat + c.harvestWeeks * 7; d++) ready[((d - 1) % 365) + 1] = true;
  }
  return { plant: runs(ok), mature: runs(ready) };
}

function runs(ok: boolean[]): Range[] {
  const out: Range[] = [];
  let s = -1;
  for (let d = 1; d <= 365; d++) {
    if (ok[d] && s < 0) s = d;
    if (!ok[d] && s >= 0) { out.push({ start: s, end: d - 1 }); s = -1; }
  }
  if (s >= 0) out.push({ start: s, end: 365 });
  // join a run that crosses the new year
  if (out.length > 1 && out[0].start === 1 && out[out.length - 1].end === 365) {
    const last = out.pop()!;
    out[0] = { start: last.start, end: out[0].end };
  }
  return out.filter((r) => ((r.end - r.start + 365) % 365) + 1 >= 6);
}

const shiftR = (rs: Range[], by: number) => rs.map((r) => ({ start: wrap(r.start + by), end: wrap(r.end + by) }));
const lengthOf = (rs: Range[]) => rs.reduce((s, r) => s + ((r.end - r.start + 365) % 365) + 1, 0);

const FALL_OFFSETS: Record<string, [number, number]> = {
  garlic: [-14, 28], winterwheat: [-35, -7], cerealrye: [-42, 14], hairyvetch: [-56, -21], crimsonclover: [-56, -28],
};

function annualAdvice(sp: Species, sc: SiteClimate, zc: ZoneConditions | null, pz: number, out: Advice) {
  const c = sp.crop!;
  const shift = zc?.frostShiftDays ?? 0;
  if (pz === 0) {
    if (!sp.container) { out.issues.push({ level: 'fail', text: 'Not a plant for indoors or pots.' }); return; }
    out.good.push('Grows indoors on a sunny windowsill or under a grow light, whatever the weather.');
    out.calendar.push({ kind: 'sow', label: 'Sow indoors', ranges: [{ start: 1, end: 365 }], text: c.successionDays ? `again every ${c.successionDays} days` : undefined });
    out.calendar.push({ kind: 'harvest', label: 'Harvest', ranges: [{ start: 1, end: 365 }], text: `about ${c.days} days after sowing` });
    return;
  }

  if (c.method === 'fall') {
    const killOk = sc.extremeMinC >= c.killC;
    if (!killOk) { out.issues.push({ level: 'fail', text: `Winter here drops to about ${Math.round(sc.extremeMinC)} C; it dies below ${c.killC} C.` }); return; }
    let sow: Range;
    if (sc.frostFree || sc.firstMean == null) {
      if (sp.id === 'winterwheat') { out.issues.push({ level: 'fail', text: 'Winter wheat needs a cold winter to form heads. Grow oats or barley in the cool season instead.' }); return; }
      if (sc.coldestMeanC > 18) { out.issues.push({ level: 'fail', text: 'Never cool enough here. Use a warm-season cover such as sunn hemp or cowpea.' }); return; }
      const coolest = [...Array(365)].map((_, i) => i + 1).reduce((b, d) => (sc.mean(d) < sc.mean(b) ? d : b), 1);
      sow = { start: wrap(coolest - 75), end: wrap(coolest - 40) };
      out.issues.push({ level: 'warn', text: 'Grown through your cool season rather than over a frozen winter.' });
      if (sp.id === 'garlic') out.issues.push({ level: 'warn', text: 'Mild winters give small bulbs: chill the cloves in the fridge for 8 weeks before planting.' });
    } else {
      const [a, b] = FALL_OFFSETS[sp.id] || [-42, -7];
      sow = { start: wrap(sc.firstMean + a), end: wrap(sc.firstMean + b) };
    }
    out.good.push(`Hardy to ${c.killC} C; your coldest nights average about ${Math.round(sc.extremeMinC)} C.`);
    out.calendar.push({ kind: 'sow', label: sp.id === 'garlic' ? 'Plant cloves' : 'Sow', ranges: [sow], text: `${c.depthCm} cm deep` });
    out.calendar.push({ kind: 'harvest', label: sp.category === 'cover' ? 'Cut or turn in' : 'Harvest', ranges: [{ start: wrap(sow.start + c.days), end: wrap(sow.end + c.days + c.harvestWeeks * 7) }] });
    return;
  }

  const base: SimOpts = { protect: false, shift };
  const trans = c.method === 'transplant' || c.method === 'either';
  const direct = c.method !== 'transplant';
  const directDays = c.days + (c.method === 'either' ? 14 : 0);
  const none: Sim = { plant: [], mature: [] };
  let tw = trans ? plantingWindows(sc, sp, c.days, base) : none;
  let dw = direct ? plantingWindows(sc, sp, directDays, base) : none;
  let protectedOnly = false;
  if (!tw.plant.length && !dw.plant.length) {
    const prot: SimOpts = { protect: true, shift };
    tw = trans ? plantingWindows(sc, sp, c.days, prot) : none;
    dw = direct ? plantingWindows(sc, sp, directDays, prot) : none;
    protectedOnly = tw.plant.length + dw.plant.length > 0;
  }
  if (!tw.plant.length && !dw.plant.length) {
    let why: string;
    if (c.season === 'warm') {
      if (!sc.frostFree && sc.frostFreeDays < c.days) why = `Needs about ${c.days} warm, frost-free days; you get about ${sc.frostFreeDays}.`;
      else if (c.nightMaxC != null && sc.lo(sc.lat >= 0 ? 196 : 15) > c.nightMaxC && sc.coldestMeanC > c.plantMinC) why = 'Nights here stay too warm for it to set a crop, even in the cooler months.';
      else if (sc.hottestMaxC > c.growMaxC && sc.coldestMeanC > c.plantMinC) why = 'Too hot here for it to set a crop at any time of year.';
      else why = 'Summers here are too short or too cool for it to ripen.';
    } else {
      why = sc.coldestMeanC > c.plantMinC + 10 ? 'Never cool enough here: it bolts or sulks before it is ready.' : 'No season here is both cool enough and frost-safe enough for it to mature.';
    }
    out.issues.push({ level: 'fail', text: why });
    return;
  }
  if (protectedOnly) out.issues.push({ level: 'warn', text: 'Only works with protection: a row cover, cold frame or greenhouse adds the few degrees it needs.' });
  else if (lengthOf(tw.plant) + lengthOf(dw.plant) < 18) out.issues.push({ level: 'warn', text: 'The planting window here is short; plant on time.' });
  else out.good.push(c.season === 'warm' ? 'Your frost-free season and summer heat suit it.' : 'Your cool seasons suit it.');

  if (tw.plant.length) {
    out.calendar.push({ kind: 'indoor', label: 'Start seeds indoors', ranges: shiftR(tw.plant, -(c.indoorWeeks || 6) * 7), text: `${c.depthCm} cm deep, ${c.indoorWeeks || 6} weeks before planting out` });
    out.calendar.push({ kind: 'transplant', label: 'Plant out', ranges: tw.plant, text: c.successionDays ? `repeat every ${c.successionDays} days` : undefined });
  }
  if (dw.plant.length) {
    const verb = c.method === 'tuber' ? 'Plant seed pieces' : c.method === 'slips' ? 'Plant slips' : c.method === 'sets' ? 'Plant sets' : 'Sow outdoors';
    out.calendar.push({ kind: 'sow', label: verb, ranges: dw.plant, text: `${c.depthCm} cm deep${c.successionDays ? `, again every ${c.successionDays} days` : ''}` });
  }
  const mature = tw.plant.length ? tw.mature : dw.mature;
  out.calendar.push({ kind: 'harvest', label: 'Harvest', ranges: mature, text: `about ${c.days} days from ${tw.plant.length ? 'planting out' : 'sowing'} in good weather, longer when cool` });
}

// ---------------------------------------------------------------- perennial checks

function perennialAdvice(sp: Species, sc: SiteClimate, zc: ZoneConditions | null, pz: number, out: Advice) {
  const zone = sc.zoneNum + (zc?.zoneShift ?? 0);
  const inPot = pz === 0 && sp.container;
  // hardiness
  if (zone < sp.zoneMin) {
    if (inPot) out.issues.push({ level: 'warn', text: `Too cold outdoors (needs zone ${sp.zoneMin}+, here ${fmtZone(zone)}): keep it in a pot and bring it indoors for winter.` });
    else if (zone >= sp.zoneMin - 0.5) out.issues.push({ level: 'warn', text: `At the cold edge (needs zone ${sp.zoneMin}, here ${fmtZone(zone)}): only in the warmest, most sheltered spot, against a sunny wall.` });
    else { out.issues.push({ level: 'fail', text: `Too cold: survives to zone ${sp.zoneMin}, this spot is zone ${fmtZone(zone)}.` }); }
  } else if (zone >= sp.zoneMax + 1) {
    if (zone < sp.zoneMax + 1.5) out.issues.push({ level: 'warn', text: `At the warm edge of its range (zones ${sp.zoneMin} to ${sp.zoneMax}, here ${fmtZone(zone)}).` });
    else out.issues.push({ level: 'fail', text: `Too warm: it grows in zones ${sp.zoneMin} to ${sp.zoneMax} and needs real winters; this is zone ${fmtZone(zone)}.` });
  } else out.good.push(`Hardy here: zones ${sp.zoneMin} to ${sp.zoneMax}, this spot is ${fmtZone(zone)}.`);
  // winter chill
  // Chill hours only limit plants where winters are mild; a winter that freezes solid
  // always meets dormancy, even though few hours fall in the 0 to 7 C band.
  if (sp.chill && sc.chill != null && !inPot && sc.coldestMeanC < 0) out.good.push('Cold winters easily meet its chilling needs.');
  else if (sp.chill && sc.chill != null && !inPot) {
    const [need] = sp.chill;
    if (sc.chill < need) out.issues.push({ level: 'fail', text: `Needs at least ${need} chill hours to flower; you get about ${sc.chill}.` });
    else if (sc.chill < need * 1.2) out.issues.push({ level: 'warn', text: `Just enough winter chill (${sc.chill} hours, lowest-chill types need ${need}).` });
    else out.good.push(`Winter chill is enough (${sc.chill} hours).`);
  }
  // summer heat and season length
  if (sp.heatMaxC && sc.hottestMaxC > sp.heatMaxC) {
    if (sc.hottestMaxC > sp.heatMaxC + 4) out.issues.push({ level: 'fail', text: `Summers are too hot: days average ${Math.round(sc.hottestMaxC)} C in the hottest month; it fades above ${sp.heatMaxC} C.` });
    else out.issues.push({ level: 'warn', text: `Summer heat stresses it (${Math.round(sc.hottestMaxC)} C days): give it afternoon shade.` });
  }
  if (sp.gddMin && sc.gdd != null && sc.gdd < sp.gddMin) {
    out.issues.push({ level: sc.gdd < sp.gddMin * 0.85 ? 'fail' : 'warn', text: `Needs more summer heat to ripen (${sp.gddMin} growing degree days; you get ${sc.gdd}).` });
  }
  if (sp.frostFreeMin && sc.frostFreeDays < sp.frostFreeMin) {
    out.issues.push({ level: sc.frostFreeDays < sp.frostFreeMin * 0.85 ? 'fail' : 'warn', text: `Needs about ${sp.frostFreeMin} frost-free days to ripen; you get about ${sc.frostFreeDays}.` });
  }
  if (sp.humidOk === false && sc.humid) out.issues.push({ level: 'warn', text: 'Your humid summers bring disease and rot: give it airflow, full sun and sharp drainage.' });
  if (sp.dryOk === false && sc.arid) out.issues.push({ level: 'warn', text: 'Dry desert air stresses it: needs shade, mulch and steady water.' });
}

const fmtZone = (z: number) => `${Math.floor(z)}${z % 1 >= 0.5 ? 'b' : 'a'}`;

function perennialCalendar(sp: Species, sc: SiteClimate, out: Advice) {
  const lines: CalendarLine[] = [];
  const shiftMonth = (m: number) => (sc.lat < 0 ? ((m + 5) % 12) + 1 : m);
  let plant: Range[];
  let how = sp.stock || 'plant';
  if (sc.frostFree) {
    const ws = sc.wetSeason;
    if (ws && !ws.allYear && ws.startMonth) { const s = MID[ws.startMonth - 1] - 14; plant = [{ start: wrap(s), end: wrap(s + 60) }]; how += ', at the start of the rains'; }
    else plant = [{ start: 1, end: 365 }];
  } else if (sp.stock === 'seed') {
    plant = sp.category === 'pasture' && (sp.zoneMin >= 7)
      ? [{ start: wrap(sc.lastSafe! + 14), end: wrap(sc.lastSafe! + 60) }]
      : [{ start: wrap(sc.lastMean! - 14), end: wrap(sc.lastMean! + 30) }, { start: wrap(sc.firstMean! - 60), end: wrap(sc.firstMean! - 40) }];
  } else if (sp.id === 'strawberry' && sc.zoneNum >= 9) {
    plant = [{ start: wrap(sc.firstMean! - 50), end: wrap(sc.firstMean! - 20) }];
    how += ', in autumn as a winter crop';
  } else if (!sp.deciduous || sp.zoneMin >= 8) {
    // evergreen or tender: plant after frost so the roots settle in before the next winter
    plant = [{ start: sc.lastSafe!, end: wrap(sc.lastSafe! + 75) }];
  } else if (sc.zoneNum >= 8) {
    plant = [{ start: wrap(sc.firstMean! + 14), end: wrap(sc.lastMean! - 7) }];
    how += ', while dormant in winter';
  } else {
    plant = [{ start: wrap(sc.lastMean! - 35), end: wrap(sc.lastMean! + 14) }];
    how += ', in early spring as soon as the soil can be worked';
    if (sp.stock?.includes('container')) plant.push({ start: wrap(sc.firstMean! - 56), end: wrap(sc.firstMean! - 28) });
  }
  lines.push({ kind: 'plant', label: 'Plant', ranges: plant, text: how });
  if (sp.harvest.length) {
    const months = sp.harvest.map(shiftMonth);
    lines.push({ kind: 'harvest', label: 'Harvest', ranges: monthsToRanges(months), text: sp.firstHarvestYears ? `first crop after about ${sp.firstHarvestYears < 1 ? 'a few months' : `${sp.firstHarvestYears} year${sp.firstHarvestYears > 1 ? 's' : ''}`}` : undefined });
  }
  if (sp.prune.length) lines.push({ kind: 'note', label: 'Prune', ranges: monthsToRanges(sp.prune.map(shiftMonth)) });
  out.calendar.push(...lines);
}

function monthsToRanges(months: number[]): Range[] {
  const ok = new Array(366).fill(false);
  const starts = [1, 32, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335, 366];
  for (const m of months) for (let d = starts[m - 1]; d < starts[m]; d++) ok[d] = true;
  return runs(ok);
}

// ---------------------------------------------------------------- the whole judgement

export function advise(sp: Species, sc: SiteClimate, zc: ZoneConditions | null, pz: number, soil: Soil | null | undefined): Advice {
  const out: Advice = { species: sp, status: 'good', good: [], issues: [], calendar: [], variety: null, spacing: '', fits: null };
  if (sp.life === 'annual' && sp.crop) annualAdvice(sp, sc, zc, pz, out);
  else { perennialAdvice(sp, sc, zc, pz, out); if (!out.issues.some((i) => i.level === 'fail')) perennialCalendar(sp, sc, out); }

  // rainfall, for the outer zones that are not watered by hand
  const needMm = { low: 250, medium: 600, high: 900 }[sp.water];
  if (sc.annualPrecipMm < needMm) {
    if (pz >= 3) out.issues.push({ level: 'warn', text: `Rain alone (${sc.annualPrecipMm} mm a year) is not enough; it needs about ${needMm} mm or irrigation.` });
    else if (pz > 0) out.issues.push({ level: 'info', text: `Plan to water it: it needs about ${needMm} mm a year and ${sc.annualPrecipMm} mm falls.` });
  } else if (sp.droughtOk && sc.annualPrecipMm < 500) out.good.push('Drought tolerant, which suits your dry climate.');

  // soil
  const ph = soil?.pH;
  if (sp.ph && ph != null) {
    if (ph > sp.ph[1] + 0.3) out.issues.push({ level: ph > sp.ph[1] + 1.5 ? 'fail' : 'warn', text: `Wants pH ${sp.ph[0]} to ${sp.ph[1]}; your soil survey says ${ph}. ${ph > sp.ph[1] + 1.5 ? 'Only in a raised bed or tub of acid mix.' : 'Lower it with elemental sulphur and acid mulch.'}` });
    else if (ph < sp.ph[0] - 0.3) out.issues.push({ level: 'warn', text: `Wants pH ${sp.ph[0]} to ${sp.ph[1]}; your soil survey says ${ph}. Add lime.` });
  }
  const wet = (zc && zc.wetFraction > 0.15) || /poorly/i.test(soil?.drainage || '');
  if (wet && sp.wetOk === false) out.issues.push({ level: 'warn', text: 'This ground holds water and it hates wet roots: plant on a mound or raised bed.' });
  if (wet && sp.wetOk) out.good.push('Takes the wet ground here.');

  // sun
  if (zc?.sunHours != null && pz > 0) {
    const h = zc.sunHours;
    if (sp.sun === 'full' && h < 6) out.issues.push({ level: h < 3.5 ? 'fail' : 'warn', text: `Wants 6+ hours of direct sun; this zone gets about ${h.toFixed(1)}.` });
    else if (sp.sun === 'shade' && h > 7) out.issues.push({ level: 'warn', text: 'Wants shade: tuck it under trees or on the shady side of a building.' });
    else if (sp.sun !== 'full' && h < 6) out.good.push(`Happy with this zone's ${h.toFixed(1)} hours of sun.`);
  }

  if (sp.caution) out.issues.push({ level: 'info', text: sp.caution });

  out.status = out.issues.some((i) => i.level === 'fail') ? 'no' : out.issues.some((i) => i.level === 'warn') ? 'possible' : 'good';
  out.variety = pickVariety(sp, sc);
  const sm = sp.crop ? sp.crop.spacingCm / 100 : sp.spacingM ?? Math.max(0.3, sp.spreadM * 0.9);
  const rm = sp.crop?.rowCm ? sp.crop.rowCm / 100 : sm;
  out.spacing = sp.crop ? `${sp.crop.spacingCm} cm apart${sp.crop.rowCm ? `, rows ${sp.crop.rowCm} cm` : ''}` : `${sm} m apart`;
  // annuals: how many fit in one standard 1.2 x 4 m bed; perennials: how many fit in the zone
  if (sp.crop) out.fits = Math.max(1, Math.floor(1.2 / Math.min(1.2, rm)) * Math.floor(4 / Math.min(4, sm)));
  else if (zc && zc.area > 0) out.fits = Math.max(1, Math.floor(zc.area / (sm * rm)));
  return out;
}

export function pickVariety(sp: Species, sc: SiteClimate): string | null {
  for (const v of sp.varieties || []) {
    const w = v.when;
    if (w.chillMax != null && (sc.chill == null || sc.chill > w.chillMax)) continue;
    if (w.chillMin != null && (sc.chill == null || sc.chill < w.chillMin)) continue;
    if (w.zoneMax != null && sc.zoneNum >= w.zoneMax + 1) continue;
    if (w.zoneMin != null && sc.zoneNum < w.zoneMin) continue;
    if (w.latMax != null && Math.abs(sc.lat) > w.latMax) continue;
    if (w.latMin != null && Math.abs(sc.lat) < w.latMin) continue;
    if (w.humid && !sc.humid) continue;
    if (w.dry && sc.humid) continue;
    if (w.hot && sc.hottestMaxC < 33) continue;
    if (w.coolSummer && sc.hottestMaxC >= 24) continue;
    if (w.shortSeason && (sc.frostFree || sc.frostFreeDays >= 150)) continue;
    return v.text;
  }
  return null;
}

/** Which planting jobs from a calendar fall inside a given day-of-year span. */
export function jobsBetween(cal: CalendarLine[], from: number, to: number) {
  const inSpan = (r: Range) => {
    const len = (r.end - r.start + 365) % 365;
    for (let d = from; d <= to; d++) if (((wrap(d) - r.start + 365) % 365) <= len) return true;
    return false;
  };
  return cal.filter((l) => l.kind !== 'note' && l.ranges.some(inSpan));
}
