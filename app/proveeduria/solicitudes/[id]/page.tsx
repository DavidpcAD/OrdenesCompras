"use client";

import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { Badge, Button, Card, Checkbox, EmptyState, Field, Modal, Select, Textarea, useToast, QtyRing, Skeleton } from "@/components/ui";
import { IconWarning } from "@/components/icons";
import { Timeline } from "@/components/timeline";
import { useStore } from "@/lib/store";
import { useVolver } from "@/lib/use-volver";
import { useVariantes } from "@/lib/use-variantes";
import { codigoDeItem } from "@/lib/unidad";
import { formatDate, num, pedidoBadge, pedidoLineaPendiente, recibidoDeLineaPedido, destinoCodigo, destinoLabel, tipoSolicitudBadge, esConsumoDirecto, puedeDevolverLinea, motivoNoDevolver, ordenesDeLineaPedido, estadoDeDevolucion, correccionDeSolicitud, ordenDeDevolucion, numeroOrden, motivoDeCierreSolicitud, comentarioDeSolicitud } from "@/lib/helpers";

// Por qué se archiva una solicitud, en las palabras del oficio. Es un Select y no
// un campo libre a propósito: el motivo es LA razón de ser del cierre, y con una
// caja de texto vacía la mitad queda en "ok". El detalle fino va en la nota.
const MOTIVOS_CIERRE = [
  "Ya no se necesita",
  "Se compró en otro lado",
  "Cambió el alcance de la obra",
  "Lo pidió el ingeniero",
  "Solicitud duplicada",
];

export default function ProveeduriaPedidoDetallePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  // volver = pantalla anterior, con su filtro (el rótulo se ajusta solo)
  const { volver, etiqueta: volverTexto } = useVolver("/proveeduria/solicitudes", "Volver a solicitudes");
  const toast = useToast();
  const { pedidos, ordenes, setBorrador, devolverPedido, cerrarSolicitud, reabrirSolicitud, retomarOrden, cargando } = useStore();
  const [devolverOpen, setDevolverOpen] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [devolviendo, setDevolviendo] = useState(false);
  const [retomando, setRetomando] = useState(false);
  // Archivar la solicitud que quedó a medias. El motivo sale de un Select y la nota
  // es el detalle libre; se guardan juntos, igual que en "Cerrar orden".
  const [cerrarOpen, setCerrarOpen] = useState(false);
  const [motivoCierre, setMotivoCierre] = useState("");
  const [notaCierre, setNotaCierre] = useState("");
  const [cerrando, setCerrando] = useState(false);
  // Líneas marcadas para devolver. La devolución es POR LÍNEA: lo que ya tiene orden
  // de compra no se puede devolver (el material ya se le pidió al proveedor).
  const [sel, setSel] = useState<Record<string, boolean>>({});

  // Volver a usar la orden de la que salió este material, cuando la devolución vieja
  // la había descartado. La orden vuelve SIN material (el corregido se le agrega al
  // editarla) y con su pedido de Business Central intacto, que es el punto.
  async function retomar(numero: string) {
    setRetomando(true);
    try {
      const r = await retomarOrden(numero);
      if (r.bcAviso) toast(r.bcAviso, "info");
      else toast(`${numero} retomada: agregale el material corregido con “+ De solicitudes” y volvé a enviarla a aprobación.`, "success");
      // Al EDITOR: allá el material corregido ya viene puesto y solo falta guardar.
      router.push(`/proveeduria/ordenes/${r.id}/editar`);
    } catch (e: any) {
      // El servidor dice por qué no se puede (nunca llegó a BC, tiene recepciones, no
      // existe): es información para decidir, no una falla.
      toast(String(e?.message ?? e), "error");
      setRetomando(false);
    }
  }

  const pedido = pedidos.find((p) => p.id === id);
  // Variantes de los materiales de esta solicitud (el grado, la medida, la talla):
  // sin esto la línea dice apenas el material genérico. El hook tolera la lista
  // vacía, así que se llama antes de los returns tempranos.
  const variantes = useVariantes((pedido?.lineas ?? []).map((l) => l.articuloId));
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
  // ARCHIVADA: el saldo se dio de baja y la solicitud es de solo lectura. Se calcula
  // acá porque gobierna los tres botones de la barra: sin esto, "Crear orden de
  // compra →" seguía habilitado y volvía a consumir el saldo que se dio por muerto.
  const cerrada = pedido.estado === "cerrado";
  const hayPendiente = !cerrada && pedido.lineas.some((l) => pedidoLineaPendiente(l) > 0);
  // Lo que se puede mandar de vuelta: solo líneas sin orden de compra y sin devolver.
  const devolvibles = pedido.lineas.filter(puedeDevolverLinea);
  // Lo que el cierre va a dar de baja (o dio, si ya está cerrada): lo que nadie ordenó.
  const sinComprar = pedido.lineas.filter((l) => !l.devuelta && l.cantidad - l.cantidadOrdenada > 1e-9);
  const unidadesSinComprar = sinComprar.reduce((s, l) => s + (l.cantidad - l.cantidadOrdenada), 0);

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

  function abrirCerrar() {
    setMotivoCierre("");
    setNotaCierre("");
    setCerrarOpen(true);
  }

  // Mismo criterio que confirmarDevolver: si el server falla, el modal queda ABIERTO
  // con lo escrito. El motivo es obligatorio también acá, pero el guard de verdad
  // está en el server (la pantalla no es la única puerta).
  async function confirmarCerrar() {
    if (!motivoCierre) { toast("Elegí el motivo del cierre.", "error"); return; }
    if (cerrando) return;
    setCerrando(true);
    try {
      const texto = [motivoCierre, notaCierre.trim()].filter(Boolean).join(" — ");
      const r = await cerrarSolicitud(pedido!.id, texto);
      setCerrarOpen(false);
      toast(r.lineasCanceladas > 0
        ? `${pedido!.numero} archivada · ${num.format(r.unidadesCanceladas)} u. en ${r.lineasCanceladas} línea(s) ya no se van a comprar`
        : `${pedido!.numero} archivada`, "success");
    } catch (e: any) {
      toast(`No se pudo cerrar: ${String(e?.message ?? e)}`, "error");
    } finally {
      setCerrando(false);
    }
  }

  async function deshacerCierre() {
    if (cerrando) return;
    setCerrando(true);
    try {
      await reabrirSolicitud(pedido!.id);
      toast(`${pedido!.numero} volvió a las solicitudes: su saldo está otra vez pendiente.`, "info");
    } catch (e: any) {
      toast(`No se pudo reabrir: ${String(e?.message ?? e)}`, "error");
    } finally {
      setCerrando(false);
    }
  }

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
            {/* No en la archivada: no hay nada que cotizar, y el server también lo
                rechaza (si el link llegara por otro lado). */}
            {!cerrada && (
              <a className="ds-btn ds-btn--white" href={`/api/pedidos/${pedido.id}/pdf`}
                title="Baja la solicitud en PDF con las columnas de precio en blanco, para mandarla a cotizar"
                style={{ textDecoration: "none" }}>⬇ PDF para cotizar</a>
            )}
            {/* Archivada = solo lectura. Los tres botones de trabajo desaparecen (no
                se deshabilitan: no hay nada que explicar, la solicitud terminó) y en
                su lugar queda la salida para deshacerlo. */}
            {cerrada ? (
              <Button variant="outline" disabled={cerrando} onClick={deshacerCierre}
                title="Volver a abrir la solicitud: su saldo vuelve a quedar pendiente">
                {cerrando ? "Reabriendo…" : "Reabrir solicitud"}
              </Button>
            ) : (<>
              {/* Cerrar no es destructivo como devolver —no le manda nada a nadie, da
                  de baja lo que ya no se compra—, por eso `outline` y no `red`. Mismo
                  criterio que "Cerrar orden". */}
              <Button variant="outline" onClick={abrirCerrar}
                title="Archivar la solicitud: lo que quedó sin ordenar ya no se va a comprar">
                Cerrar solicitud
              </Button>
              {/* El botón SIEMPRE abre el diálogo, aunque no haya nada devolvible: es ahí
                  donde se explica, línea por línea, cuál orden se llevó el material.
                  Deshabilitado no explicaba nada y dejaba a Proveeduría adivinando. */}
              <Button variant="red" onClick={abrirDevolver}
                title="Devolver al ingeniero las líneas que todavía no tienen orden de compra">
                Devolver al ingeniero{devolvibles.length && devolvibles.length < pedido.lineas.length ? ` (${devolvibles.length})` : ""}
              </Button>
              <Button onClick={crearOC} disabled={!hayPendiente}>Crear orden de compra →</Button>
            </>)}
          </div>
        </div>

        {/* Cómo va la devolución que le hiciste a esta solicitud. Hasta ahora, cuando
            el ingeniero corregía, esto no se decía en ninguna parte: la solicitud
            salía de la bandeja de Devoluciones y punto. */}
        {(() => {
          const estado = estadoDeDevolucion(pedido);
          if (!estado) return null;
          const { fecha, quien } = correccionDeSolicitud(pedido);
          const dev = pedido.devolucion;
          const corregida = estado === "corregida";
          // La orden de la que SALIÓ este material. Si sigue viva, el material vuelve
          // a ELLA: es el mismo pedido de Business Central, con su número y su
          // historia. Armar una orden nueva significa un segundo pedido en BC por el
          // mismo material, y eso era lo único que la app ofrecía.
          const origen = ordenDeDevolucion(ordenes, pedido);
          return (
            <Card className="mt-2" style={{ background: corregida
              ? "color-mix(in srgb, var(--ds-color-green-100) 10%, var(--ds-tint-base))"
              : "color-mix(in srgb, var(--ds-color-yellow) 8%, var(--ds-tint-base))" }}>
              <span className="ds-label ds-muted">{corregida ? "Devolución corregida" : "Devuelta al ingeniero"}</span>
              <p style={{ margin: "4px 0 0" }}>
                {corregida
                  ? <>El ingeniero ya corrigió lo que devolviste{fecha ? <> el <span className="ds-strong">{formatDate(fecha)}</span></> : ""}{quien ? <> ({quien})</> : ""}. {origen
                      ? <>El material vuelve a <span className="ds-strong">{numeroOrden(origen)}</span>, la orden de la que salió.</>
                      : <>Revisá las líneas y armá la orden.</>}</>
                  : <>Esperando al ingeniero. La(s) línea(s) devuelta(s) quedan bloqueadas hasta que las corrija en Producción.</>}
              </p>
              {/* Volver a LA MISMA orden, que en BC es el mismo pedido: se le
                  reescriben las líneas y se re-envía a aprobación con su número. */}
              {corregida && origen && (
                <div className="row gap-3 wrap mt-4">
                  {/* Directo a EDITARLA, no al detalle: allá el material corregido ya
                      viene puesto y lo único que falta es revisar y guardar. Un paso
                      menos, que era la queja. */}
                  <Button onClick={() => router.push(`/proveeduria/ordenes/${origen.id}/editar`)}>
                    Seguir con {numeroOrden(origen)} →
                  </Button>
                  <span className="ds-body-sm ds-muted" style={{ alignSelf: "center", flex: "1 1 240px" }}>
                    Se abre con el material corregido puesto y su precio: revisá y guardá.
                  </span>
                </div>
              )}
              {/* La orden no aparece en la app porque la devolución vieja la
                  DESCARTABA (antes del arreglo). Pero en SQL nunca se borró de verdad
                  y su pedido sigue en Business Central, así que no se manda a armar
                  una orden nueva —eso sería un segundo pedido en BC por el mismo
                  material—: se la RETOMA y se sigue trabajando en ella. */}
              {corregida && !origen && dev?.orden && (
                <div className="row gap-3 wrap mt-4">
                  <Button disabled={retomando} onClick={() => retomar(dev.orden!)}>
                    {retomando ? "Retomando…" : `Seguir con ${dev.orden} →`}
                  </Button>
                  <span className="ds-body-sm ds-muted" style={{ alignSelf: "center", flex: "1 1 240px" }}>
                    El material salió de esa orden y su pedido sigue en Business Central: seguí con ELLA en vez de crear otra.
                  </span>
                </div>
              )}
              {(dev?.lineas || dev?.motivo) && (
                <p className="ds-body-sm ds-muted" style={{ margin: "6px 0 0" }}>
                  {dev?.fecha ? `Devuelta el ${formatDate(dev.fecha)}` : "Devuelta"}
                  {dev?.usuario ? ` por ${dev.usuario}` : ""}
                  {dev?.lineas ? ` · ${dev.lineas}` : ""}
                  {dev?.motivo ? ` · Motivo: ${dev.motivo}` : ""}
                </p>
              )}
            </Card>
          );
        })()}

        {/* Por qué se archivó. Va arriba del comentario del ingeniero porque es el
            estado más reciente y el que explica en qué terminó la solicitud. Sin esta
            tarjeta habría que bajar hasta el Historial para leer el motivo, y el
            motivo obligatorio quedaría invisible. */}
        {cerrada && (
          <Card className="mt-2" style={{ background: "color-mix(in srgb, var(--ds-color-gray-300) 12%, var(--ds-tint-base))" }}>
            <span className="ds-label ds-muted">Solicitud archivada</span>
            <p style={{ margin: "4px 0 0" }}>
              {motivoDeCierreSolicitud(pedido)
                ? <>Lo que quedó sin ordenar ya no se va a comprar. <span className="ds-strong">Motivo: {motivoDeCierreSolicitud(pedido)}</span></>
                : <>Lo que quedó sin ordenar ya no se va a comprar. El motivo está en el historial, abajo.</>}
            </p>
            {/* Lo ya ordenado NO se cancela: es la confusión más fácil de tener con
                una solicitud archivada, y de ahí saldría un llamado a Bodega. */}
            <p className="ds-body-sm ds-muted" style={{ margin: "6px 0 0" }}>
              Las órdenes de compra que ya se le hicieron siguen su curso: ese material se recibe y se factura igual.
              {unidadesSinComprar > 0 && <> Se dieron de baja <span className="ds-strong">{num.format(unidadesSinComprar)} u.</span> en {sinComprar.length} línea(s).</>}
            </p>
          </Card>
        )}

        {/* El comentario del ingeniero, sin los encabezados internos que le apilan
            encima la devolución y el cierre (esos tienen su propia tarjeta). */}
        {comentarioDeSolicitud(pedido) && (
          <Card className="mt-2" style={{ background: "color-mix(in srgb, var(--ds-color-yellow) 8%, var(--ds-tint-base))" }}>
            <span className="ds-label ds-muted">Comentario</span>
            <p style={{ margin: "4px 0 0" }}>{comentarioDeSolicitud(pedido)}</p>
          </Card>
        )}

        <Card className="mt-4" style={{ padding: 0, overflow: "hidden" }}>
          <div className="ds-table-wrap" style={{ boxShadow: "none" }}>
            <table className="ds-table">
              <thead><tr><th>Artículo</th><th>Destino</th><th className="ds-num">Solicitado</th><th className="ds-num">Ordenado</th><th className="ds-num">Pendiente</th></tr></thead>
              <tbody>
                {pedido.lineas.map((l) => (
                  <tr key={l.id} className={l.cerrada ? "fila-cancelada" : undefined} style={l.devuelta ? { opacity: 0.6 } : undefined}>
                    <td>
                      <div className="ds-clamp-2" title={l.descripcion} style={{ maxWidth: 420, minWidth: 240 }}>{l.descripcion}</div>
                      {/* El código del material: es con lo que se busca en BC y con lo
                          que Proveeduría confirma que va a ordenar lo que pidieron. Va
                          pelado (el guardado puede traer la variante pegada, que BC no
                          conoce); la variante se muestra abajo con su nombre. */}
                      {codigoDeItem(l.articuloId ?? "") && (
                        <div className="ds-body-sm ds-muted">{codigoDeItem(l.articuloId ?? "")}</div>
                      )}
                      {/* Cuál variante del material es: el ítem de BC es genérico
                          ("PORCELANATO 60X60CM") y el grado/la medida/la talla viven
                          en la variante. Si el material tiene varias y la solicitud
                          no dice cuál, se avisa en vez de dejar el hueco. */}
                      {l.variantCode
                        ? <div className="ds-body-sm ds-muted">Variante {variantes.etiqueta(l.articuloId, l.variantCode)}</div>
                        : variantes.falta(l.articuloId, l.variantCode) && (
                          <div className="ds-body-sm ds-pending-text" title="El material tiene varias variantes en Business Central y la solicitud no dice cuál. Hay que preguntarle a quien la pidió.">
                            Sin variante — preguntar cuál
                          </div>
                        )}
                      {/* Devuelta = bloqueada: no se puede ordenar ni volver a
                          devolver. El motivo queda en el historial de abajo. */}
                      {l.devuelta && <Badge tone="yellow">↩ Devuelta al ingeniero</Badge>}
                      {/* Solo en lo que quedó sin ordenar: una línea que se compró
                          entera no se marca, porque esa sí se compró. */}
                      {l.cerrada && <Badge tone="gray">⛔ Ya no se compra</Badge>}
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
                    <td className="ds-num">
                      {num.format(l.cantidadOrdenada)}
                      {/* De qué orden se trata: "Ordenado: 25" sin decir dónde obliga a
                          abrir orden por orden para saber quién se llevó el material. */}
                      {ordenesDeLineaPedido(ordenes, l.id).map((o) => (
                        <div key={o.id} style={{ marginTop: 4 }}>
                          <button type="button" className="chip-link"
                            title={o.enBc ? `Abrir la orden ${o.etiqueta}` : `${o.etiqueta}: borrador, todavía no está en Business Central`}
                            onClick={() => router.push(`/proveeduria/ordenes/${o.id}`)}>
                            {o.etiqueta}<span className="chip-link__ir" aria-hidden>↗</span>
                          </button>
                        </div>
                      ))}
                    </td>
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

      {cerrarOpen && (
        <Modal title={`Cerrar ${pedido.numero}`} onClose={() => setCerrarOpen(false)} footer={
          <>
            <Button variant="outline" disabled={cerrando} onClick={() => setCerrarOpen(false)}>Cancelar</Button>
            <Button disabled={cerrando || !motivoCierre} onClick={() => void confirmarCerrar()}>
              {cerrando ? "Cerrando…" : "Cerrar y archivar"}
            </Button>
          </>
        }>
          <div className="col gap-4">
            {/* Qué se da de baja, con el número puesto: cerrar sin ver cuánto material
                queda afuera es la forma de arrepentirse después. */}
            <p className="ds-body-sm" style={{ marginTop: 0 }}>
              {unidadesSinComprar > 0
                ? <>Quedan <span className="ds-strong">{num.format(unidadesSinComprar)} unidad(es)</span> sin ordenar en {sinComprar.length} línea(s). Al archivar dejan de estar pendientes y la solicitud sale de tus bandejas.</>
                : <>Esta solicitud ya está ordenada por completo. Al archivarla sale de tus bandejas.</>}
            </p>
            {/* La confusión cara: creer que archivar cancela lo que ya se le pidió al
                proveedor. No lo cancela, y decirlo acá evita el llamado a Bodega. */}
            <div className="ds-callout ds-callout--yellow" role="status">
              <span className="ds-callout__icon"><IconWarning size={18} /></span>
              <div>
                <div className="ds-callout__title">Lo que ya se ordenó no se toca</div>
                <div className="ds-callout__body">
                  Las órdenes de compra que salieron de esta solicitud siguen su curso: ese material se recibe y se factura
                  igual. Archivar solo da de baja lo que <span className="ds-strong">nadie ordenó</span>.
                </div>
              </div>
            </div>
            <Field label="Motivo del cierre">
              <Select value={motivoCierre} onChange={(e) => setMotivoCierre(e.target.value)} placeholder="Elegí un motivo…">
                {MOTIVOS_CIERRE.map((m) => <option key={m} value={m}>{m}</option>)}
              </Select>
            </Field>
            <Field label="Nota (opcional)">
              <Textarea rows={2} value={notaCierre} onChange={(e) => setNotaCierre(e.target.value)}
                placeholder="Detalle para el historial y para el ingeniero" />
            </Field>
            <span className="ds-body-sm ds-muted">
              El motivo queda en el historial y en el comentario de la solicitud, que es lo que ve el ingeniero desde su app.
            </span>
          </div>
        </Modal>
      )}

      {devolverOpen && (
        <Modal wide title={`Devolver material de ${pedido.numero} a Ingeniería`} onClose={() => setDevolverOpen(false)}
          footer={<>
            <Button variant="outline" disabled={devolviendo} onClick={() => setDevolverOpen(false)}>Cancelar</Button>
            <Button variant="red" disabled={devolviendo || !elegidas.length} onClick={confirmarDevolver}>
              {devolviendo ? "Devolviendo…" : `Devolver ${elegidas.length} línea(s)`}
            </Button>
          </>}>
          {!devolvibles.length && (
            <div className="ds-callout ds-callout--yellow mb-4" role="status">
              <span className="ds-callout__icon"><IconWarning size={18} /></span>
              <div>
                <div className="ds-callout__title">No hay nada que devolver</div>
                <div className="ds-callout__body">
                  Cada línea de esta solicitud ya está en una orden de compra (abajo se ve en cuál). Si alguna de esas órdenes
                  es un <span className="ds-strong">borrador</span> —todavía sin enviar a Business Central— descartala desde su
                  pantalla: el material vuelve a quedar pendiente acá y entonces sí se puede devolver.
                </div>
              </div>
            </div>
          )}
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
                  const bloqueo = motivoNoDevolver(l, ordenes);
                  const suyas = ordenesDeLineaPedido(ordenes, l.id);
                  return (
                    <tr key={l.id} style={bloqueo ? { opacity: 0.6 } : undefined}>
                      <td>
                        <Checkbox checked={!!sel[l.id]} disabled={!!bloqueo}
                          aria-label={`Devolver ${l.descripcion}`}
                          onChange={(e) => setSel((m) => ({ ...m, [l.id]: e.target.checked }))} />
                      </td>
                      <td><div className="ds-clamp-2" style={{ maxWidth: 360, minWidth: 200 }}>{l.descripcion}</div></td>
                      <td className="ds-num">{num.format(l.cantidad)} {l.unidad}</td>
                      <td className="ds-body-sm ds-muted">
                        {bloqueo || "se puede devolver"}
                        {/* Link directo a la orden que la tiene: si es un borrador, de
                            ahí se descarta y la línea queda libre para devolver. */}
                        {!!suyas.length && (
                          <div className="row gap-2 wrap" style={{ marginTop: 4 }}>
                            {suyas.map((o) => (
                              <button key={o.id} type="button" className="chip-link"
                                title={`Abrir la orden ${o.etiqueta}`}
                                onClick={() => router.push(`/proveeduria/ordenes/${o.id}`)}>
                                {o.etiqueta}<span className="chip-link__ir" aria-hidden>↗</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </td>
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
