import React, { useMemo, useState } from 'react';
import { BookOpen, CalendarDays, Droplets, ClipboardCheck, Search, TreePine, TreeDeciduous, Trees, CheckCircle2, AlertTriangle, Lightbulb, ArrowRight, Leaf, Sun, Droplet } from 'lucide-react';
import { Sheet, Chip, Ring, Btn, Stat, Segmented } from './ui';
import { SPECIES, LAYER_NAMES, zoneFit, seasonalMonth, Species, Layer } from '../lib/plants';
import { CATEGORY_NAMES } from '../lib/library';
import { advise, rangesText, SiteClimate, Advice } from '../lib/advisor';
import { monthTasks } from '../lib/summary';
import { waterBudget, reviewDesign, FixId, ReviewInput, effectiveZone, WaterUseIn } from '../lib/permaculture';
import type { Feature, Site, SiteObject } from '../lib/types';
import { fmtWater, fmtRain, Units, fmtArea, localizeText } from '../lib/units';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const STATUS = { good: { label: 'Grows well here', cls: 'text-emerald-300 bg-emerald-400/10 border-emerald-400/30' }, possible: { label: 'Possible with care', cls: 'text-amber-200 bg-amber-400/10 border-amber-400/30' }, no: { label: 'Not suited', cls: 'text-red-300 bg-red-400/10 border-red-400/25' } };
const FUNCTIONS = ['fruit', 'nut', 'nitrogen fixer', 'pollinator', 'dynamic accumulator', 'windbreak', 'medicine', 'drought tolerant', 'shade tolerant', 'culinary', 'wildlife', 'timber', 'fodder', 'ground cover'];

// ---------------------------------------------------------------- plant library

