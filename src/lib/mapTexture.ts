// Everything drawn flat on the ground goes into one canvas that becomes the terrain texture:
// satellite photo or hillshade, the analysis overlay, contours, zones, paths and earthwork lines.
import type { Feature, Settings, Surroundings } from './types';
import { Grid, contourSegments, slopeGrid, SLOPE_CLASSES, gradientAt } from './terrain';
import { SECTOR_STYLE, ANIMALS } from './permaculture';

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

/** Soil map units get their own colour, picked by drainage: wet soils blue, dry soils warm. */
export function soilColor(drainage: string | null, i: number) {
  const d = (drainage || '').toLowerCase();
  if (/very poorly|poorly/.test(d) && !/moderately/.test(d)) return '#2563eb';
  if (/somewhat poorly/.test(d)) return '#0ea5e9';
  if (/moderately well/.test(d)) return '#14b8a6';
  if (/excessively/.test(d)) return '#f97316';
  return ['#84cc16', '#eab308', '#a855f7', '#ec4899', '#22c55e', '#f59e0b'][i % 6];
}

export function composeMap(
  canvas: HTMLCanvasElement, g: Grid, satellite: HTMLCanvasElement | null, s: Settings, a: Analysis,
  features: Feature[], selectedId: string | null, ref?: Surroundings | null,
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

  const toPx0 = (x: number, y: number): [number, number] => [((x + g.size / 2) / g.size) * W, ((g.size / 2 - y) / g.size) * W];
  const ring = (pts: [number, number][]) => { ctx.beginPath(); pts.forEach(([x, y], i) => { const [px, py] = toPx0(x, y); if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); }); ctx.closePath(); };
  const hatch = (color: string, gap: number, dir = 1) => { ctx.save(); ctx.clip(); ctx.strokeStyle = color; ctx.lineWidth = 3; for (let k = -W; k < W * 2; k += gap) { ctx.beginPath(); ctx.moveTo(k, 0); ctx.lineTo(k - W * dir, W); ctx.stroke(); } ctx.restore(); };

  // 2b. the soil map: each map unit tinted and outlined
  if (ov === 'soil' && ref?.soils) {
    ref.soils.forEach((u, i) => {
      const col = soilColor(u.drainage, i);
      for (const r of u.rings) { ring(r); ctx.globalAlpha = s.overlayOpacity * 0.6; ctx.fillStyle = col; ctx.fill(); ctx.globalAlpha = 1; ctx.lineWidth = 4; ctx.strokeStyle = col; ctx.stroke(); }
    });
  }

  // 2c. hazards from the public maps: flood areas hatched blue, wetlands teal
  if (s.layers.hazards !== false && ref) {
    for (const z of ref.flood || []) {
      ring(z.ring); ctx.fillStyle = z.sfha ? 'rgba(37,99,235,0.18)' : 'rgba(96,165,250,0.10)'; ctx.fill();
      ring(z.ring); hatch(z.floodway ? 'rgba(37,99,235,0.55)' : 'rgba(59,130,246,0.38)', z.floodway ? 14 : 22);
      ring(z.ring); ctx.setLineDash([16, 8]); ctx.lineWidth = 4; ctx.strokeStyle = '#3b82f6'; ctx.stroke(); ctx.setLineDash([]);
    }
    for (const w of ref.wetlands || []) {
      ring(w.ring); ctx.fillStyle = 'rgba(20,184,166,0.16)'; ctx.fill();
      ring(w.ring); hatch('rgba(20,184,166,0.35)', 26, -1);
      ring(w.ring); ctx.lineWidth = 3; ctx.strokeStyle = '#14b8a6'; ctx.stroke();
    }
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

  // 3b. what is already there: roads, mapped buildings, streams and open water
  const strokeLine = (pts: [number, number][]) => { ctx.beginPath(); pts.forEach(([x, y], i) => { const [px, py] = toPx(x, y); if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); }); };
  if (s.layers.existing !== false && ref) {
    for (const r of ref.osm?.roads || []) {
      const wide = ['primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'trunk'].includes(r.kind);
      strokeLine(r.line); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(5, (wide ? 6 : 3.5) * pxPerM); ctx.strokeStyle = 'rgba(40,36,30,0.55)'; ctx.stroke();
      ctx.lineWidth = Math.max(3, (wide ? 5 : 2.8) * pxPerM); ctx.strokeStyle = 'rgba(214,208,196,0.55)'; ctx.stroke();
    }
    for (const b of ref.osm?.buildings || []) { ring(b.ring); ctx.fillStyle = 'rgba(180,180,170,0.35)'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.setLineDash([8, 5]); ctx.stroke(); ctx.setLineDash([]); }
    for (const w of ref.osm?.water || []) {
      if (w.ring) { ring(w.ring); ctx.fillStyle = 'rgba(56,150,210,0.45)'; ctx.fill(); }
      else if (w.line && !(ref.streams && ref.streams.length)) { strokeLine(w.line); ctx.lineCap = 'round'; ctx.lineWidth = 7; ctx.strokeStyle = 'rgba(56,150,210,0.9)'; ctx.stroke(); }
    }
    for (const st of ref.streams || []) { strokeLine(st.line); ctx.lineCap = 'round'; ctx.lineWidth = /intermittent|ephemeral/.test(st.kind) ? 5 : 8; ctx.setLineDash(/intermittent|ephemeral/.test(st.kind) ? [18, 10] : []); ctx.strokeStyle = 'rgba(30,120,200,0.95)'; ctx.stroke(); ctx.setLineDash([]); }
  }

  // 3c. the property line, with everything outside it dimmed
  const boundary = features.find((f) => f.kind === 'boundary' && f.points.length >= 3);
  if (boundary) {
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, W, W);
    boundary.points.forEach(([x, y], i) => { const [px, py] = toPx(x, y); if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); });
    ctx.closePath();
    ctx.fillStyle = 'rgba(8,12,9,0.42)'; ctx.fill('evenodd');
    ctx.restore();
    ring(boundary.points);
    ctx.lineWidth = boundary.id === selectedId ? 9 : 6; ctx.setLineDash([26, 10, 6, 10]); ctx.strokeStyle = boundary.id === selectedId ? '#fde68a' : '#f8fafc'; ctx.stroke(); ctx.setLineDash([]);
  }

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
    ctx.strokeStyle = f.id === selectedId ? '#fde68a' : (f.color || (f.status === 'existing' ? '#9ca3af' : '#c8b08a'));
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

  const line = (pts: [number, number][]) => { ctx.beginPath(); pts.forEach(([x, y], i) => { const [px, py] = toPx(x, y); if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); }); };
  const label = (text: string, x: number, y: number, size = 26, fill = '#fff') => {
    const [lx, ly] = toPx(x, y);
    ctx.font = `600 ${size}px "Inter Variable", system-ui, sans-serif`; ctx.textAlign = 'center';
    ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.strokeText(text, lx, ly); ctx.fillStyle = fill; ctx.fillText(text, lx, ly);
  };

  // 7. paddocks: hatched ground with the animals named
  if (s.layers.zones) for (const f of features) {
    if (f.kind !== 'paddock' || f.points.length < 3) continue;
    line(f.points); ctx.closePath();
    ctx.fillStyle = 'rgba(212,169,92,0.22)'; ctx.fill();
    ctx.save(); ctx.clip();
    ctx.strokeStyle = 'rgba(212,169,92,0.35)'; ctx.lineWidth = 2;
    for (let k = -W; k < W * 2; k += 22) { ctx.beginPath(); ctx.moveTo(k, 0); ctx.lineTo(k - W, W); ctx.stroke(); }
    ctx.restore();
    line(f.points); ctx.closePath();
    ctx.lineWidth = f.id === selectedId ? 6 : 3.5; ctx.strokeStyle = f.id === selectedId ? '#fff' : '#d4a95c'; ctx.stroke();
    const cx = f.points.reduce((t, p) => t + p[0], 0) / f.points.length, cy = f.points.reduce((t, p) => t + p[1], 0) / f.points.length;
    label(`${f.name}${f.animal ? ` · ${f.head ?? ''} ${ANIMALS[f.animal]?.label.toLowerCase() ?? ''}` : ''}`, cx, cy, 24, '#f6e7c8');
  }

  // 8. fences: posts and wire
  if (s.layers.paths) for (const f of features) {
    if (f.kind !== 'fence' || f.points.length < 2) continue;
    line(f.points); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.lineWidth = f.id === selectedId ? 6 : 3; ctx.strokeStyle = f.id === selectedId ? '#fde68a' : (f.color || '#3b2a1a'); ctx.setLineDash([]); ctx.stroke();
    ctx.lineWidth = 1.4; ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.stroke();
    let carry = 0;
    for (let i = 1; i < f.points.length; i++) {
      const [ax, ay] = f.points[i - 1], [bx, by] = f.points[i], L = Math.hypot(bx - ax, by - ay);
      for (let d = carry; d <= L; d += 2.5) { const [px, py] = toPx(ax + ((bx - ax) * d) / L, ay + ((by - ay) * d) / L); ctx.fillStyle = '#2a1d10'; ctx.beginPath(); ctx.arc(px, py, Math.max(3, pxPerM * 0.12), 0, Math.PI * 2); ctx.fill(); }
      carry = 2.5 - ((L - carry) % 2.5);
    }
  }

  // 9. keyline pattern lines
  if (s.layers.earthworks) for (const f of features) {
    if (f.kind !== 'keyline' || f.points.length < 2) continue;
    line(f.points); ctx.setLineDash([]);
    ctx.lineWidth = f.id === selectedId ? 5 : 2.5;
    ctx.strokeStyle = f.id === selectedId ? '#ffffff' : f.name.startsWith('Keyline') ? 'rgba(186,230,253,0.95)' : 'rgba(186,230,253,0.55)';
    ctx.stroke();
  }

  // 10. sectors: soft wedges from their origin, labelled at the rim
  if (s.layers.sectors) for (const f of features) {
    if (f.kind !== 'sector' || f.points.length < 2) continue;
    const st = SECTOR_STYLE[f.sector || 'wind'] || SECTOR_STYLE.wind;
    const [o, t] = f.points;
    const R = Math.hypot(t[0] - o[0], t[1] - o[1]) * pxPerM;
    const b = Math.atan2(t[0] - o[0], t[1] - o[1]);
    const spread = ((f.spread ?? st.spread) * Math.PI) / 180;
    const [ox, oy] = toPx(o[0], o[1]);
    const a0 = b - spread / 2 - Math.PI / 2, a1 = b + spread / 2 - Math.PI / 2;
    const grad = ctx.createRadialGradient(ox, oy, 0, ox, oy, R);
    const sunny = (f.sector || '').startsWith('sun');
    grad.addColorStop(0, st.color + '00'); grad.addColorStop(0.55, st.color + (sunny ? '14' : '30')); grad.addColorStop(1, st.color + (sunny ? '38' : '70'));
    ctx.beginPath(); ctx.moveTo(ox, oy); ctx.arc(ox, oy, R, a0, a1); ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();
    ctx.lineWidth = f.id === selectedId ? 5 : 2.5; ctx.strokeStyle = f.id === selectedId ? '#ffffff' : st.color; ctx.setLineDash([12, 8]); ctx.stroke(); ctx.setLineDash([]);
    // arrow toward the origin: energy coming in
    const tipx = ox + Math.sin(b) * R * 0.92, tipy = oy - Math.cos(b) * R * 0.92, midx = ox + Math.sin(b) * R * 0.62, midy = oy - Math.cos(b) * R * 0.62;
    ctx.beginPath(); ctx.moveTo(tipx, tipy); ctx.lineTo(midx, midy); ctx.lineWidth = 5; ctx.strokeStyle = st.color; ctx.stroke();
    const ah = 16, ang = Math.atan2(midy - tipy, midx - tipx);
    ctx.beginPath(); ctx.moveTo(midx, midy); ctx.lineTo(midx - ah * Math.cos(ang - 0.5), midy - ah * Math.sin(ang - 0.5)); ctx.lineTo(midx - ah * Math.cos(ang + 0.5), midy - ah * Math.sin(ang + 0.5)); ctx.closePath(); ctx.fillStyle = st.color; ctx.fill();
    const lx = o[0] + Math.sin(b) * (R / pxPerM) * 1.0, ly = o[1] + Math.cos(b) * (R / pxPerM) * 1.0;
    label(sunny || !f.name ? st.label : f.name.length > 28 ? st.label : f.name, Math.max(-g.size / 2 * 0.86, Math.min(g.size / 2 * 0.86, lx)), Math.max(-g.size / 2 * 0.9, Math.min(g.size / 2 * 0.9, ly)), 24, st.color);
  }
}
