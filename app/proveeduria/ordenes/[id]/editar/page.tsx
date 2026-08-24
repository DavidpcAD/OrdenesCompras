"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, Card, EmptyState, Field, Input, Select, Textarea, useToast, Skeleton } from "@/components/ui";
import { IconWarning } from "@/components/icons";
import { Combobox } from "@/components/combobox";
import { useStore } from "@/lib/store";
import { money, ordenEsDirecta, ordenPedidos, almacenesParaRecepcion, esAlmacenFisico, monedaApp, numeroOrden } from "@/lib/helpers";
import { precioEnUnidad, precioEntreUnidades, cantidadEntreUnidades, equivalencia, equivalenciaDeUnidad, mismaMoneda, codigoDeItem, opcionesDeUnidad, type UnidadDeItem } from "@/lib/unidad";
import type { OrdenLinea } from "@/lib/types";

interface Row { key: string; articuloId: string; descripcion: string; unidad: string; unidadBase?: string; factorCompra?: number; obra: string; cantidad: string; precio: string; iva: string; descuento: string; proyecto?: string; taskNo?: string; pedidoLineaId?: string; pedidoNumero?: string; }
const uid = () => Math.random().toString(36).slice(2, 9);

// Líneas de la orden -> filas editables. Se usa en el estado inicial y al hidratar.
const filasDeOrden = (lineas: OrdenLinea[]): Row[] =>
  lineas.filter((l) => l.tipo === "articulo").map((l) => ({
    key: l.id, articuloId: l.articuloId ?? "", descripcion: l.descripcion, unidad: l.unidad,
    unidadBase: l.unidadBase, factorCompra: l.factorCompra, obra: l.proyecto ?? l.almacen ?? "",
    cantidad: String(l.cantidad), precio: String(l.precioUnitario), iva: String(l.ivaPct ?? 13), descuento: String(l.descuentoPct ?? 0),
    proyecto: l.proyecto, taskNo: l.taskNo, pedidoLineaId: l.pedidoLineaId, pedidoNumero: l.pedidoNumero,
  }));

