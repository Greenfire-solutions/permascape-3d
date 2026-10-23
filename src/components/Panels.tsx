import React, { useMemo, useState } from 'react';
import {
  BoxSelect, Trash2, Copy, MountainSnow, Mountain, Waves, Droplets, CloudRain, Play, Pause, Eraser, TreePine, Home,
  MapPin, CloudSun, Layers, Activity, ListChecks, BarChart3, Route, Hexagon, Ruler, Sun, AlertTriangle, CheckCircle2, BookOpen, Plus, Sprout, Pencil,
} from 'lucide-react';
import type { Feature, SiteObject, Settings, Site, LayerId, JournalEvent, Overlay } from '../lib/types';
import { SPECIES, SPECIES_BY_ID, LAYER_NAMES, zoneFit, Layer } from '../lib/plants';
import { SLOPE_CLASSES, COMPASS, polygonArea, polylineLength } from '../lib/terrain';
import { ZONE_COLORS, ZONE_NAMES } from '../lib/mapTexture';
import { fmtLen, fmtArea, fmtWater, fmtRain, fmtTemp, fmtVol, Units } from '../lib/units';
import { designSummary, monthTasks, Task } from '../lib/summary';
import { ModelContext, plantSize } from '../lib/models';
import { uid } from '../lib/api';
import { advise, rangesText, SiteClimate, doyLabel } from '../lib/advisor';
import type { Tool, WaterSettings } from './Viewport3D';
import { SidebarPanel, Slider, Field, inputCls, Toggle, Btn, Stat, ConfirmBtn } from './ui';

export interface ToolOpts {
  brushSize: number; brushStrength: number; flattenHeight: number;
  bermWidth: number; bermHeight: number; swaleWidth: number; swaleDepth: number; withBerm: boolean; swaleLength: number;
  pathWidth: number; zoneNumber: number; species: string;
  buildingW: number; buildingD: number; buildingH: number; tankL: number; pondR: number; pondDepth: number; gardenW: number; gardenD: number;
}

export const DEFAULT_TOOL_OPTS: ToolOpts = {
  brushSize: 8, brushStrength: 40, flattenHeight: 0,
  bermWidth: 2, bermHeight: 0.6, swaleWidth: 1.2, swaleDepth: 0.5, withBerm: true, swaleLength: 40,
  pathWidth: 1.5, zoneNumber: 1, species: 'apple',
  buildingW: 8, buildingD: 10, buildingH: 3, tankL: 10000, pondR: 6, pondDepth: 1.5, gardenW: 1.2, gardenD: 4,
};

const TYPE_NAMES: Record<string, string> = {
  plant: 'Plant', building: 'Building', greenhouse: 'Greenhouse', tank: 'Water tank', pond: 'Pond', garden: 'Garden bed',
  compost: 'Compost bays', coop: 'Chicken coop', hive: 'Beehive', irrigation: 'Irrigation emitter',
};
export const typeName = (t: string) => TYPE_NAMES[t] || t;

const EVENT_TYPES: JournalEvent['type'][] = ['watered', 'pruned', 'fed', 'mulched', 'harvested', 'issue', 'treated', 'note', 'planted', 'built'];

