import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import type { LayerId, SiteObject } from '../lib/types';
import { LAYER_OF } from '../lib/types';
import { Grid, heightAt } from '../lib/terrain';
import { buildObject, ModelContext } from '../lib/models';
import { sunVector } from '../lib/sun';

export type Tool =
  | 'select' | 'raise' | 'lower' | 'smooth' | 'flatten' | 'berm' | 'swale' | 'contour'
  | 'path' | 'zone' | 'measure' | 'water'
  | 'plant' | 'building' | 'greenhouse' | 'tank' | 'pond' | 'garden' | 'compost' | 'coop' | 'hive' | 'irrigation'
  | 'guild' | 'hedge' | 'fence' | 'keyline' | 'sector' | 'paddock' | 'boundary';

export const SCULPT_TOOLS: Tool[] = ['raise', 'lower', 'smooth', 'flatten'];
export const STROKE_TOOLS: Tool[] = ['berm', 'swale', 'path', 'hedge', 'fence', 'sector'];
export const PLACE_TOOLS: Tool[] = ['plant', 'building', 'greenhouse', 'tank', 'pond', 'garden', 'compost', 'coop', 'hive', 'irrigation'];
const CLICK_TOOLS: Tool[] = ['contour', 'zone', 'measure', 'guild', 'keyline', 'paddock', 'boundary', ...PLACE_TOOLS];

export interface OverlayLine { points: [number, number][]; color: string; closed?: boolean; width?: number }

export interface WaterSettings {
  dropCount: number; speed: number; life: number; pooling: number; paused: boolean;
  rain: boolean; rainIntensity: number; irrigationRate: number; irrigationSpread: number; clearToken: number;
}

export interface ViewportHandle {
  setView: (v: 'top' | 'perspective' | 'reset' | 'north' | 'south') => void;
  screenshot: (maxWidth?: number, type?: string) => string;
  exportGLB: () => Promise<Blob>;
}

interface Props {
  grid: Grid;
  exaggeration: number;
  mapCanvas: HTMLCanvasElement;
  mapVersion: number;
  objects: SiteObject[];
  modelCtx: ModelContext;
  selectedId: string | null;
  layers: Record<LayerId, boolean>;
  tool: Tool;
  brush: { size: number; strength: number; flattenHeight: number };
  sun: { azimuth: number; altitude: number };
  water: WaterSettings;
  showGrid: boolean;
  overlayLines: OverlayLine[];
  onHeightsCommit: (h: Float32Array) => void;
  onSelectObject: (id: string) => void;
  onGroundClick: (x: number, y: number, e: PointerEvent) => void;
  onGroundDoubleClick: (x: number, y: number) => void;
  onStroke: (points: [number, number][]) => void;
  onHover: (p: { x: number; y: number } | null) => void;
  onMoveObject: (id: string, x: number, y: number) => void;
  onFlattenPick: (h: number) => void;
}

