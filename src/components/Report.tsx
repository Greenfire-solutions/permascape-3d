import React, { useMemo } from 'react';
import { Printer, X } from 'lucide-react';
import type { Feature, SiteObject, Site } from '../lib/types';
import { SPECIES_BY_ID, LAYER_NAMES, zoneFit } from '../lib/plants';
import { SLOPE_CLASSES, COMPASS, polygonArea, polylineLength } from '../lib/terrain';
import { ZONE_NAMES } from '../lib/mapTexture';
import { designSummary } from '../lib/summary';
import { fmtLen, fmtArea, fmtWater, fmtRain, fmtTemp, fmtVol, Units } from '../lib/units';
import { typeName } from './Panels';
import { advise, rangesText, SiteClimate, doyLabel } from '../lib/advisor';
import { pointInPolygon } from '../lib/terrain';
import { waterBudget, reviewDesign, ANIMALS, bearing, effectiveZone } from '../lib/permaculture';

interface Props {
  name: string; site: Site; objects: SiteObject[]; features: Feature[]; stats: any; units: Units; image: string; onClose: () => void; sc?: SiteClimate | null;
}

export default function Report({ name, site, objects, features, stats, units, image, onClose, sc }: Props) {
  const d = useMemo(() => designSummary(site, objects, features), [site, objects, features]);
  const c = site.climate, s = site.soil;
  const plants = objects.filter((o) => o.type === 'plant');
  const others = objects.filter((o) => o.type !== 'plant');
  const zone = effectiveZone(site);
  const maxP = c ? Math.max(1, ...c.monthlyPrecipMm) : 1;
  const wb = useMemo(() => waterBudget(site, objects, features, 1), [site, objects, features]);
  const review = useMemo(() => reviewDesign({ site, objects, features, zone: zone ?? null, meanSlope: stats.meanSlope, cutM3: stats.cutM3, fillM3: stats.fillM3, roofCatchL: d.roofCatchL }), [site, objects, features, stats, d]);
  const H = ({ children }: { children: React.ReactNode }) => <h2 className="text-lg font-semibold text-zinc-900 border-b border-zinc-300 pb-1 mt-6 mb-2">{children}</h2>;
  const Row = ({ k, v }: { k: string; v: React.ReactNode }) => <tr><td className="py-0.5 pr-4 text-zinc-500 align-top">{k}</td><td className="py-0.5 text-zinc-900">{v}</td></tr>;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 overflow-y-auto report-root">
      <div className="max-w-4xl mx-auto my-6 bg-white text-zinc-800 rounded-lg shadow-2xl p-10 print:m-0 print:shadow-none print:rounded-none">
        <div className="flex justify-between items-start no-print mb-4">
          <div className="text-xs text-zinc-500">This report prints cleanly, or save it as a PDF from the print dialog.</div>
          <div className="flex gap-2">
            <button onClick={() => window.print()} className="flex items-center gap-1 px-3 py-1.5 rounded bg-emerald-600 text-white text-sm"><Printer size={14} /> Print or save PDF</button>
            <button onClick={onClose} className="flex items-center gap-1 px-3 py-1.5 rounded bg-zinc-200 text-zinc-800 text-sm"><X size={14} /> Close</button>
          </div>
        </div>

        <h1 className="text-2xl font-bold text-zinc-900">{name}</h1>
        <div className="text-sm text-zinc-500">{site.address || 'Sandbox site'}{site.lat != null && ` · ${site.lat.toFixed(5)}, ${site.lon!.toFixed(5)}`} · {new Date().toLocaleDateString()}</div>
        {image && <img src={image} alt="3D view of the design" className="w-full rounded mt-4 border border-zinc-200" />}

        <H>The land</H>
        <table className="text-sm"><tbody>
          <Row k="Area" v={`${fmtArea(d.area, units)} (${fmtLen(site.size, units, 0)} square)`} />
          <Row k="Elevation" v={`${fmtLen(site.base + stats.min, units, 0)} to ${fmtLen(site.base + stats.max, units, 0)} above sea level, ${fmtLen(stats.relief, units)} of relief`} />
          <Row k="Slope" v={`mean ${stats.meanSlope.toFixed(1)}%, steepest ${stats.steepest.toFixed(0)}%`} />
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

        {c && (<>
          <H>Climate</H>
          <table className="text-sm"><tbody>
            <Row k="Hardiness zone" v={`${sc?.zoneLabel ?? c.zone?.label ?? '?'} (average coldest night ${c.meanAnnualMinC != null ? fmtTemp(c.meanAnnualMinC, units) : '?'})`} />
            <Row k="Rainfall" v={`${fmtRain(c.annualPrecipMm, units)} a year`} />
            <Row k="Frost" v={c.frostFree ? 'Frost free' : `last in spring around ${c.lastSpringFrost}, first in fall around ${c.firstFallFrost}, ${c.growingSeasonDays} day season`} />
            <Row k="Source" v={`${c.source}, ${c.period}`} />
          </tbody></table>
          <div className="flex items-end gap-1 h-20 mt-2">{c.monthlyPrecipMm.map((v, i) => <div key={i} className="flex-1 flex flex-col items-center justify-end h-full"><div className="w-full bg-blue-500 rounded-t" style={{ height: `${(v / maxP) * 100}%` }} /><div className="text-[10px] text-zinc-500">{'JFMAMJJASOND'[i]}</div></div>)}</div>
        </>)}

        {s?.available && (<>
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
          {wb && wb.canopyM2 > 0 && <Row k="Irrigation need when grown" v={`${fmtWater(wb.yearNeedL, units)} a year beyond rain; ${wb.yearShortL > 1 ? `${fmtWater(wb.yearShortL, units)} short with these tanks, about ${fmtWater(wb.tankForDriestRunL, units)} of tanks would carry the driest run` : 'the tanks cover it'}`} />}
        </tbody></table>

        <H>Design review: {review.overall} of 100</H>
        <table className="text-sm"><tbody>
          {review.areas.map((a) => <Row key={a.id} k={`${a.name} (${a.score})`} v={a.findings.filter((f) => f.level !== 'good').map((f) => f.text).join(' ') || 'All checks met.'} />)}
        </tbody></table>

        {plants.length > 0 && (() => {
          const by: Record<string, { n: number; cost: number }> = {};
          for (const p of plants) { const sp = SPECIES_BY_ID[p.species || '']; if (!sp) continue; by[sp.id] = by[sp.id] || { n: 0, cost: 0 }; by[sp.id].n++; by[sp.id].cost += p.cost ?? sp.costUSD; }
          const rows = Object.entries(by).sort((a, b) => b[1].n - a[1].n);
          return (<>
            <H>Shopping list ({rows.length} kinds, about ${Math.round(rows.reduce((t, [, v]) => t + v.cost, 0)).toLocaleString()})</H>
            <table className="w-full text-xs"><thead><tr className="text-left text-zinc-500"><th className="py-1">Plant</th><th>How</th><th className="text-right">Count</th><th className="text-right">About</th></tr></thead>
              <tbody>{rows.map(([id, v]) => { const sp = SPECIES_BY_ID[id]; return (
                <tr key={id} className="border-b border-zinc-100"><td className="py-0.5">{sp.name} <i className="text-zinc-400">{sp.latin}</i></td><td>{sp.stock || (sp.life === 'annual' ? 'seed or seedling' : 'potted plant')}</td><td className="text-right">{v.n}</td><td className="text-right">${Math.round(v.cost).toLocaleString()}</td></tr>
              ); })}</tbody></table>
          </>);
        })()}

        {plants.length > 0 && (<>
          <H>Planting schedule ({plants.length})</H>
          <table className="w-full text-xs">
            <thead><tr className="text-left text-zinc-500 border-b border-zinc-200"><th className="py-1">Name</th><th>Species</th><th>Layer</th><th>Planted</th><th>Source</th><th className="text-right">Cost</th><th>Zone</th></tr></thead>
            <tbody>{plants.map((p) => {
              const sp = SPECIES_BY_ID[p.species || ''];
              const fit = sp ? zoneFit(sp, zone) : { ok: true, text: '' };
              return <tr key={p.id} className="border-b border-zinc-100"><td className="py-0.5">{p.name}</td><td>{sp?.name} <i className="text-zinc-400">{sp?.latin}</i></td><td>{sp ? LAYER_NAMES[sp.layer] : ''}</td><td>{p.planted}</td><td>{p.source}</td><td className="text-right">${p.cost ?? sp?.costUSD ?? 0}</td><td className={fit.ok ? 'text-emerald-700' : 'text-amber-700'}>{zone == null ? '' : fit.ok ? 'fits' : 'check'}</td></tr>;
            })}</tbody>
            <tfoot><tr><td colSpan={5} className="pt-1 text-right text-zinc-500">Plant budget</td><td className="pt-1 text-right font-semibold">${Math.round(d.plantCost).toLocaleString()}</td><td /></tr></tfoot>
          </table>
        </>)}

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
                return <tr key={id} className="border-b border-zinc-100 align-top"><td className="py-0.5 pr-2">{sp.name}{a.status === 'no' ? <span className="text-red-700"> (not suited)</span> : a.status === 'possible' ? <span className="text-amber-700"> (with care)</span> : null}</td><td className="pr-2">{get(['indoor'])}</td><td className="pr-2">{get(['sow', 'transplant', 'plant'])}</td><td className="pr-2">{get(['harvest'])}</td><td>{a.variety || ''}</td></tr>;
              })}</tbody></table>
          </>);
        })()}

        {others.length > 0 && (<>
          <H>Structures and water ({others.length})</H>
          <table className="w-full text-xs"><tbody>{others.map((o) => (
            <tr key={o.id} className="border-b border-zinc-100"><td className="py-0.5">{o.name}</td><td>{typeName(o.type)}</td>
              <td>{o.width ? `${fmtLen(o.width, units)} x ${fmtLen(o.depth ?? 0, units)}` : o.radius ? `radius ${fmtLen(o.radius, units)}` : o.capacityL ? fmtWater(o.capacityL, units) : ''}</td>
              <td>{o.notes}</td></tr>
          ))}</tbody></table>
        </>)}

        {features.length > 0 && (<>
          <H>Zones, paddocks, sectors, paths and earthworks</H>
          <table className="w-full text-xs"><tbody>{features.map((f) => (
            <tr key={f.id} className="border-b border-zinc-100"><td className="py-0.5">{f.name}</td>
              <td>{f.kind === 'zone' ? ZONE_NAMES[f.zone ?? 1] : f.kind === 'paddock' ? `paddock, ${f.head ?? ''} ${ANIMALS[f.animal || 'chickens'].label.toLowerCase()}` : f.kind === 'sector' ? `sector from ${Math.round(bearing(f.points[0], f.points[1]))}°` : f.kind}</td>
              <td>{f.kind === 'zone' || f.kind === 'paddock' ? fmtArea(polygonArea(f.points), units) : f.kind === 'sector' ? `${f.spread ?? ''}° wide` : fmtLen(polylineLength(f.points), units, 0)}</td>
              <td>{f.notes}</td></tr>
          ))}</tbody></table>
        </>)}

        <div className="text-[10px] text-zinc-400 mt-8">Made with Permascape 3D. Imagery © Esri, Maxar, Earthstar Geographics. Elevation: USGS 3DEP or AWS Terrain Tiles. Places © OpenStreetMap contributors. Climate: Open-Meteo. Soil: USDA NRCS. Planning aid only: check with local codes and a site visit before digging.</div>
      </div>
    </div>
  );
}
