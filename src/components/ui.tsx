import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, X } from 'lucide-react';

export const SidebarPanel = ({ title, icon: Icon, children, defaultOpen = true, right }: {
  title: string; icon: any; children: React.ReactNode; defaultOpen?: boolean; right?: React.ReactNode;
}) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-zinc-800">
      <button onClick={() => setOpen(!open)} className="w-full px-4 py-3 flex items-center justify-between bg-zinc-950 hover:bg-zinc-900 transition-colors text-zinc-200">
        <div className="flex items-center gap-2 font-medium text-sm tracking-wide"><Icon size={16} className="text-zinc-400" />{title}</div>
        <div className="flex items-center gap-2">{right}{open ? <ChevronDown size={16} className="text-zinc-500" /> : <ChevronRight size={16} className="text-zinc-500" />}</div>
      </button>
      {open && <div className="p-4 bg-zinc-950/50 text-sm text-zinc-400 space-y-4">{children}</div>}
    </div>
  );
};

export const Slider = ({ label, value, min, max, step = 1, onChange, display, accent = 'emerald' }: {
  label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; display?: string; accent?: 'emerald' | 'blue' | 'amber';
}) => (
  <div>
    <div className="flex justify-between mb-1">
      <label className="text-xs text-zinc-500 uppercase tracking-wider">{label}</label>
      <span className="text-xs text-zinc-300 font-mono">{display ?? value}</span>
    </div>
    <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))}
      className={`w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer ${accent === 'blue' ? 'accent-blue-500' : accent === 'amber' ? 'accent-amber-500' : 'accent-emerald-500'}`} />
  </div>
);

export const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div><label className="block text-xs text-zinc-500 mb-1 uppercase tracking-wider">{label}</label>{children}</div>
);

export const inputCls = 'w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-emerald-500';

export const Toggle = ({ label, checked, onChange, id }: { label: string; checked: boolean; onChange: (v: boolean) => void; id: string }) => (
  <div className="flex items-center gap-2">
    <input type="checkbox" id={id} checked={checked} onChange={(e) => onChange(e.target.checked)} className="w-4 h-4 rounded accent-emerald-500" />
    <label htmlFor={id} className="text-sm text-zinc-300 cursor-pointer select-none">{label}</label>
  </div>
);

export const Btn = ({ children, onClick, kind = 'plain', className = '', title, disabled }: {
  children: React.ReactNode; onClick?: () => void; kind?: 'plain' | 'primary' | 'danger' | 'blue'; className?: string; title?: string; disabled?: boolean;
}) => {
  const k = {
    plain: 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700',
    primary: 'bg-emerald-600 hover:bg-emerald-500 text-white',
    danger: 'bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30',
    blue: 'bg-blue-600/15 hover:bg-blue-600/25 text-blue-300 border border-blue-500/40',
  }[kind];
  return (
    <button title={title} disabled={disabled} onClick={onClick} className={`flex items-center justify-center gap-2 px-3 py-1.5 rounded text-xs font-medium transition-colors disabled:opacity-40 ${k} ${className}`}>
      {children}
    </button>
  );
};

export const Modal = ({ title, onClose, children, wide }: { title: string; onClose?: () => void; children: React.ReactNode; wide?: boolean }) => (
  <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 no-print" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
    <div className={`bg-zinc-950 border border-zinc-800 rounded-xl shadow-2xl w-full ${wide ? 'max-w-4xl' : 'max-w-lg'} max-h-[90vh] flex flex-col`}>
      <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
        <h2 className="text-zinc-100 font-semibold">{title}</h2>
        {onClose && <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200" title="Close"><X size={18} /></button>}
      </div>
      <div className="p-5 overflow-y-auto scroll-thin">{children}</div>
    </div>
  </div>
);

export interface MenuItem { label: string; onClick?: () => void; hint?: string; divider?: boolean; checked?: boolean; disabled?: boolean }

export const Menu = ({ label, items }: { label: string; items: MenuItem[] }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(!open)} className={`px-3 py-1.5 rounded-md text-zinc-300 transition-colors ${open ? 'bg-zinc-800' : 'hover:bg-zinc-800'}`}>{label}</button>
      {open && (
        <div className="absolute left-0 top-full mt-1 w-64 bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl py-1 z-50">
          {items.map((it, i) => it.divider ? <div key={i} className="h-px bg-zinc-800 my-1" /> : (
            <button key={i} disabled={it.disabled} onClick={() => { setOpen(false); it.onClick?.(); }}
              className="w-full flex items-center justify-between px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-40 text-left">
              <span className="flex items-center gap-2"><span className="w-3 text-emerald-400">{it.checked ? '✓' : ''}</span>{it.label}</span>
              {it.hint && <span className="text-xs text-zinc-500">{it.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export const Stat = ({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) => (
  <div className="bg-zinc-900/70 border border-zinc-800 rounded-md px-3 py-2">
    <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
    <div className="text-zinc-100 text-sm font-medium">{value}</div>
    {sub && <div className="text-[11px] text-zinc-500">{sub}</div>}
  </div>
);

/** A button that asks "Click again to confirm" instead of opening a browser dialog. */
export const ConfirmBtn = ({ children, confirmText = 'Click again to confirm', onConfirm, className = '', kind = 'danger', title }: {
  children: React.ReactNode; confirmText?: string; onConfirm: () => void; className?: string; kind?: 'plain' | 'danger'; title?: string;
}) => {
  const [armed, setArmed] = useState(false);
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 3000); return () => clearTimeout(t); }, [armed]);
  return <Btn kind={kind} title={title} className={className} onClick={() => { if (armed) { setArmed(false); onConfirm(); } else setArmed(true); }}>{armed ? confirmText : children}</Btn>;
};
