"use client";

import { useState } from "react";
import { AppShell } from "@/components/shell";
import { Badge, Button, Card, Modal, Textarea, Tile, useToast } from "@/components/ui";
import { useStore } from "@/lib/store";
import { aprobarYLanzar } from "@/lib/aprobar";
import { money, formatDate, num, ordenLineaImporte } from "@/lib/helpers";
import type { Orden } from "@/lib/types";

export default function AprobacionPage() {
  const { ordenes, proveedores, setOrdenEstado, devolverOrden } = useStore();
  const toast = useToast();
  const prov = (id: string) => proveedores.find((p) => p.id === id);
  const [rechObj, setRechObj] = useState<{ id: string; numero: string } | null>(null);
  const [motivo, setMotivo] = useState("");
  const [aprobandoId, setAprobandoId] = useState<string | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [lote, setLote] = useState(false);

  const porAprobar = ordenes.filter((o) => o.estado === "pendiente_aprobacion");
  const toggleSel = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const seleccionadas = porAprobar.filter((o) => sel.has(o.id));

  // Crea y lanza en BC; solo pasa a "lanzado" si BC de verdad lo hizo (lib/aprobar.ts).
  async function aprobar(o: Orden) {
    setAprobandoId(o.id);
    const r = await aprobarYLanzar(o, setOrdenEstado);
    toast(r.message, r.tone);
    setAprobandoId(null);
  }
  // Aprobar y lanzar en LOTE: una por una (BC no debe recibir todo en paralelo).
  async function aprobarSeleccionadas() {
    if (!seleccionadas.length) return;
    setLote(true);
    let ok = 0; const fallos: string[] = [];
    for (const o of seleccionadas) {
      const r = await aprobarYLanzar(o, setOrdenEstado);
      if (r.ok) ok++; else fallos.push(o.numero);
    }
    setLote(false); setSel(new Set());
    toast(`Aprobadas y lanzadas: ${ok}${fallos.length ? ` · con problema: ${fallos.join(", ")} (revisá cada una)` : ""}`, fallos.length ? "info" : "success");
  }
  // Rechazar/denegar: motivo OBLIGATORIO; vuelve a Proveeduría con la nota.
  async function confirmarRechazo() {
    if (!rechObj) return;
    if (!motivo.trim()) { toast("Escribí el motivo del rechazo.", "error"); return; }
    await devolverOrden(rechObj.id, motivo.trim());
    toast(`Orden ${rechObj.numero} devuelta a proveeduría`, "info");
    setRechObj(null); setMotivo("");
  }

  return (
    <AppShell role="aprobacion">
      <main className="page">
        <div className="page__head">
          <div className="page__title">
            <h1 className="ds-heading">Órdenes por aprobar</h1>
            <p className="ds-muted">Revisá las órdenes que proveeduría envió a aprobación. Al aprobar pasan a “Lanzado” y se envían al proveedor.</p>
          </div>
        </div>

        <div className="tiles tiles-3 mt-2">
          <Tile value={porAprobar.length} label="Pendientes de aprobación" accent="var(--ds-color-yellow)" />
          <Tile value={ordenes.filter((o) => o.estado === "lanzado").length} label="Lanzadas" accent="var(--ds-color-green-100)" />
          <Tile value={ordenes.filter((o) => o.estado === "completado").length} label="Completadas" accent="var(--ds-color-green-200)" />
        </div>

        {porAprobar.length > 0 && (
          <div className="row row--between wrap gap-3 mt-6" style={{ alignItems: "center", padding: "10px 14px", borderRadius: 12, background: "color-mix(in srgb, var(--ds-color-green-100) 8%, #fff)", border: "1.5px solid var(--ds-color-gray-100)" }}>
            <label className="row gap-2" style={{ alignItems: "center", cursor: "pointer" }}>
              <input type="checkbox" checked={sel.size > 0 && sel.size === porAprobar.length}
                ref={(el) => { if (el) el.indeterminate = sel.size > 0 && sel.size < porAprobar.length; }}
                onChange={(e) => setSel(e.target.checked ? new Set(porAprobar.map((o) => o.id)) : new Set())} />
              <span className="ds-body-sm ds-strong">Seleccionar todas ({porAprobar.length})</span>
            </label>
            <Button onClick={aprobarSeleccionadas} disabled={sel.size === 0 || lote}>
              {lote ? "Lanzando…" : `Aprobar y lanzar seleccionadas (${sel.size})`}
            </Button>
          </div>
        )}

        <div className="col gap-4 mt-4">
          {porAprobar.length === 0 && <Card><div className="empty" style={{ lineHeight: 1.6 }}>No hay órdenes pendientes de aprobación.<br /><span className="ds-muted ds-body-sm">Para ver las que ya aprobaste o se completaron, abrí la pestaña <strong>“Todas las órdenes”</strong> arriba.</span></div></Card>}
          {porAprobar.map((o) => {
            const articulos = o.lineas.filter((l) => l.tipo === "articulo");
            const total = o.lineas.reduce((s, l) => s + ordenLineaImporte(l), 0);
            return (
              <Card key={o.id}>
                <div className="row row--between wrap gap-4" style={{ marginBottom: 12 }}>
                  <div className="col" style={{ gap: 4 }}>
                    <div className="row gap-3" style={{ alignItems: "center" }}>
                      <input type="checkbox" checked={sel.has(o.id)} onChange={() => toggleSel(o.id)} title="Seleccionar para aprobar en lote" style={{ width: 16, height: 16 }} />
                      <span className="ds-subtitle">{o.numero}</span>
                      <Badge tone="yellow">Pendiente de aprobación</Badge>
                    </div>
                    <span className="ds-muted ds-label">{o.proveedorNo ?? prov(o.proveedorId)?.code} · {o.proveedorNombre ?? prov(o.proveedorId)?.nombre} · {formatDate(o.fecha)}</span>
                  </div>
                  <div className="row gap-3">
                    <Button variant="red" onClick={() => { setMotivo(""); setRechObj({ id: o.id, numero: o.numero }); }} disabled={aprobandoId === o.id}>Rechazar</Button>
                    <Button onClick={() => aprobar(o)} disabled={aprobandoId === o.id}>{aprobandoId === o.id ? "Lanzando…" : "Aprobar y lanzar"}</Button>
                  </div>
                </div>

                <div className="ds-table-wrap" style={{ boxShadow: "none", border: "1.5px solid var(--ds-color-gray-100)" }}>
                  <table className="ds-table">
                    <thead>
                      <tr><th className="hide-mobile">Tipo</th><th>Descripción</th><th className="hide-mobile">Almacén</th><th className="ds-num">Cantidad</th><th className="ds-num">Precio</th><th className="ds-num">Importe</th></tr>
                    </thead>
                    <tbody>
                      {o.lineas.map((l) => (
                        <tr key={l.id}>
                          <td className="hide-mobile">{l.tipo === "cargo" ? <Badge tone="yellow">Cargo</Badge> : <Badge tone="gray">Artículo</Badge>}</td>
                          <td>{l.descripcion}{l.pedidoNumero && <div className="ds-body-sm ds-muted">{l.pedidoNumero}</div>}</td>
                          <td className="ds-muted ds-body-sm hide-mobile">{l.almacen}</td>
                          <td className="ds-num">{num.format(l.cantidad)} {l.unidad}</td>
                          <td className="ds-num">{money(l.precioUnitario, o.currencyCode)}</td>
                          <td className="ds-num ds-strong">{money(ordenLineaImporte(l), o.currencyCode)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="row mt-4" style={{ justifyContent: "flex-end" }}>
                  <span className="ds-muted ds-label" style={{ marginRight: 12 }}>{articulos.length} línea(s) · Total</span>
                  <span className="ds-subtitle">{money(total, o.currencyCode)}</span>
                </div>
              </Card>
            );
          })}
        </div>

        {rechObj && (
          <Modal title={`Rechazar ${rechObj.numero}`} onClose={() => setRechObj(null)}
            footer={<><Button variant="outline" onClick={() => setRechObj(null)}>Cancelar</Button><Button variant="red" onClick={confirmarRechazo}>Rechazar y devolver</Button></>}>
            <p className="ds-muted ds-body-sm" style={{ marginTop: 0 }}>Indicá por qué se devuelve la orden. Le llega una notificación a Proveeduría y el motivo queda en el historial.</p>
            <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo del rechazo…" rows={4} style={{ width: "100%" }} />
          </Modal>
        )}
      </main>
    </AppShell>
  );
}
