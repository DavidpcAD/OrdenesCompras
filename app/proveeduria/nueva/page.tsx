"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Select, Textarea, useToast } from "@/components/ui";
import { Combobox } from "@/components/combobox";
import { IconWarning } from "@/components/icons";
import { useStore } from "@/lib/store";
import { money, ultimoPrecioProveedor, almacenesParaRecepcion, esAlmacenFisico, pedidoLineaPendiente, monedaApp, numeroOrden } from "@/lib/helpers";
import { precioEnUnidad, precioEntreUnidades, cantidadEntreUnidades, equivalencia, equivalenciaDeUnidad, mismaMoneda, codigoDeItem, opcionesDeUnidad, type PrecioRef, type UnidadDeItem } from "@/lib/unidad";
import type { OrdenLinea } from "@/lib/types";

interface Row {
  pedidoNumero: string;
  pedidoLineaId: string;
  articuloId: string;
  variantCode: string;
  descripcion: string;
  unidad: string;           // la de COMPRA (EST): es la que BC va a facturar
  unidadBase?: string;      // la de inventario (GR), solo para explicar la equivalencia
  factorCompra?: number;
  almacen: string;
  cantidad: string;
  precio: string;
  iva: string;
  descuento: string;
  proyecto: string;
  tarea: string;
}

// Tarea de obra (Job Task de BC). La obra la trae la solicitud; la tarea es lo
// único que se elige acá, porque Ingeniería pide el material para una obra pero no
// dice contra qué línea del presupuesto va.
type Tarea = { jobTaskNo: string; descripcion: string; tipo: string };

// Cargo de producto (Item Charge) a agregar a la orden: tipo (chargeNo del catálogo
// BC), cantidad y precio. chargeNo "" = flete por defecto. `key` = id estable para
// React (no usar el índice: al quitar un cargo se corrían los valores).
interface Cargo { key: string; chargeNo: string; descripcion: string; cantidad: string; precio: string; }
const cargoUid = () => Math.random().toString(36).slice(2, 9);

