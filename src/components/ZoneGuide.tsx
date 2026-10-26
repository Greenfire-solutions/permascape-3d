import React, { useEffect, useMemo, useState } from 'react';
import { X, Search, CheckCircle2, AlertTriangle, XCircle, Info, TreePine, Sprout, LayoutGrid, Loader2, Leaf, MapPin, CalendarDays, Thermometer } from 'lucide-react';
import type { Feature, Site } from '../lib/types';
import { LIBRARY, CATEGORY_NAMES, Category, Species } from '../lib/library';
import { advise, Advice, SiteClimate, ZoneConditions, rangesText, doyLabel, Range, jobsBetween } from '../lib/advisor';
import { ZONES } from '../lib/zoneInfo';
import { ZONE_COLORS, ZONE_NAMES } from '../lib/mapTexture';
import { fmtArea, fmtRain, fmtTemp, Units, localizeText } from '../lib/units';

export interface WildPlants { total: number; radiusKm: number; species: { key: number; records: number; latin: string; name: string | null; family: string | null }[]; source: string }

interface Props {
  zone: Feature;
  site: Site;
  sc: SiteClimate | null;
  zc: ZoneConditions | null;
  measuring: boolean;
  units: Units;
  viewDate: Date;
  wild: WildPlants | 'loading' | 'error' | null;
  onZone: (n: number) => void;
  onPlace: (sp: Species, mode: 'one' | 'fill' | 'bed', advice: Advice) => void;
  onClose: () => void;
  onSiteSettings: () => void;
}

