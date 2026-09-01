"use client";

import { useEffect, useState } from "react";
import { codigoDeItem } from "./unidad.ts";
import { etiquetaVariante, faltaVariante, type Variante } from "./variantes.ts";

// Las variantes de los materiales que hay EN PANTALLA, para poder decir cuál es
// ("0042 — … NO. 42") y no solo mostrar el ítem genérico de BC.
//
// Se piden en UNA sola llamada por tanda (ver /api/bc/variants?items=) y se cachean
// por MÓDULO: el catálogo de variantes de un material no cambia mientras se trabaja,
// así que moverse entre Materiales → solicitud → orden no vuelve a pegarle a BC.
const cache = new Map<string, Variante[]>();
const enVuelo = new Set<string>();

// A quién avisarle cuando llega catálogo nuevo. Es necesario porque la caché vive
// FUERA de React: sin esto, la respuesta llenaba la caché y la pantalla no se
// redibujaba (el pedido lo había lanzado un render anterior, y el nuevo no vuelve a
// pedir lo que ya está en vuelo). Se veía como "no muestra la variante".
const suscriptores = new Set<() => void>();
const avisar = () => { for (const f of [...suscriptores]) f(); };

export function useVariantes(items: (string | undefined)[]) {
  // `version` se devuelve para que quien lo necesite (el selector de variante del
  // armado de la orden) pueda reaccionar a la llegada del catálogo con un useEffect.
  const [version, setVersion] = useState(0);
  const clave = [...new Set((items ?? []).map((i) => codigoDeItem(i ?? "")).filter(Boolean))].sort().join(",");

  useEffect(() => {
    const redibujar = () => setVersion((v) => v + 1);
    suscriptores.add(redibujar);
    return () => { suscriptores.delete(redibujar); };
  }, []);

  useEffect(() => {
    const faltan = (clave ? clave.split(",") : []).filter((i) => !cache.has(i) && !enVuelo.has(i));
    if (!faltan.length) return;
    faltan.forEach((i) => enVuelo.add(i));
    fetch(`/api/bc/variants?items=${encodeURIComponent(faltan.join(","))}`)
      .then((r) => (r.ok ? r.json() : { porItem: {} }))
      .then((d) => {
        const porItem = (d?.porItem ?? {}) as Record<string, Variante[]>;
        for (const [item, vs] of Object.entries(porItem)) cache.set(item, Array.isArray(vs) ? vs : []);
        avisar();
      })
      .catch(() => { /* sin catálogo: la línea se queda con su código de variante */ })
      // Los ítems que BC no pudo contestar salen de "en vuelo" para poder reintentar
      // en la próxima pantalla; los que sí llegaron ya están en la caché.
      .finally(() => faltan.filter((i) => !cache.has(i)).forEach((i) => enVuelo.delete(i)));
  }, [clave]);

  const variantesDe = (itemNo?: string): Variante[] => cache.get(codigoDeItem(itemNo ?? "")) ?? [];
  const nombreVariante = (itemNo?: string, code?: string): string => {
    const c = (code ?? "").trim().toUpperCase();
    if (!c) return "";
    return variantesDe(itemNo).find((v) => (v.code ?? "").trim().toUpperCase() === c)?.descripcion ?? "";
  };
  return {
    version,
    variantesDe,
    nombreVariante,
    // "0042 — ZAPATO … NO. 42" (o solo el código mientras BC no contesta).
    etiqueta: (itemNo?: string, code?: string) => etiquetaVariante(code, nombreVariante(itemNo, code)),
    // La línea no dice cuál variante es y el material tiene varias.
    falta: (itemNo?: string, code?: string) => faltaVariante(code, variantesDe(itemNo)),
  };
}