export default function ArmarOrdenPage() {
  const { pedidos, proveedores, ordenes, almacenes, borrador, createOrden, setOrdenEstado, setBorrador } = useStore();
  const router = useRouter();
  const toast = useToast();

  const [proveedorId, setProveedorId] = useState("");
  const [currency, setCurrency] = useState("");
  const [cargos, setCargos] = useState<Cargo[]>([]);
  const [metodoAsig, setMetodoAsig] = useState("Amount"); // Amount|Weight|Volume|Equally
  const [itemCharges, setItemCharges] = useState<{ no: string; descripcion: string }[]>([]);
  const [almacen, setAlmacen] = useState("ALM-GRAL");
  const [observaciones, setObservaciones] = useState("");
  // Comentario para el APROBADOR: interno, no viaja al proveedor.
  const [notaInterna, setNotaInterna] = useState("");

  // Unidades de cada material tal como están en BC (GR 1, EST 255.000, LT 244,01914…).
  // Con esto Proveeduría elige con qué unidad se le pide al proveedor: la solicitud
  // viene en la unidad de consumo y no siempre es en la que se compra.
  const [unidadesPorItem, setUnidadesPorItem] = useState<Record<string, UnidadDeItem[]>>({});
  const unidadesPedidasRef = useRef<Set<string>>(new Set());

  // Tareas por obra, cacheadas. `undefined` = todavía no se pidieron; `[]` = BC
  // contestó y esa obra no tiene tareas (se dice en la celda, no se deja el hueco).
  const [tareasPorObra, setTareasPorObra] = useState<Record<string, Tarea[]>>({});
  // Obras ya pedidas, para no repetir el fetch cada vez que cambian las líneas.
  const tareasPedidasRef = useRef<Set<string>>(new Set());

  // Proveedores en vivo desde Business Central (fallback al catálogo si BC falla).
  // Si el fallback se activa hay que DECIRLO: armar la orden contra el catálogo de
  // respaldo puede dejar un código de proveedor que BC no conoce, y eso recién
  // explota al lanzarla.
  const [bcProv, setBcProv] = useState<typeof proveedores | null>(null);
  const [bcCaido, setBcCaido] = useState(false);
  useEffect(() => {
    fetch("/api/bc/vendors")
      .then((r) => (r.ok ? r.json() : { proveedores: [] }))
      .then((d) => {
        if (Array.isArray(d.proveedores) && d.proveedores.length) setBcProv(d.proveedores);
        else setBcCaido(true);
      })
      .catch(() => setBcCaido(true));
  }, []);
  const catProv = bcProv ?? proveedores;
  const provSel = catProv.find((x) => x.id === proveedorId);

  // Catálogo de Cargos de producto (Item Charge) de BC para el selector de cargos.
  useEffect(() => {
    fetch("/api/bc/itemcharges")
      .then((r) => (r.ok ? r.json() : { itemCharges: [] }))
      .then((d) => { if (Array.isArray(d.itemCharges)) setItemCharges(d.itemCharges); })
      .catch(() => { /* sin BC: el selector cae a "Flete / transporte" */ });
  }, []);
  const addCargo = () => setCargos((cs) => [...cs, { key: cargoUid(), chargeNo: "", descripcion: "FLETE / TRANSPORTE", cantidad: "1", precio: "" }]);
  const setCargo = (i: number, patch: Partial<Cargo>) => setCargos((cs) => cs.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  const removeCargo = (i: number) => setCargos((cs) => cs.filter((_, idx) => idx !== i));
  const onTipoCargo = (i: number, chargeNo: string) => {
    const ic = itemCharges.find((x) => x.no === chargeNo);
    setCargo(i, { chargeNo, descripcion: ic ? ic.descripcion : "FLETE / TRANSPORTE" });
  };
  const cargoImporte = (c: Cargo) => (Number(c.cantidad) || 0) * (Number(c.precio) || 0);

  // Almacenes reales de BC (fallback al catálogo seed si BC no responde).
  const [bcAlm, setBcAlm] = useState<typeof almacenes | null>(null);
  useEffect(() => {
    // Acá NO se baja el catálogo de ítems: esta pantalla no tiene buscador de
    // artículos (las líneas vienen de solicitudes ya hechas). Solo se usaba para
    // el precio de referencia, que ahora lo da /api/bc/lastprice con su unidad y
    // su moneda — y eran 5.500 ítems por cada vez que se abría la pantalla.
    fetch("/api/bc/almacenes")
      .then((r) => (r.ok ? r.json() : { almacenes: [] }))
      .then((d) => {
        if (Array.isArray(d.almacenes) && d.almacenes.length) {
          setBcAlm(d.almacenes);
          if (!d.almacenes.some((a: any) => a.codigo === "ALM-GRAL")) setAlmacen(d.almacenes[0].codigo);
        }
      })
      .catch(() => { /* sin BC, usa seed */ });
  }, []);
  const catAlm = almacenesParaRecepcion(bcAlm ?? almacenes);

  const [rows, setRows] = useState<Row[]>(() =>
    borrador.map((b) => {
      let info: Partial<Row> = { pedidoNumero: "", articuloId: "", variantCode: "", descripcion: "", unidad: "", almacen: "", proyecto: "" };
      for (const p of pedidos) {
        const l = p.lineas.find((x) => x.id === b.pedidoLineaId);
        if (l) { info = { pedidoNumero: p.numero, articuloId: l.articuloId, variantCode: l.variantCode ?? "", descripcion: l.descripcion, unidad: l.unidad, unidadBase: l.unidadBase, factorCompra: l.factorCompra, almacen: l.almacen, proyecto: p.tipoSolicitud === "material" ? (l.almacen || p.obraCodigo || "") : "" }; break; }
      }
      return {
        pedidoLineaId: b.pedidoLineaId, ...info,
        cantidad: String(b.cantidad), precio: String(b.precio), iva: String(b.iva), descuento: "0", tarea: "",
      } as Row;
    })
  );

  // Al entrar sin borrador (nav directa/refresh) volvemos a materiales. PERO no
  // cuando acabamos de crear la orden y estamos navegando a su detalle: ahí
  // vaciamos el borrador a propósito y este redirect pisaba el push al detalle
  // (la orden quedaba creada pero caías en "Materiales" en vez de verla).
  const navegandoRef = useRef(false);
  useEffect(() => { if (borrador.length === 0 && !navegandoRef.current) router.replace("/proveeduria"); }, [borrador, router]);

  // Último precio de compra por BC: con proveedor trae el precio FACTURADO a ese
  // proveedor; SIN proveedor cae al último costo directo del item. Así el precio
  // del material aparece aunque todavía no se haya elegido proveedor.
  const [bcPrices, setBcPrices] = useState<Record<string, PrecioRef | null>>({});
  const itemIdsKey = [...new Set(rows.map((r) => r.articuloId).filter(Boolean))].sort().join(",");
  useEffect(() => {
    const code = provSel?.code ?? "";
    const items = itemIdsKey ? itemIdsKey.split(",") : [];
    if (!items.length) { setBcPrices({}); return; }
    let cancel = false;
    Promise.all(items.map(async (it) => {
      try {
        const r = await fetch(`/api/bc/lastprice?item=${encodeURIComponent(it)}&vendor=${encodeURIComponent(code)}`);
        const d = await r.json();
        // El precio viene rotulado con SU unidad y SU moneda: sin eso no se sabe si
        // aplica a esta línea (₡1,74 por gramo no es el precio de un estañón).
        const ref: PrecioRef | null = typeof d.precio === "number" && d.precio > 0
          ? { precio: d.precio, unidad: String(d.unidad ?? ""), moneda: String(d.moneda ?? ""), factor: d.factor }
          : null;
        return [it, ref] as const;
      } catch { return [it, null] as const; }
    })).then((pairs) => { if (!cancel) setBcPrices(Object.fromEntries(pairs)); });
    return () => { cancel = true; };
  }, [proveedorId, itemIdsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const setRow = (id: string, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.pedidoLineaId === id ? { ...r, ...patch } : r)));
  const removeRow = (id: string) => setRows((rs) => rs.filter((r) => r.pedidoLineaId !== id));

  // Tareas de las obras que aparecen en las líneas. Se piden solas al entrar: la
  // tarea se elige de una lista, no se escribe, y esperar a que el usuario toque
  // algo para recién ir a buscarla haría que el selector se vea vacío.
  // Solo las de tipo "Posting" admiten movimientos; las Heading/Total son rótulos
  // del presupuesto. Si BC no manda el tipo, se dejan todas.
  useEffect(() => {
    const obras = [...new Set(rows.map((r) => r.proyecto).filter(Boolean))];
    for (const jobNo of obras) {
      if (tareasPedidasRef.current.has(jobNo)) continue;
      tareasPedidasRef.current.add(jobNo);
      fetch(`/api/bc/jobtasks?jobNo=${encodeURIComponent(jobNo)}`)
        .then((r) => (r.ok ? r.json() : { jobTasks: [] }))
        .then((d) => {
          const todas: Tarea[] = Array.isArray(d.jobTasks) ? d.jobTasks : [];
          const posting = todas.filter((t) => (t.tipo ?? "").toLowerCase() === "posting");
          setTareasPorObra((m) => ({ ...m, [jobNo]: posting.length ? posting : todas }));
        })
        .catch(() => setTareasPorObra((m) => ({ ...m, [jobNo]: [] })));
    }
  }, [rows]);
  const tareasDe = (jobNo: string) => tareasPorObra[(jobNo ?? "").trim()];

  // Unidades de los materiales de las líneas, una sola vez por material. Si BC no
  // las da, queda [] y la línea se queda con su unidad de siempre.
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
  // Cambiar con qué unidad se compra esta línea. La cantidad y el precio se
  // convierten con ella: la solicitud pidió 255.000 GR, que son 1 EST, no 255.000.
  function elegirUnidadFila(r: Row, code: string) {
    const p = Number(r.precio) || 0;
    const q = Number(r.cantidad) || 0;
    const nuevoP = precioEntreUnidades(p, factorDe(r.articuloId, r.unidad), factorDe(r.articuloId, code));
    const nuevaQ = cantidadEntreUnidades(q, factorDe(r.articuloId, r.unidad), factorDe(r.articuloId, code));
    setRow(r.pedidoLineaId, {
      unidad: code,
      factorCompra: factorDe(r.articuloId, code),
      ...(p > 0 ? { precio: nuevoP != null ? String(Number(nuevoP.toFixed(5))) : "" } : {}),
      ...(q > 0 && nuevaQ != null ? { cantidad: String(Number(nuevaQ.toFixed(8))) } : {}),
    });
  }
  // Líneas que van a una obra y todavía no tienen tarea: se avisa arriba de la
  // tabla. No bloquea guardar — hasta hoy las órdenes salían así.
  const sinTarea = rows.filter((r) => r.proyecto && !r.tarea).length;

  // Agregar líneas de OTRAS solicitudes ya hechas (pendientes por ordenar) a la
  // orden que se está armando, sin salir de la página.
  const [addOpen, setAddOpen] = useState(false);
  const [addF, setAddF] = useState({ pedido: "", articulo: "", destino: "" });
  const yaEnOrden = new Set(rows.map((r) => r.pedidoLineaId));
  const lineasDisponibles = pedidos
    .filter((p) => p.estado === "aprobado" || p.estado === "en_orden")
    .flatMap((p) => p.lineas
      .filter((l) => pedidoLineaPendiente(l) > 0 && !yaEnOrden.has(l.id))
      .map((l) => ({ p, l, pend: pedidoLineaPendiente(l) })));
  const inc = (v: string, q: string) => !q || v.toLowerCase().includes(q.toLowerCase());
  const lineasDispFiltradas = lineasDisponibles.filter(({ p, l }) =>
    inc(p.numero, addF.pedido) && inc(l.descripcion, addF.articulo) && inc(l.almacen || p.obraCodigo || "", addF.destino));
  function agregarDeSolicitud(p: (typeof pedidos)[number], l: (typeof pedidos)[number]["lineas"][number], pend: number) {
    // Precio inicial = último precio de compra real (BC); si no hay historial, 0
    // para que proveeduría escriba lo acordado con el proveedor.
    const hist = precioRefEnLinea(l.articuloId, l.unidad, l.unidadBase) ?? 0;
    setRows((rs) => [...rs, {
      pedidoNumero: p.numero, pedidoLineaId: l.id, articuloId: l.articuloId, variantCode: l.variantCode ?? "",
      descripcion: l.descripcion, unidad: l.unidad, unidadBase: l.unidadBase, factorCompra: l.factorCompra, almacen: l.almacen,
      cantidad: String(pend), precio: String(hist || 0), iva: "13", descuento: "0",
      proyecto: p.tipoSolicitud === "material" ? (l.almacen || p.obraCodigo || "") : "", tarea: "",
    }]);
  }

  const calcImporte = (r: Row) => Number(r.cantidad) * Number(r.precio) * (1 - (Number(r.descuento) || 0) / 100);
  const subtotal = rows.reduce((s, r) => s + calcImporte(r), 0);
  const cargosTotal = cargos.reduce((s, c) => s + cargoImporte(c), 0);
  // Reparto de cargos por línea según el método. Peso/Volumen NO se previsualizan
  // (no hay peso/volumen en la app; lo calcula BC al registrar).
  const previewReparto = metodoAsig === "Amount" || metodoAsig === "Equally";
  const fleteShare = (r: Row) => {
    if (cargosTotal <= 0) return 0;
    if (metodoAsig === "Equally") return rows.length ? cargosTotal / rows.length : 0;
    if (metodoAsig === "Amount") return subtotal > 0 ? cargosTotal * calcImporte(r) / subtotal : 0;
    return 0; // Weight / Volume → se calcula en BC
  };
  // Precio de referencia LLEVADO A LA UNIDAD de la línea. Devuelve null cuando no
  // se puede convertir (o cuando el precio está en otra moneda): mejor sin número
  // que con uno que parece precio y está 255.000 veces abajo.
  function precioRefEnLinea(articuloId: string, unidadLinea: string, unidadBase?: string): number | null {
    const ref = bcPrices[articuloId];
    if (ref) {
      if (!mismaMoneda(ref.moneda, currency)) return null;
      const p = precioEnUnidad(ref, unidadLinea, unidadBase ?? ref.unidad)
        // Con la tabla de unidades de BC también se puede convertir entre dos
        // alternas (de EST a LT), que es lo que `precioEnUnidad` no sabe hacer.
        ?? precioEntreUnidades(ref.precio, factorDe(articuloId, ref.unidad), factorDe(articuloId, unidadLinea));
      if (p != null) return p;
    }
    // Historial de la propia app: ya está guardado en la unidad de la orden.
    return proveedorId ? ultimoPrecioProveedor(ordenes, articuloId, proveedorId) : null;
  }
  const lastPrice = (r: Row) => precioRefEnLinea(r.articuloId, r.unidad, r.unidadBase);
  // Referencia que NO aplica a esta línea (otra unidad u otra moneda): se muestra
  // rotulada, sin ofrecer pegarla.
  const refAjena = (r: Row): PrecioRef | null => {
    const ref = bcPrices[r.articuloId];
    if (!ref) return null;
    return lastPrice(r) == null ? ref : null;
  };
  // Prellenar el precio con el ÚLTIMO precio mostrado (que incluye el historial de
  // órdenes de la app al mismo proveedor), para las líneas que sigan en 0. Antes
  // solo se prellenaba desde BC/catálogo; si el ítem nunca se compró en BC (solo se
  // cotizó en la app), quedaba en 0 aunque el hint "últ. ₡…" sí lo mostraba.
  useEffect(() => {
    setRows((rs) => rs.map((r) => {
      if (Number(r.precio) > 0) return r;
      const lp = lastPrice(r);
      return typeof lp === "number" && lp > 0 ? { ...r, precio: String(lp) } : r;
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bcPrices, proveedorId, ordenes, currency]);
  // El IVA se aplica a los materiales Y al flete/cargo (13%), igual que en BC. Antes
  // el cargo quedaba sin IVA y el total no cuadraba con BC (faltaba el 13% del flete).
  const ivaCargos = cargosTotal * 0.13;
  const ivaTotal = rows.reduce((s, r) => s + calcImporte(r) * ((Number(r.iva) || 0) / 100), 0) + ivaCargos;
  const total = subtotal + cargosTotal + ivaTotal;
  const pedidosDistintos = [...new Set(rows.map((r) => r.pedidoNumero))];
  const puedeCrear = !!proveedorId && rows.length > 0;

  function elegirProveedor(id: string) {
    setProveedorId(id);
    const p = catProv.find((x) => x.id === id);
    if (p) setCurrency(monedaApp(p.currencyCode));
  }

  const [guardando, setGuardando] = useState(false);

  // "Guardar como abierta": solo registra la orden local como borrador/abierta.
  async function crear(aprobar: boolean) {
    if (!puedeCrear) { toast("Seleccioná un proveedor y agregá al menos una línea.", "error"); return; }
    // Todo cargo con importe debe tener un TIPO válido (Item Charge de BC). Sin tipo,
    // BC rechaza el cargo (404) y la orden queda lanzada SIN el flete. Se bloquea acá.
    if (cargos.some((c) => cargoImporte(c) > 0 && !c.chargeNo)) {
      toast("Elegí el tipo de cargo (transporte) antes de continuar. Sin tipo, BC no acepta el flete.", "error"); return;
    }
    // Cantidad válida SIEMPRE: si el campo quedó vacío o con texto, `Number()` da 0 o
    // NaN y la orden se creaba con una cantidad imposible (o el INSERT reventaba con
    // un error de SQL ilegible).
    const malaCant = rows.find((r) => !(Number(r.cantidad) > 0));
    if (malaCant) {
      toast(`Poné una cantidad mayor que 0 en "${malaCant.descripcion}".`, "error"); return;
    }
    const malPrecio = rows.find((r) => !Number.isFinite(Number(r.precio)) || Number(r.precio) < 0);
    if (malPrecio) {
      toast(`El precio de "${malPrecio.descripcion}" no es un número válido.`, "error"); return;
    }
    // Precio obligatorio para enviar a aprobación: ninguna línea puede ir a BC en 0.
    if (aprobar) {
      const sinPrecio = rows.filter((r) => !(Number(r.precio) > 0)).length;
      if (sinPrecio) { toast(`${sinPrecio} línea(s) sin precio. Poné el precio acordado antes de enviar a aprobación.`, "error"); return; }
    }
    setGuardando(true);
    try {
    const ls: Omit<OrdenLinea, "id" | "cantidadRecibida" | "cantidadFacturada">[] = rows.map((r) => ({
      tipo: "articulo", articuloId: r.articuloId, variantCode: r.variantCode || undefined, pedidoLineaId: r.pedidoLineaId, pedidoNumero: r.pedidoNumero,
      descripcion: r.descripcion, cantidad: Number(r.cantidad), unidad: r.unidad, almacen: r.almacen,
      precioUnitario: Number(r.precio), ivaPct: Number(r.iva) || 0, descuentoPct: Number(r.descuento) || 0,
      proyecto: r.proyecto || undefined, taskNo: r.tarea || undefined,
    }));
    for (const c of cargos) {
      if (cargoImporte(c) <= 0) continue;
      ls.push({ tipo: "cargo", chargeNo: c.chargeNo || undefined, chargeMethod: metodoAsig, descripcion: c.descripcion || "CARGO",
        cantidad: Number(c.cantidad) || 1, unidad: "UND", almacen: rows[0].almacen,
        precioUnitario: Number(c.precio) || 0, ivaPct: 13 });
    }
    const orden = await createOrden({ proveedorId, proveedorNo: provSel?.code, proveedorNombre: provSel?.nombre, currencyCode: currency, almacenRecepcion: almacen, observaciones: observaciones.trim() || undefined, notaInterna: notaInterna.trim() || undefined, lineas: ls });
    // La orden YA está creada acá (y ya consumió saldo de las solicitudes). Si el
    // envío a aprobación falla —hoy eso incluye que BC no pueda crear el pedido— no
    // se puede quedar en el formulario: volver a darle al botón crearía una orden
    // nueva. Se va igual al detalle, con el motivo, y desde ahí se reintenta.
    let aviso = ""; let tono: "error" | "info" = "info";
    if (aprobar) {
      try {
        const r = await setOrdenEstado(orden.id, "pendiente_aprobacion");
        if (r?.bcAviso) aviso = r.bcAviso;
      } catch (e: any) { aviso = `La orden quedó guardada como abierta: ${String(e?.message ?? e)}`; tono = "error"; }
    }
    navegandoRef.current = true; // evita que el redirect de borrador-vacío pise el push al detalle
    setBorrador([]);
    if (aviso) toast(aviso, tono);
    else toast(aprobar ? "Orden enviada a aprobación" : `Orden guardada como abierta · ${numeroOrden(orden)}`, "success");
    router.push(`/proveeduria/ordenes/${orden.id}`);
    } catch (e: any) {
      toast(String(e?.message ?? e), "error");
      setGuardando(false);
    }
  }

  return (
    <>
      <main className="page page--wide" style={{ paddingBottom: 120 }}>
        <button type="button" className="back-link" onClick={() => router.push("/proveeduria")}>Volver a materiales</button>
        <div className="page__head">
          <div className="page__title">
            <h1 className="ds-heading">Armar orden de compra</h1>
            <p className="ds-muted">Revisá y ajustá lo que se va a enviar al proveedor.</p>
          </div>
        </div>

        {bcCaido && (
          <div className="ds-callout ds-callout--yellow mb-4" role="status">
            <span className="ds-callout__icon"><IconWarning size={18} /></span>
            <div>
              <div className="ds-callout__title">Business Central no respondió</div>
              <div className="ds-callout__body">
                Los catálogos de <span className="ds-strong">proveedores y almacenes</span> que ves son de respaldo y pueden no coincidir con BC (el de artículos queda vacío). Podés guardar la orden como abierta, pero verificá el proveedor antes de enviarla a aprobación.
              </div>
            </div>
          </div>
        )}

        <Card>
          <h3 className="ds-subtitle" style={{ marginBottom: 16 }}>Datos de la orden</h3>
          <div className="grid-3">
            <Field label="Proveedor" help="Hereda términos y moneda">
              <Combobox items={catProv} value={proveedorId} onChange={(k) => elegirProveedor(k)}
                getKey={(p) => p.id} getLabel={(p) => `${p.code} — ${p.nombre}`}
                getSearch={(p) => `${p.code} ${p.nombre}`} placeholder="Buscar proveedor…" />
            </Field>
            <Field label="Moneda">
              <Select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                <option value="">CRC (colones)</option>
                <option value="USD">USD (dólares)</option>
              </Select>
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
          <div className="row gap-2 wrap mt-4">
            <span className="ds-muted ds-label">Solicitudes en esta orden:</span>
            {pedidosDistintos.map((n) => <Badge key={n} tone="gray">{n}</Badge>)}
          </div>
        </Card>

        {/* Cargos de producto (Item Charge): Transporte, Seguro, etc. Se distribuyen
            por importe entre los artículos al registrar en BC. */}
        <Card className="mt-4">
          <div className="row row--between wrap gap-3" style={{ alignItems: "center", marginBottom: cargos.length ? 12 : 0 }}>
            <div className="col" style={{ gap: 2 }}>
              <span className="ds-subtitle">Cargos de producto</span>
              <span className="ds-muted ds-body-sm">Transporte, seguro, etc. Se reparten entre los artículos según el método elegido.</span>
            </div>
            <div className="row gap-3 wrap" style={{ alignItems: "flex-end" }}>
              {cargos.length > 0 && (
                <div>
                  <span className="ds-label ds-muted" style={{ display: "block", marginBottom: 4 }}>Método de asignación</span>
                  <Select value={metodoAsig} onChange={(e) => setMetodoAsig(e.target.value)}>
                    <option value="Amount">Por importe</option>
                    <option value="Equally">Equitativo (por línea)</option>
                    <option value="Weight">Por peso</option>
                    <option value="Volume">Por volumen</option>
                  </Select>
                </div>
              )}
              <Button variant="outline" size="sm" onClick={addCargo}>+ Agregar cargo</Button>
            </div>
          </div>
          {/* Filas (no tabla): así el desplegable de Tipo no lo recorta el overflow. */}
          {cargos.map((c, i) => (
            <div key={c.key} className="row gap-3 wrap" style={{ alignItems: "flex-end", padding: "12px 0", borderTop: "1.5px solid var(--ds-color-gray-100)" }}>
              <div style={{ flex: "1 1 240px", minWidth: 200 }}>
                <span className="ds-label ds-muted" style={{ display: "block", marginBottom: 4 }}>Tipo de cargo</span>
                <Select value={c.chargeNo} onChange={(e) => onTipoCargo(i, e.target.value)}>
                  <option value="">Flete / transporte</option>
                  {itemCharges.map((ic) => <option key={ic.no} value={ic.no}>{ic.no} · {ic.descripcion}</option>)}
                </Select>
              </div>
              <div>
                <span className="ds-label ds-muted" style={{ display: "block", marginBottom: 4 }}>Cantidad</span>
                <Input type="number" min={0} value={c.cantidad} style={{ width: 96 }} onChange={(e) => setCargo(i, { cantidad: e.target.value })} />
              </div>
              <div>
                <span className="ds-label ds-muted" style={{ display: "block", marginBottom: 4 }}>Precio</span>
                <Input type="number" min={0} value={c.precio} placeholder="0" style={{ width: 130 }} onChange={(e) => setCargo(i, { precio: e.target.value })} />
              </div>
              <div style={{ minWidth: 110, textAlign: "right" }}>
                <span className="ds-label ds-muted" style={{ display: "block", marginBottom: 4 }}>Importe</span>
                <span className="ds-strong">{money(cargoImporte(c) || 0, currency)}</span>
              </div>
              <button type="button" className="icon-btn icon-btn--quitar" title="Quitar cargo" aria-label="Quitar cargo" style={{ marginBottom: 2 }} onClick={() => removeCargo(i)}>×</button>
            </div>
          ))}
        </Card>

        <Card className="mt-4" style={{ padding: 0, overflow: "hidden" }}>
          {/* En una OC armada desde solicitudes SOLO se agregan líneas que alguien ya
              pidió. Material sin solicitud (limpieza, etc.) va por Compra directa. */}
          <div className="row row--between wrap gap-3" style={{ alignItems: "center", padding: "12px 16px", borderBottom: "1.5px solid var(--ds-color-gray-100)", background: "color-mix(in srgb, var(--ds-color-green-100) 6%, var(--ds-tint-base))" }}>
            <div className="col" style={{ gap: 2 }}>
              <span className="ds-strong ds-body-sm">Líneas de la orden</span>
              <span className="ds-muted ds-body-sm">Solo materiales de solicitudes ya hechas. ¿Material sin solicitud? Usá <span className="ds-strong">Compra directa</span>.</span>
              {sinTarea > 0 && (
                <span className="ds-muted ds-body-sm">
                  {sinTarea} línea(s) con obra y <span className="ds-strong">sin tarea</span>: el costo llega a la obra, pero no queda ubicado en su presupuesto.
                </span>
              )}
            </div>
            <Button onClick={() => setAddOpen(true)} disabled={lineasDisponibles.length === 0} title="Sumar líneas pendientes de solicitudes ya hechas">+ De solicitudes{lineasDisponibles.length ? ` (${lineasDisponibles.length})` : ""}</Button>
          </div>
          <div className="ds-table-wrap" style={{ boxShadow: "none" }}>
            <table className="ds-table">
              <thead>
                <tr>
                  <th>Pedido</th><th>Artículo</th><th>Obra / tarea</th>
                  <th className="ds-num">Cantidad</th><th className="ds-num">Precio</th><th className="ds-num">Desc%</th><th className="ds-num">IVA%</th>
                  <th className="ds-num">Importe</th><th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.pedidoLineaId}>
                    <td className="ds-body-sm ds-strong">{r.pedidoNumero}</td>
                    <td><div style={{ maxWidth: 400, minWidth: 240 }} title={`${r.articuloId} — ${r.descripcion}`}><div className="ds-strong ds-body-sm">{r.articuloId}</div><div className="ds-clamp-2">{r.descripcion}</div></div></td>
                    {/* La obra viene de la solicitud y no se toca acá. La TAREA sí:
                        Ingeniería pide el material para una obra, pero contra qué
                        línea del presupuesto va lo decide Proveeduría al comprar.
                        El menú del Combobox va en un portal, así que la tabla no lo
                        recorta aunque la celda sea angosta. */}
                    <td className="ds-body-sm">
                      <div className="ds-muted">{r.almacen || "—"}</div>
                      {r.proyecto && (() => {
                        const ts = tareasDe(r.proyecto);
                        if (!ts) return <div className="ds-muted" style={{ marginTop: 4 }}>tareas…</div>;
                        if (!ts.length) return <div className="ds-muted" style={{ marginTop: 4 }}>sin tareas en BC</div>;
                        return (
                          <div style={{ minWidth: 150, marginTop: 4 }}>
                            <Combobox items={ts} value={r.tarea} onChange={(k) => setRow(r.pedidoLineaId, { tarea: k })}
                              getKey={(t) => t.jobTaskNo} getLabel={(t) => `${t.jobTaskNo} — ${t.descripcion}`}
                              getSearch={(t) => `${t.jobTaskNo} ${t.descripcion}`} placeholder="Elegí tarea…" />
                          </div>
                        );
                      })()}
                    </td>
                    <td className="ds-num">
                      {/* La unidad al lado de la cantidad: "40" solo no dice nada
                          cuando el material se compra por M3, KG o SACO. */}
                      <span className="row gap-2" style={{ justifyContent: "flex-end", alignItems: "baseline" }}>
                        <input className="ds-cell-input" aria-label="Cantidad" type="number" min={0} value={r.cantidad} style={{ width: 70 }} onChange={(e) => setRow(r.pedidoLineaId, { cantidad: e.target.value })} />
                        {/* Con qué unidad se le pide al proveedor. La solicitud llega
                            en la unidad de consumo (GR) y acá se decide si se compra
                            por estañón, cubeta o litro. */}
                        {opcionesFila(r.articuloId, r.unidad).length > 1 ? (
                          <span title={equivFila(r) ?? undefined}>
                            <Select ariaLabel="Unidad de compra" className="ds-select--celda" value={r.unidad}
                              style={{ width: 104 }} onChange={(e) => elegirUnidadFila(r, e.target.value)}>
                              {opcionesFila(r.articuloId, r.unidad).map((u) => <option key={u.code} value={u.code}>{u.code}</option>)}
                            </Select>
                          </span>
                        ) : (
                          <span className="ds-body-sm ds-muted" style={{ whiteSpace: "nowrap" }}
                            title={equivFila(r) ?? undefined}>
                            {r.unidad || "—"}
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="ds-num">
                      <input className="ds-cell-input" aria-label="Precio" type="number" min={0} value={r.precio} style={{ width: 92 }} onChange={(e) => setRow(r.pedidoLineaId, { precio: e.target.value })} />
                      {(() => {
                        const lp = lastPrice(r);
                        if (lp == null) {
                          const aj = refAjena(r);
                          // Rotulada con su unidad y su moneda para que se vea POR QUÉ
                          // no se puede usar tal cual.
                          if (aj) return (
                            <div className="ds-body-sm ds-muted" title="El último precio de BC está en otra unidad o moneda: escribí el precio acordado con el proveedor.">
                              últ. {money(aj.precio, monedaApp(aj.moneda))} / {aj.unidad || "?"}
                            </div>
                          );
                          return <div className="ds-body-sm ds-muted">sin historial</div>;
                        }
                        const up = Number(r.precio) > lp, down = Number(r.precio) < lp;
                        const igual = !up && !down;
                        return (
                          <button type="button" className="link-btn ds-body-sm"
                            title={igual ? "Precio igual al último" : "Usar este último precio"}
                            onClick={() => setRow(r.pedidoLineaId, { precio: String(lp) })}
                            style={{ color: up ? "var(--ds-color-red-200)" : down ? "var(--ds-color-green-200)" : "var(--ds-color-gray-400)", cursor: igual ? "default" : "pointer" }}>
                            últ. {money(lp, currency)} {up ? "↑" : down ? "↓" : "="}
                          </button>
                        );
                      })()}
                    </td>
                    <td className="ds-num"><input className="ds-cell-input" aria-label="Descuento %" type="number" min={0} max={100} value={r.descuento} style={{ width: 64 }} onChange={(e) => setRow(r.pedidoLineaId, { descuento: e.target.value })} /></td>
                    <td className="ds-num"><input className="ds-cell-input" aria-label="IVA %" type="number" min={0} value={r.iva} style={{ width: 64 }} onChange={(e) => setRow(r.pedidoLineaId, { iva: e.target.value })} /></td>
                    <td className="ds-num ds-strong">
                      {money(calcImporte(r) || 0, currency)}
                      {fleteShare(r) > 0 && <div className="ds-body-sm ds-muted" style={{ fontWeight: 400 }}>+ cargos {money(fleteShare(r), currency)}</div>}
                    </td>
                    <td className="ds-num"><button type="button" className="icon-btn" title="Quitar línea" aria-label="Quitar línea" onClick={() => removeRow(r.pedidoLineaId)}>×</button></td>
                  </tr>
                ))}
                {/* Cargos de producto también como líneas (igual que en BC). Se editan
                    arriba en "Cargos de producto"; acá se muestran junto a los artículos. */}
                {cargos.map((c, i) => cargoImporte(c) > 0 ? (
                  <tr key={`cargo-${c.key}`} style={{ background: "color-mix(in srgb, var(--ds-color-yellow) 7%, var(--ds-tint-base))" }}>
                    <td><Badge tone="yellow">Cargo</Badge></td>
                    <td><div style={{ maxWidth: 320, minWidth: 180 }} title={`${c.chargeNo ? `${c.chargeNo} · ` : ""}${c.descripcion}`}>{c.chargeNo && <div className="ds-strong ds-body-sm">{c.chargeNo}</div>}<div className="ds-clamp-2">{c.descripcion}</div></div></td>
                    <td className="ds-muted ds-body-sm">—</td>
                    <td className="ds-num ds-body-sm">{c.cantidad}</td>
                    <td className="ds-num ds-body-sm">{money(Number(c.precio) || 0, currency)}</td>
                    <td className="ds-num ds-muted">—</td>
                    <td className="ds-num ds-body-sm">13</td>
                    <td className="ds-num ds-strong">{money(cargoImporte(c) || 0, currency)}</td>
                    <td className="ds-num"><button type="button" className="icon-btn" title="Quitar cargo" aria-label="Quitar cargo" onClick={() => removeCargo(i)}>×</button></td>
                  </tr>
                ) : null)}
              </tbody>
              {cargosTotal > 0 && (
                <tfoot>
                  <tr><td colSpan={9} className="ds-body-sm ds-muted" style={{ padding: "10px 16px", borderTop: "1.5px solid var(--ds-color-gray-100)" }}>
                    Los cargos ({money(cargosTotal, currency)}) se reparten {
                      metodoAsig === "Equally" ? "en partes iguales entre las líneas"
                      : metodoAsig === "Weight" ? "por peso (lo calcula BC al registrar; no se previsualiza acá)"
                      : metodoAsig === "Volume" ? "por volumen (lo calcula BC al registrar; no se previsualiza acá)"
                      : "proporcional al importe de cada línea"
                    }{previewReparto ? " (mostrado como “+ cargos”)" : ""}.
                  </td></tr>
                </tfoot>
              )}
            </table>
          </div>
        </Card>

        <div className="row mt-6" style={{ justifyContent: "flex-end" }}>
          <div className="totals" style={{ minWidth: 340 }}>
            <div className="totals__row"><span>Subtotal (excl. IVA)</span><span>{money(subtotal, currency)}</span></div>
            <div className="totals__row"><span>Cargos</span><span>{money(cargosTotal, currency)}</span></div>
            <div className="totals__row"><span>IVA</span><span>{money(ivaTotal, currency)}</span></div>
            <div className="totals__row totals__row--grand" style={{ gridColumn: "1 / -1" }}>
              <span>Total</span><span>{money(total, currency)}</span>
            </div>
          </div>
        </div>
      </main>

      <div className="action-bar">
        <div className="action-bar__inner">
          <span className="ds-muted">{rows.length} línea(s) · {pedidosDistintos.length} pedido(s) · <span className="ds-strong">{money(total, currency)}</span></span>
          <div className="row gap-3 action-bar__cta">
            <Button variant="outline" onClick={() => crear(false)} disabled={!puedeCrear || guardando}>Guardar como abierta</Button>
            <Button onClick={() => crear(true)} disabled={!puedeCrear || guardando}>{guardando ? "Enviando…" : "Enviar a aprobación"}</Button>
          </div>
        </div>
      </div>

      {addOpen && (
        <Modal wide title="Agregar de solicitudes pendientes" onClose={() => setAddOpen(false)}
          footer={<Button variant="outline" onClick={() => setAddOpen(false)}>Cerrar</Button>}>
          <p className="ds-muted ds-body-sm" style={{ marginTop: 0 }}>Líneas pendientes por ordenar de solicitudes ya hechas. Se suman a esta orden.</p>
          {lineasDisponibles.length === 0 ? (
            <EmptyState title="No hay líneas pendientes en otras solicitudes." />
          ) : (
            <div className="ds-table-wrap" style={{ boxShadow: "none", maxHeight: 420, overflow: "auto" }}>
              <table className="ds-table">
                <thead>
                  <tr><th>Pedido</th><th>Artículo</th><th>Destino</th><th className="ds-num">Pendiente</th><th /></tr>
                  <tr>
                    <th><input className="ds-cell-input" aria-label="Filtrar por pedido" style={{ width: "100%" }} placeholder="Filtrar…" value={addF.pedido} onChange={(e) => setAddF((f) => ({ ...f, pedido: e.target.value }))} /></th>
                    <th><input className="ds-cell-input" aria-label="Filtrar por artículo" style={{ width: "100%" }} placeholder="Filtrar…" value={addF.articulo} onChange={(e) => setAddF((f) => ({ ...f, articulo: e.target.value }))} /></th>
                    <th><input className="ds-cell-input" aria-label="Filtrar por destino" style={{ width: "100%" }} placeholder="Filtrar…" value={addF.destino} onChange={(e) => setAddF((f) => ({ ...f, destino: e.target.value }))} /></th>
                    <th /><th />
                  </tr>
                </thead>
                <tbody>
                  {lineasDispFiltradas.length === 0 && <tr><td colSpan={5}><div className="empty empty--compact">Ninguna línea coincide con el filtro.</div></td></tr>}
                  {lineasDispFiltradas.map(({ p, l, pend }) => (
                    <tr key={l.id}>
                      <td className="ds-body-sm ds-strong">{p.numero}</td>
                      <td><div style={{ maxWidth: 380, minWidth: 220 }} title={`${l.articuloId} — ${l.descripcion}`}><div className="ds-strong ds-body-sm">{l.articuloId}</div><div className="ds-clamp-2">{l.descripcion}</div></div></td>
                      <td className="ds-muted ds-body-sm">{l.almacen || p.obraCodigo || "—"}</td>
                      <td className="ds-num">{pend} {l.unidad}</td>
                      <td className="ds-num"><Button variant="outline" size="sm" onClick={() => agregarDeSolicitud(p, l, pend)}>Agregar</Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
