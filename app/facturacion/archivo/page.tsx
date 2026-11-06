"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge, Button, Card, Field, Input, Modal, Tile, useToast } from "@/components/ui";
import { BotonLineas, DataTable, FilaExpandida } from "@/components/data-table";
import { LineasDeRecepcion } from "@/components/lineas-recepcion";
import { useStore } from "@/lib/store";
import { api } from "@/lib/api";
import { cuenta, money, formatDate, formatDateTime, leerNotaRevision, MARCA_DESDE_REVISION, numeroOrden } from "@/lib/helpers";
import type { EnvioARevision, FacturadaDesdeRevision, Movimiento, Orden, Recepcion } from "@/lib/types";

const esEnRevision = (r: Recepcion) => !!r.facturaEnRevision || !r.numeroFactura;

// Cuántas del histórico se ven de entrada; el resto, de a tantas con "Ver más".
const TANDA_HISTORIAL = 15;

// LO QUE DICE LA BITÁCORA DE "FACTURAS EN REVISIÓN": por qué Bodega mandó cada
// recepción a revisión (`envios`) y a cuáles ya se les registró la factura
// (`registradas`, el histórico). Con base sale de /api/recepciones/revision (no
// viene en el bootstrap); en modo prueba, de los movimientos del store, que los
// registros de prueba también escriben. `registradas` en null = todavía cargando.
function useRevision(modoApi: boolean, movimientos: Movimiento[]) {
  const [deApi, setDeApi] = useState<{ envios: EnvioARevision[]; registradas: FacturadaDesdeRevision[] } | null>(null);
  const [error, setError] = useState("");
  const recargar = useCallback(async () => {
    if (!modoApi) return;
    try {
      setDeApi(await api.revisionDeRecepciones());
      setError("");
    } catch (e: any) {
      setError(String(e?.message ?? e));
      setDeApi((prev) => prev ?? { envios: [], registradas: [] });
    }
  }, [modoApi]);
  useEffect(() => { void recargar(); }, [recargar]);

  const deMock = useMemo(() => {
    if (modoApi) return null;
    const envios: EnvioARevision[] = [];
    const registradas: FacturadaDesdeRevision[] = [];
    const vistosEnv = new Set<string>(), vistosReg = new Set<string>();
    // `movimientos` viene del más nuevo al más viejo: el primero de cada recepción manda.
    for (const m of movimientos) {
      if (m.entidad !== "recepcion") continue;
      if (m.tipoMovimiento === "recibido" && !vistosEnv.has(m.idEntidad)) {
        vistosEnv.add(m.idEntidad);
        const nota = leerNotaRevision(m.detalle);
        envios.push({ recepcionId: m.idEntidad, enviadaEl: m.fecha, enviadaPor: m.usuario, facturaProveedor: nota?.facturaProveedor, motivo: nota?.motivo });
      } else if ((m.detalle ?? "").includes(MARCA_DESDE_REVISION) && !vistosReg.has(m.idEntidad)) {
        vistosReg.add(m.idEntidad);
        registradas.push({ recepcionId: m.idEntidad, numeroFactura: m.documentoNo, registradaEl: m.fecha, registradaPor: m.usuario, rol: m.rol });
      }
    }
    registradas.sort((a, b) => b.registradaEl.localeCompare(a.registradaEl));
    return { envios, registradas };
  }, [modoApi, movimientos]);

  const datos = modoApi ? deApi : deMock;
  const envioDe = useMemo(() => new Map((datos?.envios ?? []).map((e) => [e.recepcionId, e])), [datos]);
  return { registradas: datos?.registradas ?? null, envioDe, error, recargar };
}

// Lo que Bodega dejó dicho al mandarla a revisión. Las de antes de la confirmación
// no traen nada, y eso también se dice: si no, parece que falta un dato.
function MotivoRevision({ envio }: { envio?: EnvioARevision }) {
  if (!envio?.motivo && !envio?.facturaProveedor) return <span className="ds-muted">Sin motivo anotado</span>;
  return (
    <span className="ds-clamp-2" title={envio.motivo}>
      {envio.facturaProveedor ? <span className="ds-strong">Fact. {envio.facturaProveedor}</span> : <span className="ds-strong">Sin factura</span>}
      {envio.motivo ? <> · {envio.motivo}</> : null}
    </span>
  );
}

