// LA ARITMÉTICA DE LA CARGA POR LOTES.
//
// La carga inicial viene por tandas de "los N más nuevos por debajo de este id"
// (ver app/api/bootstrap/route.ts y `cargarPorLotes` en lib/store.tsx). Todo lo que
// decide QUÉ pedir y CÓMO pegarlo vive acá, separado de SQL y de React, porque es
// justo donde un error no se ve: un cursor mal calculado no rompe nada en pantalla,
// solo se salta cien órdenes en silencio.

// Cuántos documentos por vuelta. 150 es el número que hace que la PRIMERA tanda se
// sienta inmediata sin partir el resto en demasiados viajes (con ~800 órdenes son
// seis vueltas). Subirlo es subir el tiempo hasta la primera fila en pantalla.
export const LOTE_DEFECTO = 150;
// Techo duro: el tamaño viene en la URL y nadie puede pedirse la historia entera de
// un viaje por ahí (que es exactamente lo que se está tratando de evitar).
export const LOTE_MAX = 500;

/** Tamaño pedido en la URL. `null` = no vienen por lotes (carga completa de siempre). */
export function tamañoDeLote(v: string | null): number | null {
  if (v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return LOTE_DEFECTO;   // basura → el de siempre
  return Math.min(Math.floor(n), LOTE_MAX);
}

/** Cursor que viene en la URL: un id positivo, o null si no hay (o no es un id). */
export function cursorDe(v: string | null): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

// El cursor de la próxima vuelta: el id MÁS CHICO que vino en este lote (se pide
// hacia atrás). `null` cuando esta entidad ya se terminó, y "se terminó" es "vinieron
// menos de N": es la única señal que no cuesta una consulta extra.
//
// Ojo con el caso exacto: si vinieron EXACTAMENTE N y no quedaba nada más, se pide
// una vuelta de gusto que vuelve vacía y ahí sí termina. Un viaje de más es mucho
// mejor que un COUNT por vuelta para ahorrárselo.
export function siguienteCursor(items: Array<{ id: string }>, n: number): number | null {
  if (items.length < n) return null;
  let min = Infinity;
  for (const x of items) {
    const v = Number(x.id);
    if (Number.isFinite(v) && v < min) min = v;
  }
  return Number.isFinite(min) ? min : null;
}

// Pega una tanda al final sin repetir lo que ya está. Los lotes van por cursor de id,
// así que normalmente no hay nada repetido; esto es la red por si el refresco de 45 s
// alcanza a traer la historia completa en medio de la tanda — ahí pegar a ciegas
// dejaría cada documento DOS veces en pantalla.
export function unirPorId<T extends { id: string }>(viejas: T[], nuevas: T[]): T[] {
  if (!nuevas.length) return viejas;
  const vistos = new Set(viejas.map((x) => x.id));
  const faltan = nuevas.filter((x) => !vistos.has(x.id));
  return faltan.length ? [...viejas, ...faltan] : viejas;
}
