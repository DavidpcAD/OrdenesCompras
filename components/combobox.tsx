"use client";

import { useMemo, useState } from "react";

// Selector con buscador (un solo valor). Igual al estilo de la app de digitación:
// escribís y filtra, la opción elegida queda resaltada.
export function Combobox<T>({
  items,
  value,
  onChange,
  getKey,
  getLabel,
  getSearch,
  placeholder = "Buscar…",
  max = 50,
}: {
  items: T[];
  value: string;
  onChange: (key: string, item: T | null) => void;
  getKey: (t: T) => string;
  getLabel: (t: T) => string;
  getSearch?: (t: T) => string;
  placeholder?: string;
  max?: number;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const sel = items.find((i) => getKey(i) === value) ?? null;
  const q = query.trim().toLowerCase();
  // Al abrir muestra TODAS las opciones (con scroll); al escribir, filtra.
  const matched = useMemo(
    () => (q ? items.filter((i) => (getSearch ? getSearch(i) : getLabel(i)).toLowerCase().includes(q)) : items),
    [items, q] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const filtered = matched.slice(0, max);

  return (
    <div className="combo">
      <input
        className="ds-form-field__input"
        placeholder={placeholder}
        value={open ? query : sel ? getLabel(sel) : ""}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => { setQuery(""); setOpen(true); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && (
        <div className="combo__menu">
          {filtered.length === 0 && <div className="combo__empty">{q ? "Sin coincidencias." : "No hay opciones."}</div>}
          {filtered.map((i) => (
            <button
              key={getKey(i)}
              type="button"
              className={`combo__item ${getKey(i) === value ? "is-active" : ""}`}
              onMouseDown={(e) => { e.preventDefault(); onChange(getKey(i), i); setOpen(false); }}
            >
              {getLabel(i)}
            </button>
          ))}
          {matched.length > max && <div className="combo__more">Mostrando {max} de {matched.length} · escribí para filtrar</div>}
        </div>
      )}
    </div>
  );
}