// El N.º de la orden como link al PEDIDO en Business Central, que es lo que hay que
// abrir mientras la factura está en revisión (el pedido sigue vivo allá: recibido y
// sin facturar). Sin link de BC —modo prueba, o falta la config— queda el número.
function PedidoBc({ orden }: { orden?: Orden }) {
  if (!orden) return <>—</>;
  const numero = numeroOrden(orden);
  if (!orden.bcDeepLink) return <>{numero}</>;
  return (
    <a className="chip-link" href={orden.bcDeepLink} target="_blank" rel="noopener noreferrer"
      title={`Abrir el pedido ${numero} en Business Central`}>
      {numero}<span className="chip-link__ir" aria-hidden>↗</span>
    </a>
  );
}

// La factura ya registrada, en BC. Con su CFR-… guardado, el link va derecho a
// ESA factura; las que salieron de revisión antes de que esto se guardara solo
// tienen el respaldo: las facturas registradas del pedido.
function FacturaBc({ rec, respaldo }: { rec: Recepcion; respaldo?: string }) {
  if (rec.bcFacturaNo && rec.bcFacturaUrl) {
    return (
      <a className="chip-link" href={rec.bcFacturaUrl} target="_blank" rel="noopener noreferrer"
        title={`Abrir la factura ${rec.bcFacturaNo} en Business Central`}>
        {rec.bcFacturaNo}<span className="chip-link__ir" aria-hidden>↗</span>
      </a>
    );
  }
  if (rec.bcFacturaNo) return <>{rec.bcFacturaNo}</>;
  if (respaldo) {
    return (
      <a className="chip-link" href={respaldo} target="_blank" rel="noopener noreferrer"
        title="Abrir en Business Central las facturas registradas de este pedido">
        Ver en BC<span className="chip-link__ir" aria-hidden>↗</span>
      </a>
    );
  }
  return <span className="ds-muted">—</span>;
}

