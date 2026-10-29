"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Card, EmptyState, Input, Skeleton } from "@/components/ui";
import { IconList, IconReceipt, IconWarning } from "@/components/icons";
import { cuenta, formatDate, formatDateTime, money } from "@/lib/helpers";
import type { CargoRecibidoHist } from "@/lib/types";

const METODOS: Record<string, string> = {
  Amount: "por importe", Equally: "en partes iguales", Weight: "por peso", Volume: "por volumen",
};

const IconExterno = () => (
  <svg className="nc-linkbtn__ext" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M7 17 17 7M9 7h8v8" /></svg>
);

// Historial de Cargo sobre factura (Contabilidad · Kattya): cada cargo de un tercero
// que se registró en BC desde la app. BC solo dice que lo registró la app; acá queda
// quién fue, cuándo, contra qué recepciones y con los links para revisarlo en BC.
export default function HistorialCargosPage() {
  const router = useRouter();
  const [cargos, setCargos] = useState<CargoRecibidoHist[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    fetch("/api/cargos-recibidos")
      .then((r) => r.json())
      .then((d) => { setCargos(Array.isArray(d.cargos) ? d.cargos : []); if (d.error) setError(String(d.error)); })
      .catch((e) => { setCargos([]); setError(String(e?.message ?? e)); });
  }, []);

  // Busca en todo lo que alguien podría tener a mano: el N.º de BC, la factura del
  // proveedor, el proveedor, quién lo registró, la recepción o el artículo.
  const visibles = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!cargos || !t) return cargos ?? [];
    return cargos.filter((c) => [
      c.facturaBc, c.facturaProveedor, c.proveedorNo, c.proveedorNombre, c.registradoPor, c.descripcionCargo,
      ...c.lineas.flatMap((l) => [l.recepcionNo, l.articuloNo, l.descripcion]),
    ].some((x) => (x ?? "").toLowerCase().includes(t)));
  }, [cargos, q]);

  return (
    <main className="page page--wide">
      <button type="button" className="back-link" onClick={() => router.push("/facturacion/cargo")}>Volver a cargo sobre factura</button>
      <div className="page__head">
        <div className="page__title">
          <h1 className="ds-heading">Historial de cargos</h1>
          <p className="ds-muted">Cada cargo de un tercero registrado en Business Central desde la app: quién lo registró, cuándo, a qué recepciones se asignó, y los links para revisarlo en BC.</p>
        </div>
      </div>

      {cargos && cargos.length > 0 && (
        <div className="row gap-3 wrap" style={{ alignItems: "center" }}>
          <div style={{ flex: "1 1 320px", maxWidth: 420 }}>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por N.º de BC, factura, proveedor, recepción…" aria-label="Buscar en el historial" />
          </div>
          <span className="ds-body-sm ds-muted">{cuenta(visibles.length, "cargo", "cargos")}</span>
        </div>
      )}

      {error && (
        <div className="ds-callout ds-callout--yellow mt-4" role="status">
          <span className="ds-callout__icon"><IconWarning size={18} /></span>
          <div>
            <div className="ds-callout__title">No se pudo leer el historial</div>
            <div className="ds-callout__body">{error.replace(/\.?\s*$/, ".")} Los cargos registrados igual están en BC.</div>
          </div>
        </div>
      )}

      {cargos === null ? (
        <div className="col gap-4 mt-6">
          <Skeleton width="100%" height={160} radius={16} style={{ display: "block" }} />
          <Skeleton width="100%" height={160} radius={16} style={{ display: "block" }} />
        </div>
      ) : visibles.length === 0 ? (
        // Si no se pudo leer, el aviso de arriba ya lo dice: "no hay cargos" sería mentira.
        error && !q.trim() ? null :
        <Card className="mt-6">
          {q.trim()
            ? <EmptyState icon={<IconList size={24} />} title="Ningún cargo coincide con la búsqueda." hint="Probá con el N.º de BC (CFR-…), la factura del proveedor o la recepción (CR-…)." />
            : <EmptyState icon={<IconList size={24} />} title="Todavía no hay cargos en el historial." hint={<>Cada cargo que se registre en <strong>Cargo sobre factura</strong> queda acá, con su detalle y el link a BC.</>} />}
        </Card>
      ) : (
        <div className="col gap-4 mt-6">
          {visibles.map((c) => {
            const hayReparto = c.lineas.some((l) => l.asignado != null);
            return (
              <Card key={c.id} style={{ padding: 0, overflow: "hidden" }}>
                <div className="nc-grp-head nc-grp-head--static">
                  <div className="col" style={{ gap: 2 }}>
                    <span className="ds-strong">
                      {c.facturaBc || "Sin N.º de BC"}
                      <span className="ds-muted"> · {c.proveedorNombre || c.proveedorNo}</span>
                    </span>
                    <span className="ds-body-sm ds-muted">
                      Factura {c.facturaProveedor}{c.fechaFactura ? ` del ${formatDate(c.fechaFactura)}` : ""}
                      {" · "}{[c.tipoCargo, c.descripcionCargo].filter(Boolean).join(" ")}
                      {c.metodo ? ` · repartido ${METODOS[c.metodo] ?? c.metodo}` : ""}
                    </span>
                  </div>
                  <span className="row gap-3 wrap" style={{ alignItems: "center" }}>
                    <span className="col" style={{ gap: 0, alignItems: "flex-end" }}>
                      <span className="ds-strong">{money(c.importe, c.moneda)}</span>
                      {c.cantidad !== 1 && <span className="ds-body-sm ds-muted">{c.cantidad} × {money(c.precioUnitario, c.moneda)}</span>}
                    </span>
                    {c.bcFacturaUrl && (
                      <a href={c.bcFacturaUrl} target="_blank" rel="noopener noreferrer" className="nc-linkbtn nc-linkbtn--primary" title="Ver la factura registrada en Business Central">
                        <IconReceipt size={16} /> Factura en BC <IconExterno />
                      </a>
                    )}
                  </span>
                </div>

                {c.borradores.length > 0 && (
                  <div className="ds-callout ds-callout--yellow" role="status" style={{ margin: "12px 16px 0" }}>
                    <span className="ds-callout__icon"><IconWarning size={18} /></span>
                    <div>
                      <div className="ds-callout__title">Al registrar había en BC {c.borradores.length === 1 ? "un borrador" : "borradores"} de esta misma factura</div>
                      <div className="ds-callout__body">
                        Si sigue{c.borradores.length === 1 ? "" : "n"} ahí, hay que borrarlo{c.borradores.length === 1 ? "" : "s"} en BC para que la factura no quede dos veces.
                        <span className="row gap-3 wrap" style={{ marginTop: 8 }}>
                          {c.borradores.map((b) => b.url
                            ? <a key={b.numero} href={b.url} target="_blank" rel="noopener noreferrer" className="nc-linkbtn">{b.numero} <IconExterno /></a>
                            : <span key={b.numero} className="ds-strong">{b.numero}</span>)}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                <div className="ds-table-wrap" style={{ boxShadow: "none" }}>
                  <table className="ds-table">
                    <thead>
                      <tr>
                        <th>Recepción</th><th>Artículo</th><th>Almacén</th>
                        <th className="ds-num">Importe línea</th><th className="ds-num">Cargo asignado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {c.lineas.length === 0 ? (
                        <tr><td colSpan={5} className="ds-body-sm ds-muted">No quedó el detalle de líneas. La asignación está en la factura de BC.</td></tr>
                      ) : c.lineas.map((l) => (
                        <tr key={`${l.recepcionNo}#${l.lineaNo}`}>
                          <td className="ds-body-sm">
                            {l.recepcionUrl
                              ? <a href={l.recepcionUrl} target="_blank" rel="noopener noreferrer" className="linklike ds-strong" title="Ver la recepción registrada en Business Central">{l.recepcionNo}</a>
                              : <span className="ds-strong">{l.recepcionNo}</span>}
                            <span className="ds-muted"> · {l.lineaNo}</span>
                          </td>
                          <td className="ds-body-sm">
                            <div className="ds-clamp-2" title={`${l.articuloNo} — ${l.descripcion}`} style={{ maxWidth: 380, minWidth: 220 }}>
                              {l.articuloNo ? <span className="ds-strong">{l.articuloNo}</span> : null}{l.articuloNo && l.descripcion ? " — " : ""}{l.descripcion}
                            </div>
                          </td>
                          <td className="ds-body-sm ds-muted">{l.almacen || "—"}</td>
                          <td className="ds-num ds-body-sm">{money(l.importe, l.moneda)}</td>
                          <td className="ds-num ds-strong">{l.asignado != null ? money(l.asignado, c.moneda) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={5} className="ds-body-sm ds-muted" style={{ padding: "10px 16px", borderTop: "1.5px solid var(--ds-color-gray-100)" }}>
                          Registró <span className="ds-strong">{c.registradoPor || "—"}</span> el {formatDateTime(c.fecha)}.{" "}
                          {hayReparto
                            ? "El cargo asignado es el reparto que calculó la app; el definitivo, en colones, es el de la factura en BC."
                            : "El reparto lo calculó BC al registrar: está en la factura en BC."}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </main>
  );
}