const Viewport3D = forwardRef<ViewportHandle, Props>((props, ref) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const three = useRef<any>({});

  // ---- one-time scene setup ----------------------------------------------------------
  useEffect(() => {
    const mount = mountRef.current!;
    const T = three.current;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, mount.clientWidth / mount.clientHeight, 0.1, 50000);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI / 2 - 0.03;
    controls.screenSpacePanning = false;

    const hemi = new THREE.HemisphereLight(0xdfefff, 0x4a4030, 0.7);
    scene.add(hemi);
    const sunLight = new THREE.DirectionalLight(0xfff1dc, 2.2);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(2048, 2048);
    sunLight.shadow.bias = -0.0004;
    sunLight.shadow.normalBias = 0.6;
    scene.add(sunLight, sunLight.target);

    const texture = new THREE.CanvasTexture(propsRef.current.mapCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const terrainMat = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.95, metalness: 0 });
    const terrain = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 1, 1), terrainMat);
    terrain.rotation.x = -Math.PI / 2;
    terrain.receiveShadow = true;
    terrain.castShadow = true;
    scene.add(terrain);

    const skirt = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ color: '#4a3826', roughness: 1, side: THREE.DoubleSide }));
    scene.add(skirt);

    const objectsGroup = new THREE.Group();
    scene.add(objectsGroup);
    const linesGroup = new THREE.Group();
    scene.add(linesGroup);

    const brushMesh = new THREE.Mesh(
      new THREE.RingGeometry(0.94, 1, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xa7de75, transparent: true, opacity: 0.9, depthTest: false }),
    );
    brushMesh.renderOrder = 20;
    brushMesh.visible = false;
    scene.add(brushMesh);

    const strokeLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xfde68a, depthTest: false, transparent: true }));
    strokeLine.renderOrder = 21;
    scene.add(strokeLine);

    const MAX_P = 6000;
    const waterMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 6, 6), new THREE.MeshBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.8 }), MAX_P);
    waterMesh.count = 0;
    waterMesh.frustumCulled = false;
    scene.add(waterMesh);

    let gridHelper: THREE.GridHelper | null = null;
    Object.assign(T, { scene, camera, renderer, controls, hemi, sunLight, texture, terrain, skirt, objectsGroup, linesGroup, brushMesh, waterMesh, particles: [] as any[], objectGroups: {} as Record<string, THREE.Group>, extraDisposables: [] as any[] });
    T.setGridHelper = (size: number, show: boolean) => {
      if (gridHelper) { scene.remove(gridHelper); gridHelper.geometry.dispose(); (gridHelper.material as THREE.Material).dispose(); gridHelper = null; }
      if (!show) return;
      const steps = [1, 2, 5, 10, 20, 50, 100, 200];
      const step = steps.find((s) => size / s <= 40) || 200;
      gridHelper = new THREE.GridHelper(size, Math.round(size / step), 0xffffff, 0xffffff);
      (gridHelper.material as THREE.Material).transparent = true;
      (gridHelper.material as THREE.Material).opacity = 0.18;
      (gridHelper.material as any).depthTest = false;
      gridHelper.renderOrder = 5;
      const p = propsRef.current;
      let maxH = 0; for (const h of p.grid.heights) if (h > maxH) maxH = h;
      gridHelper.position.y = maxH * p.exaggeration + 0.05;
      scene.add(gridHelper);
    };

    // ---- interaction ----
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    const cast = (e: PointerEvent | MouseEvent, target: THREE.Object3D) => {
      const r = mount.getBoundingClientRect();
      mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(mouse, camera);
      return raycaster.intersectObject(target, true)[0] || null;
    };
    const ground = (e: PointerEvent | MouseEvent) => {
      const hit = cast(e, terrain);
      return hit ? { x: hit.point.x, y: -hit.point.z, point: hit.point } : null;
    };

    let sculpting: Float32Array | null = null;
    let stroke: [number, number][] | null = null;
    let pouring = false;
    let drag: { id: string; group: THREE.Group; x: number; y: number; moved: boolean; sx: number; sy: number } | null = null;

    const spawn = (x: number, y: number, spread: number) => {
      const P = T.particles;
      if (P.length >= MAX_P) P.shift();
      const a = Math.random() * Math.PI * 2, r = Math.random() * spread;
      P.push({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r, vx: 0, vy: 0, age: 0, pooled: false });
    };

    const applyBrush = (x: number, y: number) => {
      const p = propsRef.current, g = p.grid, h = sculpting!;
      const n = g.n, w = n + 1, cs = g.size / n, R = p.brush.size;
      const c0 = Math.max(0, Math.floor((x - R + g.size / 2) / cs)), c1 = Math.min(n, Math.ceil((x + R + g.size / 2) / cs));
      const r0 = Math.max(0, Math.floor((g.size / 2 - y - R) / cs)), r1 = Math.min(n, Math.ceil((g.size / 2 - y + R) / cs));
      const delta = (p.brush.strength / 100) * 0.5;
      let avg = 0, cnt = 0;
      if (p.tool === 'smooth') {
        for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
          if (Math.hypot(c * cs - g.size / 2 - x, g.size / 2 - r * cs - y) < R) { avg += h[r * w + c]; cnt++; }
        }
        if (cnt) avg /= cnt;
      }
      const pos = terrain.geometry.attributes.position.array as Float32Array;
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
        const d = Math.hypot(c * cs - g.size / 2 - x, g.size / 2 - r * cs - y);
        if (d >= R) continue;
        const f = Math.cos((d / R) * Math.PI / 2);
        const i = r * w + c;
        let v = h[i];
        if (p.tool === 'raise') v += delta * f;
        else if (p.tool === 'lower') v -= delta * f;
        else if (p.tool === 'flatten') v += (p.brush.flattenHeight - v) * Math.min(1, delta * f);
        else if (p.tool === 'smooth') v += (avg - v) * Math.min(1, delta * f);
        h[i] = v;
        pos[i * 3 + 2] = v * p.exaggeration;
      }
      terrain.geometry.attributes.position.needsUpdate = true;
      terrain.geometry.computeVertexNormals();
    };

    const drawStroke = () => {
      const p = propsRef.current;
      const pts = (stroke || []).map(([x, y]) => new THREE.Vector3(x, ((heightAt(p.grid, x, y) || 0) + 0.3) * p.exaggeration, -y));
      strokeLine.geometry.dispose();
      strokeLine.geometry = new THREE.BufferGeometry().setFromPoints(pts);
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const p = propsRef.current;
      const gp = ground(e);
      if (p.tool === 'select') {
        const hit = cast(e, objectsGroup);
        const id = hit?.object.userData.id;
        if (id) {
          p.onSelectObject(id);
          const group = T.objectGroups[id];
          const gpt = gp || { x: 0, y: 0 };
          if (group) {
            // keep the gesture away from OrbitControls so dragging moves the object, not the camera
            e.stopPropagation();
            drag = { id, group, x: gpt.x, y: gpt.y, moved: false, sx: e.clientX, sy: e.clientY };
          }
          return;
        }
        if (gp) p.onGroundClick(gp.x, gp.y, e);
        return;
      }
      if (!gp) return;
      if (SCULPT_TOOLS.includes(p.tool)) {
        if (p.tool === 'flatten' && (e.shiftKey || e.altKey)) { p.onFlattenPick(heightAt(p.grid, gp.x, gp.y)); return; }
        sculpting = new Float32Array(p.grid.heights);
        applyBrush(gp.x, gp.y);
      } else if (STROKE_TOOLS.includes(p.tool)) {
        stroke = [[gp.x, gp.y]];
        drawStroke();
      } else if (p.tool === 'water') {
        pouring = true;
        for (let i = 0; i < p.water.dropCount; i++) spawn(gp.x, gp.y, p.brush.size * 0.5);
      } else if (CLICK_TOOLS.includes(p.tool)) {
        p.onGroundClick(gp.x, gp.y, e);
      }
    };

    let hoverQueued: PointerEvent | null = null;
    const onMove = (e: PointerEvent) => {
      const p = propsRef.current;
      if (drag) {
        const gp = ground(e);
        if (gp && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 3) {
          drag.moved = true; drag.x = gp.x; drag.y = gp.y;
          const obj = p.objects.find((o) => o.id === drag!.id);
          const h = obj?.type === 'pond' ? (obj.waterLevel ?? 0) : heightAt(p.grid, gp.x, gp.y);
          drag.group.position.set(gp.x, h * p.exaggeration, -gp.y);
        }
        return;
      }
      const showRing = SCULPT_TOOLS.includes(p.tool) || p.tool === 'water';
      const gp = ground(e);
      if (gp && showRing) {
        brushMesh.visible = true;
        brushMesh.position.set(gp.point.x, gp.point.y + 0.1, gp.point.z);
        brushMesh.scale.setScalar(p.brush.size);
      } else brushMesh.visible = false;
      if (!gp) { p.onHover(null); return; }
      if (sculpting) applyBrush(gp.x, gp.y);
      if (stroke) {
        const last = stroke[stroke.length - 1];
        if (Math.hypot(gp.x - last[0], gp.y - last[1]) > Math.max(0.4, p.grid.size / 300)) { stroke.push([gp.x, gp.y]); drawStroke(); }
      }
      if (pouring) for (let i = 0; i < Math.ceil(p.water.dropCount / 3); i++) spawn(gp.x, gp.y, p.brush.size * 0.5);
      if (!hoverQueued) requestAnimationFrame(() => { hoverQueued = null; propsRef.current.onHover({ x: gp.x, y: gp.y }); });
      hoverQueued = e;
    };

    const onUp = () => {
      const p = propsRef.current;
      if (drag) {
        if (drag.moved) p.onMoveObject(drag.id, drag.x, drag.y);
        drag = null;
      }
      if (sculpting) { const h = sculpting; sculpting = null; p.onHeightsCommit(h); }
      if (stroke) {
        const s = stroke; stroke = null;
        strokeLine.geometry.dispose(); strokeLine.geometry = new THREE.BufferGeometry();
        if (s.length > 1) p.onStroke(s);
      }
      pouring = false;
    };
    const onLeave = () => { brushMesh.visible = false; propsRef.current.onHover(null); };
    const onDbl = (e: MouseEvent) => { const gp = ground(e); if (gp) propsRef.current.onGroundDoubleClick(gp.x, gp.y); };

    mount.addEventListener('pointerdown', onDown, { capture: true });
    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('pointerleave', onLeave);
    renderer.domElement.addEventListener('dblclick', onDbl);
    window.addEventListener('pointerup', onUp);

    const ro = new ResizeObserver(() => {
      renderer.setSize(mount.clientWidth, mount.clientHeight);
      camera.aspect = mount.clientWidth / Math.max(1, mount.clientHeight);
      camera.updateProjectionMatrix();
    });
    ro.observe(mount);

    // ---- animation loop: water physics ----
    const dummy = new THREE.Object3D();
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      controls.update();
      const p = propsRef.current, W = p.water, g = p.grid;
      if (!W.paused) {
        if (W.rain) for (let i = 0; i < W.rainIntensity * Math.max(1, g.size / 100); i++) spawn((Math.random() - 0.5) * g.size * 0.98, (Math.random() - 0.5) * g.size * 0.98, 0);
        for (const o of p.objects) {
          if (o.type !== 'irrigation' || o.isFlowing === false || !p.layers.water) continue;
          const drops = Math.floor(W.irrigationRate) + (Math.random() < W.irrigationRate % 1 ? 1 : 0);
          for (let i = 0; i < drops; i++) spawn(o.x, o.y, W.irrigationSpread);
        }
        const P = T.particles, keep: any[] = [];
        const eps = Math.max(0.3, g.size / g.n / 2);
        const radius = Math.max(0.18, g.size / 450);
        const scale = Math.max(1, g.size / 100);
        for (const q of P) {
          q.age++;
          if (q.age > W.life) continue;
          const h0 = heightAt(g, q.x, q.y);
          if (!Number.isFinite(h0)) continue;
          const dx = (heightAt(g, q.x + eps, q.y) - heightAt(g, q.x - eps, q.y)) / (2 * eps);
          const dy = (heightAt(g, q.x, q.y + eps) - heightAt(g, q.x, q.y - eps)) / (2 * eps);
          if (Number.isFinite(dx)) q.vx -= dx * W.speed * 0.05 * scale;
          if (Number.isFinite(dy)) q.vy -= dy * W.speed * 0.05 * scale;
          q.vx *= 0.85; q.vy *= 0.85;
          q.vx += (Math.random() - 0.5) * 0.005 * scale; q.vy += (Math.random() - 0.5) * 0.005 * scale;
          q.pooled = q.vx * q.vx + q.vy * q.vy < 0.0005 * W.pooling * scale * scale && q.age > 20;
          if (q.pooled) q.age -= 0.85;
          q.x += q.vx; q.y += q.vy;
          const h = heightAt(g, q.x, q.y);
          if (!Number.isFinite(h)) continue;
          const life = Math.max(0.05, 1 - q.age / W.life);
          if (q.pooled) { dummy.position.set(q.x, h * p.exaggeration + 0.05, -q.y); dummy.scale.set(radius * 2.4 * life, radius * 0.3, radius * 2.4 * life); }
          else { dummy.position.set(q.x, h * p.exaggeration + radius * 0.6, -q.y); dummy.scale.setScalar(radius * Math.max(0.4, life)); }
          dummy.updateMatrix();
          waterMesh.setMatrixAt(keep.length, dummy.matrix);
          keep.push(q);
        }
        T.particles = keep;
        waterMesh.count = keep.length;
        waterMesh.instanceMatrix.needsUpdate = true;
      }
      renderer.render(scene, camera);
      if (T.onFrame) T.onFrame(controls.getAzimuthalAngle());
    };
    loop();

    // read-only hooks for the end-to-end test (test/e2e.mjs)
    (window as any).__psView = {
      frames: () => renderer.info.render.frame,
      particles: () => waterMesh.count,
      project: (x: number, y: number) => {
        const p = propsRef.current;
        const v = new THREE.Vector3(x, (heightAt(p.grid, x, y) || 0) * p.exaggeration, -y).project(camera);
        const r = mount.getBoundingClientRect();
        return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
      },
    };

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      mount.removeEventListener('pointerdown', onDown, { capture: true });
      renderer.domElement.removeEventListener('pointermove', onMove);
      renderer.domElement.removeEventListener('pointerleave', onLeave);
      renderer.domElement.removeEventListener('dblclick', onDbl);
      window.removeEventListener('pointerup', onUp);
      controls.dispose();
      terrain.geometry.dispose();
      texture.dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, []);

  const { grid, exaggeration, mapVersion, objects, modelCtx, selectedId, layers, tool, sun, water, showGrid, overlayLines } = props;

  // ---- terrain geometry: rebuilt when the grid shape changes, updated when heights change ----
  useEffect(() => {
    const T = three.current;
    const { terrain } = T;
    const want = (grid.n + 1) * (grid.n + 1);
    if (!T.geomKey || T.geomKey !== `${grid.n}|${grid.size}`) {
      terrain.geometry.dispose();
      terrain.geometry = new THREE.PlaneGeometry(grid.size, grid.size, grid.n, grid.n);
      T.geomKey = `${grid.n}|${grid.size}`;
      frameCamera(T, grid.size, 'reset');
      const sc = T.sunLight.shadow.camera as THREE.OrthographicCamera;
      const ext = grid.size * 0.75;
      sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.near = 1; sc.far = grid.size * 6;
      sc.updateProjectionMatrix();
      T.controls.maxDistance = grid.size * 4;
      T.controls.minDistance = Math.max(1, grid.size / 200);
      T.particles = [];
    }
    const pos = terrain.geometry.attributes.position.array as Float32Array;
    if (pos.length / 3 === want) {
      for (let i = 0; i < want; i++) pos[i * 3 + 2] = grid.heights[i] * exaggeration;
      terrain.geometry.attributes.position.needsUpdate = true;
      terrain.geometry.computeVertexNormals();
      terrain.geometry.computeBoundingSphere();
      terrain.geometry.computeBoundingBox();
    }
    T.skirt.geometry.dispose();
    T.skirt.geometry = buildSkirt(grid, exaggeration);
    T.setGridHelper(grid.size, showGrid);
  }, [grid, exaggeration, showGrid]);

  useEffect(() => { three.current.texture.needsUpdate = true; }, [mapVersion]);

  // ---- sun ----
  useEffect(() => {
    const T = three.current;
    const [x, y, z] = sunVector(sun.azimuth, Math.max(sun.altitude, 0.5));
    const d = grid.size * 1.6;
    T.sunLight.position.set(x * d, y * d, z * d);
    T.sunLight.target.position.set(0, 0, 0);
    const day = Math.max(0, Math.min(1, (sun.altitude + 4) / 18));
    T.sunLight.intensity = sun.altitude > 0 ? 0.6 + 2.0 * Math.min(1, sun.altitude / 35) : 0;
    T.sunLight.color.setHSL(0.09, 0.6, 0.6 + 0.3 * Math.min(1, sun.altitude / 30));
    T.hemi.intensity = 0.18 + 0.6 * day;
    // a vertical gradient sky: deep at the top, warm haze at the horizon near sunrise and sunset
    const top = new THREE.Color('#05080a').lerp(new THREE.Color('#5d8fb8'), day);
    const horizon = new THREE.Color('#10171a').lerp(new THREE.Color(sun.altitude < 10 ? '#e8b48a' : '#cfe0e6'), day);
    const c = document.createElement('canvas'); c.width = 2; c.height = 256;
    const g2 = c.getContext('2d')!; const gr = g2.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, '#' + top.getHexString()); gr.addColorStop(0.62, '#' + horizon.getHexString()); gr.addColorStop(1, '#' + horizon.clone().multiplyScalar(0.55).getHexString());
    g2.fillStyle = gr; g2.fillRect(0, 0, 2, 256);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    if (T.scene.background && (T.scene.background as any).isTexture) (T.scene.background as THREE.Texture).dispose();
    T.scene.background = tex;
    T.scene.fog = new THREE.Fog(horizon, grid.size * 3, grid.size * 12);
  }, [sun.azimuth, sun.altitude, grid.size]);

  // ---- objects ----
  useEffect(() => {
    const T = three.current;
    const group: THREE.Group = T.objectsGroup;
    for (const c of [...group.children]) group.remove(c);
    T.extraDisposables.forEach((g: THREE.BufferGeometry) => g.dispose());
    T.extraDisposables = [];
    T.objectGroups = {};
    for (const o of objects) {
      if (!layers[LAYER_OF[o.type]]) continue;
      const g = buildObject(o, modelCtx, o.id === selectedId);
      g.traverse((c: any) => { if (c.geometry?.type === 'ExtrudeGeometry') T.extraDisposables.push(c.geometry); });
      const h = o.type === 'pond' ? (o.waterLevel ?? heightAt(grid, o.x, o.y)) : heightAt(grid, o.x, o.y);
      g.position.set(o.x, (Number.isFinite(h) ? h : 0) * exaggeration, -o.y);
      group.add(g);
      T.objectGroups[o.id] = g;
    }
  }, [objects, modelCtx, selectedId, layers, grid, exaggeration]);

  // ---- overlay lines (measure, zone drafts, contour preview) ----
  useEffect(() => {
    const T = three.current;
    const lg: THREE.Group = T.linesGroup;
    for (const c of [...lg.children]) { lg.remove(c); (c as any).geometry.dispose(); (c as any).material.dispose(); }
    for (const l of overlayLines) {
      if (l.points.length < 2) continue;
      const pts: THREE.Vector3[] = [];
      const seq = l.closed ? [...l.points, l.points[0]] : l.points;
      for (let i = 0; i < seq.length - 1; i++) {
        const [ax, ay] = seq[i], [bx, by] = seq[i + 1];
        const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (grid.size / grid.n)));
        for (let k = 0; k <= steps; k++) {
          const x = ax + ((bx - ax) * k) / steps, y = ay + ((by - ay) * k) / steps;
          pts.push(new THREE.Vector3(x, ((heightAt(grid, x, y) || 0) + 0.25) * exaggeration + 0.1, -y));
        }
      }
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: l.color, depthTest: false, transparent: true, linewidth: l.width || 2 }));
      line.renderOrder = 30;
      lg.add(line);
    }
  }, [overlayLines, grid, exaggeration]);

  // ---- tool changes the left mouse button ----
  useEffect(() => {
    const c = three.current.controls as OrbitControls;
    c.mouseButtons.LEFT = tool === 'select' ? THREE.MOUSE.ROTATE : (null as any);
    if (tool !== 'water' && !SCULPT_TOOLS.includes(tool)) three.current.brushMesh.visible = false;
  }, [tool]);

  useEffect(() => {
    if (water.clearToken) { three.current.particles = []; three.current.waterMesh.count = 0; }
  }, [water.clearToken]);

  useImperativeHandle(ref, () => ({
    setView: (v) => frameCamera(three.current, propsRef.current.grid.size, v),
    screenshot: (maxWidth = 0, type = 'image/png') => {
      const T = three.current;
      T.renderer.render(T.scene, T.camera);
      const src: HTMLCanvasElement = T.renderer.domElement;
      if (!maxWidth || src.width <= maxWidth) return src.toDataURL(type, 0.85);
      const c = document.createElement('canvas');
      c.width = maxWidth; c.height = Math.round((src.height / src.width) * maxWidth);
      c.getContext('2d')!.drawImage(src, 0, 0, c.width, c.height);
      return c.toDataURL(type, 0.8);
    },
    exportGLB: () => new Promise<Blob>((resolve, reject) => {
      const T = three.current;
      const root = new THREE.Group();
      root.add(T.terrain.clone(), T.skirt.clone(), T.objectsGroup.clone());
      new GLTFExporter().parse(root, (res) => resolve(new Blob([res as ArrayBuffer], { type: 'model/gltf-binary' })), (err) => reject(err), { binary: true });
    }),
  }), []);

  // compass needle follows the camera
  const needle = useRef<HTMLDivElement>(null);
  useEffect(() => {
    three.current.onFrame = (az: number) => { if (needle.current) needle.current.style.transform = `rotate(${(az * 180) / Math.PI}deg)`; };
  }, []);

  return (
    <div className="absolute inset-0">
      <div ref={mountRef} className="absolute inset-0" style={{ cursor: tool === 'select' ? 'grab' : 'crosshair' }} />
      <div className="absolute top-3 right-3 w-14 h-14 rounded-full bg-zinc-950/70 border border-zinc-700 backdrop-blur flex items-center justify-center pointer-events-none no-print" title="North">
        <div ref={needle} className="relative w-10 h-10">
          <div className="absolute left-1/2 top-0 -translate-x-1/2 text-[10px] font-bold text-red-400">N</div>
          <div className="absolute left-1/2 top-3 -translate-x-1/2 w-0 h-0 border-l-[5px] border-r-[5px] border-b-[12px] border-l-transparent border-r-transparent border-b-red-500" />
          <div className="absolute left-1/2 bottom-0 -translate-x-1/2 w-0 h-0 border-l-[5px] border-r-[5px] border-t-[12px] border-l-transparent border-r-transparent border-t-zinc-400" />
        </div>
      </div>
    </div>
  );
});

