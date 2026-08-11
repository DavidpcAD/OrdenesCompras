"use client";

import React, { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from "react";
import { IconClose, IconChevronDown } from "@/components/icons";
import { haptic } from "@/lib/haptic";

// ---------------------------------------------------------------- Button
// Variantes del Adelante DS: green (primaria) · red (destructiva) · white/black ·
// ghost (blanco secundario) · outline (baja énfasis) · yellow. gray = deshabilitado.
type BtnVariant = "green" | "red" | "white" | "black" | "yellow" | "ghost" | "outline" | "gray";
type BtnSize = "sm" | "md" | "lg";

export function Button({
  variant = "green", size = "md", block, icon, className = "", children, ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: BtnVariant; size?: BtnSize; block?: boolean; icon?: boolean;
}) {
  // El DS solo tiene variantes green/red/white/black/gray. ghost/outline/yellow son
  // aliases de la app que se RENDERIZAN como clases reales del DS (secundario = white).
  const DS_VARIANT: Record<string, string> = { ghost: "white", outline: "white", yellow: "green" };
  const dsVariant = DS_VARIANT[variant] ?? variant;
  const cls = [
    "ds-btn", `ds-btn--${dsVariant}`,
    size !== "md" ? `ds-btn--${size}` : "",
    block ? "ds-btn--full" : "",
    icon ? "ds-btn--layout-icon" : "", className,
  ].filter(Boolean).join(" ");
  // Haptic del DS: vibración semántica al presionar (delete para destructiva).
  // El anillo de "pressed" lo maneja el CSS vía :active. onClick nativo se mantiene
  // para preservar activación por teclado.
  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!rest.disabled) (variant === "red" ? haptic.delete : haptic.select)();
    rest.onPointerDown?.(e);
  };
  return <button className={cls} {...rest} onPointerDown={onPointerDown}>{children}</button>;
}

// ---------------------------------------------------------------- Field
export function Field({
  label, help, warning, children,
}: { label: string; help?: string; warning?: boolean; children: React.ReactNode }) {
  // Asocia el label con el input (a11y): si el hijo es un elemento simple, le
  // inyecta un id y apunta el htmlFor ahí. Si ya trae id, se respeta. Si el hijo
  // no es un elemento único (fragmento/varios), cae a no asociar (sin romper).
  const autoId = useId();
  const isEl = React.isValidElement(children);
  const childId = isEl ? ((children as React.ReactElement).props.id ?? autoId) : undefined;
  const child = isEl && !(children as React.ReactElement).props.id
    ? React.cloneElement(children as React.ReactElement, { id: autoId })
    : children;
  return (
    <div className={`ds-form-field ${warning ? "ds-form-field--advertencia" : ""}`}>
      <label className="ds-form-field__label" htmlFor={childId}>{label}</label>
      <div className="ds-form-field__input-wrap">{child}</div>
      {help && <span className="ds-form-field__help">{help}</span>}
    </div>
  );
}

export const Input = (p: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input className="ds-form-field__input" {...p} />
);

