// The plan a designer hands a client: the land seen straight down at a true scale, every element
// drawn as a symbol, with a legend, north arrow, scale bar and a title block. It is drawn from the
// design data onto the same ground texture the 3D view uses, so what prints is what was designed.
import type { Feature, SiteObject, Site } from './types';
import { SPECIES_BY_ID } from './plants';
import { ZONE_COLORS, ZONE_NAMES } from './mapTexture';
import type { Units } from './units';

export interface TitleBlock {
  title: string; address: string; client?: string; designer?: string; business?: string; contact?: string;
  date: string; phaseLabel?: string; note?: string;
}

const W = 3300, H = 2550; // 11 x 8.5 inches at 300 dpi
const MAP = 2350; // the map square on the left
const PAD = 90;

const NICE = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000];

export function drawPlan(ground: HTMLCanvasElement, site: Site, objects: SiteObject[], features: Feature[], units: Units, tb: TitleBlock): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fbfaf6'; ctx.fillRect(0, 0, W, H);
  const ox = PAD, oy = (H - MAP) / 2;
  ctx.drawImage(ground, ox, oy, MAP, MAP);
  ctx.strokeStyle = '#1c2a1f'; ctx.lineWidth = 4; ctx.strokeRect(ox, oy, MAP, MAP);
  const px = MAP / site.size;
  const P = (x: number, y: number): [number, number] => [ox + (x + site.size / 2) * px, oy + (site.size / 2 - y) * px];
  ctx.save();
  ctx.beginPath(); ctx.rect(ox, oy, MAP, MAP); ctx.clip();

  // trees and plants: canopy circles at mature size, small plants as dots
  const plants = objects.filter((o) => o.type === 'plant');
  const sorted = [...plants].sort((a, b) => (SPECIES_BY_ID[b.species || '']?.spreadM ?? 0) - (SPECIES_BY_ID[a.species || '']?.spreadM ?? 0));
  for (const o of sorted) {
    const sp = SPECIES_BY_ID[o.species || ''];
    if (!sp) continue;
    const [x, y] = P(o.x, o.y);
    const r = Math.max(5, (sp.spreadM / 2) * o.scale * px);
    const existing = o.status === 'existing';
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = existing ? 'rgba(120,130,120,0.45)' : hexA(sp.leaf, sp.heightM >= 3 ? 0.55 : 0.8); ctx.fill();
    ctx.lineWidth = sp.heightM >= 3 ? 3 : 1.5; ctx.strokeStyle = existing ? '#4b524c' : shade(sp.leaf, -0.45); ctx.stroke();
    if (sp.heightM >= 3) { ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.fillStyle = '#1c2a1f'; ctx.fill(); }
  }
  // structures
  const label = (t: string, x: number, y: number, size = 30) => {
    ctx.font = `600 ${size}px Inter, system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 7; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.strokeText(t, x, y); ctx.fillStyle = '#1c2a1f'; ctx.fillText(t, x, y);
  };
  for (const o of objects.filter((o) => o.type !== 'plant')) {
    const [x, y] = P(o.x, o.y);
    const existing = o.status === 'existing';
    ctx.save(); ctx.translate(x, y); ctx.rotate(((o.rotation || 0) * Math.PI) / 180);
    const box = (w: number, d: number, fill: string, stroke = '#1c2a1f') => {
      ctx.fillStyle = existing ? '#b9bdb6' : fill; ctx.fillRect((-w * px) / 2, (-d * px) / 2, w * px, d * px);
      ctx.lineWidth = 3; ctx.strokeStyle = stroke; ctx.setLineDash(existing ? [10, 6] : []); ctx.strokeRect((-w * px) / 2, (-d * px) / 2, w * px, d * px); ctx.setLineDash([]);
    };
    switch (o.type) {
      case 'building': box((o.width ?? 8) * o.scale, (o.depth ?? 10) * o.scale, '#e9d9bf'); break;
      case 'greenhouse': box((o.width ?? 4) * o.scale, (o.depth ?? 8) * o.scale, '#d9efe6', '#3d7a64'); break;
      case 'garden': box((o.width ?? 1.2) * o.scale, (o.depth ?? 4) * o.scale, '#7a5a3a', '#4a3520'); break;
      case 'coop': box(2.4 * o.scale, 1.8 * o.scale, '#e2c48a'); break;
      case 'compost': box(3 * o.scale, 1.2 * o.scale, '#6b4f32'); break;
      case 'hive': box(0.8, 0.8, '#f5c542'); break;
      case 'tank': { const r = Math.max(6, Math.sqrt((o.capacityL ?? 10000) / 1000 / Math.PI / 2) * px); ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fillStyle = '#7cc3e8'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = '#1d5d80'; ctx.stroke(); break; }
      case 'pond': { ctx.beginPath(); ctx.arc(0, 0, (o.radius ?? 5) * px, 0, Math.PI * 2); ctx.fillStyle = 'rgba(56,150,210,0.75)'; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = '#1d5d80'; ctx.stroke(); break; }
      case 'irrigation': { ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI * 2); ctx.fillStyle = '#38bdf8'; ctx.fill(); break; }
    }
    ctx.restore();
    if (['building', 'greenhouse', 'pond', 'coop', 'tank'].includes(o.type)) label(o.name.length > 22 ? o.name.slice(0, 21) + '…' : o.name, x, y + (o.type === 'pond' ? 0 : Math.max(26, ((o.depth ?? 4) / 2) * px + 26)), 26);
  }
  ctx.restore();

  // north arrow and scale bar on the map
  const nx = ox + MAP - 110, ny = oy + 120;
  ctx.fillStyle = 'rgba(255,255,255,0.88)'; ctx.beginPath(); ctx.arc(nx, ny, 70, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.moveTo(nx, ny - 52); ctx.lineTo(nx + 26, ny + 34); ctx.lineTo(nx, ny + 18); ctx.lineTo(nx - 26, ny + 34); ctx.closePath(); ctx.fillStyle = '#1c2a1f'; ctx.fill();
  ctx.font = '700 34px Inter, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#1c2a1f'; ctx.fillText('N', nx, ny - 82 + 10);
  const unitM = units === 'imperial' ? 0.3048 : 1, unitName = units === 'imperial' ? 'ft' : 'm';
  const target = (MAP * 0.28) / px / unitM;
  const len = NICE.reduce((b, v) => (v <= target ? v : b), NICE[0]);
  const barPx = len * unitM * px, bx = ox + 60, by = oy + MAP - 70;
  ctx.fillStyle = 'rgba(255,255,255,0.88)'; ctx.fillRect(bx - 24, by - 52, barPx + 48, 90);
  for (let k = 0; k < 4; k++) { ctx.fillStyle = k % 2 ? '#ffffff' : '#1c2a1f'; ctx.fillRect(bx + (barPx / 4) * k, by, barPx / 4, 16); }
  ctx.strokeStyle = '#1c2a1f'; ctx.lineWidth = 2; ctx.strokeRect(bx, by, barPx, 16);
  ctx.font = '600 26px Inter, system-ui, sans-serif'; ctx.fillStyle = '#1c2a1f'; ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left'; ctx.fillText('0', bx - 6, by - 12); ctx.textAlign = 'right'; ctx.fillText(`${len} ${unitName}`, bx + barPx + 10, by - 12);

  // title block and legend
  const tx = ox + MAP + 80, tw = W - tx - PAD;
  let ty = oy;
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  const text = (t: string, size: number, weight = 400, color = '#1c2a1f', maxW = tw) => {
    ctx.font = `${weight} ${size}px Inter, system-ui, sans-serif`; ctx.fillStyle = color;
    for (const line of wrap(ctx, t, maxW)) { ctx.fillText(line, tx, ty); ty += size * 1.3; }
  };
  if (tb.business) text(tb.business.toUpperCase(), 26, 700, '#4f7a3a');
  ty += 8;
  text(tb.title, 64, 700);
  ty += 6;
  text(tb.address, 28, 400, '#4b524c');
  ty += 18;
  ctx.fillStyle = '#d7d3c8'; ctx.fillRect(tx, ty, tw, 3); ty += 26;
  const kv = (k: string, v?: string) => { if (!v) return; text(k.toUpperCase(), 21, 700, '#7b8379'); ty -= 4; text(v, 30, 500); ty += 10; };
  kv('Prepared for', tb.client);
  kv('Designed by', [tb.designer, tb.contact].filter(Boolean).join(' · ') || undefined);
  kv('Date', tb.date);
  kv('Showing', tb.phaseLabel);
  kv('Site', `${Math.round(site.size * (units === 'imperial' ? 3.28084 : 1))} ${unitName} square, north up, ${Math.round(site.size / 2350 * 300 * (units === 'imperial' ? 3.28084 : 1) * 100) / 100} ${unitName} per printed inch`);
  ctx.fillStyle = '#d7d3c8'; ctx.fillRect(tx, ty, tw, 3); ty += 26;
  text('LEGEND', 24, 700, '#7b8379'); ty += 4;
  const legend = legendItems(objects, features);
  for (const it of legend) {
    const sy = ty + 18;
    ctx.save();
    if (it.kind === 'circle') { ctx.beginPath(); ctx.arc(tx + 22, sy, 16, 0, Math.PI * 2); ctx.fillStyle = it.fill; ctx.fill(); ctx.lineWidth = 2.5; ctx.strokeStyle = it.stroke; ctx.stroke(); }
    else if (it.kind === 'box') { ctx.fillStyle = it.fill; ctx.fillRect(tx + 4, sy - 14, 36, 28); ctx.lineWidth = 2.5; ctx.strokeStyle = it.stroke; ctx.setLineDash(it.dash || []); ctx.strokeRect(tx + 4, sy - 14, 36, 28); }
    else { ctx.beginPath(); ctx.moveTo(tx + 2, sy); ctx.lineTo(tx + 42, sy); ctx.lineWidth = it.width || 5; ctx.strokeStyle = it.stroke; ctx.setLineDash(it.dash || []); ctx.stroke(); }
    ctx.restore();
    ctx.font = '500 26px Inter, system-ui, sans-serif'; ctx.fillStyle = '#1c2a1f'; ctx.fillText(it.label, tx + 62, sy - 15);
    ty += 44;
    if (ty > oy + MAP - 180) break;
  }
  if (tb.note) { ty = Math.max(ty + 20, oy + MAP - 150); text(tb.note, 20, 400, '#7b8379'); }
  return c;
}

interface LegendItem { kind: 'circle' | 'box' | 'line'; fill: string; stroke: string; label: string; dash?: number[]; width?: number }

function legendItems(objects: SiteObject[], features: Feature[]): LegendItem[] {
  const out: LegendItem[] = [];
  const has = (t: string) => objects.some((o) => o.type === t && o.status !== 'existing');
  const trees = objects.filter((o) => o.type === 'plant' && (SPECIES_BY_ID[o.species || '']?.heightM ?? 0) >= 3);
  const smalls = objects.filter((o) => o.type === 'plant' && (SPECIES_BY_ID[o.species || '']?.heightM ?? 0) < 3);
  if (trees.length) out.push({ kind: 'circle', fill: 'rgba(90,150,60,0.55)', stroke: '#2f5222', label: `Trees, at mature canopy (${trees.length})` });
  if (smalls.length) out.push({ kind: 'circle', fill: 'rgba(140,200,90,0.8)', stroke: '#3d6a2a', label: `Shrubs, herbs and ground covers (${smalls.length})` });
  if (has('building')) out.push({ kind: 'box', fill: '#e9d9bf', stroke: '#1c2a1f', label: 'Buildings' });
  if (objects.some((o) => o.status === 'existing' && o.type !== 'plant')) out.push({ kind: 'box', fill: '#b9bdb6', stroke: '#1c2a1f', label: 'Existing, to keep', dash: [8, 5] });
  if (has('greenhouse')) out.push({ kind: 'box', fill: '#d9efe6', stroke: '#3d7a64', label: 'Greenhouse' });
  if (has('garden')) out.push({ kind: 'box', fill: '#7a5a3a', stroke: '#4a3520', label: 'Garden beds' });
  if (has('pond') || has('tank')) out.push({ kind: 'circle', fill: '#7cc3e8', stroke: '#1d5d80', label: 'Ponds and tanks' });
  if (has('coop') || has('hive') || has('compost')) out.push({ kind: 'box', fill: '#e2c48a', stroke: '#1c2a1f', label: 'Coop, hives, compost' });
  const zones = [...new Set(features.filter((f) => f.kind === 'zone').map((f) => f.zone ?? 1))].sort();
  for (const z of zones) out.push({ kind: 'box', fill: ZONE_COLORS[z] + '55', stroke: ZONE_COLORS[z], label: ZONE_NAMES[z], dash: [10, 6] });
  const kinds: [string, string, string, number[]?, number?][] = [['swale', '#38bdf8', 'Swales on contour', [10, 6]], ['berm', '#d97706', 'Berms', [4, 6]], ['keyline', '#93c5fd', 'Keyline pattern'], ['path', '#c8b08a', 'Paths', undefined, 10], ['fence', '#3b2a1a', 'Fences'], ['paddock', '#d4a95c', 'Paddocks'], ['boundary', '#f8fafc', 'Property line', [18, 8], 6]];
  for (const [k, col, label, dash, width] of kinds) if (features.some((f) => f.kind === k)) out.push({ kind: 'line', fill: col, stroke: k === 'boundary' ? '#1c2a1f' : col, label, dash, width });
  return out;
}

function wrap(ctx: CanvasRenderingContext2D, t: string, w: number) {
  const words = t.split(/\s+/), lines: string[] = [];
  let cur = '';
  for (const word of words) { const next = cur ? cur + ' ' + word : word; if (ctx.measureText(next).width > w && cur) { lines.push(cur); cur = word; } else cur = next; }
  if (cur) lines.push(cur);
  return lines;
}
const hexA = (h: string, a: number) => { const n = parseInt((h || '#5a8f3c').slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; };
const shade = (h: string, f: number) => { const n = parseInt((h || '#5a8f3c').slice(1), 16); const k = (v: number) => Math.max(0, Math.min(255, Math.round(v * (1 + f)))); return `rgb(${k((n >> 16) & 255)},${k((n >> 8) & 255)},${k(n & 255)})`; };
