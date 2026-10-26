import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Undo2, Redo2, Save, Search, Loader2, CalendarDays, Play, Pause, Hourglass, Sprout, Sparkles, BookOpen, Droplets, ClipboardCheck,
  Map as MapIcon, SlidersHorizontal, Activity, MapPin, ListChecks, Layers, Compass, Wind, Check, ChevronRight,
} from 'lucide-react';
import Toolbar, { ALL_TOOLS } from './components/Toolbar';
import Permie from './components/Permie';
import { PlantLibrary, YearCalendar, WaterBudget, DesignReview } from './components/Workspaces';
import { effectiveZone, buildGuild, buildHedge, keylinePattern, sunSectors, applyActions, terrainBrief, centroid, reviewDesign, guildedShare, FixId, SECTOR_STYLE, bearing } from './lib/permaculture';
import { designSummary } from './lib/summary';
import { SPECIES, LAYER_NAMES, zoneFit } from './lib/plants';
import { advise } from './lib/advisor';
import type { AiAction, AiTurn } from './lib/types';
import { Ring, Segmented } from './components/ui';
import Viewport3D, { Tool, ViewportHandle, OverlayLine, WaterSettings, PLACE_TOOLS } from './components/Viewport3D';
import StartDialog from './components/StartDialog';
import Report from './components/Report';
import ZoneGuide, { WildPlants } from './components/ZoneGuide';
import { Modal, Btn, inputCls } from './components/ui';
import {
  ToolPanel, ObjectPanel, FeaturePanel, SitePanel, AnalysisPanel, LayersPanel, TasksPanel, SummaryPanel, SunBadge,
  ToolOpts, DEFAULT_TOOL_OPTS, typeName,
} from './components/Panels';
import { Menu } from './components/ui';
import { LIBRARY_BY_ID } from './lib/library';
import { buildSiteClimate, microclimate, ZoneConditions, Advice, jobsBetween } from './lib/advisor';
import type { Species } from './lib/library';
import type { DesignState, Feature, Project, Settings, SiteObject, LayerId, ObjectType } from './lib/types';
import { DEFAULT_SETTINGS, LAYER_OF } from './lib/types';
import {
  Grid, heightAt, slopeAspectAt, compassName, contourThrough, applyEarthwork, digPond, terrainStats, slopeGrid,
  pointInPolygon, polygonArea, distanceToPolyline, gradientAt, compassName as compass,
} from './lib/terrain';
import { composeMap, Analysis, ZONE_COLORS, ZONE_NAMES, TEX } from './lib/mapTexture';
import { SPECIES_BY_ID } from './lib/plants';
import { sunPosition, siteInstant } from './lib/sun';
import { ModelContext, footprint, shadeHeight } from './lib/models';
import { Task } from './lib/summary';
import { b64ToF32, f32ToB64, uid, today, loadProject, saveProject, listProjects, fetchImagery, fetchClimate, fetchSoil, slugId } from './lib/api';
import { fmtLen, fmtWater } from './lib/units';

const TOOLS = ALL_TOOLS;

const TOOL_HINTS: Partial<Record<Tool, string>> = {
  select: 'Click to select. Drag an element to move it. Drag the land to orbit, right-drag to pan, scroll to zoom.',
  measure: 'Click two points to measure distance, rise and grade.',
  raise: 'Drag to raise the ground.', lower: 'Drag to dig the ground down.', smooth: 'Drag to soften the ground.',
  flatten: 'Drag to level the ground. Shift-click to copy a height.',
  contour: 'Hover to see the level line, click to dig a swale along it.',
  swale: 'Drag to dig a swale. The berm goes on the downhill side.', berm: 'Drag to build a berm.',
  pond: 'Click to dig a pond.', zone: 'Click corners, double-click or Enter to close.', path: 'Drag to draw a path.',
  plant: 'Click to plant the chosen species.', water: 'Click and drag to pour water. Watch where it runs and pools.',
  guild: 'Click to plant a tree with its whole guild of helpers.', hedge: 'Drag a line across the wind to plant a hedgerow.',
  fence: 'Drag along the fence line.', keyline: 'Click the keypoint in a valley to lay out a keyline pattern.',
  sector: 'Drag from the home toward where the energy comes from.', paddock: 'Click corners of the paddock, double-click or Enter to close.',
};

type Workspace = 'plants' | 'calendar' | 'water' | 'review';
type InspTab = 'inspect' | 'analyze' | 'site' | 'tasks' | 'layers';
const ACTION_COLOR: Record<string, string> = { plant: '#8acf52', guild: '#a7de75', hedge: '#6db636', zone: '#f5b94a', swale: '#38bdf8', pond: '#5cc8f0', structure: '#f6e7c8', garden: '#c7eca3', path: '#d4a95c', paddock: '#e2c48a', fence: '#a8a29e' };
const circle = (x: number, y: number, r: number): [number, number][] => Array.from({ length: 21 }, (_, i) => [x + Math.cos((i / 20) * Math.PI * 2) * r, y + Math.sin((i / 20) * Math.PI * 2) * r]);

const DEFAULT_WATER: WaterSettings = { dropCount: 8, speed: 1, life: 300, pooling: 50, paused: false, rain: false, rainIntensity: 3, irrigationRate: 0.5, irrigationSpread: 1, clearToken: 0 };

interface History { stack: DesignState[]; step: number; key?: string; at?: number }

