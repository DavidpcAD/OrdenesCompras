"use client";

import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { Badge, Button, Card, Checkbox, EmptyState, Modal, Textarea, useToast, QtyRing, Skeleton } from "@/components/ui";
import { IconWarning } from "@/components/icons";
import { Timeline } from "@/components/timeline";
import { useStore } from "@/lib/store";
import { useVolver } from "@/lib/use-volver";
import { formatDate, num, pedidoBadge, pedidoLineaPendiente, recibidoDeLineaPedido, destinoCodigo, destinoLabel, tipoSolicitudBadge, esConsumoDirecto, puedeDevolverLinea, motivoNoDevolver } from "@/lib/helpers";

export default function ProveeduriaPedidoDetallePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  // volver = pantalla anterior, con su filtro (el rótulo se ajusta solo)
  const { volver, etiqueta: volverTexto } = useVolver("/proveeduria/solicitudes", "Volver a solicitudes");
  const toast = useToast();
  const { pedidos, ordenes, setBorrador, devolverPedido, cargando } = useStore();
  const [devolverOpen, setDevolverOpen] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [devolviendo, setDevolviendo] = useState(false);
  // Líneas marcadas para devolver. La devolución es POR LÍNEA: lo que ya tiene orden
  // de compra no se puede devolver (el material ya se le pidió al proveedor).
  const [sel, setSel] = useState<Record<string, boolean>>({});

  const pedido = pedidos.find((p) => p.id === id);
  if (!pedido) {
    // Skeleton mientras carga (SQL/BC): evita parpadear "no encontrada".
    if (cargando) {
      return <main className="page"><div className="col gap-4" aria-busy="true">
        <Skeleton style={{ display: "block", width: 240, height: 30, borderRadius: 8 }} />
        <Skeleton style={{ display: "block", width: 360, height: 16, borderRadius: 6 }} />
        <Skeleton style={{ display: "block", width: "100%", height: 340, borderRadius: 16, marginTop: 8 }} />
      </div></main>;
    }
    return <><main className="page"><EmptyState icon={<IconWarning size={24} />} title="Solicitud no encontrada." /></main></>;
  }
  const b = pedidoBadge(pedido.estado);
  const t = tipoSolicitudBadge(pedido.tipoSolicitud);
  const total = pedido.lineas.reduce((s, l) => s + l.cantidad, 0);
  const rec = pedido.lineas.reduce((s, l) => s + recibidoDeLineaPedido(ordenes, l.id), 0);
  const pct = total > 0 ? Math.round(Math.min(100, (rec / total) * 100)) : 0;
  const hayPendiente = pedido.lineas.some((l) => pedidoLineaPendiente(l) > 0);
  // Lo que se puede mandar de vuelta: solo líneas sin orden de compra y sin devolver.
  const devolvibles = pedido.lineas.filter(puedeDevolverLinea);

  function crearOC() {
    const lineas = pedido!.lineas
      .filter((l) => pedidoLineaPendiente(l) > 0)
      .map((l) => ({ pedidoLineaId: l.id, cantidad: pedidoLineaPendiente(l), precio: 0, iva: 13 }));
    if (!lineas.length) { toast("Este pedido no tiene líneas pendientes por ordenar.", "error"); return; }
    setBorrador(lineas);
    router.push("/proveeduria/nueva");
  }
  // Abrir el diálogo con TODO lo devolvible ya marcado: el caso normal sigue siendo
  // "devolver el pedido entero", y quien quiera devolver una sola línea desmarca.
  function abrirDevolver() {
    setSel(Object.fromEntries(devolvibles.map((l) => [l.id, true])));
    setMotivo("");
    setDevolverOpen(true);
  }
  const elegidas = devolvibles.filter((l) => sel[l.id]);

  // Si el servidor falla, avisarlo y dejar el modal abierto con el motivo escrito
  // (antes la promesa se rechazaba sin manejar: no pasaba nada visible).
  async function confirmarDevolver() {
    if (!elegidas.length) { toast("Marcá al menos una línea para devolver.", "error"); return; }
    if (!motivo.trim()) { toast("Escribí el motivo de la devolución.", "error"); return; }
    if (devolviendo) return;
    setDevolviendo(true);
    try {
      const r = await devolverPedido(pedido!.id, motivo.trim(), elegidas.map((l) => l.id));
      setDevolverOpen(false);
      if (r.pedidoDevuelto) {
        toast(`${pedido!.numero} devuelto a Ingeniería.`, "info");
        router.push("/proveeduria/solicitudes");
      } else {
        // El pedido sigue vivo con el resto de las líneas: no se sale de la pantalla,
        // así se ve cómo quedaron marcadas.
        toast(`${r.devueltas} línea(s) devuelta(s) al ingeniero · ${pedido!.numero} sigue abierta con el resto.`, "info");
      }
    } catch (e: any) {
      toast(`No se pudo devolver: ${String(e?.message ?? e)}`, "error");
    } finally {
      setDevolviendo(false);
    }
  }

  return (
    <>
      <main className="page">
        <button type="button" className="back-link" onClick={volver}>{volverTexto}</button>
        <div className="page__head">
          <div className="page__title">
            <div className="row gap-3">
              <h1 className="ds-heading">{pedido.numero}</h1>
              <Badge tone={t.tone}>{t.label}</Badge>
              <Badge tone={b.tone}>{b.label}</Badge>
            </div>
            <p className="ds-muted">{destinoCodigo(pedido)} · {destinoLabel(pedido)} · {pedido.solicitante} · {formatDate(pedido.fecha)}</p>
          </div>
          <div className="row gap-3" style={{ alignItems: "center" }}>
            <div className="row gap-2" style={{ alignItems: "center" }}><QtyRing recibida={rec} total={total} /><span className="ds-body-sm ds-muted">entregado</span></div>
            {/* Manda la lista de materiales a cotizar. Es un <a> al endpoint del
                servidor (no un botón con fetch) para que el navegador baje el .pdf
                de una vez, igual que en la orden de compra. */}
            <a className="ds-btn ds-btn--white" href={`/api/pedidos/${pedido.id}/pdf`}
              title="Baja la solicitud en PDF con las columnas de precio en blanco, para mandarla a cotizar"
              style={{ textDecoration: "none" }}>⬇ PDF para cotizar</a>
            <Button variant="red" disabled={!devolvibles.length} onClick={abrirDevolver}
              title={devolvibles.length
                ? "Devolver al ingeniero las líneas que todavía no tienen orden de compra"
                : "No queda nada por devolver: todas las líneas ya tienen orden de compra o ya se devolvieron"}>
              Devolver al ingeniero{devolvibles.length && devolvibles.length < pedido.lineas.length ? ` (${devolvibles.length})` : ""}
            </Button>
            <Button onClick={crearOC} disabled={!hayPendiente}>Crear orden de compra →</Button>
          </div>
        </div>

        {pedido.notas && (
          <Card className="mt-2" style={{ background: "color-mix(in srgb, var(--ds-color-yellow) 8%, var(--ds-tint-base))" }}>
            <span className="ds-label ds-muted">Comentario</span>
            <p style={{ margin: "4px 0 0" }}>{pedido.notas}</p>
          </Card>
        )}

        <Card className="mt-4" style={{ padding: 0, overflow: "hidden" }}>
          <div className="ds-table-wrap" style={{ boxShadow: "none" }}>
            <table className="ds-table">
              <thead><tr><th>Artículo</th><th>Destino</th><th className="ds-num">Solicitado</th><th className="ds-num">Ordenado</th><th className="ds-num">Pendiente</th></tr></thead>
              <tbody>
                {pedido.lineas.map((l) => (
                  <tr key={l.id} style={l.devuelta ? { opacity: 0.6 } : undefined}>
                    <td>
                      <div className="ds-clamp-2" title={l.descripcion} style={{ maxWidth: 420, minWidth: 240 }}>{l.descripcion}</div>
                      {/* Devuelta = bloqueada: no se puede ordenar ni volver a
                          devolver. El motivo queda en el historial de abajo. */}
                      {l.devuelta && <Badge tone="yellow">↩ Devuelta al ingeniero</Badge>}
                    </td>
                    <td className="ds-muted ds-body-sm">
                      {l.almacen || "—"}
                      {/* La TAREA es lo que marca el consumo directo (así lo etiqueta
                          Ingeniería): con tarea, la orden se arma con obra + tarea y BC
                          consume el material contra el presupuesto de la obra; sin
                          tarea, la obra es solo el para-quién y el material entra al
                          almacén. Se muestra acá porque es lo que Angie necesita saber
                          antes de armar la orden. */}
                      {esConsumoDirecto(l)
                        ? <div title={l.taskDescr}>Obra {l.proyecto} · <span className="ds-strong">tarea {l.taskNo}</span>{l.taskDescr ? ` — ${l.taskDescr}` : ""}</div>
                        : l.proyecto && <div>Para obra {l.proyecto} · entra al almacén</div>}
                    </td>
                    <td className="ds-num">{num.format(l.cantidad)} {l.unidad}</td>
                    <td className="ds-num">{num.format(l.cantidadOrdenada)}</td>
                    <td className="ds-num">{pedidoLineaPendiente(l) > 0 ? <span className="ds-pending-text">{num.format(pedidoLineaPendiente(l))}</span> : "0"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <h3 className="ds-subtitle mt-6" style={{ marginBottom: 12 }}>Historial</h3>
        <Card><Timeline entidad="pedido" idEntidad={pedido.id} traza /></Card>
      </main>

      {devolverOpen && (
        <Modal wide title={`Devolver material de ${pedido.numero} a Ingeniería`} onClose={() => setDevolverOpen(false)}
          footer={<>
            <Button variant="outline" disabled={devolviendo} onClick={() => setDevolverOpen(false)}>Cancelar</Button>
            <Button variant="red" disabled={devolviendo || !elegidas.length} onClick={confirmarDevolver}>
              {devolviendo ? "Devolviendo…" : `Devolver ${elegidas.length} línea(s)`}
            </Button>
          </>}>
          <p className="ds-muted ds-body-sm" style={{ marginTop: 0 }}>
            Marcá qué materiales vuelven al ingeniero. Los que <span className="ds-strong">ya tienen orden de compra</span> no se
            pueden devolver: ese material ya se le pidió al proveedor. Si vuelve TODO el pedido, queda en estado “Devuelto”;
            si vuelve solo una parte, la solicitud sigue viva con el resto y esas líneas quedan bloqueadas.
          </p>
          <div className="ds-table-wrap" style={{ boxShadow: "none", marginBottom: 16 }}>
            <table className="ds-table">
              <thead><tr><th style={{ width: 40 }}></th><th>Artículo</th><th className="ds-num">Cantidad</th><th>Estado</th></tr></thead>
              <tbody>
                {pedido.lineas.map((l) => {
                  const bloqueo = motivoNoDevolver(l);
                  return (
                    <tr key={l.id} style={bloqueo ? { opacity: 0.6 } : undefined}>
                      <td>
                        <Checkbox checked={!!sel[l.id]} disabled={!!bloqueo}
                          aria-label={`Devolver ${l.descripcion}`}
                          onChange={(e) => setSel((m) => ({ ...m, [l.id]: e.target.checked }))} />
                      </td>
                      <td><div className="ds-clamp-2" style={{ maxWidth: 360, minWidth: 200 }}>{l.descripcion}</div></td>
                      <td className="ds-num">{num.format(l.cantidad)} {l.unidad}</td>
                      <td className="ds-body-sm ds-muted">{bloqueo || "se puede devolver"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo de la devolución…" rows={3} style={{ width: "100%" }} />
        </Modal>
      )}
    </>
  );
}
