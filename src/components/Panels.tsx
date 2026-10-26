import React, { useMemo, useState } from 'react';
import {
  BoxSelect, Trash2, Copy, MountainSnow, Mountain, Waves, Droplets, CloudRain, Play, Pause, Eraser, TreePine, Home,
  MapPin, CloudSun, Layers, Activity, ListChecks, BarChart3, Route, Hexagon, Ruler, Sun, AlertTriangle, CheckCircle2, BookOpen, Plus, Sprout, Pencil,
} from 'lucide-react';
import type { Feature, SiteObject, Settings, Site, LayerId, JournalEvent, Overlay, SoilUnit } from '../lib/types';
import { SPECIES, SPECIES_BY_ID, LAYER_NAMES, zoneFit, Layer } from '../lib/plants';
import { SLOPE_CLASSES, COMPASS, polygonArea, polylineLength } from '../lib/terrain';
import { ZONE_COLORS, ZONE_NAMES } from '../lib/mapTexture';
import { fmtLen, fmtArea, fmtWater, fmtRain, fmtTemp, fmtVol, Units, localizeText, contourChoices, lenIn, lenOut } from '../lib/units';
import { designSummary, monthTasks, Task } from '../lib/summary';
import { ModelContext, plantSize } from '../lib/models';
import { uid } from '../lib/api';
import { advise, rangesText, SiteClimate, doyLabel } from '../lib/advisor';
import type { Tool, WaterSettings } from './Viewport3D';
import { SidebarPanel, Slider, Field, inputCls, Toggle, Btn, Stat, ConfirmBtn, Segmented } from './ui';
import { guildSpecies, hedgeSpecies, SECTOR_STYLE, ANIMALS, bearing, effectiveZone, FitFn } from '../lib/permaculture';
import { soilColor } from '../lib/mapTexture';
import type { WatchItem } from '../lib/season';
import { CloudLightning, Snowflake, Map as MapIcon2 } from 'lucide-react';
import { Compass, Fence, PawPrint, Rows3, Trees, TreeDeciduous } from 'lucide-react';
import type { Animal, SectorType } from '../lib/types';

export interface ToolOpts {
  brushSize: number; brushStrength: number; flattenHeight: number;
  bermWidth: number; bermHeight: number; swaleWidth: number; swaleDepth: number; withBerm: boolean; swaleLength: number;
  pathWidth: number; zoneNumber: number; species: string;
  guildTree: string; hedgeTall: string; hedgeLow: string; sectorType: SectorType; sectorSpread: number;
  keylineSpacing: number; keylineCount: number; paddockAnimal: Animal; paddockHead: number;
  buildingW: number; buildingD: number; buildingH: number; tankL: number; pondR: number; pondDepth: number; gardenW: number; gardenD: number;
}

export const DEFAULT_TOOL_OPTS: ToolOpts = {
  brushSize: 8, brushStrength: 40, flattenHeight: 0,
  bermWidth: 2, bermHeight: 0.6, swaleWidth: 1.2, swaleDepth: 0.5, withBerm: true, swaleLength: 40,
  pathWidth: 1.5, zoneNumber: 1, species: 'apple',
  guildTree: 'apple', hedgeTall: '', hedgeLow: '', sectorType: 'wind', sectorSpread: 50, keylineSpacing: 8, keylineCount: 4, paddockAnimal: 'chickens', paddockHead: 6,
  buildingW: 8, buildingD: 10, buildingH: 3, tankL: 10000, pondR: 6, pondDepth: 1.5, gardenW: 1.2, gardenD: 4,
};

const TYPE_NAMES: Record<string, string> = {
  guild: 'Tree guild', hedge: 'Hedgerow', fence: 'Fence', keyline: 'Keyline pattern', sector: 'Sector', paddock: 'Paddock', boundary: 'Property line',
  plant: 'Plant', building: 'Building', greenhouse: 'Greenhouse', tank: 'Water tank', pond: 'Pond', garden: 'Garden bed',
  compost: 'Compost bays', coop: 'Chicken coop', hive: 'Beehive', irrigation: 'Irrigation emitter',
};
export const typeName = (t: string) => TYPE_NAMES[t] || t;

const EVENT_TYPES: JournalEvent['type'][] = ['watered', 'pruned', 'fed', 'mulched', 'harvested', 'issue', 'treated', 'note', 'planted', 'built'];

