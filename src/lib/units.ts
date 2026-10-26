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

const num = (v: number, d = 1) => (Math.abs(v - Math.round(v)) < 0.05 ? String(Math.round(v)) : v.toFixed(d));
const toF = (c: number) => Math.round((c * 9) / 5 + 32);
const inch = (cm: number) => { const v = cm / 2.54; return v < 2 ? num(Math.round(v * 4) / 4, 2).replace(/\.?0+$/, '') : num(v, 0); };
const feet = (m: number) => { const v = m * 3.28084; return v < 10 ? num(v, 1) : num(v, 0); };

/**
 * Plant advice is written in metric ("30 cm apart", "a 1.2 x 4 m bed", "0 and 7 C"). In imperial
 * mode this rewrites those phrases so a US grower never has to convert in their head.
 */
export function localizeText(text: string, u: Units): string {
  if (u !== 'imperial' || !text) return text;
  return text
    .replace(/(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*m\b/g, (_, a, b) => `${feet(+a)} x ${feet(+b)} ft`)
    .replace(/(-?\d+(?:\.\d+)?)\s*(and|to)\s*(-?\d+(?:\.\d+)?)\s*°?\s?C\b/g, (_, a, w, b) => `${toF(+a)} ${w} ${toF(+b)}°F`)
    .replace(/(-?\d+(?:\.\d+)?)\s*°\s?C\b/g, (_, a) => `${toF(+a)}°F`)
    .replace(/(-?\d+(?:\.\d+)?)\s+C\b(?![a-z])/g, (_, a) => `${toF(+a)}°F`)
    .replace(/(\d+(?:\.\d+)?)\s*mm\b/g, (_, a) => `${num(+a / 25.4, 1)} in`)
    .replace(/(\d+(?:\.\d+)?)\s*cm\b/g, (_, a) => `${inch(+a)} in`)
    .replace(/(\d+(?:\.\d+)?)\s*(?:to|-)\s*(\d+(?:\.\d+)?)\s*m\b/g, (_, a, b) => `${feet(+a)} to ${feet(+b)} ft`)
    .replace(/(\d+(?:\.\d+)?)\s*m\b(?!²|³)/g, (_, a) => `${feet(+a)} ft`)
    .replace(/(\d+(?:\.\d+)?)\s*m2\b/g, (_, a) => `${Math.round(+a * 10.7639).toLocaleString()} sq ft`)
    .replace(/(\d+(?:\.\d+)?)\s*m²/g, (_, a) => `${Math.round(+a * 10.7639).toLocaleString()} sq ft`)
    .replace(/(\d+(?:\.\d+)?)\s*km\b/g, (_, a) => `${num(+a * 0.621371, 1)} miles`);
}

/** Contour choices that read naturally: whole feet in imperial, metres in metric. Values are metres. */
export const contourChoices = (u: Units) => (u === 'imperial' ? [1, 2, 5, 10, 20, 50, 100].map((ft) => ({ m: ft / 3.28084, label: `${ft} ft` })) : [0.25, 0.5, 1, 2, 5, 10, 20].map((m) => ({ m, label: `${m} m` })));

/** Metres shown as an editable number in the person's units. */
export const lenIn = (m: number, u: Units) => (u === 'imperial' ? +(m * 3.28084).toFixed(1) : +m.toFixed(2));
export const lenOut = (v: number, u: Units) => (u === 'imperial' ? v / 3.28084 : v);
