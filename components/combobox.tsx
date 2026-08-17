"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

// Selector con buscador (un solo valor). El menú se renderiza en un PORTAL con
// posición fija, así NUNCA lo recorta un contenedor con overflow (paneles, cards,
// tablas). Se reposiciona al hacer scroll/resize y se voltea hacia arriba si no
// hay espacio abajo. Lupa a la izquierda + chevron a la derecha.
//
// TECLADO (antes no había): ↓/↑ recorren las opciones, Enter elige la resaltada,
// Escape cierra, Tab cierra y sigue. Sin esto no se podía elegir un proveedor sin
// mouse — las opciones solo respondían a `onMouseDown`. Semántica ARIA de combobox
// + listbox para que un lector de pantalla anuncie la opción activa.
export function Combobox<T>({
  items,
  value,
  onChange,
  getKey,
  getLabel,
  getSearch,
  renderItem,
  groupBy,
  placeholder = "Buscar…",
  max = 50,
  minChars = 0,
  id,
}: {
  items: T[];
  value: string;
  onChange: (key: string, item: T | null) => void;
  getKey: (t: T) => string;
  getLabel: (t: T) => string;
  getSearch?: (t: T) => string;
  // Contenido personalizado de cada fila del menú (si no, usa getLabel).
  renderItem?: (t: T) => ReactNode;
  // Si se pasa, agrupa las opciones bajo encabezados de sección.
  groupBy?: (t: T) => string;
  placeholder?: string;
  max?: number;
  // Mínimo de caracteres para mostrar opciones. Con 0 (default) al abrir muestra
  // todo (útil para listas cortas). Con >0 no precarga nada: hay que escribir.
  minChars?: number;
  // id del input (para asociar un <label htmlFor> — lo pasa Field automáticamente).
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; bottom: number; width: number; up: boolean } | null>(null);
  const uid = useId();
  const listboxId = `${uid}-listbox`;
  const optId = (i: number) => `${uid}-opt-${i}`;

  const sel = items.find((i) => getKey(i) === value) ?? null;
  const q = query.trim().toLowerCase();
  const below = q.length < minChars;
  const matched = useMemo(
    () => (below ? [] : q ? items.filter((i) => (getSearch ? getSearch(i) : getLabel(i)).toLowerCase().includes(q)) : items),
    [items, q, below] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const filtered = matched.slice(0, max);

  // Opción resaltada (índice dentro de `filtered`). -1 = ninguna.
  const [activo, setActivo] = useState(-1);
  // Al cambiar la búsqueda o al abrir, resaltar la primera (o la ya elegida).
  useEffect(() => {
    if (!open) { setActivo(-1); return; }
    const iSel = filtered.findIndex((i) => getKey(i) === value);
    setActivo(filtered.length ? (iSel >= 0 ? iSel : 0) : -1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, q, filtered.length]);

  // Mantener visible la opción resaltada al moverse con el teclado.
  useEffect(() => {
    if (!open || activo < 0) return;
    const el = menuRef.current?.querySelector<HTMLElement>(`#${CSS.escape(optId(activo))}`);
    el?.scrollIntoView({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activo, open]);

  function elegir(i: T | undefined) {
    if (!i) return;
    onChange(getKey(i), i);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      if (!filtered.length) return;
      setActivo((a) => {
        const paso = e.key === "ArrowDown" ? 1 : -1;
        const next = a < 0 ? (paso > 0 ? 0 : filtered.length - 1) : a + paso;
        return (next + filtered.length) % filtered.length;   // circular
      });
      return;
    }
    if (e.key === "Enter") {
      if (open && activo >= 0 && filtered[activo]) { e.preventDefault(); elegir(filtered[activo]); }
      return;
    }
    if (e.key === "Escape") {
      if (open) { e.preventDefault(); setOpen(false); }
      return;
    }
    if (e.key === "Tab" && open) setOpen(false);
  }

  function reposition() {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom;
    // Si abajo hay poco espacio y arriba hay más, se abre hacia arriba.
    const up = spaceBelow < 260 && r.top > spaceBelow;
    setPos({ left: r.left, top: r.bottom, bottom: window.innerHeight - r.top, width: r.width, up });
  }

  useLayoutEffect(() => { if (open) reposition(); /* eslint-disable-next-line */ }, [open]);
  useEffect(() => {
    if (!open) return;
    const h = () => reposition();
    window.addEventListener("scroll", h, true);
    window.addEventListener("resize", h);
    return () => { window.removeEventListener("scroll", h, true); window.removeEventListener("resize", h); };
  }, [open]);

  const menu = open && pos && createPortal(
    <div
      className="combo__menu"
      id={listboxId}
      role="listbox"
      ref={menuRef}
      style={{
        position: "fixed", left: pos.left, width: pos.width,
        ...(pos.up ? { bottom: pos.bottom + 6 } : { top: pos.top + 6 }),
      }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {filtered.length === 0 && <div className="combo__empty">{below ? "Escribí para buscar…" : q ? "Sin coincidencias." : "No hay opciones."}</div>}
      {(() => {
        const renderOpt = (i: T) => {
          const idx = filtered.indexOf(i);
          return (
            <button
              key={getKey(i)}
              id={optId(idx)}
              role="option"
              aria-selected={getKey(i) === value}
              tabIndex={-1}
              type="button"
              className={`combo__item ${getKey(i) === value ? "is-active" : ""}${idx === activo ? " is-focus" : ""}`}
              onMouseEnter={() => setActivo(idx)}
              onMouseDown={(e) => { e.preventDefault(); elegir(i); }}
            >
              {renderItem ? renderItem(i) : getLabel(i)}
            </button>
          );
        };
        if (!groupBy) return filtered.map(renderOpt);
        // Agrupa preservando el orden de aparición de cada grupo.
        const orden: string[] = [];
        const map = new Map<string, T[]>();
        for (const i of filtered) { const g = groupBy(i); if (!map.has(g)) { map.set(g, []); orden.push(g); } map.get(g)!.push(i); }
        return orden.map((g) => (
          <div key={g} className="combo__group-wrap" role="group" aria-label={g}>
            <div className="combo__group">{g} · {map.get(g)!.length}</div>
            {map.get(g)!.map(renderOpt)}
          </div>
        ));
      })()}
      {matched.length > max && <div className="combo__more">Mostrando {max} de {matched.length} · escribí para filtrar</div>}
    </div>,
    document.body
  );

  return (
    <div className="combo" ref={wrapRef}>
      <span className="combo__icon" aria-hidden>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
      </span>
      <input
        id={id}
        className="ds-form-field__input combo__input"
        placeholder={placeholder}
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={open && activo >= 0 ? optId(activo) : undefined}
        autoComplete="off"
        value={open ? query : sel ? getLabel(sel) : ""}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => { setQuery(""); setOpen(true); }}
        onKeyDown={onKeyDown}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      <span className={`combo__chev${open ? " is-open" : ""}`} aria-hidden>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
      </span>
      {menu}
    </div>
  );
}
