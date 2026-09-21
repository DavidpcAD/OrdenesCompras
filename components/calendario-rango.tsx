"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ds-icon";
import { IconChevronDown } from "@/components/icons";
import { todayISO } from "@/lib/helpers";
import {
  diasEnMes, entre, isoDe, nombreMes, ordenarRango, partes, primerDiaSemana, primeroDelMes,
  rangoVacio, sumarDias, sumarMeses, textoRango, ultimoDelMes, type Rango,
} from "@/lib/fechas";

// CALENDARIO DE RANGO — el de "del viernes al lunes" en un solo gesto.
//
// Por qué existe: hasta ahora las fechas se elegían con <input type="date"> sueltos,
// uno para "desde" y otro para "hasta". El del navegador abre un mes a la vez, no
// muestra el rango, no dice cuántos días agarró y en Conciliación ni siquiera había
// "hasta": se revisaba desde una fecha hasta hoy, sin poder acotar. Elegir "del 1 al
// 15 de agosto" eran dos calendarios distintos y ninguna pista de qué quedó adentro.
//
// Acá se pinta el rango completo: se toca el primer día, se arrastra la vista con el
// mouse y el rango se va pintando, se toca el último y listo. Dos meses a la vez para
// que un rango que cruza el mes se elija sin navegar. Los atajos de arriba resuelven
// lo que de verdad se pide todos los días ("lo del viernes", "este mes").
//
// Sin librerías: es CSS plano con tokens --ds-* y una grilla de botones, como todo lo
// demás de la app.

const DIAS = ["L", "M", "M", "J", "V", "S", "D"];

type Props = {
  valor: Rango;
  onCambio: (r: Rango) => void;
  /** Dos meses en pantallas normales; en angostas el CSS deja solo el primero. */
  meses?: 1 | 2;
  atajos?: boolean;
  /** Límites duros: no se puede elegir fuera de esto (p. ej. no elegir el futuro). */
  min?: string;
  max?: string;
  autoFocus?: boolean;
};