export default function ArchivoPage() {
  const { ordenes, recepciones, proveedores, movimientos, facturarRecepcion, modoApi, recargar } = useStore();
  const router = useRouter();
  const toast = useToast();
  const prov = (id: string) => proveedores.find((p) => p.id === id);
  const ordenDe = (r: Recepcion) => ordenes.find((x) => x.id === r.ordenId);
  const provNombre = (o?: Orden) => (o ? (o.proveedorNombre ?? prov(o.proveedorId)?.nombre) : "") || "—";
  const completadas = ordenes.filter((o) => o.estado === "completado");

  const enRevision = recepciones.filter(esEnRevision);
  const registradas = recepciones.filter((r) => !esEnRevision(r));

  // El histórico, cruzado con la recepción del store (de ahí salen la orden, el
  // proveedor, el importe y las líneas). Una que no esté en el store no se lista:
  // sin ella no hay qué mostrar más que un número.
  const hist = useRevision(modoApi, movimientos);
  const historial = useMemo(() => (hist.registradas ?? []).flatMap((h) => {
    const rec = recepciones.find((r) => r.id === h.recepcionId);
    return rec && !esEnRevision(rec) ? [{ h, rec }] : [];
  }), [hist.registradas, recepciones]);
  const [limiteHist, setLimiteHist] = useState(TANDA_HISTORIAL);

  // Pestaña de la tarjeta. Sin elegir, abre en Pendientes si hay alguna; si no, en
  // el histórico (la tarjeta ya no desaparece cuando no queda nada en revisión).
  const [pestana, setPestana] = useState<"pendientes" | "registradas" | null>(null);
  const vista = pestana ?? (enRevision.length > 0 ? "pendientes" : "registradas");

  // Filas con las líneas abiertas. La clave lleva la pestaña: la misma recepción
  // puede estar abierta en Pendientes y, ya registrada, aparecer en el histórico.
  const [abiertas, setAbiertas] = useState<Set<string>>(new Set());
  const alternar = (k: string) => setAbiertas((prev) => {
    const sig = new Set(prev);
    if (sig.has(k)) sig.delete(k); else sig.add(k);
    return sig;
  });

  // Registrar la factura de una recepción que quedó en revisión.
  const [facObj, setFacObj] = useState<Recepcion | null>(null);
  const [numFac, setNumFac] = useState("");
  const [guardando, setGuardando] = useState(false);
  async function confirmarFactura() {
    const rec = facObj;
    if (!rec) return;
    if (!numFac.trim()) { toast("Ingresá el número de factura.", "error"); return; }
    const o = ordenDe(rec);
    // El TIPO viaja con cada línea, igual que en la pantalla de la factura: el
    // codeunit (y el freno de registro) buscan la línea del pedido por N.º Y por
    // tipo, así que sin él un recurso o un activo fijo se compara contra las líneas
    // de artículo, no calza con ninguna, y el registro se cae con "el pedido no
    // tiene ninguna línea de artículo con ese N.º". Acá se olvidaba, y era la única
    // de las tres pantallas que lo hacía.
    const bcLineas = rec.lineas
      .filter((l) => Number(l.cantidadRecibida) > 0)
      .map((l) => { const ol = o?.lineas.find((x) => x.id === l.ordenLineaId); return { itemNo: ol?.articuloId ?? "", qty: l.cantidadRecibida, variantCode: ol?.variantCode, tipo: ol?.tipo }; })
      .filter((x) => x.itemNo);
    setGuardando(true);
    let aviso = "";
    // El servidor ya la marcó facturada (modo API): acá no se repite el movimiento.
    let yaFacturada = false;
    try {
      if (o?.bcNumber && bcLineas.length) {
        // Si BC dice que NO, acá se corta. Antes se guardaba igual: la recepción
        // quedaba "facturada" en la app contra una factura que en BC no existe, y el
        // aviso era un toast informativo que nadie volvía a ver. La factura tiene que
        // entrar en los dos lados o en ninguno.
        let error = "";
        // Un FRENO (dimensiones, encabezado, líneas) no es un fallo pasajero: ya viene
        // con su propio "NO se facturó: …" y con qué hacer, y contra él reintentar no
        // sirve. Se muestra tal cual y sin el "queda en revisión para reintentar".
        let freno = false;
        try {
          const r = await fetch("/api/bc/facturar-recibido", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              orderNo: o.bcNumber, vendorInvoiceNo: numFac.trim(), lineas: bcLineas, ordenId: o.id,
              vendorNo: o.proveedorNo || o.proveedorId,
              // La fecha de registro en BC: la de la recepción (cuando entró el material),
              // o la de la factura. Sin esto le llegaba "" al codeunit y BC la rechazaba.
              postingDate: rec.fechaRecepcion || rec.fechaFactura || undefined,
              // Que la recepción quede marcada facturada en la MISMA llamada: si esto
              // viaja aparte y se pierde, en BC hay una factura registrada y acá una
              // recepción "en revisión" pidiendo que la registren otra vez.
              facturar: modoApi ? { idRecepcionCompra: Number(rec.id), numeroFactura: numFac.trim() } : undefined,
            }),
          });
          const d = await r.json().catch(() => ({}));
          if (r.ok) { aviso = ` · registrada en BC (${d.postedNo ?? "OK"})`; yaFacturada = !!d.facturada; }
          else { error = String(d.error ?? `BC ${r.status}`); freno = !!(d.frenoDimensiones || d.frenoEncabezado || d.frenoLineas || d.frenoConfigBc || d.frenoFichaBc || d.frenoPrecio); }
        } catch (e: any) { error = `Business Central no está disponible (${String(e?.message ?? e)})`; }
        if (error) {
          toast(freno ? error : `NO se registró la factura ${numFac}: ${error}. La recepción queda en revisión para reintentar.`, "error");
          setGuardando(false);
          return;
        }
      }
      if (yaFacturada) await recargar().catch(() => { /* el toast igual dice que se registró */ });
      else await facturarRecepcion(rec.id, numFac.trim());
      toast(`Factura ${numFac} registrada${aviso}`, "success");
      setFacObj(null); setNumFac("");
      // Recién registrada = la primera del histórico. Sin esto aparecía al recargar.
      void hist.recargar();
    } catch (e: any) {
      // Si BC ya registró (hay aviso) y lo que falló fue esto, hay que decirlo con
      // todas las letras: volver a darle "registrar" la metería DOS VECES en BC.
      toast(aviso
        ? `La factura ${numFac} YA quedó registrada en Business Central${aviso.replace(" · registrada en BC", "")}, pero no se pudo marcar acá: ${String(e?.message ?? e)}. NO la registrés de nuevo: reintentá en un momento o avisale a Proveeduría.`
        : String(e?.message ?? e), "error");
    } finally { setGuardando(false); }
  }

  const columns = useMemo<ColumnDef<Recepcion, any>[]>(() => [
    { id: "factura", header: "Factura", accessorFn: (r) => r.numeroFactura, meta: { label: "Factura" }, cell: (c) => <span className="ds-strong">{c.getValue()}</span> },
    { id: "orden", header: "Orden", accessorFn: (r) => { const o = ordenDe(r); return o ? numeroOrden(o) : "—"; }, meta: { label: "Orden" }, cell: (c) => c.getValue() },
    // Existe para BUSCAR, no para leerse: arranca oculta (igual que en la lista de
    // Órdenes). El N.º interno ya no se muestra en ninguna pantalla, pero está en
    // correos viejos, así que pegarlo en el buscador tiene que seguir encontrando la
    // factura. El buscador mira todas las columnas; el export, solo las visibles.
    { id: "ordenInterno", header: "N.º interno", accessorFn: (r) => ordenDe(r)?.numero ?? "", meta: { label: "N.º interno" }, cell: (c) => <span className="ds-muted">{c.getValue()}</span> },
    { id: "proveedor", header: "Proveedor", accessorFn: (r) => { const o = ordenDe(r); return (o ? (o.proveedorNombre ?? prov(o.proveedorId)?.nombre) : "") ?? "—"; }, meta: { label: "Proveedor" }, cell: (c) => c.getValue() },
    { id: "fecha", header: "Fecha registro", accessorFn: (r) => r.fechaRegistro, meta: { label: "Fecha registro" }, cell: (c) => formatDate(c.getValue()) },
    { id: "recibidoPor", header: "Recibido por", accessorFn: (r) => r.recibidoPor ?? "—", meta: { label: "Recibido por" }, cell: (c) => <span className="ds-body-sm">{c.getValue()}</span> },
    { id: "importe", header: "Importe", accessorFn: (r) => r.total, meta: { label: "Importe (excl. IVA)", num: true }, cell: (c) => money(c.getValue(), ordenDe(c.row.original)?.currencyCode) },
    { id: "totalIva", header: "Total c/IVA", accessorFn: (r) => r.total * 1.13, meta: { label: "Total con IVA (13%)", num: true }, cell: (c) => <span className="ds-strong">{money(c.getValue(), ordenDe(c.row.original)?.currencyCode)}</span> },
    { id: "tipo", header: "Tipo", accessorFn: (r) => (r.parcial ? "Parcial" : "Completa"), meta: { label: "Tipo" }, cell: (c) => c.row.original.parcial ? <Badge tone="yellow">Parcial</Badge> : <Badge tone="green">Completa</Badge> },
  ], [ordenes, proveedores]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <main className="page page--wide">
        <div className="page__head">
          <div className="page__title">
            <h1 className="ds-heading">Archivo y recepciones</h1>
            <p className="ds-muted">Órdenes recibidas al 100% y todas las facturas registradas.</p>
          </div>
        </div>

        <div className="tiles mt-2">
          <Tile value={registradas.length} label="Facturas registradas" accent="var(--ds-color-green-100)" />
          <Tile value={enRevision.length} label="Facturas en revisión" accent="var(--ds-color-red-100)" />
          <Tile value={completadas.length} label="Órdenes completadas" accent="var(--ds-color-green-200)" />
          <Tile value={money(registradas.reduce((s, r) => s + r.total, 0))} label="Total facturado" accent="var(--ds-color-gray-300)" />
        </div>

        {/* EN REVISIÓN: material que Bodega recibió sin factura. Dos pestañas: lo que
            falta registrar y el histórico de lo que ya salió de acá. Cada fila abre
            sus líneas, y el N.º de la orden abre el pedido en BC. */}
        {(enRevision.length > 0 || historial.length > 0 || !!hist.error) && (
          <Card className="mt-6" style={{ padding: 0, overflow: "hidden", boxShadow: enRevision.length > 0 ? "inset 3px 0 0 var(--ds-color-red-100), var(--ds-shadow-01)" : undefined }}>
            <div className="row row--between wrap gap-3" style={{ padding: "12px 16px", borderBottom: "1.5px solid var(--ds-color-gray-100)", alignItems: "center" }}>
              <div className="row gap-3 wrap" style={{ alignItems: "center" }}>
                <span className="ds-subtitle" style={{ fontSize: "var(--ds-font-size-subtitle)" }}>Facturas en revisión</span>
                <div className="segmented" role="tablist" aria-label="Facturas en revisión">
                  <button type="button" role="tab" aria-selected={vista === "pendientes"}
                    className={`segmented__btn ${vista === "pendientes" ? "is-active" : ""}`} onClick={() => setPestana("pendientes")}>
                    Pendientes · {enRevision.length}
                  </button>
                  <button type="button" role="tab" aria-selected={vista === "registradas"}
                    className={`segmented__btn ${vista === "registradas" ? "is-active" : ""}`} onClick={() => setPestana("registradas")}>
                    Ya registradas{hist.registradas ? ` · ${historial.length}` : ""}
                  </button>
                </div>
              </div>
              <span className="ds-body-sm ds-muted">
                {vista === "pendientes" ? "Material recibido; falta registrar la factura" : "Las que salieron de revisión, la más reciente primero"}
              </span>
            </div>

            {vista === "pendientes" ? (
              enRevision.length === 0 ? (
                <div className="empty empty--compact">No queda ninguna factura en revisión.</div>
              ) : (
                <div className="ds-table-wrap" style={{ boxShadow: "none" }}>
                  <table className="ds-table">
                    <thead><tr><th className="dt-hx" aria-hidden /><th>Orden</th><th>Proveedor</th><th>Recibido</th><th>Factura y motivo</th><th className="ds-num">Total est.</th><th /></tr></thead>
                    <tbody>
                      {enRevision.map((r) => {
                        const o = ordenDe(r);
                        const k = `p${r.id}`;
                        const abierta = abiertas.has(k);
                        const envio = hist.envioDe.get(r.id);
                        return (
                          <Fragment key={r.id}>
                            <tr>
                              <td className="dt-xcell"><BotonLineas abierto={abierta} onClick={() => alternar(k)} /></td>
                              <td className="ds-strong ds-body-sm"><PedidoBc orden={o} /></td>
                              <td className="ds-body-sm">{provNombre(o)}</td>
                              <td className="ds-body-sm ds-muted">
                                {formatDate(r.fechaRecepcion)} · {cuenta(r.lineas.length, "línea", "líneas")}
                                {(envio?.enviadaPor || r.recibidoPor) && <div>por {envio?.enviadaPor || r.recibidoPor}</div>}
                              </td>
                              <td className="ds-body-sm" style={{ maxWidth: 320 }}><MotivoRevision envio={envio} /></td>
                              <td className="ds-num">{money(r.total, o?.currencyCode)}</td>
                              <td className="ds-num"><Button variant="green" size="sm" onClick={() => { setNumFac(envio?.facturaProveedor ?? ""); setFacObj(r); }}>Registrar factura</Button></td>
                            </tr>
                            <FilaExpandida abierta={abierta} colSpan={7}>
                              {abierta ? (
                                <LineasDeRecepcion rec={r} orden={o} accion={o ? (
                                  <Link className="chip-link" href={`/facturacion/ver/${o.id}`} title="Abrir la orden completa">
                                    Abrir la orden<span className="chip-link__ir" aria-hidden>↗</span>
                                  </Link>
                                ) : null} />
                              ) : null}
                            </FilaExpandida>
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )
            ) : (
              <>
                {hist.error && (
                  <div className="dt-exp-pad ds-body-sm" role="alert" style={{ color: "var(--ds-text-danger)" }}>
                    No se pudo traer el histórico ({hist.error}). Recargá la página para volver a intentarlo.
                  </div>
                )}
                {hist.registradas === null ? (
                  <div className="empty empty--compact">Cargando el histórico…</div>
                ) : historial.length === 0 ? (
                  hist.error ? null : <div className="empty empty--compact">Todavía no se ha registrado ninguna factura que viniera de revisión.</div>
                ) : (
                  <div className="ds-table-wrap" style={{ boxShadow: "none" }}>
                    <table className="ds-table">
                      <thead>
                        <tr>
                          <th className="dt-hx" aria-hidden /><th>Factura</th><th>Orden</th><th>Proveedor</th><th>Recibido</th>
                          <th>Registrada</th><th className="ds-num">Importe</th><th>En BC</th>
                        </tr>
                      </thead>
                      <tbody>
                        {historial.slice(0, limiteHist).map(({ h, rec }) => {
                          const o = ordenDe(rec);
                          const k = `h${rec.id}`;
                          const abierta = abiertas.has(k);
                          return (
                            <Fragment key={rec.id}>
                              <tr>
                                <td className="dt-xcell"><BotonLineas abierto={abierta} onClick={() => alternar(k)} /></td>
                                <td className="ds-strong ds-body-sm">{rec.numeroFactura || h.numeroFactura}</td>
                                <td className="ds-body-sm">{o ? numeroOrden(o) : "—"}</td>
                                <td className="ds-body-sm">{provNombre(o)}</td>
                                <td className="ds-body-sm ds-muted">{formatDate(rec.fechaRecepcion)}</td>
                                <td className="ds-body-sm">
                                  {formatDateTime(h.registradaEl)}
                                  {h.registradaPor && <div className="ds-muted">{h.registradaPor}</div>}
                                </td>
                                <td className="ds-num">{money(rec.total, o?.currencyCode)}</td>
                                <td className="ds-body-sm"><FacturaBc rec={rec} respaldo={h.bcFacturasUrl} /></td>
                              </tr>
                              <FilaExpandida abierta={abierta} colSpan={8}>
                                {abierta ? (
                                  <LineasDeRecepcion rec={rec} orden={o} motivo={hist.envioDe.get(rec.id)?.motivo} accion={(
                                    <Link className="chip-link" href={`/facturacion/recepcion/${rec.id}`} title="Abrir el detalle de esta factura">
                                      Ver la factura<span className="chip-link__ir" aria-hidden>↗</span>
                                    </Link>
                                  )} />
                                ) : null}
                              </FilaExpandida>
                            </Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                {historial.length > limiteHist && (
                  <div className="row" style={{ justifyContent: "center", padding: "12px 16px" }}>
                    <Button variant="ghost" size="sm" onClick={() => setLimiteHist((n) => n + TANDA_HISTORIAL)}>
                      Ver {Math.min(TANDA_HISTORIAL, historial.length - limiteHist)} más · quedan {historial.length - limiteHist}
                    </Button>
                  </div>
                )}
              </>
            )}
          </Card>
        )}

        <h3 className="ds-subtitle mt-6" style={{ marginBottom: 12 }}>Facturas registradas</h3>
        <DataTable data={registradas} columns={columns} tablaKey="recepciones" columnVisibilityInicial={{ ordenInterno: false }} buscarPlaceholder="Buscar por N.º de factura o proveedor…" getRowId={(r) => r.id} onRowClick={(r) => router.push(`/facturacion/recepcion/${r.id}`)} vacio="Sin facturas registradas." />

        {facObj && (
          <Modal title={`Registrar factura · ${(() => { const o = ordenDe(facObj); return o ? numeroOrden(o) : ""; })()}`} onClose={() => setFacObj(null)}
            footer={<><Button variant="outline" onClick={() => setFacObj(null)}>Cancelar</Button><Button variant="green" onClick={confirmarFactura} disabled={!numFac.trim() || guardando}>{guardando ? "Registrando…" : "Registrar factura"}</Button></>}>
            <p className="ds-muted ds-body-sm" style={{ marginTop: 0 }}>El material ya se recibió. Registrá la factura del proveedor (se contabiliza en BC lo ya recibido).</p>
            {(() => {
              const envio = hist.envioDe.get(facObj.id);
              if (!envio?.motivo) return null;
              return (
                <p className="ds-body-sm" style={{ margin: "0 0 12px" }}>
                  <span className="ds-muted">Bodega la mandó a revisión{envio.enviadaPor ? ` (${envio.enviadaPor})` : ""}: </span>
                  {envio.motivo}
                </p>
              );
            })()}
            <Field label="N.º de factura del proveedor">
              <Input value={numFac} onChange={(e) => setNumFac(e.target.value)} placeholder="Ej. F-0099281" />
            </Field>
          </Modal>
        )}
      </main>
    </>
  );
}
