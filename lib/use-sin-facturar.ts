"use client";

import { useEffect, useState } from "react";
import { todayISO } from "./helpers";
import type { BcSinFacturar, BcSinFecha } from "./bc";

export type PanoramaBc = { sinFacturar: BcSinFacturar; sinFecha: BcSinFecha };

// Los dos números que viven en BC y no en la base de la app, así que llegan aparte y
// después: la pantalla se pinta completa y las tarjetas se rellenan cuando BC contesta.
// Si no contesta, se DICE. Un ₡0 en rojo porque se cayó la red manda a alguien a
// celebrar algo que no pasó, o peor, a dejar de revisarlo.
export function usePanoramaBc() {
  const [datos, setDatos] = useState<PanoramaBc | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    fetch(`/api/bc/recibido-sin-facturar?hoy=${todayISO()}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d?.error ?? `BC contestó ${r.status}`);
        return d as PanoramaBc;
      })
      .then((d) => { if (vivo) setDatos(d); })
      .catch((e) => { if (vivo) setError(String(e?.message ?? e)); });
    return () => { vivo = false; };
  }, []);

  return { datos, error, cargando: !datos && !error };
}
