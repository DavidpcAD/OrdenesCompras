"use client";

import { useEffect, useMemo, useRef, useState } from "react";

// Date picker con calendario propio, estilo Adelante DS (en vez del calendario
// nativo del navegador). value/onChange en ISO "yyyy-mm-dd".
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const DOW = ["L", "M", "M", "J", "V", "S", "D"];

function parseISO(iso?: string): { y: number; m: number; d: number } | null {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return null;
  return { y, m: m - 1, d };
}
const pad = (n: number) => String(n).padStart(2, "0");
const toISO = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
const fmt = (iso?: string) => { const p = parseISO(iso); return p ? `${pad(p.d)}/${pad(p.m + 1)}/${p.y}` : ""; };

export function DateField({ value, onChange, min, max, placeholder = "Elegí una fecha" }: {
  value: string; onChange: (iso: string) => void; min?: string; max?: string; placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const sel = parseISO(value);
  const hoy = useMemo(() => { const t = new Date(); return { y: t.getFullYear(), m: t.getMonth(), d: t.getDate() }; }, []);
  const [viewY, setViewY] = useState(sel?.y ?? hoy.y);
  const [viewM, setViewM] = useState(sel?.m ?? hoy.m);

  useEffect(() => { if (open && sel) { setViewY(sel.y); setViewM(sel.m); } /* eslint-disable-next-line */ }, [open]);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  // Posiciona el calendario con position:fixed respecto al campo y lo abre hacia
  // ARRIBA si no hay espacio abajo (para que no lo tape la barra de acciones ni lo
  // recorte ningún contenedor). Se re-posiciona al hacer scroll o cambiar el tamaño.
  const POP_W = 300, POP_H = 380;
  const place = () => {
    const el = ref.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const cabeAbajo = r.bottom + 8 + POP_H <= vh;
    const cabeArriba = r.top - 8 - POP_H >= 0;
    const abajo = cabeAbajo || !cabeArriba;
    const top = abajo ? r.bottom + 8 : r.top - 8 - POP_H;
    const left = Math.max(8, Math.min(r.left, vw - POP_W - 8));
    setPos({ top, left });
  };
  useEffect(() => {
    if (!open) return;
    place();
    const onMove = () => place();
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => { window.removeEventListener("scroll", onMove, true); window.removeEventListener("resize", onMove); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const cells = useMemo(() => {
    const offset = (new Date(viewY, viewM, 1).getDay() + 6) % 7; // lunes primero
    const dim = new Date(viewY, viewM + 1, 0).getDate();
    const arr: (number | null)[] = [];
    for (let i = 0; i < offset; i++) arr.push(null);
    for (let d = 1; d <= dim; d++) arr.push(d);
    return arr;
  }, [viewY, viewM]);

  const prev = () => { if (viewM === 0) { setViewY(viewY - 1); setViewM(11); } else setViewM(viewM - 1); };
  const next = () => { if (viewM === 11) { setViewY(viewY + 1); setViewM(0); } else setViewM(viewM + 1); };
  const disabled = (d: number) => { const iso = toISO(viewY, viewM, d); return (!!min && iso < min) || (!!max && iso > max); };
  const pick = (d: number) => { if (disabled(d)) return; onChange(toISO(viewY, viewM, d)); setOpen(false); };

  return (
    <div ref={ref} className="datefield">
      <button type="button" className={`datefield__input${open ? " is-open" : ""}`} onClick={() => { if (!open) place(); setOpen((o) => !o); }}>
        <span className={value ? "" : "datefield__ph"}>{value ? fmt(value) : placeholder}</span>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="4" /><path d="M3 9h18M8 2v4M16 2v4" /></svg>
      </button>
      {open && (
        <div className="datefield__pop" style={{ position: "fixed", top: pos?.top ?? 0, left: pos?.left ?? 0, zIndex: 60 }}>
          <div className="datefield__head">
            <span className="datefield__my">{MESES[viewM]} {viewY}</span>
            <div className="datefield__nav">
              <button type="button" onClick={prev} aria-label="Mes anterior">‹</button>
              <button type="button" onClick={next} aria-label="Mes siguiente">›</button>
            </div>
          </div>
          <div className="datefield__grid datefield__dow">{DOW.map((d, i) => <span key={i}>{d}</span>)}</div>
          <div className="datefield__grid">
            {cells.map((d, i) => d == null ? <span key={i} /> : (
              <button key={i} type="button" disabled={disabled(d)} onClick={() => pick(d)}
                className={`datefield__day${sel && sel.y === viewY && sel.m === viewM && sel.d === d ? " is-sel" : ""}${hoy.y === viewY && hoy.m === viewM && hoy.d === d ? " is-today" : ""}`}>
                {d}
              </button>
            ))}
          </div>
          <div className="datefield__foot">
            <button type="button" onClick={() => { onChange(""); setOpen(false); }}>Borrar</button>
            <button type="button" onClick={() => { onChange(toISO(hoy.y, hoy.m, hoy.d)); setOpen(false); }}>Hoy</button>
          </div>
        </div>
      )}
    </div>
  );
}
