import React, { useMemo, useRef, useState } from 'react';
import { Printer, X, Globe, Sparkles, Loader2 } from 'lucide-react';
import type { Feature, SiteObject, Site, Brief } from '../lib/types';
import { SPECIES_BY_ID, LAYER_NAMES } from '../lib/plants';
import { SLOPE_CLASSES, COMPASS, polygonArea, polylineLength } from '../lib/terrain';
import { ZONE_NAMES } from '../lib/mapTexture';
import { designSummary } from '../lib/summary';
import { fmtLen, fmtArea, fmtWater, fmtRain, fmtTemp, fmtVol, Units, localizeText } from '../lib/units';
import { typeName } from './Panels';
import { advise, rangesText, SiteClimate, doyLabel } from '../lib/advisor';
import { pointInPolygon } from '../lib/terrain';
import { waterBudget, reviewDesign, ANIMALS, bearing, effectiveZone, WaterUseIn } from '../lib/permaculture';
import { estimate } from '../lib/estimate';
import { streamLines, floodOnSite, layerStatus } from '../lib/checks';

const FOOTWAYS = ['footway', 'path', 'pedestrian', 'steps', 'cycleway', 'bridleway', 'corridor'];
const list = (xs: string[]) => (xs.length <= 2 ? xs.join(' and ') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
import type { Profile } from '../lib/api';

interface Props {
  name: string; site: Site; objects: SiteObject[]; features: Feature[]; stats: any; units: Units; image: string; plan: string; onClose: () => void; sc?: SiteClimate | null;
  brief?: Brief; goals?: string[]; prices?: Record<string, number>; water?: WaterUseIn; profile?: Profile; proposal?: string;
  onProposal: (text: string) => void; onDraft?: () => Promise<void>; slopeAt?: (x: number, y: number) => number; wetAt?: (x: number, y: number) => boolean;
}

const money = (v: number) => `$${Math.round(v).toLocaleString()}`;

export default function Report({ name, site, objects, features, stats, units, image, plan, onClose, sc, brief = {}, goals = [], prices = {}, water = {}, profile = {}, proposal = '', onProposal, onDraft, slopeAt, wetAt }: Props) {
  const d = useMemo(() => designSummary(site, objects, features), [site, objects, features]);
  const c = site.climate, s = site.soil, ref = site.surroundings;
  const flood = floodOnSite(site);
  const plants = objects.filter((o) => o.type === 'plant');
  const others = objects.filter((o) => o.type !== 'plant');
  const zone = effectiveZone(site);
  const maxP = c ? Math.max(1, ...c.monthlyPrecipMm) : 1;
  const use = { ...water, people: water.people ?? brief.people, supply: water.supply ?? brief.water };
  const wb = useMemo(() => waterBudget(site, objects, features, 1, use), [site, objects, features, use.people, use.supply, use.litresPerPerson]);
  const review = useMemo(() => reviewDesign({ site, objects, features, zone: zone ?? null, meanSlope: stats.meanSlope, cutM3: stats.cutM3, fillM3: stats.fillM3, roofCatchL: d.roofCatchL, units, slopeAt, wetAt }), [site, objects, features, stats, d]);
  const est = useMemo(() => estimate(objects, features, prices, stats.cutM3, stats.fillM3), [objects, features, prices, stats]);
  const root = useRef<HTMLDivElement>(null);
  const [drafting, setDrafting] = useState(false);
  const [draftErr, setDraftErr] = useState<string | null>(null);
  const H = ({ children }: { children: React.ReactNode }) => <h2 className="text-lg font-semibold text-zinc-900 border-b border-zinc-300 pb-1 mt-7 mb-2 break-after-avoid">{children}</h2>;
  const Row = ({ k, v }: { k: string; v: React.ReactNode }) => <tr><td className="py-0.5 pr-4 text-zinc-500 align-top whitespace-nowrap">{k}</td><td className="py-0.5 text-zinc-900">{v}</td></tr>;
  const T = (t: string) => localizeText(t, units);

  /** The report as one self-contained web page the client can open anywhere. */
  const savePage = async () => {
    const el = root.current;
    if (!el) return;
    let css = '';
    for (const sheet of Array.from(document.styleSheets)) { try { css += Array.from(sheet.cssRules).map((r) => r.cssText).join('\n'); } catch { /* another origin's sheet */ } }
    const clone = el.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('.no-print').forEach((n) => n.remove());
    clone.querySelectorAll('textarea').forEach((t) => { const div = document.createElement('div'); div.className = 'whitespace-pre-wrap text-[15px] leading-relaxed text-zinc-800'; div.textContent = (t as HTMLTextAreaElement).value; t.replaceWith(div); });
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${name}</title><style>${css}\nbody{background:#f4f2ec;margin:0;padding:24px 12px}.report-page{max-width:900px;margin:0 auto}</style></head><body><div class="report-page">${clone.outerHTML}</div></body></html>`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    a.download = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-design.html`;
    a.click();
  };

  const groupedPlants = useMemo(() => {
    const by = new Map<string, { sp: any; n: number; cost: number; planted: string; phase: number; existing: boolean }>();
    for (const p of plants) {
      const sp = SPECIES_BY_ID[p.species || ''];
      if (!sp) continue;
      const key = `${sp.id}|${p.status === 'existing' ? 'e' : p.phase ?? 1}|${p.planted || ''}`;
      const g = by.get(key) || { sp, n: 0, cost: 0, planted: p.planted || '', phase: p.phase ?? 1, existing: p.status === 'existing' };
      g.n++; g.cost += p.cost ?? sp.costUSD; by.set(key, g);
    }
    return [...by.values()].sort((a, b) => Number(a.existing) - Number(b.existing) || a.phase - b.phase || b.n - a.n);
  }, [plants]);

  const briefRows: [string, string | undefined][] = [
    ['Client', brief.client], ['Contact', brief.contact], ['People', brief.people != null ? String(brief.people) : undefined], ['Time for the land', brief.hoursPerWeek ? `${brief.hoursPerWeek} hours a week` : undefined],
    ['Budget', brief.budget ? `${money(brief.budget)}${brief.years ? ` over ${brief.years} years` : ''}` : undefined], ['Water today', brief.water], ['Goals', goals.join(', ') || undefined],
    ['What they want', brief.wants], ['Animals', brief.animals], ['Keep', brief.keep], ['Problems now', brief.problems], ['Access needs', brief.access],
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/70 overflow-y-auto report-root">
      <div ref={root} className="max-w-4xl mx-auto my-6 bg-white text-zinc-800 rounded-lg shadow-2xl p-10 print:m-0 print:shadow-none print:rounded-none" data-report>
        <div className="flex justify-between items-start no-print mb-4 gap-3">
          <div className="text-xs text-zinc-500">Prints cleanly, saves as a PDF from the print dialog, or saves as one web page to email the client.</div>
          <div className="flex gap-2 shrink-0">
            <button onClick={savePage} className="flex items-center gap-1 px-3 py-1.5 rounded bg-zinc-800 text-white text-sm" data-save-page><Globe size={14} /> Client web page</button>
            <button onClick={() => window.print()} className="flex items-center gap-1 px-3 py-1.5 rounded bg-emerald-600 text-white text-sm"><Printer size={14} /> Print or PDF</button>
            <button onClick={onClose} className="flex items-center gap-1 px-3 py-1.5 rounded bg-zinc-200 text-zinc-800 text-sm"><X size={14} /> Close</button>
          </div>
        </div>

        {(profile.business || profile.designer) && <div className="text-xs font-bold tracking-[0.18em] uppercase text-emerald-700">{profile.business || profile.designer}</div>}
        <h1 className="text-3xl font-bold text-zinc-900 mt-1">{name}</h1>
        <div className="text-sm text-zinc-500">{site.address || 'Sandbox site'}{site.lat != null && ` · ${site.lat.toFixed(5)}, ${site.lon!.toFixed(5)}`} · {new Date().toLocaleDateString()}</div>
        {(brief.client || profile.designer) && <div className="text-sm text-zinc-700 mt-1">{brief.client ? `Prepared for ${brief.client}` : ''}{brief.client && profile.designer ? ' · ' : ''}{profile.designer ? `Designed by ${profile.designer}${profile.contact ? `, ${profile.contact}` : ''}` : ''}</div>}

        <div className="mt-5" data-proposal>
          <div className="flex items-center justify-between no-print mb-1">
            <div className="text-xs uppercase tracking-wider text-zinc-500 font-semibold">Cover letter</div>
            {onDraft && <button disabled={drafting} onClick={async () => { setDrafting(true); setDraftErr(null); try { await onDraft(); } catch (e: any) { setDraftErr(e.message); } setDrafting(false); }} className="flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs" data-draft>
              {drafting ? <><Loader2 size={12} className="animate-spin" /> Permie is writing it</> : <><Sparkles size={12} /> {proposal ? 'Redraft with Permie' : 'Draft it with Permie'}</>}
            </button>}
          </div>
          {draftErr && <div className="text-xs text-red-700 no-print mb-1">{draftErr}</div>}
          <textarea value={proposal} onChange={(e) => onProposal(e.target.value)} rows={proposal ? Math.min(28, proposal.split('\n').length + 3) : 3} placeholder="A letter to the client: what you heard, what the land says, the big moves and the plan by year. Write it here or let Permie draft it from the brief and the design." className="w-full text-[15px] leading-relaxed text-zinc-800 border border-zinc-200 rounded p-3 print:border-0 print:p-0 resize-y" />
        </div>

        {plan && <img src={plan} alt="Plan of the design, north up, to scale" className="w-full mt-5 border border-zinc-200" />}
        {image && <img src={image} alt="3D view of the design" className="w-full rounded mt-4 border border-zinc-200 break-inside-avoid" />}

        {briefRows.some(([, v]) => v) && (<>
          <H>The brief</H>
          <table className="text-sm"><tbody>{briefRows.filter(([, v]) => v).map(([k, v]) => <Row key={k} k={k} v={v} />)}</tbody></table>
        </>)}

        <H>The land</H>
        <table className="text-sm"><tbody>
          <Row k="Area" v={`${fmtArea(d.area, units)} (${fmtLen(site.size, units, 0)} square)${features.some((f) => f.kind === 'boundary') ? `, ${fmtArea(polygonArea(features.find((f) => f.kind === 'boundary')!.points), units)} inside the property line` : ''}`} />
          <Row k="Elevation" v={`${fmtLen(site.base + stats.min, units, 0)} to ${fmtLen(site.base + stats.max, units, 0)} above sea level, ${fmtLen(stats.relief, units)} of relief`} />
          <Row k="Slope" v={`mean ${stats.meanSlope.toFixed(1)}%, steepest 1% of the land ${stats.steepest.toFixed(0)}%`} />
          <Row k="Terrain data" v={`${site.source}${site.sourceResM ? `, ${site.sourceResM} m cells` : ''}`} />
        </tbody></table>
        <div className="grid grid-cols-2 gap-6 mt-3 text-sm">
          <table><tbody>
            {SLOPE_CLASSES.map((k, i) => <tr key={i}><td className="pr-2"><span className="inline-block w-3 h-3 rounded-sm" style={{ background: k.color }} /></td><td className="pr-4">{k.label}</td><td className="font-mono pr-4">{Math.round(stats.classes[i] * 100)}%</td><td className="text-zinc-500 text-xs">{k.use}</td></tr>)}
          </tbody></table>
          <div>
            <div className="text-zinc-500 mb-1">Facing</div>
            <div className="grid grid-cols-4 gap-1">{COMPASS.map((dd, i) => <div key={dd} className="border border-zinc-200 rounded px-1 text-center">{dd} {Math.round(stats.aspects[i] * 100)}%</div>)}</div>
            <div className="text-zinc-500 text-xs mt-1">Flat ground: {Math.round(stats.flat * 100)}%</div>
          </div>
        </div>

        {ref && (<>
          <H>What the public maps show</H>
          <table className="text-sm"><tbody>
            <Row k="Flood" v={!flood ? 'The FEMA flood map could not be loaded, so flooding was not checked.' : flood.onLabels.length ? `${flood.onLabels.join('; ')}. ${fmtArea(flood.areaM2, units)} of the site is in the mapped 1% a year flood area.` : `No part of the site is in a mapped 1% a year flood area.${flood.nearNames.length ? ` ${list(flood.nearNames)} ${flood.nearNames.length > 1 ? 'are' : 'is'} mapped just beyond the edge of the site.` : ''}`} />
            <Row k="Wetlands" v={(ref.wetlands || []).length ? (ref.wetlands || []).map((w) => `${w.type} (${w.code})`).join('; ') : ref.wetlands && !ref.errors?.wetlands ? 'None mapped.' : 'The wetlands map could not be loaded, so wetlands were not checked.'} />
            <Row k="Streams" v={streamLines(site).length ? streamLines(site).map((x) => `${x.name}, ${fmtLen(polylineLength(x.line), units, 0)} on the site`).join('; ') : layerStatus(site).find((l) => l.key === 'streams')?.loaded ? 'None mapped on the site.' : 'The stream map could not be loaded, so streams were not checked.'} />
            <Row k="Roads and buildings" v={ref.osm && !ref.errors?.osm ? `${(ref.osm.roads || []).filter((r) => !FOOTWAYS.includes(r.kind)).length} road or driveway segments, ${(ref.osm.roads || []).filter((r) => FOOTWAYS.includes(r.kind)).length} footpath segments, ${(ref.osm.buildings || []).length} mapped buildings, ${(ref.osm.areas || []).filter((a) => a.kind === 'parking').length} parking lots, ${(ref.osm.areas || []).some((a) => a.kind === 'woodland') ? `${fmtArea((ref.osm.areas || []).filter((a) => a.kind === 'woodland').reduce((t, a) => t + polygonArea(a.ring), 0), units)} of mapped woodland` : 'no mapped woodland'}` : 'The OpenStreetMap layer could not be loaded, so roads, paths, parking and buildings were not checked.'} />
            {(ref.soils == null || ref.errors?.soils) && <Row k="Soil map" v="The soil map could not be loaded, so soils were not checked." />}
          </tbody></table>
          {(ref.soils || []).length > 0 && (
            <table className="w-full text-xs mt-3"><thead><tr className="text-left text-zinc-500 border-b border-zinc-200"><th className="py-1">Soil map unit</th><th>Share</th><th>Drainage</th><th>Floods</th><th>Runoff group</th><th>pH</th></tr></thead>
              <tbody>{(ref.soils || []).map((u) => <tr key={u.mukey} className="border-b border-zinc-100"><td className="py-0.5 pr-2">{u.name}</td><td>{Math.round(u.share * 100)}%</td><td>{u.drainage}</td><td>{u.flooding || ''}</td><td>{u.hydgrp}</td><td>{u.pH ?? ''}</td></tr>)}</tbody></table>
          )}
        </>)}

        {c && (<>
          <H>Climate</H>
          <table className="text-sm"><tbody>
            <Row k="Hardiness zone" v={`${sc?.zoneLabel ?? c.zone?.label ?? '?'} (average coldest night ${c.meanAnnualMinC != null ? fmtTemp(c.meanAnnualMinC, units) : '?'})`} />
            <Row k="Rainfall" v={`${fmtRain(c.annualPrecipMm, units)} a year`} />
            <Row k="Frost" v={sc ? (sc.frostFree ? 'Frost free' : `last in spring around ${doyLabel(sc.lastMean!)}, first in fall around ${doyLabel(sc.firstMean!)}: about ${sc.frostFreeAvgDays} frost-free days in an average year, ${sc.frostFreeDays} in 9 years out of 10 (safe to plant out after ${doyLabel(sc.lastSafe!)})`) : c.frostFree ? 'Frost free' : `last in spring around ${c.lastSpringFrost}, first in fall around ${c.firstFallFrost}`} />
            {sc?.chill != null && <Row k="Winter chill" v={`${sc.chill.toLocaleString()} hours ${units === 'imperial' ? 'at 32 to 45°F' : 'at 0 to 7°C'}`} />}
            <Row k="Source" v={`${c.source}, ${c.period}`} />
          </tbody></table>
          <div className="flex items-end gap-1 h-20 mt-2">{c.monthlyPrecipMm.map((v, i) => <div key={i} className="flex-1 flex flex-col items-center justify-end h-full"><div className="w-full bg-blue-500 rounded-t" style={{ height: `${(v / maxP) * 100}%` }} /><div className="text-[10px] text-zinc-500">{'JFMAMJJASOND'[i]}</div></div>)}</div>
        </>)}

        {s?.available && !ref?.soils?.length && (<>
          <H>Soil</H>
          <table className="text-sm"><tbody>
            <Row k="Map unit" v={s.mapUnit} />
            <Row k="Texture" v={s.topsoilTexture || 'unknown'} />
            <Row k="Drainage" v={s.drainage || 'unknown'} />
            <Row k="Runoff group" v={s.hydrologicGroup || 'unknown'} />
            {s.pH != null && <Row k="pH" v={s.pH} />}
            {s.organicMatterPct != null && <Row k="Organic matter" v={`${s.organicMatterPct}%`} />}
            <Row k="Source" v={s.source} />
          </tbody></table>
        </>)}

        <H>Water</H>
        <table className="text-sm"><tbody>
          <Row k="Rain falling on the site" v={d.rainOnSiteL != null ? `${fmtWater(d.rainOnSiteL, units)} a year` : 'needs a real address'} />
          <Row k="Roof catchment" v={d.roofCatchL != null ? `${fmtWater(d.roofCatchL, units)} a year from ${fmtArea(d.roofM2, units)} of roof (80% capture)` : `${fmtArea(d.roofM2, units)} of roof`} />
          <Row k="Tank storage" v={fmtWater(d.tankL, units)} />
          <Row k="Pond storage" v={fmtWater(d.pondL, units)} />
          <Row k="Swales" v={`${fmtLen(d.swaleLen, units, 0)} holding about ${fmtWater(d.swaleL, units)} per fill`} />
          <Row k="Earthworks" v={`cut ${fmtVol(stats.cutM3, units)}, fill ${fmtVol(stats.fillM3, units)}`} />
          {wb && wb.yearNeedL > 0 && <Row k="Water needed beyond rain" v={`${fmtWater(wb.yearNeedL, units)} a year (plants ${fmtWater(wb.yearNeedL - wb.yearHouseL - wb.yearAnimalsL, units)}, household ${fmtWater(wb.yearHouseL, units)}, animals ${fmtWater(wb.yearAnimalsL, units)}). ${wb.supply !== 'rain' ? (wb.fromSupplyL > 1 ? `About ${fmtWater(wb.fromSupplyL, units)} a year comes from the ${wb.supply}.` : `Roof water covers it; the ${wb.supply} is the backup.`) : wb.yearShortL > 1 ? `${fmtWater(wb.yearShortL, units)} short with these tanks; about ${fmtWater(wb.tankForDriestRunL, units)} of tanks would carry the driest run.` : 'The tanks cover it.'}`} />}
        </tbody></table>

        {est.lines.length > 0 && (<>
          <H>Budget: {money(est.total)} over three years</H>
          <table className="w-full text-sm"><thead><tr className="text-left text-zinc-500 border-b border-zinc-200"><th className="py-1">Year</th>{Object.keys(est.groups).map((g) => <th key={g} className="text-right pr-2">{g}</th>)}<th className="text-right">Total</th></tr></thead>
            <tbody>{est.phases.filter((p) => p.total > 0).map((p) => (
              <tr key={p.phase} className="border-b border-zinc-100"><td className="py-0.5">Year {p.phase}</td>{Object.keys(est.groups).map((g) => <td key={g} className="text-right pr-2 tabular-nums">{money(est.lines.filter((l) => l.phase === p.phase && l.group === g).reduce((t, l) => t + l.total, 0))}</td>)}<td className="text-right font-semibold tabular-nums">{money(p.total)}</td></tr>
            ))}</tbody></table>
          <div className="text-xs text-zinc-500 mt-1">{brief.budget ? `Against the client's ${money(brief.budget)} budget: ${est.total > brief.budget ? `${money(est.total - brief.budget)} over` : `${money(brief.budget - est.total)} to spare`}. ` : ''}Totals include {est.prices.labour}% labour and {est.prices.contingency}% contingency. Estimates for planning, not a quote.</div>
        </>)}

        <H>Design review: {review.overall} of 100</H>
        <table className="text-sm"><tbody>
          {review.areas.map((a) => <Row key={a.id} k={`${a.name} (${a.scored ? a.score : 'not scored'})`} v={T(a.findings.filter((f) => f.level !== 'good').map((f) => f.text).join(' ') || (a.scored ? 'All checks met.' : 'Nothing to judge yet.'))} />)}
        </tbody></table>

        {groupedPlants.length > 0 && (() => {
          const shop = groupedPlants.filter((g) => !g.existing);
          return (<>
            <H>Planting plan ({plants.length} plants, {new Set(groupedPlants.map((g) => g.sp.id)).size} kinds, about {money(shop.reduce((t, g) => t + g.cost, 0))})</H>
            <table className="w-full text-xs"><thead><tr className="text-left text-zinc-500 border-b border-zinc-200"><th className="py-1">Plant</th><th>Layer</th><th>How it comes</th><th>When</th><th className="text-right">Count</th><th className="text-right">About</th></tr></thead>
              <tbody>{groupedPlants.map((g, i) => (
                <tr key={i} className="border-b border-zinc-100"><td className="py-0.5">{g.sp.name} <i className="text-zinc-400">{g.sp.latin}</i></td><td>{LAYER_NAMES[g.sp.layer as keyof typeof LAYER_NAMES]}</td><td>{g.existing ? 'existing' : g.sp.stock || (g.sp.life === 'annual' ? 'seed or seedling' : 'potted plant')}</td><td>{g.existing ? '' : `Year ${g.phase}${g.planted ? `, ${g.planted}` : ''}`}</td><td className="text-right">{g.n}</td><td className="text-right">{g.existing ? '' : money(g.cost)}</td></tr>
              ))}</tbody></table>
          </>);
        })()}

        {sc && (() => {
          const ids = [...new Set(objects.map((o) => (o.type === 'garden' ? o.crop : o.type === 'plant' ? o.species : undefined)).filter(Boolean) as string[])];
          if (!ids.length) return null;
          const zoneOf = (id: string) => {
            const o = objects.find((x) => (x.crop || x.species) === id)!;
            const z = features.find((f) => f.kind === 'zone' && pointInPolygon(o.x, o.y, f.points));
            return z?.zone ?? 1;
          };
          return (<>
            <H>Planting calendar for this site</H>
            <div className="text-xs text-zinc-500 mb-2">Hardiness zone {sc.zoneLabel} ({sc.zoneSource}). {sc.frostFree ? 'Frost free.' : `Average last frost ${doyLabel(sc.lastMean!)}, first frost ${doyLabel(sc.firstMean!)}; safe planting after ${doyLabel(sc.lastSafe!)}.`} {sc.chill != null ? `About ${sc.chill} chill hours.` : ''}</div>
            <table className="w-full text-xs"><thead><tr className="text-left text-zinc-500 border-b border-zinc-200"><th className="py-1">Plant</th><th>Start indoors</th><th>Sow or plant</th><th>Harvest</th><th>Variety for here</th></tr></thead>
              <tbody>{ids.map((id) => {
                const sp = SPECIES_BY_ID[id];
                if (!sp) return null;
                const a = advise(sp, sc, null, zoneOf(id), site.soil);
                const get = (kinds: string[]) => a.calendar.filter((l) => kinds.includes(l.kind)).map((l) => rangesText(l.ranges)).join('; ') || '';
                return <tr key={id} className="border-b border-zinc-100 align-top"><td className="py-0.5 pr-2">{sp.name}{a.status === 'no' ? <span className="text-red-700"> (not suited)</span> : a.status === 'possible' ? <span className="text-amber-700"> (with care)</span> : null}</td><td className="pr-2">{get(['indoor'])}</td><td className="pr-2">{get(['sow', 'transplant', 'plant'])}</td><td className="pr-2">{get(['harvest'])}</td><td>{a.variety ? T(a.variety) : ''}</td></tr>;
              })}</tbody></table>
          </>);
        })()}

        {others.length > 0 && (<>
          <H>Structures and water ({others.length})</H>
          <table className="w-full text-xs"><tbody>{others.map((o) => (
            <tr key={o.id} className="border-b border-zinc-100"><td className="py-0.5">{o.name}</td><td>{typeName(o.type)}</td><td>{o.status === 'existing' ? 'existing' : `year ${o.phase ?? 1}`}</td>
              <td>{o.width ? `${fmtLen(o.width, units)} x ${fmtLen(o.depth ?? 0, units)}` : o.radius ? `radius ${fmtLen(o.radius, units)}` : o.capacityL ? fmtWater(o.capacityL, units) : ''}</td>
              <td>{o.notes}</td></tr>
          ))}</tbody></table>
        </>)}

        {features.filter((f) => f.kind !== 'keyline' || f.name === 'Keyline').length > 0 && (<>
          <H>Zones, paddocks, sectors, paths and earthworks</H>
          <table className="w-full text-xs"><tbody>{features.filter((f) => f.kind !== 'keyline' || !/pattern/.test(f.name)).map((f) => (
            <tr key={f.id} className="border-b border-zinc-100"><td className="py-0.5">{f.name}</td>
              <td>{f.kind === 'zone' ? ZONE_NAMES[f.zone ?? 1] : f.kind === 'paddock' ? `paddock, ${f.head ?? ''} ${ANIMALS[f.animal || 'chickens'].label.toLowerCase()}` : f.kind === 'sector' ? `sector from ${Math.round(bearing(f.points[0], f.points[1]))}°` : f.kind === 'boundary' ? 'property line' : f.kind}</td>
              <td>{f.kind === 'zone' || f.kind === 'paddock' || f.kind === 'boundary' ? fmtArea(polygonArea(f.points), units) : f.kind === 'sector' ? `${f.spread ?? ''}° wide` : fmtLen(polylineLength(f.points), units, 0)}</td>
              <td>{f.notes}</td></tr>
          ))}</tbody></table>
        </>)}

        <div className="text-[10px] text-zinc-400 mt-8">{profile.business ? `${profile.business}${profile.website ? ` · ${profile.website}` : ''}. ` : ''}Made with Permascape 3D. Imagery © Esri, Maxar, Earthstar Geographics. Elevation: USGS 3DEP or AWS Terrain Tiles. Places, roads and buildings © OpenStreetMap contributors. Climate: Open-Meteo. Soil: USDA NRCS SSURGO. Flood zones: FEMA National Flood Hazard Layer. Wetlands: US Fish and Wildlife Service. Streams: USGS National Hydrography Dataset. Planning aid only: confirm property lines with a survey and check local codes, permits and a site visit before digging.</div>
      </div>
    </div>
  );
}
