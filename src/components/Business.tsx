import React, { useEffect, useMemo, useState } from 'react';
import { ClipboardList, Wallet, Sparkles, Loader2, Wand2, Store, Download, ChevronDown, UserRound, Check } from 'lucide-react';
import { Sheet, Chip, Btn, Stat, inputCls } from './ui';
import type { Brief, Feature, SiteObject } from '../lib/types';
import { estimate, PRICE_ITEMS, DEFAULT_PRICES } from '../lib/estimate';
import { askPermie, fetchProfile, saveProfile, Profile } from '../lib/api';
import type { Units } from '../lib/units';

export const GOALS = ['Food forest', 'Market garden', 'Self-reliant homestead', 'Water first', 'Wildlife and pollinators', 'Small backyard', 'Animals and pasture', 'Low maintenance', 'Fire-wise'];
const money = (v: number) => `$${Math.round(v).toLocaleString()}`;

// ---------------------------------------------------------------- the client brief

export function BriefSheet({ brief, goals, onChange, onGoals, onClose, onDesign, aiAvailable }: {
  brief: Brief; goals: string[]; onChange: (b: Brief) => void; onGoals: (g: string[]) => void; onClose: () => void; onDesign: () => void; aiAvailable: boolean | null;
}) {
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const set = (p: Partial<Brief>) => onChange({ ...brief, ...p });
  const field = (k: keyof Brief, label: string, placeholder = '', rows = 0) => (
    <label className="block">
      <span className="block text-[11px] uppercase tracking-[0.08em] text-zinc-400 font-semibold mb-1">{label}</span>
      {rows ? <textarea rows={rows} value={(brief[k] as string) || ''} onChange={(e) => set({ [k]: e.target.value })} placeholder={placeholder} className={inputCls} data-brief={k} />
        : <input value={(brief[k] as string) || ''} onChange={(e) => set({ [k]: e.target.value })} placeholder={placeholder} className={inputCls} data-brief={k} />}
    </label>
  );
  const numField = (k: keyof Brief, label: string, placeholder = '') => (
    <label className="block">
      <span className="block text-[11px] uppercase tracking-[0.08em] text-zinc-400 font-semibold mb-1">{label}</span>
      <input type="number" min={0} value={(brief[k] as number) ?? ''} onChange={(e) => set({ [k]: e.target.value === '' ? undefined : Number(e.target.value) })} placeholder={placeholder} className={inputCls} data-brief={k} />
    </label>
  );
  const fill = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await askPermie({ mode: 'brief', question: notes });
      const b = { ...(r.brief || {}) };
      const g: string[] = Array.isArray(b.goals) ? b.goals : [];
      delete b.goals;
      // only fill what is empty: never overwrite what the designer already typed
      const merged: Brief = { ...brief };
      for (const [k, v] of Object.entries(b)) if (v !== '' && v != null && ((merged as any)[k] == null || (merged as any)[k] === '')) (merged as any)[k] = v;
      onChange(merged);
      if (g.length) onGoals([...new Set([...goals, ...g])]);
      setReply(r.answer);
    } catch (e: any) { setErr(e.message); }
    setBusy(false);
  };
  return (
    <Sheet title="Client brief" subtitle="Who the land is for and what they need from it. Permie designs from this, and it opens the report." icon={ClipboardList} onClose={onClose}
      actions={<Btn kind="primary" className="py-2 px-4 text-[13px]" onClick={onDesign}><Wand2 size={14} /> Design from this brief</Btn>}>
      <div className="p-6 grid lg:grid-cols-[1fr_380px] gap-5" data-brief-sheet>
        <div className="space-y-5">
          <section className="rounded-2xl border border-white/[0.07] bg-zinc-950/40 p-5 space-y-3">
            <div className="font-display text-lg text-zinc-50">The client</div>
            <div className="grid sm:grid-cols-2 gap-3">
              {field('client', 'Name', 'Sam and Alex Rivera')}
              {field('contact', 'Email or phone', 'sam@example.com')}
              {numField('people', 'People living there', '4')}
              {numField('hoursPerWeek', 'Hours a week for the land', '10')}
              {numField('budget', 'Budget (US dollars)', '25000')}
              {numField('years', 'Over how many years', '3')}
              <label className="block">
                <span className="block text-[11px] uppercase tracking-[0.08em] text-zinc-400 font-semibold mb-1">Water today</span>
                <select value={brief.water || ''} onChange={(e) => set({ water: (e.target.value || undefined) as Brief['water'] })} className={inputCls} data-brief="water">
                  <option value="">Not known yet</option><option value="rain">Rain only (tanks)</option><option value="well">A well</option><option value="mains">Town mains</option><option value="spring">A spring</option><option value="creek">A creek</option>
                </select>
              </label>
              {field('animals', 'Animals', '15 laying hens, 2 dairy goats')}
            </div>
          </section>
          <section className="rounded-2xl border border-white/[0.07] bg-zinc-950/40 p-5 space-y-3">
            <div className="font-display text-lg text-zinc-50">What they want</div>
            <div className="flex flex-wrap gap-1.5">{GOALS.map((g) => <Chip key={g} active={goals.includes(g)} onClick={() => onGoals(goals.includes(g) ? goals.filter((x) => x !== g) : [...goals, g])}>{g}</Chip>)}</div>
            {field('wants', 'In their words', 'Feed the family from the land within five years; somewhere the kids want to be', 3)}
            <div className="grid sm:grid-cols-2 gap-3">
              {field('keep', 'Keep', 'The big oak, the view west, the driveway', 2)}
              {field('problems', 'What is not working', 'Runoff gullies the drive, deer eat everything', 2)}
              {field('access', 'Access and mobility', 'Level paths: one of them has bad knees', 2)}
              {field('notes', 'Other notes', '', 2)}
            </div>
          </section>
        </div>
        <aside className="space-y-4">
          <section className="rounded-2xl border border-emerald-400/25 bg-gradient-to-b from-emerald-400/[0.08] to-transparent p-5 space-y-3">
            <div className="flex items-center gap-2"><Sparkles size={16} className="text-emerald-300" /><div className="font-display text-lg text-zinc-50">Fill it from their notes</div></div>
            <p className="text-xs text-zinc-400">Paste an email, a voice memo transcript or your site-visit notes. Permie fills in what they say and lists what is still worth asking. It never overwrites what you typed.</p>
            <textarea rows={8} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Hi! We just bought 10 acres near Leicester. There are four of us..." className={inputCls} data-brief-notes />
            <Btn kind="primary" className="w-full py-2.5 text-[13px]" disabled={busy || !notes.trim() || aiAvailable === false} onClick={fill} data-brief-fill>
              {busy ? <><Loader2 size={14} className="animate-spin" /> Reading the notes</> : <><Wand2 size={14} /> Fill the brief</>}
            </Btn>
            {reply && <div className="text-[13px] text-emerald-50 bg-zinc-950/50 rounded-xl p-3 whitespace-pre-wrap" data-brief-reply>{reply}</div>}
            {err && <div className="text-xs text-red-200 bg-red-400/10 border border-red-400/30 rounded-xl p-3">{err}</div>}
          </section>
          <ProfileCard />
        </aside>
      </div>
    </Sheet>
  );
}

