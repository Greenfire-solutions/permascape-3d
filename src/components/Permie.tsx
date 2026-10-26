import React, { useEffect, useRef, useState } from 'react';
import { Sparkles, Send, X, Wand2, Check, Eye, EyeOff, Loader2, MessageCircle, TreeDeciduous, Droplet, Hexagon, Home, Route, Trees, PawPrint, Fence, Waves, Sprout, TreePine, ShieldCheck, AlertTriangle, ListChecks } from 'lucide-react';
import type { AiAction, AiTurn } from '../lib/types';
import { Btn, Chip, Segmented } from './ui';
import { uid, askPermie } from '../lib/api';
import { GOALS } from './Business';

const STARTERS = ['What should I plant first this season?', 'Where is the best spot for a pond?', 'How do I stop the runoff on my slope?', 'Which fruit trees suit my chill hours?', 'What can I grow in the shade by the house?'];

const ICONS: Record<AiAction['kind'], any> = { plant: TreePine, guild: TreeDeciduous, hedge: Trees, zone: Hexagon, swale: Waves, pond: Droplet, structure: Home, garden: Sprout, path: Route, paddock: PawPrint, fence: Fence };

interface Props {
  available: boolean | null;
  turns: AiTurn[];
  goals: string[];
  onGoals: (g: string[]) => void;
  buildContext: () => any;
  onTurn: (t: AiTurn) => void;
  onApply: (turnId: string, indices: number[]) => void;
  onPreview: (actions: AiAction[] | null) => void;
  onClose: () => void;
  onUpdateTurn: (id: string, patch: Partial<AiTurn>) => void;
  /** the rule checks run on a proposal as if it were added: plant conflicts, flood, streams, slope */
  checkActions: (actions: AiAction[]) => string[];
  /** the app measures buildings and swales on the real terrain and moves any on steep ground */
  settle?: (actions: AiAction[]) => { actions: AiAction[]; notes: string[] };
  start?: { mode: 'design' | 'ask'; question?: string; auto?: boolean } | null;
}