const COMPASS16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const fmtDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function download(name: string, blob: Blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export default function App() {
  const [project, setProject] = useState<Project | null>(null);
  const [original, setOriginal] = useState<Float32Array | null>(null);
  const [hist, setHist] = useState<History>({ stack: [], step: 0 });
  const [settings, setSettingsState] = useState<Settings>(DEFAULT_SETTINGS);
  const [satellite, setSatellite] = useState<HTMLCanvasElement | null>(null);
  const [tool, setToolState] = useState<Tool>('select');
  const [opts, setOptsState] = useState<ToolOpts>(DEFAULT_TOOL_OPTS);
  const [water, setWaterState] = useState<WaterSettings>(DEFAULT_WATER);
  const [sel, setSel] = useState<{ kind: 'object' | 'feature'; id: string } | null>(null);
  const [day, setDay] = useState(today());
  const [hour, setHour] = useState(13);
  const [yearsAhead, setYearsAhead] = useState(0);
  const [playing, setPlaying] = useState<'day' | 'years' | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [measure, setMeasure] = useState<[number, number][]>([]);
  const [zoneDraft, setZoneDraft] = useState<[number, number][]>([]);
  const [analysis, setAnalysis] = useState<Analysis>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [mapVersion, setMapVersion] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error' | 'idle'>('idle');
  const [start, setStart] = useState<{ open: boolean; query?: string }>({ open: true });
  const [report, setReport] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [headerQuery, setHeaderQuery] = useState('');
  const [loading, setLoading] = useState<string | null>(null);
  const [guide, setGuide] = useState<string | null>(null); // zone feature id
  const [zoneCond, setZoneCond] = useState<Record<string, ZoneConditions & { key: string }>>({});
  const [measuring, setMeasuring] = useState(false);
  const [wild, setWild] = useState<WildPlants | 'loading' | 'error' | null>(null);
  const [climateEdit, setClimateEdit] = useState(false);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [permie, setPermie] = useState(false);
  const [aiPreview, setAiPreview] = useState<AiAction[] | null>(null);
  const [aiAvailable, setAiAvailable] = useState<boolean | null>(null);
  const [wind, setWind] = useState<any>(null);
  const [tab, setTab] = useState<InspTab>('inspect');
  useEffect(() => { fetch('/api/ai/status').then((r) => r.json()).then((j) => setAiAvailable(!!j.available)).catch(() => setAiAvailable(false)); }, []);

  const viewport = useRef<ViewportHandle>(null);
  // sized up front: three.js allocates fixed texture storage on first upload, so a canvas
  // that grows later would leave the terrain black
  const mapCanvas = useMemo(() => { const c = document.createElement('canvas'); c.width = c.height = TEX; return c; }, []);
  const importInput = useRef<HTMLInputElement>(null);

  const design = hist.stack[hist.step];
  const site = project?.site;

  const say = useCallback((m: string) => { setToast(m); window.clearTimeout((say as any).t); (say as any).t = window.setTimeout(() => setToast(null), 3200); }, []);
  const setSettings = (p: Partial<Settings>) => { setSettingsState((s) => ({ ...s, ...p })); setDirty(true); };
  const setOpts = (p: Partial<ToolOpts>) => setOptsState((s) => ({ ...s, ...p }));
  const setWater = (p: Partial<WaterSettings>) => setWaterState((s) => ({ ...s, ...p }));
  const setTool = (t: Tool) => { setToolState(t); setMeasure([]); setZoneDraft([]); if (t !== 'select') setSel(null); setTab('inspect'); setWorkspace(null); };

  const grid: Grid | null = useMemo(() => (design && site ? { heights: design.heights, n: site.n, size: site.size } : null), [design?.heights, site?.n, site?.size]);
  const stats = useMemo(() => (grid ? terrainStats(grid, original) : null), [grid, original]);

  const viewDate = useMemo(() => {
    const d = new Date(day + 'T12:00:00');
    d.setTime(d.getTime() + yearsAhead * 365.25 * 86400000);
    return d;
  }, [day, yearsAhead]);
  const viewDay = fmtDay(viewDate);
  const modelCtx: ModelContext = useMemo(() => ({ viewDate, lat: site?.lat ?? null }), [viewDate.getTime(), site?.lat]);
  const lat = site?.lat ?? 40, lon = site?.lon ?? 0;
  const sun = useMemo(() => sunPosition(siteInstant(viewDay, hour, lon), lat, lon), [viewDay, hour, lat, lon]);

  // ---------------------------------------------------------------- history
  const commit = useCallback((patch: Partial<DesignState>, key?: string) => {
    setHist((h) => {
      const cur = h.stack[h.step];
      const next = { ...cur, ...patch };
      const now = Date.now();
      if (key && h.key === key && now - (h.at || 0) < 1200) {
        const stack = h.stack.slice(0, h.step + 1);
        stack[stack.length - 1] = next;
        return { stack, step: h.step, key, at: now };
      }
      const stack = [...h.stack.slice(0, h.step + 1), next];
      while (stack.length > 40) stack.shift();
      return { stack, step: stack.length - 1, key, at: now };
    });
    setDirty(true);
  }, []);
  const undo = () => { setHist((h) => ({ ...h, step: Math.max(0, h.step - 1), key: undefined })); setDirty(true); };
  const redo = () => { setHist((h) => ({ ...h, step: Math.min(h.stack.length - 1, h.step + 1), key: undefined })); setDirty(true); };

  // ---------------------------------------------------------------- project open, create, save
  const openProject = useCallback(async (p: Project, sat?: HTMLCanvasElement | null) => {
    const heights = b64ToF32(p.heights);
    setProject(p);
    setOriginal(b64ToF32(p.originalHeights));
    setHist({ stack: [{ heights, objects: p.objects || [], features: p.features || [] }], step: 0 });
    setSettingsState({ ...DEFAULT_SETTINGS, ...p.settings, layers: { ...DEFAULT_SETTINGS.layers, ...(p.settings?.layers || {}) } });
    setSel(null); setToolState('select'); setMeasure([]); setZoneDraft([]); setAnalysis({}); setDirty(false); setSaveState('saved');
    setWaterState((w) => ({ ...w, rain: false, clearToken: w.clearToken + 1 }));
    setStart({ open: false });
    setSatellite(sat ?? null);
    if (sat === undefined && p.site.lat != null) {
      setLoading('Loading the satellite photo');
      try { setSatellite(await fetchImagery(p.site.lat, p.site.lon!, p.site.size)); } catch { say('Satellite photo unavailable right now. The terrain is still real.'); }
      setLoading(null);
    }
  }, [say]);

  const openById = async (id: string) => {
    setLoading('Opening project');
    try { await openProject(await loadProject(id)); } catch (e: any) { say(`Could not open: ${e.message}`); setLoading(null); }
  };

  const buildProjectJson = useCallback((withThumb: boolean): Project | null => {
    if (!project || !design) return null;
    let thumb = project.thumb ?? null;
    if (withThumb) { try { thumb = viewport.current?.screenshot(360, 'image/jpeg') || thumb; } catch { /* keep the old one */ } }
    return { ...project, settings, heights: f32ToB64(design.heights), objects: design.objects, features: design.features, thumb };
  }, [project, design, settings]);

  const save = useCallback(async (manual = false) => {
    const p = buildProjectJson(true);
    if (!p) return;
    setSaveState('saving');
    try {
      const r = await saveProject(p);
      setProject((cur) => (cur && cur.id === p.id ? { ...cur, updated: r.updated, thumb: p.thumb } : cur));
      setDirty(false); setSaveState('saved');
      if (manual) say('Saved');
    } catch (e: any) { setSaveState('error'); say(`Save failed: ${e.message}`); }
  }, [buildProjectJson, say]);

  // autosave a few seconds after the last change
  useEffect(() => {
    if (!dirty || !project) return;
    const t = window.setTimeout(() => save(false), 3500);
    return () => window.clearTimeout(t);
  }, [dirty, hist, settings, project?.name, save]);

  // first launch: open the most recent project if there is one, behind the start screen
  useEffect(() => {
    listProjects().then((ps) => { if (ps[0]) openById(ps[0].id).then(() => setStart({ open: false })); }).catch(() => {});
  }, []);

  const onCreated = async (p: Project, sat: HTMLCanvasElement | null) => {
    await openProject(p, sat);
    try { await saveProject(p); } catch (e: any) { say(`Could not save the new project: ${e.message}`); }
    if (p.site.lat != null) say('Your land is loaded with its real slope. Start with the Analysis overlays to read it.');
  };

  // ---------------------------------------------------------------- map texture
  useEffect(() => {
    if (!grid) return;
    const t = window.setTimeout(() => {
      let a = analysis;
      if (settings.overlay === 'slope' || settings.overlay === 'aspect') { const s = slopeGrid(grid); a = { ...a, slope: s.slope, aspect: s.aspect }; }
      composeMap(mapCanvas, grid, satellite, settings, a, design.features, sel?.kind === 'feature' ? sel.id : null);
      setMapVersion((v) => v + 1);
    }, 20);
    return () => window.clearTimeout(t);
  }, [grid, satellite, settings, analysis, design?.features, sel]);

  // ---------------------------------------------------------------- analysis worker
  const worker = useMemo(() => new Worker(new URL('./lib/analysis.worker.ts', import.meta.url), { type: 'module' }), []);
  const jobId = useRef(0);
  const runWorker = useCallback((kind: 'sun' | 'flow', job: any) => new Promise<any>((resolve, reject) => {
    const id = ++jobId.current;
    const on = (e: MessageEvent) => {
      if (e.data.id !== id) return;
      worker.removeEventListener('message', on);
      if (e.data.ok) resolve(e.data); else reject(new Error(e.data.error));
    };
    worker.addEventListener('message', on);
    worker.postMessage({ id, kind, job });
  }), [worker]);

  useEffect(() => {
    if (!grid || settings.overlay !== 'flow') return;
    const t = window.setTimeout(async () => {
      setBusy('working out water flow');
      try {
        const r = await runWorker('flow', { heights: new Float32Array(grid.heights), n: grid.n, size: grid.size });
        setAnalysis((a) => ({ ...a, flow: r.flow }));
      } catch (e: any) { say(`Flow analysis failed: ${e.message}`); }
      setBusy(null);
    }, 250);
    return () => window.clearTimeout(t);
  }, [grid, settings.overlay]);

  const [sunInfo, setSunInfo] = useState('');
  useEffect(() => {
    if (!grid || settings.overlay !== 'sun') return;
    const t = window.setTimeout(async () => {
      setBusy('tracing the sun');
      try {
        const w = grid.n + 1, cs = grid.size / grid.n;
        const obstacles = new Float32Array(w * w);
        for (const o of design.objects) {
          const hgt = shadeHeight(o, modelCtx);
          if (hgt <= 0) continue;
          const r = o.type === 'building' ? Math.sqrt(((o.width ?? 6) * (o.depth ?? 8)) / Math.PI) * o.scale : footprint(o, modelCtx);
          const c0 = Math.round((o.x + grid.size / 2) / cs), r0 = Math.round((grid.size / 2 - o.y) / cs), rc = Math.ceil(r / cs);
          for (let rr = Math.max(0, r0 - rc); rr <= Math.min(grid.n, r0 + rc); rr++) for (let cc = Math.max(0, c0 - rc); cc <= Math.min(grid.n, c0 + rc); cc++) {
            if (Math.hypot((cc - c0) * cs, (rr - r0) * cs) <= r) obstacles[rr * w + cc] = Math.max(obstacles[rr * w + cc], hgt);
          }
        }
        const r = await runWorker('sun', { heights: new Float32Array(grid.heights), obstacles, n: grid.n, size: grid.size, lat, lon, day: viewDay });
        setAnalysis((a) => ({ ...a, sun: r.hours, sunMax: r.max }));
        setSunInfo(`Direct sun on ${viewDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}: up to ${r.max} hours where nothing shades it.`);
      } catch (e: any) { say(`Sun study failed: ${e.message}`); }
      setBusy(null);
    }, 500);
    return () => window.clearTimeout(t);
  }, [grid, settings.overlay, design?.objects, viewDay]);

  // ---------------------------------------------------------------- timeline playback
  useEffect(() => {
    if (!playing) return;
    const t = window.setInterval(() => {
      if (playing === 'day') setHour((h) => (h >= 20 ? 5 : +(h + 0.1).toFixed(2)));
      else setYearsAhead((y) => { if (y >= 30) { setPlaying(null); return 30; } return +(y + 0.1).toFixed(2); });
    }, 60);
    return () => window.clearInterval(t);
  }, [playing]);

  // ---------------------------------------------------------------- design actions
  const objects = design?.objects || [];
  const features = design?.features || [];
  const selObject = sel?.kind === 'object' ? objects.find((o) => o.id === sel.id) : undefined;
  const selFeature = sel?.kind === 'feature' ? features.find((f) => f.id === sel.id) : undefined;

  const updateObject = (id: string, p: Partial<SiteObject>) => commit({ objects: objects.map((o) => (o.id === id ? { ...o, ...p } : o)) }, `obj:${id}:${Object.keys(p).join(',')}`);
  const updateFeature = (id: string, p: Partial<Feature>) => commit({ features: features.map((f) => (f.id === id ? { ...f, ...p } : f)) }, `feat:${id}:${Object.keys(p).join(',')}`);
  const deleteSelection = () => {
    if (!sel) return;
    if (sel.kind === 'object') commit({ objects: objects.filter((o) => o.id !== sel.id) });
    else commit({ features: features.filter((f) => f.id !== sel.id) });
    setSel(null);
  };

  const countOf = (type: ObjectType) => objects.filter((o) => o.type === type).length + 1;

  const placeObject = (type: ObjectType, x: number, y: number) => {
    if (!grid) return;
    const base: SiteObject = {
      id: uid(), type, name: `${typeName(type)} ${countOf(type)}`, x, y, rotation: 0, scale: 1, planted: viewDay,
      events: [{ id: uid(), date: viewDay, type: type === 'plant' ? 'planted' : 'built' }],
    };
    let patch: Partial<DesignState> = {};
    if (type === 'plant') {
      const sp = SPECIES_BY_ID[opts.species];
      base.species = sp.id;
      base.name = `${sp.name} ${objects.filter((o) => o.species === sp.id).length + 1}`;
    } else if (type === 'building') Object.assign(base, { width: opts.buildingW, depth: opts.buildingD, height: opts.buildingH, name: countOf('building') === 1 ? 'House' : `Building ${countOf('building')}` });
    else if (type === 'greenhouse') Object.assign(base, { width: Math.min(opts.buildingW, 10), depth: opts.buildingD });
    else if (type === 'garden') Object.assign(base, { width: opts.gardenW, depth: opts.gardenD });
    else if (type === 'tank') Object.assign(base, { capacityL: opts.tankL });
    else if (type === 'irrigation') base.isFlowing = true;
    else if (type === 'pond') {
      const dug = digPond(grid, x, y, opts.pondR, opts.pondDepth);
      Object.assign(base, { radius: opts.pondR, depth: opts.pondDepth, waterLevel: dug.level });
      patch.heights = dug.heights;
    }
    commit({ ...patch, objects: [...objects, base] });
    setSel({ kind: 'object', id: base.id });
  };

  const earthworkOpts = () => ({ bermWidth: opts.bermWidth, bermHeight: opts.bermHeight, swaleWidth: opts.swaleWidth, swaleDepth: opts.swaleDepth, withBerm: opts.withBerm });

  const addEarthwork = (kind: 'swale' | 'berm', pts: [number, number][], name: string) => {
    if (!grid) return;
    const r = applyEarthwork(grid, pts, kind, earthworkOpts());
    if (!r) { say('Nothing changed there.'); return; }
    const f: Feature = { id: uid(), kind, name, points: pts, width: kind === 'swale' ? opts.swaleWidth : opts.bermWidth, depth: opts.swaleDepth, height: opts.bermHeight };
    commit({ heights: r.heights, features: [...features, f] });
  };

  const siteZone = effectiveZone(site);
  const plantsFrom = (list: { species: { id: string; name: string }; x: number; y: number; role?: string }[], note: string, base: SiteObject[]) => {
    const half = (site?.size ?? 100) / 2 - 0.3;
    const out: SiteObject[] = [];
    for (const m of list) {
      if (Math.abs(m.x) > half || Math.abs(m.y) > half) continue;
      const n = base.filter((o) => o.species === m.species.id).length + out.filter((o) => o.species === m.species.id).length + 1;
      out.push({ id: uid(), type: 'plant', species: m.species.id, name: `${m.species.name} ${n}`, x: m.x, y: m.y, rotation: 0, scale: 1, planted: viewDay, events: [{ id: uid(), date: viewDay, type: 'planted', text: m.role && m.role !== 'Centre' ? `${m.role} (${note})` : note }] });
    }
    return out;
  };

  const onStroke = (pts: [number, number][]) => {
    if (tool === 'hedge') {
      const h = buildHedge(pts, siteZone, opts.hedgeTall || undefined, opts.hedgeLow || undefined);
      const added = plantsFrom(h.plants.slice(0, 300), 'hedgerow', objects);
      if (!added.length) { say('Draw a longer line for the hedgerow.'); return; }
      commit({ objects: [...objects, ...added] });
      say(`Hedgerow planted: ${added.length} plants${h.tall ? `, ${h.tall.name}` : ''}${h.low ? ` with ${h.low.name}` : ''}.`);
      return;
    }
    if (tool === 'fence') {
      const f: Feature = { id: uid(), kind: 'fence', name: `Fence ${features.filter((x) => x.kind === 'fence').length + 1}`, points: pts };
      commit({ features: [...features, f] }); setSel({ kind: 'feature', id: f.id });
      return;
    }
    if (tool === 'sector') {
      const a = pts[0], b = pts[pts.length - 1];
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < (site?.size ?? 100) / 30) { say('Drag further out to set the direction.'); return; }
      const f: Feature = { id: uid(), kind: 'sector', sector: opts.sectorType, spread: opts.sectorSpread, name: SECTOR_STYLE[opts.sectorType].label, points: [a, b] };
      commit({ features: [...features, f] }); setSel({ kind: 'feature', id: f.id });
      return;
    }
    if (tool === 'path') {
      const f: Feature = { id: uid(), kind: 'path', name: `Path ${features.filter((x) => x.kind === 'path').length + 1}`, points: pts, width: opts.pathWidth };
      commit({ features: [...features, f] });
    } else if (tool === 'berm' || tool === 'swale') {
      addEarthwork(tool, pts, `${tool === 'berm' ? 'Berm' : 'Swale'} ${features.filter((x) => x.kind === tool).length + 1}`);
    }
  };

  const finishZone = (pts: [number, number][]) => {
    const clean = pts.filter((p, i) => i === 0 || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > (site?.size ?? 100) / 400);
    if (clean.length < 3) { say(`A ${tool === 'paddock' ? 'paddock' : 'zone'} needs at least three corners.`); return; }
    if (tool === 'paddock') {
      const f: Feature = { id: uid(), kind: 'paddock', name: `Paddock ${features.filter((x) => x.kind === 'paddock').length + 1}`, animal: opts.paddockAnimal, head: opts.paddockHead, points: clean };
      commit({ features: [...features, f] }); setZoneDraft([]); setSel({ kind: 'feature', id: f.id });
      return;
    }
    const f: Feature = { id: uid(), kind: 'zone', name: ZONE_NAMES[opts.zoneNumber], zone: opts.zoneNumber, points: clean };
    commit({ features: [...features, f] });
    setZoneDraft([]);
    setSel({ kind: 'feature', id: f.id });
    if (site?.lat != null) setGuide(f.id);
  };

  // ---------------------------------------------------------------- the zone plant guide
  const siteClimate = useMemo(() => (site?.lat != null && site.climate ? buildSiteClimate(site.climate, site.lat, site.overrides) : null), [site?.climate, site?.lat, site?.overrides]);

  // projects made before the advisor existed carry the old climate summary: upgrade it quietly
  useEffect(() => {
    if (!site || site.lat == null || site.climate?.version === 2) return;
    fetchClimate(site.lat, site.lon!).then((c) => { setProject((p) => (p ? { ...p, site: { ...p.site, climate: c } } : p)); setDirty(true); }).catch(() => {});
  }, [project?.id, site?.climate?.version]);

  const guideZone = guide ? features.find((f) => f.id === guide && f.kind === 'zone') : undefined;

  /** The ground inside a zone: slope, aspect, elevation, then sun and drainage from the worker. */
  useEffect(() => {
    if (!guideZone || !grid || !site) return;
    const key = `${guideZone.points.flat().map((v) => v.toFixed(2)).join(',')}|${hist.step}|${grid.n}`;
    if (zoneCond[guideZone.id]?.key === key) return;
    const w = grid.n + 1, cs = grid.size / grid.n;
    const inside: number[] = [];
    let gx = 0, gy = 0, slopeSum = 0, eMin = Infinity, eMax = -Infinity, eSum = 0;
    for (let r = 0; r < w; r++) for (let c = 0; c < w; c++) {
      const x = c * cs - grid.size / 2, y = grid.size / 2 - r * cs;
      if (!pointInPolygon(x, y, guideZone.points)) continue;
      const i = r * w + c;
      inside.push(i);
      const [ax, ay] = gradientAt(grid, r, c);
      gx += ax; gy += ay; slopeSum += 100 * Math.hypot(ax, ay);
      const h = grid.heights[i]; eMin = Math.min(eMin, h); eMax = Math.max(eMax, h); eSum += h;
    }
    if (!inside.length) {
      // a zone smaller than one terrain cell: sample its middle
      const cx = guideZone.points.reduce((t, p) => t + p[0], 0) / guideZone.points.length, cy = guideZone.points.reduce((t, p) => t + p[1], 0) / guideZone.points.length;
      const c = Math.round((cx + grid.size / 2) / cs), r = Math.round((grid.size / 2 - cy) / cs);
      inside.push(Math.max(0, Math.min(w - 1, r)) * w + Math.max(0, Math.min(w - 1, c)));
      eMin = eMax = eSum = grid.heights[inside[0]];
    }
    const nIn = inside.length;
    const meanSlope = slopeSum / nIn || 0;
    const aspect = meanSlope < 2 ? null : (Math.atan2(-gx, -gy) * 180 / Math.PI + 360) % 360;
    let sMin = Infinity, sMax = -Infinity;
    for (const h of grid.heights) { if (h < sMin) sMin = h; if (h > sMax) sMax = h; }
    const relief = sMax - sMin, meanElev = eSum / nIn;
    const lowSpot = relief > 5 && meanSlope < 5 && meanElev < sMin + 0.15 * relief;
    const base = { area: polygonArea(guideZone.points), meanSlope, aspect, aspectName: compass(aspect), sunHours: null as number | null, wetFraction: 0, lowSpot, elevMin: site.base + eMin, elevMax: site.base + eMax };
    const lat0 = site.lat ?? 40;
    setZoneCond((z) => ({ ...z, [guideZone.id]: { ...microclimate(base, lat0, site.soil), key } }));
    // sun through the growing season (solstice and equinox) and the drainage lines
    let cancelled = false;
    setMeasuring(true);
    (async () => {
      try {
        const obstacles = new Float32Array(w * w);
        for (const o of design.objects) {
          const hgt = shadeHeight(o, modelCtx);
          if (hgt <= 0) continue;
          const rad = o.type === 'building' ? Math.sqrt(((o.width ?? 6) * (o.depth ?? 8)) / Math.PI) * o.scale : footprint(o, modelCtx);
          const c0 = Math.round((o.x + grid.size / 2) / cs), r0 = Math.round((grid.size / 2 - o.y) / cs), rc = Math.ceil(rad / cs);
          for (let rr = Math.max(0, r0 - rc); rr <= Math.min(grid.n, r0 + rc); rr++) for (let cc = Math.max(0, c0 - rc); cc <= Math.min(grid.n, c0 + rc); cc++) {
            if (Math.hypot((cc - c0) * cs, (rr - r0) * cs) <= rad) obstacles[rr * w + cc] = Math.max(obstacles[rr * w + cc], hgt);
          }
        }
        const year = new Date().getFullYear();
        const days = (site.lat ?? 40) >= 0 ? [`${year}-06-21`, `${year}-09-21`] : [`${year}-12-21`, `${year}-03-21`];
        const suns = await Promise.all(days.map((day) => runWorker('sun', { heights: new Float32Array(grid.heights), obstacles: new Float32Array(obstacles), n: grid.n, size: grid.size, lat: site.lat ?? 40, lon: site.lon ?? 0, day })));
        const flow = analysis.flow && analysis.flow.length === w * w ? { flow: analysis.flow } : await runWorker('flow', { heights: new Float32Array(grid.heights), n: grid.n, size: grid.size });
        if (cancelled) return;
        let sun = 0, wet = 0;
        const thresh = Math.max(40, (w * w) * 0.003);
        for (const i of inside) { sun += (suns[0].hours[i] + suns[1].hours[i]) / 2; if (flow.flow[i] >= thresh) wet++; }
        const full = { ...base, sunHours: sun / nIn, wetFraction: wet / nIn };
        setZoneCond((z) => ({ ...z, [guideZone.id]: { ...microclimate(full, lat0, site.soil), key } }));
      } catch (e: any) { say(`Could not measure the zone: ${e.message}`); }
      if (!cancelled) setMeasuring(false);
    })();
    return () => { cancelled = true; };
  }, [guideZone?.id, guideZone?.points, hist.step, grid]);

  // wild plants recorded nearby, for zones 4 and 5
  useEffect(() => {
    if (!guideZone || (guideZone.zone ?? 1) < 4 || !site || site.lat == null || (wild && wild !== 'error')) return;
    setWild('loading');
    fetch(`/api/wildplants?lat=${site.lat}&lon=${site.lon}`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))).then(setWild).catch(() => setWild('error'));
  }, [guideZone?.id, guideZone?.zone, site?.lat]);
  useEffect(() => { setWild(null); }, [project?.id]);

  /** Next planting day on or after the timeline date, as YYYY-MM-DD. */
  const nextPlantingDate = (a: Advice) => {
    const kinds = a.species.life === 'annual' ? ['sow', 'transplant'] : ['plant'];
    const lines = a.calendar.filter((l) => kinds.includes(l.kind));
    const start = Math.floor((Date.UTC(2023, viewDate.getMonth(), viewDate.getDate()) - Date.UTC(2023, 0, 1)) / 86400000) + 1;
    for (let k = 0; k < 366; k++) {
      const d = ((start - 1 + k) % 365) + 1;
      if (jobsBetween(lines, d, d).length) {
        const out = new Date(viewDate); out.setDate(out.getDate() + k);
        return fmtDay(out);
      }
    }
    return viewDay;
  };

  const placeFromGuide = (sp: Species, mode: 'one' | 'fill' | 'bed', a: Advice) => {
    if (!guideZone || !grid) return;
    const poly = guideZone.points;
    const when = nextPlantingDate(a);
    if (mode === 'one') {
      setOpts({ species: sp.id });
      setGuide(null);
      setTool('plant');
      say(`Click inside the zone to plant ${sp.name}. Best planted from ${when}.`);
      return;
    }
    const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const clear = (x: number, y: number, r: number) => objects.every((o) => Math.hypot(o.x - x, o.y - y) >= r);
    if (mode === 'bed') {
      const bw = 1.2, bd = Math.min(6, Math.max(2, Math.sqrt(polygonArea(poly)) / 3));
      const cx = xs.reduce((t, v) => t + v, 0) / xs.length, cy = ys.reduce((t, v) => t + v, 0) / ys.length;
      let spot: [number, number] | null = null;
      for (let ring = 0; ring < 40 && !spot; ring++) for (let k = 0; k < Math.max(1, ring * 6) && !spot; k++) {
        const ang = (k / Math.max(1, ring * 6)) * Math.PI * 2, x = cx + Math.cos(ang) * ring * 1.5, y = cy + Math.sin(ang) * ring * 1.5;
        if (pointInPolygon(x, y, poly) && pointInPolygon(x, y + bd / 2, poly) && pointInPolygon(x, y - bd / 2, poly) && clear(x, y, 1.6)) spot = [x, y];
      }
      if (!spot) { say('No free room for another bed in this zone.'); return; }
      const bed: SiteObject = {
        id: uid(), type: 'garden', name: `${sp.name} bed`, crop: sp.id, x: spot[0], y: spot[1], rotation: 0, scale: 1,
        width: bw, depth: bd, planted: when, events: [{ id: uid(), date: viewDay, type: 'note', text: `Planned: ${sp.name}, ${a.calendar.filter((l) => l.kind !== 'harvest' && l.kind !== 'note').map((l) => l.label.toLowerCase()).join(' then ')}` }],
      };
      commit({ objects: [...objects, bed] });
      say(`Added a ${sp.name} bed. Its jobs show up in Tasks when each date comes round.`);
      return;
    }
    // fill: a staggered grid at the plant's own spacing, skipping anything already there
    const sm = sp.spacingM ?? Math.max(0.5, sp.spreadM * 0.9);
    const added: SiteObject[] = [];
    let row = 0;
    for (let y = y0 + sm / 2; y <= y1; y += sm * 0.866, row++) {
      for (let x = x0 + sm / 2 + (row % 2 ? sm / 2 : 0); x <= x1; x += sm) {
        if (added.length >= 200) break;
        if (!pointInPolygon(x, y, poly) || !clear(x, y, sm * 0.7) || added.some((o) => Math.hypot(o.x - x, o.y - y) < sm * 0.7)) continue;
        added.push({ id: uid(), type: 'plant', species: sp.id, name: `${sp.name} ${objects.filter((o) => o.species === sp.id).length + added.length + 1}`, x, y, rotation: 0, scale: 1, planted: when, events: [{ id: uid(), date: when, type: 'planted', text: 'planned from the zone guide' }] });
      }
    }
    if (!added.length) { say(`No free room for ${sp.name} at ${sm} m spacing in this zone.`); return; }
    commit({ objects: [...objects, ...added] });
    say(`Planned ${added.length} ${sp.name}${added.length > 1 ? ' plants' : ''} at ${sm} m apart, to plant from ${when}.${added.length >= 200 ? ' Stopped at 200.' : ''}`);
  };

  const onGroundClick = (x: number, y: number) => {
    if (!grid || !site) return;
    if (tool === 'select') {
      const tol = Math.max(0.8, site.size / 150);
      const lines = features.filter((f) => (f.kind === 'path' && settings.layers.paths) || ((f.kind === 'swale' || f.kind === 'berm') && settings.layers.earthworks));
      const lines2 = features.filter((f) => (f.kind === 'fence' && settings.layers.paths) || (f.kind === 'keyline' && settings.layers.earthworks) || (f.kind === 'sector' && settings.layers.sectors));
      const line = [...lines, ...lines2].find((f) => distanceToPolyline(x, y, f.points) <= Math.max(tol, (f.width ?? 1) / 2 + 0.3));
      if (line) { setSel({ kind: 'feature', id: line.id }); setTab('inspect'); return; }
      const zones = settings.layers.zones ? features.filter((f) => (f.kind === 'zone' || f.kind === 'paddock') && pointInPolygon(x, y, f.points)).sort((a, b) => polygonArea(a.points) - polygonArea(b.points)) : [];
      if (zones[0]) setTab('inspect');
      setSel(zones[0] ? { kind: 'feature', id: zones[0].id } : null);
      return;
    }
    if (tool === 'measure') { setMeasure((m) => (m.length >= 2 ? [[x, y]] : [...m, [x, y]])); return; }
    if (tool === 'guild') {
      const added = plantsFrom(buildGuild(opts.guildTree, x, y, siteZone), 'guild', objects);
      if (!added.length) return;
      commit({ objects: [...objects, ...added] });
      setSel({ kind: 'object', id: added[0].id });
      say(`${added[0].name} planted with ${added.length - 1} support plants around it.`);
      return;
    }
    if (tool === 'keyline') {
      const lines = keylinePattern(grid, x, y, opts.keylineSpacing, opts.keylineCount, opts.swaleLength);
      if (!lines.length) { say('No level line there. Click on sloping ground in a valley.'); return; }
      const group = uid();
      const added: Feature[] = lines.map((pts, i) => ({ id: uid(), kind: 'keyline', group, name: i === 0 ? 'Keyline' : `Keyline pattern ${i}`, points: pts }));
      commit({ features: [...features, ...added] });
      say(`Keyline and ${added.length - 1} parallel lines laid out ${fmtLen(opts.keylineSpacing, settings.units)} apart.`);
      return;
    }
    if (tool === 'zone' || tool === 'paddock') {
      if (zoneDraft.length >= 3 && Math.hypot(x - zoneDraft[0][0], y - zoneDraft[0][1]) < site.size / 50) { finishZone(zoneDraft); return; }
      setZoneDraft((z) => [...z, [x, y]]);
      return;
    }
    if (tool === 'contour') {
      const path = contourThrough(grid, x, y, opts.swaleLength);
      if (!path) { say('No level line there. Click on sloping ground.'); return; }
      addEarthwork('swale', path, `Swale on contour ${fmtLen(site.base + heightAt(grid, x, y), settings.units, 0)}`);
      return;
    }
    if (PLACE_TOOLS.includes(tool)) placeObject(tool as ObjectType, x, y);
  };

  const toggleTask = (t: Task) => {
    const o = objects.find((x) => x.id === t.objectId);
    if (!o) return;
    const events = t.done ? o.events.filter((e) => e.taskId !== t.id) : [{ id: uid(), date: viewDay, type: t.type, text: t.label, taskId: t.id }, ...o.events];
    commit({ objects: objects.map((x) => (x.id === o.id ? { ...x, events } : x)) });
  };

  // ---------------------------------------------------------------- overlay lines in the 3D view
  const contourPreview = useMemo(() => {
    if (!hover || !grid) return null;
    if (tool === 'contour') { const c = contourThrough(grid, hover.x, hover.y, opts.swaleLength); return c ? [c] : null; }
    if (tool === 'keyline') { const k = keylinePattern(grid, hover.x, hover.y, opts.keylineSpacing, opts.keylineCount, opts.swaleLength); return k.length ? k : null; }
    return null;
  }, [tool, hover, grid, opts.swaleLength, opts.keylineSpacing, opts.keylineCount]);
  const overlayLines = useMemo(() => {
    const l: OverlayLine[] = [];
    if (measure.length) l.push({ points: measure.length === 1 && hover ? [measure[0], [hover.x, hover.y]] : measure, color: '#fde047' });
    if (zoneDraft.length) l.push({ points: hover ? [...zoneDraft, [hover.x, hover.y]] : zoneDraft, color: tool === 'paddock' ? '#d4a95c' : ZONE_COLORS[opts.zoneNumber] });
    if (contourPreview) for (const c of contourPreview) l.push({ points: c, color: '#38bdf8' });
    if (aiPreview && grid) for (const a of aiPreview) {
      const col = ACTION_COLOR[a.kind] || '#fff';
      if (a.points && a.points.length >= 2) l.push({ points: a.points as [number, number][], color: col, closed: a.kind === 'zone' || a.kind === 'paddock' });
      else if (a.kind === 'swale' && a.x != null && a.y != null) { const c = contourThrough(grid, a.x, a.y, a.size ?? 40); l.push({ points: c || circle(a.x, a.y, 2), color: col }); }
      else if (a.x != null && a.y != null) l.push({ points: circle(a.x, a.y, a.kind === 'pond' ? (a.size ?? 5) : a.kind === 'guild' ? 3 : a.kind === 'structure' ? 2.5 : 1.2), color: col });
    }
    return l;
  }, [measure, zoneDraft, hover, contourPreview, opts.zoneNumber, aiPreview, grid, tool]);

  const measureResult = useMemo(() => {
    if (!grid || measure.length < 1) return null;
    const a = measure[0], b = measure.length > 1 ? measure[1] : hover ? [hover.x, hover.y] as [number, number] : null;
    if (!b) return null;
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const ha = heightAt(grid, a[0], a[1]), hb = heightAt(grid, b[0], b[1]);
    let ground = 0, prev = ha;
    for (let k = 1; k <= 60; k++) {
      const h = heightAt(grid, a[0] + ((b[0] - a[0]) * k) / 60, a[1] + ((b[1] - a[1]) * k) / 60);
      ground += Math.hypot(d / 60, h - prev); prev = h;
    }
    return { d, ground, dh: hb - ha, grade: d ? ((hb - ha) / d) * 100 : 0, final: measure.length > 1 };
  }, [measure, hover, grid]);

  // ---------------------------------------------------------------- keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName.toLowerCase();
      const typing = tag === 'input' || tag === 'textarea' || tag === 'select';
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(true); return; }
      if (typing) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
      if (e.key === 'Escape' && (workspace || permie)) { setWorkspace(null); setPermie(false); setAiPreview(null); return; }
      if (e.key === 'Escape') { setMeasure([]); setZoneDraft([]); setSel(null); return; }
      if (e.key === 'Enter' && (tool === 'zone' || tool === 'paddock') && zoneDraft.length >= 3) { finishZone(zoneDraft); return; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { e.preventDefault(); deleteSelection(); return; }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = TOOLS.find((x) => x.key === e.key.toLowerCase());
      if (t) setTool(t.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ---------------------------------------------------------------- exports
  const exportJson = () => { const p = buildProjectJson(false); if (p) download(`${p.id}.permascape.json`, new Blob([JSON.stringify(p)], { type: 'application/json' })); };
  const exportPng = () => { const d = viewport.current?.screenshot(); if (d) fetch(d).then((r) => r.blob()).then((b) => download(`${project?.id}.png`, b)); };
  const exportGlb = async () => {
    try { say('Building the 3D model file'); download(`${project?.id}.glb`, await viewport.current!.exportGLB()); } catch (e: any) { say(`Export failed: ${e.message}`); }
  };
  const exportCsv = () => {
    const rows = [['Name', 'Type', 'Species', 'Latin', 'Planted', 'Source', 'Cost', 'X (m east)', 'Y (m north)', 'Notes']];
    for (const o of objects) {
      const sp = SPECIES_BY_ID[o.species || ''];
      rows.push([o.name, typeName(o.type), sp?.name || '', sp?.latin || '', o.planted || '', o.source || '', String(o.cost ?? sp?.costUSD ?? ''), o.x.toFixed(1), o.y.toFixed(1), o.notes || '']);
    }
    download(`${project?.id}-elements.csv`, new Blob([rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')], { type: 'text/csv' }));
  };
  const importJson = async (file: File) => {
    try {
      const p = JSON.parse(await file.text()) as Project;
      if (!p.site || !p.heights || !p.originalHeights) throw new Error('not a Permascape project file');
      p.id = slugId(p.name || 'imported');
      p.version = 1;
      await saveProject(p);
      await openProject(p);
      say(`Imported "${p.name}"`);
    } catch (e: any) { say(`Import failed: ${e.message}`); }
  };
  const saveAsCopy = async () => {
    const p = buildProjectJson(true);
    if (!p) return;
    const copy = { ...p, id: slugId(p.name + ' copy'), name: p.name + ' (copy)', created: new Date().toISOString() };
    await saveProject(copy);
    setProject(copy); setDirty(false); setSaveState('saved');
    say(`Saved as "${copy.name}"`);
  };
  const refreshSiteData = async () => {
    if (!site || site.lat == null) return;
    setBusy('refreshing climate and soil');
    const [c, s] = await Promise.all([fetchClimate(site.lat, site.lon!).catch(() => site.climate), fetchSoil(site.lat, site.lon!).catch(() => site.soil)]);
    setProject((p) => (p ? { ...p, site: { ...p.site, climate: c ?? null, soil: s ?? null } } : p));
    setDirty(true); setBusy(null);
  };
  const openReport = () => { const img = viewport.current?.screenshot(1400, 'image/jpeg') || ''; setReport(img); };

  // ---------------------------------------------------------------- sectors from the sky and the measured wind
  useEffect(() => { setWind(null); if (site?.lat == null) return; fetch(`/api/wind?lat=${site.lat}&lon=${site.lon}`).then((r) => (r.ok ? r.json() : null)).then(setWind).catch(() => {}); }, [project?.id]);

  const autoSectors = () => {
    if (!site || site.lat == null || !grid) { say('Sun and wind sectors need a real address.'); return; }
    const house = objects.find((o) => o.type === 'building');
    const o: [number, number] = house ? [house.x, house.y] : [0, 0];
    const R = site.size * 0.42;
    const tip = (b: number, r = R): [number, number] => [o[0] + Math.sin((b * Math.PI) / 180) * r, o[1] + Math.cos((b * Math.PI) / 180) * r];
    const ss = sunSectors(site.lat, site.lon!);
    const sunSide = site.lat >= 0 ? 180 : 0;
    const out: Feature[] = [];
    for (const [key, d] of [['sun-summer', ss.summer], ['sun-winter', ss.winter]] as const) {
      if (d.rise == null || d.set == null) continue;
      const spread = site.lat >= 0 ? (d.set - d.rise + 360) % 360 : (d.rise - d.set + 360) % 360;
      out.push({ id: uid(), kind: 'sector', sector: key, group: 'auto', spread: Math.round(spread), name: `${SECTOR_STYLE[key].label}: rises ${Math.round(d.rise)}°, sets ${Math.round(d.set)}°, ${Math.round(d.noonAlt)}° at noon`, points: [o, tip(sunSide, key === 'sun-summer' ? R : R * 0.75)] });
    }
    if (wind?.days) {
      out.push({ id: uid(), kind: 'sector', sector: 'wind', group: 'auto', spread: 45, name: `Prevailing wind from ${COMPASS16[Math.round(wind.prevailingWarm / 22.5) % 16]}`, points: [o, tip(wind.prevailingWarm, R * 0.9)] });
      if (Math.abs(((wind.prevailingCold - wind.prevailingWarm + 540) % 360) - 180) > 30) out.push({ id: uid(), kind: 'sector', sector: 'cold-wind', group: 'auto', spread: 45, name: `Winter wind from ${COMPASS16[Math.round(wind.prevailingCold / 22.5) % 16]}`, points: [o, tip(wind.prevailingCold, R * 0.9)] });
    }
    commit({ features: [...features.filter((f) => !(f.kind === 'sector' && f.group === 'auto')), ...out] });
    setSettings({ layers: { ...settings.layers, sectors: true } });
    say(`Mapped ${out.length} sectors from ${house ? 'the house' : 'the centre'}: the real sun path${wind?.days ? ` and ${wind.days.toLocaleString()} days of measured wind` : ''}.`);
  };

  // ---------------------------------------------------------------- design review fixes
  const summaryNow = useMemo(() => (site ? designSummary(site, objects, features) : null), [site, objects, features]);
  const reviewInput = useMemo(() => (site && stats && summaryNow ? { site, objects, features, zone: siteZone, meanSlope: stats.meanSlope, cutM3: stats.cutM3, fillM3: stats.fillM3, roofCatchL: summaryNow.roofCatchL } : null), [site, objects, features, stats, summaryNow, siteZone]);
  const reviewScore = useMemo(() => (reviewInput ? reviewDesign(reviewInput).overall : 0), [reviewInput]);

  const nearHouse = (dx: number, dy: number): [number, number] => {
    const h = objects.find((o) => o.type === 'building');
    const half = (site?.size ?? 100) / 2 - 1;
    const x = (h ? h.x + ((h.width ?? 8) / 2) * h.scale : 0) + dx, y = (h ? h.y : 0) + dy;
    return [Math.max(-half, Math.min(half, x)), Math.max(-half, Math.min(half, y))];
  };
  const addSupportToTrees = (roles: string[] | null) => {
    const plants = objects.filter((o) => o.type === 'plant');
    const trees = plants.filter((p) => { const sp = LIBRARY_BY_ID[p.species || '']; return sp && ['canopy', 'subcanopy'].includes(sp.layer) && ['fruit-tree', 'nut-tree'].includes(sp.category); });
    let added: SiteObject[] = [];
    for (const t of trees) {
      const sp = LIBRARY_BY_ID[t.species!];
      const r = Math.max(1.5, sp.spreadM / 2 + 0.5);
      if (!roles && plants.filter((p) => p !== t && Math.hypot(p.x - t.x, p.y - t.y) <= r).length >= 2) continue;
      const members = buildGuild(sp.id, t.x, t.y, siteZone).filter((m) => m.role !== 'Centre' && (!roles || roles.includes(m.role)));
      added = [...added, ...plantsFrom(members, 'added by the design review', [...objects, ...added])];
    }
    if (!added.length) { say(trees.length ? 'Every tree already has its helpers.' : 'Plant a fruit or nut tree first, or use the guild tool.'); if (!trees.length) setTool('guild'); return; }
    commit({ objects: [...objects, ...added] });
    say(`Added ${added.length} support plants around ${trees.length} tree${trees.length > 1 ? 's' : ''}. Undo takes them back.`);
  };
  const onFix = (f: FixId) => {
    const place = (type: ObjectType, extra: Partial<SiteObject>, dx: number, dy: number) => {
      const [x, y] = nearHouse(dx, dy);
      const o: SiteObject = { id: uid(), type, name: `${typeName(type)} ${countOf(type)}`, x, y, rotation: 0, scale: 1, planted: viewDay, events: [{ id: uid(), date: viewDay, type: 'built' }], ...extra };
      commit({ objects: [...objects, o] }); setSel({ kind: 'object', id: o.id }); setWorkspace(null); setTab('inspect');
      say(`${o.name} placed${objects.some((x) => x.type === 'building') ? ' beside the house' : ''}. Drag it with Select to fine-tune.`);
    };
    switch (f) {
      case 'tank': return place('tank', { capacityL: 10000 }, 2.5, 0);
      case 'compost': return place('compost', {}, 6, -6);
      case 'guilds': return addSupportToTrees(null);
      case 'nfixers': return addSupportToTrees(['Nitrogen fixer']);
      case 'pollinators': return addSupportToTrees(['Pollinator and insect attractor']);
      case 'sectors': autoSectors(); setWorkspace(null); return;
      case 'zones': return setTool('zone');
      case 'swales': return setTool('contour');
      case 'windbreak': return setTool('hedge');
      case 'house': return setTool('building');
      case 'misfits': {
        const m = objects.find((o) => o.type === 'plant' && !zoneFit(LIBRARY_BY_ID[o.species || ''], siteZone).ok);
        if (m) { setWorkspace(null); setToolState('select'); setSel({ kind: 'object', id: m.id }); setTab('inspect'); }
        return;
      }
    }
  };

  // ---------------------------------------------------------------- Permie, the AI designer
  const buildAiContext = () => {
    if (!site || !grid || !stats) return {};
    const statusOf: Record<string, string> = {};
    if (siteClimate) for (const sp of SPECIES) { try { statusOf[sp.id] = advise(sp, siteClimate, null, sp.pz[0] ?? 2, site.soil).status; } catch { /* skip */ } }
    else for (const sp of SPECIES) statusOf[sp.id] = zoneFit(sp, siteZone).ok ? 'good' : 'no';
    const sc = siteClimate;
    return {
      site: {
        address: site.address, lat: site.lat, lon: site.lon, sizeM: site.size, areaM2: site.size * site.size,
        elevationM: [Math.round(site.base + stats.min), Math.round(site.base + stats.max)], reliefM: +stats.relief.toFixed(1), meanSlopePct: +stats.meanSlope.toFixed(1), steepestPct: Math.round(stats.steepest),
        hemisphere: (site.lat ?? 0) >= 0 ? 'north (sun from the south)' : 'south (sun from the north)',
      },
      climate: sc ? { zone: sc.zoneLabel, koppen: sc.koppen?.name, rainMmYear: Math.round(sc.annualPrecipMm), monthlyRainMm: site.climate?.monthlyPrecipMm.map(Math.round), frostFree: sc.frostFree, lastFrost: sc.lastMean, firstFrost: sc.firstMean, chillHours: sc.chill, hottestMaxC: Math.round(sc.hottestMaxC), humid: sc.humid, arid: sc.arid } : null,
      soil: site.soil?.available ? { unit: site.soil.mapUnit, texture: site.soil.topsoilTexture, drainage: site.soil.drainage, hydroGroup: site.soil.hydrologicGroup, pH: site.soil.pH, organicPct: site.soil.organicMatterPct } : 'unknown',
      wind: wind?.days ? { prevailingFromDeg: wind.prevailing, summerFromDeg: wind.prevailingWarm, winterFromDeg: wind.prevailingCold, strongestFromDeg: wind.strongest } : 'unknown',
      terrain: { note: 'Coarse grid, rows north to south, columns west to east. Each cell: height above the lowest point / slope % / which way it faces / wet = natural drainage line.', ...terrainBrief(grid, analysis.flow && analysis.flow.length === (grid.n + 1) ** 2 ? analysis.flow : null, 10) },
      existing: {
        objects: objects.slice(0, 160).map((o) => ({ type: o.type, name: o.name, species: o.species, x: Math.round(o.x), y: Math.round(o.y), ...(o.width ? { w: o.width, d: o.depth } : {}) })),
        features: features.slice(0, 80).map((f) => ({ kind: f.kind, name: f.name, zone: f.zone, centre: centroid(f.points).map(Math.round), points: f.points.length <= 8 ? f.points.map((p) => p.map(Math.round)) : undefined })),
        reviewScore,
      },
      plantIds: SPECIES.filter((sp) => statusOf[sp.id] !== 'no').map((sp) => `${sp.id}: ${sp.name}, ${LAYER_NAMES[sp.layer]}, ${sp.heightM}m, ${sp.functions.slice(0, 3).join('/')}, ${statusOf[sp.id]}`),
      today: viewDay,
    };
  };
  const onAiTurn = (t: AiTurn) => { setProject((p) => (p ? { ...p, ai: [...(p.ai || []), t].slice(-30) } : p)); setDirty(true); };
  const onAiApply = (turnId: string, idx: number[]) => {
    const t = project?.ai?.find((x) => x.id === turnId);
    if (!t || !grid || !design) return;
    const r = applyActions(design, grid, t.actions, idx, { zone: siteZone, day: viewDay, id: uid });
    commit(r.state);
    setProject((p) => (p ? { ...p, ai: (p.ai || []).map((x) => (x.id === turnId ? { ...x, applied: [...(x.applied || []), ...r.applied] } : x)) } : p));
    say(`Added ${r.applied.length} change${r.applied.length === 1 ? '' : 's'} from Permie.${r.notes.length ? ' ' + r.notes[0] : ''} One Undo takes them all back.`);
  };

  const usePlantFromLibrary = (id: string, how: 'plant' | 'guild' | 'hedge') => {
    if (how === 'plant') { setOpts({ species: id }); setTool('plant'); say(`Click the land to plant ${LIBRARY_BY_ID[id].name}.`); }
    else if (how === 'guild') { setOpts({ guildTree: id }); setTool('guild'); say(`Click the land to plant a ${LIBRARY_BY_ID[id].name} guild.`); }
    else { setOpts({ hedgeTall: id }); setTool('hedge'); say(`Drag a line to plant a ${LIBRARY_BY_ID[id].name} hedgerow.`); }
  };

  // ---------------------------------------------------------------- render
  const hoverInfo = useMemo(() => {
    if (!hover || !grid || !site) return null;
    const h = heightAt(grid, hover.x, hover.y);
    if (!Number.isFinite(h)) return null;
    const sa = slopeAspectAt(grid, hover.x, hover.y);
    return { elev: site.base + h, ...sa };
  }, [hover, grid, site]);

  const layerCounts = useMemo(() => {
    const c: Record<LayerId, number> = { plants: 0, structures: 0, gardens: 0, water: 0, paths: 0, zones: 0, earthworks: 0, sectors: 0 };
    for (const o of objects) c[LAYER_OF[o.type]]++;
    for (const f of features) c[f.kind === 'path' || f.kind === 'fence' ? 'paths' : f.kind === 'zone' || f.kind === 'paddock' ? 'zones' : f.kind === 'sector' ? 'sectors' : 'earthworks']++;
    return c;
  }, [objects, features]);

  const units = settings.units;

  // read-only snapshot for the end-to-end test
  (window as any).__ps = { project: project?.id, objects, features, step: hist.step, sel, tool, saveState, dirty, overlay: settings.overlay, analysis: { flow: !!analysis.flow, sun: !!analysis.sun }, busy };

  const NAV: { id: Workspace | null; label: string; icon: any }[] = [
    { id: null, label: 'Design', icon: MapIcon }, { id: 'plants', label: 'Plants', icon: BookOpen }, { id: 'calendar', label: 'Calendar', icon: CalendarDays },
    { id: 'water', label: 'Water', icon: Droplets }, { id: 'review', label: 'Review', icon: ClipboardCheck },
  ];
  const TABS: { id: InspTab; label: string; icon: any }[] = [
    { id: 'inspect', label: 'Inspect', icon: SlidersHorizontal }, { id: 'analyze', label: 'Analyze', icon: Activity }, { id: 'site', label: 'Site', icon: MapPin },
    { id: 'tasks', label: 'Tasks', icon: ListChecks }, { id: 'layers', label: 'Layers', icon: Layers },
  ];
  const monthCount = useMemo(() => 0, []);
  void monthCount;
  const steps = [
    { done: settings.overlay !== 'none' || !!analysis.flow || !!analysis.slope, label: 'Read the land', sub: 'Slope, water flow and sun overlays', go: () => setTab('analyze') },
    { done: features.some((f) => f.kind === 'sector'), label: 'Map the sectors', sub: 'Real sun path and measured wind', go: autoSectors },
    { done: objects.some((o) => o.type === 'building'), label: 'Place the home base', sub: 'Zones radiate out from here', go: () => setTool('building') },
    { done: features.some((f) => f.kind === 'swale' || f.kind === 'keyline') || objects.some((o) => o.type === 'pond' || o.type === 'tank'), label: 'Water first', sub: 'Swales on contour, ponds, tanks', go: () => setTool('contour') },
    { done: features.some((f) => f.kind === 'zone'), label: 'Draw your zones', sub: 'The plant guide opens for each', go: () => setTool('zone') },
    { done: objects.filter((o) => o.type === 'plant').length >= 3, label: 'Plant guilds', sub: 'A tree and all its helpers in one click', go: () => setTool('guild') },
  ];

  return (
    <div className="h-screen w-screen flex flex-col bg-zinc-950 text-zinc-100 font-sans overflow-hidden grain">
      <header className="h-[60px] min-h-[60px] border-b hairline flex items-center px-4 gap-3 z-20 no-print bg-zinc-950/80 backdrop-blur">
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-300 via-emerald-500 to-emerald-800 flex items-center justify-center shadow-glow"><Sprout size={19} className="text-emerald-950" strokeWidth={2.4} /></div>
          <div className="hidden xl:block leading-none">
            <div className="font-display text-[19px] tracking-tight text-zinc-50">Permascape</div>
            <div className="text-[9px] uppercase tracking-[0.22em] text-emerald-300/80 font-semibold mt-0.5">3D permaculture</div>
          </div>
        </div>
        {project && (
          <input value={project.name} onChange={(e) => { setProject({ ...project, name: e.target.value }); setDirty(true); }} title="Project name"
            className="bg-transparent border border-transparent hover:border-white/10 focus:border-emerald-400/60 rounded-lg px-2 py-1 text-sm text-zinc-100 font-medium w-44 focus:outline-none" />
        )}
        {project && (
          <nav className="flex items-center gap-0.5 p-1 rounded-xl bg-white/[0.04] border hairline">
            {NAV.map((n) => {
              const on = workspace === n.id;
              return (
                <button key={n.label} data-nav={n.label} onClick={() => { setWorkspace(n.id); setPermie(false); setAiPreview(null); }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium transition-all ${on ? 'bg-zinc-100 text-zinc-950 shadow' : 'text-zinc-300 hover:text-white hover:bg-white/[0.05]'}`}>
                  <n.icon size={14} /><span className="hidden lg:inline">{n.label}</span>
                  {n.id === 'review' && <span className={`ml-0.5 text-[10px] font-bold tabular-nums px-1.5 rounded-full ${on ? 'bg-zinc-950/10' : reviewScore >= 75 ? 'bg-emerald-400/20 text-emerald-200' : reviewScore >= 45 ? 'bg-amber-400/20 text-amber-200' : 'bg-red-400/20 text-red-200'}`}>{reviewScore}</span>}
                </button>
              );
            })}
          </nav>
        )}
        <form className="relative flex-1 max-w-xs ml-1" onSubmit={(e) => { e.preventDefault(); if (headerQuery.trim()) setStart({ open: true, query: headerQuery }); }}>
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input value={headerQuery} onChange={(e) => setHeaderQuery(e.target.value)} placeholder="Go to any address..." className="w-full bg-white/[0.04] border hairline rounded-xl pl-8 pr-3 py-2 text-[13px] text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-emerald-400/60" />
        </form>
        <div className="flex items-center gap-1 text-sm ml-auto">
          {project && (
            <button data-permie-open onClick={() => { setPermie(!permie); setWorkspace(null); }} className={`mr-1 flex items-center gap-2 pl-2.5 pr-3.5 py-2 rounded-xl text-[13px] font-semibold transition-all ${permie ? 'bg-emerald-300 text-emerald-950 shadow-glow' : 'bg-gradient-to-r from-emerald-400/20 to-sky-400/15 text-emerald-100 border border-emerald-300/30 hover:border-emerald-300/60'}`}>
              <Sparkles size={15} /> Ask Permie
            </button>
          )}
          <button onClick={undo} disabled={!design || hist.step === 0} title="Undo (Cmd+Z)" className="p-2 rounded-lg hover:bg-white/5 text-zinc-300 disabled:opacity-30"><Undo2 size={16} /></button>
          <button onClick={redo} disabled={!design || hist.step >= hist.stack.length - 1} title="Redo (Cmd+Shift+Z)" className="p-2 rounded-lg hover:bg-white/5 text-zinc-300 disabled:opacity-30"><Redo2 size={16} /></button>
          <Menu label="File" items={[
            { label: 'New site from an address', onClick: () => setStart({ open: true }) },
            { label: 'Open a project', onClick: () => setStart({ open: true }) },
            { divider: true, label: '' },
            { label: 'Save', hint: 'Cmd+S', onClick: () => save(true), disabled: !project },
            { label: 'Save as a copy', onClick: saveAsCopy, disabled: !project },
            { divider: true, label: '' },
            { label: 'Site report (print or PDF)', onClick: openReport, disabled: !project },
            { label: 'Export picture (.png)', onClick: exportPng, disabled: !project },
            { label: 'Export 3D model (.glb)', onClick: exportGlb, disabled: !project },
            { label: 'Export element list (.csv)', onClick: exportCsv, disabled: !project },
            { label: 'Export project file (.json)', onClick: exportJson, disabled: !project },
            { label: 'Import project file', onClick: () => importInput.current?.click() },
          ]} />
          <Menu label="View" items={[
            { label: 'Perspective', onClick: () => viewport.current?.setView('reset') },
            { label: 'Top down (plan view)', onClick: () => viewport.current?.setView('top') },
            { label: 'From the south', onClick: () => viewport.current?.setView('south') },
            { label: 'From the north', onClick: () => viewport.current?.setView('north') },
            { divider: true, label: '' },
            { label: 'Satellite photo', checked: settings.satellite, onClick: () => setSettings({ satellite: !settings.satellite }) },
            { label: 'Contour lines', checked: settings.contours, onClick: () => setSettings({ contours: !settings.contours }) },
            { label: 'Sectors', checked: settings.layers.sectors, onClick: () => setSettings({ layers: { ...settings.layers, sectors: !settings.layers.sectors } }) },
            { label: 'Measuring grid', checked: settings.grid, onClick: () => setSettings({ grid: !settings.grid }) },
            { label: 'Imperial units', checked: units === 'imperial', onClick: () => setSettings({ units: units === 'imperial' ? 'metric' : 'imperial' }) },
          ]} />
          <button onClick={() => save(true)} disabled={!project} className={`ml-1 px-3.5 py-2 rounded-xl text-[13px] font-semibold flex items-center gap-1.5 disabled:opacity-40 transition-all ${dirty || saveState === 'saving' ? 'bg-zinc-100 text-zinc-950 hover:bg-white' : 'bg-white/[0.05] text-zinc-300 border hairline'}`}>
            {saveState === 'saving' ? <Loader2 size={14} className="animate-spin" /> : dirty ? <Save size={14} /> : <Check size={14} className="text-emerald-400" />}
            {saveState === 'saving' ? 'Saving' : dirty ? 'Save' : 'Saved'}
          </button>
        </div>
        <input ref={importInput} type="file" accept=".json,application/json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) importJson(f); e.target.value = ''; }} />
      </header>

      <div className="flex-1 flex overflow-hidden">
        <main className="flex-1 relative overflow-hidden">
          {grid && design && (
            <Viewport3D
              ref={viewport}
              grid={grid} exaggeration={settings.exaggeration} mapCanvas={mapCanvas} mapVersion={mapVersion}
              objects={objects} modelCtx={modelCtx} selectedId={sel?.kind === 'object' ? sel.id : null} layers={settings.layers}
              tool={tool} brush={{ size: opts.brushSize, strength: opts.brushStrength, flattenHeight: opts.flattenHeight }}
              sun={sun} water={water} showGrid={settings.grid} overlayLines={overlayLines}
              onHeightsCommit={(h) => commit({ heights: h })}
              onSelectObject={(id) => { setSel({ kind: 'object', id }); setTab('inspect'); }}
              onGroundClick={onGroundClick}
              onGroundDoubleClick={() => { if ((tool === 'zone' || tool === 'paddock') && zoneDraft.length >= 3) finishZone(zoneDraft); }}
              onStroke={onStroke}
              onHover={setHover}
              onMoveObject={(id, x, y) => commit({ objects: objects.map((o) => (o.id === id ? { ...o, x, y } : o)) })}
              onFlattenPick={(h) => { setOpts({ flattenHeight: +h.toFixed(2) }); say(`Flatten height set to ${fmtLen(site!.base + h, units)}`); }}
            />
          )}
          {!project && !start.open && <div className="absolute inset-0 flex items-center justify-center text-zinc-500">No project open.</div>}
          {project && <Toolbar tool={tool} onTool={setTool} />}

          <div className="absolute top-3 left-[88px] space-y-2 pointer-events-none no-print max-w-sm">
            {project && (
              <div className="glass px-3.5 py-2 rounded-xl text-xs text-zinc-200 shadow-glass flex items-center gap-2" data-hint>
                {(() => { const t = TOOLS.find((x) => x.id === tool); return t ? <t.icon size={14} className="text-emerald-300 shrink-0" /> : null; })()}
                <span><b className="font-semibold text-zinc-50">{TOOLS.find((x) => x.id === tool)?.name}.</b> {TOOL_HINTS[tool] || `Click to place: ${typeName(tool)}`}</span>
              </div>
            )}
            {hoverInfo && (
              <div className="glass px-3 py-1.5 rounded-xl text-[11px] font-mono text-zinc-200 shadow-glass inline-block">
                Elev {fmtLen(hoverInfo.elev, units)} · Slope {hoverInfo.slope.toFixed(1)}% · Faces {compassName(hoverInfo.aspect)}
              </div>
            )}
            {measureResult && (
              <div className="bg-amber-950/80 backdrop-blur border border-amber-500/40 px-3.5 py-2.5 rounded-xl text-xs text-amber-50 shadow-glass">
                <div className="font-semibold">{fmtLen(measureResult.d, units)} across{measureResult.final ? '' : ' (click to set the end)'}</div>
                <div>{fmtLen(measureResult.ground, units)} along the ground</div>
                <div>{measureResult.dh >= 0 ? 'Rises' : 'Falls'} {fmtLen(Math.abs(measureResult.dh), units, 2)}, grade {Math.abs(measureResult.grade).toFixed(1)}%</div>
              </div>
            )}
            {zoneDraft.length > 0 && <div className="glass px-3 py-1.5 rounded-xl text-xs text-zinc-200 inline-block">{zoneDraft.length} corners. Double-click or Enter to finish.</div>}
            {aiPreview && <div className="glass px-3 py-1.5 rounded-xl text-xs text-emerald-100 inline-flex items-center gap-1.5"><Sparkles size={12} /> Previewing Permie's proposal. Nothing is added until you press Add.</div>}
          </div>
          {(loading || busy) && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 glass px-3.5 py-1.5 rounded-full text-xs text-emerald-200 flex items-center gap-2 no-print shadow-glass z-10"><Loader2 size={13} className="animate-spin" />{loading || busy}</div>
          )}
          {toast && <div className="absolute bottom-24 left-1/2 -translate-x-1/2 glass px-4 py-2.5 rounded-2xl text-[13px] text-zinc-50 shadow-glass no-print z-40 animate-rise max-w-xl text-center" data-toast>{toast}</div>}
          {site && (
            <div className="absolute bottom-1 right-3 text-[9.5px] text-white/50 pointer-events-none no-print">
              {site.lat != null ? 'Imagery © Esri, Maxar, Earthstar Geographics · Elevation USGS 3DEP / AWS Terrain Tiles · © OpenStreetMap' : 'Sandbox'}
            </div>
          )}

          {project && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 glass rounded-2xl shadow-glass flex items-center gap-4 px-4 py-2.5 text-xs text-zinc-300 no-print z-10 w-[min(860px,calc(100%-180px))]" data-timeline>
              <div className="flex items-center shrink-0" title="The day shown: sun, shadows, seasons and tasks">
                <input type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} className="bg-white/[0.05] rounded-lg px-2 py-1 border-0 text-zinc-100 text-xs focus:outline-none w-[124px]" />
              </div>
              <div className="flex items-center gap-2 flex-1 min-w-[140px]">
                <button onClick={() => setPlaying(playing === 'day' ? null : 'day')} title="Play the day" className="w-7 h-7 rounded-full bg-white/[0.06] hover:bg-amber-400/20 text-amber-300 flex items-center justify-center shrink-0">{playing === 'day' ? <Pause size={13} /> : <Play size={13} />}</button>
                <input type="range" min={4} max={21} step={0.1} value={hour} onChange={(e) => setHour(Number(e.target.value))} className="flex-1 accent-amber-500" title="Time of day" />
                <span className="font-mono text-zinc-100 w-10 tabular-nums">{String(Math.floor(hour)).padStart(2, '0')}:{String(Math.floor((hour % 1) * 60)).padStart(2, '0')}</span>
              </div>
              <span className="hidden xl:inline shrink-0"><SunBadge alt={sun.altitude} az={sun.azimuth} /></span>
              <div className="w-px h-6 bg-white/10" />
              <div className="flex items-center gap-2 flex-1 min-w-[160px]">
                <button onClick={() => { if (yearsAhead >= 30) setYearsAhead(0); setPlaying(playing === 'years' ? null : 'years'); }} title="Watch it grow" className="w-7 h-7 rounded-full bg-white/[0.06] hover:bg-emerald-400/20 text-emerald-300 flex items-center justify-center shrink-0">{playing === 'years' ? <Pause size={13} /> : <Hourglass size={13} />}</button>
                <input type="range" min={0} max={30} step={0.1} value={yearsAhead} onChange={(e) => setYearsAhead(Number(e.target.value))} className="flex-1 accent-emerald-500" title="Years of growth" />
                <span className="font-mono text-zinc-100 whitespace-nowrap w-[104px] text-right tabular-nums">{yearsAhead < 0.05 ? 'today' : `+${yearsAhead.toFixed(1)} yrs · ${viewDate.getFullYear()}`}</span>
              </div>
            </div>
          )}

          {workspace === 'plants' && site && <PlantLibrary sc={siteClimate} site={site} onClose={() => setWorkspace(null)} onUse={usePlantFromLibrary} />}
          {workspace === 'calendar' && <YearCalendar objects={objects} sc={siteClimate} lat={site?.lat ?? null} year={viewDate.getFullYear()} onClose={() => setWorkspace(null)} onSelect={(id) => { setWorkspace(null); setToolState('select'); setSel({ kind: 'object', id }); setTab('inspect'); }} />}
          {workspace === 'water' && site && <WaterBudget site={site} objects={objects} features={features} units={units} onClose={() => setWorkspace(null)} onAddTank={(l) => { const [x, y] = nearHouse(2.5, -3); const o: SiteObject = { id: uid(), type: 'tank', name: `Water tank ${countOf('tank')}`, x, y, rotation: 0, scale: 1, capacityL: l, planted: viewDay, events: [{ id: uid(), date: viewDay, type: 'built' }] }; commit({ objects: [...objects, o] }); say(`Added a ${fmtWater(l, units)} tank by the house.`); }} />}
          {workspace === 'review' && reviewInput && <DesignReview input={reviewInput} onClose={() => setWorkspace(null)} onFix={onFix} />}
          {permie && project && (
            <Permie available={aiAvailable} turns={project.ai || []} goals={project.goals || ['Food forest', 'Water first']} onGoals={(g) => { setProject((p) => (p ? { ...p, goals: g } : p)); setDirty(true); }}
              buildContext={buildAiContext} onTurn={onAiTurn} onApply={onAiApply} onPreview={setAiPreview} onClose={() => { setPermie(false); setAiPreview(null); }} />
          )}
        </main>

        <aside className="w-[348px] border-l hairline flex flex-col z-10 no-print bg-zinc-950/90">
          {project && (
            <div className="flex items-center gap-0.5 px-2.5 pt-2.5 pb-2 border-b hairline">
              {TABS.map((t) => (
                <button key={t.id} data-tab={t.id} onClick={() => setTab(t.id)} title={t.label}
                  className={`flex-1 flex flex-col items-center gap-1 py-1.5 rounded-xl text-[10.5px] font-semibold transition-all ${tab === t.id ? 'bg-white/[0.08] text-zinc-50' : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.03]'}`}>
                  <t.icon size={15} className={tab === t.id ? 'text-emerald-300' : ''} />{t.label}
                </button>
              ))}
            </div>
          )}
          <div className="flex-1 overflow-y-auto scroll-thin pb-6">
            {project && site && grid && stats && (
              <>
                {tab === 'inspect' && (
                  <>
                    {selObject && <ObjectPanel sc={siteClimate} o={selObject} onChange={(p) => updateObject(selObject.id, p)} onDelete={deleteSelection}
                      onDuplicate={() => { const c = { ...selObject, id: uid(), name: selObject.name + ' copy', x: selObject.x + 2, y: selObject.y - 2, events: [] }; commit({ objects: [...objects, c] }); setSel({ kind: 'object', id: c.id }); }}
                      site={site} units={units} ctx={modelCtx} viewDay={viewDay} />}
                    {selFeature && <FeaturePanel f={selFeature} onChange={(p) => updateFeature(selFeature.id, p)} onDelete={deleteSelection} units={units} onGuide={selFeature.kind === 'zone' ? () => setGuide(selFeature.id) : undefined} hasClimate={!!siteClimate} />}
                    <ToolPanel tool={tool} o={opts} set={setOpts} water={water} setWater={setWater} units={units} site={site} grid={grid} />
                    {!selObject && !selFeature && tool === 'select' && (
                      <>
                        <section className="mx-3 my-2.5 rounded-2xl border border-emerald-400/20 bg-gradient-to-b from-emerald-400/[0.07] to-transparent p-4" data-getting-started>
                          <div className="flex items-center gap-3 mb-3">
                            <Ring value={(steps.filter((x) => x.done).length / steps.length) * 100} size={44} stroke={4} label={`${steps.filter((x) => x.done).length}/${steps.length}`} />
                            <div>
                              <div className="font-display text-[17px] text-zinc-50 leading-tight">Design in six moves</div>
                              <div className="text-[11px] text-zinc-400">The order a permaculture designer works in</div>
                            </div>
                          </div>
                          <div className="space-y-1">
                            {steps.map((st, i) => (
                              <button key={i} onClick={st.go} className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-xl hover:bg-white/[0.05] text-left group">
                                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${st.done ? 'bg-emerald-400 text-emerald-950' : 'border border-white/20 text-zinc-400'}`}>{st.done ? <Check size={11} strokeWidth={3} /> : i + 1}</span>
                                <span className="flex-1 min-w-0">
                                  <span className={`block text-[13px] leading-tight ${st.done ? 'text-zinc-400' : 'text-zinc-100 font-medium'}`}>{st.label}</span>
                                  <span className="block text-[11px] text-zinc-500 truncate">{st.sub}</span>
                                </span>
                                <ChevronRight size={14} className="text-zinc-600 group-hover:text-zinc-300" />
                              </button>
                            ))}
                          </div>
                          <button onClick={() => setPermie(true)} className="mt-3 w-full flex items-center justify-center gap-2 py-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] text-[12px] font-semibold text-emerald-100"><Sparkles size={13} /> Or let Permie draw a first design</button>
                        </section>
                        <SummaryPanel site={site} objects={objects} features={features} stats={stats} units={units} onReport={openReport} />
                      </>
                    )}
                  </>
                )}
                {tab === 'analyze' && (
                  <AnalysisPanel s={settings} set={setSettings} busy={busy} sunInfo={sunInfo} units={units} extra={
                    <div className="pt-3 border-t border-white/[0.06] space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="text-[13px] text-zinc-100 font-medium flex items-center gap-2"><Compass size={14} className="text-emerald-300" /> Sectors</div>
                        <span className="text-[11px] text-zinc-500">{features.filter((f) => f.kind === 'sector').length} mapped</span>
                      </div>
                      <button onClick={autoSectors} disabled={site.lat == null} className="w-full py-2 rounded-xl bg-emerald-400/15 border border-emerald-400/30 text-emerald-100 text-[12px] font-semibold hover:bg-emerald-400/25 disabled:opacity-40 flex items-center justify-center gap-2"><Compass size={13} /> Map sun and wind sectors</button>
                      {wind?.days > 0 && <WindRose wind={wind} />}
                      <p className="text-[11px] text-zinc-500">Add fire, views, noise and wildlife by hand with the Sector tool in Plan.</p>
                    </div>
                  } />
                )}
                {tab === 'site' && <SitePanel site={site} units={units} stats={stats} onResurvey={site.lat != null ? refreshSiteData : undefined} sc={siteClimate} onEditClimate={site.lat != null ? () => setClimateEdit(true) : undefined} />}
                {tab === 'tasks' && <TasksPanel objects={objects} ctx={modelCtx} viewDay={viewDay} sc={siteClimate} onToggle={toggleTask} onSelect={(id) => { setToolState('select'); setSel({ kind: 'object', id }); setTab('inspect'); }} />}
                {tab === 'layers' && <LayersPanel s={settings} set={setSettings} counts={layerCounts} hasSatellite={!!satellite}
                  onClearAll={() => { commit({ objects: [], features: [] }); setSel(null); say('Cleared. The shaped ground stays, and Undo brings everything back.'); }} />}
              </>
            )}
          </div>
        </aside>
      </div>

      {start.open && <StartDialog key={start.query || 'start'} canClose={!!project} initialQuery={start.query} onClose={() => setStart({ open: false })} onOpenProject={openById} onCreated={onCreated} />}
      {guideZone && site && <ZoneGuide zone={guideZone} site={site} sc={siteClimate} zc={zoneCond[guideZone.id] ?? null} measuring={measuring} units={units} viewDate={viewDate} wild={wild}
        onZone={(z) => updateFeature(guideZone.id, { zone: z, name: ZONE_NAMES[z], color: undefined })} onPlace={placeFromGuide} onClose={() => setGuide(null)} onSiteSettings={() => setClimateEdit(true)} />}
      {climateEdit && site && <ClimateEdit site={site} onClose={() => setClimateEdit(false)} onSave={(o) => { setProject((p) => (p ? { ...p, site: { ...p.site, overrides: o } } : p)); setDirty(true); setClimateEdit(false); say('Your zone and frost dates now drive every planting date.'); }} />}
      {report !== null && project && site && stats && <Report sc={siteClimate} name={project.name} site={site} objects={objects} features={features} stats={stats} units={units} image={report} onClose={() => setReport(null)} />}
    </div>
  );
}

function WindRose({ wind }: { wind: any }) {
  const [season, setSeason] = useState<'all' | 'warm' | 'cold'>('all');
  const v: number[] = wind[season];
  const max = Math.max(...v, 0.01), S = 150, c = S / 2;
  return (
    <div className="rounded-xl bg-zinc-950/50 border hairline p-3">
      <div className="space-y-2 mb-1">
        <div className="text-[11px] text-zinc-300 font-medium flex items-center gap-1.5"><Wind size={12} className="text-sky-300" />Wind comes from</div>
        <div><Segmented value={season} onChange={setSeason} options={[{ id: 'all', label: 'Year' }, { id: 'warm', label: 'Summer' }, { id: 'cold', label: 'Winter' }]} /></div>
      </div>
      <svg viewBox={`0 0 ${S} ${S}`} className="w-full max-w-[170px] mx-auto block">
        {[0.33, 0.66, 1].map((r) => <circle key={r} cx={c} cy={c} r={(c - 14) * r} fill="none" stroke="rgba(255,255,255,0.07)" />)}
        {v.map((f, k) => {
          const a0 = ((k * 22.5 - 9 - 90) * Math.PI) / 180, a1 = ((k * 22.5 + 9 - 90) * Math.PI) / 180, r = (c - 14) * (f / max);
          return <path key={k} d={`M${c},${c} L${c + Math.cos(a0) * r},${c + Math.sin(a0) * r} A${r},${r} 0 0 1 ${c + Math.cos(a1) * r},${c + Math.sin(a1) * r} Z`} fill={k === v.indexOf(Math.max(...v)) ? '#5cc8f0' : 'rgba(92,200,240,0.45)'} />;
        })}
        {['N', 'E', 'S', 'W'].map((d, i) => <text key={d} x={c + Math.sin((i * Math.PI) / 2) * (c - 6)} y={c - Math.cos((i * Math.PI) / 2) * (c - 6) + 3.5} textAnchor="middle" fontSize="9" fill="#8c9c90" fontWeight="600">{d}</text>)}
      </svg>
      <div className="text-[10px] text-zinc-500 text-center">{wind.days.toLocaleString()} days, {wind.source.replace('Open-Meteo ERA5 reanalysis, ', '')}</div>
    </div>
  );
}

function ClimateEdit({ site, onClose, onSave }: { site: Project['site']; onClose: () => void; onSave: (o: NonNullable<Project['site']['overrides']>) => void }) {
  const o = site.overrides || {};
  const [zone, setZone] = useState(o.zone || '');
  const [last, setLast] = useState(o.lastFrost || '');
  const [first, setFirst] = useState(o.firstFrost || '');
  const zones = Array.from({ length: 13 }, (_, i) => [`${i + 1}a`, `${i + 1}b`]).flat();
  const toInput = (mmdd: string) => (mmdd ? `2023-${mmdd}` : '');
  const fromInput = (v: string) => (v ? v.slice(5) : '');
  const c = site.climate;
  return (
    <Modal title="Your local climate" onClose={onClose}>
      <div className="space-y-4 text-sm">
        <p className="text-zinc-400">The guide works from climate data in cells about 10 km across{c?.zoneOfficial ? ' and the official USDA zone for your ZIP code' : ''}. If you know better for your exact spot (a frost pocket, a warm wall, your own records or a local extension office), set it here and every planting date follows.</p>
        <div>
          <label className="block text-xs text-zinc-500 mb-1 uppercase tracking-wider">Hardiness zone</label>
          <select value={zone} onChange={(e) => setZone(e.target.value)} className={inputCls}>
            <option value="">Use {c?.zoneOfficial ? `the USDA map (${c.zoneOfficial.label})` : `the estimate (${c?.zone?.label ?? '?'})`}</option>
            {zones.map((z) => <option key={z} value={z}>{z}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-zinc-500 mb-1 uppercase tracking-wider">Average last spring frost</label>
            <input type="date" value={toInput(last)} onChange={(e) => setLast(fromInput(e.target.value))} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1 uppercase tracking-wider">Average first fall frost</label>
            <input type="date" value={toInput(first)} onChange={(e) => setFirst(fromInput(e.target.value))} className={inputCls} />
          </div>
        </div>
        <p className="text-xs text-zinc-500">Only the month and day are used. Leave a field empty to use the data.</p>
        <div className="flex gap-2 justify-end">
          <Btn onClick={() => onSave({})}>Clear mine, use the data</Btn>
          <Btn kind="primary" onClick={() => onSave({ ...(zone ? { zone } : {}), ...(last ? { lastFrost: last } : {}), ...(first ? { firstFrost: first } : {}) })}>Save</Btn>
        </div>
      </div>
    </Modal>
  );
}