export default Viewport3D;

function frameCamera(T: any, size: number, v: 'top' | 'perspective' | 'reset' | 'north' | 'south') {
  const cam: THREE.PerspectiveCamera = T.camera;
  cam.far = size * 20;
  cam.near = Math.max(0.05, size / 5000);
  cam.updateProjectionMatrix();
  const c = T.controls as OrbitControls;
  c.target.set(0, 0, 0);
  if (v === 'top') cam.position.set(0, size * 1.25, 0.001);
  else if (v === 'north') cam.position.set(0, size * 0.45, -size * 0.95);
  else if (v === 'south') cam.position.set(0, size * 0.45, size * 0.95);
  else cam.position.set(size * 0.55, size * 0.5, size * 0.8);
  c.update();
}

function buildSkirt(g: Grid, ex: number) {
  const n = g.n, w = n + 1, half = g.size / 2;
  let minH = Infinity;
  for (const h of g.heights) if (h < minH) minH = h;
  const bottom = (minH - Math.max(2, g.size * 0.03)) * ex;
  const pos: number[] = [], idx: number[] = [];
  const edge = (pts: [number, number, number][]) => {
    const start = pos.length / 3;
    for (const [x, z, h] of pts) pos.push(x, h * ex, z, x, bottom, z);
    for (let i = 0; i < pts.length - 1; i++) {
      const a = start + i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  };
  const cs = g.size / n;
  edge(Array.from({ length: w }, (_, c) => [c * cs - half, -half, g.heights[c]] as [number, number, number]));
  edge(Array.from({ length: w }, (_, c) => [c * cs - half, half, g.heights[n * w + c]] as [number, number, number]));
  edge(Array.from({ length: w }, (_, r) => [-half, r * cs - half, g.heights[r * w]] as [number, number, number]));
  edge(Array.from({ length: w }, (_, r) => [half, r * cs - half, g.heights[r * w + n]] as [number, number, number]));
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}
