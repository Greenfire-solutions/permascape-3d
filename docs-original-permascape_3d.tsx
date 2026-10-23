import React, { useState, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { 
  MousePointer2, ArrowUpFromLine, ArrowDownToLine, Wind, 
  Minus, Mountain, Waves, Droplet, Route, 
  Sprout, TreePine, GlassWater, ChevronDown, ChevronRight,
  Settings, Layers, MountainSnow, Activity, Image as ImageIcon,
  Grid, Undo, Redo, Home, Trash2, BoxSelect, Droplets, CloudRain, Play, Pause, Eraser, Pipette
} from 'lucide-react';

/**
 * ------------------------------------------------------------------
 * VIEWPORT 3D COMPONENT
 * Handles the Three.js scene, camera, renderer, and interactions.
 * ------------------------------------------------------------------
 */
const Viewport3D = ({ 
  imageUrl, planeWidth, planeHeight, imageOpacity, showGrid,
  terrainRes, verticalExaggeration, terrainHeights,
  activeTool, brushSize, brushStrength, flattenHeight, 
  bermWidth, bermHeight, swaleWidth, swaleDepth, hasSwaleBerm,
  waterDropCount, waterSpeed, waterLife, waterPooling, isWaterPaused, clearWaterTrigger, 
  isRainActive, rainIntensity, irrigationFlowRate, irrigationSpread,
  objects, selectedObjectId,
  onHeightsChange, onObjectPlaced, onObjectSelected
}) => {
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const planeRef = useRef(null);
  const materialRef = useRef(null);
  const gridRefs = useRef([]);
  const controlsRef = useRef(null);
  const brushMeshRef = useRef(null);
  const objectsGroupRef = useRef(null);
  const objectMeshesRef = useRef({}); 
  
  // Water simulation references
  const particlesRef = useRef([]);
  const waterMeshRef = useRef(null);
  const dirLightRef = useRef(null);

  // Mutable reference to latest props to completely avoid stale closures in event listeners
  const stateRef = useRef({
    activeTool, brushSize, brushStrength, flattenHeight,
    bermWidth, bermHeight, swaleWidth, swaleDepth, hasSwaleBerm,
    waterDropCount, waterSpeed, waterLife, waterPooling, isWaterPaused,
    isRainActive, rainIntensity, irrigationFlowRate, irrigationSpread,
    terrainHeights, verticalExaggeration, planeWidth, planeHeight, terrainRes,
    objects, selectedObjectId,
    onHeightsChange, onObjectPlaced, onObjectSelected
  });

  useEffect(() => {
    stateRef.current = {
      activeTool, brushSize, brushStrength, flattenHeight,
      bermWidth, bermHeight, swaleWidth, swaleDepth, hasSwaleBerm,
      waterDropCount, waterSpeed, waterLife, waterPooling, isWaterPaused,
      isRainActive, rainIntensity, irrigationFlowRate, irrigationSpread,
      terrainHeights, verticalExaggeration, planeWidth, planeHeight, terrainRes,
      objects, selectedObjectId,
      onHeightsChange, onObjectPlaced, onObjectSelected
    };
  }, [
    activeTool, brushSize, brushStrength, flattenHeight, 
    bermWidth, bermHeight, swaleWidth, swaleDepth, hasSwaleBerm,
    waterDropCount, waterSpeed, waterLife, waterPooling, isWaterPaused,
    isRainActive, rainIntensity, irrigationFlowRate, irrigationSpread,
    terrainHeights, verticalExaggeration, planeWidth, planeHeight, terrainRes, 
    objects, selectedObjectId,
    onHeightsChange, onObjectPlaced, onObjectSelected
  ]);

  useEffect(() => {
    const currentMount = mountRef.current;
    if (!currentMount) return;

    // 1. Scene Setup
    const scene = new THREE.Scene();
    sceneRef.current = scene;
    scene.background = new THREE.Color('#18181b');
    scene.fog = new THREE.FogExp2('#18181b', 0.003); 

    // 2. Camera Setup
    const camera = new THREE.PerspectiveCamera(55, currentMount.clientWidth / currentMount.clientHeight, 0.1, 5000);
    camera.position.set(25, 20, 35);

    // 3. Renderer Setup
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(currentMount.clientWidth, currentMount.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    currentMount.appendChild(renderer.domElement);

    // 4. Orbit Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxPolarAngle = Math.PI / 2 - 0.05; 
    controls.minDistance = 5;
    controls.maxDistance = 1500; 
    controlsRef.current = controls;

    // 5. Lighting Setup
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444455, 0.6);
    hemiLight.position.set(0, 100, 0);
    scene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight(0xfff5e6, 1.2);
    dirLight.position.set(100, 200, 50); 
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 4096; 
    dirLight.shadow.mapSize.height = 4096;
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far = 1000;
    dirLight.shadow.bias = -0.0005; 
    scene.add(dirLight);
    dirLightRef.current = dirLight;

    const fillLight = new THREE.DirectionalLight(0xaaccff, 0.4);
    fillLight.position.set(-100, 50, -50);
    scene.add(fillLight);

    // 6. Terrain/Ground Mesh
    const segments = 128;
    const planeGeo = new THREE.PlaneGeometry(100, 100, segments, segments);
    const planeMat = new THREE.MeshStandardMaterial({ 
      color: 0x27272a, roughness: 0.9, metalness: 0.05, transparent: true, opacity: 1.0
    });
    const plane = new THREE.Mesh(planeGeo, planeMat);
    plane.rotation.x = -Math.PI / 2;
    plane.receiveShadow = true;
    scene.add(plane);
    planeRef.current = plane;
    materialRef.current = planeMat;

    // 7. Grids & Helpers
    const gridHelper = new THREE.GridHelper(100, 100, 0x3f3f46, 0x27272a);
    gridHelper.position.y = 0.05;
    gridHelper.material.opacity = 0.4;
    gridHelper.material.transparent = true;
    scene.add(gridHelper);

    const majorGridHelper = new THREE.GridHelper(100, 10, 0x52525b, 0x52525b);
    majorGridHelper.position.y = 0.06;
    majorGridHelper.material.opacity = 0.3;
    majorGridHelper.material.transparent = true;
    scene.add(majorGridHelper);
    gridRefs.current = [gridHelper, majorGridHelper];

    // 8. Object Group (For placed elements)
    const objectsGroup = new THREE.Group();
    objectsGroup.rotation.x = -Math.PI / 2;
    scene.add(objectsGroup);
    objectsGroupRef.current = objectsGroup;

    // 9. Water Simulation System
    const MAX_PARTICLES = 5000;
    const waterGeo = new THREE.SphereGeometry(0.25, 6, 6);
    const waterMat = new THREE.MeshBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.75 }); 
    const waterMesh = new THREE.InstancedMesh(waterGeo, waterMat, MAX_PARTICLES);
    waterMesh.count = 0;
    scene.add(waterMesh);
    waterMeshRef.current = waterMesh;

    // --- BRUSH & PATH PREVIEW MESHES ---
    const ringGeo = new THREE.RingGeometry(0.8, 1, 32);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x10b981, side: THREE.DoubleSide, transparent: true, opacity: 0.8, depthTest: false });
    const brushMesh = new THREE.Mesh(ringGeo, ringMat);
    brushMesh.visible = false;
    brushMesh.position.y = 0.1; 
    scene.add(brushMesh);
    brushMeshRef.current = brushMesh;

    const lineMat = new THREE.LineBasicMaterial({ color: 0x34d399, depthTest: false, transparent: true, opacity: 0.9 });
    const lineGeo = new THREE.BufferGeometry();
    const linePreview = new THREE.Line(lineGeo, lineMat);
    linePreview.visible = false;
    plane.add(linePreview); 

    // --- INTERACTION LOGIC ---
    let isDragging = false;
    let isDraggingWater = false;
    let isDrawingPath = false;
    let drawnPath = [];
    let workingHeights = null;
    
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    
    const sculptTools = ['raise', 'lower', 'smooth', 'flatten'];
    const pathTools = ['berm', 'swale'];
    const objectTools = ['garden', 'tree', 'pond', 'path', 'building', 'irrigation'];

    const getIntersect = (e, targetObject) => {
      const rect = currentMount.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObject(targetObject, true);
      return intersects.length > 0 ? intersects[0] : null;
    };

    const spawnWaterWorld = (wx, wz, spread = 0.5) => {
      if (particlesRef.current.length >= MAX_PARTICLES) particlesRef.current.shift();
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * spread;
      particlesRef.current.push({
        x: wx + Math.cos(angle) * radius,
        z: wz + Math.sin(angle) * radius,
        vx: (Math.random() - 0.5) * 0.05,
        vz: (Math.random() - 0.5) * 0.05,
        age: 0,
        isPooled: false
      });
    };

    const spawnWaterAt = (hitPoint) => {
      const state = stateRef.current;
      for (let i = 0; i < state.waterDropCount; i++) {
        spawnWaterWorld(hitPoint.x, hitPoint.z, state.brushSize * 0.5);
      }
    };

    const updateLineGeometry = () => {
      const state = stateRef.current;
      const positions = new Float32Array(drawnPath.length * 3);
      for (let i = 0; i < drawnPath.length; i++) {
        positions[i * 3] = drawnPath[i].x;
        positions[i * 3 + 1] = drawnPath[i].y;
        positions[i * 3 + 2] = (drawnPath[i].z + 0.5) * state.verticalExaggeration;
      }
      linePreview.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    };

    const applyPathTool = (path) => {
      const state = stateRef.current;
      const segments = state.terrainRes === 'low' ? 64 : state.terrainRes === 'high' ? 256 : 128;
      const newHeights = new Float32Array(state.terrainHeights);
      const positions = plane.geometry.attributes.position.array;
      
      let minC = segments, maxC = 0, minR = segments, maxR = 0;
      const pad = Math.max(state.bermWidth, state.swaleWidth) + (state.hasSwaleBerm ? state.bermWidth : 0) + 2;
      
      path.forEach(p => {
        const c = (p.x + state.planeWidth/2) / state.planeWidth * segments;
        const r = (-p.y + state.planeHeight/2) / state.planeHeight * segments;
        const padC = (pad / state.planeWidth) * segments;
        const padR = (pad / state.planeHeight) * segments;
        minC = Math.min(minC, Math.floor(c - padC)); maxC = Math.max(maxC, Math.ceil(c + padC));
        minR = Math.min(minR, Math.floor(r - padR)); maxR = Math.max(maxR, Math.ceil(r + padR));
      });
      minC = Math.max(0, minC); maxC = Math.min(segments, maxC);
      minR = Math.max(0, minR); maxR = Math.min(segments, maxR);
      
      let geometryUpdated = false;

      for (let r = minR; r <= maxR; r++) {
        for (let c = minC; c <= maxC; c++) {
          const gx = (c / segments) * state.planeWidth - state.planeWidth / 2;
          const gy = state.planeHeight / 2 - (r / segments) * state.planeHeight;
          
          let minDist = Infinity;
          let minSignedSide = 1;
          
          for (let i = 0; i < path.length - 1; i++) {
            const ax = path[i].x, ay = path[i].y;
            const bx = path[i+1].x, by = path[i+1].y;
            const dx = bx - ax, dy = by - ay;
            const len2 = dx*dx + dy*dy;
            let t = 0;
            if (len2 > 0) t = Math.max(0, Math.min(1, ((gx - ax)*dx + (gy - ay)*dy) / len2));
            
            const px = ax + t*dx, py = ay + t*dy;
            const dist = Math.hypot(gx - px, gy - py);
            
            if (dist < minDist) {
              minDist = dist;
              const cross = dx * (gy - ay) - dy * (gx - ax);
              minSignedSide = Math.sign(cross) || 1;
            }
          }
          
          const idx = r * (segments + 1) + c;
          let h = newHeights[idx];
          let modified = false;
          
          if (state.activeTool === 'berm') {
            if (minDist < state.bermWidth) {
              const ratio = minDist / state.bermWidth;
              h += state.bermHeight * Math.pow(Math.cos(ratio * Math.PI / 2), 2);
              modified = true;
            }
          } else if (state.activeTool === 'swale') {
            if (minDist < state.swaleWidth) {
              const ratio = minDist / state.swaleWidth;
              h -= state.swaleDepth * Math.pow(Math.cos(ratio * Math.PI / 2), 2);
              modified = true;
            } else if (state.hasSwaleBerm && minSignedSide > 0) {
              const offsetDist = minDist - state.swaleWidth;
              if (offsetDist > 0 && offsetDist < state.bermWidth) {
                const ratio = Math.abs(offsetDist - state.bermWidth/2) / (state.bermWidth/2);
                h += state.bermHeight * Math.pow(Math.cos(ratio * Math.PI / 2), 2);
                modified = true;
              }
            }
          }
          
          if (modified) {
            newHeights[idx] = h;
            positions[idx * 3 + 2] = h * state.verticalExaggeration;
            geometryUpdated = true;
          }
        }
      }
      
      if (geometryUpdated) {
        plane.geometry.attributes.position.needsUpdate = true;
        plane.geometry.computeVertexNormals();
        if (state.onHeightsChange) state.onHeightsChange(newHeights);
      }
    };

    const applyBrush = (e) => {
      const state = stateRef.current;
      if (!planeRef.current || !workingHeights) return;

      const hit = getIntersect(e, planeRef.current);
      if (!hit) return;

      const point = planeRef.current.worldToLocal(hit.point.clone());
      const segments = state.terrainRes === 'low' ? 64 : state.terrainRes === 'high' ? 256 : 128;
      const positions = planeRef.current.geometry.attributes.position.array;

      const minCol = Math.max(0, Math.floor(((point.x - state.brushSize + state.planeWidth/2) / state.planeWidth) * segments));
      const maxCol = Math.min(segments, Math.ceil(((point.x + state.brushSize + state.planeWidth/2) / state.planeWidth) * segments));
      const minRow = Math.max(0, Math.floor(((-point.y - state.brushSize + state.planeHeight/2) / state.planeHeight) * segments));
      const maxRow = Math.min(segments, Math.ceil(((-point.y + state.brushSize + state.planeHeight/2) / state.planeHeight) * segments));

      let avgHeight = 0, count = 0;
      if (state.activeTool === 'smooth') {
        for (let r = minRow; r <= maxRow; r++) {
          for (let c = minCol; c <= maxCol; c++) {
            const i = r * (segments + 1) + c;
            if (Math.hypot(positions[i * 3] - point.x, positions[i * 3 + 1] - point.y) < state.brushSize) {
              avgHeight += workingHeights[i];
              count++;
            }
          }
        }
        if (count > 0) avgHeight /= count;
      }

      let geometryUpdated = false;
      const baseDelta = (state.brushStrength / 100) * 0.5;

      for (let r = minRow; r <= maxRow; r++) {
        for (let c = minCol; c <= maxCol; c++) {
          const i = r * (segments + 1) + c;
          const dist = Math.hypot(positions[i * 3] - point.x, positions[i * 3 + 1] - point.y);

          if (dist < state.brushSize) {
            const falloff = Math.cos((dist / state.brushSize) * (Math.PI / 2));
            let h = workingHeights[i];

            if (state.activeTool === 'raise') h += baseDelta * falloff;
            else if (state.activeTool === 'lower') h -= baseDelta * falloff;
            else if (state.activeTool === 'flatten') h += (state.flattenHeight - h) * baseDelta * 0.5 * falloff;
            else if (state.activeTool === 'smooth') h += (avgHeight - h) * baseDelta * 0.5 * falloff;

            workingHeights[i] = h; 
            positions[i * 3 + 2] = h * state.verticalExaggeration;
            geometryUpdated = true;
          }
        }
      }

      if (geometryUpdated) {
        planeRef.current.geometry.attributes.position.needsUpdate = true;
        planeRef.current.geometry.computeVertexNormals();
      }
    };

    const onPointerDown = (e) => {
      const state = stateRef.current;
      if (e.button !== 0) return; 

      if (sculptTools.includes(state.activeTool)) {
        isDragging = true;
        workingHeights = new Float32Array(state.terrainHeights);
        applyBrush(e);
      } 
      else if (pathTools.includes(state.activeTool)) {
        const hit = getIntersect(e, planeRef.current);
        if (hit) {
          isDrawingPath = true;
          drawnPath = [planeRef.current.worldToLocal(hit.point.clone())];
          linePreview.visible = true;
          updateLineGeometry();
        }
      }
      else if (state.activeTool === 'water') {
        const hit = getIntersect(e, planeRef.current);
        if (hit) {
          isDraggingWater = true;
          spawnWaterAt(hit.point);
        }
      }
      else if (objectTools.includes(state.activeTool)) {
        const hit = getIntersect(e, planeRef.current);
        if (hit && state.onObjectPlaced) {
          const point = planeRef.current.worldToLocal(hit.point.clone());
          const defColors = { tree: '#22c55e', garden: '#854d0e', pond: '#3b82f6', path: '#a1a1aa', building: '#e4e4e7', irrigation: '#0ea5e9' };
          
          const uid = typeof crypto !== 'undefined' && crypto.randomUUID 
             ? crypto.randomUUID() 
             : Math.random().toString(36).substring(2, 11);

          state.onObjectPlaced({
            id: uid,
            type: state.activeTool,
            position: [point.x, point.y, point.z / state.verticalExaggeration],
            scale: 1,
            color: defColors[state.activeTool] || '#ffffff',
            name: `New ${state.activeTool.charAt(0).toUpperCase() + state.activeTool.slice(1)}`,
            isFlowing: state.activeTool === 'irrigation' ? true : undefined
          });
        }
      }
      else if (state.activeTool === 'select') {
        const hit = getIntersect(e, objectsGroupRef.current);
        if (hit && hit.object.userData.id) {
          if (state.onObjectSelected) state.onObjectSelected(hit.object.userData.id);
        } else {
          const terrainHit = getIntersect(e, planeRef.current);
          if (terrainHit && state.onObjectSelected) state.onObjectSelected(null);
        }
      }
    };

    const onPointerMove = (e) => {
      const state = stateRef.current;
      
      if (sculptTools.includes(state.activeTool) || state.activeTool === 'water') {
        const hit = getIntersect(e, planeRef.current);
        if (hit) {
          brushMesh.visible = true;
          brushMesh.position.copy(hit.point);
          brushMesh.position.y = hit.point.y + 0.1;
          brushMesh.scale.set(state.brushSize, state.brushSize, state.brushSize);
          
          if (isDragging) applyBrush(e);
          if (isDraggingWater) spawnWaterAt(hit.point);
        } else {
          brushMesh.visible = false;
        }
      } else if (pathTools.includes(state.activeTool)) {
        brushMesh.visible = false;
        if (isDrawingPath) {
          const hit = getIntersect(e, planeRef.current);
          if (hit) {
            const point = planeRef.current.worldToLocal(hit.point.clone());
            if (drawnPath.length > 0 && drawnPath[drawnPath.length - 1].distanceTo(point) > 0.5) {
              drawnPath.push(point);
              updateLineGeometry();
            }
          }
        }
      } else {
        brushMesh.visible = false;
      }
    };

    const onPointerUp = () => {
      const state = stateRef.current;
      if (isDragging) {
        isDragging = false;
        if (state.onHeightsChange && workingHeights) state.onHeightsChange(workingHeights);
        workingHeights = null;
      }
      if (isDraggingWater) {
        isDraggingWater = false;
      }
      if (isDrawingPath) {
        isDrawingPath = false;
        linePreview.visible = false;
        if (drawnPath.length > 1) {
          applyPathTool(drawnPath);
        }
        drawnPath = [];
      }
    };

    currentMount.addEventListener('pointerdown', onPointerDown);
    currentMount.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp); 

    const handleResize = () => {
      if (!currentMount) return;
      renderer.setSize(currentMount.clientWidth, currentMount.clientHeight);
      camera.aspect = currentMount.clientWidth / currentMount.clientHeight;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', handleResize);

    // --- PHYSICS HELPER FOR WATER ---
    const getTerrainHeightWorld = (wx, wz, state) => {
      const { planeWidth: w, planeHeight: h, terrainHeights, terrainRes, verticalExaggeration } = state;
      const segs = terrainRes === 'low' ? 64 : terrainRes === 'high' ? 256 : 128;
      
      const px = wx;
      const py = -wz; 
      
      let c = (px + w/2) / w * segs;
      let r = (h/2 - py) / h * segs;

      if (c <= 0 || c >= segs || r <= 0 || r >= segs) return -999;

      const c0 = Math.floor(c);
      const c1 = Math.min(segs, c0 + 1);
      const r0 = Math.floor(r);
      const r1 = Math.min(segs, r0 + 1);

      const u = c - c0;
      const v = r - r0;

      const h00 = terrainHeights[r0 * (segs + 1) + c0];
      const h10 = terrainHeights[r0 * (segs + 1) + c1];
      const h01 = terrainHeights[r1 * (segs + 1) + c0];
      const h11 = terrainHeights[r1 * (segs + 1) + c1];

      const height0 = h00 * (1 - u) + h10 * u;
      const height1 = h01 * (1 - u) + h11 * u;
      return (height0 * (1 - v) + height1 * v) * verticalExaggeration;
    };

    let animationFrameId;
    const dummy = new THREE.Object3D();

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      controls.update(); 
      
      const state = stateRef.current;
      
      // Automatic Water Spawning (Rain & Irrigation)
      if (!state.isWaterPaused) {
        if (state.isRainActive) {
          for (let i = 0; i < state.rainIntensity; i++) {
            const rx = (Math.random() - 0.5) * state.planeWidth * 0.95;
            const rz = (Math.random() - 0.5) * state.planeHeight * 0.95;
            spawnWaterWorld(rx, rz, 0);
          }
        }
        
        state.objects.forEach(obj => {
          if (obj.type === 'irrigation' && obj.isFlowing !== false) {
            const rate = state.irrigationFlowRate;
            const drops = Math.floor(rate) + (Math.random() < (rate % 1) ? 1 : 0);
            if (drops > 0) {
              const mesh = objectMeshesRef.current[obj.id];
              if (mesh) {
                const wPos = new THREE.Vector3();
                mesh.getWorldPosition(wPos);
                for(let i=0; i<drops; i++) {
                  spawnWaterWorld(wPos.x, wPos.z, state.irrigationSpread);
                }
              }
            }
          }
        });
      }

      // Physics Loop
      if (!state.isWaterPaused && particlesRef.current.length > 0) {
        const newParticles = [];
        const eps = 0.5; 
        
        for (let i = 0; i < particlesRef.current.length; i++) {
          const p = particlesRef.current[i];
          p.age++;

          if (p.age > state.waterLife) continue;

          const hCenter = getTerrainHeightWorld(p.x, p.z, state);
          if (hCenter === -999) continue; 
          
          const hX1 = getTerrainHeightWorld(p.x + eps, p.z, state);
          const hX0 = getTerrainHeightWorld(p.x - eps, p.z, state);
          const hZ1 = getTerrainHeightWorld(p.x, p.z + eps, state);
          const hZ0 = getTerrainHeightWorld(p.x, p.z - eps, state);
          
          const dx = (hX1 - hX0) / (2 * eps);
          const dz = (hZ1 - hZ0) / (2 * eps);

          p.vx -= dx * state.waterSpeed * 0.05;
          p.vz -= dz * state.waterSpeed * 0.05;

          p.vx *= 0.85;
          p.vz *= 0.85;

          p.vx += (Math.random() - 0.5) * 0.005;
          p.vz += (Math.random() - 0.5) * 0.005;

          const speedSq = p.vx * p.vx + p.vz * p.vz;
          
          if (speedSq < (0.0005 * state.waterPooling) && p.age > 20) {
             p.isPooled = true;
             // Pool decay logic: drastically extend life while pooled
             p.age -= 0.85; 
          } else {
             p.isPooled = false;
          }

          p.x += p.vx;
          p.z += p.vz;

          const renderHeight = getTerrainHeightWorld(p.x, p.z, state);
          if (renderHeight === -999) continue;

          const lifeRatio = Math.max(0.01, 1 - (p.age / state.waterLife));
          
          if (p.isPooled) {
            dummy.position.set(p.x, renderHeight + 0.05, p.z);
            dummy.scale.set(lifeRatio * 2.5, lifeRatio * 0.3, lifeRatio * 2.5);
          } else {
            dummy.position.set(p.x, renderHeight + 0.15, p.z);
            dummy.scale.setScalar(lifeRatio);
          }
          
          dummy.updateMatrix();
          waterMesh.setMatrixAt(newParticles.length, dummy.matrix);
          
          newParticles.push(p);
        }

        particlesRef.current = newParticles;
        waterMesh.count = newParticles.length;
        waterMesh.instanceMatrix.needsUpdate = true;
      }

      renderer.render(scene, camera);
    };
    animate();

    return () => {
      window.removeEventListener('resize', handleResize);
      currentMount.removeEventListener('pointerdown', onPointerDown);
      currentMount.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      
      cancelAnimationFrame(animationFrameId);
      if (currentMount && renderer.domElement && currentMount.contains(renderer.domElement)) {
        currentMount.removeChild(renderer.domElement);
      }
      if (planeRef.current && planeRef.current.geometry) planeRef.current.geometry.dispose();
      planeMat.dispose();
      ringGeo.dispose();
      ringMat.dispose();
      lineGeo.dispose();
      lineMat.dispose();
      waterGeo.dispose();
      waterMat.dispose();
      renderer.dispose();
    };
  }, []); 

  // Reactivity: Clear Water Trigger
  useEffect(() => {
    if (clearWaterTrigger > 0) {
      particlesRef.current = [];
      if (waterMeshRef.current) {
        waterMeshRef.current.count = 0;
        waterMeshRef.current.instanceMatrix.needsUpdate = true;
      }
    }
  }, [clearWaterTrigger]);

  // Reactivity: Orbit Controls Mode
  useEffect(() => {
    if (controlsRef.current) {
      const activeToolsThatNeedLeftClick = ['raise', 'lower', 'smooth', 'flatten', 'berm', 'swale', 'garden', 'tree', 'pond', 'path', 'building', 'water', 'irrigation'];
      if (activeToolsThatNeedLeftClick.includes(activeTool)) {
        controlsRef.current.mouseButtons.LEFT = null;
      } else {
        controlsRef.current.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
      }
    }
  }, [activeTool]);

  // Reactivity: Dynamically scale lighting shadows to cover the whole map size
  useEffect(() => {
    if (dirLightRef.current) {
      const maxDim = Math.max(planeWidth, planeHeight) / 2;
      const pad = 50; 
      const cam = dirLightRef.current.shadow.camera;
      cam.left = -(maxDim + pad);
      cam.right = maxDim + pad;
      cam.top = maxDim + pad;
      cam.bottom = -(maxDim + pad);
      cam.updateProjectionMatrix();
    }
  }, [planeWidth, planeHeight]);

  // Reactivity: Terrain Mesh updates
  useEffect(() => {
    if (planeRef.current) {
      planeRef.current.geometry.dispose();
      const segments = terrainRes === 'low' ? 64 : terrainRes === 'high' ? 256 : 128;
      planeRef.current.geometry = new THREE.PlaneGeometry(planeWidth, planeHeight, segments, segments);
    }
  }, [planeWidth, planeHeight, terrainRes]);

  useEffect(() => {
    if (planeRef.current && terrainHeights) {
      const geometry = planeRef.current.geometry;
      const positions = geometry.attributes.position.array;
      if (positions.length / 3 === terrainHeights.length) {
        for (let i = 0; i < terrainHeights.length; i++) {
          positions[i * 3 + 2] = terrainHeights[i] * verticalExaggeration;
        }
        geometry.attributes.position.needsUpdate = true;
        geometry.computeVertexNormals();
      }
    }
  }, [terrainHeights, verticalExaggeration, planeWidth, planeHeight, terrainRes]);

  // Reactivity: Placed Objects Synchronization
  useEffect(() => {
    if (!objectsGroupRef.current) return;
    const group = objectsGroupRef.current;
    const currentIds = new Set(objects.map(o => o.id));

    // Cleanup removed objects
    Object.keys(objectMeshesRef.current).forEach(id => {
      if (!currentIds.has(id)) {
        const mesh = objectMeshesRef.current[id];
        group.remove(mesh);
        if (mesh.geometry) mesh.geometry.dispose();
        if (mesh.material) mesh.material.dispose();
        delete objectMeshesRef.current[id];
      }
    });

    // Create / Update objects
    objects.forEach(obj => {
      let mesh = objectMeshesRef.current[obj.id];
      if (!mesh) {
        let geo;
        if (obj.type === 'tree') geo = new THREE.ConeGeometry(1, 3, 8).translate(0, 1.5, 0);
        else if (obj.type === 'garden') geo = new THREE.BoxGeometry(2, 0.5, 4).translate(0, 0.25, 0);
        else if (obj.type === 'pond') geo = new THREE.CylinderGeometry(3, 3, 0.1, 16).translate(0, 0.05, 0);
        else if (obj.type === 'path') geo = new THREE.CylinderGeometry(0.5, 0.5, 0.1, 8).translate(0, 0.05, 0);
        else if (obj.type === 'building') geo = new THREE.BoxGeometry(4, 3, 4).translate(0, 1.5, 0);
        else if (obj.type === 'irrigation') geo = new THREE.CylinderGeometry(0.2, 0.2, 1.5, 8).translate(0, 0.75, 0);
        else geo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);

        geo.rotateX(Math.PI / 2);
        const mat = new THREE.MeshStandardMaterial({ color: obj.color });
        mesh = new THREE.Mesh(geo, mat);
        mesh.userData.id = obj.id;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
        objectMeshesRef.current[obj.id] = mesh;
      }

      mesh.position.set(obj.position[0], obj.position[1], obj.position[2] * verticalExaggeration);
      mesh.scale.set(obj.scale, obj.scale, obj.scale);
      mesh.material.color.set(obj.color);
      
      if (obj.id === selectedObjectId) mesh.material.emissive.setHex(0x333333);
      else mesh.material.emissive.setHex(0x000000);
    });
  }, [objects, selectedObjectId, verticalExaggeration]);

  // Reactivity: Grid & Image Texture
  useEffect(() => {
    gridRefs.current.forEach(grid => { if (grid) grid.visible = showGrid; });
  }, [showGrid]);

  useEffect(() => {
    if (materialRef.current) {
      materialRef.current.opacity = imageOpacity;
      if (imageUrl) {
        const loader = new THREE.TextureLoader();
        loader.load(imageUrl, (texture) => {
          texture.colorSpace = THREE.SRGBColorSpace;
          materialRef.current.map = texture;
          materialRef.current.color.setHex(0xffffff);
          materialRef.current.needsUpdate = true;
        });
      } else {
        materialRef.current.map = null;
        materialRef.current.color.setHex(0x27272a);
        materialRef.current.needsUpdate = true;
      }
    }
  }, [imageUrl, imageOpacity]);

  return <div ref={mountRef} className="absolute inset-0 bg-zinc-900" />;
};


