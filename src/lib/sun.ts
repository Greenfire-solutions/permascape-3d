// Solar position (NOAA spreadsheet algorithm, good to about a tenth of a degree).

const rad = Math.PI / 180;

/** Sun azimuth (compass degrees, 0 = north) and altitude (degrees) for a UTC instant. */
export function sunPosition(date: Date, lat: number, lon: number) {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const t = (jd - 2451545) / 36525;
  const L0 = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
  const M = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const C = Math.sin(M * rad) * (1.914602 - t * (0.004817 + 0.000014 * t)) + Math.sin(2 * M * rad) * (0.019993 - 0.000101 * t) + Math.sin(3 * M * rad) * 0.000289;
  const trueLong = L0 + C;
  const omega = 125.04 - 1934.136 * t;
  const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(omega * rad);
  const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * rad);
  const decl = Math.asin(Math.sin(eps * rad) * Math.sin(lambda * rad));
  const y = Math.tan((eps / 2) * rad) ** 2;
  const eqTime = 4 / rad * (y * Math.sin(2 * L0 * rad) - 2 * e * Math.sin(M * rad) + 4 * e * y * Math.sin(M * rad) * Math.cos(2 * L0 * rad)
    - 0.5 * y * y * Math.sin(4 * L0 * rad) - 1.25 * e * e * Math.sin(2 * M * rad));
  const minutes = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
  let tst = (minutes + eqTime + 4 * lon) % 1440;
  if (tst < 0) tst += 1440;
  let ha = tst / 4 - 180;
  if (ha < -180) ha += 360;
  const zen = Math.acos(Math.max(-1, Math.min(1, Math.sin(lat * rad) * Math.sin(decl) + Math.cos(lat * rad) * Math.cos(decl) * Math.cos(ha * rad))));
  const altitude = 90 - zen / rad;
  let az = Math.acos(Math.max(-1, Math.min(1, (Math.sin(lat * rad) * Math.cos(zen) - Math.sin(decl)) / (Math.cos(lat * rad) * Math.sin(zen) || 1e-9)))) / rad;
  az = ha > 0 ? (az + 180) % 360 : (540 - az) % 360;
  return { azimuth: az, altitude };
}

/** Rough solar UTC offset in hours for a longitude, used when a site has no timezone. */
export const solarOffsetHours = (lon: number) => Math.round(lon / 15);

/**
 * A Date for "local clock time" at the site: the calendar day plus hours since midnight,
 * using the longitude's solar offset (no daylight saving, so noon is roughly solar noon).
 */
export function siteInstant(day: string, hours: number, lon: number) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + (hours - solarOffsetHours(lon)) * 3600000);
}

/** Unit vector pointing at the sun in scene space (x east, y up, z south). */
export function sunVector(azimuth: number, altitude: number): [number, number, number] {
  const a = azimuth * rad, h = altitude * rad;
  return [Math.sin(a) * Math.cos(h), Math.sin(h), -Math.cos(a) * Math.cos(h)];
}
