import React, { useEffect, useState } from 'react';
import { Search, MapPin, Loader2, CheckCircle2, AlertTriangle, XCircle, Circle, Trash2, FolderOpen, Box, Sprout } from 'lucide-react';
import { geocode, reverseGeocode, GeoResult, listProjects, ProjectSummary, deleteProject, fetchImagery } from '../lib/api';
import { buildSiteProject, blankProject, SITE_STEPS, Step } from '../lib/siteLoader';
import type { Project } from '../lib/types';
import { SITE_SIZES } from '../lib/units';
import { Btn, inputCls, ConfirmBtn } from './ui';

interface Props {
  canClose: boolean;
  onClose: () => void;
  onOpenProject: (id: string) => void;
  onCreated: (p: Project, satellite: HTMLCanvasElement | null) => void;
  initialQuery?: string;
}

export default function StartDialog({ canClose, onClose, onOpenProject, onCreated, initialQuery = '' }: Props) {
  const [q, setQ] = useState(initialQuery);
  const [results, setResults] = useState<GeoResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [pick, setPick] = useState<GeoResult | null>(null);
  const [size, setSize] = useState(200);
  const [n, setN] = useState(128);
  const [name, setName] = useState('');
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);

  const refresh = () => listProjects().then(setProjects).catch(() => setProjects([]));
  useEffect(() => { refresh(); }, []);
  useEffect(() => { if (initialQuery) search(initialQuery); }, []);

  async function search(text = q) {
    if (!text.trim()) return;
    setSearching(true); setError(''); setResults(null); setPick(null);
    try {
      const r = await geocode(text);
      setResults(r);
      if (r.length === 1) choose(r[0]);
      if (!r.length) setError('No match. Try adding the city and state, or paste coordinates like 40.0150, -105.2705.');
    } catch (e: any) { setError(e.message); }
    setSearching(false);
  }

  function choose(r: GeoResult) {
    setPick(r);
    setName(r.label.split(',').slice(0, 2).join(',').trim() || 'My site');
    if (r.kind === 'coordinates') {
      // pasted coordinates: look up what is there so the project gets a real name
      reverseGeocode(r.lat, r.lon).then((label) => {
        setPick((p) => (p && p.lat === r.lat && p.lon === r.lon ? { ...p, label } : p));
        setName((n) => (n === r.label.split(',').slice(0, 2).join(',').trim() ? label.split(',').slice(0, 2).join(',').trim() : n));
      }).catch(() => {});
    }
  }

  async function build() {
    if (!pick) return;
    const st = SITE_STEPS.map((s) => ({ ...s }));
    setSteps(st);
    const mark = (key: string, state: Step['state'], detail?: string) =>
      setSteps((prev) => prev!.map((s) => (s.key === key ? { ...s, state, detail: detail ?? s.detail } : s)));
    try {
      let address = pick.label, projectName = name || 'My site';
      if (pick.kind === 'coordinates' && /^-?\d/.test(address)) {
        // the reverse lookup may still be in flight; wait for it so the project gets a real name
        const label = await reverseGeocode(pick.lat, pick.lon).catch(() => '');
        if (label && !/^-?\d/.test(label)) {
          address = label;
          if (projectName === pick.label.split(',').slice(0, 2).join(',').trim()) projectName = label.split(',').slice(0, 2).join(',').trim();
        }
      }
      const project = await buildSiteProject({ name: projectName, address, lat: pick.lat, lon: pick.lon, size, n }, mark);
      mark('imagery', 'run');
      let sat: HTMLCanvasElement | null = null;
      try {
        sat = await fetchImagery(pick.lat, pick.lon, size, (f) => mark('imagery', 'run', `${Math.round(f * 100)}%`));
        mark('imagery', 'ok', 'Esri World Imagery');
      } catch (e: any) { mark('imagery', 'warn', `Not available: ${e.message}`); }
      onCreated(project, sat);
    } catch (e: any) {
      setError(`Could not build the site: ${e.message}`);
    }
  }

  const busy = steps && !error;
  const icon = (s: Step) => ({
    wait: <Circle size={16} className="text-zinc-600" />, run: <Loader2 size={16} className="text-emerald-400 animate-spin" />,
    ok: <CheckCircle2 size={16} className="text-emerald-400" />, warn: <AlertTriangle size={16} className="text-amber-400" />, fail: <XCircle size={16} className="text-red-400" />,
  })[s.state];

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 no-print" onMouseDown={(e) => { if (e.target === e.currentTarget && canClose && !busy) onClose(); }}>
      <div className="bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto scroll-thin">
        <div className="px-7 pt-7 pb-5 border-b border-zinc-800">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-emerald-600 to-teal-800 flex items-center justify-center"><Sprout size={20} className="text-white" /></div>
            <h1 className="text-xl font-semibold text-zinc-100">Permascape 3D</h1>
          </div>
          <p className="text-sm text-zinc-400">Type any address. The land comes in with its real slope, a satellite photo, rainfall, frost dates and soil, ready to design on.</p>
        </div>

        <div className="px-7 py-5 space-y-4">
          <form onSubmit={(e) => { e.preventDefault(); search(); }} className="flex gap-2">
            <div className="relative flex-1">
              <MapPin size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} disabled={!!busy}
                placeholder="Address, place, or coordinates (40.0150, -105.2705)"
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg pl-9 pr-3 py-2.5 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500" />
            </div>
            <button type="submit" disabled={!!busy || searching} className="px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium flex items-center gap-2 disabled:opacity-50">
              {searching ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />} Find
            </button>
          </form>

          {error && <div className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</div>}

          {results && results.length > 1 && !pick && (
            <div data-geo-results className="border border-zinc-800 rounded-lg divide-y divide-zinc-800">
              {results.map((r, i) => (
                <button key={i} onClick={() => choose(r)} className="w-full text-left px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-900 flex gap-2">
                  <MapPin size={14} className="mt-0.5 text-emerald-500 shrink-0" />{r.label}
                </button>
              ))}
            </div>
          )}

          {pick && !steps && (
            <div className="border border-emerald-700/40 bg-emerald-900/10 rounded-lg p-4 space-y-3">
              <div className="text-sm text-zinc-200 flex gap-2"><MapPin size={15} className="mt-0.5 text-emerald-400 shrink-0" /><span>{pick.label}<span className="block text-xs text-zinc-500 font-mono">{pick.lat.toFixed(5)}, {pick.lon.toFixed(5)}</span></span></div>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-3">
                  <label className="block text-xs text-zinc-500 mb-1 uppercase tracking-wider">Project name</label>
                  <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs text-zinc-500 mb-1 uppercase tracking-wider">Site size (square, centred on the address)</label>
                  <select value={size} onChange={(e) => setSize(Number(e.target.value))} className={inputCls}>
                    {SITE_SIZES.map((s) => <option key={s.m} value={s.m}>{s.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-zinc-500 mb-1 uppercase tracking-wider">Detail</label>
                  <select value={n} onChange={(e) => setN(Number(e.target.value))} className={inputCls}>
                    <option value={64}>Fast</option>
                    <option value={128}>Standard</option>
                    <option value={256}>High</option>
                  </select>
                </div>
              </div>
              <div className="text-xs text-zinc-500">Terrain cell: {(size / n).toFixed(1)} m. In the US the slope comes from USGS lidar at 1 m; elsewhere from global terrain data.</div>
              <div className="flex gap-2">
                <Btn kind="primary" onClick={build} className="flex-1 py-2 text-sm">Build this site</Btn>
                <Btn onClick={() => { setPick(null); }} className="py-2">Back</Btn>
              </div>
            </div>
          )}

          {steps && (
            <div className="border border-zinc-800 rounded-lg p-4 space-y-2">
              {steps.map((s) => (
                <div key={s.key} className="flex items-start gap-3 text-sm">
                  <div className="mt-0.5">{icon(s)}</div>
                  <div><div className="text-zinc-200">{s.label}</div>{s.detail && <div className="text-xs text-zinc-500">{s.detail}</div>}</div>
                </div>
              ))}
              {error && <Btn onClick={() => { setSteps(null); setError(''); }}>Try again</Btn>}
            </div>
          )}
        </div>

        {!steps && (
          <div className="px-7 pb-7">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[11px] uppercase tracking-widest text-zinc-500 font-bold">Your projects</div>
              <button onClick={() => onCreated(blankProject(), null)} className="text-xs text-zinc-400 hover:text-emerald-400 flex items-center gap-1"><Box size={13} /> Blank flat sandbox</button>
            </div>
            {projects === null ? <div className="text-sm text-zinc-500">Loading...</div> : projects.length === 0 ? (
              <div className="text-sm text-zinc-500 border border-dashed border-zinc-800 rounded-lg p-4 text-center">No projects yet. Find an address above to start your first design.</div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {projects.map((p) => (
                  <div key={p.id} className="group border border-zinc-800 rounded-lg overflow-hidden hover:border-emerald-600/60 bg-zinc-900/40">
                    <button onClick={() => onOpenProject(p.id)} className="w-full text-left">
                      <div className="h-24 bg-zinc-900 flex items-center justify-center overflow-hidden">
                        {p.thumb ? <img src={p.thumb} alt="" className="w-full h-full object-cover" /> : <FolderOpen className="text-zinc-700" />}
                      </div>
                      <div className="px-3 py-2">
                        <div className="text-sm text-zinc-100 truncate">{p.name}</div>
                        <div className="text-[11px] text-zinc-500 truncate">{p.address || 'Sandbox'}</div>
                        <div className="text-[11px] text-zinc-600">{p.objects} elements · {new Date(p.updated).toLocaleDateString()}</div>
                      </div>
                    </button>
                    <div className="px-3 pb-2 flex justify-end">
                      <ConfirmBtn kind="plain" title="Delete project" className="!px-2 !py-0.5 !bg-transparent !border-0 text-zinc-500 hover:!text-red-400" confirmText="Delete it?" onConfirm={async () => { await deleteProject(p.id); refresh(); }}><Trash2 size={13} /></ConfirmBtn>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {canClose && <div className="mt-4 flex justify-end"><Btn onClick={onClose}>Back to my design</Btn></div>}
          </div>
        )}
      </div>
    </div>
  );
}
