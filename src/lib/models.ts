// Stylised low-poly models for every placeable thing. Geometries and materials are shared,
// so a site with hundreds of trees stays cheap.
import * as THREE from 'three';
import type { SiteObject } from './types';
import { SPECIES_BY_ID, growthFraction, leafState, seasonalMonth, Species } from './plants';

const geo = {
  trunk: new THREE.CylinderGeometry(0.35, 0.5, 1, 7).translate(0, 0.5, 0),
  blob: new THREE.IcosahedronGeometry(1, 1),
  blob0: new THREE.IcosahedronGeometry(1, 0),
  cone: new THREE.ConeGeometry(1, 1, 8).translate(0, 0.5, 0),
  disc: new THREE.CylinderGeometry(1, 1, 1, 16).translate(0, 0.5, 0),
  box: new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
  dot: new THREE.IcosahedronGeometry(1, 0),
  ring: new THREE.RingGeometry(0.92, 1, 40).rotateX(-Math.PI / 2),
  water: new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2),
  halfTube: new THREE.CylinderGeometry(1, 1, 1, 16, 1, false, -Math.PI / 2, Math.PI).rotateZ(Math.PI / 2),
};

const mats = new Map<string, THREE.Material>();
export function mat(color: string, opts: { opacity?: number; emissive?: string; flat?: boolean; rough?: number } = {}) {
  const key = `${color}|${opts.opacity ?? 1}|${opts.emissive ?? ''}|${opts.flat ?? true}|${opts.rough ?? 0.85}`;
  let m = mats.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color, roughness: opts.rough ?? 0.85, metalness: 0.02, flatShading: opts.flat ?? true,
      transparent: (opts.opacity ?? 1) < 1, opacity: opts.opacity ?? 1,
      emissive: opts.emissive ? new THREE.Color(opts.emissive) : new THREE.Color(0),
      depthWrite: (opts.opacity ?? 1) >= 1,
    });
    mats.set(key, m);
  }
  return m;
}

const waterMat = new THREE.MeshStandardMaterial({ color: '#2f7fb8', roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.82, emissive: new THREE.Color('#0b2a44') });
const glassMat = new THREE.MeshStandardMaterial({ color: '#d8f0ff', roughness: 0.1, metalness: 0, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false });
const selectMat = new THREE.MeshBasicMaterial({ color: '#34d399', transparent: true, opacity: 0.95, depthTest: false });
const ghostMat = new THREE.MeshBasicMaterial({ color: '#a7f3d0', transparent: true, opacity: 0.6, depthTest: false });

