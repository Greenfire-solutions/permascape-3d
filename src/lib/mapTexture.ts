// Everything drawn flat on the ground goes into one canvas that becomes the terrain texture:
// satellite photo or hillshade, the analysis overlay, contours, zones, paths and earthwork lines.
import type { Feature, Settings } from './types';
import { Grid, contourSegments, slopeGrid, SLOPE_CLASSES, gradientAt } from './terrain';

export const TEX = 2048;

export const ZONE_COLORS = ['#f59e0b', '#84cc16', '#22c55e', '#14b8a6', '#0ea5e9', '#a855f7'];
export const ZONE_NAMES = ['Zone 0: home', 'Zone 1: daily', 'Zone 2: frequent', 'Zone 3: farm', 'Zone 4: semi-wild', 'Zone 5: wilderness'];
const ASPECT_COLORS = ['#3b82f6', '#06b6d4', '#22c55e', '#a3e635', '#f97316', '#f59e0b', '#facc15', '#a855f7'];

export interface Analysis {
  slope?: Float32Array;
  aspect?: Float32Array;
  flow?: Float32Array;
  sun?: Float32Array; // hours of direct sun per vertex
  sunMax?: number;
}

const hex = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

function ramp(stops: string[], t: number) {
  t = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(t)), f = t - i;
  const a = hex(stops[i]), b = hex(stops[i + 1]);
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

export function computeAnalysis(g: Grid, overlay: Settings['overlay'], prev: Analysis): Analysis {
  const out: Analysis = { ...prev };
  if (overlay === 'slope' || overlay === 'aspect') { const s = slopeGrid(g); out.slope = s.slope; out.aspect = s.aspect; }
  return out;
}

