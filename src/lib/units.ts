export type Units = 'metric' | 'imperial';

const FT = 3.28084;

export const fmtLen = (m: number, u: Units, digits = 1) =>
  u === 'imperial' ? `${(m * FT).toFixed(digits)} ft` : `${m.toFixed(digits)} m`;

export function fmtArea(m2: number, u: Units) {
  if (u === 'imperial') {
    const ft2 = m2 * FT * FT;
    return ft2 >= 21780 ? `${(m2 / 4046.86).toFixed(2)} acres` : `${Math.round(ft2).toLocaleString()} sq ft`;
  }
  return m2 >= 10000 ? `${(m2 / 10000).toFixed(2)} ha` : `${Math.round(m2).toLocaleString()} m²`;
}

export const fmtVol = (m3: number, u: Units) =>
  u === 'imperial' ? `${Math.round(m3 * 1.30795).toLocaleString()} cu yd` : `${Math.round(m3).toLocaleString()} m³`;

export const fmtWater = (litres: number, u: Units) =>
  u === 'imperial' ? `${Math.round(litres * 0.264172).toLocaleString()} gal` : `${Math.round(litres).toLocaleString()} L`;

export const fmtRain = (mm: number, u: Units) => (u === 'imperial' ? `${(mm / 25.4).toFixed(1)} in` : `${Math.round(mm)} mm`);

export const fmtTemp = (c: number, u: Units) => (u === 'imperial' ? `${Math.round(c * 9 / 5 + 32)}°F` : `${Math.round(c)}°C`);

export const SITE_SIZES = [
  { m: 50, label: '50 m (about 0.6 acre)' },
  { m: 100, label: '100 m (about 2.5 acres)' },
  { m: 200, label: '200 m (about 10 acres)' },
  { m: 400, label: '400 m (about 40 acres)' },
  { m: 800, label: '800 m (about 160 acres)' },
  { m: 1600, label: '1.6 km (about 640 acres)' },
];
