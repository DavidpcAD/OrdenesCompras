"use client";

import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import type { Orden } from "@/lib/types";

// LA ORDEN, SIN ESPERAR AL RESTO.
//
// La carga inicial trae de un solo viaje TODAS las solicitudes, TODAS las órdenes con
// sus líneas y TODAS las recepciones. Abrir una orden no tiene por qué esperar eso:
// hasta ahora, entrar a CP-005450 significaba bajar las otras 449 primero, y lo único
// que se veía mientras tanto era el skeleton (David, con la pantalla en gris: "y qué
// está pasando, por qué dura tanto??").
//
// Así que mientras la carga grande viene en camino, esto pide la orden SOLA a
// /api/ordenes/<id> —una consulta puntual, la que ya usaban el PDF y el PATCH— y la
// pantalla se pinta con lo que llegue primero.
//
// El store manda siempre que la tenga: es el que se refresca solo cada 45 s y el que
// queda al día después de cada acción. Esta copia es para el rato en que todavía no
// está, y desaparece sin que nadie se entere en cuanto llega la carga grande.
export function useOrden(id: string): Orden | undefined {
  const { ordenes, modoApi } = useStore();
  const deStore = ordenes.find((o) => o.id === id);
  const yaEsta = !!deStore;
  const [suelta, setSuelta] = useState<Orden | undefined>(undefined);

  useEffect(() => {
    // Si el store ya la tiene, no hay nada que pedir. En modo mock tampoco: ahí no
    // hay servidor al que preguntarle.
    if (!modoApi || !id || yaEsta) return;
    let vivo = true;
    fetch(`/api/ordenes/${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((o) => { if (vivo && o && !o.error && o.id) setSuelta(o as Orden); })
      .catch(() => { /* si falla, igual va a llegar con la carga grande */ });
    return () => { vivo = false; };
  }, [id, modoApi, yaEsta]);

  // La suelta solo vale para el id que se está viendo: al pasar de una orden a otra,
  // el fetch nuevo todavía no volvió y la anterior no puede quedar en pantalla.
  return deStore ?? (suelta?.id === id ? suelta : undefined);
}