export function composeMap(
  canvas: HTMLCanvasElement, g: Grid, satellite: HTMLCanvasElement | null, s: Settings, a: Analysis,
  features: Feature[], selectedId: string | null,
) {
  if (canvas.width !== TEX) canvas.width = canvas.height = TEX;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, TEX, TEX);
  const W = TEX, w = g.n + 1;
  const toPx = (x: number, y: number): [number, number] => [((x + g.size / 2) / g.size) * W, ((g.size / 2 - y) / g.size) * W];

  // 1. hillshade base, so the land reads as land even without a photo
  const small = document.createElement('canvas');
  small.width = small.height = w;
  const sctx = small.getContext('2d')!;
  const img = sctx.createImageData(w, w);
  const L = [-0.5, 0.5, 0.7]; // light from the north-west, above
  const ll = Math.hypot(L[0], L[1], L[2]);
  for (let r = 0; r < w; r++) for (let c = 0; c < w; c++) {
    const [gx, gy] = gradientAt(g, r, c);
    const nl = Math.hypot(gx, gy, 1);
    const shade = Math.max(0, (-gx * L[0] - gy * L[1] + L[2]) / (nl * ll));
    const i = (r * w + c) * 4;
    img.data[i] = 70 + 90 * shade; img.data[i + 1] = 78 + 80 * shade; img.data[i + 2] = 52 + 50 * shade; img.data[i + 3] = 255;
  }
  sctx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(small, 0.5, 0.5, g.n, g.n, 0, 0, W, W);

  if (satellite && s.satellite) {
    ctx.globalAlpha = s.imageOpacity;
    ctx.drawImage(satellite, 0, 0, W, W);
    ctx.globalAlpha = 1;
  }

  // 2. analysis overlay
  const ov = s.overlay;
  if (ov !== 'none') {
    const oimg = sctx.createImageData(w, w);
    let hmin = Infinity, hmax = -Infinity;
    if (ov === 'elevation') for (const h of g.heights) { if (h < hmin) hmin = h; if (h > hmax) hmax = h; }
    let flowNorm = 1;
    if (ov === 'flow' && a.flow) { let m = 1; for (const v of a.flow) if (v > m) m = v; flowNorm = Math.log(m); }
    for (let i = 0; i < w * w; i++) {
      let rgb: number[] | null = null, alpha = 1;
      if (ov === 'slope' && a.slope) rgb = hex(SLOPE_CLASSES.find((k) => a.slope![i] < k.max)!.color);
      else if (ov === 'aspect' && a.aspect) rgb = a.aspect[i] < 0 ? [160, 160, 160] : hex(ASPECT_COLORS[Math.round(a.aspect[i] / 45) % 8]);
      else if (ov === 'elevation') rgb = ramp(['#1e6b52', '#7fb069', '#e6d36a', '#c2793a', '#8a4b2a', '#f2efe9'], (g.heights[i] - hmin) / ((hmax - hmin) || 1));
      else if (ov === 'flow' && a.flow) {
        const t = Math.log(a.flow[i]) / (flowNorm || 1);
        if (t < 0.25) continue;
        rgb = ramp(['#7dd3fc', '#0284c7', '#1e3a8a'], (t - 0.25) / 0.75);
        alpha = Math.min(1, (t - 0.2) * 2);
      } else if (ov === 'sun' && a.sun) rgb = ramp(['#1e1b4b', '#7c3aed', '#f97316', '#fde047'], a.sun[i] / (a.sunMax || 1));
      if (!rgb) continue;
      const k = i * 4;
      oimg.data[k] = rgb[0]; oimg.data[k + 1] = rgb[1]; oimg.data[k + 2] = rgb[2]; oimg.data[k + 3] = 255 * alpha;
    }
    sctx.clearRect(0, 0, w, w);
    sctx.putImageData(oimg, 0, 0);
    ctx.globalAlpha = s.overlayOpacity;
    ctx.drawImage(small, 0.5, 0.5, g.n, g.n, 0, 0, W, W);
    ctx.globalAlpha = 1;
  }

  // 3. contours, thinned out automatically so a mountain does not turn solid white
  if (s.contours) {
    let hmin = Infinity, hmax = -Infinity;
    for (const h of g.heights) { if (h < hmin) hmin = h; if (h > hmax) hmax = h; }
    let step = s.contourInterval;
    while ((hmax - hmin) / step > 150) step *= 2;
    const onPhoto = satellite && s.satellite && s.imageOpacity > 0.3;
    for (let lv = Math.ceil(hmin / step) * step, k = Math.ceil(hmin / step); lv <= hmax; lv += step, k++) {
      const major = k % 5 === 0;
      const seg = contourSegments(g, lv);
      ctx.beginPath();
      for (let i = 0; i < seg.length; i += 6) {
        ctx.moveTo((seg[i] / g.n) * W, (seg[i + 1] / g.n) * W);
        ctx.lineTo((seg[i + 2] / g.n) * W, (seg[i + 3] / g.n) * W);
      }
      ctx.strokeStyle = onPhoto ? (major ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.35)') : (major ? 'rgba(30,20,10,0.6)' : 'rgba(30,20,10,0.28)');
      ctx.lineWidth = major ? 2.4 : 1.1;
      ctx.stroke();
    }
  }

  const pxPerM = W / g.size;

  // 4. zones
  if (s.layers.zones) for (const f of features) {
    if (f.kind !== 'zone' || f.points.length < 3) continue;
    const col = f.color || ZONE_COLORS[f.zone ?? 1];
    ctx.beginPath();
    f.points.forEach(([x, y], i) => { const [px, py] = toPx(x, y); if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); });
    ctx.closePath();
    ctx.fillStyle = col + '38';
    ctx.fill();
    ctx.setLineDash([14, 8]);
    ctx.lineWidth = f.id === selectedId ? 6 : 3;
    ctx.strokeStyle = f.id === selectedId ? '#ffffff' : col;
    ctx.stroke();
    ctx.setLineDash([]);
    const cx = f.points.reduce((t, p) => t + p[0], 0) / f.points.length, cy = f.points.reduce((t, p) => t + p[1], 0) / f.points.length;
    const [lx, ly] = toPx(cx, cy);
    ctx.font = 'bold 30px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    const label = f.name || ZONE_NAMES[f.zone ?? 1];
    ctx.strokeText(label, lx, ly); ctx.fillStyle = '#fff'; ctx.fillText(label, lx, ly);
  }

  // 5. paths
  if (s.layers.paths) for (const f of features) {
    if (f.kind !== 'path' || f.points.length < 2) continue;
    ctx.beginPath();
    f.points.forEach(([x, y], i) => { const [px, py] = toPx(x, y); if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); });
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(3, (f.width ?? 1.5) * pxPerM);
    ctx.strokeStyle = f.id === selectedId ? '#fde68a' : (f.color || '#c8b08a');
    ctx.stroke();
  }

  // 6. earthwork centre lines
  if (s.layers.earthworks) for (const f of features) {
    if ((f.kind !== 'swale' && f.kind !== 'berm') || f.points.length < 2) continue;
    ctx.beginPath();
    f.points.forEach(([x, y], i) => { const [px, py] = toPx(x, y); if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); });
    ctx.setLineDash(f.kind === 'swale' ? [10, 6] : [4, 6]);
    ctx.lineWidth = f.id === selectedId ? 6 : 3;
    ctx.strokeStyle = f.id === selectedId ? '#ffffff' : f.kind === 'swale' ? '#38bdf8' : '#d97706';
    ctx.stroke();
    ctx.setLineDash([]);
  }
}
