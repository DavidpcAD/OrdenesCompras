"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { cuenta, formatDate, lineasDeRecepcion, money, num } from "@/lib/helpers";
import type { EnvioARevision, Orden, Recepcion } from "@/lib/types";

// OTRA RECEPCIÓN EN REVISIÓN DE LA MISMA ORDEN. Pasa cuando la factura trae más de lo
// que se recibió en una: la diferencia se recibe aparte y quedan dos registros para
// una sola factura, que en BC no se puede registrar dos veces con el mismo N.º. Acá
// se ven las dos y se juntan en un solo registro antes de registrar (una parte de la
// línea en una, el resto en la otra, y la factura con todo). Juntar no toca BC: allá se
// factura por línea del pedido lo recibido sin facturar, venga de donde venga.
//
// Lo comparten el panel de la orden y el modal de "Registrar factura".
export function OtrasEnRevision({ rec, otras, orden, envioDe, onJuntar }: {
  rec: Recepcion; otras: Recepcion[]; orden?: Orden; envioDe: Map<string, EnvioARevision>;
  onJuntar: (otra: Recepcion) => Promise<unknown>;
}) {
  // La que se está por juntar (paso de confirmación) y la que se está juntando.
  const [confirmar, setConfirmar] = useState<string | null>(null);
  const [juntando, setJuntando] = useState<string | null>(null);
  if (!otras.length) return null;
  const cur = orden?.currencyCode;
  const aqui = new Map(rec.lineas.map((l) => [l.ordenLineaId, l.cantidadRecibida]));
  return (
    <div className="rev-otra" role="region" aria-label="Otras recepciones en revisión de esta orden">
      <div className="rev-otra__ttl">
        {otras.length === 1 ? "Esta orden tiene otra recepción en revisión" : `Esta orden tiene ${otras.length} recepciones más en revisión`}
      </div>
      <p className="rev-otra__txt">
        Si son de la misma factura, juntalas: queda un solo registro y la factura se registra de una vez. No toca Business Central.
      </p>
      {otras.map((o) => {
        const envio = envioDe.get(o.id);
        const filas = lineasDeRecepcion(o, orden);
        const sub = filas.reduce((s, f) => s + Math.round(f.importe * 100) / 100, 0);
        // Las líneas que están en las dos: lo que interesa es cuánto suman juntas.
        const enLasDos = filas.filter(({ rl }) => aqui.has(rl.ordenLineaId));
        const quien = o.recibidoPor || envio?.enviadaPor;
        return (
          <div key={o.id} className="rev-otra__item">
            <div className="rev-otra__desc">
              <div>
                <span className="ds-strong">Recibida el {formatDate(o.fechaRecepcion)}{quien ? ` por ${quien}` : ""}</span>
                {envio?.facturaProveedor ? <> · Fact. {envio.facturaProveedor}</> : null}
                <span className="ds-muted"> · {cuenta(filas.length, "línea", "líneas")} · {money(sub, cur)} sin IVA</span>
              </div>
              {filas.length <= 3 && (
                <div className="ds-muted">
                  {filas.map(({ rl, ol }) => `${num.format(rl.cantidadRecibida)} ${ol?.unidad ?? ""} ${ol?.descripcion ?? "línea"}`.replace(/\s+/g, " ")).join(" · ")}
                </div>
              )}
              {enLasDos.map(({ rl, ol }) => {
                const a = aqui.get(rl.ordenLineaId) ?? 0;
                return (
                  <div key={rl.ordenLineaId}>
                    {ol?.descripcion ?? "Una línea"} está en las dos: {num.format(a)} + {num.format(rl.cantidadRecibida)} ={" "}
                    <span className="ds-strong">{num.format(Math.round((a + rl.cantidadRecibida) * 1e4) / 1e4)} {ol?.unidad ?? ""}</span> juntas.
                  </div>
                );
              })}
            </div>
            <div className="rev-otra__acc">
              {confirmar === o.id ? (
                <>
                  <span className="rev-otra__pregunta">¿Juntarlas en un solo registro?</span>
                  <Button variant="green" size="sm" loading={juntando === o.id} disabled={!!juntando}
                    onClick={async () => {
                      setJuntando(o.id);
                      try { await onJuntar(o); } finally { setJuntando(null); setConfirmar(null); }
                    }}>
                    {juntando === o.id ? "Juntando…" : "Sí, juntar"}
                  </Button>
                  <button type="button" className="link-btn link-btn--sm" disabled={!!juntando} onClick={() => setConfirmar(null)}>Cancelar</button>
                </>
              ) : (
                <button type="button" className="link-btn link-btn--sm" disabled={!!juntando} onClick={() => setConfirmar(o.id)}>
                  Juntar con esta
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