export default function Permie({ available, turns, goals, onGoals, buildContext, onTurn, onApply, onPreview, onClose, onUpdateTurn, checkActions, settle, start }: Props) {
  const [mode, setMode] = useState<'design' | 'ask'>(start?.mode ?? (turns.length ? 'ask' : 'design'));
  const [text, setText] = useState(start?.question ?? '');
  const [compact, setCompact] = useState(false);
  const [checking, setChecking] = useState<string | null>(null);
  const [deep, setDeep] = useState(false);
  const [busy, setBusy] = useState<{ since: number; mode: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [picked, setPicked] = useState<Record<string, Set<number>>>({});
  const [previewing, setPreviewing] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => { if (!busy) return; const t = setInterval(() => setTick((x) => x + 1), 1000); return () => clearInterval(t); }, [busy]);
  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' }); }, [turns.length, busy]);
  useEffect(() => () => onPreview(null), []);
  useEffect(() => { if (start?.auto && start.question) run(start.mode, start.question); }, []);

  /** The senior designer's pass: Permie re-reads its own proposal against the land and the brief. */
  const critique = async (turn: AiTurn, q: string) => {
    setChecking(turn.id);
    try {
      // the app's own measurements go in too: the critic sees a coarse terrain grid, the checks see every metre
      const found = turn.checks?.length ? `\n\nThe app measured this proposal on the real terrain and found these problems; fix each one (move it to gentler or safer ground, or drop it):\n- ${turn.checks.join('\n- ')}` : '';
      const r = await askPermie({ mode: 'critic', question: q + found, context: buildContext(), proposal: turn.actions, model: deep ? 'opus' : 'sonnet' });
      const drop = new Set(r.drop || []);
      const added = (r.actions || []) as AiAction[];
      const s = settle ? settle([...turn.actions.filter((_, i) => !drop.has(i)), ...added]) : null;
      const actions = s ? s.actions : [...turn.actions.filter((_, i) => !drop.has(i)), ...added];
      onUpdateTurn(turn.id, { actions, critique: { answer: r.answer, dropped: [...drop], added: added.length, seconds: r.seconds, settled: s?.notes || [] }, checks: checkActions(actions) });
      setPicked((p) => ({ ...p, [turn.id]: new Set(actions.map((_, i) => i)) }));
      if (previewRef.current === turn.id) onPreview(actions);
    } catch (e: any) {
      const s = settle ? settle(turn.actions) : null;
      onUpdateTurn(turn.id, { ...(s ? { actions: s.actions, checks: checkActions(s.actions) } : {}), critique: { answer: `The self-check did not run: ${e.message}`, dropped: [], added: 0, settled: s?.notes || [] } });
    }
    setChecking(null);
  };
  const previewRef = useRef<string | null>(null);
  useEffect(() => { previewRef.current = previewing; }, [previewing]);

  const run = async (m: 'design' | 'ask', question: string) => {
    if (busy) return;
    setErr(null);
    setBusy({ since: Date.now(), mode: m });
    try {
      const q = m === 'design' ? [goals.join(', '), question].filter(Boolean).join('. ') : question;
      const j = await askPermie({ mode: m, question: q, context: buildContext(), model: deep ? 'opus' : 'sonnet' });
      const actions = (j.actions || []) as AiAction[];
      const turn: AiTurn = { id: uid(), at: new Date().toISOString(), mode: m, question: m === 'design' ? (q || 'Design my land') : question, answer: j.answer, actions, applied: [], seconds: j.seconds, checks: actions.length ? checkActions(actions) : [] };
      onTurn(turn);
      setPicked((p) => ({ ...p, [turn.id]: new Set(turn.actions.map((_, i) => i)) }));
      if (turn.actions.length) { setPreviewing(turn.id); onPreview(turn.actions); setCompact(true); }
      setText('');
      // every full design gets a second look before the person adds it
      if (m === 'design' && actions.length) critique(turn, q);
    } catch (e: any) { setErr(e.message); }
    setBusy(null);
  };

  const togglePick = (t: AiTurn, i: number) => setPicked((p) => {
    const s = new Set(p[t.id] ?? t.actions.map((_, k) => k));
    if (s.has(i)) s.delete(i); else s.add(i);
    return { ...p, [t.id]: s };
  });

  const elapsed = busy ? Math.round((Date.now() - busy.since) / 1000) : 0;
  void tick;

  // while a proposal is on the land, Permie steps aside to a small card so the land can be seen
  const shown = previewing ? turns.find((t) => t.id === previewing) : null;
  if (compact && shown) {
    const sel = picked[shown.id] ?? new Set(shown.actions.map((_, i) => i));
    const remaining = shown.actions.map((_, i) => i).filter((i) => !(shown.applied || []).includes(i));
    const n = [...sel].filter((i) => remaining.includes(i)).length;
    return (
      <div className="absolute right-3 bottom-24 w-[340px] z-30 glass rounded-2xl shadow-glass p-4 space-y-3 animate-rise no-print" data-permie data-permie-compact>
        <div className="flex items-start gap-2.5">
          <span className="w-8 h-8 rounded-xl bg-gradient-to-br from-emerald-300 to-emerald-600 text-emerald-950 flex items-center justify-center shrink-0"><Sparkles size={15} /></span>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] text-zinc-50 font-semibold">{shown.actions.length} changes shown on the land</div>
            <div className="text-[11px] text-zinc-400">{checking === shown.id ? 'Permie is checking its own design...' : shown.critique ? `Checked: ${shown.critique.dropped.length} removed, ${shown.critique.added} added.` : 'Look around, then add the ones you want.'}{shown.checks?.length ? ` ${shown.checks.length} thing${shown.checks.length > 1 ? 's' : ''} to check.` : ''}</div>
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-white" title="Close"><X size={16} /></button>
        </div>
        <div className="flex gap-2">
          <Btn className="flex-1" onClick={() => setCompact(false)} data-permie-expand><ListChecks size={13} /> See the list</Btn>
          {remaining.length > 0 && <Btn kind="primary" className="flex-1" disabled={!n} onClick={() => { onApply(shown.id, [...sel].filter((i) => remaining.includes(i))); setPreviewing(null); onPreview(null); setCompact(false); }} data-permie-add><Check size={13} /> Add {n}</Btn>}
        </div>
      </div>
    );
  }

  return (
    <div className="absolute right-3 top-3 bottom-3 w-[420px] z-30 glass rounded-3xl shadow-glass flex flex-col overflow-hidden animate-sheet no-print" data-permie>
      <div className="px-5 pt-4 pb-3 border-b hairline">
        <div className="flex items-center gap-3">
          <span className="w-10 h-10 rounded-2xl bg-gradient-to-br from-emerald-300 to-emerald-600 text-emerald-950 flex items-center justify-center shadow-glow"><Sparkles size={19} /></span>
          <div className="flex-1">
            <div className="font-display text-xl text-zinc-50 leading-tight">Permie</div>
            <div className="text-[11px] text-zinc-400">AI permaculture designer. Reads your land, proposes, you decide.</div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center text-zinc-300 hover:bg-white/10" title="Close"><X size={17} /></button>
        </div>
        <div className="mt-3"><Segmented size="md" value={mode} onChange={setMode} options={[{ id: 'design', label: <span className="inline-flex items-center gap-1.5"><Wand2 size={13} />Design my land</span> }, { id: 'ask', label: <span className="inline-flex items-center gap-1.5"><MessageCircle size={13} />Ask anything</span> }]} /></div>
      </div>

      <div ref={scroller} className="flex-1 overflow-y-auto scroll-thin px-5 py-4 space-y-4">
        {available === false && <div className="rounded-2xl border border-amber-400/30 bg-amber-400/10 p-3 text-xs text-amber-100">Permie runs on Claude Code on this Mac and it is not installed. Install Claude Code and sign in once by typing claude in Terminal.</div>}
        {turns.length === 0 && !busy && (
          <div className="text-sm text-zinc-300 space-y-2 leading-relaxed">
            <p>I can see your slope, water flow, sun, climate, frost dates, soil and everything you have placed.</p>
            <p>{mode === 'design' ? 'Pick your goals and I will lay out a whole starter design: water, access, zones, guilds and hedgerows. You preview it on the land and keep only what you like.' : 'Ask about your land, plants, timing or techniques. When moving things on the map would help, I will propose it.'}</p>
          </div>
        )}
        {turns.map((t) => {
          const sel = picked[t.id] ?? new Set(t.actions.map((_, i) => i).filter((i) => !(t.applied || []).includes(i)));
          const remaining = t.actions.map((_, i) => i).filter((i) => !(t.applied || []).includes(i));
          return (
            <div key={t.id} className="space-y-2" data-turn={t.id}>
              <div className="flex justify-end"><div className="max-w-[85%] rounded-2xl rounded-br-md bg-emerald-400/15 border border-emerald-400/25 px-3.5 py-2 text-[13px] text-emerald-50">{t.question}</div></div>
              <div className="rounded-2xl rounded-bl-md bg-zinc-950/60 border hairline px-3.5 py-3 text-[13px] text-zinc-100 whitespace-pre-wrap leading-relaxed" data-answer>{t.answer}</div>
              {t.actions.length > 0 && (
                <div className="rounded-2xl border hairline bg-zinc-950/40 p-2">
                  <div className="flex items-center justify-between px-1.5 py-1">
                    <div className="text-[11px] uppercase tracking-[0.1em] text-zinc-400 font-semibold">{t.actions.length} proposed changes</div>
                    <div className="flex items-center gap-3">
                      {previewing === t.id && <button onClick={() => setCompact(true)} className="text-[11px] text-emerald-200 hover:text-white" data-permie-look>Look at the land</button>}
                      <button onClick={() => { if (previewing === t.id) { setPreviewing(null); onPreview(null); } else { setPreviewing(t.id); onPreview(t.actions.filter((_, i) => sel.has(i))); } }} className="text-[11px] text-zinc-300 hover:text-white inline-flex items-center gap-1">
                        {previewing === t.id ? <><EyeOff size={12} /> Hide preview</> : <><Eye size={12} /> Preview on land</>}
                      </button>
                    </div>
                  </div>
                  {(checking === t.id || t.critique) && (
                    <div className="mx-1 mb-1.5 rounded-xl bg-emerald-400/[0.07] border border-emerald-400/20 p-2.5 text-[11.5px] text-emerald-50 whitespace-pre-wrap" data-critique>
                      <div className="flex items-center gap-1.5 font-semibold mb-0.5"><ShieldCheck size={13} className="text-emerald-300" />{checking === t.id ? <>Checking its own design<span className="animate-breathe">...</span></> : 'Permie checked its own design'}</div>
                      {t.critique?.answer}
                      {!!t.critique?.settled?.length && (
                        <div className="mt-2 pt-2 border-t border-emerald-300/15" data-settled>
                          <div className="font-semibold mb-0.5">Then the app measured it on the real ground</div>
                          {t.critique.settled.join('\n')}
                        </div>
                      )}
                    </div>
                  )}
                  {t.checks && t.checks.length > 0 && (
                    <div className="mx-1 mb-1.5 space-y-1" data-proposal-checks>
                      {t.checks.slice(0, 5).map((c, k) => <div key={k} className="flex gap-1.5 text-[11px] text-amber-100 bg-amber-400/[0.08] border border-amber-400/20 rounded-lg p-2"><AlertTriangle size={12} className="mt-0.5 shrink-0 text-amber-300" />{c}</div>)}
                    </div>
                  )}
                  <div className="max-h-64 overflow-y-auto scroll-thin space-y-0.5">
                    {t.actions.map((a, i) => {
                      const done = (t.applied || []).includes(i);
                      const Icon = ICONS[a.kind] || Sparkles;
                      return (
                        <label key={i} className={`flex items-start gap-2.5 px-1.5 py-1.5 rounded-xl ${done ? 'opacity-50' : 'hover:bg-white/[0.04] cursor-pointer'}`}>
                          <input type="checkbox" disabled={done} checked={done || sel.has(i)} onChange={() => togglePick(t, i)} className="mt-1" />
                          <Icon size={14} className="text-emerald-300 mt-0.5 shrink-0" />
                          <span className="flex-1 min-w-0">
                            <span className="block text-[12.5px] text-zinc-100 font-medium">{a.label}{done ? ' (added)' : ''}</span>
                            <span className="block text-[11px] text-zinc-400 leading-snug">{a.why}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                  {remaining.length > 0 && (
                    <Btn kind="primary" className="w-full mt-2 py-2 text-[13px]" disabled={![...sel].some((i) => remaining.includes(i))} onClick={() => { onApply(t.id, [...sel].filter((i) => remaining.includes(i))); setPreviewing(null); onPreview(null); }}>
                      <Check size={14} /> Add {[...sel].filter((i) => remaining.includes(i)).length} to my design
                    </Btn>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {busy && (
          <div className="rounded-2xl bg-zinc-950/60 border hairline px-4 py-3 text-[13px] text-zinc-200 flex items-center gap-3" data-thinking>
            <Loader2 size={16} className="animate-spin text-emerald-300" />
            <div className="flex-1">
              <div>{busy.mode === 'design' ? 'Reading the land and drawing a design' : 'Thinking about your land'}<span className="animate-breathe">...</span></div>
              <div className="text-[11px] text-zinc-400">{elapsed}s. {busy.mode === 'design' ? 'A full design usually takes 30 to 90 seconds.' : 'Usually under a minute.'}</div>
            </div>
          </div>
        )}
        {err && <div className="rounded-2xl border border-red-400/30 bg-red-400/10 p-3 text-xs text-red-100" data-ai-error>{err}</div>}
      </div>

      <div className="border-t hairline p-4 space-y-3">
        {mode === 'design' ? (
          <>
            <div className="flex flex-wrap gap-1.5">{GOALS.map((g) => <Chip key={g} active={goals.includes(g)} onClick={() => onGoals(goals.includes(g) ? goals.filter((x) => x !== g) : [...goals, g])}>{g}</Chip>)}</div>
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="Anything else? e.g. family of four, two goats, budget $5,000, keep the big oak" className="w-full bg-zinc-950/70 border border-white/10 rounded-xl px-3 py-2 text-[13px] text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-emerald-400/60 resize-none" />
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-[11px] text-zinc-400 cursor-pointer"><input type="checkbox" checked={deep} onChange={(e) => setDeep(e.target.checked)} />Deeper design (slower)</label>
              <Btn kind="primary" className="flex-1 py-2.5 text-[13px]" disabled={!!busy || available === false} onClick={() => run('design', text)}><Wand2 size={15} /> Draw me a design</Btn>
            </div>
          </>
        ) : (
          <>
            {turns.length === 0 && <div className="flex flex-wrap gap-1.5">{STARTERS.map((s) => <Chip key={s} onClick={() => run('ask', s)}>{s}</Chip>)}</div>}
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) run('ask', text.trim()); }}>
              <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask about your land..." className="flex-1 bg-zinc-950/70 border border-white/10 rounded-xl px-3 py-2.5 text-[13px] text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-emerald-400/60" data-ask-input />
              <button disabled={!!busy || !text.trim() || available === false} className="w-11 rounded-xl bg-emerald-400 text-emerald-950 flex items-center justify-center disabled:opacity-40" title="Send"><Send size={16} /></button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
