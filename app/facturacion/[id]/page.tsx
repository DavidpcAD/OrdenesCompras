"use client";

import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/shell";
import { Badge, Button, Card, Field, Input, Modal, useToast } from "@/components/ui";
import { IconWarning } from "@/components/icons";
import { DateField } from "@/components/date-field";
import { useStore } from "@/lib/store";
import { money, distribuirCargo, num, ordenBadge, ordenLineaPendiente, ordenRecibidoPct, todayISO } from "@/lib/helpers";
import type { MotivoNC } from "@/lib/types";

const MOTIVO_NC: { v: MotivoNC; label: string }[] = [
  { v: "precio_distinto", label: "Precio distinto" },
  { v: "menos_cantidad", label: "Menos cantidad" },
  { v: "danado", label: "Material dañado" },
];

export default function RegistrarFacturaPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const { ordenes, proveedores, registrarRecepcion, marcarNotasCredito } = useStore();

  const orden = ordenes.find((o) => o.id === id);

  const articulo = (orden?.lineas ?? []).filter((l) => l.tipo === "articulo");
  const cargo = (orden?.lineas ?? []).find((l) => l.tipo === "cargo");

  const [recibir, setRecibir] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    (orden?.lineas ?? []).filter((l) => l.tipo === "articulo").forEach((l) => {
      init[l.id] = String(ordenLineaPendiente(l));
    });
    return init;
  });
  const [numeroFactura, setNumeroFactura] = useState("");
  const [fechaFactura, setFechaFactura] = useState(todayISO());
  const [fechaRegistro, setFechaRegistro] = useState(todayISO());
  const [fechaRecepcion, setFechaRecepcion] = useState(todayISO());
  const [preview, setPreview] = useState(false);
  const [guardando, setGuardando] = useState(false);
  // Confirmación de inventario (stock BC antes → después de registrar).
  const [confirmInv, setConfirmInv] = useState<null | { itemNo: string; desc: string; antes: number | null; recibido: number; despues: number | null }[]>(null);
  // Líneas marcadas para NOTA DE CRÉDITO (dañado / menos cantidad / precio distinto).
  const [marcadas, setMarcadas] = useState<Record<string, { motivo: MotivoNC; cantidad: string; precio: string }>>({});
  const marcarLinea = (l: { id: string; cantidad: number; precioUnitario: number }) =>
    setMarcadas((m) => ({ ...m, [l.id]: { motivo: "precio_distinto", cantidad: String(recibir[l.id] || l.cantidad), precio: String(l.precioUnitario ?? "") } }));
  const quitarMarca = (id: string) => setMarcadas((m) => { const n = { ...m }; delete n[id]; return n; });
  const setMarca = (id: string, patch: Partial<{ motivo: MotivoNC; cantidad: string; precio: string }>) =>
    setMarcadas((m) => ({ ...m, [id]: { ...m[id], ...patch } }));

  // ¿esta recepción completa toda la orden?
  const completaOrden = useMemo(() => {
    if (!orden) return false;
    return articulo.every((l) => {
      const rec = Number(recibir[l.id] || 0);
      return l.cantidadRecibida + rec >= l.cantidad - 1e-9;
    });
  }, [orden, articulo, recibir]);

  // El precio proviene de la orden (BC). Bodega NO lo edita: la factura usa ese precio.
  const importeRecibir = (l: { id: string; precioUnitario: number; descuentoPct?: number }) =>
    Number(recibir[l.id] || 0) * l.precioUnitario * (1 - (l.descuentoPct ?? 0) / 100);
  const subtotalRecibido = useMemo(
    () => articulo.reduce((s, l) => s + importeRecibir(l), 0),
    [articulo, recibir]
  );
  // el flete solo se factura cuando se completa la orden (regla de BC)
  const fleteAplicado = completaOrden && cargo ? cargo.precioUnitario : 0;
  const totalFactura = subtotalRecibido + fleteAplicado;
  const algoRecibido = articulo.some((l) => Number(recibir[l.id] || 0) > 0);
  const fechasCoinciden = fechaFactura === fechaRegistro;

  if (!orden) {
    return <AppShell role="facturacion"><main className="page"><div className="empty">Orden no encontrada.</div></main></AppShell>;
  }
  const prov = proveedores.find((p) => p.id === orden.proveedorId);

  // distribución del flete sobre lo recibido (informativo)
  const distrib = fleteAplicado
    ? distribuirCargo(fleteAplicado, articulo.map((l) => ({ ...l, cantidad: Number(recibir[l.id] || 0) })))
    : {};

  // Stock total (todas las ubicaciones) por artículo, desde BC — para confirmar
  // el "antes → después" al registrar. null = BC no devolvió stock.
  async function stockDeItems(items: string[]): Promise<Record<string, number | null>> {
    const pares = await Promise.all(items.map(async (it) => {
      try {
        const r = await fetch(`/api/bc/existencias?itemNo=${encodeURIComponent(it)}`);
        const d = await r.json().catch(() => ({}));
        if (!r.ok || !Array.isArray(d.existencias)) return [it, null] as const;
        return [it, d.existencias.reduce((s: number, e: any) => s + (Number(e.cantidad) || 0), 0)] as const;
      } catch { return [it, null] as const; }
    }));
    return Object.fromEntries(pares);
  }

  async function registrar() {
    if (!numeroFactura.trim()) { toast("Ingresá el número de factura.", "error"); return; }
    if (!algoRecibido) { toast("Indicá al menos una cantidad a recibir.", "error"); return; }
    const excede = articulo.find((l) => Number(recibir[l.id] || 0) > ordenLineaPendiente(l) + 1e-9);
    if (excede) { toast(`No podés recibir más de lo pendiente en "${excede.descripcion}".`, "error"); return; }
    const lineas = articulo
      .filter((l) => Number(recibir[l.id] || 0) > 0)
      .map((l) => ({ ordenLineaId: l.id, cantidadRecibida: Number(recibir[l.id]) }));
    if (completaOrden && cargo) lineas.push({ ordenLineaId: cargo.id, cantidadRecibida: cargo.cantidad });
    // Líneas para BC: cantidad recibida en esta factura por item (solo artículos).
    const bcLineas = articulo
      .filter((l) => Number(recibir[l.id] || 0) > 0 && l.articuloId)
      .map((l) => ({ itemNo: l.articuloId as string, qty: Number(recibir[l.id]), variantCode: l.variantCode }));

    setGuardando(true);
    let aviso = ""; let bcOk = false;
    const items = [...new Set(bcLineas.map((l) => l.itemNo))];
    let antes: Record<string, number | null> = {};
    try {
      // Registrar (Recibir + Facturar) en BC con todos sus movimientos contables.
      if (orden!.bcNumber && bcLineas.length) {
        antes = await stockDeItems(items); // stock ANTES de registrar
        try {
          const r = await fetch("/api/bc/registrar", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ orderNo: orden!.bcNumber, vendorInvoiceNo: numeroFactura.trim(), lineas: bcLineas, postingDate: fechaRegistro }),
          });
          const d = await r.json().catch(() => ({}));
          if (r.ok) { aviso = ` · registrada en BC (${d.postedNo ?? "OK"})`; bcOk = true; }
          else aviso = ` · NO se pudo registrar en BC: ${d.error ?? r.status}`;
        } catch (e: any) { aviso = ` · BC no disponible: ${String(e?.message ?? e)}`; }
      } else if (!orden!.bcNumber) {
        aviso = " · (la orden no tiene N.º de BC, no se registró en BC)";
      }
      // Si la orden va a BC pero BC NO confirmó, NO registramos localmente ni movemos
      // la orden: queda "por recibir" para reintentar (solo avanza con éxito de BC).
      if (orden!.bcNumber && bcLineas.length && !bcOk) {
        toast(`No se registró: ${aviso.replace(/^ · /, "") || "BC no confirmó el movimiento"}. La orden queda por recibir para reintentar.`, "error");
        setGuardando(false);
        return;
      }
      await registrarRecepcion({
        ordenId: orden!.id, numeroFactura: numeroFactura.trim(),
        fechaFactura, fechaRecepcion, fechaRegistro, total: totalFactura, lineas,
      });
      // Líneas marcadas → notas de crédito (no bloquea el registro).
      const nc = articulo.filter((l) => marcadas[l.id]).map((l) => ({ ordenLineaId: l.id, articuloNo: l.articuloId, descripcion: l.descripcion, motivo: marcadas[l.id].motivo, cantidad: Number(marcadas[l.id].cantidad) || 0, precioUnitario: Number(marcadas[l.id].precio) || 0 }));
      if (nc.length) { try { await marcarNotasCredito(orden!.id, orden!.numero, orden!.proveedorNombre ?? prov?.nombre, nc); } catch { /* no bloquear */ } }
      const falloBc = aviso.includes("NO se pudo") || aviso.includes("no disponible");
      toast(`Factura ${numeroFactura} registrada${completaOrden ? " — orden completada" : " (parcial)"}${aviso}`, falloBc ? "info" : "success");
      if (bcOk) {
        // Stock DESPUÉS → mostramos la confirmación antes→después (el modal navega al cerrar).
        const despues = await stockDeItems(items);
        setConfirmInv(items.map((it) => {
          const qty = bcLineas.filter((l) => l.itemNo === it).reduce((s, l) => s + l.qty, 0);
          return { itemNo: it, desc: articulo.find((a) => a.articuloId === it)?.descripcion ?? it, antes: antes[it] ?? null, recibido: qty, despues: despues[it] ?? null };
        }));
        setGuardando(false);
      } else {
        router.push(`/facturacion`);
      }
    } catch (e: any) {
      toast(String(e?.message ?? e), "error");
      setGuardando(false);
    }
  }

  // MODO 2: el material llegó bien pero la factura viene con problemas. Se recibe
  // el material (BC: solo recepción) y la factura queda EN REVISIÓN para Kattya.
  async function recibirEnRevision() {
    if (!algoRecibido) { toast("Indicá al menos una cantidad a recibir.", "error"); return; }
    const excede = articulo.find((l) => Number(recibir[l.id] || 0) > ordenLineaPendiente(l) + 1e-9);
    if (excede) { toast(`No podés recibir más de lo pendiente en "${excede.descripcion}".`, "error"); return; }
    const lineas = articulo
      .filter((l) => Number(recibir[l.id] || 0) > 0)
      .map((l) => ({ ordenLineaId: l.id, cantidadRecibida: Number(recibir[l.id]) }));
    const bcLineas = articulo
      .filter((l) => Number(recibir[l.id] || 0) > 0 && l.articuloId)
      .map((l) => ({ itemNo: l.articuloId as string, qty: Number(recibir[l.id]), variantCode: l.variantCode }));

    setGuardando(true);
    let aviso = ""; let bcOk = false;
    try {
      if (orden!.bcNumber && bcLineas.length) {
        try {
          const r = await fetch("/api/bc/recibir", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ orderNo: orden!.bcNumber, lineas: bcLineas, postingDate: fechaRecepcion }),
          });
          const d = await r.json().catch(() => ({}));
          if (r.ok) { aviso = ` · recibido en BC (${d.receiptNo ?? "OK"})`; bcOk = true; }
          else aviso = ` · NO se pudo recibir en BC: ${d.error ?? r.status}`;
        } catch (e: any) { aviso = ` · BC no disponible: ${String(e?.message ?? e)}`; }
      } else if (!orden!.bcNumber) {
        aviso = " · (sin N.º de BC, no se recibió en BC)";
      }
      // Si va a BC pero BC no confirmó, no recibimos localmente: queda por recibir.
      if (orden!.bcNumber && bcLineas.length && !bcOk) {
        toast(`No se recibió: ${aviso.replace(/^ · /, "") || "BC no confirmó el movimiento"}. La orden queda por recibir para reintentar.`, "error");
        setGuardando(false);
        return;
      }
      await registrarRecepcion({
        ordenId: orden!.id, numeroFactura: "", fechaFactura, fechaRecepcion, fechaRegistro,
        total: subtotalRecibido, lineas, facturaEnRevision: true,
      });
      const nc = articulo.filter((l) => marcadas[l.id]).map((l) => ({ ordenLineaId: l.id, articuloNo: l.articuloId, descripcion: l.descripcion, motivo: marcadas[l.id].motivo, cantidad: Number(marcadas[l.id].cantidad) || 0, precioUnitario: Number(marcadas[l.id].precio) || 0 }));
      if (nc.length) { try { await marcarNotasCredito(orden!.id, orden!.numero, orden!.proveedorNombre ?? prov?.nombre, nc); } catch { /* no bloquear */ } }
      const falloBc = aviso.includes("NO se pudo") || aviso.includes("no disponible");
      toast(`Material recibido — factura EN REVISIÓN${aviso}`, falloBc ? "info" : "success");
      router.push(`/facturacion`);
    } catch (e: any) {
      toast(String(e?.message ?? e), "error");
      setGuardando(false);
    }
  }

  return (
    <AppShell role="facturacion">
      <main className="page page--wide">
        <div className="back-link" onClick={() => router.push("/facturacion")}>Volver a órdenes por recibir</div>
        <div className="page__head">
          <div className="page__title">
            <div className="row gap-3">
              <h1 className="ds-heading">Registrar factura · {orden.numero}</h1>
              <Badge tone={ordenBadge(orden.estado).tone}>{ordenBadge(orden.estado).label}</Badge>
            </div>
            <p className="ds-muted">{orden.proveedorNo ?? prov?.code} · {orden.proveedorNombre ?? prov?.nombre} · recibido {ordenRecibidoPct(orden)}%{orden.currencyCode ? ` · ${orden.currencyCode}` : ""}</p>
            {orden.almacenRecepcion && <p className="ds-body-sm ds-muted">Recepción en almacén <span className="ds-strong">{orden.almacenRecepcion}</span></p>}
            <div className="row gap-2 wrap mt-2">
              <span className="ds-muted ds-body-sm">Solicitudes origen:</span>
              {[...new Set(orden.lineas.filter((l) => l.pedidoNumero).map((l) => l.pedidoNumero!))].map((n) => <Badge key={n} tone="gray">{n}</Badge>)}
              {orden.lineas.every((l) => !l.pedidoNumero) && <span className="ds-muted ds-body-sm">—</span>}
            </div>
          </div>
        </div>

        <Card>
          <h3 className="ds-subtitle" style={{ marginBottom: 16 }}>Datos de la factura</h3>
          <div className="grid-2">
            <Field label="N.º de factura del proveedor">
              <Input value={numeroFactura} onChange={(e) => setNumeroFactura(e.target.value)} placeholder="Ej. F-0099281" />
            </Field>
            <Field label="Fecha de recepción en bodega">
              <DateField value={fechaRecepcion} onChange={setFechaRecepcion} />
            </Field>
            <Field label="Fecha de la factura">
              <DateField value={fechaFactura} onChange={(v) => { setFechaFactura(v); setFechaRegistro(v); }} />
            </Field>
            <Field label="Fecha de registro (contable)"
              warning={!fechasCoinciden}
              help={fechasCoinciden ? "Coincide con la fecha de factura ✓" : "Debe coincidir con la fecha de factura para que cuadre con el estado de cuenta del proveedor."}>
              <DateField value={fechaRegistro} onChange={setFechaRegistro} />
            </Field>
          </div>
        </Card>

        <Card className="mt-4" style={{ padding: 0, overflow: "hidden" }}>
          <div className="row row--between" style={{ padding: "12px 16px", borderBottom: "1.5px solid var(--ds-color-gray-100)" }}>
            <span className="ds-label ds-muted">{articulo.length} línea(s) de artículo</span>
            <div className="row gap-3">
              <button className="link-btn" onClick={() => setRecibir(Object.fromEntries(articulo.map((l) => [l.id, String(ordenLineaPendiente(l))])))}>Recibir todo</button>
              <button className="link-btn" onClick={() => setRecibir(Object.fromEntries(articulo.map((l) => [l.id, "0"])))}>Recibir nada</button>
            </div>
          </div>
          <div className="ds-table-wrap" style={{ boxShadow: "none" }}>
            <table className="ds-table">
              <thead>
                <tr>
                  <th style={{ width: 32 }}></th><th>Artículo</th><th className="hide-mobile">Almacén</th>
                  <th className="ds-num">Ordenado</th><th className="ds-num hide-mobile">Ya recib.</th>
                  <th className="ds-num">Pend.</th><th className="ds-num">A recibir</th>
                  <th className="ds-num hide-mobile">Precio</th>
                  <th className="ds-num">A facturar</th>
                </tr>
              </thead>
              <tbody>
                {articulo.map((l) => {
                  const pend = ordenLineaPendiente(l);
                  const val = Number(recibir[l.id] || 0);
                  const importe = importeRecibir(l);
                  return (
                    <tr key={l.id} className={pend > 0 && val < pend ? "row-pending" : ""}>
                      <td className="ds-num"><input type="checkbox" className="ds-cbx" checked={pend > 0 && val >= pend} disabled={pend <= 0} title="Marcar recibido completo" onChange={(e) => setRecibir((r) => ({ ...r, [l.id]: e.target.checked ? String(pend) : "0" }))} /></td>
                      <td>
                        {l.descripcion}
                        <div className="ds-body-sm ds-muted">
                          {[l.pedidoNumero, l.proyecto && `Proy. ${l.proyecto}`, l.taskNo && `Tarea ${l.taskNo}`, l.descuentoPct ? `−${l.descuentoPct}%` : null].filter(Boolean).join(" · ")}
                        </div>
                        {marcadas[l.id] ? (
                          <div className="col gap-2" style={{ marginTop: 8, padding: 8, borderRadius: 10, background: "color-mix(in srgb, var(--ds-color-red-100) 8%, #fff)", border: "1.5px solid color-mix(in srgb, var(--ds-color-red-100) 30%, #fff)" }}>
                            <div className="row gap-2 wrap" style={{ alignItems: "center" }}>
                              <span className="ds-body-sm ds-strong" style={{ color: "var(--ds-color-red-200)" }}>Nota de crédito:</span>
                              <select className="ds-cell-input" value={marcadas[l.id].motivo} onChange={(e) => setMarca(l.id, { motivo: e.target.value as MotivoNC })} style={{ minWidth: 130 }}>
                                {MOTIVO_NC.map((mo) => <option key={mo.v} value={mo.v}>{mo.label}</option>)}
                              </select>
                              <input className="ds-cell-input" type="number" min={0} style={{ width: 70 }} title="Cantidad afectada" value={marcadas[l.id].cantidad} onChange={(e) => setMarca(l.id, { cantidad: e.target.value })} placeholder="Cant." />
                              <input className="ds-cell-input" type="number" min={0} style={{ width: 90 }} title="Precio unitario" value={marcadas[l.id].precio} onChange={(e) => setMarca(l.id, { precio: e.target.value })} placeholder="Precio unit." />
                              <button type="button" className="link-btn" onClick={() => quitarMarca(l.id)}>Quitar</button>
                            </div>
                          </div>
                        ) : (
                          <button type="button" className="link-btn" style={{ marginTop: 4, color: "var(--ds-color-red-200)" }} onClick={() => marcarLinea(l)}>⚠ Marcar para nota de crédito</button>
                        )}
                      </td>
                      <td className="ds-muted hide-mobile">{l.almacen}</td>
                      <td className="ds-num">{num.format(l.cantidad)} {l.unidad}</td>
                      <td className="ds-num hide-mobile">{num.format(l.cantidadRecibida)}</td>
                      <td className="ds-num">{pend > 0 ? <span className="ds-pending-text">{num.format(pend)}</span> : "0"}</td>
                      <td className="ds-num">
                        <input className="ds-cell-input" type="number" min={0} max={pend} value={recibir[l.id] ?? ""} disabled={pend <= 0}
                          title={pend <= 0 ? "Esta línea ya se recibió completa" : undefined}
                          onChange={(e) => { const v = e.target.value; if (v === "") return setRecibir((r) => ({ ...r, [l.id]: "" })); const n = Math.max(0, Math.min(Number(v) || 0, pend)); setRecibir((r) => ({ ...r, [l.id]: String(n) })); }} />
                      </td>
                      <td className="ds-num ds-muted hide-mobile">{money(l.precioUnitario, orden.currencyCode)}</td>
                      <td className="ds-num ds-strong">{money(importe || 0, orden.currencyCode)}</td>
                    </tr>
                  );
                })}
                {cargo && (
                  <tr style={{ opacity: completaOrden ? 1 : 0.5 }}>
                    <td></td>
                    <td><Badge tone="yellow">Cargo</Badge> {cargo.descripcion}</td>
                    <td className="ds-muted hide-mobile">{cargo.almacen}</td>
                    <td className="ds-num">{num.format(cargo.cantidad)}</td>
                    <td className="ds-num hide-mobile">{num.format(cargo.cantidadRecibida)}</td>
                    <td className="ds-num">—</td>
                    <td className="ds-num">{completaOrden ? num.format(cargo.cantidad) : "—"}</td>
                    <td className="ds-num ds-muted hide-mobile">{money(cargo.precioUnitario, orden.currencyCode)}</td>
                    <td className="ds-num ds-strong">{money(fleteAplicado, orden.currencyCode)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        {cargo && !completaOrden && (
          <Card flat className="mt-4 ds-form-field--advertencia">
            <div className="row gap-3">
              <span style={{ color: "var(--ds-color-red-200)" }}><IconWarning /></span>
              <div>
                <div className="ds-strong">El flete corresponde a toda la orden</div>
                <p className="ds-label ds-muted">
                  Como esta es una entrega parcial, el flete (cargo de producto) no se factura todavía: se aplica
                  proporcionalmente solo cuando se recibe la orden completa. Las líneas faltantes quedan pendientes en rojo.
                </p>
              </div>
            </div>
          </Card>
        )}

        <div className="row row--between wrap gap-4 mt-6" style={{ alignItems: "flex-end" }}>
          <div className="totals" style={{ minWidth: 320 }}>
            <div className="totals__row"><span>Subtotal recibido</span><span>{money(subtotalRecibido, orden.currencyCode)}</span></div>
            <div className="totals__row"><span>Flete</span><span>{money(fleteAplicado, orden.currencyCode)}</span></div>
            <div className="totals__row totals__row--grand" style={{ gridColumn: "1 / -1" }}>
              <span>Total factura</span><span>{money(totalFactura, orden.currencyCode)}</span>
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              {completaOrden ? <Badge tone="green">Recepción completa</Badge> : <Badge tone="yellow">Recepción parcial — la orden queda abierta</Badge>}
            </div>
          </div>
          <div className="row gap-3 wrap">
            <Button variant="outline" onClick={() => setPreview(true)} disabled={!algoRecibido}>Vista previa</Button>
            <Button variant="ghost" onClick={recibirEnRevision} disabled={!algoRecibido || guardando} title="El material llegó bien pero la factura tiene problemas: recibí el material y mandá la factura a revisión.">Recibir sin factura (a revisión)</Button>
            <Button variant="red" onClick={registrar} disabled={!algoRecibido || !numeroFactura.trim() || guardando}>{guardando ? "Registrando…" : "Registrar factura"}</Button>
          </div>
        </div>

        {preview && (
          <Modal
            title="Vista previa del registro"
            onClose={() => setPreview(false)}
            footer={<>
              <Button variant="outline" onClick={() => setPreview(false)}>Cerrar</Button>
              <Button variant="red" onClick={() => { setPreview(false); registrar(); }} disabled={!numeroFactura.trim() || guardando}>Confirmar y registrar</Button>
            </>}
          >
            <p className="ds-label">Factura del proveedor <span className="ds-strong">{orden.proveedorNombre ?? prov?.nombre}</span> por:</p>
            <h2 className="ds-heading" style={{ margin: "8px 0 16px" }}>{money(totalFactura, orden.currencyCode)}</h2>
            <div className="ds-table-wrap" style={{ boxShadow: "none", border: "1.5px solid var(--ds-color-gray-100)" }}>
              <table className="ds-table">
                <thead><tr><th>Concepto</th><th className="ds-num">Cant.</th><th className="ds-num">Importe</th></tr></thead>
                <tbody>
                  {articulo.filter((l) => Number(recibir[l.id] || 0) > 0).map((l) => (
                    <tr key={l.id}>
                      <td>{l.descripcion}{distrib[l.id] ? <div className="ds-body-sm ds-muted">+ flete {money(distrib[l.id], orden.currencyCode)}</div> : null}</td>
                      <td className="ds-num">{num.format(Number(recibir[l.id]))}</td>
                      <td className="ds-num">{money(importeRecibir(l), orden.currencyCode)}</td>
                    </tr>
                  ))}
                  {fleteAplicado > 0 && <tr><td>{cargo?.descripcion}</td><td className="ds-num">1</td><td className="ds-num">{money(fleteAplicado, orden.currencyCode)}</td></tr>}
                </tbody>
              </table>
            </div>
            <p className="ds-body-sm ds-muted mt-4">
              Verificá que el total físico de la factura coincida. Fecha de registro: {fechaRegistro}
              {!fechasCoinciden && " — no coincide con la fecha de factura"}.
            </p>
          </Modal>
        )}

        {confirmInv && (
          <Modal
            title="Inventario actualizado en BC"
            onClose={() => { setConfirmInv(null); router.push("/facturacion"); }}
            footer={<Button onClick={() => { setConfirmInv(null); router.push("/facturacion"); }}>Listo</Button>}
          >
            <p className="ds-label">Stock en Business Central <span className="ds-strong">antes → después</span> de registrar esta factura:</p>
            <div className="ds-table-wrap" style={{ boxShadow: "none", border: "1.5px solid var(--ds-color-gray-100)", marginTop: 8 }}>
              <table className="ds-table">
                <thead><tr><th>Artículo</th><th className="ds-num">Antes</th><th className="ds-num">Facturado</th><th className="ds-num">Después</th><th></th></tr></thead>
                <tbody>
                  {confirmInv.map((x) => {
                    const sd = x.antes == null || x.despues == null;
                    const ok = !sd && Math.abs((x.despues as number) - ((x.antes as number) + x.recibido)) < 1e-6;
                    return (
                      <tr key={x.itemNo}>
                        <td>{x.desc}<div className="ds-body-sm ds-muted">{x.itemNo}</div></td>
                        <td className="ds-num">{x.antes == null ? "—" : num.format(x.antes)}</td>
                        <td className="ds-num ds-strong" style={{ color: "var(--ds-color-green-300)" }}>+{num.format(x.recibido)}</td>
                        <td className="ds-num ds-strong">{x.despues == null ? "—" : num.format(x.despues)}</td>
                        <td className="ds-num">{sd ? <span className="ds-muted" title="BC no devolvió stock">s/d</span> : ok ? "✅" : <span title="El cambio no coincide con lo facturado" style={{ color: "var(--ds-color-red-200)" }}>⚠️</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="ds-body-sm ds-muted mt-4">
              El material entró al almacén de recepción{orden.almacenRecepcion ? <> <span className="ds-strong">{orden.almacenRecepcion}</span></> : ""}. Un ✅ confirma que el stock subió justo lo facturado.
            </p>
          </Modal>
        )}
      </main>
    </AppShell>
  );
}
