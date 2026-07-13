"use client";

import { useEffect, useRef, useState } from "react";

// Slide-to-confirm BIDIRECCIONAL (inspirado en el DS "SlideToConfirm", pero con
// dos direcciones). Deslizar a la DERECHA confirma "aprobar" (verde); a la
// IZQUIERDA confirma "rechazar" (rojo). El track negro muestra las dos etiquetas
// atenuadas; al arrastrar hacia un lado esa zona se ilumina. Pasado el umbral y
// al soltar, se dispara el callback. Funciona con mouse y touch.
//
// IMPORTANTE (aprobar): al confirmar a la derecha el slider queda FIJO en el
// extremo con spinner mientras el padre procesa (`busy`). No se resetea solo:
// si BC responde OK el padre desmonta la tarjeta; si falla, `busy` vuelve a
// false y el slider regresa al centro para reintentar.

type Dir = "right" | "left";

export function SlideConfirm({
  onApprove,
  onReject,
  approveLabel = "Aprobar y lanzar",
  rejectLabel = "Rechazar",
  disabled = false,
  busy = false,
  height = 68,
  knobWidth = 76,
  threshold = 0.7,
}: {
  onApprove: () => void;
  onReject: () => void;
  approveLabel?: string;
  rejectLabel?: string;
  disabled?: boolean;
  busy?: boolean;
  height?: number;
  knobWidth?: number;
  threshold?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [maxDrag, setMaxDrag] = useState(0);
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [committed, setCommitted] = useState<Dir | null>(null);
  const startRef = useRef(0);
  const sawBusy = useRef(false);

  // maxDrag = mitad del recorrido libre a cada lado.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setMaxDrag(Math.max(0, (el.getBoundingClientRect().width - knobWidth) / 2));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [knobWidth]);

  // Tras aprobar: esperamos a que el padre entre en `busy` y vuelva a salir.
  // Si salió de busy y la tarjeta sigue montada, es que FALLÓ → volvemos al centro.
  useEffect(() => {
    if (committed !== "right") return;
    if (busy) { sawBusy.current = true; return; }
    if (sawBusy.current) { sawBusy.current = false; setCommitted(null); setDragX(0); }
  }, [busy, committed]);

  const locked = disabled || busy || committed !== null;
  const progress = maxDrag > 0 ? Math.min(1, Math.abs(dragX) / maxDrag) : 0;
  const dir: Dir | null = dragX > 4 ? "right" : dragX < -4 ? "left" : null;

  const rubber = (raw: number) => {
    if (raw > maxDrag) return maxDrag + (raw - maxDrag) * 0.2;
    if (raw < -maxDrag) return -maxDrag + (raw + maxDrag) * 0.2;
    return raw;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (locked) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    startRef.current = e.clientX - dragX;
    setDragging(true);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging || locked) return;
    setDragX(rubber(e.clientX - startRef.current));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (!dragging) return;
    setDragging(false);
    try { (e.target as Element).releasePointerCapture?.(e.pointerId); } catch { /* noop */ }
    if (locked) return;
    const p = maxDrag > 0 ? Math.abs(dragX) / maxDrag : 0;
    if (p >= threshold && dir) commit(dir);
    else setDragX(0);
  };

  function commit(d: Dir) {
    setCommitted(d);
    setDragX(d === "right" ? maxDrag : -maxDrag);
    if (d === "right") {
      // Aprobar: queda fijo con spinner; el efecto de `busy` lo reseteará si falla.
      onApprove();
    } else {
      // Rechazar: abre el modal de motivo y el slider vuelve al centro.
      onReject();
      window.setTimeout(() => { setCommitted(null); setDragX(0); }, 300);
    }
  }

  // Opacidad de cada zona: base tenue + sube con el progreso hacia ese lado.
  const rightOpacity = committed === "right" ? 1 : dir === "right" ? 0.25 + progress * 0.75 : 0.16;
  const leftOpacity = committed === "left" ? 1 : dir === "left" ? 0.25 + progress * 0.75 : 0.16;
  const trans = dragging ? "none" : "transform .28s cubic-bezier(.22,1,.36,1), opacity .2s ease";
  const knobLeft = maxDrag + dragX; // centro en reposo (maxDrag), se mueve con dragX

  const knobBg = committed === "left" ? "var(--ds-color-red-200)"
    : committed === "right" ? "var(--ds-color-green-200)"
    : "var(--ds-color-white)";

  return (
    <div
      ref={containerRef}
      style={{
        position: "relative", width: "100%", height, borderRadius: 18, overflow: "hidden",
        background: "var(--ds-color-black)", touchAction: "none", userSelect: "none",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {/* Zona izquierda (rechazar / rojo) */}
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: "50%", background: "var(--ds-color-red-100)", opacity: leftOpacity, transition: trans }} />
      {/* Zona derecha (aprobar / verde) */}
      <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: "50%", background: "var(--ds-color-green-100)", opacity: rightOpacity, transition: trans }} />

      {/* Etiqueta izquierda */}
      <div style={{
        position: "absolute", left: 16, top: 0, bottom: 0, display: "flex", alignItems: "center", gap: 6,
        color: "var(--ds-color-white)", fontWeight: 600, fontSize: 14,
        opacity: committed === "right" ? 0 : committed === "left" ? 1 : dir === "left" ? 1 : 0.85, transition: trans, pointerEvents: "none",
      }}>
        <span aria-hidden style={{ fontSize: 18 }}>‹</span>{rejectLabel}
      </div>
      {/* Etiqueta derecha */}
      <div style={{
        position: "absolute", right: 16, top: 0, bottom: 0, display: "flex", alignItems: "center", gap: 6,
        color: dir === "right" || committed === "right" ? "var(--ds-color-black)" : "var(--ds-color-white)",
        fontWeight: 600, fontSize: 14,
        opacity: committed === "left" ? 0 : committed === "right" ? 1 : dir === "right" ? 1 : 0.85, transition: trans, pointerEvents: "none",
      }}>
        {busy && committed === "right" ? "Lanzando…" : approveLabel}<span aria-hidden style={{ fontSize: 18 }}>›</span>
      </div>

      {/* Perilla */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{
          position: "absolute", top: 5, bottom: 5, width: knobWidth,
          transform: `translateX(${knobLeft}px)`, transition: trans,
          borderRadius: (height - 10) / 2,
          background: knobBg,
          display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
          cursor: locked ? "default" : dragging ? "grabbing" : "grab",
          boxShadow: committed
            ? "0 2px 8px rgba(0,0,0,.28)"
            : dragging
              ? "inset 0 0 0 1px rgba(0,0,0,.05), 0 8px 16px rgba(0,0,0,.28)"
              : "inset 0 0 0 1px rgba(0,0,0,.05), 0 2px 6px rgba(0,0,0,.22)",
          color: committed ? "var(--ds-color-white)" : "var(--ds-color-gray-400)",
        }}
      >
        {busy && committed === "right" ? (
          <span className="stc-spinner" aria-hidden />
        ) : committed === "right" ? (
          <span aria-hidden style={{ fontSize: 22, fontWeight: 700 }}>✓</span>
        ) : committed === "left" ? (
          <span aria-hidden style={{ fontSize: 20, fontWeight: 700 }}>✕</span>
        ) : (
          // Handle de arrastre: 3 barritas + animación de empujoncito en reposo.
          <span className={`stc-handle${!dragging ? " stc-grip" : ""}`} aria-hidden>
            <i /><i /><i />
          </span>
        )}
      </div>
    </div>
  );
}