function part(g: THREE.BufferGeometry, m: THREE.Material, sx: number, sy: number, sz: number, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(g, m);
  mesh.scale.set(sx, sy, sz);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// deterministic pseudo random per object, so fruit does not jump around between frames
function rng(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}

export interface ModelContext {
  viewDate: Date; // the moment the design is shown at (today plus the timeline offset)
  lat: number | null;
}

export function plantAge(o: SiteObject, ctx: ModelContext) {
  const planted = o.planted ? new Date(o.planted + 'T00:00:00') : ctx.viewDate;
  return (ctx.viewDate.getTime() - planted.getTime()) / (365.25 * 86400000);
}

/** Mature-relative size (0 to 1) and real dimensions of a plant at the view date. */
export function plantSize(o: SiteObject, ctx: ModelContext) {
  const sp = SPECIES_BY_ID[o.species || ''] || SPECIES_BY_ID.apple;
  const age = plantAge(o, ctx);
  const f = growthFraction(age, sp.yearsToMature);
  return { sp, age, f, height: sp.heightM * f * o.scale, spread: sp.spreadM * f * o.scale };
}

function buildPlant(o: SiteObject, ctx: ModelContext, g: THREE.Group) {
  const { sp, age, height: H, spread: S } = plantSize(o, ctx);
  if (age < 0) {
    // planned but not planted yet at this point on the timeline: a marker only
    g.add(part(geo.ring, ghostMat, Math.max(0.4, sp.spreadM * 0.12), 1, Math.max(0.4, sp.spreadM * 0.12), 0, 0.05, 0));
    return;
  }
  if (H < 2.5 && (sp.layer === 'canopy' || sp.layer === 'subcanopy' || sp.layer === 'shrub')) {
    // a young tree is tiny on a big site: mark its planting circle so it can be seen and grabbed
    g.add(part(geo.ring, mat(sp.leaf, { emissive: '#0a2a10' }), Math.max(0.6, sp.spreadM * 0.15), 1, Math.max(0.6, sp.spreadM * 0.15), 0, 0.06, 0));
    g.add(part(geo.disc, mat('#6b4a2e'), Math.max(0.5, sp.spreadM * 0.13), 0.04, Math.max(0.5, sp.spreadM * 0.13)));
  }
  const nMonth = seasonalMonth(ctx.viewDate.getMonth() + 1, ctx.lat);
  const state = leafState(sp, nMonth);
  const foliage = state === 'fall' ? sp.fall || sp.leaf : state === 'bloom' ? mixHex(sp.leaf, sp.flower || '#ffffff', 0.55) : sp.leaf;
  const leafM = mat(o.color || foliage);
  const bark = mat('#5b4532');
  const R = S / 2;
  const tree = sp.layer === 'canopy' || sp.layer === 'subcanopy';
  if (tree) {
    const trunkH = sp.form === 'palm' ? H * 0.88 : sp.form === 'conical' ? H * 0.18 : H * 0.42;
    const tr = Math.max(0.05, S * 0.035);
    g.add(part(geo.trunk, bark, tr, trunkH, tr));
    if (state === 'bare') {
      const rand = rng(o.id);
      for (let k = 0; k < 5; k++) {
        const b = part(geo.trunk, bark, tr * 0.45, H * 0.45, tr * 0.45, 0, trunkH * 0.85, 0);
        b.rotation.set((rand() - 0.5) * 1.3, rand() * Math.PI * 2, (rand() - 0.5) * 1.3);
        g.add(b);
      }
      return;
    }
    const top = H - trunkH;
    switch (sp.form) {
      case 'conical': g.add(part(geo.cone, leafM, R, H * 0.85, R, 0, H * 0.15, 0)); break;
      case 'columnar': g.add(part(geo.blob, leafM, R, top * 0.6, R, 0, trunkH + top * 0.45, 0)); break;
      case 'spreading': g.add(part(geo.blob, leafM, R, top * 0.5, R, 0, trunkH + top * 0.5, 0)); break;
      case 'vase': g.add(part(geo.blob, leafM, R, top * 0.5, R, 0, trunkH + top * 0.55, 0)); break;
      case 'weeping':
        g.add(part(geo.blob, leafM, R, top * 0.62, R, 0, trunkH + top * 0.32, 0));
        break;
      case 'palm': {
        const rand = rng(o.id);
        for (let k = 0; k < 7; k++) {
          const leaf = part(geo.box, leafM, R * 0.25, 0.08, R, 0, H * 0.92, 0);
          leaf.geometry = geo.box;
          leaf.rotation.set(-0.5 - rand() * 0.3, (k / 7) * Math.PI * 2, 0);
          leaf.position.y = trunkH;
          g.add(leaf);
        }
        break;
      }
      default: g.add(part(geo.blob, leafM, R, top * 0.58, R, 0, trunkH + top * 0.45, 0));
    }
  } else if (sp.form === 'mat') {
    g.add(part(geo.disc, leafM, R, Math.max(0.03, H), R));
  } else if (sp.form === 'vine') {
    const post = mat('#7a5c3e');
    g.add(part(geo.box, post, 0.1, Math.max(0.8, sp.heightM * o.scale), 0.1, -R, 0, 0));
    g.add(part(geo.box, post, 0.1, Math.max(0.8, sp.heightM * o.scale), 0.1, R, 0, 0));
    g.add(part(geo.box, post, R * 2 + 0.1, 0.06, 0.06, 0, Math.max(0.8, sp.heightM * o.scale) - 0.06, 0));
    if (state !== 'bare') g.add(part(geo.blob, leafM, R, H * 0.3, Math.max(0.3, R * 0.25), 0, H * 0.72, 0));
  } else {
    // shrubs, clumps and the root layer
    if (state === 'bare' && sp.layer !== 'shrub') return addFruitAndBloom(o, sp, g, nMonth, age, 0, 0);
    const rand = rng(o.id);
    const n = sp.form === 'clump' ? 4 : 3;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + rand();
      const rr = R * 0.45;
      const m = state === 'bare' ? mat('#6b5a45') : leafM;
      g.add(part(sp.form === 'clump' ? geo.blob0 : geo.blob, m, R * 0.62, H * 0.55, R * 0.62, Math.cos(a) * rr, H * 0.45, Math.sin(a) * rr));
    }
  }
  addFruitAndBloom(o, sp, g, nMonth, age, R, H);
}

