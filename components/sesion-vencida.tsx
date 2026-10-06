"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui";
import { AdelanteMark } from "@/components/icons";
import { EVENTO_SESION_VENCIDA, urlDeReingreso } from "@/lib/fetch-guard";

// Aviso de sesión terminada: tapa la app entera y tiene UN solo botón.
//
// Por qué existe: el 401 casi nunca llega porque alguien apretó algo —llega del
// refresco de fondo, o sea sola—, y antes la pantalla se iba al login de un
// momento a otro. Con media orden escrita y sin explicación, eso se lee como "se
// cayó el sistema". Ahora la pantalla se queda donde estaba, se le pone esto
// encima y la persona decide cuándo volver a entrar.
//
// No se puede cerrar a propósito: sin sesión no hay NADA que hacer en la app, y un
// aviso que se cierra dejaría la pantalla de siempre encima de datos que ya no se
// pueden ni leer ni guardar.

// Cuánto aguanta la sesión sin usarse. Es SESSION_MAX_AGE_S de lib/session.ts, pero
// escrito acá a mano: ese módulo lee SESSION_SECRET y no tiene por qué viajar al
// navegador solo para sacarle un número. Si allá cambia, acá también.
const HORAS_SESION = 12;

export function AvisoSesionVencida() {
  const [volverA, setVolverA] = useState<string | null>(null);
  const [saliendo, setSaliendo] = useState(false);
  const tituloId = useId();
  const textoId = useId();
  // El foco se busca DENTRO de la tarjeta: Button es un componente de función y en
  // React 18 no reenvía `ref` al <button> de adentro.
  const tarjetaRef = useRef<HTMLDivElement>(null);
  const enfocarBoton = () => tarjetaRef.current?.querySelector("button")?.focus();

  useEffect(() => {
    const alVencer = (e: Event) => {
      const detalle = (e as CustomEvent<{ volverA?: string }>).detail;
      setVolverA(detalle?.volverA ?? urlDeReingreso());
    };
    window.addEventListener(EVENTO_SESION_VENCIDA, alVencer);
    return () => window.removeEventListener(EVENTO_SESION_VENCIDA, alVencer);
  }, []);

  // Con el aviso abierto: el foco entra al botón (y se queda ahí), el fondo no hace
  // scroll, y Enter o Escape hacen lo mismo que el botón — es la única salida.
  useEffect(() => {
    if (!volverA) return;
    const scrollPrevio = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    enfocarBoton();
    // En captura y cortando la propagación: si la sesión venció con un diálogo
    // abierto, las teclas son de ESTE aviso y no del diálogo de atrás (su Escape lo
    // cerraría, y las pantallas con atajos de teclado seguirían respondiendo).
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === "Tab") { e.preventDefault(); e.stopPropagation(); enfocarBoton(); return; }
      if (e.key === "Escape" || e.key === "Enter") { e.preventDefault(); e.stopPropagation(); entrar(); }
    };
    window.addEventListener("keydown", alTeclear, true);
    return () => {
      window.removeEventListener("keydown", alTeclear, true);
      document.body.style.overflow = scrollPrevio;
    };
  }, [volverA]);

  // replace (no href): la pantalla vencida no queda en el historial, así el botón
  // "atrás" del navegador no devuelve a una pantalla que ya no carga.
  function entrar() {
    if (!volverA) return;
    setSaliendo(true);
    window.location.replace(volverA);
  }

  if (!volverA) return null;

  return createPortal(
    <div className="modal-overlay sesion-fin">
      <div ref={tarjetaRef} className="modal sesion-fin__card" role="alertdialog" aria-modal="true"
        aria-labelledby={tituloId} aria-describedby={textoId}>
        <div className="sesion-fin__marca">
          <span className="topbar__logo" style={{ width: 28, height: 28 }}><AdelanteMark width={16} /></span>
          <span className="sesion-fin__marca-txt">Adelante</span>
        </div>

        <div className="sesion-fin__cuerpo">
          <div>
            <h2 className="ds-subtitle-lg" id={tituloId}>Tu sesión terminó</h2>
            <p className="ds-body-sm ds-muted" id={textoId}>
              Por seguridad se cierra sola después de {HORAS_SESION} horas sin usarla.
              Entrá de nuevo para seguir donde estabas.
            </p>
          </div>
          <span className="sesion-fin__ic" aria-hidden>
            {/* Candado: el DS no trae uno (components/ds-icon.tsx), así que va dibujado
                acá con el mismo trazo de los demás SVG sueltos de la app. */}
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="4" y="10" width="16" height="11" rx="2.5" />
              <path d="M8 10V7a4 4 0 0 1 8 0v3" />
              <path d="M12 14.5v2.5" />
            </svg>
          </span>
        </div>

        <Button block onClick={entrar} loading={saliendo}>
          {saliendo ? "Abriendo…" : "Entrar de nuevo"}
        </Button>
      </div>
    </div>,
    document.body,
  );
}