/** The designer's own details, kept once for every project and printed on plans and reports. */
export function ProfileCard() {
  const [p, setP] = useState<Profile>({});
  const [saved, setSaved] = useState(false);
  useEffect(() => { fetchProfile().then(setP).catch(() => {}); }, []);
  const set = (k: keyof Profile, v: string) => { setP({ ...p, [k]: v }); setSaved(false); };
  return (
    <section className="rounded-2xl border border-white/[0.07] bg-zinc-950/40 p-5 space-y-3" data-profile>
      <div className="flex items-center gap-2"><UserRound size={16} className="text-zinc-300" /><div className="font-display text-lg text-zinc-50">You, the designer</div></div>
      <p className="text-xs text-zinc-400">Printed on every plan and report. Saved once for all projects.</p>
      {(['designer', 'business', 'contact', 'website'] as const).map((k) => (
        <input key={k} value={p[k] || ''} onChange={(e) => set(k, e.target.value)} placeholder={{ designer: 'Your name', business: 'Business name', contact: 'Email or phone', website: 'Website' }[k]} className={inputCls} data-profile-field={k} />
      ))}
      <Btn className="w-full" onClick={() => saveProfile(p).then(() => setSaved(true))}>{saved ? <><Check size={13} /> Saved</> : 'Save my details'}</Btn>
    </section>
  );
}

// ---------------------------------------------------------------- the budget

const UNIT_LABEL = (unit: string, u: Units) => (u === 'imperial' ? { m: 'ft', m2: 'sq ft', m3: 'cu yd', L: 'gal', each: '' }[unit] : { m: 'm', m2: 'm²', m3: 'm³', L: 'L', each: '' }[unit]) ?? '';
/** metric quantity to the person's units */
const qtyIn = (q: number, unit: string, u: Units) => (u !== 'imperial' ? q : unit === 'm' ? q * 3.28084 : unit === 'm2' ? q * 10.7639 : unit === 'm3' ? q * 1.30795 : unit === 'L' ? q * 0.264172 : q);
/** a price per metric unit to a price per the person's unit, and back */
const priceIn = (v: number, unit: string, u: Units) => (u !== 'imperial' ? v : unit === 'm' ? v / 3.28084 : unit === 'm2' ? v / 10.7639 : unit === 'm3' ? v / 1.30795 : unit === 'L' ? v / 0.264172 : v);
const priceOut = (v: number, unit: string, u: Units) => (u !== 'imperial' ? v : unit === 'm' ? v * 3.28084 : unit === 'm2' ? v * 10.7639 : unit === 'm3' ? v * 1.30795 : unit === 'L' ? v * 0.264172 : v);