function addFruitAndBloom(o: SiteObject, sp: Species, g: THREE.Group, nMonth: number, age: number, R: number, H: number) {
  const fruiting = sp.fruit && sp.harvest.includes(nMonth) && age >= Math.min(2, sp.yearsToMature * 0.45);
  const blooming = sp.flower && sp.bloom?.includes(nMonth) && age >= 0.5;
  if (!(fruiting || blooming) || R <= 0) return;
  const rand = rng(o.id + nMonth);
  const color = fruiting ? sp.fruit! : sp.flower!;
  const n = fruiting ? 14 : 22;
  const size = Math.max(0.05, Math.min(0.18, R * 0.06));
  const cy = sp.layer === 'canopy' || sp.layer === 'subcanopy' ? H * 0.68 : H * 0.5;
  for (let k = 0; k < n; k++) {
    const th = rand() * Math.PI * 2, ph = Math.acos(rand() * 1.6 - 0.8);
    g.add(part(geo.dot, mat(color, { flat: true, rough: 0.5 }), size, size, size,
      Math.sin(ph) * Math.cos(th) * R * 0.95, cy + Math.cos(ph) * H * 0.25, Math.sin(ph) * Math.sin(th) * R * 0.95));
  }
}

function buildStructure(o: SiteObject, g: THREE.Group) {
  const w = o.width ?? 6, d = o.depth ?? 8, h = o.height ?? 3;
  const sink = 4; // walls run into the ground so a building on a slope never floats
  switch (o.type) {
    case 'building': {
      g.add(part(geo.box, mat(o.color || '#e7e2d6'), w, h + sink, d, 0, -sink, 0));
      const rise = Math.min(w, d) * 0.3;
      const shape = new THREE.Shape();
      shape.moveTo(-w / 2 - 0.3, 0); shape.lineTo(w / 2 + 0.3, 0); shape.lineTo(0, rise); shape.closePath();
      const roofG = new THREE.ExtrudeGeometry(shape, { depth: d + 0.6, bevelEnabled: false }).translate(0, 0, -(d + 0.6) / 2);
      const roof = part(roofG, mat('#7c3f2c'), 1, 1, 1, 0, h, 0);
      g.add(roof);
      g.add(part(geo.box, mat('#4b3a2a'), 0.9, 2, 0.08, 0, 0, d / 2 + 0.02));
      break;
    }
    case 'greenhouse': {
      g.add(part(geo.box, mat('#9a8f7a'), w, 0.3 + sink, d, 0, -sink, 0));
      const tube = new THREE.Mesh(geo.halfTube, glassMat);
      tube.scale.set(d, w / 2, w / 2);
      tube.rotation.y = Math.PI / 2;
      tube.position.y = 0.3;
      g.add(tube);
      break;
    }
    case 'tank': {
      const cap = (o.capacityL ?? 10000) / 1000; // m3
      const th = 2.2, r = Math.sqrt(cap / (Math.PI * th));
      g.add(part(geo.disc, mat(o.color || '#94a3b8', { rough: 0.4 }), r, th + 1, r, 0, -1, 0));
      g.add(part(geo.cone, mat('#64748b', { rough: 0.4 }), r * 1.02, 0.35, r * 1.02, 0, th, 0));
      break;
    }
    case 'pond': {
      const r = o.radius ?? 5;
      const water = new THREE.Mesh(geo.water, waterMat);
      water.scale.set(r, 1, r);
      water.receiveShadow = true;
      g.add(water);
      break;
    }
    case 'garden': {
      g.add(part(geo.box, mat('#6b4a2e'), w, 0.4 + sink, d, 0, -sink, 0));
      g.add(part(geo.box, mat('#3b2a1c'), w - 0.15, 0.02, d - 0.15, 0, 0.4, 0));
      const rows = Math.max(1, Math.floor(w / 0.6));
      for (let k = 0; k < rows; k++) {
        const x = -w / 2 + (k + 0.5) * (w / rows);
        const crop = o.crop ? SPECIES_BY_ID[o.crop] : null;
        const col = crop ? (k % 2 ? crop.leaf : crop.fruit || crop.flower || crop.leaf) : (k % 2 ? '#5a9a3a' : '#7ab648');
        const h = crop ? Math.min(1.5, Math.max(0.15, crop.heightM * 0.6)) : 0.25;
        g.add(part(geo.box, mat(col), Math.min(0.35, w / rows * 0.6), h, d - 0.5, x, 0.42, 0));
      }
      break;
    }
    case 'compost': {
      for (let k = -1; k <= 1; k++) {
        g.add(part(geo.box, mat('#8b6b45'), 1.1, 1 + sink, 1.1, k * 1.25, -sink, 0));
        g.add(part(geo.box, mat('#3a2a18'), 0.95, 0.02, 0.95, k * 1.25, 0.9, 0));
      }
      break;
    }
    case 'coop': {
      g.add(part(geo.box, mat(o.color || '#b45309'), 2.4, 1.8 + sink, 1.8, -1.5, -sink, 0));
      g.add(part(geo.cone, mat('#7c2d12'), 1.8, 0.7, 1.8, -1.5, 1.8, 0).rotateY(Math.PI / 4));
      const run = new THREE.Mesh(geo.box, glassMat);
      run.scale.set(4, 1.5, 3); run.position.set(1.8, 0, 0);
      g.add(run);
      break;
    }
    case 'hive': {
      g.add(part(geo.box, mat('#d6b46a'), 0.5, 0.4 + 0.5, 0.45, 0, -0.5, 0));
      g.add(part(geo.box, mat('#f2d48a'), 0.52, 0.3, 0.47, 0, 0.4, 0));
      g.add(part(geo.box, mat('#ffffff'), 0.56, 0.06, 0.5, 0, 0.7, 0));
      break;
    }
    case 'irrigation': {
      g.add(part(geo.disc, mat('#0ea5e9', { rough: 0.3 }), 0.08, 1.2, 0.08));
      g.add(part(geo.dot, mat('#38bdf8', { emissive: '#0c4a6e' }), 0.18, 0.12, 0.18, 0, 1.2, 0));
      break;
    }
  }
}