// Dropdown propio (reemplaza al <select> nativo) para que el menú abierto siga
// el design system: menú redondeado, hover y opción activa. API compatible con
// el uso previo: value + onChange(e.target.value) + <option> hijos.
const textOf = (n: React.ReactNode): string => {
  if (n == null || n === false || n === true) return "";
  if (typeof n === "string" || typeof n === "number") return String(n);
  if (Array.isArray(n)) return n.map(textOf).join("");
  if (React.isValidElement(n)) return textOf((n.props as any).children);
  return "";
};
export function Select({
  value, onChange, children, disabled, className = "", style, placeholder = "Seleccioná…", id,
}: {
  value?: string | number;
  onChange?: (e: { target: { value: string } }) => void;
  children?: React.ReactNode;
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
  placeholder?: string;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const options = React.Children.toArray(children).flatMap((c) =>
    React.isValidElement(c) && c.type === "option"
      ? [{ value: String((c.props as any).value ?? ""), label: textOf((c.props as any).children) }]
      : []
  );
  const cur = String(value ?? "");
  const sel = options.find((o) => o.value === cur);
  // Dropdowns con varias opciones: buscador para escribir y filtrar (los muy cortos
  // no lo necesitan). Con buscador, el foco de apertura va al input.
  const searchable = options.length > 4;
  const visibles = searchable && q.trim() ? options.filter((o) => o.label.toLowerCase().includes(q.trim().toLowerCase())) : options;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const pick = (v: string) => { onChange?.({ target: { value: v } }); setOpen(false); setQ(""); triggerRef.current?.focus(); };
  const closeAndFocus = () => { setOpen(false); setQ(""); triggerRef.current?.focus(); };
  // Al abrir, llevar el foco a la opción seleccionada (o la primera) para navegar
  // con teclado. Con buscador, se deja el foco en el input (autoFocus).
  useEffect(() => {
    if (!open) { setQ(""); return; }
    if (searchable) return;
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []);
    (items.find((b) => b.getAttribute("aria-selected") === "true") ?? items[0])?.focus();
  }, [open, searchable]);
  const onMenuKey = (e: React.KeyboardEvent) => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []);
    const idx = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape") { e.preventDefault(); closeAndFocus(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); (items[idx + 1] ?? items[0])?.focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); (items[idx - 1] ?? items[items.length - 1])?.focus(); }
  };
  return (
    <div className={`combo ds-select ${className}`} style={style}>
      <button ref={triggerRef} type="button" id={id} className="ds-form-field__input ds-select__trigger" disabled={disabled}
        aria-haspopup="listbox" aria-expanded={open}
        onClick={() => { if (!disabled) setOpen((o) => !o); }}
        onKeyDown={(e) => { if (!disabled && !open && (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ")) { e.preventDefault(); setOpen(true); } }}>
        <span className={sel ? "" : "ds-select__ph"}>{sel ? sel.label : placeholder}</span>
        <IconChevronDown size={20} className="ds-select__chev" />
      </button>
      {open && !disabled && (
        <>
          <div className="ds-select__overlay" onClick={() => setOpen(false)} />
          <div ref={menuRef} className="combo__menu" role="listbox" onKeyDown={onMenuKey}>
            {searchable && (
              <div style={{ padding: 8, borderBottom: "1.5px solid var(--ds-color-gray-100)", position: "sticky", top: 0, background: "var(--ds-surface)", zIndex: 1 }}>
                <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} className="ds-cell-input" style={{ width: "100%" }}
                  aria-label="Buscar opción" placeholder="Buscar…"
                  onKeyDown={(e) => { if (e.key === "ArrowDown") { e.preventDefault(); menuRef.current?.querySelector<HTMLButtonElement>('[role="option"]')?.focus(); } }} />
              </div>
            )}
            {visibles.length === 0 && <div className="combo__empty">{options.length === 0 ? "Sin opciones." : "Sin coincidencias."}</div>}
            {visibles.map((o) => (
              <button key={o.value} type="button" role="option" aria-selected={o.value === cur}
                className={`combo__item ${o.value === cur ? "is-active" : ""}`} onClick={() => pick(o.value)}>
                {o.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export const Textarea = ({ className = "", ...p }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea className={`ds-form-field__textarea ${className}`.trim()} {...p} />
);

// ---------------------------------------------------------------- Checkbox
// Casilla del DS (.ds-cbx) + etiqueta, envueltas en un <label> accesible.
// Unifica el patrón repetido `<label><input className="ds-cbx"/> …</label>`.
export function Checkbox({
  checked, onChange, label, disabled, className = "", ...rest
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "onChange"> & {
  checked?: boolean;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  label?: React.ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  const cls = ["ds-cbx-field", disabled ? "ds-cbx-field--disabled" : "", className].filter(Boolean).join(" ");
  return (
    <label className={cls}>
      <input type="checkbox" className="ds-cbx" checked={checked} disabled={disabled} onChange={onChange} {...rest} />
      {label != null && <span>{label}</span>}
    </label>
  );
}

// ---------------------------------------------------------------- Badge
export function Badge({ tone = "gray", children }: { tone?: string; children: React.ReactNode }) {
  return <span className={`ds-badge ds-badge--${tone}`}>{children}</span>;
}

// ---------------------------------------------------------------- Card
export function Card({
  className = "", interactive, flat, children, ...rest
}: React.HTMLAttributes<HTMLDivElement> & { interactive?: boolean; flat?: boolean }) {
  const cls = ["ds-card", flat ? "ds-card--outlined" : "", interactive ? "ds-card--interactive" : "", className]
    .filter(Boolean).join(" ");
  return <div className={cls} {...rest}>{children}</div>;
}

// ---------------------------------------------------------------- Tile
export function Tile({
  value,
  label,
  accent = "var(--ds-color-green-100)",
  onClick,
  active,
  className = "",
  style,
}: {
  value: React.ReactNode;
  label: string;
  accent?: string;
  onClick?: () => void;
  active?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  if (onClick) {
    const cls = ["tile", "tile--clickable", active ? "is-active" : "", className].filter(Boolean).join(" ");
    return (
      <button type="button" className={cls} style={{ "--tile-accent": accent, ...style } as React.CSSProperties} onClick={onClick} aria-pressed={active}>
        <div className="tile__accent" style={{ background: accent }} />
        <div className="tile__value">{value}</div>
        <div className="tile__label">{label}</div>
      </button>
    );
  }
  return (
    <div className={["tile", className].filter(Boolean).join(" ")} style={style}>
      <div className="tile__accent" style={{ background: accent }} />
      <div className="tile__value">{value}</div>
      <div className="tile__label">{label}</div>
    </div>
  );
}

// ---------------------------------------------------------------- Skeleton
// Barra "fantasma" con shimmer del DS para estados de carga. Pasá width/height
// (px o cualquier unidad CSS). aria-hidden: es puramente visual.
export function Skeleton({
  width, height, radius, pill, className = "", style,
}: {
  width?: number | string; height?: number | string; radius?: number | string; pill?: boolean; className?: string; style?: React.CSSProperties;
}) {
  const cls = ["ds-skeleton", pill ? "ds-skeleton--pill" : "", className].filter(Boolean).join(" ");
  return <span aria-hidden className={cls} style={{ width, height, borderRadius: radius, ...style }} />;
}

// ---------------------------------------------------------------- QtyRing
export function QtyRing({ recibida, total }: { recibida: number; total: number }) {
  const pct = total > 0 ? Math.min(1, recibida / total) : 0;
  const complete = pct >= 1 - 1e-9;
  const some = recibida > 0;
  const color = complete ? "var(--ds-color-green-100)" : some ? "var(--ds-color-yellow)" : "var(--ds-color-gray-200)";
  return (
    <span className="ds-qty-selector" title={`${recibida} de ${total}`}>
      <span className="ds-qty-selector__outer" />
      <span
        className="ds-qty-selector__ring"
        style={{ background: `conic-gradient(${color} ${pct * 360}deg, transparent 0deg)` }}
      />
      <span className="ds-qty-selector__inner" style={{ background: "var(--ds-surface)", width: 34, height: 34, borderRadius: "50%", display: "grid", placeItems: "center" }}>
        {Math.round(pct * 100)}%
      </span>
    </span>
  );
}

// ---------------------------------------------------------------- ProgressBar
// Variante lineal para progreso (evita el "anillo" cuando ocupa demasiado foco).
export function ProgressBar({
  value,
  total,
  compact,
}: {
  value: number;
  total: number;
  compact?: boolean;
}) {
  const pct = total > 0 ? Math.max(0, Math.min(100, Math.round((value / total) * 100))) : 0;
  const tone = pct >= 100 ? "var(--ds-color-green-100)" : pct > 0 ? "var(--ds-color-yellow)" : "var(--ds-color-gray-300)";
  return (
    <span
      className={`ds-progress ${compact ? "ds-progress--compact" : ""}`}
      title={`${value} de ${total}`}
      style={{ "--ds-progress": `${pct}%`, "--ds-progress-tone": tone } as React.CSSProperties}
    >
      <span className="ds-progress__track"><span className="ds-progress__fill" /></span>
      <span className="ds-progress__pct">{pct}%</span>
    </span>
  );
}

// ---------------------------------------------------------------- EmptyState
// Estado vacío unificado del DS: ícono opcional en círculo + título + pista.
export function EmptyState({ icon, title, hint }: {
  icon?: React.ReactNode; title: React.ReactNode; hint?: React.ReactNode;
}) {
  return (
    <div className="ds-empty">
      {icon && <span className="ds-empty__icon">{icon}</span>}
      <p className="ds-empty__title">{title}</p>
      {hint && <p className="ds-empty__hint">{hint}</p>}
    </div>
  );
}

// ---------------------------------------------------------------- Modal
export function Modal({ title, onClose, children, footer, wide }: {
  title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean;
}) {
  const titleId = useId();
  const modalRef = useRef<HTMLDivElement>(null);
  const prevFocus = useRef<HTMLElement | null>(null);
  // onClose vía ref para que el efecto corra UNA sola vez (montar/desmontar) y no
  // se re-ejecute robando el foco cuando el padre re-renderiza (p.ej. al tipear).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // Diálogo accesible: cerrar con Escape, llevar el foco adentro al abrir,
  // atraparlo (Tab cicla dentro) y restaurarlo al disparador al cerrar.
  useEffect(() => {
    prevFocus.current = document.activeElement as HTMLElement | null;
    // Bloquear el scroll del fondo mientras el diálogo está abierto (evita el
    // "scroll detrás" del overlay). Se restaura al cerrar.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const el = modalRef.current;
    const focusables = () => Array.from(
      el?.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? []
    );
    (focusables()[0] ?? el)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onCloseRef.current(); return; }
      if (e.key === "Tab" && el) {
        const items = focusables();
        if (items.length === 0) { e.preventDefault(); el.focus(); return; }
        const first = items[0], last = items[items.length - 1], active = document.activeElement;
        if (e.shiftKey && (active === first || !el.contains(active))) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && (active === last || !el.contains(active))) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prevOverflow; prevFocus.current?.focus?.(); };
  }, []);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div ref={modalRef} tabIndex={-1} className={`modal ${wide ? "modal--wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(e) => e.stopPropagation()}>
        <div className="row row--between" style={{ marginBottom: 16 }}>
          <h3 className="ds-subtitle-lg" id={titleId}>{title}</h3>
          <button className="modal-close" onClick={onClose} aria-label="Cerrar"><IconClose size={18} /></button>
        </div>
        {children}
        {footer && <div className="row gap-3 mt-6" style={{ justifyContent: "flex-end" }}>{footer}</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- ConfirmDialog
// Overlay de confirmación (reemplaza window.confirm) para acciones destructivas.
// Evita eliminaciones accidentales con un paso explícito.
export function ConfirmDialog({
  title = "¿Confirmar?", message, confirmLabel = "Eliminar", cancelLabel = "Cancelar",
  tone = "red", onConfirm, onCancel,
}: {
  title?: string; message: React.ReactNode; confirmLabel?: string; cancelLabel?: string;
  tone?: "red" | "green"; onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <Modal title={title} onClose={onCancel}
      footer={<>
        <Button variant="outline" onClick={onCancel}>{cancelLabel}</Button>
        <Button variant={tone} onClick={onConfirm}>{confirmLabel}</Button>
      </>}>
      <p className="ds-body" style={{ lineHeight: 1.5 }}>{message}</p>
    </Modal>
  );
}

// ---------------------------------------------------------------- Toast
type Toast = { id: number; text: string; tone: "success" | "error" | "info" };
const ToastCtx = createContext<(text: string, tone?: Toast["tone"]) => void>(() => {});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Toast["tone"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toast-wrap">
        {toasts.map((t) => (
          <div key={t.id}
            role={t.tone === "error" ? "alert" : "status"}
            aria-live={t.tone === "error" ? "assertive" : "polite"}
            className={`toast ${t.tone === "success" ? "toast--success" : t.tone === "error" ? "toast--error" : ""}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);