export function BudgetSheet({ objects, features, prices, onPrices, budget, years, units, cutM3, fillM3, onClose, onSelect, onNurseries, onPhase }: {
  objects: SiteObject[]; features: Feature[]; prices: Record<string, number>; onPrices: (p: Record<string, number>) => void; budget?: number; years?: number; units: Units;
  cutM3: number; fillM3: number; onClose: () => void; onSelect: (id: string) => void; onNurseries: (plantList: string) => void; onPhase: (ids: string[], phase: number) => void;
}) {
  const est = useMemo(() => estimate(objects, features, prices, cutM3, fillM3), [objects, features, prices, cutM3, fillM3]);
  const [openPrices, setOpenPrices] = useState(false);
  const plantLines = est.lines.filter((l) => l.group === 'Plants');
  const nurseryList = [...new Map(plantLines.map((l) => [l.item, (plantLines.filter((x) => x.item === l.item).reduce((s, x) => s + x.qty, 0))])).entries()].map(([k, n]) => `${n} ${k}`).join(', ');
  const csv = () => {
    const rows = [['Year', 'Group', 'Item', 'Quantity', 'Unit', 'Each ($)', 'Total ($)'], ...est.lines.map((l) => [l.phase, l.group, l.item, qtyIn(l.qty, l.unit, units).toFixed(1), UNIT_LABEL(l.unit, units) || 'each', priceIn(l.each, l.unit, units).toFixed(2), l.total.toFixed(0)])];
    for (const p of est.phases) rows.push([p.phase, 'Total', `Year ${p.phase} with labour and contingency`, '', '', '', p.total.toFixed(0)]);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')], { type: 'text/csv' }));
    a.download = 'design-budget.csv'; a.click();
  };
  const over = budget ? est.total - budget : 0;
  return (
    <Sheet title="Budget" subtitle="What it costs to install, year by year, from prices you can set for your area. Existing things are not priced." icon={Wallet} onClose={onClose}
      actions={<div className="flex gap-2"><Btn onClick={csv}><Download size={13} /> Spreadsheet</Btn><Btn kind="primary" onClick={() => onNurseries(nurseryList)} disabled={!plantLines.length} data-nurseries><Store size={13} /> Find nurseries</Btn></div>}>
      <div className="p-6 space-y-5" data-budget>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {est.phases.map((p) => <Stat key={p.phase} label={`Year ${p.phase}`} value={money(p.total)} sub={p.labour + p.contingency > 1 ? `incl. ${money(p.labour + p.contingency)} labour and contingency` : 'materials and machine time'} />)}
          <Stat label="All three years" value={money(est.total)} sub={budget ? (over > 0 ? `${money(over)} over the ${money(budget)} budget` : `${money(-over)} under the ${money(budget)} budget`) : 'set a budget in the Brief'} />
          <Stat label="Biggest cost" value={Object.entries(est.groups).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'nothing yet'} sub={Object.entries(est.groups).sort((a, b) => b[1] - a[1])[0] ? money(Object.entries(est.groups).sort((a, b) => b[1] - a[1])[0][1]) : ''} />
        </div>
        {budget ? (
          <div className="rounded-2xl border border-white/[0.07] bg-zinc-950/40 p-4">
            <div className="flex justify-between text-xs text-zinc-400 mb-2"><span>Against the client's budget{years ? ` over ${years} years` : ''}</span><span className={over > 0 ? 'text-amber-300' : 'text-emerald-300'}>{Math.round((est.total / budget) * 100)}%</span></div>
            <div className="h-3 rounded-full bg-white/[0.06] overflow-hidden flex">
              {est.phases.map((p, i) => <div key={i} style={{ width: `${Math.min(100, (p.total / Math.max(budget, est.total)) * 100)}%`, background: ['#8acf52', '#5cc8f0', '#f5b94a'][i] }} title={`Year ${p.phase}: ${money(p.total)}`} />)}
            </div>
            {over > 0 && <p className="text-xs text-amber-200 mt-2">Over budget. Move items to a later year (select a line, then pick its year), price plants at wholesale, or ask Permie to trim year 1.</p>}
          </div>
        ) : null}
        {est.lines.length === 0 ? <div className="text-sm text-zinc-400">Nothing proposed yet. Everything you add to the design is priced here.</div> : [1, 2, 3].map((ph) => {
          const ls = est.lines.filter((l) => l.phase === ph);
          if (!ls.length) return null;
          const p = est.phases[ph - 1];
          return (
            <div key={ph} className="rounded-2xl border border-white/[0.07] bg-zinc-950/40 overflow-hidden" data-budget-year={ph}>
              <div className="flex items-baseline justify-between px-5 py-3 border-b hairline">
                <div className="font-display text-lg text-zinc-50">Year {ph}</div>
                <div className="text-sm text-zinc-300 tabular-nums">{money(p.subtotal)}{p.labour + p.contingency > 1 ? <span className="text-zinc-500"> + {money(p.labour + p.contingency)}</span> : null}</div>
              </div>
              <table className="w-full text-[13px]">
                <tbody>
                  {ls.map((l, i) => (
                    <tr key={i} className="border-t border-white/[0.04] hover:bg-white/[0.03]">
                      <td className="px-5 py-1.5 text-zinc-500 w-28">{l.group}</td>
                      <td className="py-1.5"><button className="text-zinc-100 hover:text-emerald-200 text-left" onClick={() => l.ids[0] && onSelect(l.ids[0])}>{l.item}</button></td>
                      <td className="py-1.5 text-right tabular-nums text-zinc-300">{l.unit === 'each' ? l.qty.toLocaleString() : `${Math.round(qtyIn(l.qty, l.unit, units)).toLocaleString()} ${UNIT_LABEL(l.unit, units)}`}</td>
                      <td className="py-1.5 text-right tabular-nums text-zinc-500 w-28">{l.unit === 'each' ? `${money(l.each)} each` : `$${priceIn(l.each, l.unit, units).toFixed(2)} / ${UNIT_LABEL(l.unit, units)}`}</td>
                      <td className="py-1.5 text-right tabular-nums text-zinc-100 w-24">{money(l.total)}</td>
                      <td className="py-1.5 pr-4 pl-2 w-28 text-right">
                        {l.ids.length > 0 && <select value={ph} onChange={(e) => onPhase(l.ids, Number(e.target.value))} className="bg-zinc-950/70 border border-white/10 rounded-lg px-1.5 py-0.5 text-[11px] text-zinc-300" title="Move to another year">{[1, 2, 3].map((y) => <option key={y} value={y}>Year {y}</option>)}</select>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
        <div className="rounded-2xl border border-white/[0.07] bg-zinc-950/40">
          <button className="w-full flex items-center justify-between px-5 py-3" onClick={() => setOpenPrices(!openPrices)}>
            <span className="font-display text-lg text-zinc-50">Your prices</span>
            <span className="text-xs text-zinc-400 flex items-center gap-1">Ballpark US prices to start; set yours <ChevronDown size={14} className={openPrices ? 'rotate-180' : ''} /></span>
          </button>
          {openPrices && (
            <div className="px-5 pb-5 grid md:grid-cols-2 gap-x-6 gap-y-2" data-prices>
              {PRICE_ITEMS.map((it) => {
                const v = est.prices[it.id];
                const percent = it.id === 'labour' || it.id === 'contingency';
                return (
                  <label key={it.id} className="flex items-center gap-3 text-[13px]">
                    <span className="flex-1 min-w-0"><span className="block text-zinc-200">{it.label}</span><span className="block text-[11px] text-zinc-500">{it.note}</span></span>
                    <span className="text-zinc-500 text-xs">{percent || it.id === 'plantFactor' ? '' : '$'}</span>
                    <input type="number" step="any" min={0} value={+priceIn(v, it.unit, units).toFixed(it.unit === 'L' || it.id === 'plantFactor' ? 2 : 1)} onChange={(e) => onPrices({ ...prices, [it.id]: priceOut(Number(e.target.value), it.unit, units) })} className={inputCls + ' w-24 text-right'} data-price={it.id} />
                    <span className="text-zinc-500 text-xs w-12">{percent ? '%' : it.unit === 'each' ? (it.id === 'plantFactor' ? 'x' : 'each') : `/ ${UNIT_LABEL(it.unit, units)}`}</span>
                  </label>
                );
              })}
              <div className="md:col-span-2 flex justify-end"><Btn onClick={() => onPrices({})}>Back to the starting prices</Btn></div>
            </div>
          )}
        </div>
        <p className="text-xs text-zinc-500">Estimates for planning and conversations with the client, not a contractor's quote. Plant prices come from each plant's list price; set wholesale with the plant multiplier. {Object.keys(DEFAULT_PRICES).length} prices are editable above.</p>
      </div>
    </Sheet>
  );
}