export default function EditarOrdenPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const { ordenes, proveedores, almacenes, recepciones, pedidos, updateOrden, cargando } = useStore();
  const orden = ordenes.find((o) => o.id === id);
  // id del pedido (solicitud) de origen de una línea, para enlazar a su detalle.
  const pedidoIdDe = (pedidoLineaId?: string, pedidoNumero?: string) =>
    (pedidoLineaId && pedidos.find((p) => p.lineas.some((l) => l.id === pedidoLineaId))?.id)
    || (pedidoNumero && pedidos.find((p) => p.numero === pedidoNumero)?.id)
    || null;

  const [bcProv, setBcProv] = useState<typeof proveedores | null>(null);
  const [itemsBc, setItemsBc] = useState<{ code: string; descripcion: string; unidad: string; unidadBase?: string; factorCompra?: number }[]>([]);
  // Unidades de cada material tal como están en BC, para poder cambiar con cuál se
  // le pide al proveedor sin salir de la corrección de la orden.
  const [unidadesPorItem, setUnidadesPorItem] = useState<Record<string, UnidadDeItem[]>>({});
  const unidadesPedidasRef = useRef<Set<string>>(new Set());
  const [bcAlm, setBcAlm] = useState<typeof almacenes | null>(null);
  useEffect(() => {
    fetch("/api/bc/vendors").then((r) => (r.ok ? r.json() : { proveedores: [] })).then((d) => { if (Array.isArray(d.proveedores) && d.proveedores.length) setBcProv(d.proveedores); }).catch(() => {});
    // Igual que en compra directa: la unidad que manda es la de COMPRA de BC.
    fetch("/api/bc/items").then((r) => (r.ok ? r.json() : { items: [] })).then((d) => { if (Array.isArray(d.items)) setItemsBc(d.items.map((i: any) => ({ code: i.code, descripcion: i.descripcion, unidad: (i.unidadCompra || i.unidad || "UND"), unidadBase: i.unidad || undefined, factorCompra: i.factorCompra }))); }).catch(() => {});
    fetch("/api/bc/almacenes").then((r) => (r.ok ? r.json() : { almacenes: [] })).then((d) => { if (Array.isArray(d.almacenes) && d.almacenes.length) setBcAlm(d.almacenes); }).catch(() => {});
  }, []);
  const catProv = bcProv ?? proveedores;
  const catAlm = almacenesParaRecepcion(bcAlm ?? almacenes);

  const cargo = orden?.lineas.find((l) => l.tipo === "cargo");
  const [proveedorId, setProveedorId] = useState(orden?.proveedorId ?? "");
  const [currency, setCurrency] = useState(monedaApp(orden?.currencyCode));
  const [flete, setFlete] = useState(cargo ? String(cargo.precioUnitario) : "");
  const [almacen, setAlmacen] = useState(orden?.almacenRecepcion ?? "ALM-GRAL");
  const [observaciones, setObservaciones] = useState(orden?.observaciones ?? "");
  const [notaInterna, setNotaInterna] = useState(orden?.notaInterna ?? "");
  const [rows, setRows] = useState<Row[]>(filasDeOrden(orden?.lineas ?? []));

  // Si la orden llega DESPUÉS del primer render (modo API: el bootstrap tarda, o se
  // entra por link directo), los useState de arriba ya corrieron con `undefined` y el
  // formulario quedaba VACÍO aunque la orden tuviera datos. Se rellena UNA sola vez,
  // cuando aparece; después no se vuelve a tocar, para no pisar lo que el usuario
  // escribió cuando el auto-refresh trae la orden de nuevo.
  const hidratado = useRef(false);
  useEffect(() => {
    if (!orden || hidratado.current) return;
    hidratado.current = true;
    setProveedorId(orden.proveedorId ?? "");
    setCurrency(monedaApp(orden.currencyCode));
    setAlmacen(orden.almacenRecepcion ?? "ALM-GRAL");
    setObservaciones(orden.observaciones ?? "");
    setNotaInterna(orden.notaInterna ?? "");
    const cg = orden.lineas.find((l) => l.tipo === "cargo");
    setFlete(cg ? String(cg.precioUnitario) : "");
    setRows(filasDeOrden(orden.lineas));
  }, [orden]);
  const [qaCode, setQaCode] = useState(""); const [qaQty, setQaQty] = useState(""); const [qaPrecio, setQaPrecio] = useState("");

  // El proveedor de la orden viene como CÓDIGO ("PROV-000002": mapOrden pone
  // proveedorId = proveedorNo), pero el catálogo de /api/bc/vendors usa el GUID de BC
  // como `id`. Si solo se busca por id NUNCA hay match: el campo sale vacío y al
  // guardar viajaba `proveedorNombre: undefined` — así se perdió el nombre del
  // proveedor de las órdenes que se editaron (p. ej. CP-000029 quedó en "—").
  const provSel = catProv.find((x) => x.id === proveedorId) ?? catProv.find((x) => x.code === proveedorId);
  const setRow = (k: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === k ? { ...r, ...patch } : r)));
  const removeRow = (k: string) => setRows((rs) => rs.filter((r) => r.key !== k));
  function agregarLinea() {
    const it = itemsBc.find((x) => x.code === qaCode);
    if (!it || !(Number(qaQty) > 0)) { toast("Elegí un artículo y una cantidad.", "error"); return; }
    setRows((rs) => [...rs, { key: `m-${uid()}`, articuloId: it.code, descripcion: it.descripcion, unidad: it.unidad, unidadBase: it.unidadBase, factorCompra: it.factorCompra, obra: "", cantidad: String(Number(qaQty)), precio: String(Number(qaPrecio) || 0), iva: "13", descuento: "0", pedidoNumero: "Manual" }]);
    setQaCode(""); setQaQty(""); setQaPrecio("");
  }

  // Unidad de medida del artículo elegido en "Agregar artículo" (la de compra).
  const qaItem = itemsBc.find((x) => x.code === qaCode);
  const qaUnidad = qaItem?.unidad ?? "";
  const qaEquiv = equivalencia({ base: qaItem?.unidadBase ?? "", compra: qaUnidad, factor: qaItem?.factorCompra });

  // Unidades de los materiales de las líneas, una sola vez por material.
  useEffect(() => {
    for (const itemNo of new Set(rows.map((r) => codigoDeItem(r.articuloId)).filter(Boolean))) {
      if (unidadesPedidasRef.current.has(itemNo)) continue;
      unidadesPedidasRef.current.add(itemNo);
      fetch(`/api/bc/unidades?item=${encodeURIComponent(itemNo)}`)
        .then((r) => (r.ok ? r.json() : { unidades: [] }))
        .then((d) => setUnidadesPorItem((m) => ({ ...m, [itemNo]: Array.isArray(d.unidades) ? d.unidades : [] })))
        .catch(() => setUnidadesPorItem((m) => ({ ...m, [itemNo]: [] })));
    }
  }, [rows]);
  const unidadesDe = (itemNo: string) => unidadesPorItem[codigoDeItem(itemNo)] ?? [];
  // Lo que se ofrece en la celda: las de BC + la que la línea ya tiene.
  const opcionesFila = (itemNo: string, actual: string) => opcionesDeUnidad(unidadesDe(itemNo), actual);
  const factorDe = (itemNo: string, code: string) => {
    const c = (code ?? "").trim().toUpperCase();
    return unidadesDe(itemNo).find((u) => u.code.trim().toUpperCase() === c)?.factor;
  };
  const equivFila = (r: Row) =>
    equivalenciaDeUnidad(unidadesDe(r.articuloId), r.unidad, r.unidadBase ?? "")
    ?? equivalencia({ base: r.unidadBase ?? "", compra: r.unidad, factor: r.factorCompra });
  // Cambiar la unidad de una línea: cantidad y precio se convierten con ella, o el
  // pedido pasa de 1 estañón a 255.000 sin que nadie lo note.
  function elegirUnidadFila(r: Row, code: string) {
    const p = Number(r.precio) || 0;
    const q = Number(r.cantidad) || 0;
    const nuevoP = precioEntreUnidades(p, factorDe(r.articuloId, r.unidad), factorDe(r.articuloId, code));
    const nuevaQ = cantidadEntreUnidades(q, factorDe(r.articuloId, r.unidad), factorDe(r.articuloId, code));
    setRow(r.key, {
      unidad: code,
      factorCompra: factorDe(r.articuloId, code),
      ...(p > 0 ? { precio: nuevoP != null ? String(Number(nuevoP.toFixed(5))) : "" } : {}),
      ...(q > 0 && nuevaQ != null ? { cantidad: String(Number(nuevaQ.toFixed(8))) } : {}),
    });
  }
  const [qaRef, setQaRef] = useState<{ precio: number; unidad: string; moneda: string; factor?: number } | null>(null);
  const calcImporte = (r: Row) => Number(r.cantidad) * Number(r.precio) * (1 - (Number(r.descuento) || 0) / 100);
  const subtotal = useMemo(() => rows.reduce((s, r) => s + calcImporte(r), 0), [rows]);
  const ivaTotal = useMemo(() => rows.reduce((s, r) => s + calcImporte(r) * ((Number(r.iva) || 0) / 100), 0), [rows]);
  const fleteNum = Number(flete) || 0;
  const total = subtotal + fleteNum + ivaTotal;
  const [guardando, setGuardando] = useState(false);

  if (!orden) {
    if (cargando) return <main className="page"><div className="col gap-4" aria-busy="true">
      <Skeleton style={{ display: "block", width: 240, height: 30, borderRadius: 8 }} />
      <Skeleton style={{ display: "block", width: "100%", height: 340, borderRadius: 16, marginTop: 8 }} />
    </div></main>;
    return <><main className="page"><EmptyState icon={<IconWarning size={24} />} title="Orden no encontrada." /></main></>;
  }
  // No se puede editar una orden que ya tiene recepciones: reescribir las líneas
  // rompería la trazabilidad de lo recibido/facturado (y su enlace a las recepciones).
  const tieneRecepciones = recepciones.some((r) => r.ordenId === orden.id)
    || orden.lineas.some((l) => l.cantidadRecibida > 0 || l.cantidadFacturada > 0);
  if (tieneRecepciones) {
    return <><main className="page">
      <button type="button" className="back-link" onClick={() => router.push(`/proveeduria/ordenes/${id}`)}>Volver a la orden</button>
      <EmptyState icon={<IconWarning size={24} />} title="No se puede editar" hint="Esta orden ya tiene recepciones registradas: editarla reescribiría las líneas y se perdería la trazabilidad de lo recibido y facturado." />
    </main></>;
  }
  if (orden.estado !== "abierto" && orden.estado !== "rechazado") {
    return <><main className="page">
      <button type="button" className="back-link" onClick={() => router.push(`/proveeduria/ordenes/${id}`)}>Volver a la orden</button>
      <EmptyState icon={<IconWarning size={24} />} title="No se puede editar" hint="Solo se puede editar mientras la orden está Abierta o Rechazada." />
    </main></>;
  }

  // Una orden nacida de una solicitud NO permite agregar artículos sueltos: sus
  // líneas deben corresponder a lo pedido por Ingeniería. Para compras libres se
  // usa una "orden directa". En las directas sí se muestra el buscador de artículos.
  const esDirecta = ordenEsDirecta(orden);
  const peds = ordenPedidos(orden);

  async function guardar() {
    if (!proveedorId) { toast("Seleccioná un proveedor.", "error"); return; }
    // Sin resolver contra el catálogo no se sabe el nombre: guardar borraría el que
    // la orden ya tenía. Mejor frenar y pedir que lo elija.
    if (!provSel) { toast("No se pudo resolver el proveedor de la orden contra el catálogo de BC. Elegilo de nuevo en el campo Proveedor.", "error"); return; }
    if (rows.length === 0) { toast("La orden debe tener al menos una línea.", "error"); return; }
    // Cantidad/precio válidos (un campo vacío daba NaN y reescribía la orden con una
    // cantidad imposible, o hacía fallar el INSERT con un error de SQL ilegible).
    const malaCant = rows.find((r) => !(Number(r.cantidad) > 0));
    if (malaCant) { toast(`Poné una cantidad mayor que 0 en "${malaCant.descripcion}".`, "error"); return; }
    const malPrecio = rows.find((r) => !Number.isFinite(Number(r.precio)) || Number(r.precio) < 0);
    if (malPrecio) { toast(`El precio de "${malPrecio.descripcion}" no es un número válido.`, "error"); return; }
    setGuardando(true);
    try {
      const ls: Omit<OrdenLinea, "id" | "cantidadRecibida" | "cantidadFacturada">[] = rows.map((r) => ({
        tipo: "articulo", articuloId: r.articuloId, pedidoLineaId: r.pedidoLineaId, pedidoNumero: r.pedidoNumero,
        descripcion: r.descripcion, cantidad: Number(r.cantidad), unidad: r.unidad, almacen: r.obra,
        precioUnitario: Number(r.precio), ivaPct: Number(r.iva) || 0, descuentoPct: Number(r.descuento) || 0,
        proyecto: r.proyecto || r.obra || undefined, taskNo: r.taskNo,
      }));
      // El cargo se rearma conservando lo que ya tenía la orden (tipo de Item Charge
      // de BC, método de reparto, descripción y cantidad). Antes se reescribía como
      // "FLETE / TRANSPORTE" sin `chargeNo`, y sin tipo BC rechaza el cargo: editar
      // una orden le borraba el tipo que la propia pantalla obliga a elegir.
      if (fleteNum > 0) {
        ls.push({
          tipo: "cargo",
          chargeNo: cargo?.chargeNo,
          chargeMethod: cargo?.chargeMethod,
          descripcion: cargo?.descripcion || "FLETE / TRANSPORTE",
          cantidad: cargo?.cantidad && cargo.cantidad > 0 ? cargo.cantidad : 1,
          unidad: cargo?.unidad || "UND",
          almacen: cargo?.almacen || rows[0]?.obra || "",
          precioUnitario: fleteNum,
          ivaPct: cargo?.ivaPct ?? 13,
        });
      }
      const r = await updateOrden(orden!.id, { proveedorId, proveedorNo: provSel?.code, proveedorNombre: provSel?.nombre, currencyCode: currency, almacenRecepcion: almacen, observaciones: observaciones.trim() || undefined, notaInterna: notaInterna.trim() || undefined, lineas: ls });
      // Si BC no quedó sincronizado, ese aviso manda: el pedido allá tendría las
      // líneas viejas y Bodega recibiría contra ellas.
      if (r?.bcAviso) toast(r.bcAviso, "info");
      else toast(`Orden ${numeroOrden(orden!)} actualizada`, "success");
      router.push(`/proveeduria/ordenes/${orden!.id}`);
    } catch (e: any) { toast(String(e?.message ?? e), "error"); setGuardando(false); }
  }

  return (
    <>
      <main className="page page--wide" style={{ paddingBottom: 120 }}>
        <button type="button" className="back-link" onClick={() => router.push(`/proveeduria/ordenes/${id}`)}>Volver a la orden</button>
        <div className="page__head">
          <div className="page__title">
            <div className="row gap-3"><h1 className="ds-heading">Editar {numeroOrden(orden)}</h1><Badge tone="gray">Abierta</Badge></div>
            <p className="ds-muted">Ajustá proveedor, almacén, líneas y precios. Solo se puede mientras la orden esté Abierta.</p>
          </div>
        </div>

        <Card>
          <h3 className="ds-subtitle" style={{ marginBottom: 16 }}>Datos de la orden</h3>
          <div className="grid-3">
            <Field label="Proveedor" help="Hereda términos y moneda">
              <Combobox items={catProv} value={provSel?.id ?? proveedorId} onChange={(k) => { setProveedorId(k); const p = catProv.find((x) => x.id === k); if (p) setCurrency(monedaApp(p.currencyCode)); }}
                getKey={(p) => p.id} getLabel={(p) => `${p.code} — ${p.nombre}`} getSearch={(p) => `${p.code} ${p.nombre}`} placeholder="Buscar proveedor…" />
            </Field>
            <Field label="Moneda">
              <Select value={currency} onChange={(e) => setCurrency(e.target.value)}><option value="">CRC (colones)</option><option value="USD">USD (dólares)</option></Select>
            </Field>
            <Field label="Flete / transporte" help="Opcional, se distribuye al facturar">
              <Input type="number" min={0} value={flete} onChange={(e) => setFlete(e.target.value)} placeholder="0" />
            </Field>
            <Field label="Almacén / centro de costo de recepción" help="Dónde entra el material en BC. Por defecto el Almacén General, pero podés elegir cualquier centro de costo.">
              <Combobox items={catAlm} value={almacen} onChange={(k) => setAlmacen(k)}
                getKey={(a) => a.codigo} getLabel={(a) => `${a.codigo} — ${a.nombre}`}
                getSearch={(a) => `${a.codigo} ${a.nombre}`}
                groupBy={(a) => (esAlmacenFisico(a.codigo) ? "Bodegas" : "Centros de costo")}
                placeholder="Buscar almacén o centro de costo…" />
            </Field>
          </div>
          {/* Observaciones de la orden: instrucciones para el proveedor (horario de
              entrega, contacto, referencia de cotización…). Se imprimen AL FINAL del
              PDF que se le manda, así que es lo que él va a leer. */}
          <Field label="Observaciones para el proveedor" help="Opcional. Salen impresas al final del PDF de la orden." className="mt-4">
            <Textarea rows={3} value={observaciones} maxLength={500}
              onChange={(e) => setObservaciones(e.target.value)}
              placeholder="Ej. Entregar en bodega de 7 a. m. a 3 p. m., preguntar por Fernando. Referencia cotización #4471." />
          </Field>
          {/* Y este es el mensaje para QUIEN APRUEBA: por qué corre, por qué ese
              precio, qué pasa si no se compra hoy. NO se imprime en el PDF del
              proveedor — son dos campos distintos a propósito. */}
          <Field label="Comentario para el aprobador" help="Opcional. Interno: NO sale en el PDF del proveedor." className="mt-4">
            <Textarea rows={2} value={notaInterna} maxLength={500}
              onChange={(e) => setNotaInterna(e.target.value)}
              placeholder="Ej. Urgente para la colada del viernes. El precio subió 8% porque el proveedor cambió la presentación." />
          </Field>
        </Card>

        <Card className="mt-4" style={{ padding: 0, overflow: "hidden" }}>
          {esDirecta ? (
            <div className="row wrap gap-2" style={{ alignItems: "flex-end", padding: "12px 16px", borderBottom: "1.5px solid var(--ds-color-gray-100)", background: "color-mix(in srgb, var(--ds-color-green-100) 6%, var(--ds-tint-base))" }}>
              <div style={{ flex: "1 1 280px", minWidth: 220 }}>
                <label className="ds-label ds-muted" style={{ display: "block", marginBottom: 4 }}>Agregar artículo</label>
                <Combobox items={itemsBc} value={qaCode} onChange={(k) => {
                    setQaCode(k); setQaPrecio(""); setQaRef(null);
                    const it = itemsBc.find((x) => x.code === k);
                    if (!k) return;
                    fetch(`/api/bc/lastprice?item=${encodeURIComponent(k)}&vendor=${encodeURIComponent(provSel?.code ?? "")}`)
                      .then((r) => r.json()).then((d) => {
                        if (!(typeof d.precio === "number" && d.precio > 0)) return;
                        const ref = { precio: d.precio, unidad: String(d.unidad ?? ""), moneda: String(d.moneda ?? ""), factor: d.factor };
                        setQaRef(ref);
                        // Solo se prellena si el precio corresponde a esta unidad y moneda.
                        const p = mismaMoneda(ref.moneda, currency)
                          ? precioEnUnidad(ref, it?.unidad ?? ref.unidad, it?.unidadBase ?? ref.unidad)
                          : null;
                        if (p != null) setQaPrecio(String(p));
                      }).catch(() => {});
                  }} getKey={(i) => i.code} getLabel={(i) => `${i.code} — ${i.descripcion}`}
                  // La UNIDAD a la par de cada opción: se elige el material sabiendo si
                  // va por SACO, M3 o UND, sin tener que elegirlo para averiguarlo.
                  // `.combo__item` es flex, así que el margin-left:auto la manda a la
                  // derecha y queda en columna, alineada entre filas.
                  renderItem={(i) => <>{`${i.code} — ${i.descripcion}`}<small style={{ marginLeft: "auto", paddingLeft: 12, whiteSpace: "nowrap" }}
                    title={equivalencia({ base: i.unidadBase ?? "", compra: i.unidad, factor: i.factorCompra }) ?? undefined}>{i.unidad}</small></>}
                  // También se puede buscar por unidad ("saco", "m3").
                  getSearch={(i) => `${i.code} ${i.descripcion} ${i.unidad}`} minChars={2} placeholder="Buscar artículo del catálogo…" />
              </div>
              <div>
                <label className="ds-label ds-muted" style={{ display: "block", marginBottom: 4 }}>Cantidad</label>
                {/* Íd. que en compra directa: la unidad del artículo elegido al lado
                    del campo, para no escribir una cantidad a ciegas. */}
                <span className="row gap-2" style={{ alignItems: "center" }}>
                  <Input type="number" min={0} value={qaQty} onChange={(e) => setQaQty(e.target.value)} placeholder="0" style={{ width: 90 }} />
                  {qaUnidad && <span className="ds-body-sm ds-muted" style={{ whiteSpace: "nowrap" }} title={qaEquiv ?? undefined}>{qaUnidad}</span>}
                </span>
                {qaEquiv && <div className="ds-body-sm ds-muted" style={{ marginTop: 2 }}>{qaEquiv}</div>}
              </div>
              <div><label className="ds-label ds-muted" style={{ display: "block", marginBottom: 4 }}>Precio</label><Input type="number" min={0} value={qaPrecio} onChange={(e) => setQaPrecio(e.target.value)} placeholder="0" style={{ width: 110 }} />{qaRef ? <div className="ds-body-sm ds-muted" style={{ marginTop: 2 }}>últ. compra {money(qaRef.precio, monedaApp(qaRef.moneda))}{qaRef.unidad ? ` / ${qaRef.unidad}` : ""}</div> : null}</div>
              <Button variant="outline" onClick={agregarLinea} disabled={!qaCode || !(Number(qaQty) > 0)}>+ Agregar línea</Button>
            </div>
          ) : (
            <div className="ds-body-sm ds-muted" style={{ padding: "12px 16px", borderBottom: "1.5px solid var(--ds-color-gray-100)", background: "color-mix(in srgb, var(--ds-color-green-100) 6%, var(--ds-tint-base))" }}>
              Las líneas provienen de la solicitud ({peds.join(", ")}). Podés ajustar cantidad, precio, descuento o quitar líneas, pero no agregar artículos sueltos. Para compras libres usá una <span className="ds-strong">orden directa</span>.
            </div>
          )}
          <div className="ds-table-wrap" style={{ boxShadow: "none" }}>
            <table className="ds-table">
              <thead><tr><th>Artículo</th><th>Solicitud</th><th>Obra</th><th className="ds-num">Cantidad</th><th className="ds-num">Precio</th><th className="ds-num">Desc%</th><th className="ds-num">IVA%</th><th className="ds-num">Importe</th><th></th></tr></thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={9}><div className="empty">Sin líneas. Agregá al menos una.</div></td></tr>}
                {rows.map((r) => (
                  <tr key={r.key}>
                    <td><div className="ds-clamp-2" title={r.descripcion} style={{ maxWidth: 360, minWidth: 220 }}>{r.descripcion}</div></td>
                    <td className="ds-body-sm">{(() => {
                      const pid = pedidoIdDe(r.pedidoLineaId, r.pedidoNumero);
                      if (r.pedidoNumero && pid) return <button type="button" className="linklike" title="Ver la solicitud (quién la pidió)" onClick={() => router.push(`/proveeduria/solicitudes/${pid}`)}>{r.pedidoNumero}</button>;
                      return <span className="ds-muted">{r.pedidoNumero || "—"}</span>;
                    })()}</td>
                    <td className="ds-muted ds-body-sm">{r.obra || "—"}</td>
                    <td className="ds-num">
                      {/* La unidad al lado de la cantidad: "40" solo no dice nada
                          cuando el material se compra por M3, KG o SACO. */}
                      <span className="row gap-2" style={{ justifyContent: "flex-end", alignItems: "baseline" }}>
                        <input className="ds-cell-input" aria-label="Cantidad" type="number" min={0} value={r.cantidad} style={{ width: 70 }} onChange={(e) => setRow(r.key, { cantidad: e.target.value })} />
                        {opcionesFila(r.articuloId, r.unidad).length > 1 ? (
                          <span title={equivFila(r) ?? undefined}>
                            <Select ariaLabel="Unidad de compra" className="ds-select--celda" value={r.unidad}
                              style={{ width: 104 }} onChange={(e) => elegirUnidadFila(r, e.target.value)}>
                              {opcionesFila(r.articuloId, r.unidad).map((u) => <option key={u.code} value={u.code}>{u.code}</option>)}
                            </Select>
                          </span>
                        ) : (
                          <span className="ds-body-sm ds-muted" style={{ whiteSpace: "nowrap" }}
                            title={equivFila(r) ?? undefined}>{r.unidad || "—"}</span>
                        )}
                      </span>
                    </td>
                    <td className="ds-num"><input className="ds-cell-input" aria-label="Precio" type="number" min={0} value={r.precio} style={{ width: 92 }} onChange={(e) => setRow(r.key, { precio: e.target.value })} /></td>
                    <td className="ds-num"><input className="ds-cell-input" aria-label="Descuento %" type="number" min={0} max={100} value={r.descuento} style={{ width: 60 }} onChange={(e) => setRow(r.key, { descuento: e.target.value })} /></td>
                    <td className="ds-num"><input className="ds-cell-input" aria-label="IVA %" type="number" min={0} value={r.iva} style={{ width: 56 }} onChange={(e) => setRow(r.key, { iva: e.target.value })} /></td>
                    <td className="ds-num ds-strong">{money(calcImporte(r) || 0, currency)}</td>
                    <td className="ds-num"><button type="button" className="icon-btn" title="Quitar línea" aria-label="Quitar línea" onClick={() => removeRow(r.key)}>×</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="row mt-6" style={{ justifyContent: "flex-end" }}>
          <div className="totals" style={{ minWidth: 340 }}>
            <div className="totals__row"><span>Subtotal (excl. IVA)</span><span>{money(subtotal, currency)}</span></div>
            <div className="totals__row"><span>Flete</span><span>{money(fleteNum, currency)}</span></div>
            <div className="totals__row"><span>IVA</span><span>{money(ivaTotal, currency)}</span></div>
            <div className="totals__row totals__row--grand" style={{ gridColumn: "1 / -1" }}><span>Total</span><span>{money(total, currency)}</span></div>
          </div>
        </div>
      </main>

      <div className="action-bar">
        <div className="action-bar__inner">
          <span className="ds-muted">{rows.length} línea(s) · <span className="ds-strong">{money(total, currency)}</span></span>
          <div className="row gap-3 action-bar__cta">
            <Button variant="outline" onClick={() => router.push(`/proveeduria/ordenes/${id}`)}>Cancelar</Button>
            <Button onClick={guardar} disabled={guardando}>{guardando ? "Guardando…" : "Guardar cambios"}</Button>
          </div>
        </div>
      </div>
    </>
  );
}