// ------------------------------------------------------------------ tool options
export function ToolPanel({ tool, o, set, water, setWater, units, site, grid, fit, present = [], onImportBoundary }: {
  tool: Tool; o: ToolOpts; set: (p: Partial<ToolOpts>) => void; water: WaterSettings; setWater: (p: Partial<WaterSettings>) => void; units: Units; site: Site; grid: { size: number };
  fit?: FitFn; present?: string[]; onImportBoundary?: () => void;
}) {
  const L = (m: number) => fmtLen(m, units);
  const maxBrush = Math.max(20, Math.round(grid.size / 4));
  if (['raise', 'lower', 'smooth', 'flatten'].includes(tool)) return (
    <SidebarPanel title="Terrain brush" icon={MountainSnow}>
      <Slider label="Size" value={o.brushSize} min={1} max={maxBrush} onChange={(v) => set({ brushSize: v })} display={L(o.brushSize)} />
      <Slider label="Strength" value={o.brushStrength} min={1} max={100} onChange={(v) => set({ brushStrength: v })} display={`${o.brushStrength}%`} />
      {tool === 'flatten' && (
        <div className="pt-2 border-t border-zinc-800 space-y-2">
          <Slider label="Target height" value={o.flattenHeight} min={-10} max={Math.ceil(50)} step={0.1} onChange={(v) => set({ flattenHeight: v })}
            display={`${L(o.flattenHeight)} (${L(site.base + o.flattenHeight, )} elev.)`} />
          <p className="text-xs text-zinc-500">Shift-click the ground to copy its height. Flatten makes a level pad for a building, pond or terrace.</p>
        </div>
      )}
    </SidebarPanel>
  );
  if (tool === 'berm' || tool === 'swale' || tool === 'contour') return (
    <SidebarPanel title={tool === 'berm' ? 'Berm' : tool === 'contour' ? 'Swale on contour' : 'Swale (freehand)'} icon={tool === 'berm' ? Mountain : Waves}>
      {tool === 'contour' && (
        <>
          <p className="text-xs text-zinc-400">Hover to see the exact level line, then click. The swale follows the contour so water spreads and soaks in instead of running off.</p>
          <Slider label="Swale length" value={o.swaleLength} min={5} max={Math.max(60, Math.round(grid.size * 1.5))} onChange={(v) => set({ swaleLength: v })} display={L(o.swaleLength)} />
        </>
      )}
      {tool !== 'berm' && (
        <>
          <Slider label="Swale half-width" value={o.swaleWidth} min={0.3} max={6} step={0.1} onChange={(v) => set({ swaleWidth: v })} display={L(o.swaleWidth)} />
          <Slider label="Swale depth" value={o.swaleDepth} min={0.1} max={3} step={0.05} onChange={(v) => set({ swaleDepth: v })} display={L(o.swaleDepth, )} />
          <Toggle id="withBerm" label="Spoil berm on the downhill side" checked={o.withBerm} onChange={(v) => set({ withBerm: v })} />
        </>
      )}
      {(tool === 'berm' || o.withBerm) && (
        <>
          <Slider label="Berm width" value={o.bermWidth} min={0.5} max={8} step={0.1} onChange={(v) => set({ bermWidth: v })} display={L(o.bermWidth)} />
          <Slider label="Berm height" value={o.bermHeight} min={0.1} max={3} step={0.05} onChange={(v) => set({ bermHeight: v })} display={L(o.bermHeight)} />
        </>
      )}
      {tool !== 'contour' && <p className="text-xs text-zinc-500">Click and drag across the land to draw it.</p>}
    </SidebarPanel>
  );
  if (tool === 'path') return (
    <SidebarPanel title="Path" icon={Route}>
      <Slider label="Width" value={o.pathWidth} min={0.4} max={6} step={0.1} onChange={(v) => set({ pathWidth: v })} display={L(o.pathWidth)} />
      <p className="text-xs text-zinc-500">Click and drag to draw a path. It is painted onto the ground.</p>
    </SidebarPanel>
  );
  if (tool === 'boundary') return (
    <SidebarPanel title="Property line" icon={MapIcon2}>
      <p className="text-xs text-zinc-400">Click each corner of the property, then double-click or press Enter. Everything outside it is dimmed, the area is measured, and anything placed outside is flagged in the review.</p>
      {onImportBoundary && <Btn className="w-full" onClick={onImportBoundary}>Import it from a KML or GeoJSON file</Btn>}
      <p className="text-[11px] text-zinc-500">Most counties publish parcel lines on their GIS map. Download the parcel as KML or GeoJSON, or trace it from the satellite photo.</p>
    </SidebarPanel>
  );
  if (tool === 'zone') return (
    <SidebarPanel title="Permaculture zone" icon={Hexagon}>
      <Field label="Zone">
        <select value={o.zoneNumber} onChange={(e) => set({ zoneNumber: Number(e.target.value) })} className={inputCls}>
          {ZONE_NAMES.map((z, i) => <option key={i} value={i}>{z}</option>)}
        </select>
      </Field>
      <p className="text-xs text-zinc-500">Click to drop corners. Double-click, press Enter, or click the first corner to close it. Esc cancels.</p>
    </SidebarPanel>
  );
  if (tool === 'measure') return (
    <SidebarPanel title="Measure" icon={Ruler}><p className="text-xs text-zinc-400">Click two points. You get the distance along the ground, the rise or fall, and the grade between them.</p></SidebarPanel>
  );
  if (tool === 'plant') return <PlantPicker o={o} set={set} site={site} />;
  const zone = effectiveZone(site);
  if (tool === 'guild') {
    const centres = SPECIES.filter((sp) => ['fruit-tree', 'nut-tree'].includes(sp.category) && sp.life === 'perennial').sort((a, b) => a.name.localeCompare(b.name));
    const c = SPECIES_BY_ID[o.guildTree];
    const members = c ? guildSpecies(c, zone, fit) : [];
    return (
      <SidebarPanel title="Tree guild" icon={TreeDeciduous}>
        <Field label="Centre tree">
          <select value={o.guildTree} onChange={(e) => set({ guildTree: e.target.value })} className={inputCls}>
            {centres.map((sp) => <option key={sp.id} value={sp.id}>{sp.name}{zoneFit(sp, zone).ok ? '' : ' (outside your zone)'}</option>)}
          </select>
        </Field>
        <div className="space-y-1.5">
          {members.map((m) => (
            <div key={m.role} className="flex items-center gap-2 text-xs">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: m.species.leaf }} />
              <span className="text-zinc-200 flex-1">{m.species.name} <span className="text-zinc-500">x{m.count}</span></span>
              <span className="text-zinc-500">{m.role}</span>
            </div>
          ))}
          {!members.length && <div className="text-xs text-zinc-500">No support plants fit this climate.</div>}
        </div>
        <p className="text-xs text-zinc-500">Click the land: the tree goes in with its nitrogen fixers, nutrient miners, insect plants, pest confusers and living mulch around the drip line, all suited to your zone.</p>
      </SidebarPanel>
    );
  }
  if (tool === 'hedge') {
    const auto = hedgeSpecies(zone, fit, present);
    const tallOpts = SPECIES.filter((sp) => sp.life === 'perennial' && sp.heightM >= 4).sort((a, b) => a.name.localeCompare(b.name));
    const lowOpts = SPECIES.filter((sp) => sp.life === 'perennial' && sp.layer === 'shrub').sort((a, b) => a.name.localeCompare(b.name));
    return (
      <SidebarPanel title="Hedgerow and windbreak" icon={Trees}>
        <Field label="Tall row">
          <select value={o.hedgeTall} onChange={(e) => set({ hedgeTall: e.target.value })} className={inputCls}>
            <option value="">Best for my site ({auto.tall?.name ?? 'none'})</option>
            {tallOpts.map((sp) => <option key={sp.id} value={sp.id}>{sp.name}</option>)}
          </select>
        </Field>
        <Field label="Shrub row">
          <select value={o.hedgeLow} onChange={(e) => set({ hedgeLow: e.target.value })} className={inputCls}>
            <option value="">Best for my site ({auto.low?.name ?? 'none'})</option>
            {lowOpts.map((sp) => <option key={sp.id} value={sp.id}>{sp.name}</option>)}
          </select>
        </Field>
        <p className="text-xs text-zinc-500">Drag a line across the wind. A windbreak shelters about ten times its height downwind; put it on the side your wind sector comes from. The best-for-my-site picks suit your climate and soil, never spread, and never host a disease of what you have planted.</p>
      </SidebarPanel>
    );
  }
  if (tool === 'fence') return (
    <SidebarPanel title="Fence" icon={Fence}><p className="text-xs text-zinc-400">Drag along the line. Posts are drawn every 2.5 m and the length shows when you select it, for ordering wire and posts.</p></SidebarPanel>
  );
  if (tool === 'keyline') return (
    <SidebarPanel title="Keyline pattern" icon={Rows3}>
      <Slider label="Line spacing" value={o.keylineSpacing} min={2} max={30} step={0.5} onChange={(v) => set({ keylineSpacing: v })} display={L(o.keylineSpacing)} />
      <Slider label="Lines each side" value={o.keylineCount} min={1} max={12} onChange={(v) => set({ keylineCount: v })} />
      <Slider label="Length" value={o.swaleLength} min={10} max={Math.max(60, Math.round(grid.size * 1.5))} onChange={(v) => set({ swaleLength: v })} display={L(o.swaleLength)} />
      <p className="text-xs text-zinc-500">Click the keypoint: where a valley's slope changes from convex to concave. The keyline follows the contour there and the rest run parallel, drifting off contour so ripping or planting along them moves water from valley to ridge.</p>
    </SidebarPanel>
  );
  if (tool === 'sector') return (
    <SidebarPanel title="Sector" icon={Compass}>
      <Field label="What comes in">
        <select value={o.sectorType} onChange={(e) => { const t = e.target.value as SectorType; set({ sectorType: t, sectorSpread: SECTOR_STYLE[t].spread || o.sectorSpread }); }} className={inputCls}>
          {Object.entries(SECTOR_STYLE).filter(([k]) => !k.startsWith('sun')).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </Field>
      <Slider label="Width of the wedge" value={o.sectorSpread} min={10} max={180} onChange={(v) => set({ sectorSpread: v })} display={`${o.sectorSpread}°`} />
      <p className="text-xs text-zinc-500">Drag from the home outward toward where it comes from. Sun sectors and the measured wind come from the Sectors button in Analyze.</p>
    </SidebarPanel>
  );
  if (tool === 'paddock') return (
    <SidebarPanel title="Paddock" icon={PawPrint}>
      <Field label="Animals">
        <select value={o.paddockAnimal} onChange={(e) => set({ paddockAnimal: e.target.value as Animal })} className={inputCls}>
          {(Object.keys(ANIMALS) as Animal[]).filter((a) => a !== 'bees').map((a) => <option key={a} value={a}>{ANIMALS[a].label}</option>)}
        </select>
      </Field>
      <Slider label="How many" value={o.paddockHead} min={1} max={200} onChange={(v) => set({ paddockHead: v })} />
      <p className="text-xs text-zinc-500">{localizeText(ANIMALS[o.paddockAnimal].note, units)} Click corners like a zone; double-click or Enter to close.</p>
    </SidebarPanel>
  );
  if (['building', 'greenhouse', 'garden'].includes(tool)) return (
    <SidebarPanel title={typeName(tool)} icon={Home}>
      {tool === 'garden' ? (
        <>
          <Slider label="Bed width" value={o.gardenW} min={0.6} max={4} step={0.1} onChange={(v) => set({ gardenW: v })} display={L(o.gardenW)} />
          <Slider label="Bed length" value={o.gardenD} min={1} max={30} step={0.5} onChange={(v) => set({ gardenD: v })} display={L(o.gardenD)} />
        </>
      ) : (
        <>
          <Slider label="Width" value={o.buildingW} min={2} max={40} step={0.5} onChange={(v) => set({ buildingW: v })} display={L(o.buildingW)} />
          <Slider label="Length" value={o.buildingD} min={2} max={60} step={0.5} onChange={(v) => set({ buildingD: v })} display={L(o.buildingD)} />
          {tool === 'building' && <Slider label="Wall height" value={o.buildingH} min={2} max={10} step={0.1} onChange={(v) => set({ buildingH: v })} display={L(o.buildingH)} />}
        </>
      )}
      <p className="text-xs text-zinc-500">Click to place. Rotate it from the selection panel afterwards.</p>
    </SidebarPanel>
  );
  if (tool === 'tank') return (
    <SidebarPanel title="Water tank" icon={Droplets}>
      <Slider label="Capacity" value={o.tankL} min={1000} max={100000} step={500} onChange={(v) => set({ tankL: v })} display={fmtWater(o.tankL, units)} />
    </SidebarPanel>
  );
  if (tool === 'pond') return (
    <SidebarPanel title="Pond" icon={Droplets}>
      <Slider label="Radius" value={o.pondR} min={1} max={40} step={0.5} onChange={(v) => set({ pondR: v })} display={L(o.pondR)} />
      <Slider label="Depth" value={o.pondDepth} min={0.3} max={5} step={0.1} onChange={(v) => set({ pondDepth: v })} display={L(o.pondDepth)} />
      <p className="text-xs text-zinc-500">Placing a pond digs it into the land. The water fills to the lowest point of the rim, so put it in a dip or below a swale.</p>
    </SidebarPanel>
  );
  if (tool === 'water') return <WaterPanel water={water} setWater={setWater} o={o} set={set} units={units} maxBrush={maxBrush} />;
  if (['compost', 'coop', 'hive', 'irrigation'].includes(tool)) return (
    <SidebarPanel title={typeName(tool)} icon={Home}><p className="text-xs text-zinc-500">Click the land to place it.{tool === 'irrigation' ? ' Emitters spray water in the water simulation.' : ''}</p></SidebarPanel>
  );
  return null;
}

