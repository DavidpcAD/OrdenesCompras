"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, Checkbox, EmptyState, Field, Input, Modal, Select, Skeleton, Textarea, useToast } from "@/components/ui";
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
  const { ordenes, proveedores, recepciones, registrarRecepcion, marcarNotasCredito, role, cargando } = useStore();
  // La vista se elige por ROL, no por ancho de pantalla: Contabilidad usa la TABLA
  // (escritorio); Bodega (Pedro) usa siempre las TARJETAS, porque todo lo de Bodega
  // es en tablet/celular.
  const esContabilidad = role === "contabilidad";

  const orden = ordenes.find((o) => o.id === id);

  const articulo = (orden?.lineas ?? []).filter((l) => l.tipo === "articulo");
  const cargo = (orden?.lineas ?? []).find((l) => l.tipo === "cargo");
  // Para MOSTRAR: solo las líneas que todavía tienen pendiente (lo ya recibido
  // completo no aparece) y SIEMPRE en orden alfabético. Los cálculos usan `articulo`.
  const articuloVisible = articulo
    .filter((l) => ordenLineaPendiente(l) > 1e-9)
    .sort((a, b) => a.descripcion.localeCompare(b.descripcion, "es"));

  const [recibir, setRecibir] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    (orden?.lineas ?? []).filter((l) => l.tipo === "articulo").forEach((l) => {
      init[l.id] = String(ordenLineaPendiente(l));
    });
    return init;
  });
  // El estado de arriba se calcula UNA vez; si la orden llegó después del primer
  // render (modo API: el bootstrap tarda), el mapa quedaba vacío y todas las
  // cantidades salían en blanco. Esto completa SOLO las líneas que falten — nunca
  // pisa lo que Bodega ya escribió — y también cubre una línea agregada después.
  useEffect(() => {
    if (!orden) return;
    setRecibir((r) => {
      let falta = false;
      const next = { ...r };
      for (const l of orden.lineas) {
        if (l.tipo !== "articulo" || next[l.id] !== undefined) continue;
        next[l.id] = String(ordenLineaPendiente(l));
        falta = true;
      }
      return falta ? next : r;
    });
  }, [orden]);

  const [numeroFactura, setNumeroFactura] = useState("");
  const [fechaFactura, setFechaFactura] = useState(todayISO());
  const [fechaRegistro, setFechaRegistro] = useState(todayISO());
  const [fechaRecepcion, setFechaRecepcion] = useState(todayISO());
  const [preview, setPreview] = useState(false);
  const [guardando, setGuardando] = useState(false);
  // Confirmación de inventario (stock BC antes → después de registrar).
  // despues: number = stock BC verificado · null = BC no devolvió · undefined = verificando.
  const [confirmInv, setConfirmInv] = useState<null | { itemNo: string; desc: string; antes: number | null; recibido: number; despues?: number | null }[]>(null);
  // Líneas marcadas para NOTA DE CRÉDITO (dañado / menos cantidad / precio distinto).
  // Cantidad y precio se toman por defecto de la línea; Bodega elige el tipo y deja
  // un comentario (nota) de qué pasó con esa línea.
  const [marcadas, setMarcadas] = useState<Record<string, { motivo: MotivoNC; cantidad: string; precio: string; nota: string }>>({});
  const marcarLinea = (l: { id: string; cantidad: number; precioUnitario: number }) =>
    setMarcadas((m) => ({ ...m, [l.id]: { motivo: "precio_distinto", cantidad: String(recibir[l.id] || l.cantidad), precio: l.precioUnitario != null ? String(Math.round(l.precioUnitario * 100) / 100) : "", nota: "" } }));
  const quitarMarca = (id: string) => setMarcadas((m) => { const n = { ...m }; delete n[id]; return n; });
  const setMarca = (id: string, patch: Partial<{ motivo: MotivoNC; cantidad: string; precio: string; nota: string }>) =>
    setMarcadas((m) => ({ ...m, [id]: { ...m[id], ...patch } }));
  // Menú kebab (⋮) abierto por línea (id de la línea, o null).
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  // Cerrar el menú kebab con la tecla Escape (a11y).
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuOpen(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);
  // Popup de nota de crédito (borrador): se edita acá y se confirma con "Guardar".
  // No expande la línea; es un modal aparte (tipo + comentario).
  const [ncModal, setNcModal] = useState<null | { lineId: string; descripcion: string; motivo: MotivoNC; cantidad: string; precio: string; nota: string }>(null);
  // Aviso a Contabilidad: esta factura trae un cargo de producto adicional (flete
  // u otro) que Kattya debe agregar. Bodega recibe y registra la factura igual.
  const [avisarCargo, setAvisarCargo] = useState(false);
  const [cargoAvisoDesc, setCargoAvisoDesc] = useState("");
  const [cargoAvisoMonto, setCargoAvisoMonto] = useState("");
  const cargoAvisoPayload = () => avisarCargo && cargoAvisoDesc.trim()
    ? { nota: cargoAvisoDesc.trim(), monto: Number(cargoAvisoMonto) || undefined }
    : undefined;

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
  // El flete ORIGINAL de la orden (el que puso proveeduría) va en la PRIMERA
  // factura, repartido entre los materiales que se reciben en esa entrega — no
  // espera a completar. En entregas siguientes ya está facturado: no se re-cobra.
  // Bodega NO agrega fletes: eso lo maneja Proveeduría (Angie) o Contabilidad.
  const nadaRecibidoAun = useMemo(
    () => articulo.every((l) => (l.cantidadRecibida ?? 0) <= 1e-9),
    [articulo]
  );
  const fleteAplicado = nadaRecibidoAun && cargo ? cargo.precioUnitario : 0;
  const totalFactura = subtotalRecibido + fleteAplicado;
  // IVA de la factura: por línea según su ivaPct + IVA del flete (BC aplica IVA
  // también al cargo). Así la app muestra el mismo total con IVA que BC.
  const ivaFactura = useMemo(
    () => articulo.reduce((s, l) => s + importeRecibir(l) * ((l.ivaPct ?? 0) / 100), 0)
      + fleteAplicado * ((cargo?.ivaPct ?? 0) / 100),
    [articulo, recibir, fleteAplicado, cargo] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const totalConIva = totalFactura + ivaFactura;
  const algoRecibido = articulo.some((l) => Number(recibir[l.id] || 0) > 0);
  const fechasCoinciden = fechaFactura === fechaRegistro;

  if (!orden) {
    // Durante la carga inicial (SQL) el store todavía está vacío: skeleton en vez
    // de decirle a Bodega "Orden no encontrada" (se veía al abrir el link directo
    // o al recargar con red lenta).
    if (cargando) {
      return <main className="page"><div className="col gap-4" aria-busy="true">
        <Skeleton style={{ display: "block", width: 260, height: 30, borderRadius: 8 }} />
        <Skeleton style={{ display: "block", width: 340, height: 16, borderRadius: 6 }} />
        <Skeleton style={{ display: "block", width: "100%", height: 180, borderRadius: 16, marginTop: 8 }} />
        <Skeleton style={{ display: "block", width: "100%", height: 260, borderRadius: 16 }} />
      </div></main>;
    }
    return <><main className="page"><EmptyState icon={<IconWarning size={24} />} title="Orden no encontrada." /></main></>;
  }
  const prov = proveedores.find((p) => p.id === orden.proveedorId);

  // distribución del flete sobre lo recibido (informativo)
  const distrib = fleteAplicado
    ? distribuirCargo(fleteAplicado, articulo.map((l) => ({ ...l, cantidad: Number(recibir[l.id] || 0) })))
    : {};

  // Setear "a recibir" acotado a [0, pendiente] (lo usa el selector − valor + móvil).
  const setQty = (l: { id: string }, n: number, pend: number) =>
    setRecibir((r) => ({ ...r, [l.id]: String(Math.max(0, Math.min(n, pend))) }));
  const recibirTodoPend = () => setRecibir(Object.fromEntries(articulo.map((l) => [l.id, String(ordenLineaPendiente(l))])));
  const limpiarCant = () => setRecibir(Object.fromEntries(articulo.map((l) => [l.id, "0"])));

  // Bloque "marcar para nota de crédito" (compartido tabla desktop + tarjeta móvil):
  // tipo de nota + comentario por línea. Cantidad y precio se toman de la línea.
  const ncMark = (l: { id: string }) => (
    <div className="nc-mark nc-mark--stack">
      <div className="nc-mark__row">
        <span className="nc-mark__label">Nota de crédito</span>
        <Select value={marcadas[l.id].motivo} onChange={(e) => setMarca(l.id, { motivo: e.target.value as MotivoNC })} style={{ minWidth: 168 }}>
          {MOTIVO_NC.map((mo) => <option key={mo.v} value={mo.v}>{mo.label}</option>)}
        </Select>
        <button type="button" className="link-btn nc-mark__quitar" onClick={() => quitarMarca(l.id)}>Quitar</button>
      </div>
      <div className="nc-mark__row">
        <Textarea rows={2} style={{ width: "100%" }} aria-label="Comentario de la nota de crédito"
          placeholder="Comentario: qué pasó con esta línea (opcional)…"
          value={marcadas[l.id].nota} onChange={(e) => setMarca(l.id, { nota: e.target.value })} />
      </div>
    </div>
  );

  // Abrir el popup de nota de crédito para una línea (borrador desde lo ya marcado).
  // La cantidad arranca en lo que se recibe y el precio en el de la orden; según el
  // tipo el popup pide el precio de la factura (precio distinto) o la cantidad.
  const abrirNc = (l: { id: string; descripcion: string; cantidad?: number; precioUnitario?: number }) => {
    const ex = marcadas[l.id];
    setNcModal({
      lineId: l.id, descripcion: l.descripcion,
      motivo: ex?.motivo ?? "precio_distinto",
      cantidad: ex?.cantidad ?? String(recibir[l.id] || l.cantidad || ""),
      precio: ex?.precio ?? (l.precioUnitario != null ? String(Math.round(l.precioUnitario * 100) / 100) : ""),
      nota: ex?.nota ?? "",
    });
    setMenuOpen(null);
  };
  // Confirmar el popup: guarda tipo + cantidad + precio + comentario en la línea.
  const guardarNc = () => {
    if (!ncModal) return;
    setMarcadas((m) => ({
      ...m,
      [ncModal.lineId]: { motivo: ncModal.motivo, cantidad: ncModal.cantidad, precio: ncModal.precio, nota: ncModal.nota },
    }));
    setNcModal(null);
  };

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
    if (avisarCargo && !cargoAvisoDesc.trim()) { toast("Escribí qué cargo de producto trae la factura para avisarle a Contabilidad (o desmarcá la casilla).", "error"); return; }
    const excede = articulo.find((l) => Number(recibir[l.id] || 0) > ordenLineaPendiente(l) + 1e-9);
    if (excede) { toast(`No podés recibir más de lo pendiente en "${excede.descripcion}".`, "error"); return; }
    // Factura repetida en la misma orden: casi siempre es un doble registro o un
    // error de dedo, y en contabilidad se termina pagando dos veces.
    const yaRegistrada = recepciones.some(
      (r) => r.ordenId === orden!.id && (r.numeroFactura ?? "").trim().toLowerCase() === numeroFactura.trim().toLowerCase()
    );
    if (yaRegistrada) {
      toast(`La factura ${numeroFactura.trim()} ya está registrada en esta orden. Revisá "Recibidas".`, "error");
      return;
    }
    const lineas = articulo
      .filter((l) => Number(recibir[l.id] || 0) > 0)
      .map((l) => ({ ordenLineaId: l.id, cantidadRecibida: Number(recibir[l.id]) }));
    if (nadaRecibidoAun && cargo) lineas.push({ ordenLineaId: cargo.id, cantidadRecibida: cargo.cantidad });
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
            body: JSON.stringify({
              orderNo: orden!.bcNumber, vendorInvoiceNo: numeroFactura.trim(), lineas: bcLineas, postingDate: fechaRegistro,
            }),
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
        cargoAviso: cargoAvisoPayload(),
      });
      // Líneas marcadas → notas de crédito (no bloquea el registro).
      const nc = articulo.filter((l) => marcadas[l.id]).map((l) => ({ ordenLineaId: l.id, articuloNo: l.articuloId, descripcion: l.descripcion, motivo: marcadas[l.id].motivo, cantidad: Number(marcadas[l.id].cantidad) || 0, precioUnitario: Number(marcadas[l.id].precio) || 0, nota: marcadas[l.id].nota || undefined }));
      // No debe tumbar el registro (la factura ya viajó a BC), pero SÍ hay que
      // avisar: si esto falla en silencio, Bodega marcó líneas para nota de crédito
      // y Contabilidad nunca las ve.
      let avisoNc = "";
      if (nc.length) {
        try { await marcarNotasCredito(orden!.id, orden!.numero, orden!.proveedorNombre ?? prov?.nombre, nc); }
        catch (e: any) { avisoNc = ` · OJO: no se pudieron guardar las ${nc.length} línea(s) marcadas para nota de crédito (${String(e?.message ?? e)}). Avisale a Contabilidad.`; }
      }
      const falloBc = aviso.includes("NO se pudo") || aviso.includes("no disponible");
      toast(`Factura ${numeroFactura} registrada${completaOrden ? " — orden completada" : " (parcial)"}${aviso}${cargoAvisoPayload() ? " · se avisó a Contabilidad del cargo adicional" : ""}${avisoNc}`, falloBc || avisoNc ? "info" : "success");
      if (bcOk) {
        // Mostramos el modal de inmediato (antes + facturado) y desbloqueamos; la
        // verificación del stock "después" en BC se consulta en segundo plano (no
        // re-bloquea el POST ya lento). despues=undefined → "verificando…".
        setConfirmInv(items.map((it) => {
          const qty = bcLineas.filter((l) => l.itemNo === it).reduce((s, l) => s + l.qty, 0);
          return { itemNo: it, desc: articulo.find((a) => a.articuloId === it)?.descripcion ?? it, antes: antes[it] ?? null, recibido: qty, despues: undefined };
        }));
        setGuardando(false);
        stockDeItems(items)
          .then((despues) => setConfirmInv((prev) => prev && prev.map((x) => ({ ...x, despues: despues[x.itemNo] ?? null }))))
          .catch(() => setConfirmInv((prev) => prev && prev.map((x) => ({ ...x, despues: null }))));
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
    if (avisarCargo && !cargoAvisoDesc.trim()) { toast("Escribí qué cargo de producto trae la factura para avisarle a Contabilidad (o desmarcá la casilla).", "error"); return; }
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
        cargoAviso: cargoAvisoPayload(),
      });
      const nc = articulo.filter((l) => marcadas[l.id]).map((l) => ({ ordenLineaId: l.id, articuloNo: l.articuloId, descripcion: l.descripcion, motivo: marcadas[l.id].motivo, cantidad: Number(marcadas[l.id].cantidad) || 0, precioUnitario: Number(marcadas[l.id].precio) || 0, nota: marcadas[l.id].nota || undefined }));
      // No debe tumbar el registro (la factura ya viajó a BC), pero SÍ hay que
      // avisar: si esto falla en silencio, Bodega marcó líneas para nota de crédito
      // y Contabilidad nunca las ve.
      let avisoNc = "";
      if (nc.length) {
        try { await marcarNotasCredito(orden!.id, orden!.numero, orden!.proveedorNombre ?? prov?.nombre, nc); }
        catch (e: any) { avisoNc = ` · OJO: no se pudieron guardar las ${nc.length} línea(s) marcadas para nota de crédito (${String(e?.message ?? e)}). Avisale a Contabilidad.`; }
      }
      const falloBc = aviso.includes("NO se pudo") || aviso.includes("no disponible");
      toast(`Material recibido — factura EN REVISIÓN${aviso}${cargoAvisoPayload() ? " · se avisó a Contabilidad del cargo adicional" : ""}${avisoNc}`, falloBc || avisoNc ? "info" : "success");
      router.push(`/facturacion`);
    } catch (e: any) {
      toast(String(e?.message ?? e), "error");
      setGuardando(false);
    }
  }

  return (
    <>
      <main className={esContabilidad ? "page page--wide" : "page"} style={esContabilidad ? undefined : { maxWidth: 760 }}>
        <button type="button" className="back-link" onClick={() => router.push("/facturacion")}>Volver a órdenes por recibir</button>
        <div className="page__head">
          <div className="page__title">
            <div className="row gap-3">
              <h1 className="ds-heading">Registrar factura · {orden.bcNumber ?? orden.numero}</h1>
              <Badge tone={ordenBadge(orden.estado).tone}>{ordenBadge(orden.estado).label}</Badge>
            </div>
            <p className="ds-muted">{orden.proveedorNombre ?? prov?.nombre} · recibido {ordenRecibidoPct(orden)}%</p>
          </div>
        </div>

        <Card>
          <h3 className="ds-subtitle" style={{ marginBottom: 16 }}>Datos de la factura</h3>
          <div className="grid-2">
            <Field label="N.º de factura del proveedor">
              <Input value={numeroFactura} onChange={(e) => setNumeroFactura(e.target.value)} placeholder="Ej. F-0099281" />
            </Field>
            <Field label="Fecha de la factura">
              <DateField value={fechaFactura} onChange={(v) => { setFechaFactura(v); setFechaRegistro(v); setFechaRecepcion(v); }} />
            </Field>
            {/* Bodega: una sola fecha (recepción y registro se llevan por detrás
                igual a la factura). Contabilidad: se editan las tres. */}
            {!esContabilidad && (
              <div className="ds-body-sm ds-muted" style={{ gridColumn: "1 / -1", marginTop: -6 }}>
                Se usa también como fecha de recepción en bodega y de registro contable.
              </div>
            )}
            {esContabilidad && <>
              <Field label="Fecha de recepción en bodega">
                <DateField value={fechaRecepcion} onChange={setFechaRecepcion} />
              </Field>
              <Field label="Fecha de registro (contable)"
                warning={!fechasCoinciden}
                help={fechasCoinciden ? "Coincide con la fecha de factura ✓" : "Debe coincidir con la fecha de factura para que cuadre con el estado de cuenta del proveedor."}>
                <DateField value={fechaRegistro} onChange={setFechaRegistro} />
              </Field>
            </>}
          </div>
        </Card>

        {esContabilidad && (
        <Card className="mt-4" style={{ padding: 0, overflow: "hidden" }}>
          <div className="row row--between" style={{ padding: "12px 16px", borderBottom: "1.5px solid var(--ds-color-gray-100)" }}>
            <span className="ds-label ds-muted">{articuloVisible.length} línea(s) de artículo</span>
            <div className="row gap-3">
              <button className="link-btn" title="Poner en 'a recibir' toda la cantidad pendiente de cada línea" onClick={recibirTodoPend}>Recibir todo lo pendiente</button>
              <button className="link-btn" title="Dejar en 0 las cantidades a recibir" onClick={limpiarCant}>Limpiar cantidades</button>
            </div>
          </div>
          <div className="ds-table-wrap" style={{ boxShadow: "none" }}>
            <table className="ds-table">
              <thead>
                <tr>
                  <th style={{ width: 32 }}></th><th>Artículo</th><th className="hide-mobile">Almacén</th>
                  <th className="ds-num hide-mobile">Ordenado</th><th className="ds-num hide-mobile">Ya recib.</th>
                  <th className="ds-num">Pend.</th><th className="ds-num">A recibir</th>
                  <th className="ds-num hide-mobile">Precio</th>
                  <th className="ds-num hide-mobile">A facturar</th>
                </tr>
              </thead>
              <tbody>
                {articuloVisible.map((l) => {
                  const pend = ordenLineaPendiente(l);
                  const val = Number(recibir[l.id] || 0);
                  const importe = importeRecibir(l);
                  return (
                    <tr key={l.id} className={pend > 0 && val < pend ? "row-pending" : ""}>
                      <td className="ds-num"><input type="checkbox" className="ds-cbx" checked={pend > 0 && val >= pend} disabled={pend <= 0} title="Marcar recibido completo" onChange={(e) => setRecibir((r) => ({ ...r, [l.id]: e.target.checked ? String(pend) : "0" }))} /></td>
                      <td>
                        <div className="row row--between" style={{ alignItems: "flex-start", gap: 8 }}>
                          <div style={{ minWidth: 0 }}>
                            {l.descripcion}
                            <div className="ds-body-sm ds-muted">
                              {[l.pedidoNumero, l.proyecto && `Proy. ${l.proyecto}`, l.taskNo && `Tarea ${l.taskNo}`, l.descuentoPct ? `−${l.descuentoPct}%` : null].filter(Boolean).join(" · ")}
                            </div>
                          </div>
                          {!marcadas[l.id] && (
                            <button type="button" className="nc-flag" onClick={() => marcarLinea(l)}
                              title="Marcar para nota de crédito" aria-label={`Marcar "${l.descripcion}" para nota de crédito`}>
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
                            </button>
                          )}
                        </div>
                        {marcadas[l.id] && <div style={{ marginTop: 8 }}>{ncMark(l)}</div>}
                      </td>
                      <td className="ds-muted hide-mobile">{l.almacen}</td>
                      <td className="ds-num hide-mobile">{num.format(l.cantidad)} {l.unidad}</td>
                      <td className="ds-num hide-mobile">{num.format(l.cantidadRecibida)}</td>
                      <td className="ds-num">{pend > 0 ? <span className="ds-pending-text">{num.format(pend)}</span> : "0"}</td>
                      <td className="ds-num">
                        <input className="ds-cell-input" type="number" min={0} max={pend} value={recibir[l.id] ?? ""} disabled={pend <= 0}
                          title={pend <= 0 ? "Esta línea ya se recibió completa" : undefined}
                          onChange={(e) => { const v = e.target.value; if (v === "") return setRecibir((r) => ({ ...r, [l.id]: "" })); const n = Math.max(0, Math.min(Number(v) || 0, pend)); setRecibir((r) => ({ ...r, [l.id]: String(n) })); }} />
                      </td>
                      <td className="ds-num ds-muted hide-mobile">{money(l.precioUnitario, orden.currencyCode)}</td>
                      <td className="ds-num ds-strong hide-mobile">{money(importe || 0, orden.currencyCode)}</td>
                    </tr>
                  );
                })}
                {cargo && (
                  <tr style={{ opacity: completaOrden ? 1 : 0.5 }}>
                    <td></td>
                    <td><Badge tone="yellow">Cargo</Badge> {cargo.descripcion}</td>
                    <td className="ds-muted hide-mobile">{cargo.almacen}</td>
                    <td className="ds-num hide-mobile">{num.format(cargo.cantidad)}</td>
                    <td className="ds-num hide-mobile">{num.format(cargo.cantidadRecibida)}</td>
                    <td className="ds-num">—</td>
                    <td className="ds-num">{nadaRecibidoAun ? num.format(cargo.cantidad) : "—"}</td>
                    <td className="ds-num ds-muted hide-mobile">{money(cargo.precioUnitario, orden.currencyCode)}</td>
                    <td className="ds-num ds-strong hide-mobile">{money(fleteAplicado, orden.currencyCode)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
        )}

        {/* Vista BODEGA (Pedro): cada línea es una tarjeta con campo de cantidad.
            Es la vista por defecto salvo Contabilidad (que ve la tabla de arriba). */}
        {!esContabilidad && (
        <Card className="mt-4">
          <div className="recv-head">
            <span className="ds-label ds-muted">{articuloVisible.length} artículo(s) a recibir</span>
          </div>
          {articuloVisible.length > 0 && (
            <div className="recv-head__actions">
              <Button variant="green" size="sm" onClick={recibirTodoPend}>Recibir todo</Button>
              <Button variant="outline" size="sm" onClick={limpiarCant}>Limpiar</Button>
            </div>
          )}
          <div className="recv-list">
            {articuloVisible.length === 0 && (
              <div className="ds-body-sm ds-muted" style={{ padding: "6px 2px" }}>
                Ya recibiste todos los artículos de esta orden.
              </div>
            )}
            {articuloVisible.map((l) => {
              const pend = ordenLineaPendiente(l);
              const val = Number(recibir[l.id] || 0);
              const full = pend > 0 && val >= pend;
              const zero = pend > 0 && val <= 0;
              const marcada = !!marcadas[l.id];
              // Progreso de la línea (entregas parciales): lo ya recibido antes,
              // lo que se recibe ahora y lo que quedaría pendiente.
              const total = l.cantidad;
              const recibidoAntes = l.cantidadRecibida ?? 0;
              const pctDone = total > 0 ? (recibidoAntes / total) * 100 : 0;
              const pctNow = total > 0 ? (Math.min(val, pend) / total) * 100 : 0;
              const faltanDespues = Math.max(0, pend - val);
              return (
                <div key={l.id} className={`recv-card ${marcada ? "is-nc" : full ? "is-full" : zero ? "is-zero" : ""}`}>
                  <div className="recv-card__row">
                    <div className="recv-card__name">{l.descripcion}</div>
                    <button type="button" className={`kebab ${marcada ? "is-marked" : ""}`}
                      aria-label="Más opciones" aria-haspopup="menu" aria-expanded={menuOpen === l.id}
                      onClick={() => setMenuOpen(menuOpen === l.id ? null : l.id)}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden><circle cx="12" cy="5" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="12" cy="19" r="1.7" /></svg>
                    </button>
                    {menuOpen === l.id && (
                      <>
                        <div className="kebab__overlay" onClick={() => setMenuOpen(null)} />
                        <div className="kebab-menu" role="menu">
                          {pend > 0 && val < pend && (
                            <button type="button" className="kebab-menu__item" role="menuitem" onClick={() => { setQty(l, pend, pend); setMenuOpen(null); }}>
                              Recibir todo ({num.format(pend)})
                            </button>
                          )}
                          {!marcada
                            ? <button type="button" className="kebab-menu__item kebab-menu__item--nc" role="menuitem" onClick={() => abrirNc(l)}>Marcar nota de crédito</button>
                            : <>
                                <button type="button" className="kebab-menu__item" role="menuitem" onClick={() => abrirNc(l)}>Editar nota de crédito</button>
                                <button type="button" className="kebab-menu__item kebab-menu__item--nc" role="menuitem" onClick={() => { quitarMarca(l.id); setMenuOpen(null); }}>Quitar nota de crédito</button>
                              </>}
                        </div>
                      </>
                    )}
                  </div>
                  {marcada && (
                    <button type="button" className="recv-nc-chip" onClick={() => abrirNc(l)}
                      title="Editar nota de crédito">
                      Nota de crédito · {MOTIVO_NC.find((mo) => mo.v === marcadas[l.id].motivo)?.label}
                    </button>
                  )}
                  <div className="recv-card__row2">
                    <span className="recv-card__price">
                      <b>{money(l.precioUnitario, orden.currencyCode)}</b> c/u
                    </span>
                    <div className="qty-field">
                      <input className={`qty-input ${val > 0 && pend > 0 ? "is-active" : ""}`} type="number" inputMode="numeric" min={0} max={pend} value={recibir[l.id] ?? ""} disabled={pend <= 0}
                        aria-label={`Cantidad a recibir de ${l.descripcion}`}
                        onChange={(e) => { const v = e.target.value; if (v === "") return setRecibir((r) => ({ ...r, [l.id]: "" })); setQty(l, Number(v) || 0, pend); }}
                        onBlur={(e) => { if (e.target.value === "") setRecibir((r) => ({ ...r, [l.id]: "0" })); }} />
                      {l.unidad && <span className="qty-field__unit">{l.unidad}</span>}
                    </div>
                  </div>
                  {/* Progreso de la orden para esta línea (entregas parciales). */}
                  <div className="recv-prog">
                    <div className="recv-prog__bar" role="img"
                      aria-label={`Recibido ${num.format(recibidoAntes)} de ${num.format(total)}${l.unidad ? " " + l.unidad : ""}`}>
                      <span className="recv-prog__seg recv-prog__seg--done" style={{ width: `${pctDone}%` }} />
                      <span className="recv-prog__seg recv-prog__seg--now" style={{ width: `${pctNow}%` }} />
                    </div>
                    <span className="recv-prog__lbl">
                      {recibidoAntes > 0
                        ? `Ya recibiste ${num.format(recibidoAntes)} de ${num.format(total)} ${l.unidad ?? ""}`.trim()
                        : `Pedido ${num.format(total)} ${l.unidad ?? ""}`.trim()} ·{" "}
                      {faltanDespues > 0
                        ? <span className="recv-prog__falta">faltan {num.format(faltanDespues)} por recibir</span>
                        : <span className="recv-prog__done">se completa ✓</span>}
                    </span>
                  </div>
                </div>
              );
            })}
            {cargo && (
              <div className="recv-cargo" style={{ opacity: nadaRecibidoAun ? 1 : 0.6 }}>
                <Badge tone="yellow">Cargo</Badge>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="ds-strong">{cargo.descripcion}</div>
                  <div className="ds-body-sm ds-muted">
                    {nadaRecibidoAun ? `Se factura en esta entrega · ${money(fleteAplicado, orden.currencyCode)}` : "Ya se facturó en la primera entrega"}
                  </div>
                </div>
              </div>
            )}
          </div>
        </Card>
        )}

        {cargo && nadaRecibidoAun && !completaOrden && (
          <Card flat className="mt-4 ds-form-field--advertencia">
            <div className="row gap-3">
              <span style={{ color: "var(--ds-color-red-200)" }}><IconWarning /></span>
              <div>
                <div className="ds-strong">El flete de la orden se factura en esta entrega</div>
                <p className="ds-label ds-muted">
                  Como es la primera recepción, el flete (cargo de producto) de la orden se reparte entre los materiales
                  que estás recibiendo ahora. Las líneas faltantes quedan pendientes.
                </p>
              </div>
            </div>
          </Card>
        )}

        {/* Aviso a Contabilidad: la factura trae un cargo de producto adicional
            (flete u otro) que Kattya debe agregar. Solo Bodega (Contabilidad es
            quien lo agrega, no se avisa a sí misma). */}
        {!esContabilidad && (
        <Card className="mt-4">
          <Checkbox checked={avisarCargo} onChange={(e) => setAvisarCargo(e.target.checked)}
            label={<span className="ds-strong">Esta factura trae un cargo de producto adicional</span>} />
          <p className="ds-label ds-muted" style={{ margin: "6px 0 0" }}>
            Si viene un flete u otro cargo de producto extra, marcalo: le avisamos a Contabilidad (Kattya) para que lo agregue. Vos recibís y registrás la factura igual.
          </p>
          {avisarCargo && (
            <div className="grid-2 mt-3">
              <Field label="¿Qué cargo trae?">
                <Input value={cargoAvisoDesc} onChange={(e) => setCargoAvisoDesc(e.target.value)} placeholder="Ej. Flete / transporte" />
              </Field>
              <Field label="Monto aprox. (opcional)">
                <Input type="number" inputMode="decimal" min={0} value={cargoAvisoMonto} onChange={(e) => setCargoAvisoMonto(e.target.value)} placeholder="0" />
              </Field>
            </div>
          )}
        </Card>
        )}

        <div className="row row--between wrap gap-4 mt-6" style={{ alignItems: "flex-end" }}>
          <div className="totals" style={{ minWidth: 320 }}>
            <div className="totals__row"><span>Subtotal recibido</span><span>{money(subtotalRecibido, orden.currencyCode)}</span></div>
            {fleteAplicado > 0 && <div className="totals__row"><span>Flete (orden)</span><span>{money(fleteAplicado, orden.currencyCode)}</span></div>}
            <div className="totals__row"><span>IVA</span><span>{money(ivaFactura, orden.currencyCode)}</span></div>
            <div className="totals__row totals__row--grand" style={{ gridColumn: "1 / -1" }}>
              <span>Total factura (con IVA)</span><span>{money(totalConIva, orden.currencyCode)}</span>
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              {completaOrden ? <Badge tone="green">Recepción completa</Badge> : <Badge tone="yellow">Recepción parcial — la orden queda abierta</Badge>}
            </div>
          </div>
          <div className="row gap-3 wrap recv-actions">
            <Button variant="outline" onClick={() => setPreview(true)} disabled={!algoRecibido}>Vista previa</Button>
            <Button variant="ghost" onClick={recibirEnRevision} disabled={!algoRecibido || guardando} title="El material llegó bien pero la factura tiene problemas: recibí el material y mandá la factura a revisión.">Recibir sin factura (a revisión)</Button>
            <Button variant="green" onClick={registrar} disabled={!algoRecibido || !numeroFactura.trim() || guardando}>{guardando ? "Registrando…" : "Registrar factura"}</Button>
          </div>
          {guardando && (
            <p className="ds-body-sm ds-muted" role="status" style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8 }}>
              <span className="ds-spinner" aria-hidden />
              Registrando en Business Central (recibo + factura + movimientos de inventario). Puede tardar hasta ~1&nbsp;min; no cierres esta pantalla.
            </p>
          )}
        </div>

        {ncModal && (
          <Modal
            title="Nota de crédito"
            onClose={() => setNcModal(null)}
            footer={<>
              {marcadas[ncModal.lineId] && <Button variant="ghost" onClick={() => { quitarMarca(ncModal.lineId); setNcModal(null); }}>Quitar</Button>}
              <Button variant="outline" onClick={() => setNcModal(null)}>Cancelar</Button>
              <Button variant="green" onClick={guardarNc}>Guardar</Button>
            </>}
          >
            <p className="ds-label ds-muted" style={{ margin: "0 0 4px" }}>Material</p>
            <p className="ds-strong" style={{ margin: "0 0 16px" }}>{ncModal.descripcion}</p>
            <Field label="Tipo de nota de crédito">
              <Select value={ncModal.motivo} onChange={(e) => setNcModal((m) => m && { ...m, motivo: e.target.value as MotivoNC })}>
                {MOTIVO_NC.map((mo) => <option key={mo.v} value={mo.v}>{mo.label}</option>)}
              </Select>
            </Field>
            {ncModal.motivo === "precio_distinto" && (
              <Field label="Precio con el que viene la factura (por unidad)">
                <Input type="number" inputMode="decimal" min={0} value={ncModal.precio} placeholder="0"
                  onChange={(e) => setNcModal((m) => m && { ...m, precio: e.target.value })} />
              </Field>
            )}
            {ncModal.motivo === "menos_cantidad" && (
              <Field label="Cantidad que realmente llegó">
                <Input type="number" inputMode="numeric" min={0} value={ncModal.cantidad} placeholder="0"
                  onChange={(e) => setNcModal((m) => m && { ...m, cantidad: e.target.value })} />
              </Field>
            )}
            <Field label="Comentario (opcional)">
              <Textarea rows={3} value={ncModal.nota} placeholder="Qué pasó con esta línea…"
                onChange={(e) => setNcModal((m) => m && { ...m, nota: e.target.value })} />
            </Field>
          </Modal>
        )}

        {preview && (
          <Modal
            title="Vista previa del registro"
            onClose={() => setPreview(false)}
            footer={<>
              <Button variant="outline" onClick={() => setPreview(false)}>Cerrar</Button>
              <Button variant="green" onClick={() => { setPreview(false); registrar(); }} disabled={!numeroFactura.trim() || guardando}>Confirmar y registrar</Button>
            </>}
          >
            <p className="ds-label">Factura del proveedor <span className="ds-strong">{orden.proveedorNombre ?? prov?.nombre}</span> por:</p>
            <h2 className="ds-heading" style={{ margin: "8px 0 4px" }}>{money(totalConIva, orden.currencyCode)}</h2>
            <p className="ds-body-sm ds-muted" style={{ margin: "0 0 16px" }}>Subtotal {money(totalFactura, orden.currencyCode)} + IVA {money(ivaFactura, orden.currencyCode)}</p>
            <div className="ds-table-wrap" style={{ boxShadow: "none", border: "1.5px solid var(--ds-color-gray-100)" }}>
              <table className="ds-table">
                <thead><tr><th>Concepto</th><th className="ds-num">Cant.</th><th className="ds-num">Importe</th></tr></thead>
                <tbody>
                  {articulo.filter((l) => Number(recibir[l.id] || 0) > 0).sort((a, b) => a.descripcion.localeCompare(b.descripcion, "es")).map((l) => (
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
                    const verificando = x.despues === undefined;
                    const sd = !verificando && (x.antes == null || x.despues == null);
                    const ok = !verificando && !sd && Math.abs((x.despues as number) - ((x.antes as number) + x.recibido)) < 1e-6;
                    return (
                      <tr key={x.itemNo}>
                        <td>{x.desc}<div className="ds-body-sm ds-muted">{x.itemNo}</div></td>
                        <td className="ds-num">{x.antes == null ? "—" : num.format(x.antes)}</td>
                        <td className="ds-num ds-strong" style={{ color: "var(--ds-color-green-300)" }}>+{num.format(x.recibido)}</td>
                        <td className="ds-num ds-strong">{verificando ? <Skeleton style={{ display: "inline-block", width: 48, height: 14, borderRadius: 6 }} /> : x.despues == null ? "—" : num.format(x.despues)}</td>
                        <td className="ds-num">{verificando ? <span className="ds-muted" title="Verificando en BC…">…</span> : sd ? <span className="ds-muted" title="BC no devolvió stock">s/d</span> : ok ? "✅" : <span title="El cambio no coincide con lo facturado" style={{ color: "var(--ds-color-red-200)" }}>⚠️</span>}</td>
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
    </>
  );
}
