"use client";

import React, { createContext, useCallback, useContext, useState } from "react";

// ---------------------------------------------------------------- Button
type BtnVariant = "green" | "red" | "yellow" | "ghost" | "outline";
type BtnSize = "sm" | "md" | "lg";

export function Button({
  variant = "green", size = "md", block, className = "", children, ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: BtnVariant; size?: BtnSize; block?: boolean;
}) {
  const cls = [
    "ds-btn", `ds-btn--${variant}`,
    size !== "md" ? `ds-btn--${size}` : "",
    block ? "ds-btn--block" : "", className,
  ].filter(Boolean).join(" ");
  return <button className={cls} {...rest}>{children}</button>;
}

// ---------------------------------------------------------------- Field
export function Field({
  label, help, warning, children,
}: { label: string; help?: string; warning?: boolean; children: React.ReactNode }) {
  return (
    <div className={`ds-form-field ${warning ? "ds-form-field--advertencia" : ""}`}>
      <label className="ds-form-field__label">{label}</label>
      <div className="ds-form-field__input-wrap">{children}</div>
      {help && <span className="ds-form-field__help">{help}</span>}
    </div>
  );
}

export const Input = (p: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input className="ds-form-field__input" {...p} />
);

export const Select = ({ children, ...p }: React.SelectHTMLAttributes<HTMLSelectElement>) => (
  <select className="ds-form-field__select" {...p}>{children}</select>
);

export const Textarea = (p: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea {...p} />
);

// ---------------------------------------------------------------- Badge
export function Badge({ tone = "gray", children }: { tone?: string; children: React.ReactNode }) {
  return <span className={`ds-badge ds-badge--${tone}`}>{children}</span>;
}

// ---------------------------------------------------------------- Card
export function Card({
  className = "", interactive, flat, children, ...rest
}: React.HTMLAttributes<HTMLDivElement> & { interactive?: boolean; flat?: boolean }) {
  const cls = ["ds-card", flat ? "ds-card--flat" : "", interactive ? "ds-card--interactive" : "", className]
    .filter(Boolean).join(" ");
  return <div className={cls} {...rest}>{children}</div>;
}

// ---------------------------------------------------------------- Tile
export function Tile({ value, label, accent = "var(--ds-color-green-100)" }: { value: React.ReactNode; label: string; accent?: string }) {
  return (
    <div className="tile">
      <div className="tile__accent" style={{ background: accent }} />
      <div className="tile__value">{value}</div>
      <div className="tile__label">{label}</div>
    </div>
  );
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
      <span className="ds-qty-selector__inner" style={{ background: "#fff", width: 34, height: 34, borderRadius: "50%", display: "grid", placeItems: "center" }}>
        {Math.round(pct * 100)}%
      </span>
    </span>
  );
}

// ---------------------------------------------------------------- Modal
export function Modal({ title, onClose, children, footer }: {
  title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode;
}) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="row row--between" style={{ marginBottom: 16 }}>
          <h3 className="ds-subtitle-lg">{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Cerrar">✕</button>
        </div>
        {children}
        {footer && <div className="row gap-3 mt-6" style={{ justifyContent: "flex-end" }}>{footer}</div>}
      </div>
    </div>
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
          <div key={t.id} className={`toast ${t.tone === "success" ? "toast--success" : t.tone === "error" ? "toast--error" : ""}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);
