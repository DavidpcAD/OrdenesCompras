// LAS FACTURAS DE BC, GUARDADAS UNOS MINUTOS.
//
// Son ~10.000 facturas y ~800 proveedores, y ahora hay TRES cosas que las piden: la
// sincronización (cada 3 minutos mientras alguien tenga la pantalla abierta), la
// búsqueda de candidatos de una factura que se abre, y el conteo de candidatos de
// toda la lista. Sin un solo lugar donde guardarlas, cada una se bajaba su copia y
// entre eso y los adjuntos del correo la petición se pasaba del tiempo que aguanta.
//
// Dura poco a propósito: una factura que se digitó hace un minuto tiene que
// aparecer. Cuatro minutos es el punto donde deja de doler y todavía no miente.
//
// Vivía dentro de la ruta de sincronización; se sacó acá cuando dejó de ser de ella.

import { bcFacturasCompra, bcProveedoresConCedula } from "./bc.ts";

const CACHE_MS = 4 * 60 * 1000;

type Datos = {
  facturas: Awaited<ReturnType<typeof bcFacturasCompra>>;
  proveedores: Awaited<ReturnType<typeof bcProveedoresConCedula>>;
};

let cache: ({ t: number; desde: string } & Datos) | null = null;
// Las llamadas que llegan mientras se está bajando se cuelgan de la MISMA promesa:
// si tres pestañas abren la pantalla a la vez, se baja una sola vez.
let volando: { desde: string; p: Promise<Datos> } | null = null;

export async function facturasYProveedoresDeBc(desde: string): Promise<Datos> {
  // El cache solo sirve si cubre un rango igual o MÁS viejo que el que se pide; si no,
  // faltarían facturas y algo aparecería como no registrado sin serlo.
  if (cache && Date.now() - cache.t < CACHE_MS && cache.desde <= desde) {
    return { facturas: cache.facturas, proveedores: cache.proveedores };
  }
  if (volando && volando.desde <= desde) return volando.p;

  const p = (async () => {
    const [facturas, proveedores] = await Promise.all([
      bcFacturasCompra(desde),
      bcProveedoresConCedula(),
    ]);
    cache = { t: Date.now(), desde, facturas, proveedores };
    return { facturas, proveedores };
  })();

  volando = { desde, p };
  try {
    return await p;
  } finally {
    if (volando?.p === p) volando = null;
  }
}