/** Ground footprint radius in metres, used for selection rings and hit tests. */
export function footprint(o: SiteObject, ctx: ModelContext) {
  if (o.type === 'plant') return Math.max(0.3, plantSize(o, ctx).spread / 2);
  if (o.type === 'pond') return o.radius ?? 5;
  if (o.type === 'tank') return Math.sqrt((o.capacityL ?? 10000) / 1000 / (Math.PI * 2.2));
  if (o.type === 'compost') return 2;
  if (o.type === 'coop') return 3.5;
  if (o.type === 'hive') return 0.5;
  if (o.type === 'irrigation') return 0.5;
  return Math.hypot(o.width ?? 6, o.depth ?? 8) / 2;
}

/** Height that casts shade, for the sun-hours study. */
export function shadeHeight(o: SiteObject, ctx: ModelContext): number {
  if (o.type === 'plant') {
    const { sp, height, age } = plantSize(o, ctx);
    if (age < 0) return 0;
    const st = leafState(sp, seasonalMonth(ctx.viewDate.getMonth() + 1, ctx.lat));
    return st === 'bare' ? height * 0.15 : height;
  }
  if (o.type === 'building') return (o.height ?? 3) + Math.min(o.width ?? 6, o.depth ?? 8) * 0.3;
  if (o.type === 'greenhouse') return 0; // glass lets the light through
  if (o.type === 'tank') return 2.5;
  if (o.type === 'coop') return 2.2;
  return 0;
}

export function buildObject(o: SiteObject, ctx: ModelContext, selected: boolean): THREE.Group {
  const g = new THREE.Group();
  if (o.type === 'plant') buildPlant(o, ctx, g); else buildStructure(o, g);
  if (selected) {
    const r = footprint(o, ctx) + 0.4;
    const ring = new THREE.Mesh(geo.ring, selectMat);
    ring.scale.set(r, 1, r);
    ring.position.y = 0.08;
    ring.renderOrder = 10;
    g.add(ring);
  }
  g.rotation.y = -((o.rotation || 0) * Math.PI) / 180;
  g.traverse((c) => { c.userData.id = o.id; });
  return g;
}

function mixHex(a: string, b: string, t: number) {
  const ca = new THREE.Color(a), cb = new THREE.Color(b);
  return '#' + ca.lerp(cb, t).getHexString();
}