function PlantPicker({ o, set, site }: { o: ToolOpts; set: (p: Partial<ToolOpts>) => void; site: Site }) {
  const [q, setQ] = useState('');
  const [layer, setLayer] = useState<Layer | 'all'>('all');
  const zone = effectiveZone(site);
  const list = SPECIES.filter((s) => (layer === 'all' || s.layer === layer) && (!q || (s.name + s.latin + s.functions.join(' ')).toLowerCase().includes(q.toLowerCase())));
  const sel = SPECIES_BY_ID[o.species];
  const fit = zoneFit(sel, zone);
  return (
    <SidebarPanel title="Plant" icon={TreePine}>
      <div className="flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search, e.g. nitrogen" className={inputCls} />
        <select value={layer} onChange={(e) => setLayer(e.target.value as any)} className={inputCls + ' w-28'}>
          <option value="all">All layers</option>
          {Object.entries(LAYER_NAMES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <div className="max-h-56 overflow-y-auto scroll-thin border border-zinc-800 rounded divide-y divide-zinc-800/70">
        {list.map((s) => {
          const f = zoneFit(s, zone);
          return (
            <button key={s.id} onClick={() => set({ species: s.id })} className={`w-full text-left px-2 py-1.5 flex items-center gap-2 ${o.species === s.id ? 'bg-emerald-600/15' : 'hover:bg-zinc-900'}`}>
              <span className="w-3 h-3 rounded-full shrink-0" style={{ background: s.leaf }} />
              <span className="flex-1 min-w-0">
                <span className="block text-sm text-zinc-200 truncate">{s.name}</span>
                <span className="block text-[11px] text-zinc-500 truncate">{LAYER_NAMES[s.layer]} · {s.functions.slice(0, 2).join(', ')}</span>
              </span>
              {!f.ok && <AlertTriangle size={13} className="text-amber-400 shrink-0" />}
            </button>
          );
        })}
        {!list.length && <div className="px-2 py-3 text-xs text-zinc-500">Nothing matches.</div>}
      </div>
      {sel && (
        <div className="text-xs space-y-1 bg-zinc-900/60 border border-zinc-800 rounded p-2">
          <div className="text-zinc-200 font-medium">{sel.name} <span className="italic text-zinc-500 font-normal">{sel.latin}</span></div>
          <div>Mature: {sel.heightM} m tall, {sel.spreadM} m wide, in about {sel.yearsToMature} years</div>
          <div>Water {sel.water} · Sun {sel.sun} · Zones {sel.zoneMin} to {sel.zoneMax}</div>
          <div>{sel.functions.join(' · ')}</div>
          {zone != null && <div className={fit.ok ? 'text-emerald-400' : 'text-amber-400'}>{fit.text}</div>}
          <div className="text-zinc-500">Suggested spacing: {Math.max(0.3, sel.spreadM * 0.9).toFixed(1)} m apart</div>
        </div>
      )}
      <p className="text-xs text-zinc-500">Click the land to plant. Each click plants one, dated today.</p>
    </SidebarPanel>
  );
}

function WaterPanel({ water, setWater, o, set, units, maxBrush }: { water: WaterSettings; setWater: (p: Partial<WaterSettings>) => void; o: ToolOpts; set: (p: Partial<ToolOpts>) => void; units: Units; maxBrush: number }) {
  return (
    <SidebarPanel title="Water simulation" icon={Droplets}>
      <div className="flex gap-2 pb-3 border-b border-zinc-800">
        <Btn className="flex-1" onClick={() => setWater({ paused: !water.paused })}>{water.paused ? <Play size={14} /> : <Pause size={14} />}{water.paused ? 'Resume' : 'Pause'}</Btn>
        <Btn className="flex-1" onClick={() => setWater({ clearToken: water.clearToken + 1 })}><Eraser size={14} /> Clear</Btn>
      </div>
      <Btn kind="blue" className="w-full py-2" onClick={() => setWater({ rain: !water.rain })}><CloudRain size={14} /> {water.rain ? 'Stop rainfall' : 'Start rainfall'}</Btn>
      <Slider accent="blue" label="Rain intensity" value={water.rainIntensity} min={1} max={10} onChange={(v) => setWater({ rainIntensity: v })} display={`${water.rainIntensity}x`} />
      <div className="pt-2 border-t border-zinc-800 space-y-3">
        <div className="text-xs text-blue-400 uppercase tracking-wider font-semibold">Irrigation emitters</div>
        <Slider accent="blue" label="Flow rate" value={water.irrigationRate} min={0.1} max={5} step={0.1} onChange={(v) => setWater({ irrigationRate: v })} display={`${water.irrigationRate.toFixed(1)}/tick`} />
        <Slider accent="blue" label="Spray radius" value={water.irrigationSpread} min={0} max={5} step={0.1} onChange={(v) => setWater({ irrigationSpread: v })} display={fmtLen(water.irrigationSpread, units)} />
      </div>
      <div className="pt-2 border-t border-zinc-800 space-y-3">
        <div className="text-xs text-blue-400 uppercase tracking-wider font-semibold">Pour by hand</div>
        <Slider accent="blue" label="Brush radius" value={o.brushSize} min={1} max={maxBrush} onChange={(v) => set({ brushSize: v })} display={fmtLen(o.brushSize, units)} />
        <Slider accent="blue" label="Drops per click" value={water.dropCount} min={1} max={60} onChange={(v) => setWater({ dropCount: v })} />
      </div>
      <div className="pt-2 border-t border-zinc-800 space-y-3">
        <div className="text-xs text-blue-400 uppercase tracking-wider font-semibold">Physics and pooling</div>
        <Slider accent="blue" label="Flow speed" value={water.speed} min={0.1} max={3} step={0.1} onChange={(v) => setWater({ speed: v })} display={`${water.speed.toFixed(1)}x`} />
        <Slider accent="blue" label="Evaporation time" value={water.life} min={50} max={1500} step={50} onChange={(v) => setWater({ life: v })} />
        <Slider accent="blue" label="Pooling sensitivity" value={water.pooling} min={0} max={100} onChange={(v) => setWater({ pooling: v })} display={`${water.pooling}%`} />
      </div>
      <p className="text-xs text-zinc-500">Tip: the Flow overlay under Analysis shows where water gathers without running the simulation.</p>
    </SidebarPanel>
  );
}

// ------------------------------------------------------------------ selected object
/** Existing on the land, or proposed in build year 1, 2 or 3. */
export function StatusPhase({ status, phase, onChange }: { status?: string; phase?: number; onChange: (p: { status?: 'existing' | 'proposed'; phase?: number }) => void }) {
  const v = status === 'existing' ? 'e' : String(phase ?? 1);
  return (
    <div data-status-phase>
      <div className="text-[11px] uppercase tracking-[0.08em] text-zinc-400 font-semibold mb-1">On the land</div>
      <Segmented value={v} onChange={(x) => onChange(x === 'e' ? { status: 'existing' } : { status: 'proposed', phase: Number(x) })}
        options={[{ id: 'e', label: 'Existing', title: 'Already there: kept, not priced' }, { id: '1', label: 'Year 1' }, { id: '2', label: 'Year 2' }, { id: '3', label: 'Year 3' }]} />
    </div>
  );
}

export interface PondCatchment { areaM2: number; runoffL: number; spillwayM: number; fillsTimes: number }

export function ObjectPanel({ o, onChange, onDelete, onDuplicate, site, units, ctx, viewDay, sc, catchment, issues = [] }: {
  o: SiteObject; onChange: (p: Partial<SiteObject>) => void; onDelete: () => void; onDuplicate: () => void; site: Site; units: Units; ctx: ModelContext; viewDay: string; sc?: SiteClimate | null;
  catchment?: PondCatchment | null | 'working'; issues?: string[];
}) {
  const cropId = o.type === 'garden' ? o.crop : o.type === 'plant' ? o.species : undefined;
  const calendar = useMemo(() => (sc && cropId && SPECIES_BY_ID[cropId] ? advise(SPECIES_BY_ID[cropId], sc, null, o.type === 'garden' ? 1 : 2, site.soil) : null), [sc, cropId, site.soil]);
  const sp = o.type === 'plant' ? SPECIES_BY_ID[o.species || ''] : null;
  const zone = effectiveZone(site);
  const L = (m: number) => fmtLen(m, units);
  const [evType, setEvType] = useState<JournalEvent['type']>('watered');
  const [evText, setEvText] = useState('');
  const [evKg, setEvKg] = useState('');
  const size = sp ? plantSize(o, ctx) : null;
  const harvestKg = o.events.reduce((s, e) => s + (e.qtyKg || 0), 0);
  return (
    <SidebarPanel title={`Selected: ${typeName(o.type)}`} icon={BoxSelect}>
      <Field label="Name"><input value={o.name} onChange={(e) => onChange({ name: e.target.value })} className={inputCls} /></Field>
      <StatusPhase status={o.status} phase={o.phase} onChange={onChange} />
      {issues.map((t, i) => <div key={i} className="text-xs text-amber-200 bg-amber-400/10 border border-amber-400/25 rounded-lg p-2 flex gap-1.5"><AlertTriangle size={13} className="mt-0.5 shrink-0" />{localizeText(t, units)}</div>)}
      {sp && (
        <>
          <Field label="Species">
            <select value={o.species} onChange={(e) => onChange({ species: e.target.value })} className={inputCls}>
              {SPECIES.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <div className={`text-xs flex items-center gap-1 ${zoneFit(sp, zone).ok ? 'text-emerald-400' : 'text-amber-400'}`}>
            {zoneFit(sp, zone).ok ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}{zoneFit(sp, zone).text || 'Set a real address to check the hardiness zone'}
          </div>
          {size && (
            <div className="text-xs text-zinc-400 bg-zinc-900/60 border border-zinc-800 rounded p-2">
              {size.age < 0 ? `Planned. Goes in on ${o.planted}.` : `${size.age.toFixed(1)} years old on the timeline: ${L(size.height)} tall, ${L(size.spread)} wide (${Math.round(size.f * 100)}% of mature).`}
              <div className="text-zinc-500 mt-1">{sp.functions.join(' · ')}</div>
            </div>
          )}
        </>
      )}
      {o.type === 'garden' && (
        <Field label="Growing in this bed">
          <select value={o.crop || ''} onChange={(e) => onChange({ crop: e.target.value || undefined, name: e.target.value ? `${SPECIES_BY_ID[e.target.value].name} bed` : o.name })} className={inputCls}>
            <option value="">Nothing chosen</option>
            {SPECIES.filter((x) => x.life === 'annual' || x.layer === 'herb' || x.layer === 'groundcover' || x.layer === 'root').sort((a, b) => a.name.localeCompare(b.name)).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </Field>
      )}
      {calendar && (
        <div className="text-xs bg-zinc-900/60 border border-zinc-800 rounded p-2 space-y-0.5">
          <div className={calendar.status === 'good' ? 'text-emerald-400' : calendar.status === 'possible' ? 'text-amber-400' : 'text-red-400'}>{calendar.status === 'good' ? 'Grows well here' : calendar.status === 'possible' ? 'Possible with care' : 'Not suited to this site'}</div>
          {calendar.calendar.filter((l) => l.kind !== 'note').map((l, i) => <div key={i} className="text-zinc-300"><b className="font-medium">{l.label}:</b> {rangesText(l.ranges)}</div>)}
          {calendar.issues.filter((i) => i.level !== 'info').slice(0, 2).map((i, k) => <div key={k} className="text-amber-300">{localizeText(i.text, units)}</div>)}
          {calendar.variety && <div className="text-emerald-300">{localizeText(calendar.variety, units)}</div>}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Field label={o.type === 'plant' ? 'Planted' : 'Built'}><input type="date" value={o.planted || ''} onChange={(e) => onChange({ planted: e.target.value })} className={inputCls} /></Field>
        <Field label="Cost ($)"><input type="number" min={0} value={o.cost ?? (sp ? sp.costUSD : '')} onChange={(e) => onChange({ cost: e.target.value === '' ? undefined : Number(e.target.value) })} className={inputCls} /></Field>
      </div>
      <Field label={o.type === 'plant' ? 'Source (nursery, seed lot)' : 'Supplier or builder'}><input value={o.source || ''} onChange={(e) => onChange({ source: e.target.value })} className={inputCls} /></Field>

      {['building', 'greenhouse', 'garden'].includes(o.type) && (() => {
        const u = units === 'imperial' ? 'ft' : 'm';
        const num = (label: string, v: number, min: number, set: (m: number) => void) => (
          <Field label={`${label} (${u})`}><input type="number" step={units === 'imperial' ? 0.5 : 0.1} min={lenIn(min, units)} value={lenIn(v, units)} onChange={(e) => set(Math.max(min, lenOut(Number(e.target.value), units)))} className={inputCls} data-dim={label.toLowerCase()} /></Field>
        );
        return (
          <div className="grid grid-cols-2 gap-2">
            {num('Width', o.width ?? 0, 0.5, (m) => onChange({ width: m }))}
            {num('Length', o.depth ?? 0, 0.5, (m) => onChange({ depth: m }))}
            {o.type === 'building' && num('Walls', o.height ?? 3, 1, (m) => onChange({ height: m }))}
          </div>
        );
      })()}
      {o.type === 'tank' && <Slider label="Capacity" value={o.capacityL ?? 10000} min={1000} max={100000} step={500} onChange={(v) => onChange({ capacityL: v })} display={fmtWater(o.capacityL ?? 10000, units)} />}
      {o.type === 'pond' && <div className="text-xs text-zinc-400">Radius {L(o.radius ?? 5)}, depth {L(o.depth ?? 1.5)}, holds about {fmtWater(Math.PI * (o.radius ?? 5) ** 2 * (o.depth ?? 1.5) * 500, units)}. Water surface {L(site.base + (o.waterLevel ?? 0))} above sea level.</div>}
      {o.type === 'pond' && catchment && (catchment === 'working' ? <div className="text-xs text-zinc-500">Working out what drains to it...</div> : (
        <div className="grid grid-cols-2 gap-2" data-catchment>
          <Stat label="Drains to it" value={fmtArea(catchment.areaM2, units)} sub={`about ${fmtWater(catchment.runoffL, units)} of runoff a year`} />
          <Stat label="Spillway" value={`at least ${fmtLen(catchment.spillwayM, units, 0)} wide`} sub={catchment.fillsTimes >= 1 ? `the catchment fills it ${catchment.fillsTimes.toFixed(1)} times a year` : 'the catchment alone will not fill it: feed it from a swale'} />
          <p className="col-span-2 text-[11px] text-zinc-500">Rule of thumb from the land above it and your rainfall, with a level spillway on solid ground beside the dam. Have an engineer size any dam wall over 6 ft (1.8 m), and check your state's dam rules.</p>
        </div>
      ))}
      {o.type === 'irrigation' && <Toggle id="flow" label="Emitting water" checked={o.isFlowing !== false} onChange={(v) => onChange({ isFlowing: v })} />}
      {o.type !== 'pond' && <Slider label="Rotation" value={o.rotation || 0} min={0} max={359} onChange={(v) => onChange({ rotation: v })} display={`${o.rotation || 0}°`} />}
      {o.type !== 'pond' && <Slider label="Scale" value={o.scale} min={0.2} max={4} step={0.05} onChange={(v) => onChange({ scale: v })} display={`${o.scale.toFixed(2)}x`} />}
      {o.type !== 'plant' && o.type !== 'pond' && (
        <Field label="Colour"><input type="color" value={o.color || '#e7e2d6'} onChange={(e) => onChange({ color: e.target.value })} className="w-full h-7 rounded cursor-pointer bg-transparent" /></Field>
      )}
      <Field label="Notes"><textarea value={o.notes || ''} onChange={(e) => onChange({ notes: e.target.value })} rows={2} className={inputCls} /></Field>

      <div className="pt-2 border-t border-zinc-800">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs uppercase tracking-wider text-zinc-500 flex items-center gap-1"><BookOpen size={12} /> Journal</div>
          {harvestKg > 0 && <div className="text-xs text-emerald-400">{harvestKg.toFixed(1)} kg harvested</div>}
        </div>
        <div className="flex gap-1 mb-1">
          <select value={evType} onChange={(e) => setEvType(e.target.value as any)} className={inputCls + ' w-28'}>
            {EVENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <input value={evText} onChange={(e) => setEvText(e.target.value)} placeholder="What happened" className={inputCls} />
        </div>
        <div className="flex gap-1">
          {evType === 'harvested' && <input value={evKg} onChange={(e) => setEvKg(e.target.value)} placeholder="kg" type="number" className={inputCls + ' w-20'} />}
          <Btn kind="primary" className="flex-1" onClick={() => {
            const ev: JournalEvent = { id: uid(), date: viewDay, type: evType, text: evText || undefined, qtyKg: evKg ? Number(evKg) : undefined };
            onChange({ events: [ev, ...o.events] });
            setEvText(''); setEvKg('');
          }}><Plus size={13} /> Log on {viewDay}</Btn>
        </div>
        <div className="mt-2 space-y-1 max-h-40 overflow-y-auto scroll-thin">
          {o.events.length === 0 && <div className="text-xs text-zinc-600">Nothing logged yet.</div>}
          {[...o.events].sort((a, b) => b.date.localeCompare(a.date)).map((e) => (
            <div key={e.id} className="flex items-start gap-2 text-xs group">
              <span className="text-zinc-500 font-mono shrink-0">{e.date}</span>
              <span className="text-zinc-300 flex-1"><b className="text-zinc-200">{e.type}</b>{e.qtyKg ? ` ${e.qtyKg} kg` : ''}{e.text ? `: ${e.text}` : ''}</span>
              <button className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-400" title="Remove" onClick={() => onChange({ events: o.events.filter((x) => x.id !== e.id) })}><Trash2 size={11} /></button>
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-2 pt-2">
        <Btn className="flex-1" onClick={onDuplicate}><Copy size={13} /> Duplicate</Btn>
        <Btn kind="danger" className="flex-1" onClick={onDelete}><Trash2 size={13} /> Delete</Btn>
      </div>
      <p className="text-[11px] text-zinc-600">Drag it on the map with the Select tool to move it. Delete key removes it.</p>
    </SidebarPanel>
  );
}

// ------------------------------------------------------------------ selected feature
export function FeaturePanel({ f, onChange, onDelete, units, onGuide, hasClimate }: { f: Feature; onChange: (p: Partial<Feature>) => void; onDelete: () => void; units: Units; onGuide?: () => void; hasClimate?: boolean }) {
  const len = polylineLength(f.points);
  const title = { path: 'Path', zone: 'Zone', swale: 'Swale', berm: 'Berm', fence: 'Fence', keyline: 'Keyline', sector: 'Sector', paddock: 'Paddock', boundary: 'Property line' }[f.kind];
  return (
    <SidebarPanel title={`Selected: ${title}`} icon={f.kind === 'zone' ? Hexagon : f.kind === 'path' ? Route : f.kind === 'fence' ? Fence : f.kind === 'sector' ? Compass : f.kind === 'paddock' ? PawPrint : f.kind === 'keyline' ? Rows3 : Waves}>
      <Field label="Name"><input value={f.name} onChange={(e) => onChange({ name: e.target.value })} className={inputCls} /></Field>
      {!['sector', 'boundary', 'zone'].includes(f.kind) && <StatusPhase status={f.status} phase={f.phase} onChange={onChange} />}
      {f.kind === 'boundary' && <Stat label="Inside the property line" value={fmtArea(polygonArea(f.points), units)} sub={`${fmtLen(polylineLength([...f.points, f.points[0]]), units, 0)} around`} />}
      {f.kind === 'zone' && (
        <>
          <Field label="Zone">
            <select value={f.zone ?? 1} onChange={(e) => onChange({ zone: Number(e.target.value), color: undefined })} className={inputCls}>
              {ZONE_NAMES.map((z, i) => <option key={i} value={i}>{z}</option>)}
            </select>
          </Field>
          <Stat label="Area" value={fmtArea(polygonArea(f.points), units)} />
          {onGuide && <Btn kind="primary" className="w-full py-2" onClick={onGuide}><Sprout size={14} /> {hasClimate ? 'What to plant here, and when' : 'Plant guide (needs a real address)'}</Btn>}
        </>
      )}
      {f.kind === 'path' && (
        <>
          <Slider label="Width" value={f.width ?? 1.5} min={0.4} max={6} step={0.1} onChange={(v) => onChange({ width: v })} display={fmtLen(f.width ?? 1.5, units)} />
          <Field label="Surface colour"><input type="color" value={f.color || '#c8b08a'} onChange={(e) => onChange({ color: e.target.value })} className="w-full h-7 rounded bg-transparent" /></Field>
          <Stat label="Length" value={fmtLen(len, units)} sub={`${fmtArea(len * (f.width ?? 1.5), units)} of surface`} />
        </>
      )}
      {(f.kind === 'swale' || f.kind === 'berm') && (
        <>
          <Stat label="Length" value={fmtLen(len, units)} sub={f.kind === 'swale' ? `Holds about ${fmtWater(len * (f.width ?? 1) * (f.depth ?? 0.5) * 1000, units)} per fill` : `${fmtLen(f.height ?? 0.6, units)} high`} />
          <p className="text-xs text-zinc-500">This is the record of the earthwork. Deleting it keeps the shaped ground; use Undo to take the digging back.</p>
        </>
      )}
      {f.kind === 'fence' && <Stat label="Length" value={fmtLen(len, units)} sub={`about ${Math.ceil(len / 2.5) + 1} posts at ${units === 'imperial' ? '8 ft' : '2.5 m'}`} />}
      {f.kind === 'keyline' && <Stat label="Length" value={fmtLen(len, units)} sub="Rip, plant or swale along it" />}
      {f.kind === 'sector' && (
        <>
          <Field label="What comes in">
            <select value={f.sector || 'wind'} onChange={(e) => onChange({ sector: e.target.value as SectorType })} className={inputCls}>
              {Object.entries(SECTOR_STYLE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </Field>
          <Slider label="Width of the wedge" value={f.spread ?? 50} min={10} max={300} onChange={(v) => onChange({ spread: v })} display={`${f.spread ?? 50}°`} />
          {f.points.length >= 2 && <Stat label="Comes from" value={`${Math.round(bearing(f.points[0], f.points[1]))}° ${COMPASS[Math.round(bearing(f.points[0], f.points[1]) / 45) % 8]}`} />}
        </>
      )}
      {f.kind === 'paddock' && (() => {
        const a = polygonArea(f.points), an = ANIMALS[f.animal || 'chickens'];
        const need = (f.head ?? 0) * an.m2Each;
        return (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Animals">
                <select value={f.animal || 'chickens'} onChange={(e) => onChange({ animal: e.target.value as Animal })} className={inputCls}>
                  {(Object.keys(ANIMALS) as Animal[]).filter((k) => k !== 'bees').map((k) => <option key={k} value={k}>{ANIMALS[k].label}</option>)}
                </select>
              </Field>
              <Field label="How many"><input type="number" min={0} value={f.head ?? 0} onChange={(e) => onChange({ head: Math.max(0, Number(e.target.value)) })} className={inputCls} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Area" value={fmtArea(a, units)} sub={need ? `${Math.round((a / need) * 100)}% of what they need` : ''} />
              <Stat label="Rest between grazes" value={`${f.restDays ?? an.restDays} days`} sub={need > a ? `Split into ${Math.ceil(need / Math.max(1, a))}+ paddocks and rotate` : 'Room enough to rotate'} />
            </div>
            <p className="text-xs text-zinc-500">{localizeText(an.note, units)}</p>
          </>
        );
      })()}
      <Field label="Notes"><textarea value={f.notes || ''} onChange={(e) => onChange({ notes: e.target.value })} rows={2} className={inputCls} /></Field>
      <Btn kind="danger" className="w-full" onClick={onDelete}><Trash2 size={13} /> Delete</Btn>
    </SidebarPanel>
  );
}

// ------------------------------------------------------------------ site facts
export function SitePanel({ site, units, stats, onResurvey, sc, onEditClimate, surroundings }: { site: Site; units: Units; stats: any; onResurvey?: () => void; sc?: SiteClimate | null; onEditClimate?: () => void; surroundings?: React.ReactNode }) {
  const c = site.climate, s = site.soil;
  const maxP = c ? Math.max(1, ...c.monthlyPrecipMm) : 1;
  return (
    <SidebarPanel title="Site" icon={MapPin}>
      {site.lat != null ? (
        <div className="text-xs text-zinc-300">{site.address}<div className="font-mono text-zinc-500">{site.lat.toFixed(5)}, {site.lon!.toFixed(5)}</div></div>
      ) : <div className="text-xs text-zinc-400">Flat sandbox. Use File, New site from address to load real land.</div>}
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Area" value={fmtArea(site.size * site.size, units)} sub={`${fmtLen(site.size, units, 0)} square`} />
        <Stat label="Elevation" value={`${fmtLen(site.base + stats.min, units, 0)} to ${fmtLen(site.base + stats.max, units, 0)}`} sub={`${fmtLen(stats.relief, units)} of relief`} />
        <Stat label="Mean slope" value={`${stats.meanSlope.toFixed(1)}%`} sub={`steepest 1% of the land: ${stats.steepest.toFixed(0)}%`} />
        <Stat label="Terrain data" value={site.sourceResM ? `${site.sourceResM} m` : 'none'} sub={site.source} />
      </div>
      <div>
        <div className="text-xs uppercase tracking-wider text-zinc-500 mb-1">Slope classes</div>
        {SLOPE_CLASSES.map((k, i) => (
          <div key={i} className="flex items-center gap-2 text-xs mb-0.5" title={k.use}>
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: k.color }} />
            <span className="flex-1 text-zinc-400">{k.label}</span>
            <span className="text-zinc-300 font-mono">{Math.round(stats.classes[i] * 100)}%</span>
          </div>
        ))}
      </div>
      <div>
        <div className="text-xs uppercase tracking-wider text-zinc-500 mb-1">Which way the land faces</div>
        <div className="grid grid-cols-4 gap-1 text-[11px]">
          {COMPASS.map((d, i) => <div key={d} className="bg-zinc-900 rounded px-1 py-0.5 text-center"><span className="text-zinc-500">{d}</span> <span className="text-zinc-300">{Math.round(stats.aspects[i] * 100)}%</span></div>)}
        </div>
        <div className="text-[11px] text-zinc-500 mt-1">Flat: {Math.round(stats.flat * 100)}%. {site.lat != null && (site.lat >= 0 ? 'South' : 'North')}-facing ground warms first and suits sun lovers.</div>
      </div>
      {c && (
        <div className="pt-2 border-t border-zinc-800 space-y-2">
          <div className="text-xs uppercase tracking-wider text-zinc-500 flex items-center gap-1"><CloudSun size={12} /> Climate ({c.period})</div>
          {sc ? (
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Hardiness zone" value={sc.zoneLabel} sub={sc.zoneSource} />
              <Stat label="Rainfall" value={`${fmtRain(c.annualPrecipMm, units)} / yr`} sub={sc.koppen?.name} />
              <Stat label="Last spring frost" value={sc.frostFree ? 'Frost free' : doyLabel(sc.lastMean!)} sub={sc.frostFree ? '' : `safe after ${doyLabel(sc.lastSafe!)}`} />
              <Stat label="First fall frost" value={sc.frostFree ? 'Frost free' : doyLabel(sc.firstMean!)} sub={sc.frostFree ? '' : `safe before ${doyLabel(sc.firstSafe!)}`} />
              {!sc.frostFree && <Stat label="Frost-free season" value={`${sc.frostFreeAvgDays} days`} sub={`average year; ${sc.frostFreeDays} days in 9 years of 10`} />}
              <Stat label="Winter chill" value={sc.chill != null ? `${sc.chill.toLocaleString()} h` : '?'} sub={units === 'imperial' ? 'hours at 32 to 45°F' : 'hours at 0 to 7°C'} />
              <Stat label="Summer heat" value={`${fmtTemp(sc.hottestMaxC, units)} highs`} sub={sc.gdd != null ? `${sc.gdd.toLocaleString()} degree days` : ''} />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Hardiness zone" value={c.zone?.label ?? '?'} sub={c.zone ? `coldest night about ${fmtTemp(c.meanAnnualMinC!, units)}` : ''} />
              <Stat label="Rainfall" value={`${fmtRain(c.annualPrecipMm, units)} / yr`} />
              <Stat label="Last spring frost" value={c.frostFree ? 'Frost free' : c.lastSpringFrost ?? 'none'} />
              <Stat label="First fall frost" value={c.frostFree ? 'Frost free' : c.firstFallFrost ?? 'none'} sub={c.growingSeasonDays ? `${c.growingSeasonDays} day season` : ''} />
            </div>
          )}
          {onEditClimate && <button onClick={onEditClimate} className="text-xs text-emerald-400 hover:underline flex items-center gap-1"><Pencil size={11} /> {site.overrides && Object.keys(site.overrides).length ? 'Using your own zone or frost dates. Change' : 'Know your real zone or frost dates? Set them'}</button>}
          <div className="flex items-end gap-0.5 h-12" title="Average rain by month">
            {c.monthlyPrecipMm.map((v, i) => <div key={i} className="flex-1 bg-blue-500/70 rounded-t" style={{ height: `${(v / maxP) * 100}%` }} title={`${'JFMAMJJASOND'[i]}: ${fmtRain(v, units)}`} />)}
          </div>
          <div className="flex text-[9px] text-zinc-600">{'JFMAMJJASOND'.split('').map((m, i) => <div key={i} className="flex-1 text-center">{m}</div>)}</div>
          <div className="text-[10px] text-zinc-600">{c.source}. Reanalysis smooths out valleys and hilltops, so treat the zone as an estimate.</div>
        </div>
      )}
      {s && (
        <div className="pt-2 border-t border-zinc-800 space-y-1 text-xs">
          <div className="text-xs uppercase tracking-wider text-zinc-500">Soil where the pin is</div>
          {s.available ? (
            <>
              <div className="text-zinc-200">{s.mapUnit}</div>
              <div>Texture: {s.topsoilTexture || 'unknown'} · Drainage: {s.drainage || 'unknown'}</div>
              <div>Runoff group: {s.hydrologicGroup || '?'}{s.pH != null ? ` · pH ${s.pH}` : ''}{s.organicMatterPct != null ? ` · organic matter ${s.organicMatterPct}%` : ''}</div>
              <div className="text-[10px] text-zinc-600">{s.source}</div>
            </>
          ) : <div className="text-zinc-500">{s.note}</div>}
        </div>
      )}
      {surroundings}
      {site.note && <div className="text-[11px] text-zinc-500">{site.note}</div>}
      {onResurvey && <Btn className="w-full" onClick={onResurvey}>Refresh climate and soil</Btn>}
    </SidebarPanel>
  );
}

// ------------------------------------------------------------------ analysis overlays
const OVERLAYS: { id: Overlay; label: string }[] = [
  { id: 'none', label: 'None' }, { id: 'slope', label: 'Slope' }, { id: 'aspect', label: 'Aspect (facing)' },
  { id: 'elevation', label: 'Elevation' }, { id: 'flow', label: 'Water flow' }, { id: 'sun', label: 'Sun hours' }, { id: 'soil', label: 'Soil map' },
];

export function AnalysisPanel({ s, set, busy, sunInfo, units, extra, soils }: { s: Settings; set: (p: Partial<Settings>) => void; busy: string | null; sunInfo: string; units: Units; extra?: React.ReactNode; soils?: SoilUnit[] | null }) {
  return (
    <SidebarPanel title="Analysis" icon={Activity} right={busy ? <span className="text-[10px] text-emerald-400">{busy}</span> : null}>
      <div className="grid grid-cols-3 gap-1.5">
        {OVERLAYS.map((o) => (
          <button key={o.id} onClick={() => set({ overlay: o.id })} className={`px-1.5 py-2 rounded-xl text-[11px] font-medium border transition-all ${s.overlay === o.id ? 'bg-emerald-400/15 border-emerald-400/60 text-emerald-200' : 'border-white/[0.07] text-zinc-300 hover:bg-white/[0.04]'}`}>{o.label}</button>
        ))}
      </div>
      {s.overlay !== 'none' && <Slider label="Overlay strength" value={s.overlayOpacity} min={0.1} max={1} step={0.05} onChange={(v) => set({ overlayOpacity: v })} display={`${Math.round(s.overlayOpacity * 100)}%`} />}
      {s.overlay === 'slope' && SLOPE_CLASSES.map((k, i) => (
        <div key={i} className="flex items-center gap-2 text-xs"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: k.color }} /><span className="text-zinc-300">{k.label}</span><span className="text-zinc-500 truncate">{k.use}</span></div>
      ))}
      {s.overlay === 'aspect' && <p className="text-xs text-zinc-500">Blue faces north, green east, orange south, yellow west, grey is flat.</p>}
      {s.overlay === 'flow' && <p className="text-xs text-zinc-500">Dark blue lines are where runoff from the most land gathers: the natural drainage. Good places for swales above them and ponds where they slow down.</p>}
      {s.overlay === 'soil' && (soils && soils.length ? (
        <div className="space-y-1.5" data-soil-legend>
          {soils.map((u, i) => (
            <div key={u.mukey} className="flex items-start gap-2 text-xs">
              <span className="w-2.5 h-2.5 rounded-sm mt-0.5 shrink-0" style={{ background: soilColor(u.drainage, i) }} />
              <span className="flex-1"><span className="text-zinc-200">{u.name}</span><span className="block text-zinc-500">{Math.round(u.share * 100)}% of the site · {u.drainage || 'drainage unknown'}{u.flooding && u.flooding !== 'None' ? ` · floods: ${u.flooding.toLowerCase()}` : ''}{u.pH != null ? ` · pH ${u.pH}` : ''}</span></span>
            </div>
          ))}
          <p className="text-[11px] text-zinc-500">USDA soil survey map units. Blue soils stay wet; warm colours drain fast.</p>
        </div>
      ) : <p className="text-xs text-zinc-500">The soil map loads with the flood maps and streams. Open the Site tab and load the existing conditions.</p>)}
      {s.overlay === 'sun' && <p className="text-xs text-zinc-500">{sunInfo || 'Direct sun through the day shown on the timeline, counting shade from hills, trees and buildings.'} Yellow gets the most sun, dark purple the least.</p>}
      <div className="pt-2 border-t border-zinc-800 space-y-3">
        <Toggle id="contours" label="Contour lines" checked={s.contours} onChange={(v) => set({ contours: v })} />
        {s.contours && (
          <Field label="Contour interval">
            <select value={contourChoices(units).reduce((b, c) => (Math.abs(c.m - s.contourInterval) < Math.abs(b.m - s.contourInterval) ? c : b)).m} onChange={(e) => set({ contourInterval: Number(e.target.value) })} className={inputCls}>
              {contourChoices(units).map((c) => <option key={c.label} value={c.m}>{c.label}</option>)}
            </select>
          </Field>
        )}
      </div>
      {extra}
    </SidebarPanel>
  );
}

// ------------------------------------------------------------------ layers and display
const LAYER_LABELS: Record<LayerId, string> = {
  plants: 'Trees and plants', structures: 'Buildings and structures', gardens: 'Garden beds', water: 'Ponds, tanks, irrigation',
  paths: 'Paths and fences', zones: 'Zones and paddocks', earthworks: 'Earthworks and keylines', sectors: 'Sectors',
  existing: 'Roads, buildings and streams on the map', hazards: 'Flood areas and wetlands',
};

export function LayersPanel({ s, set, counts, hasSatellite, onClearAll }: { s: Settings; set: (p: Partial<Settings>) => void; counts: Record<LayerId, number>; hasSatellite: boolean; onClearAll: () => void }) {
  return (
    <SidebarPanel title="Layers and display" icon={Layers}>
      <div className="space-y-1.5">
        {(Object.keys(LAYER_LABELS) as LayerId[]).map((k) => (
          <div key={k} className="flex items-center gap-2">
            <input type="checkbox" id={`layer-${k}`} checked={s.layers[k]} onChange={(e) => set({ layers: { ...s.layers, [k]: e.target.checked } })} className="w-4 h-4 accent-emerald-500" />
            <label htmlFor={`layer-${k}`} className="flex-1 text-sm text-zinc-300 cursor-pointer">{LAYER_LABELS[k]}</label>
            <span className="text-xs text-zinc-500 font-mono">{counts[k]}</span>
          </div>
        ))}
      </div>
      <div className="pt-2 border-t border-zinc-800 space-y-2" data-phase-filter>
        <div className="text-[13px] text-zinc-200">Show the design as built by</div>
        <Segmented value={s.phaseShown ?? 3} onChange={(v) => set({ phaseShown: v })} options={[{ id: 1, label: 'Year 1' }, { id: 2, label: 'Year 2' }, { id: 3, label: 'Year 3' }]} />
        <p className="text-[11px] text-zinc-500">Walk the client through the build one year at a time. Existing things always show.</p>
      </div>
      <div className="pt-2 border-t border-zinc-800 space-y-3">
        <Toggle id="sat" label={hasSatellite ? 'Satellite photo' : 'Satellite photo (none for this site)'} checked={s.satellite && hasSatellite} onChange={(v) => set({ satellite: v })} />
        {s.satellite && hasSatellite && <Slider label="Photo opacity" value={s.imageOpacity} min={0} max={1} step={0.05} onChange={(v) => set({ imageOpacity: v })} display={`${Math.round(s.imageOpacity * 100)}%`} />}
        <Toggle id="grid" label="Measuring grid" checked={s.grid} onChange={(v) => set({ grid: v })} />
        <Slider label="Vertical exaggeration" value={s.exaggeration} min={0.5} max={5} step={0.1} onChange={(v) => set({ exaggeration: v })} display={`${s.exaggeration.toFixed(1)}x`} />
        <Segmented value={s.units} onChange={(u) => set({ units: u })} options={[{ id: 'imperial', label: 'Feet, acres, gallons' }, { id: 'metric', label: 'Metres, hectares, litres' }]} />
      </div>
      <ConfirmBtn className="w-full" confirmText="Click again: removes all elements, zones and paths" onConfirm={onClearAll}><Trash2 size={13} /> Clear all placed elements</ConfirmBtn>
    </SidebarPanel>
  );
}

// ------------------------------------------------------------------ tasks and journal
export function TasksPanel({ objects, ctx, viewDay, onToggle, onSelect, sc, watch }: { objects: SiteObject[]; ctx: ModelContext; viewDay: string; onToggle: (t: Task) => void; onSelect: (id: string) => void; sc?: SiteClimate | null; watch?: WatchItem[] | 'loading' | null }) {
  const tasks = useMemo(() => monthTasks(objects, ctx, sc), [objects, ctx, sc]);
  // the journal groups the same thing done to many plants on one day: "28 Eastern red cedar: planted"
  const recent = useMemo(() => {
    const all = objects.flatMap((o) => o.events.map((e) => ({ ...e, obj: o }))).sort((a, b) => b.date.localeCompare(a.date));
    const out: { key: string; date: string; label: string; id: string; n: number; one: string; kind: string; what: string }[] = [];
    for (const e of all) {
      const kind = e.obj.type === 'plant' ? SPECIES_BY_ID[e.obj.species || '']?.name || e.obj.name : e.obj.name;
      const key = `${e.date}|${e.type}|${e.obj.type === 'plant' ? kind : e.obj.id}|${e.qtyKg ?? ''}`;
      const hit = out.find((x) => x.key === key);
      if (hit) { hit.n++; continue; }
      if (out.length >= 14) continue;
      out.push({ key, date: e.date, label: '', id: e.obj.id, n: 1, one: e.obj.name, kind, what: `${e.type}${e.qtyKg ? ` ${e.qtyKg} kg` : ''}` });
    }
    return out.map((x) => ({ ...x, label: x.n > 1 ? `${x.n} ${x.kind}: ${x.what}` : `${x.one}: ${x.what}` }));
  }, [objects]);
  const month = ctx.viewDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const done = tasks.filter((t) => t.done).length;
  return (
    <SidebarPanel title="Tasks and journal" icon={ListChecks} right={tasks.length ? <span className="text-[10px] text-zinc-400">{done}/{tasks.length}</span> : null}>
      {watch && (
        <div className="space-y-1.5" data-season-watch>
          <div className="text-[11px] uppercase tracking-[0.1em] text-zinc-400 font-semibold flex items-center gap-1.5"><CloudLightning size={12} className="text-sky-300" /> Season watch, next 10 days</div>
          {watch === 'loading' ? <div className="text-xs text-zinc-500">Reading the forecast...</div> : watch.length === 0 ? <div className="text-xs text-zinc-500">No frost, storm, gale or heat in the forecast. A good week for the jobs below.</div> : watch.map((w, i) => (
            <button key={i} onClick={() => w.ids[0] && onSelect(w.ids[0])} className={`w-full text-left rounded-xl border p-2.5 ${w.level === 'warn' ? 'border-amber-400/30 bg-amber-400/[0.07]' : 'border-white/[0.07] bg-zinc-950/40'}`}>
              <div className="text-[13px] text-zinc-100 font-medium flex items-center gap-1.5">{/rost/.test(w.title) ? <Snowflake size={13} className="text-sky-300" /> : <CloudLightning size={13} className="text-amber-300" />}{w.title}</div>
              <div className="text-[11px] text-zinc-400 mt-0.5">{w.text}</div>
            </button>
          ))}
        </div>
      )}
      <div className="text-xs text-zinc-500">Jobs for {month}, worked out from each plant's own calendar and your site's climate. The same job on many plants is one line. Move the timeline to plan another month.</div>
      {tasks.length === 0 ? <div className="text-xs text-zinc-600">{objects.length ? 'Nothing due this month.' : 'Place plants and structures and their jobs show up here.'}</div> : (
        <div className="space-y-1 max-h-64 overflow-y-auto scroll-thin">
          {tasks.map((t) => (
            <div key={t.id} className="flex items-start gap-2">
              <input type="checkbox" checked={t.done} onChange={() => onToggle(t)} className="mt-0.5 w-4 h-4 accent-emerald-500" />
              <button onClick={() => onSelect(t.objectId)} className="text-left flex-1">
                <div className={`text-sm ${t.done ? 'text-zinc-500 line-through' : 'text-zinc-200'}`} data-task>{t.label}</div>
                <div className="text-[11px] text-zinc-600">{t.why}</div>
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="pt-2 border-t border-zinc-800">
        <div className="text-xs uppercase tracking-wider text-zinc-500 mb-1">Recent journal</div>
        {recent.length === 0 ? <div className="text-xs text-zinc-600">Ticking a task or logging on a plant writes here, dated {viewDay}.</div> : recent.map((e) => (
          <button key={e.key} onClick={() => onSelect(e.id)} className="w-full text-left text-xs flex gap-2 py-0.5 hover:text-zinc-200" data-journal>
            <span className="font-mono text-zinc-600">{e.date}</span><span className="text-zinc-400 truncate">{e.label}</span>
          </button>
        ))}
      </div>
    </SidebarPanel>
  );
}

// ------------------------------------------------------------------ design summary
export function SummaryPanel({ site, objects, features, stats, units, onReport }: { site: Site; objects: SiteObject[]; features: Feature[]; stats: any; units: Units; onReport: () => void }) {
  const d = useMemo(() => designSummary(site, objects, features), [site, objects, features]);
  const W = (l: number | null) => (l == null ? 'needs an address' : fmtWater(l, units));
  return (
    <SidebarPanel title="Design summary" icon={BarChart3}>
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Plants" value={d.plants} sub={d.zoneMisfits ? `${d.zoneMisfits} outside the zone` : 'all fit the zone'} />
        <Stat label="Plant budget" value={`$${Math.round(d.plantCost).toLocaleString()}`} sub={d.otherCost ? `+ $${Math.round(d.otherCost).toLocaleString()} other` : ''} />
        <Stat label="Rain on the site" value={W(d.rainOnSiteL)} sub="per year" />
        <Stat label="Roof catchment" value={W(d.roofCatchL)} sub={`${fmtArea(d.roofM2, units)} of roof`} />
        <Stat label="Water storage" value={fmtWater(d.storageL, units)} sub="tanks, ponds, swales" />
        <Stat label="Swales" value={fmtLen(d.swaleLen, units, 0)} sub={`${d.swaleCount} built`} />
        <Stat label="Earth moved" value={fmtVol(stats.cutM3 + stats.fillM3, units)} sub={`cut ${fmtVol(stats.cutM3, units)}, fill ${fmtVol(stats.fillM3, units)}`} />
        <Stat label="Paths" value={fmtLen(d.pathLen, units, 0)} />
      </div>
      {Object.keys(d.byLayer).length > 0 && (
        <div className="text-xs space-y-0.5">
          {Object.entries(d.byLayer).map(([k, v]) => <div key={k} className="flex justify-between"><span>{LAYER_NAMES[k as Layer]}</span><span className="font-mono text-zinc-300">{v}</span></div>)}
        </div>
      )}
      {d.zones > 0 && (
        <div className="text-xs space-y-0.5">
          {Object.entries(d.zoneAreas).map(([z, a]) => <div key={z} className="flex justify-between"><span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: ZONE_COLORS[+z] }} />{ZONE_NAMES[+z]}</span><span className="font-mono text-zinc-300">{fmtArea(a, units)}</span></div>)}
        </div>
      )}
      <Btn kind="primary" className="w-full py-2" onClick={onReport}><BarChart3 size={14} /> Open the full site report</Btn>
    </SidebarPanel>
  );
}

export const SunBadge = ({ alt, az }: { alt: number; az: number }) => (
  <span className="flex items-center gap-1"><Sun size={12} className={alt > 0 ? 'text-amber-400' : 'text-zinc-600'} />{alt > 0 ? `${alt.toFixed(0)}° up, ${COMPASS[Math.round(az / 45) % 8]}` : 'below the horizon'}</span>
);

// ------------------------------------------------------------------ existing conditions from the public maps
export function ExistingConditions({ site, units, reading, onLoad, onImportBuildings, onBoundary, hasBoundary, onSoilMap }: {
  site: Site; units: Units; reading: boolean; onLoad: () => void; onImportBuildings: () => void; onBoundary: () => void; hasBoundary: boolean; onSoilMap: () => void;
}) {
  const r = site.surroundings;
  const errs = r ? Object.keys(r.errors || {}) : [];
  const sfha = (r?.flood || []).filter((z) => z.sfha);
  const floodArea = sfha.reduce((t, z) => t + polygonArea(z.ring), 0);
  const streams = r?.streams?.length ? r.streams : (r?.osm?.water || []).filter((w) => w.line);
  const NAMES: Record<string, string> = { flood: 'flood maps', wetlands: 'wetlands', streams: 'streams', soils: 'soil map', osm: 'roads and buildings' };
  return (
    <div className="pt-2 border-t border-zinc-800 space-y-2" data-existing>
      <div className="text-xs uppercase tracking-wider text-zinc-500 flex items-center gap-1"><MapIcon2 size={12} /> Existing conditions</div>
      {!r ? (
        <div className="space-y-2">
          <p className="text-xs text-zinc-400">{reading ? 'Reading FEMA flood maps, streams, wetlands, the soil survey and OpenStreetMap...' : 'Flood zones, streams, wetlands, the soil map and the roads and buildings already on the land.'}</p>
          {!reading && <Btn className="w-full" onClick={onLoad}>Load them</Btn>}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Flood area" value={sfha.length ? fmtArea(floodArea, units) : r.flood ? 'None mapped' : 'Not loaded'} sub={sfha.length ? [...new Set(sfha.map((z) => z.label.split(':')[0]))].join(', ') : 'FEMA'} />
            <Stat label="Wetlands" value={(r.wetlands || []).length ? `${r.wetlands!.length} mapped` : r.wetlands ? 'None' : 'Not loaded'} sub={(r.wetlands || [])[0]?.type || 'USFWS inventory'} />
            <Stat label="Streams" value={streams.length ? `${fmtLen(streams.reduce((t: number, x: any) => t + polylineLength(x.line), 0), units, 0)}` : 'None mapped'} sub={streams[0] ? ((streams[0] as any).name || (streams[0] as any).kind) : 'USGS hydrography'} />
            <Stat label="On the map" value={`${r.osm?.buildings.length ?? 0} buildings`} sub={`${r.osm?.roads.length ?? 0} road and drive segments`} />
          </div>
          {(r.soils || []).length > 0 && (
            <button onClick={onSoilMap} className="w-full text-left rounded-lg bg-zinc-900/60 border border-zinc-800 p-2 hover:border-zinc-600" data-soil-units>
              <div className="text-xs text-zinc-200">{r.soils!.length} soil map units on the site</div>
              <div className="text-[11px] text-zinc-500 truncate">{r.soils!.slice(0, 3).map((u) => `${Math.round(u.share * 100)}% ${u.name.split(',')[0]}`).join(' · ')}</div>
              <div className="text-[11px] text-emerald-400 mt-0.5">Show the soil map</div>
            </button>
          )}
          {(r.osm?.buildings.length ?? 0) > 0 && <Btn className="w-full" onClick={onImportBuildings} data-import-buildings><Home size={13} /> Add the mapped buildings as existing</Btn>}
          {!hasBoundary && <Btn className="w-full" onClick={onBoundary}>Draw or import the property line</Btn>}
          {errs.length > 0 && <div className="text-[11px] text-amber-300">Could not reach the {errs.map((e) => NAMES[e] || e).join(', ')} this time. <button className="underline" onClick={onLoad} disabled={reading}>{reading ? 'Trying...' : 'Try again'}</button></div>}
          <div className="text-[10px] text-zinc-600">FEMA, USFWS, USGS, USDA NRCS and OpenStreetMap. Read {new Date(r.fetched).toLocaleDateString()}. Public maps miss things: walk the land and call 811 before digging.</div>
        </>
      )}
    </div>
  );
}