export function CalendarioRango({ valor, onCambio, meses = 2, atajos = true, min, max, autoFocus }: Props) {
  const hoy = todayISO();
  const raizRef = useRef<HTMLDivElement>(null);
  // Mes de la izquierda. Arranca en el del rango elegido (o en el de hoy) y, si la
  // pantalla cambia el rango por fuera (un atajo, "Limpiar"), se mueve con él.
  const mesInicial = () => {
    const p = partes(valor.from ?? valor.to ?? hoy)!;
    return { y: p.y, m: p.m };
  };
  const [ancla, setAncla] = useState(mesInicial);
  const [hover, setHover] = useState<string | null>(null);
  // El día que tiene el foco del teclado (tabIndex 0). El resto de los días quedan
  // fuera del tabulador: así se entra a la grilla una sola vez y adentro se maneja
  // con las flechas, como en un calendario de verdad.
  const [foco, setFoco] = useState<string>(valor.from ?? hoy);
  const moverFoco = useRef(false);

  useEffect(() => {
    if (!valor.from && !valor.to) return;
    const p = partes(valor.from ?? valor.to!)!;
    setAncla((a) => (a.y === p.y && a.m === p.m ? a : { y: p.y, m: p.m }));
  }, [valor.from, valor.to]);

  // Después de mover el foco con las flechas hay que llevárselo al botón nuevo (que
  // puede haber aparecido recién, si se cambió de mes).
  useEffect(() => {
    if (!moverFoco.current) return;
    moverFoco.current = false;
    raizRef.current?.querySelector<HTMLButtonElement>(`[data-dia="${foco}"]`)?.focus();
  }, [foco, ancla]);

  useEffect(() => {
    if (!autoFocus) return;
    raizRef.current?.querySelector<HTMLButtonElement>(`[data-dia="${foco}"]`)?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFocus]);

  const fuera = (d: string) => (!!min && d < min) || (!!max && d > max);

  // UN SOLO GESTO: el primer clic abre el rango, el segundo lo cierra. Tocar un día
  // anterior al que se abrió no arma un rango al revés: vuelve a empezar desde ahí,
  // que es lo que uno quiere decir cuando se corrige.
  function elegir(d: string) {
    if (fuera(d)) return;
    if (!valor.from || valor.to) onCambio({ from: d });
    else if (d < valor.from) onCambio({ from: d });
    else onCambio({ from: valor.from, to: d });
  }

  // Lo que se pinta: el rango cerrado, o —mientras falta la segunda punta— el que se
  // armaría soltando el mouse donde está. Es la mitad de la gracia del calendario:
  // se ve cuánto agarra ANTES de hacer clic.
  const pintado: Rango = valor.from && !valor.to && hover ? ordenarRango({ from: valor.from, to: hover }) : valor;

  function teclas(e: React.KeyboardEvent) {
    const saltos: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    let siguiente: string | null = null;
    if (e.key in saltos) siguiente = sumarDias(foco, saltos[e.key]);
    else if (e.key === "PageUp" || e.key === "PageDown") {
      const p = partes(foco)!;
      const { y, m } = sumarMeses(p.y, p.m, e.key === "PageUp" ? -1 : 1);
      siguiente = isoDe(y, m, Math.min(p.d, diasEnMes(y, m)));
    } else if (e.key === "Home") siguiente = sumarDias(foco, -((new Date(`${foco}T00:00:00Z`).getUTCDay() + 6) % 7));
    else if (e.key === "End") siguiente = sumarDias(foco, 6 - ((new Date(`${foco}T00:00:00Z`).getUTCDay() + 6) % 7));
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); elegir(foco); return; }
    else return;
    e.preventDefault();
    if (!siguiente || fuera(siguiente)) return;
    const p = partes(siguiente)!;
    const visible = [0, 1].slice(0, meses).some((i) => {
      const { y, m } = sumarMeses(ancla.y, ancla.m, i);
      return y === p.y && m === p.m;
    });
    if (!visible) setAncla(p.m === ancla.m && p.y === ancla.y ? ancla : { y: p.y, m: p.m });
    moverFoco.current = true;
    setFoco(siguiente);
  }

  const correr = (n: number) => setAncla((a) => sumarMeses(a.y, a.m, n));

  const atajo = (r: Rango) => onCambio(r);
  const h = partes(hoy)!;

  return (
    <div className="cal" ref={raizRef} onMouseLeave={() => setHover(null)}>
      {atajos && (
        <div className="cal-atajos">
          <button type="button" onClick={() => atajo({ from: hoy, to: hoy })}>Hoy</button>
          <button type="button" onClick={() => atajo({ from: sumarDias(hoy, -1), to: sumarDias(hoy, -1) })}>Ayer</button>
          <button type="button" onClick={() => atajo({ from: sumarDias(hoy, -6), to: hoy })}>Últimos 7 días</button>
          <button type="button" onClick={() => atajo({ from: sumarDias(hoy, -29), to: hoy })}>Últimos 30 días</button>
          <button type="button" onClick={() => atajo({ from: primeroDelMes(h.y, h.m), to: ultimoDelMes(h.y, h.m) })}>Este mes</button>
          <button type="button" onClick={() => { const a = sumarMeses(h.y, h.m, -1); atajo({ from: primeroDelMes(a.y, a.m), to: ultimoDelMes(a.y, a.m) }); }}>Mes pasado</button>
        </div>
      )}

      <div className="cal-meses" onKeyDown={teclas}>
        {Array.from({ length: meses }, (_, i) => {
          const { y, m } = sumarMeses(ancla.y, ancla.m, i);
          const primero = primerDiaSemana(y, m);
          const largo = diasEnMes(y, m);
          return (
            <div className="cal-mes" key={`${y}-${m}`}>
              <div className="cal-mes__head">
                {i === 0 ? (
                  <button type="button" className="cal-nav" onClick={() => correr(-1)} aria-label="Mes anterior">
                    <Icon name="back" size="sm" />
                  </button>
                ) : <span className="cal-nav cal-nav--hueco" aria-hidden />}
                <span className="cal-mes__titulo">{nombreMes(y, m)}</span>
                {i === meses - 1 ? (
                  <button type="button" className="cal-nav" onClick={() => correr(1)} aria-label="Mes siguiente">
                    <Icon name="arrow-right" size="sm" />
                  </button>
                ) : (
                  // En pantalla angosta el segundo mes no se dibuja: esta flecha, que
                  // solo se ve ahí, es la que deja avanzar igual.
                  <button type="button" className="cal-nav cal-nav--movil" onClick={() => correr(1)} aria-label="Mes siguiente">
                    <Icon name="arrow-right" size="sm" />
                  </button>
                )}
              </div>
              <div className="cal-semana" aria-hidden>
                {DIAS.map((d, j) => <span key={j}>{d}</span>)}
              </div>
              <div className="cal-dias" role="grid">
                {Array.from({ length: primero }, (_, k) => <span key={`v${k}`} className="cal-dia cal-dia--vacio" />)}
                {Array.from({ length: largo }, (_, k) => {
                  const d = isoDe(y, m, k + 1);
                  const bloqueado = fuera(d);
                  const inicio = !!pintado.from && d === pintado.from;
                  const fin = !!pintado.to && d === pintado.to;
                  const dentro = !!pintado.from && !!pintado.to && entre(d, pintado.from, pintado.to);
                  const cls = [
                    "cal-dia",
                    dentro ? "is-dentro" : "",
                    inicio || fin ? "is-punta" : "",
                    inicio && !fin ? "is-inicio" : "",
                    fin && !inicio ? "is-fin" : "",
                    inicio && fin ? "is-solo" : "",
                    d === hoy ? "is-hoy" : "",
                  ].filter(Boolean).join(" ");
                  return (
                    <button key={d} type="button" data-dia={d} className={cls}
                      tabIndex={d === foco ? 0 : -1} disabled={bloqueado}
                      aria-pressed={inicio || fin || dentro}
                      aria-label={`${k + 1} de ${nombreMes(y, m)}`}
                      onFocus={() => setFoco(d)}
                      onMouseEnter={() => setHover(d)}
                      onClick={() => elegir(d)}>
                      {k + 1}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div className="cal-pie">
        <span className="cal-pie__texto">
          {valor.from && !valor.to ? "Elegí la fecha final" : textoRango(valor, "Sin fecha: entran todas")}
        </span>
        {!rangoVacio(valor) && (
          <button type="button" className="link-btn" onClick={() => onCambio({})}>Limpiar</button>
        )}
      </div>
    </div>
  );
}

// EL CAMPO que abre el calendario: un botón que dice el rango elegido en cristiano
// ("21/06/2026 → 21/09/2026") y, al tocarlo, despliega el calendario. Se cierra con
// Escape, tocando afuera o eligiendo la segunda punta, y el foco vuelve al botón.
export function CampoRangoFechas({ valor, onCambio, vacio = "Cualquier fecha", meses = 2, min, max, id }: {
  valor: Rango;
  onCambio: (r: Rango) => void;
  vacio?: string;
  meses?: 1 | 2;
  min?: string;
  max?: string;
  id?: string;
}) {
  const [abierto, setAbierto] = useState(false);
  const botonRef = useRef<HTMLButtonElement>(null);
  const cerrar = () => { setAbierto(false); botonRef.current?.focus(); };

  useEffect(() => {
    if (!abierto) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); cerrar(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [abierto]);

  return (
    <div className="cal-campo">
      <button type="button" id={id} ref={botonRef} className={`cal-campo__btn${rangoVacio(valor) ? "" : " is-puesto"}`}
        aria-haspopup="dialog" aria-expanded={abierto} onClick={() => setAbierto((v) => !v)}>
        <span>{textoRango(valor, vacio)}</span>
        <IconChevronDown size={16} />
      </button>
      {abierto && (
        <>
          <div className="cal-scrim" onClick={cerrar} />
          <div className="cal-pop" role="dialog" aria-label="Elegir fechas">
            <CalendarioRango valor={valor} meses={meses} min={min} max={max} autoFocus
              onCambio={(r) => {
                onCambio(r);
                // Se cierra cuando el rango quedó completo: la segunda punta es el
                // final del gesto. Con una sola punta se queda abierto esperándola.
                if (r.from && r.to) setTimeout(cerrar, 120);
              }} />
          </div>
        </>
      )}
    </div>
  );
}