export function PlantLibrary({ sc, site, onClose, onUse }: { sc: SiteClimate | null; site: Site; onClose: () => void; onUse: (id: string, how: 'plant' | 'guild' | 'hedge') => void }) {
  const [q, setQ] = useState('');
  const [layer, setLayer] = useState<Layer | 'all'>('all');
  const [fn, setFn] = useState<string | null>(null);
  const [onlyHere, setOnlyHere] = useState(!!sc);
  const [pick, setPick] = useState<string | null>(null);
  const zone = effectiveZone(site);
  const advice = useMemo(() => {
    const m: Record<string, Advice> = {};
    if (sc) for (const sp of SPECIES) { try { m[sp.id] = advise(sp, sc, null, sp.pz[0] ?? 2, site.soil); } catch { /* keep going */ } }
    return m;
  }, [sc, site.soil]);
  const status = (sp: Species) => advice[sp.id]?.status ?? (zoneFit(sp, zone).ok ? 'good' : 'no');
  const list = SPECIES.filter((sp) => (layer === 'all' || sp.layer === layer)
    && (!fn || sp.functions.some((f) => f.toLowerCase().includes(fn === 'ground cover' ? 'ground' : fn)) || (fn === 'ground cover' && sp.layer === 'groundcover'))
    && (!q || (sp.name + ' ' + sp.latin + ' ' + sp.functions.join(' ') + ' ' + CATEGORY_NAMES[sp.category]).toLowerCase().includes(q.toLowerCase()))
    && (!onlyHere || status(sp) !== 'no'))
    .sort((a, b) => ({ good: 0, possible: 1, no: 2 }[status(a)] - { good: 0, possible: 1, no: 2 }[status(b)]) || a.name.localeCompare(b.name));
  const sel = pick ? SPECIES.find((s) => s.id === pick) : null;
  const selAdv = sel ? advice[sel.id] : null;
  return (
    <Sheet title="Plant library" subtitle={`${SPECIES.length} plants, judged against ${sc ? `your climate (zone ${sc.zoneLabel}, ${sc.koppen?.name ?? ''})` : 'the hardiness zone'}`} icon={BookOpen} onClose={onClose}>
      <div className="flex h-full min-h-0">
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="px-6 pt-4 pb-3 space-y-3 border-b hairline">
            <div className="flex gap-2 items-center">
              <div className="relative flex-1">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search plants, uses or Latin names" className="w-full bg-zinc-950/70 border border-white/10 rounded-xl pl-9 pr-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-emerald-400/60" />
              </div>
              <select value={layer} onChange={(e) => setLayer(e.target.value as any)} className="bg-zinc-950/70 border border-white/10 rounded-xl px-3 py-2 text-sm text-zinc-100">
                <option value="all">All layers</option>
                {Object.entries(LAYER_NAMES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              {sc && <Chip active={onlyHere} onClick={() => setOnlyHere(!onlyHere)}>Grows here</Chip>}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {FUNCTIONS.map((f) => <Chip key={f} active={fn === f} onClick={() => setFn(fn === f ? null : f)}>{f}</Chip>)}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto scroll-thin p-6">
            <div className="text-xs text-zinc-400 mb-3">{list.length} plants</div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-3">
              {list.map((sp) => {
                const st = status(sp);
                return (
                  <button key={sp.id} data-species={sp.id} onClick={() => setPick(sp.id)} className={`text-left rounded-2xl border p-3.5 transition-all hover:-translate-y-0.5 ${pick === sp.id ? 'border-emerald-400/70 bg-emerald-400/[0.07]' : 'border-white/[0.07] bg-zinc-950/40 hover:border-white/20'}`}>
                    <div className="flex items-start gap-3">
                      <span className="w-10 h-10 rounded-xl shrink-0 flex items-center justify-center" style={{ background: `radial-gradient(circle at 35% 30%, ${sp.fruit || sp.flower || sp.leaf}, ${sp.leaf})` }}><Leaf size={16} className="text-white/80" /></span>
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-semibold text-zinc-50 leading-tight truncate">{sp.name}</div>
                        <div className="text-[11px] italic text-zinc-400 truncate">{sp.latin}</div>
                      </div>
                    </div>
                    <div className="mt-2.5 text-[11px] text-zinc-400 truncate">{LAYER_NAMES[sp.layer]} · {sp.heightM} m</div>
                    <div className="text-[11px] text-zinc-300 truncate">{sp.functions.slice(0, 3).join(' · ') || CATEGORY_NAMES[sp.category]}</div>
                    <div className={`mt-2 inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full border ${STATUS[st].cls}`}>{STATUS[st].label}</div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        {sel && (
          <aside className="w-[360px] shrink-0 border-l hairline overflow-y-auto scroll-thin p-6 space-y-4 animate-rise" data-plant-detail>
            <div>
              <div className="font-display text-2xl text-zinc-50 leading-tight">{sel.name}</div>
              <div className="text-sm italic text-zinc-400">{sel.latin}</div>
              <div className={`mt-2 inline-block text-[11px] font-semibold px-2.5 py-0.5 rounded-full border ${STATUS[status(sel)].cls}`}>{STATUS[status(sel)].label}</div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Mature size" value={`${sel.heightM} m tall`} sub={`${sel.spreadM} m wide in ${sel.yearsToMature} yrs`} />
              <Stat label="Hardiness" value={`Zones ${sel.zoneMin} to ${sel.zoneMax}`} sub={sel.chill ? `${sel.chill[0]} to ${sel.chill[1]} chill h` : ''} />
              <Stat label="Water" value={sel.water} sub={sel.droughtOk ? 'drought tolerant' : ''} />
              <Stat label="Sun" value={sel.sun} sub={LAYER_NAMES[sel.layer]} />
            </div>
            {sel.functions.length > 0 && <div className="flex flex-wrap gap-1.5">{sel.functions.map((f) => <span key={f} className="text-[11px] px-2 py-0.5 rounded-full bg-white/[0.06] text-zinc-200">{f}</span>)}</div>}
            {selAdv && (
              <div className="rounded-2xl bg-zinc-950/50 border hairline p-3.5 space-y-1.5 text-xs">
                <div className="text-[10px] uppercase tracking-[0.1em] text-zinc-500 font-semibold">On your land</div>
                {selAdv.calendar.filter((l) => l.kind !== 'note').map((l, i) => <div key={i} className="text-zinc-200"><b className="font-semibold">{l.label}:</b> {rangesText(l.ranges)}</div>)}
                {selAdv.good.slice(0, 3).map((g, i) => <div key={i} className="text-emerald-300 flex gap-1.5"><CheckCircle2 size={12} className="mt-0.5 shrink-0" />{g}</div>)}
                {selAdv.issues.filter((x) => x.level !== 'info').slice(0, 3).map((x, i) => <div key={i} className="text-amber-200 flex gap-1.5"><AlertTriangle size={12} className="mt-0.5 shrink-0" />{x.text}</div>)}
                {selAdv.variety && <div className="text-emerald-200">{selAdv.variety}</div>}
              </div>
            )}
            {sel.notes && <p className="text-xs text-zinc-300 leading-relaxed">{sel.notes}</p>}
            {sel.caution && <p className="text-xs text-amber-200 leading-relaxed">{sel.caution}</p>}
            <div className="text-xs text-zinc-400">Harvest: {sel.harvest.length ? sel.harvest.map((m) => MONTHS[m - 1]).join(', ') : 'n/a'} · Prune: {sel.prune.length ? sel.prune.map((m) => MONTHS[m - 1]).join(', ') : 'n/a'} · about ${sel.costUSD}</div>
            <div className="space-y-2 pt-1">
              <Btn kind="primary" className="w-full py-2.5 text-[13px]" onClick={() => onUse(sel.id, 'plant')}><TreePine size={15} /> Plant it on the land</Btn>
              {['fruit-tree', 'nut-tree'].includes(sel.category) && <Btn className="w-full py-2" onClick={() => onUse(sel.id, 'guild')}><TreeDeciduous size={14} /> Plant as a guild</Btn>}
              {sel.heightM >= 4 && sel.life === 'perennial' && <Btn className="w-full py-2" onClick={() => onUse(sel.id, 'hedge')}><Trees size={14} /> Use in a hedgerow</Btn>}
            </div>
          </aside>
        )}
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------- year calendar

export function YearCalendar({ objects, sc, lat, start, onClose, onSelect }: { objects: SiteObject[]; sc: SiteClimate | null; lat: number | null; start: Date; onClose: () => void; onSelect: (id: string) => void }) {
  const [view, setView] = useState<'jobs' | 'harvest'>('jobs');
  // the twelve months from the one on the timeline: a plan looks forward, not back to January
  const dates = useMemo(() => MONTHS.map((_, k) => new Date(start.getFullYear(), start.getMonth() + k, 15)), [start.getFullYear(), start.getMonth()]);
  const months = useMemo(() => dates.map((d) => monthTasks(objects, { viewDate: d, lat } as any, sc)), [objects, sc, lat, dates]);
  const harvest = useMemo(() => {
    const by: Record<string, { sp: Species; n: number; months: number[] }> = {};
    for (const o of objects) {
      const sp = SPECIES.find((s) => s.id === (o.type === 'plant' ? o.species : o.type === 'garden' ? o.crop : ''));
      if (!sp || !sp.harvest.length) continue;
      by[sp.id] = by[sp.id] || { sp, n: 0, months: MONTHS.map((_, m) => m + 1).filter((m) => sp.harvest.includes(seasonalMonth(m, lat))) };
      by[sp.id].n++;
    }
    return Object.values(by).sort((a, b) => (a.months[0] ?? 13) - (b.months[0] ?? 13));
  }, [objects, lat]);
  const now = start.getMonth();
  const kindColor: Record<string, string> = { pruned: '#c084fc', harvested: '#f5b94a', planted: '#8acf52', watered: '#5cc8f0', mulched: '#d4a95c', note: '#b4c2b7' };
  return (
    <Sheet title="The year ahead on your land" subtitle={`${dates[0].toLocaleDateString('en-US', { month: 'long', year: 'numeric' })} to ${dates[11].toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}: every job and harvest from your plants' own calendars and your climate`} icon={CalendarDays} onClose={onClose}
      actions={<div className="w-56"><Segmented size="md" value={view} onChange={setView} options={[{ id: 'jobs', label: 'Jobs' }, { id: 'harvest', label: 'Harvests' }]} /></div>}>
      {view === 'jobs' ? (
        <div className="p-6 grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-3">
          {months.map((tasks, m) => (
            <div key={m} className={`rounded-2xl border p-4 ${m === 0 ? 'border-emerald-400/50 bg-emerald-400/[0.05]' : 'border-white/[0.07] bg-zinc-950/40'}`}>
              <div className="flex items-baseline justify-between mb-2">
                <div className="font-display text-lg text-zinc-50">{dates[m].toLocaleDateString('en-US', { month: 'long' })}{dates[m].getMonth() === 0 || m === 0 ? <span className="text-xs text-zinc-500 font-sans ml-1.5">{dates[m].getFullYear()}</span> : null}</div>
                <div className="text-[11px] text-zinc-400">{tasks.length ? `${tasks.filter((t) => t.done).length}/${tasks.length} done` : 'quiet'}</div>
              </div>
              <div className="space-y-1 max-h-56 overflow-y-auto scroll-thin pr-1">
                {tasks.length === 0 && <div className="text-xs text-zinc-500">{objects.length ? 'Nothing due. Rest, observe, plan.' : 'Place plants to fill the calendar.'}</div>}
                {tasks.map((t) => (
                  <button key={t.id} onClick={() => onSelect(t.objectId)} className="w-full text-left flex items-start gap-2 text-xs hover:bg-white/[0.04] rounded-lg px-1.5 py-1">
                    <span className="w-2 h-2 rounded-full mt-1 shrink-0" style={{ background: kindColor[t.type] || '#b4c2b7' }} />
                    <span className={t.done ? 'text-zinc-500 line-through' : 'text-zinc-200'} data-cal-task>{t.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="p-6">
          {harvest.length === 0 ? <div className="text-sm text-zinc-400">No harvests yet. Add fruit, nuts or vegetable beds and the harvest calendar fills in.</div> : (
            <div className="rounded-2xl border border-white/[0.07] overflow-hidden">
              <div className="grid grid-cols-[220px_repeat(12,1fr)] bg-zinc-950/60 text-[11px] text-zinc-400 font-semibold">
                <div className="px-4 py-2">Plant</div>
                {MONTHS.map((m, i) => <div key={m} className={`py-2 text-center ${i === now ? 'text-emerald-300' : ''}`}>{m}</div>)}
              </div>
              {harvest.map((h) => (
                <div key={h.sp.id} className="grid grid-cols-[220px_repeat(12,1fr)] border-t hairline items-center">
                  <div className="px-4 py-2 text-[13px] text-zinc-100 truncate">{h.sp.name} <span className="text-zinc-500 text-xs">x{h.n}</span></div>
                  {MONTHS.map((_, i) => <div key={i} className="h-7 px-0.5 py-1.5">{h.months.includes(i + 1) && <div className="h-full rounded-md" style={{ background: h.sp.fruit || '#f5b94a', opacity: 0.85 }} />}</div>)}
                </div>
              ))}
            </div>
          )}
          <p className="text-xs text-zinc-500 mt-3">Months follow your hemisphere. Young trees start bearing after their first-harvest age; the growth slider shows when.</p>
        </div>
      )}
    </Sheet>
  );
}

// ---------------------------------------------------------------- water budget

export function WaterBudget({ site, objects, features, units, onClose, onAddTank, use, onUse }: { site: Site; objects: SiteObject[]; features: Feature[]; units: Units; onClose: () => void; onAddTank: (litres: number) => void; use: WaterUseIn; onUse: (u: WaterUseIn) => void }) {
  const [mature, setMature] = useState(true);
  const b = useMemo(() => waterBudget(site, objects, features, mature ? 1 : 0.35, use), [site, objects, features, mature, use]);
  const imperial = units === 'imperial';
  const perPerson = use.litresPerPerson ?? 190;
  if (!b) return (
    <Sheet title="Water budget" icon={Droplets} onClose={onClose}><div className="p-8 text-sm text-zinc-400">The water budget needs a real address for rainfall and temperatures. Load your land from an address first.</div></Sheet>
  );
  const W = (l: number) => fmtWater(l, units);
  const max = Math.max(1, ...b.months.flatMap((m) => [m.roofL, m.needL]));
  const H = 180;
  const suggested = Math.ceil(Math.max(0, b.tankForDriestRunL - b.tankL) / 1000) * 1000;
  return (
    <Sheet title="Water budget" subtitle="Rain in, plants out, month by month. Evaporation by the FAO Hargreaves method from your temperatures." icon={Droplets} onClose={onClose}
      actions={<div className="w-64"><Segmented size="md" value={mature ? 'm' : 'y'} onChange={(v) => setMature(v === 'm')} options={[{ id: 'y', label: 'Young planting' }, { id: 'm', label: 'Fully grown' }]} /></div>}>
      <div className="p-6 space-y-5">
        <div className="rounded-2xl border border-white/[0.07] bg-zinc-950/40 p-4 grid sm:grid-cols-3 gap-3 items-end" data-water-use>
          <label className="block text-[13px]"><span className="block text-[11px] uppercase tracking-[0.08em] text-zinc-400 font-semibold mb-1">People drinking from it</span>
            <input type="number" min={0} value={use.people ?? 0} onChange={(e) => onUse({ ...use, people: Math.max(0, Number(e.target.value)) })} className="w-full bg-zinc-950/70 border border-white/10 rounded-lg px-2.5 py-1.5 text-zinc-100" data-water-people /></label>
          <label className="block text-[13px]"><span className="block text-[11px] uppercase tracking-[0.08em] text-zinc-400 font-semibold mb-1">{imperial ? 'Gallons' : 'Litres'} each a day indoors</span>
            <input type="number" min={0} value={Math.round(imperial ? perPerson * 0.264172 : perPerson)} onChange={(e) => onUse({ ...use, litresPerPerson: Math.max(0, Number(e.target.value)) / (imperial ? 0.264172 : 1) })} className="w-full bg-zinc-950/70 border border-white/10 rounded-lg px-2.5 py-1.5 text-zinc-100" /></label>
          <label className="block text-[13px]"><span className="block text-[11px] uppercase tracking-[0.08em] text-zinc-400 font-semibold mb-1">Water supply</span>
            <select value={use.supply || 'rain'} onChange={(e) => onUse({ ...use, supply: e.target.value as WaterUseIn['supply'] })} className="w-full bg-zinc-950/70 border border-white/10 rounded-lg px-2.5 py-1.5 text-zinc-100" data-water-supply>
              <option value="rain">Rain only, from the tanks</option><option value="well">A well tops up the tanks</option><option value="mains">Town mains tops up</option><option value="spring">A spring tops up</option><option value="creek">A creek tops up</option>
            </select></label>
          <p className="sm:col-span-3 text-[11px] text-zinc-500">Animals are counted from the paddocks and coops in the design. {use.people ? `${use.people} people at ${Math.round(imperial ? perPerson * 0.264172 : perPerson)} ${imperial ? 'gallons' : 'litres'} a day use ${W(b.yearHouseL)} a year.` : 'Add people to plan drinking, washing and cooking water.'}</p>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <Stat label="Rain a year" value={fmtRain(b.yearRain, units)} sub={`evaporation demand ${fmtRain(b.yearEt0, units)}`} />
          <Stat label="Roof catchment" value={W(b.yearRoofL)} sub={`${fmtArea(b.roofM2, units)} of roof`} />
          <Stat label="Water needed" value={W(b.yearNeedL)} sub={`plants ${W(b.yearNeedL - b.yearHouseL - b.yearAnimalsL)}, house ${W(b.yearHouseL)}, animals ${W(b.yearAnimalsL)}`} />
          <Stat label="Tanks" value={W(b.tankL)} sub={b.supply !== 'rain' ? (b.fromSupplyL > 1 ? `${W(b.fromSupplyL)} a year from the ${b.supply}` : 'covers the need') : b.yearShortL > 1 ? `${W(b.yearShortL)} short a year` : 'covers the need'} />
          <Stat label="Held in the land" value={W(b.pondL + b.swaleL)} sub="ponds and swales" />
        </div>
        <div className="rounded-2xl border border-white/[0.07] bg-zinc-950/40 p-5">
          <div className="flex gap-4 text-[11px] text-zinc-400 mb-3">
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-sky-400" />Roof water caught</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-amber-400" />Needed beyond rain (plants, house, animals)</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-red-400" />{b.supply === 'rain' ? 'Short (tank empty)' : `Drawn from the ${b.supply}`}</span>
          </div>
          <div className="flex items-end gap-2" style={{ height: H + 24 }}>
            {b.months.map((m) => (
              <div key={m.month} className="flex-1 flex flex-col items-center gap-1" title={`${MONTHS[m.month]}: rain ${fmtRain(m.rainMm, units)}, caught ${W(m.roofL)}, need ${W(m.needL)}${m.shortL > 1 ? `, short ${W(m.shortL)}` : ''}`}>
                <div className="w-full flex items-end gap-0.5" style={{ height: H }}>
                  <div className="flex-1 rounded-t-md bg-sky-400/80" style={{ height: `${(m.roofL / max) * 100}%` }} />
                  <div className="flex-1 rounded-t-md relative bg-amber-400/80" style={{ height: `${(m.needL / max) * 100}%` }}>
                    {m.shortL > 1 && <div className="absolute bottom-0 left-0 right-0 rounded-t-md bg-red-400" style={{ height: `${(m.shortL / Math.max(1, m.needL)) * 100}%` }} />}
                  </div>
                </div>
                <div className="text-[10px] text-zinc-400">{MONTHS[m.month]}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="grid lg:grid-cols-2 gap-3">
          <div className="rounded-2xl border border-white/[0.07] bg-zinc-950/40 p-5 space-y-2">
            <div className="font-display text-lg text-zinc-50">What this means</div>
            {b.canopyM2 < 1 && b.yearNeedL < 1 && <p className="text-sm text-zinc-300">Nothing planted yet and nobody drinking from it, so nothing to supply. Place plants or add people above.</p>}
            {b.supply !== 'rain' && b.yearNeedL >= 1 && <p className="text-sm text-zinc-300">{b.fromSupplyL > 1 ? `The tanks give what they can; about ${W(b.fromSupplyL)} a year comes from the ${b.supply}, most of it in the driest months. Bigger tanks cut that draw.` : `Roof water and the tanks cover everything; the ${b.supply} is the backup.`}</p>}
            {b.supply === 'rain' && b.yearNeedL >= 1 && (b.yearShortL < 1 ? <p className="text-sm text-emerald-200">Your tanks carry the planting through the year. Rain and roof water cover it.</p>
              : <p className="text-sm text-zinc-300">In the dry months the plants want {W(b.yearShortL)} more than the tanks can give. {b.roofCanCover ? `The roof does catch enough over the year; it is storage that runs out. A total of about ${W(b.tankForDriestRunL)} of tanks would carry the driest run.` : 'The roof alone cannot catch enough: add roof area (a shed or barn), swales to store water in the soil, mulch, and drought-tolerant plants.'}</p>)}
            <p className="text-xs text-zinc-500">Estimates: canopy at {mature ? 'full size' : 'about a third of full size'}, a crop factor for each plant's water need, 70% of rain on the planting counted as useful, 80% of roof rain caught, dormant plants drinking a quarter as much.</p>
          </div>
          <div className="rounded-2xl border border-white/[0.07] bg-zinc-950/40 p-5 space-y-3">
            <div className="font-display text-lg text-zinc-50">Next steps</div>
            {suggested > 0 && b.roofM2 > 0 && b.roofCanCover && <Btn kind="primary" className="w-full py-2.5 text-[13px]" onClick={() => onAddTank(Math.min(100000, suggested))}><Droplet size={14} /> Add a {W(Math.min(100000, suggested))} tank by the house</Btn>}
            {b.roofM2 === 0 && <p className="text-sm text-zinc-300">Place a house, barn or greenhouse: roofs are where tanks get their water.</p>}
            {b.roofM2 > 0 && !b.roofCanCover && b.yearShortL > 1 && <p className="text-sm text-amber-100">More tank will not fix this: the roofs catch {W(b.yearRoofL)} a year against a need of {W(b.yearNeedL)}. Store water in the land with swales and a pond, mulch heavily, and favour drought-tolerant plants.</p>}
            <ul className="text-sm text-zinc-300 space-y-1.5 list-disc pl-5">
              <li>Swales on contour store water in the soil where the trees can reach it.</li>
              <li>Mulch cuts evaporation from bare soil by about a third or more.</li>
              <li>Group thirsty plants near the house and tanks (zone 1), hardy ones further out.</li>
            </ul>
          </div>
        </div>
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------- design review

export function DesignReview({ input, onClose, onFix }: { input: ReviewInput; onClose: () => void; onFix: (f: FixId, ids?: string[]) => void }) {
  const r = useMemo(() => reviewDesign(input), [input]);
  const color = (v: number) => (v >= 75 ? '#8acf52' : v >= 45 ? '#f5b94a' : '#f87171');
  const verdict = r.overall >= 80 ? 'A strong, working design.' : r.overall >= 55 ? 'Good bones. A few moves will make it sing.' : r.overall >= 30 ? 'A start. Work through the suggestions in order.' : 'Just beginning. Start with water and zones.';
  return (
    <Sheet title="Design review" subtitle="Checked against the core permaculture principles: catch water, stack functions, zone by use, fit the climate, build soil" icon={ClipboardCheck} onClose={onClose}>
      <div className="p-6 space-y-5">
        <div className="flex items-center gap-5 rounded-2xl border border-white/[0.07] bg-zinc-950/40 p-5">
          <Ring value={r.overall} size={92} stroke={7} color={color(r.overall)} />
          <div className="flex-1">
            <div className="font-display text-2xl text-zinc-50">{verdict}</div>
            <div className="text-sm text-zinc-400 mt-1">The score updates as you design. Press a suggestion to act on it.</div>
          </div>
          <div className="hidden lg:flex gap-4">
            {r.areas.map((a) => <div key={a.id} className="flex flex-col items-center gap-1"><Ring value={a.score} size={48} stroke={4} color={color(a.score)} /><span className="text-[10px] text-zinc-400 w-16 text-center leading-tight">{a.name}</span></div>)}
          </div>
        </div>
        <div className="grid lg:grid-cols-2 gap-3">
          {r.areas.map((a) => (
            <div key={a.id} className="rounded-2xl border border-white/[0.07] bg-zinc-950/40 p-5" data-review-area={a.id}>
              <div className="flex items-center justify-between mb-3">
                <div className="font-display text-lg text-zinc-50">{a.name}</div>
                <div className="text-sm font-semibold tabular-nums" style={{ color: color(a.score) }}>{a.score}</div>
              </div>
              <div className="space-y-2">
                {a.findings.sort((x, y) => ({ warn: 0, tip: 1, good: 2 }[x.level] - { warn: 0, tip: 1, good: 2 }[y.level])).map((f, i) => (
                  <div key={i} className="flex items-start gap-2.5 text-[13px]">
                    {f.level === 'good' ? <CheckCircle2 size={15} className="text-emerald-400 mt-0.5 shrink-0" /> : f.level === 'warn' ? <AlertTriangle size={15} className="text-amber-400 mt-0.5 shrink-0" /> : <Lightbulb size={15} className="text-sky-300 mt-0.5 shrink-0" />}
                    <div className="flex-1">
                      <div className={f.level === 'good' ? 'text-zinc-400' : 'text-zinc-100'}>{localizeText(f.text, input.units || 'imperial')}</div>
                      {f.fix && <button data-fix={f.fix} onClick={() => onFix(f.fix!, f.ids)} className="mt-1 text-xs font-semibold text-emerald-300 hover:text-emerald-200 inline-flex items-center gap-1">{f.fixLabel || 'Fix it'} <ArrowRight size={12} /></button>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="text-xs text-zinc-500 flex items-center gap-1.5"><Sun size={12} /> Want a second opinion in words? Ask Permie, the AI designer, from the top bar.</p>
      </div>
    </Sheet>
  );
}
