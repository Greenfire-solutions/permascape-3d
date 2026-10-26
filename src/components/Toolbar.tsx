import React, { useEffect, useRef, useState } from 'react';
import { SquareDashed,
  MousePointer2, Ruler, ArrowUpFromLine, ArrowDownToLine, Wind, Minus, Waves, Spline, Mountain, Droplet, Hexagon, Route,
  TreePine, Home, Warehouse, Sprout, Cylinder, Recycle, Egg, Flower2, Pipette, Droplets, Shovel, TreeDeciduous, Fence,
  Compass, Grip, PawPrint, Trees, LayoutGrid, Building2, Rows3,
} from 'lucide-react';
import type { Tool } from './Viewport3D';

export interface ToolDef { id: Tool; name: string; icon: any; key?: string; hint: string }
export interface ToolGroup { id: string; name: string; icon: any; tools: ToolDef[] }

export const TOOL_GROUPS: ToolGroup[] = [
  { id: 'select', name: 'Select', icon: MousePointer2, tools: [
    { id: 'select', name: 'Select and move', icon: MousePointer2, key: 'v', hint: 'Click anything to inspect it, drag to move' },
    { id: 'measure', name: 'Measure', icon: Ruler, key: 'm', hint: 'Distance, rise and grade between two points' },
  ] },
  { id: 'water', name: 'Water', icon: Droplets, tools: [
    { id: 'contour', name: 'Swale on contour', icon: Spline, key: 'c', hint: 'Snaps to the exact level line' },
    { id: 'keyline', name: 'Keyline pattern', icon: Rows3, key: 'k', hint: 'Parallel lines that lead water to the ridges' },
    { id: 'pond', name: 'Pond', icon: Droplet, hint: 'Digs a bowl that fills to its rim' },
    { id: 'swale', name: 'Swale (freehand)', icon: Waves, hint: 'Draw it yourself; berm goes downhill' },
    { id: 'berm', name: 'Berm', icon: Mountain, hint: 'A raised mound of earth' },
    { id: 'tank', name: 'Water tank', icon: Cylinder, hint: 'Catch the roof water' },
    { id: 'irrigation', name: 'Irrigation emitter', icon: Pipette, hint: 'Sprays in the water simulation' },
    { id: 'water', name: 'Pour water', icon: Droplets, key: 'w', hint: 'Watch where it runs and pools' },
  ] },
  { id: 'land', name: 'Shape', icon: Shovel, tools: [
    { id: 'raise', name: 'Raise', icon: ArrowUpFromLine, hint: 'Brush the ground up' },
    { id: 'lower', name: 'Lower', icon: ArrowDownToLine, hint: 'Dig the ground down' },
    { id: 'smooth', name: 'Smooth', icon: Wind, hint: 'Soften bumps' },
    { id: 'flatten', name: 'Flatten', icon: Minus, hint: 'Level a pad; shift-click copies a height' },
  ] },
  { id: 'plan', name: 'Plan', icon: LayoutGrid, tools: [
    { id: 'zone', name: 'Zone', icon: Hexagon, key: 'z', hint: 'Zones 0 to 5, then the plant guide opens' },
    { id: 'sector', name: 'Sector', icon: Compass, key: 's', hint: 'Wind, fire, views, noise coming in' },
    { id: 'path', name: 'Path', icon: Route, hint: 'Draw a path' },
    { id: 'fence', name: 'Fence', icon: Fence, key: 'f', hint: 'Posts and wire along a line' },
    { id: 'paddock', name: 'Paddock', icon: PawPrint, hint: 'Grazing area with stocking numbers' },
    { id: 'boundary', name: 'Property line', icon: SquareDashed, hint: 'The legal boundary, traced or imported' },
  ] },
  { id: 'plants', name: 'Plants', icon: TreePine, tools: [
    { id: 'plant', name: 'Plant', icon: TreePine, key: 'p', hint: 'One plant from the library' },
    { id: 'guild', name: 'Tree guild', icon: TreeDeciduous, key: 'g', hint: 'A fruit tree with all its helpers' },
    { id: 'hedge', name: 'Hedgerow', icon: Trees, key: 'h', hint: 'Windbreak trees and shrubs along a line' },
    { id: 'garden', name: 'Garden bed', icon: Sprout, key: 'b', hint: 'A bed with its own planting calendar' },
  ] },
  { id: 'build', name: 'Build', icon: Building2, tools: [
    { id: 'building', name: 'House or barn', icon: Home, hint: 'Its roof feeds the water budget' },
    { id: 'greenhouse', name: 'Greenhouse', icon: Warehouse, hint: 'Season extension' },
    { id: 'compost', name: 'Compost bays', icon: Recycle, hint: 'Closes the nutrient loop' },
    { id: 'coop', name: 'Chicken coop', icon: Egg, hint: 'Eggs, manure, pest control' },
    { id: 'hive', name: 'Beehive', icon: Flower2, hint: 'Pollination and honey' },
  ] },
];

