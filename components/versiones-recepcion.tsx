"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui";
import { useStore } from "@/lib/store";
import { formatDate, formatDateTime, money, num, precioUnit } from "@/lib/helpers";
import { versionesDeRecepcion, type VersionRecepcion } from "@/lib/versiones-recepcion";
import type { Movimiento, Orden, Recepcion } from "@/lib/types";

// La bitácora de la recepción y la de su orden. En modo API se piden aparte (no vienen
// en el bootstrap); en modo prueba están en el store. Null mientras carga.
function useBitacoras(rec: Recepcion, orden?: Orden): { movsRec: Movimiento[]; movsOrden: Movimiento[] } | null {
  const { movimientos, modoApi } = useStore();
  const [remoto, setRemoto] = useState<{ movsRec: Movimiento[]; movsOrden: Movimiento[] } | null>(null);
  const ordenId = orden?.id;
  // Se relee cuando cambia un precio de la orden o se registra la factura, no cada vez
  // que el bootstrap trae un arreglo nuevo con lo mismo adentro.
  const firma = `${rec.numeroFactura}|${(orden?.lineas ?? []).map((l) => l.precioUnitario).join(",")}`;
  useEffect(() => {
    if (!modoApi || !ordenId) return;
    let vivo = true;
    const leer = (ent: string, id: string) =>
      fetch(`/api/movimientos?entidad=${ent}&id=${encodeURIComponent(id)}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : []))
        .then((d) => (Array.isArray(d) ? (d as Movimiento[]) : []))
        .catch(() => [] as Movimiento[]);
    Promise.all([leer("recepcion", rec.id), leer("orden", ordenId)])
      .then(([movsRec, movsOrden]) => { if (vivo) setRemoto({ movsRec, movsOrden }); });
    return () => { vivo = false; };
  }, [modoApi, rec.id, ordenId, firma]);
  const local = useMemo(() => ({ movsRec: movimientos, movsOrden: movimientos }), [movimientos]);
  return modoApi ? remoto : local;
}

const titulo = (v: VersionRecepcion) =>
  v.tipo === "recibida" ? "Recibida" : v.tipo === "precio" ? "Precio corregido" : `Factura ${v.numeroFactura ?? ""} registrada`.replace("  ", " ");
const fecha = (f: string) => (f.length > 10 ? formatDateTime(f) : formatDate(f));

// LAS VERSIONES de una recepción (ver lib/versiones-recepcion.ts): cómo entró, cada
// corrección de precio y la factura. No se muestra nada si la recepción nunca cambió.
export function VersionesRecepcion({ rec, orden }: { rec: Recepcion; orden?: Orden }) {
  const bit = useBitacoras(rec, orden);
  const versiones = useMemo(
    () => (bit ? versionesDeRecepcion(rec, orden, bit.movsRec, bit.movsOrden) : []),
    [bit, rec, orden],
  );
  if (!versiones.length) return null;
  const cur = orden?.currencyCode;
  const ultima = versiones[versiones.length - 1].n;
  return (
    <section className="versiones" aria-label="Versiones de esta recepción">
      <div className="versiones__top">
        <span className="ocl-top__ttl">Versiones</span>
        <span className="ds-body-sm ds-muted">{versiones.length} · la más nueva arriba</span>
      </div>
      <ol className="versiones__lista">
        {[...versiones].reverse().map((v) => (
          <li key={v.n} className={`version ${v.n === ultima ? "is-actual" : ""}`}>
            <div className="version__head">
              <span className="ds-strong">Versión {v.n}</span>
              {v.n === ultima && <Badge tone="green">Actual</Badge>}
              <span className="ds-body-sm ds-muted">{titulo(v)} · {fecha(v.fecha)}{v.usuario ? ` · ${v.usuario}` : ""}</span>
              <span className="version__tot">
                {money(v.total, cur)} <span className="ds-body-sm ds-muted">con IVA</span>
                <span className="version__sub ds-body-sm ds-muted">{money(v.subtotal, cur)} sin IVA</span>
              </span>
            </div>
            {v.cambios.length > 0 && (
              <ul className="version__cambios">
                {v.cambios.map((c, i) => (
                  <li key={i} className="ds-body-sm">
                    {c.descripcion}: <span className="ds-muted">{c.antesTxt}</span> → <span className="ds-strong">{c.nuevoTxt}</span>
                  </li>
                ))}
              </ul>
            )}
            {v.tipo === "recibida" && (
              <ul className="version__cambios">
                {v.lineas.map((l) => (
                  <li key={l.ordenLineaId} className="ds-body-sm ds-muted">
                    {l.descripcion}: {num.format(l.cantidad)} {l.unidad} × {precioUnit(l.precio, cur)}
                  </li>
                ))}
              </ul>
            )}
            {v.motivo && <div className="ds-body-sm version__motivo"><span className="ds-muted">Motivo: </span>{v.motivo}</div>}
          </li>
        ))}
      </ol>
    </section>
  );
}