// ------------------------------------------------------------------ tool options
export function ToolPanel({ tool, o, set, water, setWater, units, site, grid }: {
  tool: Tool; o: ToolOpts; set: (p: Partial<ToolOpts>) => void; water: WaterSettings; setWater: (p: Partial<WaterSettings>) => void; units: Units; site: Site; grid: { size: number };
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
  const zone = site.climate?.zone?.zone;
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
export function ObjectPanel({ o, onChange, onDelete, onDuplicate, site, units, ctx, viewDay, sc }: {
  o: SiteObject; onChange: (p: Partial<SiteObject>) => void; onDelete: () => void; onDuplicate: () => void; site: Site; units: Units; ctx: ModelContext; viewDay: string; sc?: SiteClimate | null;
}) {
  const cropId = o.type === 'garden' ? o.crop : o.type === 'plant' ? o.species : undefined;
  const calendar = useMemo(() => (sc && cropId && SPECIES_BY_ID[cropId] ? advise(SPECIES_BY_ID[cropId], sc, null, o.type === 'garden' ? 1 : 2, site.soil) : null), [sc, cropId, site.soil]);
  const sp = o.type === 'plant' ? SPECIES_BY_ID[o.species || ''] : null;
  const zone = site.climate?.zone?.zone;
  const L = (m: number) => fmtLen(m, units);
  const [evType, setEvType] = useState<JournalEvent['type']>('watered');
  const [evText, setEvText] = useState('');
  const [evKg, setEvKg] = useState('');
  const size = sp ? plantSize(o, ctx) : null;
  const harvestKg = o.events.reduce((s, e) => s + (e.qtyKg || 0), 0);
  return (
    <SidebarPanel title={`Selected: ${typeName(o.type)}`} icon={BoxSelect}>
      <Field label="Name"><input value={o.name} onChange={(e) => onChange({ name: e.target.value })} className={inputCls} /></Field>
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
          {calendar.issues.filter((i) => i.level !== 'info').slice(0, 2).map((i, k) => <div key={k} className="text-amber-300">{i.text}</div>)}
          {calendar.variety && <div className="text-emerald-300">{calendar.variety}</div>}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Field label={o.type === 'plant' ? 'Planted' : 'Built'}><input type="date" value={o.planted || ''} onChange={(e) => onChange({ planted: e.target.value })} className={inputCls} /></Field>
        <Field label="Cost ($)"><input type="number" min={0} value={o.cost ?? (sp ? sp.costUSD : '')} onChange={(e) => onChange({ cost: e.target.value === '' ? undefined : Number(e.target.value) })} className={inputCls} /></Field>
      </div>
      <Field label={o.type === 'plant' ? 'Source (nursery, seed lot)' : 'Supplier or builder'}><input value={o.source || ''} onChange={(e) => onChange({ source: e.target.value })} className={inputCls} /></Field>

      {['building', 'greenhouse', 'garden'].includes(o.type) && (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Width (m)"><input type="number" step={0.1} min={0.5} value={o.width ?? 0} onChange={(e) => onChange({ width: Math.max(0.5, Number(e.target.value)) })} className={inputCls} /></Field>
          <Field label="Length (m)"><input type="number" step={0.1} min={0.5} value={o.depth ?? 0} onChange={(e) => onChange({ depth: Math.max(0.5, Number(e.target.value)) })} className={inputCls} /></Field>
          {o.type === 'building' && <Field label="Walls (m)"><input type="number" step={0.1} min={1} value={o.height ?? 3} onChange={(e) => onChange({ height: Math.max(1, Number(e.target.value)) })} className={inputCls} /></Field>}
        </div>
      )}
      {o.type === 'tank' && <Slider label="Capacity" value={o.capacityL ?? 10000} min={1000} max={100000} step={500} onChange={(v) => onChange({ capacityL: v })} display={fmtWater(o.capacityL ?? 10000, units)} />}
      {o.type === 'pond' && <div className="text-xs text-zinc-400">Radius {L(o.radius ?? 5)}, depth {L(o.depth ?? 1.5)}, holds about {fmtWater(Math.PI * (o.radius ?? 5) ** 2 * (o.depth ?? 1.5) * 500, units)}. Water surface {L(site.base + (o.waterLevel ?? 0))} above sea level.</div>}
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
  const title = { path: 'Path', zone: 'Zone', swale: 'Swale', berm: 'Berm' }[f.kind];
  return (
    <SidebarPanel title={`Selected: ${title}`} icon={f.kind === 'zone' ? Hexagon : f.kind === 'path' ? Route : Waves}>
      <Field label="Name"><input value={f.name} onChange={(e) => onChange({ name: e.target.value })} className={inputCls} /></Field>
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
      <Field label="Notes"><textarea value={f.notes || ''} onChange={(e) => onChange({ notes: e.target.value })} rows={2} className={inputCls} /></Field>
      <Btn kind="danger" className="w-full" onClick={onDelete}><Trash2 size={13} /> Delete</Btn>
    </SidebarPanel>
  );
}

// ------------------------------------------------------------------ site facts
export function SitePanel({ site, units, stats, onResurvey, sc, onEditClimate }: { site: Site; units: Units; stats: any; onResurvey?: () => void; sc?: SiteClimate | null; onEditClimate?: () => void }) {
  const c = site.climate, s = site.soil;
  const maxP = c ? Math.max(1, ...c.monthlyPrecipMm) : 1;
  return (
    <SidebarPanel title="Site" icon={MapPin} defaultOpen={false}>
      {site.lat != null ? (
        <div className="text-xs text-zinc-300">{site.address}<div className="font-mono text-zinc-500">{site.lat.toFixed(5)}, {site.lon!.toFixed(5)}</div></div>
      ) : <div className="text-xs text-zinc-400">Flat sandbox. Use File, New site from address to load real land.</div>}
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Area" value={fmtArea(site.size * site.size, units)} sub={`${fmtLen(site.size, units, 0)} square`} />
        <Stat label="Elevation" value={`${fmtLen(site.base + stats.min, units, 0)} to ${fmtLen(site.base + stats.max, units, 0)}`} sub={`${fmtLen(stats.relief, units)} of relief`} />
        <Stat label="Mean slope" value={`${stats.meanSlope.toFixed(1)}%`} sub={`steepest ${stats.steepest.toFixed(0)}%`} />
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
              <Stat label="Winter chill" value={sc.chill != null ? `${sc.chill.toLocaleString()} h` : '?'} sub="0 to 7 C hours" />
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
          <div className="text-xs uppercase tracking-wider text-zinc-500">Soil</div>
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
      {site.note && <div className="text-[11px] text-zinc-500">{site.note}</div>}
      {onResurvey && <Btn className="w-full" onClick={onResurvey}>Refresh climate and soil</Btn>}
    </SidebarPanel>
  );
}

// ------------------------------------------------------------------ analysis overlays
const OVERLAYS: { id: Overlay; label: string }[] = [
  { id: 'none', label: 'None' }, { id: 'slope', label: 'Slope' }, { id: 'aspect', label: 'Aspect (facing)' },
  { id: 'elevation', label: 'Elevation' }, { id: 'flow', label: 'Water flow' }, { id: 'sun', label: 'Sun hours' },
];

export function AnalysisPanel({ s, set, busy, sunInfo, units }: { s: Settings; set: (p: Partial<Settings>) => void; busy: string | null; sunInfo: string; units: Units }) {
  return (
    <SidebarPanel title="Analysis" icon={Activity} right={busy ? <span className="text-[10px] text-emerald-400">{busy}</span> : null}>
      <div className="grid grid-cols-3 gap-1">
        {OVERLAYS.map((o) => (
          <button key={o.id} onClick={() => set({ overlay: o.id })} className={`px-1.5 py-1.5 rounded text-[11px] border ${s.overlay === o.id ? 'bg-emerald-600/20 border-emerald-600 text-emerald-300' : 'border-zinc-800 text-zinc-400 hover:bg-zinc-900'}`}>{o.label}</button>
        ))}
      </div>
      {s.overlay !== 'none' && <Slider label="Overlay strength" value={s.overlayOpacity} min={0.1} max={1} step={0.05} onChange={(v) => set({ overlayOpacity: v })} display={`${Math.round(s.overlayOpacity * 100)}%`} />}
      {s.overlay === 'slope' && SLOPE_CLASSES.map((k, i) => (
        <div key={i} className="flex items-center gap-2 text-xs"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: k.color }} /><span className="text-zinc-300">{k.label}</span><span className="text-zinc-500 truncate">{k.use}</span></div>
      ))}
      {s.overlay === 'aspect' && <p className="text-xs text-zinc-500">Blue faces north, green east, orange south, yellow west, grey is flat.</p>}
      {s.overlay === 'flow' && <p className="text-xs text-zinc-500">Dark blue lines are where runoff from the most land gathers: the natural drainage. Good places for swales above them and ponds where they slow down.</p>}
      {s.overlay === 'sun' && <p className="text-xs text-zinc-500">{sunInfo || 'Direct sun through the day shown on the timeline, counting shade from hills, trees and buildings.'} Yellow gets the most sun, dark purple the least.</p>}
      <div className="pt-2 border-t border-zinc-800 space-y-3">
        <Toggle id="contours" label="Contour lines" checked={s.contours} onChange={(v) => set({ contours: v })} />
        {s.contours && (
          <Field label="Contour interval">
            <select value={s.contourInterval} onChange={(e) => set({ contourInterval: Number(e.target.value) })} className={inputCls}>
              {[0.25, 0.5, 1, 2, 5, 10, 20].map((v) => <option key={v} value={v}>{fmtLen(v, units, v < 1 ? 2 : 0)}</option>)}
            </select>
          </Field>
        )}
      </div>
    </SidebarPanel>
  );
}

// ------------------------------------------------------------------ layers and display
const LAYER_LABELS: Record<LayerId, string> = {
  plants: 'Trees and plants', structures: 'Buildings and structures', gardens: 'Garden beds', water: 'Ponds, tanks, irrigation',
  paths: 'Paths', zones: 'Zones', earthworks: 'Earthwork lines',
};

export function LayersPanel({ s, set, counts, hasSatellite, onClearAll }: { s: Settings; set: (p: Partial<Settings>) => void; counts: Record<LayerId, number>; hasSatellite: boolean; onClearAll: () => void }) {
  return (
    <SidebarPanel title="Layers and display" icon={Layers} defaultOpen={false}>
      <div className="space-y-1.5">
        {(Object.keys(LAYER_LABELS) as LayerId[]).map((k) => (
          <div key={k} className="flex items-center gap-2">
            <input type="checkbox" id={`layer-${k}`} checked={s.layers[k]} onChange={(e) => set({ layers: { ...s.layers, [k]: e.target.checked } })} className="w-4 h-4 accent-emerald-500" />
            <label htmlFor={`layer-${k}`} className="flex-1 text-sm text-zinc-300 cursor-pointer">{LAYER_LABELS[k]}</label>
            <span className="text-xs text-zinc-500 font-mono">{counts[k]}</span>
          </div>
        ))}
      </div>
      <div className="pt-2 border-t border-zinc-800 space-y-3">
        <Toggle id="sat" label={hasSatellite ? 'Satellite photo' : 'Satellite photo (none for this site)'} checked={s.satellite && hasSatellite} onChange={(v) => set({ satellite: v })} />
        {s.satellite && hasSatellite && <Slider label="Photo opacity" value={s.imageOpacity} min={0} max={1} step={0.05} onChange={(v) => set({ imageOpacity: v })} display={`${Math.round(s.imageOpacity * 100)}%`} />}
        <Toggle id="grid" label="Measuring grid" checked={s.grid} onChange={(v) => set({ grid: v })} />
        <Slider label="Vertical exaggeration" value={s.exaggeration} min={0.5} max={5} step={0.1} onChange={(v) => set({ exaggeration: v })} display={`${s.exaggeration.toFixed(1)}x`} />
        <div className="flex gap-2">
          {(['imperial', 'metric'] as const).map((u) => (
            <button key={u} onClick={() => set({ units: u })} className={`flex-1 py-1 rounded text-xs border ${s.units === u ? 'border-emerald-600 bg-emerald-600/15 text-emerald-300' : 'border-zinc-800 text-zinc-400'}`}>{u === 'imperial' ? 'Feet, acres, gallons' : 'Metres, hectares, litres'}</button>
          ))}
        </div>
      </div>
      <ConfirmBtn className="w-full" confirmText="Click again: removes all elements, zones and paths" onConfirm={onClearAll}><Trash2 size={13} /> Clear all placed elements</ConfirmBtn>
    </SidebarPanel>
  );
}

// ------------------------------------------------------------------ tasks and journal
export function TasksPanel({ objects, ctx, viewDay, onToggle, onSelect, sc }: { objects: SiteObject[]; ctx: ModelContext; viewDay: string; onToggle: (t: Task) => void; onSelect: (id: string) => void; sc?: SiteClimate | null }) {
  const tasks = useMemo(() => monthTasks(objects, ctx, sc), [objects, ctx, sc]);
  const month = ctx.viewDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const recent = useMemo(() => objects.flatMap((o) => o.events.map((e) => ({ ...e, obj: o }))).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12), [objects]);
  const done = tasks.filter((t) => t.done).length;
  return (
    <SidebarPanel title="Tasks and journal" icon={ListChecks} defaultOpen={false} right={tasks.length ? <span className="text-[10px] text-zinc-400">{done}/{tasks.length}</span> : null}>
      <div className="text-xs text-zinc-500">Jobs for {month}, worked out from each plant's own calendar and your site's climate. Move the timeline to plan another month.</div>
      {tasks.length === 0 ? <div className="text-xs text-zinc-600">{objects.length ? 'Nothing due this month.' : 'Place plants and structures and their jobs show up here.'}</div> : (
        <div className="space-y-1 max-h-64 overflow-y-auto scroll-thin">
          {tasks.map((t) => (
            <div key={t.id} className="flex items-start gap-2">
              <input type="checkbox" checked={t.done} onChange={() => onToggle(t)} className="mt-0.5 w-4 h-4 accent-emerald-500" />
              <button onClick={() => onSelect(t.objectId)} className="text-left flex-1">
                <div className={`text-sm ${t.done ? 'text-zinc-500 line-through' : 'text-zinc-200'}`}>{t.label}</div>
                <div className="text-[11px] text-zinc-600">{t.why}</div>
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="pt-2 border-t border-zinc-800">
        <div className="text-xs uppercase tracking-wider text-zinc-500 mb-1">Recent journal</div>
        {recent.length === 0 ? <div className="text-xs text-zinc-600">Ticking a task or logging on a plant writes here, dated {viewDay}.</div> : recent.map((e) => (
          <button key={e.id + e.obj.id} onClick={() => onSelect(e.obj.id)} className="w-full text-left text-xs flex gap-2 py-0.5 hover:text-zinc-200">
            <span className="font-mono text-zinc-600">{e.date}</span><span className="text-zinc-400 truncate">{e.obj.name}: {e.type}{e.qtyKg ? ` ${e.qtyKg} kg` : ''}</span>
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
    <SidebarPanel title="Design summary" icon={BarChart3} defaultOpen={false}>
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