/**
 * ------------------------------------------------------------------
 * ACCORDION PANEL COMPONENT
 * ------------------------------------------------------------------
 */
const SidebarPanel = ({ title, icon: Icon, children, defaultOpen = true }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-zinc-800">
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-4 py-3 flex items-center justify-between bg-zinc-950 hover:bg-zinc-900 transition-colors text-zinc-200"
      >
        <div className="flex items-center gap-2 font-medium text-sm tracking-wide">
          <Icon size={16} className="text-zinc-400" />
          {title}
        </div>
        {isOpen ? <ChevronDown size={16} className="text-zinc-500"/> : <ChevronRight size={16} className="text-zinc-500"/>}
      </button>
      {isOpen && <div className="p-4 bg-zinc-950/50 text-sm text-zinc-400">{children}</div>}
    </div>
  );
};

/**
 * ------------------------------------------------------------------
 * MAIN APPLICATION COMPONENT
 * ------------------------------------------------------------------
 */
export default function App() {
  const [activeTool, setActiveTool] = useState('select');
  const [imageUrl, setImageUrl] = useState(null);
  const [planeWidth, setPlaneWidth] = useState(100);
  const [planeHeight, setPlaneHeight] = useState(100);
  const [imageOpacity, setImageOpacity] = useState(1.0);
  const [showGrid, setShowGrid] = useState(true);

  // Terrain Mesh & Brush State
  const [terrainRes, setTerrainRes] = useState('medium');
  const [verticalExaggeration, setVerticalExaggeration] = useState(1.0);
  const [brushSize, setBrushSize] = useState(10);
  const [brushStrength, setBrushStrength] = useState(50);
  const [flattenHeight, setFlattenHeight] = useState(0);
  
  // Berm & Swale State
  const [bermWidth, setBermWidth] = useState(3.0);
  const [bermHeight, setBermHeight] = useState(1.5);
  const [swaleWidth, setSwaleWidth] = useState(2.0);
  const [swaleDepth, setSwaleDepth] = useState(1.0);
  const [hasSwaleBerm, setHasSwaleBerm] = useState(true);

  // Water Simulation State
  const [waterDropCount, setWaterDropCount] = useState(5);
  const [waterSpeed, setWaterSpeed] = useState(1.0);
  const [waterLife, setWaterLife] = useState(200);
  const [waterPooling, setWaterPooling] = useState(50);
  const [isWaterPaused, setIsWaterPaused] = useState(false);
  const [clearWaterTrigger, setClearWaterTrigger] = useState(0);
  
  const [isRainActive, setIsRainActive] = useState(false);
  const [rainIntensity, setRainIntensity] = useState(2);
  const [irrigationFlowRate, setIrrigationFlowRate] = useState(0.5);
  const [irrigationSpread, setIrrigationSpread] = useState(1.0);

  const [selectedObjectId, setSelectedObjectId] = useState(null);

  // Unified History State (Terrain + Objects)
  const getInitialState = (res) => {
    const segments = res === 'low' ? 64 : res === 'high' ? 256 : 128;
    return {
      heights: new Float32Array((segments + 1) * (segments + 1)),
      objects: []
    };
  };
  
  const MAX_HISTORY = 30;
  const [historyData, setHistoryData] = useState({
    history: [getInitialState('medium')],
    step: 0
  });
  
  const currentState = historyData.history[historyData.step] || getInitialState('medium');

  const pushToHistory = (newState) => {
    setHistoryData(prev => {
      const newHistory = prev.history.slice(0, prev.step + 1);
      newHistory.push(newState);
      if (newHistory.length > MAX_HISTORY) newHistory.shift();
      return { history: newHistory, step: newHistory.length - 1 };
    });
  };

  const handleUndo = () => setHistoryData(prev => ({ ...prev, step: Math.max(0, prev.step - 1) })); 
  const handleRedo = () => setHistoryData(prev => ({ ...prev, step: Math.min(prev.history.length - 1, prev.step + 1) })); 

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName.toLowerCase() === 'input') return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) handleRedo(); else handleUndo();
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedObjectId) {
        const newObjs = currentState.objects.filter(o => o.id !== selectedObjectId);
        pushToHistory({ heights: currentState.heights, objects: newObjs });
        setSelectedObjectId(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [historyData.step, historyData.history.length, selectedObjectId, currentState]);

  const handleResChange = (newRes) => {
    setTerrainRes(newRes);
    setHistoryData({ history: [getInitialState(newRes)], step: 0 });
  };

  const tools = [
    { id: 'select', name: 'Select', icon: MousePointer2, group: 'basic' },
    { id: 'raise', name: 'Raise', icon: ArrowUpFromLine, group: 'terrain' },
    { id: 'lower', name: 'Lower', icon: ArrowDownToLine, group: 'terrain' },
    { id: 'smooth', name: 'Smooth', icon: Wind, group: 'terrain' },
    { id: 'flatten', name: 'Flatten', icon: Minus, group: 'terrain' },
    { id: 'berm', name: 'Berm', icon: Mountain, group: 'earthworks' },
    { id: 'swale', name: 'Swale', icon: Waves, group: 'earthworks' },
    { id: 'building', name: 'Building', icon: Home, group: 'features' },
    { id: 'garden', name: 'Garden', icon: Sprout, group: 'features' },
    { id: 'tree', name: 'Tree', icon: TreePine, group: 'features' },
    { id: 'pond', name: 'Pond', icon: Droplet, group: 'features' },
    { id: 'path', name: 'Path', icon: Route, group: 'features' },
    { id: 'irrigation', name: 'Irrigation', icon: Pipette, group: 'features' },
    { id: 'water', name: 'Water Drop', icon: Droplets, group: 'analysis' },
  ];

  return (
    <div className="h-screen w-screen flex flex-col bg-zinc-950 text-zinc-100 font-sans overflow-hidden">
      
      {/* --- TOP NAVIGATION BAR --- */}
      <header className="h-14 min-h-[3.5rem] bg-zinc-950 border-b border-zinc-800 flex items-center px-6 justify-between z-10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-md bg-gradient-to-br from-emerald-600 to-teal-800 flex items-center justify-center shadow-lg">
            <Sprout size={18} className="text-white" />
          </div>
          <h1 className="font-semibold text-lg tracking-wide text-zinc-100">Permascape 3D</h1>
          <span className="ml-2 px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 text-xs font-medium">Alpha</span>
        </div>
        
        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-1 mr-2 border-r border-zinc-800 pr-6">
            <button onClick={handleUndo} disabled={historyData.step === 0} title="Undo (Ctrl+Z)" className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 disabled:opacity-30 disabled:hover:bg-transparent transition-colors">
              <Undo size={16} />
            </button>
            <button onClick={handleRedo} disabled={historyData.step === historyData.history.length - 1} title="Redo (Ctrl+Shift+Z)" className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 disabled:opacity-30 disabled:hover:bg-transparent transition-colors">
              <Redo size={16} />
            </button>
          </div>
          <button className="px-4 py-1.5 rounded-md hover:bg-zinc-800 text-zinc-300 transition-colors">File</button>
          <button className="px-4 py-1.5 rounded-md hover:bg-zinc-800 text-zinc-300 transition-colors">View</button>
          <div className="h-4 w-px bg-zinc-700 mx-1"></div>
          <button className="px-4 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white font-medium transition-colors shadow-sm">
            Save Project
          </button>
        </div>
      </header>

      {/* --- MAIN WORKSPACE --- */}
      <div className="flex-1 flex overflow-hidden">
        
        {/* LEFT SIDEBAR: Tool Palette */}
        <aside className="w-20 md:w-56 bg-zinc-950 border-r border-zinc-800 flex flex-col overflow-y-auto z-10 shadow-[4px_0_24px_rgba(0,0,0,0.2)]">
          <div className="p-4 uppercase text-[10px] font-bold tracking-widest text-zinc-500">Design Tools</div>
          
          <div className="flex-1 px-2 pb-4 space-y-1">
            {tools.map((tool, idx) => {
              const isActive = activeTool === tool.id;
              const showDivider = idx > 0 && tools[idx - 1].group !== tool.group;
              
              return (
                <React.Fragment key={tool.id}>
                  {showDivider && <div className="h-px bg-zinc-800/60 my-2 mx-2" />}
                  <button
                    onClick={() => { setActiveTool(tool.id); setSelectedObjectId(null); }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 group
                      ${isActive ? 'bg-emerald-600/10 text-emerald-400' : 'text-zinc-400 hover:bg-zinc-800/80 hover:text-zinc-200'}`}
                  >
                    <tool.icon size={18} className={`${isActive ? 'text-emerald-400' : 'text-zinc-500 group-hover:text-zinc-300'}`} />
                    <span className="hidden md:block font-medium text-sm">{tool.name}</span>
                  </button>
                </React.Fragment>
              );
            })}
          </div>
        </aside>

        {/* CENTER: 3D Viewport Area */}
        <main className="flex-1 relative bg-zinc-900 overflow-hidden">
          <Viewport3D 
            imageUrl={imageUrl} planeWidth={planeWidth} planeHeight={planeHeight} imageOpacity={imageOpacity} showGrid={showGrid}
            terrainRes={terrainRes} verticalExaggeration={verticalExaggeration} terrainHeights={currentState.heights}
            activeTool={activeTool} brushSize={brushSize} brushStrength={brushStrength} flattenHeight={flattenHeight}
            bermWidth={bermWidth} bermHeight={bermHeight} swaleWidth={swaleWidth} swaleDepth={swaleDepth} hasSwaleBerm={hasSwaleBerm}
            waterDropCount={waterDropCount} waterSpeed={waterSpeed} waterLife={waterLife} waterPooling={waterPooling} 
            isWaterPaused={isWaterPaused} clearWaterTrigger={clearWaterTrigger}
            isRainActive={isRainActive} rainIntensity={rainIntensity} irrigationFlowRate={irrigationFlowRate} irrigationSpread={irrigationSpread}
            objects={currentState.objects} selectedObjectId={selectedObjectId}
            onHeightsChange={(newHeights) => pushToHistory({ heights: newHeights, objects: currentState.objects })}
            onObjectPlaced={(newObj) => pushToHistory({ heights: currentState.heights, objects: [...currentState.objects, newObj] })}
            onObjectSelected={setSelectedObjectId}
          />
          
          <div className="absolute top-4 left-4 pointer-events-none">
            <div className="bg-zinc-950/80 backdrop-blur-md border border-zinc-800 px-3 py-1.5 rounded-md text-xs font-mono text-zinc-400 shadow-lg pointer-events-auto">
              Camera: Perspective | Orbit
            </div>
          </div>
        </main>

        {/* RIGHT SIDEBAR: Properties & Layers */}
        <aside className="w-72 bg-zinc-950 border-l border-zinc-800 flex flex-col overflow-y-auto z-10 shadow-[-4px_0_24px_rgba(0,0,0,0.2)]">
          
          {selectedObjectId && (() => {
            const selObj = currentState.objects.find(o => o.id === selectedObjectId);
            if (!selObj) return null;
            
            const handleUpdate = (updates) => {
              const newObjs = currentState.objects.map(o => o.id === selectedObjectId ? { ...o, ...updates } : o);
              pushToHistory({ heights: currentState.heights, objects: newObjs });
            };

            return (
              <SidebarPanel title="Selected Element" icon={BoxSelect} defaultOpen={true}>
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs text-emerald-500 mb-1 uppercase tracking-wider">Label / Name</label>
                    <input 
                      type="text" value={selObj.name} onChange={e => handleUpdate({ name: e.target.value })}
                      className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                  
                  {selObj.type === 'irrigation' && (
                    <div className="flex items-center gap-3 pt-2 pb-1 border-b border-zinc-800">
                      <input 
                        type="checkbox" id="flowToggle" checked={selObj.isFlowing !== false} 
                        onChange={e => handleUpdate({ isFlowing: e.target.checked })} 
                        className="rounded bg-zinc-900 border-zinc-700 text-emerald-500" 
                      />
                      <label htmlFor="flowToggle" className="text-sm text-zinc-300 cursor-pointer">Emit Water Flow</label>
                    </div>
                  )}

                  <div className="flex gap-3">
                    <div className="flex-1">
                      <div className="flex justify-between mb-1">
                        <label className="text-xs text-zinc-500 uppercase tracking-wider">Scale</label>
                        <span className="text-xs text-zinc-300 font-mono">{selObj.scale.toFixed(1)}x</span>
                      </div>
                      <input 
                        type="range" min="0.1" max="5" step="0.1" value={selObj.scale} onChange={e => handleUpdate({ scale: Number(e.target.value) })}
                        className="w-full accent-emerald-500 h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer" 
                      />
                    </div>
                    <div className="w-10">
                      <label className="block text-xs text-zinc-500 mb-1 uppercase tracking-wider">Color</label>
                      <input 
                        type="color" value={selObj.color} onChange={e => handleUpdate({ color: e.target.value })}
                        className="w-full h-6 rounded cursor-pointer border-0 bg-transparent p-0"
                      />
                    </div>
                  </div>
                  <button 
                    onClick={() => {
                      pushToHistory({ heights: currentState.heights, objects: currentState.objects.filter(o => o.id !== selectedObjectId) });
                      setSelectedObjectId(null);
                    }}
                    className="w-full flex items-center justify-center gap-2 py-1.5 mt-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 rounded text-xs transition-colors"
                  >
                    <Trash2 size={14}/> Delete Element
                  </button>
                </div>
              </SidebarPanel>
            );
          })()}

          {['water'].includes(activeTool) && (
            <SidebarPanel title="Water Simulation" icon={Droplets} defaultOpen={true}>
              <div className="space-y-4">
                {/* Global Controls */}
                <div className="flex gap-2 pb-4 border-b border-zinc-800">
                  <button 
                    onClick={() => setIsWaterPaused(!isWaterPaused)}
                    className="flex-1 flex items-center justify-center gap-2 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded text-xs transition-colors"
                  >
                    {isWaterPaused ? <Play size={14}/> : <Pause size={14}/>} {isWaterPaused ? "Resume" : "Pause"}
                  </button>
                  <button 
                    onClick={() => setClearWaterTrigger(prev => prev + 1)}
                    className="flex-1 flex items-center justify-center gap-2 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded text-xs transition-colors"
                  >
                    <Eraser size={14}/> Clear
                  </button>
                </div>
                
                {/* Continuous Rain Mode */}
                <div className="pt-1">
                  <label className="block text-xs text-blue-400 mb-2 uppercase tracking-wider font-semibold">Continuous Rain Mode</label>
                  <button 
                    onClick={() => setIsRainActive(!isRainActive)}
                    className={`w-full flex items-center justify-center gap-2 py-2 mb-3 border rounded text-xs transition-colors ${
                      isRainActive ? 'bg-blue-600/20 border-blue-500 text-blue-300' : 'bg-blue-500/5 border-blue-500/20 text-blue-500 hover:bg-blue-500/10'
                    }`}
                  >
                    <CloudRain size={14}/> {isRainActive ? "Stop Rainfall" : "Start Rainfall"}
                  </button>
                  <div>
                    <div className="flex justify-between mb-1">
                      <label className="text-xs text-zinc-500 uppercase tracking-wider">Rain Intensity</label>
                      <span className="text-xs text-zinc-300 font-mono">{rainIntensity}x</span>
                    </div>
                    <input type="range" min="1" max="10" value={rainIntensity} onChange={e => setRainIntensity(Number(e.target.value))} className="w-full accent-blue-500 h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer" />
                  </div>
                </div>

                {/* Irrigation Line Mode */}
                <div className="pt-3 border-t border-zinc-800">
                  <label className="block text-xs text-blue-400 mb-2 uppercase tracking-wider font-semibold">Irrigation Mode</label>
                  <div>
                    <div className="flex justify-between mb-1">
                      <label className="text-xs text-zinc-500 uppercase tracking-wider">Source Flow Rate</label>
                      <span className="text-xs text-zinc-300 font-mono">{irrigationFlowRate.toFixed(1)}/t</span>
                    </div>
                    <input type="range" min="0.1" max="5" step="0.1" value={irrigationFlowRate} onChange={e => setIrrigationFlowRate(Number(e.target.value))} className="w-full accent-blue-500 h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer" />
                  </div>
                  <div className="mt-3">
                    <div className="flex justify-between mb-1">
                      <label className="text-xs text-zinc-500 uppercase tracking-wider">Spray Spread Radius</label>
                      <span className="text-xs text-zinc-300 font-mono">{irrigationSpread.toFixed(1)}m</span>
                    </div>
                    <input type="range" min="0" max="5" step="0.1" value={irrigationSpread} onChange={e => setIrrigationSpread(Number(e.target.value))} className="w-full accent-blue-500 h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer" />
                  </div>
                </div>

                {/* Manual Drop Mode */}
                <div className="pt-3 border-t border-zinc-800">
                  <label className="block text-xs text-blue-400 mb-2 uppercase tracking-wider font-semibold">Water Drop Settings</label>
                  <div>
                    <div className="flex justify-between mb-1">
                      <label className="text-xs text-zinc-500 uppercase tracking-wider">Brush Radius</label>
                      <span className="text-xs text-zinc-300 font-mono">{brushSize}m</span>
                    </div>
                    <input type="range" min="1" max="50" value={brushSize} onChange={e => setBrushSize(Number(e.target.value))} className="w-full accent-blue-500 h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer" />
                  </div>
                  <div className="mt-3">
                    <div className="flex justify-between mb-1">
                      <label className="text-xs text-zinc-500 uppercase tracking-wider">Drops per Click</label>
                      <span className="text-xs text-zinc-300 font-mono">{waterDropCount}</span>
                    </div>
                    <input type="range" min="1" max="50" value={waterDropCount} onChange={e => setWaterDropCount(Number(e.target.value))} className="w-full accent-blue-500 h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer" />
                  </div>
                </div>

                {/* Physics & Accumulation Logic */}
                <div className="pt-3 border-t border-zinc-800">
                  <label className="block text-xs text-blue-400 mb-2 uppercase tracking-wider font-semibold">Physics & Pooling</label>
                  <div>
                    <div className="flex justify-between mb-1">
                      <label className="text-xs text-zinc-500 uppercase tracking-wider">Flow Speed</label>
                      <span className="text-xs text-zinc-300 font-mono">{waterSpeed.toFixed(1)}x</span>
                    </div>
                    <input type="range" min="0.1" max="3" step="0.1" value={waterSpeed} onChange={e => setWaterSpeed(Number(e.target.value))} className="w-full accent-blue-500 h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer" />
                  </div>
                  <div className="mt-3">
                    <div className="flex justify-between mb-1">
                      <label className="text-xs text-zinc-500 uppercase tracking-wider">Evaporation Time</label>
                      <span className="text-xs text-zinc-300 font-mono">{waterLife}</span>
                    </div>
                    <input type="range" min="50" max="1000" step="50" value={waterLife} onChange={e => setWaterLife(Number(e.target.value))} className="w-full accent-blue-500 h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer" />
                  </div>
                  <div className="mt-3">
                    <div className="flex justify-between mb-1">
                      <label className="text-xs text-zinc-500 uppercase tracking-wider">Pooling Sensitivity</label>
                      <span className="text-xs text-zinc-300 font-mono">{waterPooling}%</span>
                    </div>
                    <input type="range" min="0" max="100" value={waterPooling} onChange={e => setWaterPooling(Number(e.target.value))} className="w-full accent-blue-500 h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer" />
                  </div>
                </div>

              </div>
            </SidebarPanel>
          )}

          {['raise', 'lower', 'smooth', 'flatten'].includes(activeTool) && (
            <SidebarPanel title="Terrain Brush" icon={MountainSnow} defaultOpen={true}>
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between mb-1">
                    <label className="text-xs text-zinc-500 uppercase tracking-wider">Size</label>
                    <span className="text-xs text-zinc-300 font-mono">{brushSize}m</span>
                  </div>
                  <input type="range" min="1" max="50" value={brushSize} onChange={e => setBrushSize(Number(e.target.value))} className="w-full accent-emerald-500 h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer" />
                </div>
                <div>
                  <div className="flex justify-between mb-1">
                    <label className="text-xs text-zinc-500 uppercase tracking-wider">Strength</label>
                    <span className="text-xs text-zinc-300 font-mono">{brushStrength}%</span>
                  </div>
                  <input type="range" min="1" max="100" value={brushStrength} onChange={e => setBrushStrength(Number(e.target.value))} className="w-full accent-emerald-500 h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer" />
                </div>
                {activeTool === 'flatten' && (
                  <div className="pt-2 border-t border-zinc-800">
                    <div className="flex justify-between mb-1">
                      <label className="text-xs text-emerald-500 font-medium uppercase tracking-wider">Target Height</label>
                      <span className="text-xs text-emerald-400 font-mono">{flattenHeight}m</span>
                    </div>
                    <input type="range" min="-25" max="25" step="0.5" value={flattenHeight} onChange={e => setFlattenHeight(Number(e.target.value))} className="w-full accent-emerald-500 h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer" />
                  </div>
                )}
              </div>
            </SidebarPanel>
          )}

          {['berm', 'swale'].includes(activeTool) && (
            <SidebarPanel title={`${activeTool === 'berm' ? 'Berm' : 'Swale'} Tool`} icon={activeTool === 'berm' ? Mountain : Waves} defaultOpen={true}>
              <div className="space-y-4">
                {activeTool === 'swale' && (
                  <>
                    <div>
                      <div className="flex justify-between mb-1">
                        <label className="text-xs text-zinc-500 uppercase tracking-wider">Swale Width</label>
                        <span className="text-xs text-zinc-300 font-mono">{swaleWidth.toFixed(1)}m</span>
                      </div>
                      <input type="range" min="0.5" max="10" step="0.5" value={swaleWidth} onChange={e => setSwaleWidth(Number(e.target.value))} className="w-full accent-emerald-500 h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer" />
                    </div>
                    <div>
                      <div className="flex justify-between mb-1">
                        <label className="text-xs text-zinc-500 uppercase tracking-wider">Swale Depth</label>
                        <span className="text-xs text-zinc-300 font-mono">{swaleDepth.toFixed(1)}m</span>
                      </div>
                      <input type="range" min="0.1" max="5" step="0.1" value={swaleDepth} onChange={e => setSwaleDepth(Number(e.target.value))} className="w-full accent-emerald-500 h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer" />
                    </div>
                    <div className="pt-2 flex items-center gap-2 border-b border-zinc-800 pb-4">
                      <input type="checkbox" id="swaleBerm" checked={hasSwaleBerm} onChange={e => setHasSwaleBerm(e.target.checked)} className="rounded bg-zinc-900 border-zinc-700 text-emerald-500" />
                      <label htmlFor="swaleBerm" className="text-sm text-zinc-300 cursor-pointer">Add Adjacent Berm</label>
                    </div>
                  </>
                )}
                
                {(activeTool === 'berm' || (activeTool === 'swale' && hasSwaleBerm)) && (
                  <>
                    <div>
                      <div className="flex justify-between mb-1">
                        <label className="text-xs text-zinc-500 uppercase tracking-wider">Berm Width</label>
                        <span className="text-xs text-zinc-300 font-mono">{bermWidth.toFixed(1)}m</span>
                      </div>
                      <input type="range" min="0.5" max="10" step="0.5" value={bermWidth} onChange={e => setBermWidth(Number(e.target.value))} className="w-full accent-emerald-500 h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer" />
                    </div>
                    <div>
                      <div className="flex justify-between mb-1">
                        <label className="text-xs text-zinc-500 uppercase tracking-wider">Berm Height</label>
                        <span className="text-xs text-zinc-300 font-mono">{bermHeight.toFixed(1)}m</span>
                      </div>
                      <input type="range" min="0.1" max="5" step="0.1" value={bermHeight} onChange={e => setBermHeight(Number(e.target.value))} className="w-full accent-emerald-500 h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer" />
                    </div>
                  </>
                )}
              </div>
            </SidebarPanel>
          )}

          <SidebarPanel title="Project Setup" icon={Settings} defaultOpen={false}>
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-zinc-500 mb-1 uppercase tracking-wider">Site Name</label>
                <input type="text" defaultValue="New Homestead" className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-emerald-500"/>
              </div>
              
              <div className="pt-4 mt-2 border-t border-zinc-800">
                <div className="flex items-center gap-2 mb-3 text-zinc-300">
                  <ImageIcon size={14} className="text-emerald-500"/>
                  <span className="text-sm font-medium">Base Map / Aerial</span>
                </div>
                <input type="file" accept="image/png, image/jpeg" onChange={(e) => {
                    const file = e.target.files[0];
                    if (file) setImageUrl(URL.createObjectURL(file));
                  }} className="block w-full text-xs text-zinc-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-medium file:bg-zinc-800 file:text-emerald-400 hover:file:bg-zinc-700 transition-colors cursor-pointer mb-2"/>
                
                <div className="space-y-3 mt-4">
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <label className="block text-xs text-zinc-500 mb-1 uppercase tracking-wider">Width (m)</label>
                      <input type="number" value={planeWidth} onChange={e => setPlaneWidth(Number(e.target.value))} className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-emerald-500" />
                    </div>
                    <div className="flex-1">
                      <label className="block text-xs text-zinc-500 mb-1 uppercase tracking-wider">Height (m)</label>
                      <input type="number" value={planeHeight} onChange={e => setPlaneHeight(Number(e.target.value))} className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-emerald-500" />
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between mb-1">
                      <label className="text-xs text-zinc-500 uppercase tracking-wider">Image Opacity</label>
                      <span className="text-xs text-zinc-300 font-mono">{Math.round(imageOpacity * 100)}%</span>
                    </div>
                    <input type="range" min="0" max="1" step="0.05" value={imageOpacity} onChange={e => setImageOpacity(Number(e.target.value))} className="w-full accent-emerald-500 h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer" />
                  </div>
                </div>
              </div>
            </div>
          </SidebarPanel>

          <SidebarPanel title="Terrain Settings" icon={Grid} defaultOpen={false}>
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-zinc-500 mb-1 uppercase tracking-wider">Resolution</label>
                <select value={terrainRes} onChange={e => handleResChange(e.target.value)} className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-emerald-500">
                  <option value="low">Low (64x64 segments)</option>
                  <option value="medium">Medium (128x128 segments)</option>
                  <option value="high">High (256x256 segments)</option>
                </select>
              </div>
              <div>
                <div className="flex justify-between mb-1">
                  <label className="text-xs text-zinc-500 uppercase tracking-wider">Vertical Exaggeration</label>
                  <span className="text-xs text-zinc-300 font-mono">{verticalExaggeration.toFixed(1)}x</span>
                </div>
                <input type="range" min="0.1" max="5.0" step="0.1" value={verticalExaggeration} onChange={e => setVerticalExaggeration(Number(e.target.value))} className="w-full accent-emerald-500 h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer" />
              </div>
              <button onClick={() => pushToHistory({ heights: getInitialState(terrainRes).heights, objects: currentState.objects })} className="mt-2 w-full py-2 border border-zinc-700 rounded-md text-xs text-zinc-300 hover:text-white hover:bg-zinc-800 hover:border-zinc-500 transition-colors">
                Reset Terrain Heights
              </button>
            </div>
          </SidebarPanel>

          <SidebarPanel title="Layers" icon={Layers} defaultOpen={false}>
            <div className="space-y-2">
              {['Trees & Shrubs', 'Garden Beds', 'Water Systems', 'Earthworks', 'Base Terrain'].map((layer, i) => (
                <div key={layer} className="flex items-center gap-3 py-1 group cursor-pointer">
                  <input type="checkbox" defaultChecked className="w-4 h-4 rounded bg-zinc-900 border-zinc-700 text-emerald-500 focus:ring-emerald-500/20" />
                  <span className={`flex-1 text-sm ${i === 4 ? 'text-zinc-300 font-medium' : 'text-zinc-400 group-hover:text-zinc-300'}`}>{layer}</span>
                  <div className="w-2 h-2 rounded-full bg-emerald-500/50 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                </div>
              ))}
            </div>
            
            <div className="pt-4 mt-4 border-t border-zinc-800">
              <button 
                onClick={() => {
                  if (window.confirm("Are you sure you want to delete all placed objects? This cannot be easily undone.")) {
                    pushToHistory({ heights: currentState.heights, objects: [] });
                    setSelectedObjectId(null);
                  }
                }}
                className="w-full flex items-center justify-center gap-2 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 rounded text-xs transition-colors"
              >
                <Trash2 size={14}/> Clear All Objects
              </button>
            </div>
          </SidebarPanel>

        </aside>
      </div>
    </div>
  );
}