const STATUS = {
  good: { label: 'Grows well here', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40', icon: CheckCircle2 },
  possible: { label: 'Possible with care', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/40', icon: AlertTriangle },
  no: { label: 'Not suited here', cls: 'bg-red-500/10 text-red-300 border-red-500/30', icon: XCircle },
};

const KIND_COLOR: Record<string, string> = { indoor: '#a78bfa', sow: '#34d399', transplant: '#22c55e', plant: '#34d399', harvest: '#f59e0b', note: '#64748b' };
const MONTH_START = [1, 32, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335];

function Strip({ a, today }: { a: Advice; today: number }) {
  const rows = a.calendar.filter((l) => l.ranges.length);
  if (!rows.length) return null;
  const seg = (r: Range) => (r.start <= r.end ? [[r.start, r.end]] : [[r.start, 365], [1, r.end]]);
  return (
    <svg viewBox={`0 0 365 ${rows.length * 7 + 9}`} className="w-full h-auto" preserveAspectRatio="none" role="img" aria-label="Planting calendar">
      {MONTH_START.map((m, i) => <g key={i}><line x1={m} x2={m} y1={0} y2={rows.length * 7} stroke="#27272a" strokeWidth={0.6} /><text x={m + 15} y={rows.length * 7 + 7} fontSize={5.5} fill="#71717a" textAnchor="middle">{'JFMAMJJASOND'[i]}</text></g>)}
      {rows.map((l, i) => l.ranges.flatMap(seg).map(([s, e], k) => <rect key={`${i}-${k}`} x={s} y={i * 7 + 1} width={Math.max(2, e - s + 1)} height={5} rx={1.5} fill={KIND_COLOR[l.kind]} opacity={0.9}><title>{`${l.label}: ${doyLabel(s)} to ${doyLabel(e)}`}</title></rect>))}
      <line x1={today} x2={today} y1={0} y2={rows.length * 7} stroke="#f43f5e" strokeWidth={1.2} />
    </svg>
  );
}

function Card({ a, today, onPlace, pz, units }: { a: Advice; today: number; onPlace: Props['onPlace']; pz: number; units: Units }) {
  const T = (t: string) => localizeText(t, units);
  const [open, setOpen] = useState(false);
  const sp = a.species;
  const S = STATUS[a.status];
  const annual = sp.life === 'annual';
  return (
    <div className={`border rounded-lg p-3 bg-zinc-900/50 ${a.status === 'no' ? 'border-zinc-800 opacity-75' : 'border-zinc-800 hover:border-zinc-700'}`}>
      <div className="flex items-start gap-2">
        <span className="w-3 h-3 rounded-full mt-1 shrink-0" style={{ background: sp.fruit || sp.flower || sp.leaf }} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-zinc-100 font-medium">{sp.name}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded border flex items-center gap-1 ${S.cls}`}><S.icon size={11} />{S.label}</span>
          </div>
          <div className="text-[11px] text-zinc-500 italic">{sp.latin}</div>
        </div>
      </div>
      {a.status !== 'no' && (
        <div className="mt-2 space-y-1">
          <Strip a={a} today={today} />
          {a.calendar.filter((l) => l.kind !== 'note').map((l, i) => (
            <div key={i} className="text-xs text-zinc-300"><span className="inline-block w-2 h-2 rounded-sm mr-1.5" style={{ background: KIND_COLOR[l.kind] }} /><b className="font-medium">{l.label}:</b> {rangesText(l.ranges)}{l.text ? <span className="text-zinc-500">. {T(l.text)}</span> : null}</div>
          ))}
        </div>
      )}
      <div className="mt-2 space-y-0.5">
        {a.issues.filter((i) => i.level === 'fail').map((i, k) => <div key={k} className="text-xs text-red-300 flex gap-1"><XCircle size={12} className="mt-0.5 shrink-0" />{T(i.text)}</div>)}
        {a.issues.filter((i) => i.level === 'warn').map((i, k) => <div key={k} className="text-xs text-amber-300 flex gap-1"><AlertTriangle size={12} className="mt-0.5 shrink-0" />{T(i.text)}</div>)}
        {a.variety && a.status !== 'no' && <div className="text-xs text-emerald-300 flex gap-1"><Leaf size={12} className="mt-0.5 shrink-0" />{T(a.variety)}</div>}
      </div>
      {open && (
        <div className="mt-2 space-y-0.5 text-xs">
          {a.good.map((g, k) => <div key={k} className="text-zinc-400 flex gap-1"><CheckCircle2 size={12} className="mt-0.5 shrink-0 text-emerald-500" />{T(g)}</div>)}
          {a.issues.filter((i) => i.level === 'info').map((i, k) => <div key={k} className="text-zinc-400 flex gap-1"><Info size={12} className="mt-0.5 shrink-0 text-sky-400" />{T(i.text)}</div>)}
          {sp.notes && <div className="text-zinc-400">{T(sp.notes)}</div>}
          <div className="text-zinc-500">{sp.functions.join(' · ')}</div>
          <div className="text-zinc-500">{T(`Mature size ${sp.heightM} m tall, ${sp.spreadM} m wide`)} · water {sp.water} · sun {sp.sun}{sp.ph ? ` · pH ${sp.ph[0]} to ${sp.ph[1]}` : ''}</div>
        </div>
      )}
      <div className="mt-2 flex items-center gap-2 flex-wrap">
        <span className="text-[11px] text-zinc-500">{T(`${a.spacing}${a.fits ? (annual ? ` · about ${a.fits.toLocaleString()} per 1.2 x 4 m bed` : ` · room for about ${a.fits.toLocaleString()} in this zone`) : ''}`)}</span>
        <button onClick={() => setOpen(!open)} className="text-[11px] text-zinc-400 hover:text-zinc-200 ml-auto">{open ? 'Less' : 'Why and how'}</button>
        {a.status !== 'no' && pz > 0 && (annual ? (
          <button onClick={() => onPlace(sp, 'bed', a)} className="text-[11px] px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white flex items-center gap-1"><LayoutGrid size={12} /> Add a bed</button>
        ) : (
          <>
            <button onClick={() => onPlace(sp, 'one', a)} className="text-[11px] px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 flex items-center gap-1"><TreePine size={12} /> Place</button>
            <button onClick={() => onPlace(sp, 'fill', a)} className="text-[11px] px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white flex items-center gap-1"><Sprout size={12} /> Fill zone</button>
          </>
        ))}
      </div>
    </div>
  );
}

export default function ZoneGuide({ zone, site, sc, zc, measuring, units, viewDate, wild, onZone, onPlace, onClose, onSiteSettings }: Props) {
  const n = zone.zone ?? 1;
  const info = ZONES[n];
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<Category | 'all'>('all');
  const [showNo, setShowNo] = useState(false);
  const [thisMonth, setThisMonth] = useState(false);
  useEffect(() => { setCat('all'); }, [n]);

  const advice = useMemo(() => {
    if (!sc || n === 5) return [] as Advice[];
    return LIBRARY.filter((p) => p.pz.includes(n)).map((p) => advise(p, sc, zc, n, site.soil));
  }, [sc, zc, n, site.soil]);

  const today = Math.floor((Date.UTC(2023, viewDate.getMonth(), viewDate.getDate()) - Date.UTC(2023, 0, 1)) / 86400000) + 1;
  const monthStart = MONTH_START[viewDate.getMonth()], monthEnd = viewDate.getMonth() === 11 ? 365 : MONTH_START[viewDate.getMonth() + 1] - 1;
  const order = [...info.categories, ...Object.keys(CATEGORY_NAMES).filter((c) => !info.categories.includes(c))] as Category[];
  const cats = order.filter((c) => advice.some((a) => a.species.category === c));
  const rank = { good: 0, possible: 1, no: 2 };
  const shown = advice
    .filter((a) => showNo || a.status !== 'no')
    .filter((a) => cat === 'all' || a.species.category === cat)
    .filter((a) => !q || `${a.species.name} ${a.species.latin} ${a.species.functions.join(' ')}`.toLowerCase().includes(q.toLowerCase()))
    .filter((a) => !thisMonth || jobsBetween(a.calendar.filter((l) => l.kind !== 'harvest'), monthStart, monthEnd).length > 0)
    .sort((a, b) => rank[a.status] - rank[b.status] || order.indexOf(a.species.category) - order.indexOf(b.species.category) || a.species.name.localeCompare(b.species.name));
  const counts = { good: advice.filter((a) => a.status === 'good').length, possible: advice.filter((a) => a.status === 'possible').length, no: advice.filter((a) => a.status === 'no').length };
  const monthName = viewDate.toLocaleDateString('en-US', { month: 'long' });

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-3 no-print" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-zinc-950 border border-zinc-800 rounded-xl shadow-2xl w-full max-w-6xl h-[94vh] flex flex-col" data-zone-guide>
        {/* header */}
        <div className="px-5 py-3 border-b border-zinc-800 flex items-center gap-3">
          <span className="w-4 h-4 rounded" style={{ background: ZONE_COLORS[n] }} />
          <select value={n} onChange={(e) => onZone(Number(e.target.value))} className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-zinc-100 font-semibold" title="Change which permaculture zone this is">
            {ZONES.map((z) => <option key={z.n} value={z.n}>{z.name}</option>)}
          </select>
          <span className="text-xs text-zinc-500">{zone.name !== ZONE_NAMES[n] && zone.name !== info.name ? `${zone.name} · ` : ''}visited {info.visits.toLowerCase()}{zc ? ` · ${fmtArea(zc.area, units)}` : ''}</span>
          <button onClick={onClose} className="ml-auto text-zinc-500 hover:text-zinc-200" title="Close"><X size={20} /></button>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* left: the place */}
          <aside className="w-80 border-r border-zinc-800 overflow-y-auto scroll-thin p-4 space-y-4 text-sm">
            <div>
              <div className="text-zinc-200">{info.purpose}</div>
              <ul className="mt-2 space-y-0.5 text-xs text-zinc-400 list-disc pl-4">{info.belongs.map((b) => <li key={b}>{b}</li>)}</ul>
            </div>
            {sc ? (
              <div className="space-y-1.5">
                <div className="text-[11px] uppercase tracking-wider text-zinc-500 flex items-center gap-1"><Thermometer size={12} /> Your climate</div>
                <Row k="Hardiness zone" v={<>{sc.zoneLabel}{zc && zc.zoneShift ? <span className="text-emerald-400" title="The ground in this zone runs warmer or colder than the area's climate, from its slope, aspect and height"> ({Math.abs(zc.zoneShift) >= 1 ? `${Math.abs(zc.zoneShift)} zone${Math.abs(zc.zoneShift) > 1 ? 's' : ''}` : 'half a zone'} {zc.zoneShift > 0 ? 'warmer' : 'colder'} here)</span> : null}</>} sub={sc.zoneSource} />
                <Row k="Frost" v={sc.frostFree ? 'Frost free' : `last ${doyLabel(sc.lastMean!)}, first ${doyLabel(sc.firstMean!)}`} sub={sc.frostFree ? '' : `safe dates (9 years in 10): after ${doyLabel(sc.lastSafe!)}, before ${doyLabel(sc.firstSafe!)}. About ${(sc.firstMean! - sc.lastMean! + 365) % 365} frost-free days in an average year, ${sc.frostFreeDays} in 9 years out of 10.`} />
                <Row k="Winter chill" v={sc.chill != null ? `${sc.chill.toLocaleString()} hours` : 'unknown'} sub={localizeText('hours between 0 and 7 C; fruit trees need enough to flower', units)} />
                <Row k="Summer heat" v={`${fmtTemp(sc.hottestMaxC, units)} hottest-month highs`} sub={sc.gdd != null ? `${sc.gdd.toLocaleString()} growing degree days` : ''} />
                <Row k="Rain" v={`${fmtRain(sc.annualPrecipMm, units)} a year`} sub={sc.wetSeason?.allYear ? 'spread through the year' : sc.wetSeason?.startMonth ? `rainy season from ${new Date(2023, sc.wetSeason.startMonth - 1).toLocaleDateString('en-US', { month: 'long' })}` : 'no reliable rainy season'} />
                {sc.koppen && <Row k="Climate type" v={sc.koppen.name} sub={`Koppen ${sc.koppen.code}${sc.humid ? ', humid summers' : ''}${sc.arid ? ', dry' : ''}`} />}
                <button onClick={onSiteSettings} className="text-xs text-emerald-400 hover:underline">Know your real zone or frost dates? Set them</button>
              </div>
            ) : <div className="text-xs text-amber-300">{site.lat == null ? 'This is a flat sandbox. Load a real address to get a guide for the place.' : 'Loading your climate...'}</div>}
            <div className="space-y-1.5">
              <div className="text-[11px] uppercase tracking-wider text-zinc-500 flex items-center gap-1"><MapPin size={12} /> This zone{measuring && <Loader2 size={11} className="animate-spin text-emerald-400" />}</div>
              {zc ? (
                <>
                  <Row k="Slope" v={`${zc.meanSlope.toFixed(1)}%, faces ${zc.aspectName}`} />
                  <Row k="Direct sun" v={zc.sunHours != null ? `${zc.sunHours.toFixed(1)} hours a day` : measuring ? 'measuring...' : 'not measured'} sub="growing-season average, with shade from land, trees and buildings" />
                  <Row k="Drainage lines" v={`${Math.round(zc.wetFraction * 100)}% of the zone`} />
                  {site.soil?.available && <Row k="Soil" v={site.soil.topsoilTexture || site.soil.mapUnit} sub={`${site.soil.drainage || ''}${site.soil.pH != null ? `, pH ${site.soil.pH}` : ''}`} />}
                  {zc.notes.map((t, i) => <div key={i} className="text-xs text-zinc-300 bg-zinc-900 border border-zinc-800 rounded p-2">{localizeText(t, units)}</div>)}
                </>
              ) : <div className="text-xs text-zinc-500">Measuring the ground...</div>}
            </div>
            {sc && <div className="text-[10px] text-zinc-600">{localizeText(sc.notes.join(' '), units)}</div>}
          </aside>

          {/* right: the plants */}
          <main className="flex-1 flex flex-col overflow-hidden">
            {n === 5 ? (
              <div className="p-5 overflow-y-auto scroll-thin">
                <div className="text-zinc-300 mb-3">Zone 5 is not planted. Leave it wild, watch it through the seasons, and protect what already grows. These are the plants recorded growing near you:</div>
                <WildList wild={wild} />
              </div>
            ) : (
              <>
                <div className="px-4 py-3 border-b border-zinc-800 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="relative">
                      <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-500" />
                      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search: nitrogen, shade, apple..." className="bg-zinc-900 border border-zinc-700 rounded pl-7 pr-2 py-1 text-sm text-zinc-200 w-64 focus:outline-none focus:border-emerald-500" />
                    </div>
                    <button onClick={() => setThisMonth(!thisMonth)} className={`text-xs px-2 py-1 rounded border flex items-center gap-1 ${thisMonth ? 'border-emerald-500 bg-emerald-500/15 text-emerald-300' : 'border-zinc-700 text-zinc-400'}`}><CalendarDays size={12} /> Plant in {monthName}</button>
                    <label className="text-xs text-zinc-400 flex items-center gap-1 cursor-pointer"><input type="checkbox" checked={showNo} onChange={(e) => setShowNo(e.target.checked)} className="accent-emerald-500" /> Show what will not grow here ({counts.no})</label>
                    <span className="ml-auto text-xs text-zinc-500"><span className="text-emerald-400">{counts.good} grow well</span> · <span className="text-amber-400">{counts.possible} possible</span></span>
                  </div>
                  <div className="flex gap-1 flex-wrap">
                    <Chip on={cat === 'all'} onClick={() => setCat('all')}>All</Chip>
                    {cats.map((c) => <Chip key={c} on={cat === c} onClick={() => setCat(c)}>{CATEGORY_NAMES[c]} <span className="text-zinc-500">{advice.filter((a) => a.species.category === c && a.status !== 'no').length}</span></Chip>)}
                  </div>
                  <div className="flex gap-3 text-[10px] text-zinc-500">
                    {[['indoor', 'Start indoors'], ['sow', 'Sow or plant'], ['harvest', 'Harvest']].map(([k, l]) => <span key={k} className="flex items-center gap-1"><span className="w-2.5 h-2 rounded-sm" style={{ background: KIND_COLOR[k] }} />{l}</span>)}
                    <span className="flex items-center gap-1"><span className="w-0.5 h-2.5 bg-rose-500" />today on the timeline</span>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto scroll-thin p-4">
                  {!sc ? <div className="text-zinc-500 text-sm">The guide needs the site's climate. {site.lat == null ? 'Load a real address first.' : 'Loading...'}</div> : shown.length === 0 ? (
                    <div className="text-zinc-500 text-sm">Nothing matches. {thisMonth ? `Nothing in this zone is planted in ${monthName}; turn off the month filter.` : ''}</div>
                  ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">{shown.map((a) => <Card key={a.species.id} a={a} today={today} onPlace={onPlace} pz={n} units={units} />)}</div>
                  )}
                  {n === 4 && <div className="mt-6"><div className="text-sm text-zinc-300 mb-2">Already growing wild near you, worth encouraging in zone 4:</div><WildList wild={wild} /></div>}
                </div>
              </>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

const Row = ({ k, v, sub }: { k: string; v: React.ReactNode; sub?: string }) => (
  <div><div className="flex justify-between gap-2 text-xs"><span className="text-zinc-500">{k}</span><span className="text-zinc-200 text-right">{v}</span></div>{sub ? <div className="text-[10px] text-zinc-600 text-right">{sub}</div> : null}</div>
);
const Chip = ({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) => (
  <button onClick={onClick} className={`text-xs px-2 py-1 rounded-full border ${on ? 'border-emerald-500 bg-emerald-500/15 text-emerald-300' : 'border-zinc-800 text-zinc-400 hover:bg-zinc-900'}`}>{children}</button>
);

function WildList({ wild }: { wild: Props['wild'] }) {
  if (wild === 'loading' || wild === null) return <div className="text-sm text-zinc-500 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Looking up wild plant records near you...</div>;
  if (wild === 'error') return <div className="text-sm text-zinc-500">Wild plant records are not available right now.</div>;
  if (!wild.species.length) return <div className="text-sm text-zinc-500">No wild plant records within {wild.radiusKm} km.</div>;
  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-1.5">
        {wild.species.map((s) => (
          <a key={s.key} href={`https://www.gbif.org/species/${s.key}`} target="_blank" rel="noreferrer" className="border border-zinc-800 rounded px-2 py-1.5 hover:border-emerald-700 bg-zinc-900/40">
            <div className="text-sm text-zinc-200 truncate">{s.name || s.latin}</div>
            <div className="text-[11px] text-zinc-500 truncate"><i>{s.latin}</i>{s.family ? ` · ${s.family}` : ''} · {s.records.toLocaleString()} records</div>
          </a>
        ))}
      </div>
      <div className="text-[10px] text-zinc-600 mt-2">{wild.source}, within {wild.radiusKm} km, most recorded first. Records include garden escapes and weeds, so check a plant is native to your region before encouraging it.</div>
    </div>
  );
}
