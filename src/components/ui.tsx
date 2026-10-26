import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, X, Check } from 'lucide-react';

export const SidebarPanel = ({ title, icon: Icon, children, defaultOpen = true, right }: {
  title: string; icon: any; children: React.ReactNode; defaultOpen?: boolean; right?: React.ReactNode;
}) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="mx-3 my-2.5 rounded-2xl bg-zinc-900/60 border hairline overflow-hidden">
      <button onClick={() => setOpen(!open)} className="w-full px-4 py-3 flex items-center justify-between hover:bg-white/[0.02] transition-colors text-zinc-100">
        <div className="flex items-center gap-2.5 font-medium text-[13px] tracking-[0.01em]">
          <span className="w-6 h-6 rounded-lg bg-emerald-400/10 text-emerald-300 flex items-center justify-center"><Icon size={13} /></span>{title}
        </div>
        <div className="flex items-center gap-2">{right}<ChevronDown size={15} className={`text-zinc-500 transition-transform ${open ? '' : '-rotate-90'}`} /></div>
      </button>
      {open && <div className="px-4 pb-4 pt-1 text-sm text-zinc-400 space-y-4 animate-rise">{children}</div>}
    </section>
  );
};

export const Slider = ({ label, value, min, max, step = 1, onChange, display, accent = 'emerald' }: {
  label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; display?: string; accent?: 'emerald' | 'blue' | 'amber';
}) => (
  <div>
    <div className="flex justify-between items-baseline mb-1.5">
      <label className="text-[11px] text-zinc-400 font-medium">{label}</label>
      <span className="text-[11px] text-zinc-200 font-mono tabular-nums">{display ?? value}</span>
    </div>
    <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))}
      className={`w-full cursor-pointer ${accent === 'blue' ? 'accent-blue-500' : accent === 'amber' ? 'accent-amber-500' : 'accent-emerald-500'}`} />
  </div>
);

export const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div><label className="block text-[11px] text-zinc-400 font-medium mb-1.5">{label}</label>{children}</div>
);

export const inputCls = 'w-full bg-zinc-950/70 border border-zinc-700/70 rounded-lg px-2.5 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-emerald-400/70 focus:ring-2 focus:ring-emerald-400/15 transition';

export const Toggle = ({ label, checked, onChange, id }: { label: string; checked: boolean; onChange: (v: boolean) => void; id: string }) => (
  <label htmlFor={id} className="flex items-center justify-between gap-3 cursor-pointer select-none group">
    <span className="text-[13px] text-zinc-200">{label}</span>
    <input type="checkbox" id={id} checked={checked} onChange={(e) => onChange(e.target.checked)} className="sr-only peer" />
    <span className="relative w-8 h-[18px] rounded-full bg-zinc-700 peer-checked:bg-emerald-500 transition-colors shrink-0 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:w-[14px] after:h-[14px] after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-[14px]" />
  </label>
);

export const Btn = ({ children, onClick, kind = 'plain', className = '', title, disabled }: {
  children: React.ReactNode; onClick?: () => void; kind?: 'plain' | 'primary' | 'danger' | 'blue' | 'ghost'; className?: string; title?: string; disabled?: boolean;
}) => {
  const k = {
    plain: 'bg-zinc-800/80 hover:bg-zinc-700/80 text-zinc-100 border border-zinc-700/60',
    primary: 'bg-emerald-400 hover:bg-emerald-300 text-emerald-950 font-semibold shadow-glow',
    danger: 'bg-red-500/10 hover:bg-red-500/20 text-red-300 border border-red-500/25',
    blue: 'bg-sky-500/15 hover:bg-sky-500/25 text-sky-200 border border-sky-400/30',
    ghost: 'hover:bg-white/5 text-zinc-300',
  }[kind];
  return (
    <button title={title} disabled={disabled} onClick={onClick} className={`flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none ${k} ${className}`}>
      {children}
    </button>
  );
};