export const ALL_TOOLS: ToolDef[] = TOOL_GROUPS.flatMap((g) => g.tools);
export const groupOf = (t: Tool) => TOOL_GROUPS.find((g) => g.tools.some((x) => x.id === t))!;

/** The left rail: one button per group; a group opens a labelled flyout of its tools. */
export default function Toolbar({ tool, onTool }: { tool: Tool; onTool: (t: Tool) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [last, setLast] = useState<Record<string, Tool>>({});
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(null); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null); };
    window.addEventListener('mousedown', close); window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', esc); };
  }, [open]);
  const active = groupOf(tool);
  return (
    <div ref={ref} className="absolute left-3 top-1/2 -translate-y-1/2 z-20 no-print" data-toolbar>
      <div className="glass rounded-2xl shadow-glass p-1.5 flex flex-col gap-1">
        {TOOL_GROUPS.map((g) => {
          const isActive = active?.id === g.id;
          const shown = ALL_TOOLS.find((t) => t.id === (isActive ? tool : last[g.id])) || g.tools[0];
          const Icon = g.id === 'select' && isActive ? shown.icon : g.icon;
          return (
            <div key={g.id} className="relative">
              <button data-group={g.id} title={g.name} onClick={() => (g.id === 'select' && !isActive ? onTool('select') : setOpen(open === g.id ? null : g.id))}
                className={`w-[52px] h-[52px] rounded-xl flex flex-col items-center justify-center gap-0.5 transition-all ${isActive ? 'bg-emerald-400 text-emerald-950 shadow-glow' : open === g.id ? 'bg-white/10 text-white' : 'text-zinc-300 hover:bg-white/[0.07] hover:text-white'}`}>
                <Icon size={19} strokeWidth={isActive ? 2.3 : 1.9} />
                <span className="text-[9.5px] font-semibold tracking-wide">{g.name}</span>
              </button>
              {open === g.id && (
                <div className="absolute left-full top-0 ml-2.5 w-[268px] glass rounded-2xl shadow-glass p-1.5 animate-rise" data-flyout={g.id}>
                  <div className="px-2.5 pt-1.5 pb-1 text-[10px] uppercase tracking-[0.12em] text-zinc-400 font-semibold">{g.name}</div>
                  {g.tools.map((t) => (
                    <button key={t.id} data-tool={t.id} onClick={() => { onTool(t.id); setLast((l) => ({ ...l, [g.id]: t.id })); setOpen(null); }}
                      className={`w-full flex items-center gap-3 px-2.5 py-2 rounded-xl text-left transition-colors ${tool === t.id ? 'bg-emerald-400/15 text-emerald-100' : 'hover:bg-white/[0.06] text-zinc-100'}`}>
                      <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${tool === t.id ? 'bg-emerald-400 text-emerald-950' : 'bg-white/[0.06] text-zinc-200'}`}><t.icon size={16} /></span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-[13px] font-medium leading-tight">{t.name}</span>
                        <span className="block text-[11px] text-zinc-400 leading-snug truncate">{t.hint}</span>
                      </span>
                      {t.key && <kbd className="text-[10px] font-mono text-zinc-400 border border-white/10 rounded px-1.5 py-0.5">{t.key.toUpperCase()}</kbd>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex justify-center"><Grip size={12} className="text-white/20" /></div>
    </div>
  );
}
