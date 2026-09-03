"use client";

import { Fragment, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, Textarea } from "@/components/ui";
import { IconChevronDown, IconWarning } from "@/components/icons";
import { OrderLinesTable } from "@/components/order-lines";
import { Timeline } from "@/components/timeline";
import { useStore } from "@/lib/store";
import { money, num, formatDate, ordenBadgeDe, proveedorLabel, ordenLineaImporte, ordenRecibidoPct, ordenPedidos, ordenEsDirecta, numeroOrden, tieneBc, destinoDeRecepcion, ordenEsperaCorreccion } from "@/lib/helpers";
import { ChipPedido } from "@/components/ordenes-lista";
import { useVolver } from "@/lib/use-volver";
import type { Orden } from "@/lib/types";

// Vista de detalle de una orden, reutilizada por Proveeduría, Aprobación y Bodega.
// `acciones` son los botones específicos de cada rol (aprobar, recibir, etc.).
export function OrdenDetalle({
  orden,
  volverHref,
  volverLabel = "Volver",
  acciones,
  solicitudHref,
  pedidoHref,
  aviso,
  onAlinearIva,
}: {
  orden: Orden;
  volverHref: string;
  volverLabel?: string;
  acciones?: React.ReactNode;
  solicitudHref?: (l: Orden["lineas"][number]) => string | null;
  // Link por N.º de solicitud (los chips del encabezado). Igual que en la lista: lo
  // arma la página, porque la ruta depende del rol.
  pedidoHref?: (numeroPedido: string) => string | null;
  // Aviso que tiene que QUEDARSE en pantalla (no un toast que se desvanece): p. ej.
  // "se reabrió acá pero en BC sigue Lanzado". Si eso se pierde, la orden queda
  // descuadrada con BC y nadie se enteró.
  aviso?: React.ReactNode;
  // Copiar a las líneas el IVA que BC va a contabilizar. Lo pasa la pantalla del rol
  // que puede corregir la orden (Proveeduría); sin esto el aviso solo explica.
  onAlinearIva?: () => void | Promise<void>;
}) {
  const { proveedores, recepciones, role } = useStore();
  const router = useRouter();
  const [alineando, setAlineando] = useState(false);
  const [verFactura, setVerFactura] = useState<string | null>(null);
  // Totales calculados por BC (fuente de verdad). Se leen si la orden ya está en BC.
  const [bcTot, setBcTot] = useState<{ subtotal: number; iva: number; total: number; currencyCode: string } | null>(null);
  // "no-existe" = BC contestó y NO tiene ningún pedido con ese N.º. Es distinto de
  // que BC esté caído, y hay que decirlo: el N.º guardado apunta a un documento que
  // ya no está, así que ni se abre en BC ni hay nada que lanzar allá.
  const [bcMotivo, setBcMotivo] = useState<string | null>(null);
  useEffect(() => {
    if (!orden.bcNumber) { setBcTot(null); setBcMotivo(null); return; }
    let vivo = true;
    fetch(`/api/bc/orden-totales?orderNo=${encodeURIComponent(orden.bcNumber)}`)
      .then((r) => (r.ok ? r.json() : { totales: null }))
      .then((d) => { if (!vivo) return; if (d?.totales) setBcTot(d.totales); setBcMotivo(d?.motivo ?? null); })
      .catch(() => { /* sin BC: se muestran los totales locales */ });
    return () => { vivo = false; };
  }, [orden.bcNumber]);
  // Verificar contra BC a pedido: relee las líneas del pedido (o de las facturas
  // registradas, si la orden ya está completada y BC borró el pedido) y las coteja
  // con las de la orden. El resultado se guarda del lado del servidor, así que al
  // refrescar la pantalla el aviso queda actualizado.
  const [verificando, setVerificando] = useState(false);
  async function verificarBc() {
    if (!orden.bcNumber) return;
    setVerificando(true);
    try {
      const r = await fetch(`/api/ordenes/${orden.id}/chequeo-bc`, { cache: "no-store" });
      const d = await r.json().catch(() => ({} as any));
      const estado = String(d?.estado ?? "sin-lectura");
      setChequeo({ estado, mensaje: String(d?.mensaje ?? ""), diferencias: d?.diferencias ?? [] });
      // El aviso rojo GUARDADO es de la última vez. Si acabamos de verificar y ahora
      // coincide, dejarlo en pantalla sería decir dos cosas opuestas a la vez (el
      // servidor ya lo actualizó; esto es solo para no esperar a que recargue).
      if (estado === "ok") setGuardadoVencido(true);
    } catch (e: any) {
      setChequeo({ estado: "sin-lectura", mensaje: String(e?.message ?? e), diferencias: [] });
    } finally { setVerificando(false); }
  }
  // Vaciar el pedido en BC de una orden que espera la corrección. Hace falta para las
  // que se devolvieron ANTES de que la devolución lo vaciara sola (y como reintento si
  // BC no contestó en ese momento): mientras allá queden las líneas viejas, cualquiera
  // puede recibir o lanzar material que esta app ya devolvió al ingeniero.
  const [vaciando, setVaciando] = useState(false);
  async function vaciarEnBc() {
    setVaciando(true);
    try {
      const r = await fetch(`/api/ordenes/${orden.id}/vaciar-bc`, { method: "POST" });
      const d = await r.json().catch(() => ({} as any));
      if (!r.ok) { setChequeo({ estado: "sin-lectura", mensaje: String(d?.error ?? `Error ${r.status}`), diferencias: [] }); return; }
      setGuardadoVencido(true);
      const ch = d?.chequeo;
      setChequeo(ch
        ? { estado: String(ch.estado ?? "ok"), mensaje: String(ch.mensaje ?? ""), diferencias: ch.diferencias ?? [] }
        : { estado: "ok", mensaje: `El pedido ${orden.bcNumber} quedó vacío en Business Central, igual que la orden.`, diferencias: [] });
    } catch (e: any) {
      setChequeo({ estado: "sin-lectura", mensaje: String(e?.message ?? e), diferencias: [] });
    } finally { setVaciando(false); }
  }

  // Resultado de la verificación pedida desde esta pantalla (el guardado viene en
  // `orden.bcCheck` y se sigue mostrando aunque nadie apriete nada).
  const [chequeo, setChequeo] = useState<null | { estado: string; mensaje: string; diferencias: { texto: string }[] }>(null);
  // El cotejo guardado quedó viejo porque acabamos de verificar y ahora sí coincide.
  const [guardadoVencido, setGuardadoVencido] = useState(false);
  // "Ya lo corregí en BC": la corrección de una orden vieja se registra en BC como un
  // documento APARTE (una factura por la línea que faltó) que no cuelga del pedido, así
  // que la app no la puede ver. Sin esta salida, esas órdenes quedan en rojo para
  // siempre — y un aviso que no se puede apagar deja de leerse.
  const [corrigiendo, setCorrigiendo] = useState(false);
  const [motivoCorregido, setMotivoCorregido] = useState("");
  async function marcarCorregida() {
    if (motivoCorregido.trim().length < 5) return;
    setVerificando(true);
    try {
      const r = await fetch(`/api/ordenes/${orden.id}/chequeo-bc`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ motivo: motivoCorregido.trim() }),
      });
      const d = await r.json().catch(() => ({} as any));
      if (!r.ok) { setChequeo({ estado: "sin-lectura", mensaje: String(d?.error ?? `Error ${r.status}`), diferencias: [] }); return; }
      setGuardadoVencido(true);
      setCorrigiendo(false);
      setChequeo({ estado: "ok", mensaje: `Marcada como corregida: ${motivoCorregido.trim()}`, diferencias: [] });
      setMotivoCorregido("");
    } catch (e: any) {
      setChequeo({ estado: "sin-lectura", mensaje: String(e?.message ?? e), diferencias: [] });
    } finally { setVerificando(false); }
  }

  // El pedido que la app tiene apuntado no está en BC.
  //
  // En una orden COMPLETADA eso es NORMAL y no hay que decir nada: cuando se recibe y
  // factura todo, `Purch.-Post` BORRA el pedido de compra (queda la recepción y la
  // factura registradas). El aviso salía igual en todas las completadas, y esa es la
  // razón por la que nadie lo miró el día que sí estaba roto: CP-005172 lo mostraba
  // mientras le faltaban ₡22.820 de verdad. Un aviso que grita siempre no avisa nada.
  const ordenCerrada = orden.estado === "completado";
  const pedidoFantasma = !!orden.bcNumber && bcMotivo === "no-existe" && !ordenCerrada;

  const prov = proveedores.find((p) => p.id === orden.proveedorId);
  const b = ordenBadgeDe(orden);
  // Volver = pantalla anterior (con su filtro), no una ruta fija.
  const { volver, etiqueta: volverTexto } = useVolver(volverHref, volverLabel);
  const peds = ordenPedidos(orden);
  // Una orden que se quedó sin material esperando la corrección del ingeniero tiene
  // CERO líneas, y `ordenEsDirecta` se fija justamente en si alguna línea trae
  // solicitud: sin la excepción se leía "Directa · sin solicitud de origen", que es
  // lo contrario de lo que pasó (salió de una solicitud y el material volvió a ella).
  const espera = ordenEsperaCorreccion(orden);
  const esDirecta = ordenEsDirecta(orden) && !espera;
  const recs = recepciones.filter((r) => r.ordenId === orden.id);
  const subtotal = orden.lineas.filter((l) => l.tipo === "articulo").reduce((s, l) => s + ordenLineaImporte(l), 0);
  const iva = orden.lineas.filter((l) => l.tipo === "articulo").reduce((s, l) => s + ordenLineaImporte(l) * ((l.ivaPct || 0) / 100), 0);
  const flete = orden.lineas.filter((l) => l.tipo === "cargo").reduce((s, l) => s + l.cantidad * l.precioUnitario, 0);
  // BC contra el estimado de la orden. El IVA% que se escribe en la orden NO viaja a
  // BC: allá se calcula cruzando el grupo de IVA del proveedor con el del artículo
  // (en la línea que se manda no va ningún campo de IVA). Cuando esos dos no dan lo
  // mismo, el total de acá "cambia" al mandar la orden a aprobación y desde la
  // pantalla no había forma de saber por qué. Caso real: CP-005254 (Amazon) con IVA 0
  // acá —el correcto, el impuesto de aduana va en su propia línea de cargo— y 13% en
  // BC por el grupo del proveedor.
  // Solo se compara en la MISMA moneda: contra un pedido en dólares la resta no
  // significaría nada.
  const estimadoLocal = subtotal + flete + iva;
  const monedaDe = (c?: string) => ((c ?? "").trim().toUpperCase() || "CRC");
  const difBc = bcTot && monedaDe(bcTot.currencyCode) === monedaDe(orden.currencyCode)
    ? bcTot.total - estimadoLocal : 0;
  const hayDifBc = Math.abs(difBc) > 0.01;
  // El PDF para el proveedor solo se habilita cuando la orden fue APROBADA (Lanzada
  // en BC) — o ya completada. Antes de eso no debe enviarse nada al proveedor.
  const puedeImprimir = orden.estado === "lanzado" || orden.estado === "completado";

  return (
    <main className="page">
      <button type="button" className="back-link" onClick={volver}>{volverTexto}</button>
      <div className="page__head">
        <div className="page__title">
          <div className="row gap-3">
            {/* El N.º interno de la app NO se muestra (no existe en BC y no le
                sirve a nadie), pero va en el title: soporte lo necesita porque es
                el que anda en la bitácora y en los correos. */}
            <h1 className="ds-heading" title={`N.º interno de la app: ${orden.numero}`}>{numeroOrden(orden)}</h1>
            <Badge tone={b.tone}>{b.label}</Badge>
            {esDirecta && <Badge tone="yellow">Directa</Badge>}
          </div>
          <p className="ds-muted">{orden.proveedorNo ?? prov?.code} · {proveedorLabel(orden, proveedores)} · emitida {formatDate(orden.fecha)} · recibido {ordenRecibidoPct(orden)}%{tieneBc(orden) ? "" : " · todavía no está en Business Central"}</p>
          {orden.almacenRecepcion && <p className="ds-body-sm ds-muted">Recepción en almacén <span className="ds-strong">{orden.almacenRecepcion}</span></p>}
          <div className="row gap-2 wrap mt-2">
            {espera ? (
              <span className="ds-muted ds-body-sm">Su material volvió al ingeniero: la orden espera la corrección</span>
            ) : esDirecta ? (
              <span className="ds-muted ds-body-sm">Compra directa · sin solicitud de origen</span>
            ) : (
              <>
                <span className="ds-muted ds-body-sm">Solicitudes origen:</span>
                {peds.map((n) => <ChipPedido key={n} numero={n} href={pedidoHref?.(n) ?? null} />)}
              </>
            )}
          </div>
        </div>
        <div className="row gap-3">
          <Button variant="outline" size="sm" disabled={!puedeImprimir}
            title={puedeImprimir ? "Ver y descargar el PDF para el proveedor" : "El PDF para el proveedor se habilita cuando la orden esté aprobada (Lanzada)."}
            onClick={() => { if (puedeImprimir) router.push(`/proveeduria/ordenes/${orden.id}/imprimir`); }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6 }}><path d="M6 9V3h12v6" /><path d="M6 18H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="7" rx="1" /></svg>
            Imprimir
          </Button>
          {/* Con el pedido fantasma el botón se esconde: abría BC en una lista vacía
              y parecía que el link estaba roto. Lo que pasa se explica en el aviso. */}
          {orden.bcDeepLink && !pedidoFantasma && (
            <button className="link-btn" title="Abrir el Pedido en Business Central (editar · vista previa de registro · registrar)"
              onClick={() => window.open(orden.bcDeepLink!, "_blank")}>↗ Abrir en BC</button>
          )}
          {orden.bcNumber && (
            <button className="link-btn" disabled={verificando}
              title="Releer el pedido en Business Central y comparar sus líneas con las de esta orden"
              onClick={() => void verificarBc()}>{verificando ? "Verificando…" : "Verificar contra BC"}</button>
          )}
          {acciones}
        </div>
      </div>

      {aviso}

      {/* COTEJO CONTRA BC. Es lo único de esta pantalla que compara la orden con lo
          que Business Central tiene de verdad, línea por línea. Se guarda en la orden
          (no es un toast) y se queda hasta que alguien lo arregle: la orden 46
          (CP-005172) llegó a la factura del proveedor con una línea de menos porque
          el aviso duraba tres segundos. */}
      {/* La orden que ESPERA la corrección del ingeniero está descuadrada a propósito:
          acá se le quitó el material (volvió al ingeniero) y en BC el pedido puede
          seguir con las líneas viejas. El cotejo genérico lo reporta como "alguien
          agregó en BC", que además de sonar a acusación es falso: lo hizo esta app. Se
          explica y se ofrece la salida. */}
      {espera && orden.bcCheck && orden.bcCheck.estado !== "ok" && !guardadoVencido && (
        <div className="ds-callout ds-callout--yellow mb-4" role="status">
          <span className="ds-callout__icon"><IconWarning size={18} /></span>
          <div style={{ flex: 1 }}>
            <div className="ds-callout__title">El pedido en Business Central todavía tiene las líneas viejas</div>
            <div className="ds-callout__body">
              No lo agregó nadie allá: son las líneas de esta orden, que volvieron al ingeniero para que las corrija.
              Vaciá el pedido para que los dos lados digan lo mismo mientras esperás — cuando el material corregido
              vuelva y reenviés la orden, se le escriben las líneas nuevas a ese mismo pedido.
              <div className="mt-2">
                <Button variant="outline" size="sm" disabled={vaciando} onClick={() => void vaciarEnBc()}>
                  {vaciando ? "Vaciando…" : `Vaciar el pedido ${orden.bcNumber} en BC`}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {!espera && orden.bcCheck && orden.bcCheck.estado !== "ok" && !guardadoVencido && !(orden.bcCheck.estado === "sin-pedido" && ordenCerrada) && (
        <div className="ds-callout ds-callout--red mb-4" role="alert">
          <span className="ds-callout__icon"><IconWarning size={18} /></span>
          <div>
            <div className="ds-callout__title">
              {orden.bcCheck.estado === "sin-pedido"
                ? `Business Central no tiene el pedido ${orden.bcNumber}`
                : "Esta orden y el pedido en Business Central NO dicen lo mismo"}
            </div>
            <div className="ds-callout__body">
              <div style={{ whiteSpace: "pre-wrap" }}>{orden.bcCheck.detalle}</div>
              <div className="ds-body-sm ds-muted mt-2">
                Verificado {orden.bcCheck.fecha ? formatDate(orden.bcCheck.fecha) : "—"}. Mientras no coincidan, lo que Bodega
                reciba y Contabilidad facture puede entrar de menos en BC (o no entrar).
              </div>
              <div className="row gap-2 mt-2 wrap">
                <Button variant="outline" size="sm" disabled={verificando} onClick={() => void verificarBc()}>
                  {verificando ? "Verificando…" : "Volver a verificar"}
                </Button>
                {/* Solo Proveeduría: es la que corrige en BC y la única que la API deja
                    escribir sobre la orden. */}
                {role === "proveeduria" && !corrigiendo && (
                  <Button variant="outline" size="sm" onClick={() => setCorrigiendo(true)}>Ya lo corregí en BC</Button>
                )}
              </div>
              {corrigiendo && (
                <div className="col gap-2 mt-2" style={{ maxWidth: 520 }}>
                  <Textarea rows={2} value={motivoCorregido} maxLength={200} placeholder="¿Con qué se corrigió en BC? Ej.: se registró la factura CFR-009601 por la línea que faltaba."
                    onChange={(e) => setMotivoCorregido(e.target.value)} />
                  <div className="row gap-2">
                    <Button size="sm" disabled={verificando || motivoCorregido.trim().length < 5} onClick={() => void marcarCorregida()}>Guardar</Button>
                    <Button variant="outline" size="sm" onClick={() => { setCorrigiendo(false); setMotivoCorregido(""); }}>Cancelar</Button>
                  </div>
                  <span className="ds-body-sm ds-muted">Queda en la bitácora con tu nombre: dentro de un mes, “está en verde” tiene que poder explicarse.</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {chequeo && (
        <div className={`ds-callout mb-4 ${chequeo.estado === "ok" ? "ds-callout--green" : chequeo.estado === "sin-lectura" ? "ds-callout--yellow" : "ds-callout--red"}`} role="status">
          <span className="ds-callout__icon"><IconWarning size={18} /></span>
          <div>
            <div className="ds-callout__title">
              {chequeo.estado === "ok" ? "Verificado contra Business Central" : "Verificación contra Business Central"}
            </div>
            <div className="ds-callout__body">
              <div>{chequeo.mensaje}</div>
              {!!chequeo.diferencias.length && (
                <ul style={{ margin: "6px 0 0 18px" }}>
                  {chequeo.diferencias.map((d, i) => <li key={i}>{d.texto}</li>)}
                </ul>
              )}
              {/* Mientras la orden espera la corrección, lo que sobra en BC son SUS
                  líneas viejas: la salida es vaciar ese pedido, no ir a BC a borrarlas
                  a mano. */}
              {espera && chequeo.estado !== "ok" && (
                <div className="mt-2">
                  <Button variant="outline" size="sm" disabled={vaciando} onClick={() => void vaciarEnBc()}>
                    {vaciando ? "Vaciando…" : `Vaciar el pedido ${orden.bcNumber} en BC`}
                  </Button>
                </div>
              )}
              <div className="mt-2">
                <Button variant="outline" size="sm" onClick={() => setChequeo(null)}>Cerrar</Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {pedidoFantasma && (
        <div className="ds-callout ds-callout--red mb-4" role="status">
          <span className="ds-callout__icon"><IconWarning size={18} /></span>
          <div>
            <div className="ds-callout__title">Business Central no tiene el pedido {orden.bcNumber}</div>
            <div className="ds-callout__body">
              La app guardó ese número, pero en BC no existe ningún pedido de compra con él: o se borró allá, o no llegó a crearse.
              Por eso los totales de abajo son el estimado local y no se puede abrir en BC.
              <span className="ds-strong"> Reenviarla a aprobación NO lo vuelve a crear</span> (la app ve que ya hay número y solo intenta
              reescribirle las líneas), así que quien aprueba se quedaría sin nada que lanzar. Avisá a quien lleva BC.
            </div>
          </div>
        </div>
      )}

      {/* Orden rechazada por Aprobación: el motivo se muestra arriba de las líneas
          para que Proveeduría sepa qué corregir antes de reenviarla. */}
      {orden.estado === "rechazado" && (
        <div className="ds-callout ds-callout--red mb-4" role="status">
          <span className="ds-callout__icon"><IconWarning size={18} /></span>
          <div>
            <div className="ds-callout__title">Aprobación rechazó esta orden</div>
            <div className="ds-callout__body">
              {orden.motivoRechazo
                ? <>Motivo: <span className="ds-strong">{orden.motivoRechazo}</span></>
                : "No se registró un motivo. Revisá el historial al pie o consultá con Aprobación."}
            </div>
          </div>
        </div>
      )}

      {/* Observaciones para el proveedor: se imprimen en el PDF, así que hay que
          poder verlas (y notar que están) sin abrir la vista de impresión. */}
      {orden.observaciones?.trim() && (
        <Card flat className="mb-4">
          <div className="col" style={{ gap: 4 }}>
            <span className="ds-label ds-muted">Observaciones para el proveedor · salen en el PDF</span>
            <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{orden.observaciones.trim()}</p>
          </div>
        </Card>
      )}

      {/* Comentario interno para quien aprueba. Va en una tarjeta aparte y con otro
          color para que nadie lo confunda con lo que lee el proveedor. */}
      {orden.notaInterna?.trim() && (
        <Card flat className="mb-4" style={{ background: "color-mix(in srgb, var(--ds-color-yellow) 8%, var(--ds-tint-base))" }}>
          <div className="col" style={{ gap: 4 }}>
            <span className="ds-label ds-muted">Comentario para el aprobador · interno, no sale en el PDF</span>
            <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{orden.notaInterna.trim()}</p>
          </div>
        </Card>
      )}

      <Card style={{ padding: 0, overflow: "hidden" }}>
        <OrderLinesTable orden={orden} solicitudHref={solicitudHref} />
      </Card>

      <div className="row mt-6" style={{ justifyContent: "flex-end" }}>
        <div className="totals" style={{ minWidth: 320 }}>
          {bcTot ? (
            <>
              <div className="totals__row"><span>Subtotal (excl. IVA)</span><span>{money(bcTot.subtotal, bcTot.currencyCode || orden.currencyCode)}</span></div>
              <div className="totals__row"><span>IVA</span><span>{money(bcTot.iva, bcTot.currencyCode || orden.currencyCode)}</span></div>
              <div className="totals__row totals__row--grand" style={{ gridColumn: "1 / -1" }}><span>Total (con IVA)</span><span>{money(bcTot.total, bcTot.currencyCode || orden.currencyCode)}</span></div>
              <div style={{ gridColumn: "1 / -1" }} className="ds-body-sm ds-muted">Totales calculados por Business Central ✓</div>
              {hayDifBc && (
                <div style={{ gridColumn: "1 / -1" }} className="ds-body-sm ds-pending-text">
                  {difBc > 0 ? "+" : "−"}{money(Math.abs(difBc), bcTot!.currencyCode || orden.currencyCode)} contra el estimado de la orden ({money(estimadoLocal, orden.currencyCode)})
                </div>
              )}
            </>
          ) : (
            <>
              <div className="totals__row"><span>Subtotal artículos</span><span>{money(subtotal, orden.currencyCode)}</span></div>
              <div className="totals__row"><span>Flete</span><span>{money(flete, orden.currencyCode)}</span></div>
              <div className="totals__row"><span>IVA (materiales)</span><span>{money(iva, orden.currencyCode)}</span></div>
              <div className="totals__row totals__row--grand" style={{ gridColumn: "1 / -1" }}><span>Total orden</span><span>{money(subtotal + flete + iva, orden.currencyCode)}</span></div>
              {orden.bcNumber && (
                <div style={{ gridColumn: "1 / -1" }} className="ds-body-sm ds-muted">
                  {pedidoFantasma ? `Estimado local · BC no tiene el pedido ${orden.bcNumber}.` : "Estimado local · los totales definitivos los calcula BC."}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Por qué el total de BC no es el de la orden. Sin esto el número aparecía
          cambiado y no había a qué agarrarse: el IVA% de la orden es solo para la
          cuenta de acá. */}
      {hayDifBc && (
        <div className="ds-callout ds-callout--yellow mt-4" role="status">
          <span className="ds-callout__icon"><IconWarning size={18} /></span>
          <div>
            <div className="ds-callout__title">El total de BC no coincide con el de la orden</div>
            <div className="ds-callout__body">
              La diferencia es <span className="ds-strong">IVA</span>: el IVA lo calcula Business Central cruzando el grupo de
              IVA del <span className="ds-strong">proveedor</span> con el del <span className="ds-strong">artículo</span> — el IVA% que se
              escribe en la orden es solo para el estimado de esta pantalla, no viaja a BC.
              El que se contabiliza es el de BC. Si no corresponde (una compra del exterior, por ejemplo, donde el impuesto de
              aduana va en su propia línea de cargo), hay que corregir el grupo de IVA <span className="ds-strong">en BC</span> y
              volver a enviar la orden a aprobación: así la app le reescribe las líneas y BC recalcula.
            </div>
            {/* Y si el que vale es el de BC —lo normal—, esto lo copia a las líneas de
                una vez: el total de la orden, el del PDF del proveedor y el que ve
                quien aprueba dejan de estar cortos. */}
            {onAlinearIva && (
              <div className="mt-2">
                <Button variant="outline" size="sm" disabled={alineando}
                  title="Copia a cada línea el IVA% que Business Central va a contabilizar. No toca BC."
                  onClick={async () => { setAlineando(true); try { await onAlinearIva(); } finally { setAlineando(false); } }}>
                  {alineando ? "Alineando…" : "Usar el IVA de BC"}
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      <h3 className="ds-subtitle mt-6" style={{ marginBottom: 12 }}>Recepciones / facturas</h3>
      {recs.length === 0 ? (
        <Card flat><div className="ds-muted">Sin recepciones registradas todavía.</div></Card>
      ) : (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <div className="ds-table-wrap" style={{ boxShadow: "none" }}>
            <table className="ds-table">
              <thead><tr><th>Factura</th><th>Fecha factura</th><th>Fecha registro</th><th>Destino</th><th className="ds-num">Total</th><th>Tipo</th><th></th></tr></thead>
              <tbody>
                {recs.map((r) => {
                  const abierto = verFactura === r.id;
                  return (
                    <Fragment key={r.id}>
                      <tr className="is-clickable" onClick={() => setVerFactura(abierto ? null : r.id)}>
                        <td className="ds-strong">{r.numeroFactura}</td>
                        <td>{formatDate(r.fechaFactura)}</td>
                        <td>{formatDate(r.fechaRegistro)}</td>
                        {/* A dónde fue el material de ESTA factura: consumo de obra
                            (no sube el stock) o entrada al almacén. Una factura puede
                            traer las dos cosas; el detalle de abajo lo abre por línea. */}
                        <td className="ds-body-sm">{(() => {
                          const d = destinoDeRecepcion(r, orden);
                          if (!d.obras.length && !d.almacenes.length) return <span className="ds-muted">—</span>;
                          return (
                            <span className="row gap-2 wrap">
                              {d.obras.length > 0 && (
                                <Badge tone="blueish">
                                  {d.obras.length === 1 ? `Consumo · obra ${d.obras[0]}` : `Consumo · ${d.obras.length} obras`}
                                </Badge>
                              )}
                              {d.almacenes.length > 0 && (
                                <Badge tone="gray">
                                  {d.almacenes.length === 1 ? `Almacén ${d.almacenes[0]}` : `${d.almacenes.length} almacenes`}
                                </Badge>
                              )}
                            </span>
                          );
                        })()}</td>
                        <td className="ds-num">{money(r.total, orden.currencyCode)}</td>
                        <td>{r.parcial ? <Badge tone="yellow">Parcial</Badge> : <Badge tone="green">Completa</Badge>}</td>
                        <td className="ds-num ds-muted">
                          <button type="button" className="fac-ver-btn" aria-expanded={abierto}
                            aria-label={`${abierto ? "Ocultar" : "Ver"} detalle de la factura ${r.numeroFactura}`}
                            onClick={(e) => { e.stopPropagation(); setVerFactura(abierto ? null : r.id); }}>
                            {abierto ? "ocultar" : "ver"}
                            <IconChevronDown size={16} style={{ transform: abierto ? "rotate(180deg)" : "none", transition: "transform .15s ease" }} />
                          </button>
                        </td>
                      </tr>
                      {abierto && (
                        <tr>
                          <td colSpan={7} style={{ background: "var(--ds-color-surface)", padding: "6px 12px 14px" }}>
                            <div className="fac-det">
                              <div className="fac-det__head">
                                <span className="ds-strong">Factura {r.numeroFactura}</span>
                                <span className="ds-body-sm ds-muted">Registrada {formatDate(r.fechaRegistro)} · {r.parcial ? "entrega parcial" : "entrega completa"}</span>
                              </div>
                              <div className="fac-det__grid fac-det__colhead">
                                <span>Artículo</span>
                                <span className="fac-det__num">Cantidad</span>
                                <span className="fac-det__num">Precio factura</span>
                                <span className="fac-det__num">Importe</span>
                              </div>
                              {r.lineas.map((rl, i) => {
                                const ol = orden.lineas.find((x) => x.id === rl.ordenLineaId);
                                const precio = rl.precioFactura ?? ol?.precioUnitario ?? 0;
                                const distinto = ol != null && rl.precioFactura != null && rl.precioFactura !== ol.precioUnitario;
                                return (
                                  <div className="fac-det__grid" key={i}>
                                    <div>
                                      <div className="ds-strong">{ol?.descripcion ?? `Línea ${rl.ordenLineaId}`}</div>
                                      {ol?.articuloId && <div className="ds-body-sm ds-muted">{ol.articuloId}</div>}
                                      {/* Acá se resuelve la factura mixta: qué línea se
                                          consumió en la obra y cuál entró al almacén. */}
                                      {ol && (ol.proyecto
                                        ? <div className="ds-body-sm ds-muted">Consumo de la obra <span className="ds-strong">{ol.proyecto}</span>{ol.taskNo ? ` · tarea ${ol.taskNo}` : ""} — no suma inventario</div>
                                        : <div className="ds-body-sm ds-muted">Entró al almacén <span className="ds-strong">{ol.almacen || "—"}</span></div>)}
                                    </div>
                                    <div className="fac-det__num">{num.format(rl.cantidadRecibida)} {ol?.unidad ?? ""}</div>
                                    <div className="fac-det__num">
                                      {money(precio, orden.currencyCode)}
                                      {distinto && <div className="ds-body-sm ds-pending-text">orden: {money(ol!.precioUnitario, orden.currencyCode)}</div>}
                                    </div>
                                    <div className="fac-det__num ds-strong">{money(precio * rl.cantidadRecibida, orden.currencyCode)}</div>
                                  </div>
                                );
                              })}
                              <div className="fac-det__total">
                                <span>Total factura</span>
                                <span className="fac-det__num">{money(r.total, orden.currencyCode)}</span>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <h3 className="ds-subtitle mt-6" style={{ marginBottom: 12 }}>Historial</h3>
      <Card><Timeline entidad="orden" idEntidad={orden.id} /></Card>
    </main>
  );
}