export const Modal = ({ title, onClose, children, wide, subtitle }: { title: string; onClose?: () => void; children: React.ReactNode; wide?: boolean; subtitle?: string }) => (
  <div className="fixed inset-0 z-50 bg-black/55 backdrop-blur-md flex items-center justify-center p-4 no-print" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
    <div className={`bg-zinc-900 border hairline rounded-3xl shadow-glass w-full ${wide ? 'max-w-4xl' : 'max-w-lg'} max-h-[90vh] flex flex-col animate-sheet`}>
      <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b hairline">
        <div>
          <h2 className="text-zinc-50 font-display text-xl font-medium tracking-tight">{title}</h2>
          {subtitle && <p className="text-xs text-zinc-400 mt-0.5">{subtitle}</p>}
        </div>
        {onClose && <button onClick={onClose} className="w-8 h-8 -mr-2 rounded-full flex items-center justify-center text-zinc-400 hover:text-zinc-100 hover:bg-white/5" title="Close"><X size={17} /></button>}
      </div>
      <div className="p-6 overflow-y-auto scroll-thin">{children}</div>
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
      <button onClick={() => setOpen(!open)} className={`px-3 py-1.5 rounded-lg text-[13px] text-zinc-300 transition-colors ${open ? 'bg-white/10 text-zinc-50' : 'hover:bg-white/5'}`}>{label}</button>
      {open && (
        <div className="absolute right-0 top-full mt-2 w-72 glass rounded-2xl shadow-glass p-1.5 z-50 animate-rise">
          {items.map((it, i) => it.divider ? <div key={i} className="h-px bg-white/5 my-1.5 mx-2" /> : (
            <button key={i} disabled={it.disabled} onClick={() => { setOpen(false); it.onClick?.(); }}
              className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-[13px] text-zinc-200 hover:bg-white/[0.06] disabled:opacity-40 text-left">
              <span className="flex items-center gap-2"><span className="w-3.5 text-emerald-300">{it.checked ? <Check size={13} /> : ''}</span>{it.label}</span>
              {it.hint && <span className="text-[11px] text-zinc-500 font-mono">{it.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export const Stat = ({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) => (
  <div className="bg-zinc-950/50 border hairline rounded-xl px-3 py-2.5">
    <div className="text-[10px] uppercase tracking-[0.08em] text-zinc-500 font-medium">{label}</div>
    <div className="text-zinc-50 text-[15px] font-semibold tabular-nums mt-0.5 leading-tight">{value}</div>
    {sub && <div className="text-[11px] text-zinc-500 mt-0.5 leading-snug">{sub}</div>}
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

/** Pill row for picking one of a few options. */
export function Segmented<T extends string | number>({ value, options, onChange, size = 'sm' }: { value: T; options: { id: NoInfer<T>; label: React.ReactNode; title?: string }[]; onChange: (v: NoInfer<T>) => void; size?: 'sm' | 'md' }) {
  return (
    <div className="flex p-0.5 rounded-xl bg-zinc-950/70 border hairline gap-0.5">
      {options.map((o) => (
        <button key={String(o.id)} title={o.title} onClick={() => onChange(o.id)}
          className={`flex-1 rounded-[10px] ${size === 'md' ? 'px-3 py-1.5 text-[13px]' : 'px-2 py-1 text-[11px]'} font-medium transition-all whitespace-nowrap ${value === o.id ? 'bg-zinc-700/80 text-zinc-50 shadow' : 'text-zinc-400 hover:text-zinc-200'}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export const Chip = ({ children, active, onClick, color }: { children: React.ReactNode; active?: boolean; onClick?: () => void; color?: string }) => (
  <button onClick={onClick} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${active ? 'bg-emerald-400/15 border-emerald-400/50 text-emerald-200' : 'border-zinc-700/70 text-zinc-300 hover:border-zinc-500'}`}>
    {color && <span className="w-2 h-2 rounded-full" style={{ background: color }} />}{children}
  </button>
);

/** Score ring: 0 to 100. */
export const Ring = ({ value, size = 56, stroke = 5, color = '#8acf52', label }: { value: number; size?: number; stroke?: number; color?: string; label?: React.ReactNode }) => {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.08)" strokeWidth={stroke} fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - Math.max(0, Math.min(100, value)) / 100)} style={{ transition: 'stroke-dashoffset .6s ease' }} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-zinc-50 font-semibold tabular-nums" style={{ fontSize: size * 0.28 }}>{label ?? Math.round(value)}</div>
    </div>
  );
};

/** Full-height sheet that slides over the 3D view for the big workspaces. */
export const Sheet = ({ title, subtitle, icon: Icon, onClose, children, actions }: { title: string; subtitle?: string; icon: any; onClose: () => void; children: React.ReactNode; actions?: React.ReactNode }) => (
  <div className="absolute inset-0 z-30 p-3 no-print" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="h-full glass rounded-3xl shadow-glass flex flex-col overflow-hidden animate-sheet">
      <div className="flex items-center gap-3 px-6 py-4 border-b hairline">
        <span className="w-9 h-9 rounded-xl bg-emerald-400/15 text-emerald-300 flex items-center justify-center"><Icon size={18} /></span>
        <div className="flex-1 min-w-0">
          <h2 className="font-display text-[22px] leading-tight text-zinc-50 tracking-tight">{title}</h2>
          {subtitle && <p className="text-xs text-zinc-400 truncate">{subtitle}</p>}
        </div>
        {actions}
        <button onClick={onClose} title="Back to the land (Esc)" className="w-9 h-9 rounded-full flex items-center justify-center text-zinc-300 hover:text-white hover:bg-white/10"><X size={18} /></button>
      </div>
      <div className="flex-1 overflow-y-auto scroll-thin">{children}</div>
    </div>
  </div>
);
