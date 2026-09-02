"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Select, Textarea, useToast, Skeleton } from "@/components/ui";
import { DestinoLinea } from "@/components/destino-linea";
import { AgregarLineasSolicitud } from "@/components/agregar-lineas-solicitud";
import { IconWarning } from "@/components/icons";
import { Combobox } from "@/components/combobox";
import { useStore } from "@/lib/store";
import { money, num, ordenEsDirecta, ordenPedidos, almacenesParaRecepcion, esAlmacenFisico, repartoDeLineaSolicitud, pedidoLineaPendiente, obraParaOrden, ultimoPrecioProveedor, monedaApp, numeroOrden } from "@/lib/helpers";
import { precioEnUnidad, precioEntreUnidades, cantidadEntreUnidades, equivalencia, equivalenciaDeUnidad, mismaMoneda, codigoDeItem, opcionesDeUnidad, type UnidadDeItem } from "@/lib/unidad";
import { useVariantes } from "@/lib/use-variantes";
import type { OrdenLinea } from "@/lib/types";

// OJO con los dos campos de destino, que NO son lo mismo (y estaban pegados en uno):
//   almacen  -> locationCode: DÓNDE entra el material en BC.
//   proyecto -> Project No. (Job): a qué OBRA se carga como consumo. Opcional, y
//               tiene que existir en BC.
interface Row { key: string; articuloId: string; variantCode?: string; descripcion: string; unidad: string; unidadBase?: string; factorCompra?: number; almacen: string; cantidad: string; precio: string; iva: string; descuento: string; proyecto?: string; taskNo?: string; pedidoLineaId?: string; pedidoNumero?: string; }
type Obra = { codigo: string; nombre: string };
type Tarea = { jobTaskNo: string; descripcion: string; tipo: string };
const uid = () => Math.random().toString(36).slice(2, 9);

// Líneas de la orden -> filas editables. Se usa en el estado inicial y al hidratar.
const filasDeOrden = (lineas: OrdenLinea[]): Row[] =>
  lineas.filter((l) => l.tipo === "articulo").map((l) => ({
    key: l.id, articuloId: l.articuloId ?? "", variantCode: l.variantCode, descripcion: l.descripcion, unidad: l.unidad,
    unidadBase: l.unidadBase, factorCompra: l.factorCompra, almacen: l.almacen ?? "",
    cantidad: String(l.cantidad), precio: String(l.precioUnitario), iva: String(l.ivaPct ?? 13), descuento: String(l.descuentoPct ?? 0),
    proyecto: l.proyecto, taskNo: l.taskNo, pedidoLineaId: l.pedidoLineaId, pedidoNumero: l.pedidoNumero,
  }));

// El almacén/centro de costo que comparten las líneas de artículo, o "" si tienen
// varios. Es la única verdad: `almacenRecepcion` del encabezado no se guarda en el
// SQL, así que el selector arrancaba SIEMPRE en ALM-GRAL, y como además no se
// mandaba a ninguna parte, cambiarlo no movía nada ni acá ni en BC.
function almacenComun(lineas: OrdenLinea[]): string {
  const codigos = [...new Set(lineas.filter((l) => l.tipo === "articulo").map((l) => (l.almacen ?? "").trim()))];
  return codigos.length === 1 ? codigos[0] : "";
}

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
  // Obras y sus tareas (Job No. / Job Task No. de BC), para el diálogo de destino.
  const [obras, setObras] = useState<Obra[]>([]);
  const [tareasPorObra, setTareasPorObra] = useState<Record<string, Tarea[]>>({});
  // Línea cuyo destino (obra + tarea) se está corrigiendo (null = cerrado).
  const [editObra, setEditObra] = useState<Row | null>(null);
  // Diálogo para SUMARLE a la orden líneas de solicitud que quedaron pendientes.
  const [addOpen, setAddOpen] = useState(false);
  const [itemCharges, setItemCharges] = useState<{ no: string; descripcion: string }[]>([]);
  useEffect(() => {
    fetch("/api/bc/vendors").then((r) => (r.ok ? r.json() : { proveedores: [] })).then((d) => { if (Array.isArray(d.proveedores) && d.proveedores.length) setBcProv(d.proveedores); }).catch(() => {});
    // Igual que en compra directa: la unidad que manda es la de COMPRA de BC.
    fetch("/api/bc/items").then((r) => (r.ok ? r.json() : { items: [] })).then((d) => { if (Array.isArray(d.items)) setItemsBc(d.items.map((i: any) => ({ code: i.code, descripcion: i.descripcion, unidad: (i.unidadCompra || i.unidad || "UND"), unidadBase: i.unidad || undefined, factorCompra: i.factorCompra }))); }).catch(() => {});
    fetch("/api/bc/almacenes").then((r) => (r.ok ? r.json() : { almacenes: [] })).then((d) => { if (Array.isArray(d.almacenes) && d.almacenes.length) setBcAlm(d.almacenes); }).catch(() => {});
    // Obras (Job No.) para poder CORREGIR el destino de una línea: una orden que se
    // mandó con la obra o la tarea equivocada se arreglaba borrándola y armándola
    // de nuevo, porque acá el destino era solo texto.
    fetch("/api/bc/obras").then((r) => (r.ok ? r.json() : { obras: [] }))
      .then((d) => { if (Array.isArray(d.obras)) setObras(d.obras.map((o: any) => ({ codigo: o.codigo, nombre: o.nombre }))); }).catch(() => {});
    // Tipos de cargo de producto (Item Charge de BC), los mismos que ofrece compra
    // directa: sin esto la pantalla solo sabía decir "flete" y no había forma de ver
    // ni de corregir qué cargo trae la orden.
    fetch("/api/bc/itemcharges").then((r) => (r.ok ? r.json() : { itemCharges: [] }))
      .then((d) => { if (Array.isArray(d.itemCharges)) setItemCharges(d.itemCharges); }).catch(() => {});
  }, []);
  const catProv = bcProv ?? proveedores;
  const catAlm = almacenesParaRecepcion(bcAlm ?? almacenes);

  // Los cargos de producto de la orden. NO son siempre flete: pueden ser impuestos
  // de exterior, servicio de corte, etc. — el tipo lo elige quien arma la orden y es
  // un Item Charge real de BC. Esta pantalla edita EL PRIMERO; si hay más, se
  // conservan tal cual al guardar (antes se perdían).
  const cargos = (orden?.lineas ?? []).filter((l) => l.tipo === "cargo");
  const cargo = cargos[0];
  const [proveedorId, setProveedorId] = useState(orden?.proveedorId ?? "");
  const [currency, setCurrency] = useState(monedaApp(orden?.currencyCode));
  const [flete, setFlete] = useState(cargo ? String(cargo.precioUnitario) : "");
  const [cargoNo, setCargoNo] = useState(cargo?.chargeNo ?? "");
  const [cargoDesc, setCargoDesc] = useState(cargo?.descripcion ?? "");
  const [almacen, setAlmacen] = useState(almacenComun(orden?.lineas ?? []));
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
    setAlmacen(almacenComun(orden.lineas));
    setObservaciones(orden.observaciones ?? "");
    setNotaInterna(orden.notaInterna ?? "");
    const cg = orden.lineas.find((l) => l.tipo === "cargo");
    setFlete(cg ? String(cg.precioUnitario) : "");
    setCargoNo(cg?.chargeNo ?? "");
    setCargoDesc(cg?.descripcion ?? "");
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
  // Deshacer un "Agregar" del diálogo sin salir de él. Solo puede tocar líneas
  // agregadas EN ESA PASADA: el diálogo únicamente lista líneas que al abrirlo NO
  // estaban en la orden, así que no hay forma de que se lleve una vieja.
  const quitarDeSolicitud = (l: { id: string }) => setRows((rs) => rs.filter((r) => r.pedidoLineaId !== l.id));
  function agregarLinea() {
    const it = itemsBc.find((x) => x.code === qaCode);
    if (!it || !(Number(qaQty) > 0)) { toast("Elegí un artículo y una cantidad.", "error"); return; }
    setRows((rs) => [...rs, { key: `m-${uid()}`, articuloId: it.code, descripcion: it.descripcion, unidad: it.unidad, unidadBase: it.unidadBase, factorCompra: it.factorCompra, almacen, cantidad: String(Number(qaQty)), precio: String(Number(qaPrecio) || 0), iva: "13", descuento: "0", pedidoNumero: "Manual" }]);
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
  // Variantes de los materiales de las líneas, en UNA sola llamada para toda la
  // tabla. BC EXIGE la variante en el ítem que la tiene, pero solo lo dice al LANZAR
  // el pedido — o sea que el error le caía al aprobador y acá no había forma de
  // elegirla (venía la que puso Ingeniería, o ninguna).
  const variantes = useVariantes(rows.map((r) => r.articuloId));
  // Con una sola opción se pone sola: no hay nada que elegir y BC la exige igual.
  useEffect(() => {
    setRows((rs) => {
      let cambio = false;
      const out = rs.map((r) => {
        if ((r.variantCode ?? "").trim()) return r;
        const vs = variantes.variantesDe(r.articuloId);
        if (vs.length !== 1) return r;
        cambio = true;
        return { ...r, variantCode: vs[0].code };
      });
      // El MISMO array si no hubo cambios: uno nuevo volvería a disparar el efecto.
      return cambio ? out : rs;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variantes.version, rows]);
  // Tareas de una obra, una sola vez por obra. Solo las de tipo "Posting": las de
  // tipo Heading/Total son rótulos del presupuesto y BC rechaza la línea de compra
  // que apunte a una de ellas. Si la API no manda el tipo, se dejan todas.
  const cargarTareas = (jobNo: string) => {
    const j = (jobNo ?? "").trim();
    if (!j || tareasPorObra[j]) return;
    fetch(`/api/bc/jobtasks?jobNo=${encodeURIComponent(j)}`)
      .then((r) => (r.ok ? r.json() : { jobTasks: [] }))
      .then((d) => {
        const todas: Tarea[] = Array.isArray(d.jobTasks) ? d.jobTasks : [];
        const posting = todas.filter((t) => (t.tipo ?? "").toLowerCase() === "posting");
        setTareasPorObra((m) => ({ ...m, [j]: posting.length ? posting : todas }));
      })
      .catch(() => setTareasPorObra((m) => ({ ...m, [j]: [] })));
  };
  // Las tareas de las obras que las líneas YA traen: así el diálogo abre con la
  // lista puesta y se puede mostrar el nombre de la tarea en la tabla.
  useEffect(() => {
    for (const j of new Set(rows.map((r) => (r.proyecto ?? "").trim()).filter(Boolean))) cargarTareas(j);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);
  const tareasDe = (jobNo: string) => tareasPorObra[(jobNo ?? "").trim()] ?? [];
  // El Combobox no se puede vaciar solo: "Sin obra" es una opción más (código "").
  const obrasConVacio = useMemo(() => [{ codigo: "", nombre: "Sin obra — entra al almacén" }, ...obras], [obras]);
  const etiquetaObra = (o: Obra) => (o.codigo ? `${o.codigo} — ${o.nombre}` : o.nombre);
  const etiquetaTarea = (t: Tarea) => `${t.jobTaskNo} — ${t.descripcion}`;
  const nombreTarea = (jobNo: string, taskNo: string) => tareasDe(jobNo).find((t) => t.jobTaskNo === taskNo)?.descripcion ?? "";
  const nombreObra = (jobNo: string) => obras.find((o) => o.codigo === jobNo)?.nombre ?? "";
  const nombreAlmacen = (cod: string) => catAlm.find((a) => a.codigo === cod)?.nombre ?? "";

  const unidadesDe = (itemNo: string) => unidadesPorItem[codigoDeItem(itemNo)] ?? [];
  const variantesDe = (itemNo: string) => variantes.variantesDe(itemNo);
  // Líneas de ítems que exigen variante y siguen sin elegirla. BC rechaza el
  // lanzamiento con "Variant Code must have a value", así que se frena el guardado
  // acá, donde sí se puede arreglar.
  const sinVariante = rows.filter((r) => variantesDe(r.articuloId).length > 1 && !(r.variantCode ?? "").trim());

  // ---- Partir una línea en varias filas, una por variante -----------------------
  //
  // Lo mismo que al armar la orden: la solicitud pidió "10 PAR" de un zapato que en
  // BC existe por talla y hay que comprar 2 de la 39 y 3 de la 42. Las filas nuevas
  // CONSERVAN el enlace con la línea de solicitud (a diferencia de "+ Agregar
  // artículo", que crea una línea manual y deja el pendiente abierto).
  const lineaDeSolicitud = (pedidoLineaId?: string) => {
    if (!pedidoLineaId) return null;
    for (const p of pedidos) {
      const l = p.lineas.find((x) => x.id === pedidoLineaId);
      if (l) return l;
    }
    return null;
  };
  const filasDe = (pedidoLineaId?: string) => (pedidoLineaId ? rows.filter((r) => r.pedidoLineaId === pedidoLineaId) : []);
  // Cuánto se puede repartir entre las filas de una misma línea de solicitud. Acá el
  // pendiente incluye lo que ESTA orden ya le tiene tomado: al guardar, el saldo se
  // revierte y se vuelve a aplicar (ver updateOrden). `pendiente: null` = no se puede
  // comparar porque alguna línea está en otra unidad de compra.
  function repartoDe(pedidoLineaId?: string) {
    const linea = lineaDeSolicitud(pedidoLineaId);
    const r = repartoDeLineaSolicitud(filasDe(pedidoLineaId), linea);
    if (!linea || r.pendiente == null) return { ...r, pendiente: null as number | null };
    const norm = (u?: string) => (u ?? "").trim().toUpperCase();
    const guardadas = (orden?.lineas ?? []).filter((l) => l.pedidoLineaId === pedidoLineaId);
    if (guardadas.some((l) => norm(l.unidad) !== norm(linea.unidad))) return { ...r, pendiente: null as number | null };
    return { ...r, pendiente: r.pendiente + guardadas.reduce((s, l) => s + l.cantidad, 0) };
  }
  function partirLinea(fila: Row) {
    setRows((rs) => {
      const i = rs.findIndex((x) => x.key === fila.key);
      if (i < 0) return rs;
      const { total, pendiente } = repartoDe(fila.pedidoLineaId);
      const resto = pendiente != null ? Math.max(0, pendiente - total) : 0;
      const nueva: Row = { ...fila, key: `v-${uid()}`, variantCode: "", cantidad: resto > 0 ? String(resto) : "" };
      return [...rs.slice(0, i + 1), nueva, ...rs.slice(i + 1)];
    });
  }
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
  const ivaLineas = useMemo(() => rows.reduce((s, r) => s + calcImporte(r) * ((Number(r.iva) || 0) / 100), 0), [rows]);
  const fleteNum = Number(flete) || 0;
  // El flete conserva SU IVA (el que ya traía la orden; 13% si no tenía cargo). Acá
  // el IVA mostrado lo ignoraba y el total quedaba por debajo del de BC.
  const ivaTotal = ivaLineas + fleteNum * ((cargo?.ivaPct ?? 13) / 100);
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

  // ---- Sumarle líneas de solicitud a una orden que sigue Abierta ---------------
  //
  // El caso real: la solicitud pedía 3 materiales y la orden se armó con 2 (el
  // tercero se dejó para preguntar precio). Mientras la orden esté Abierta —o sea,
  // el pedido en BC todavía no se lanzó; los demás estados ya se frenaron arriba—
  // la línea que faltaba tiene que poder entrar a ESTA orden. Antes no había cómo:
  // "Editar" solo dejaba ajustar y quitar, así que había que armarle otra orden al
  // mismo proveedor y el mismo día.
  //
  // Se ofrecen las líneas pendientes de CUALQUIER solicitud viva (no solo las de
  // origen de la orden), igual que al armarla: si al proveedor se le puede sumar
  // material de otra solicitud, mejor una orden que dos. Las de la propia orden van
  // primero. Artículos SUELTOS siguen fuera de una orden nacida de solicitud: para
  // eso está la orden directa.
  const yaEnOrden = new Set(rows.map((r) => r.pedidoLineaId));
  const esOrigen = new Set(peds);
  const lineasDisponibles = pedidos
    .filter((p) => p.estado === "aprobado" || p.estado === "en_orden")
    .flatMap((p) => p.lineas
      .filter((l) => pedidoLineaPendiente(l) > 0 && !yaEnOrden.has(l.id))
      .map((l) => ({ p, l, pend: pedidoLineaPendiente(l), origen: esOrigen.has(p.numero) })))
    .sort((a, b) => Number(b.origen) - Number(a.origen) || a.p.numero.localeCompare(b.p.numero));
  function agregarDeSolicitud(p: (typeof pedidos)[number], l: (typeof pedidos)[number]["lineas"][number], pend: number) {
    // La obra viaja SOLO si la línea es consumo directo (trae tarea): un Job No. sin
    // tarea lo rechaza BC, y la obra de una compra para stock es informativa.
    const obra = obraParaOrden(l);
    // Precio de arranque: lo último que se le pagó a ESTE proveedor por el material
    // según el historial de la app. Queda en 0 si no hay, para que Proveeduría
    // escriba lo acordado; abajo se pisa con el de BC si se puede convertir.
    const hist = provSel ? ultimoPrecioProveedor(ordenes, l.articuloId, provSel.code) : null;
    const key = `s-${uid()}`;
    setRows((rs) => [...rs, {
      key, articuloId: l.articuloId, variantCode: l.variantCode ?? "", descripcion: l.descripcion,
      unidad: l.unidad, unidadBase: l.unidadBase, factorCompra: l.factorCompra,
      // El almacén de arriba manda al guardar; el de la línea es el que puso quien
      // pidió el material y sirve cuando la orden tiene almacenes distintos.
      almacen: l.almacen,
      cantidad: String(pend), precio: String(hist ?? 0), iva: "13", descuento: "0",
      proyecto: obra || undefined, taskNo: obra ? (l.taskNo || undefined) : undefined,
      pedidoLineaId: l.id, pedidoNumero: p.numero,
    }]);
    if (obra) cargarTareas(obra);
    // Último precio REAL de compra según BC, que es el que manda. Solo se pega si es
    // de la misma moneda y se puede pasar a la unidad de la línea (ver
    // `precioEnUnidad`: un precio por gramo puesto como precio por estañón sería
    // 255.000 veces más barato), y solo si la fila sigue en 0 — si Proveeduría ya
    // escribió el precio negociado, no se le toca.
    fetch(`/api/bc/lastprice?item=${encodeURIComponent(l.articuloId)}&vendor=${encodeURIComponent(provSel?.code ?? "")}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d || !(typeof d.precio === "number" && d.precio > 0)) return;
        if (!mismaMoneda(String(d.moneda ?? ""), currency)) return;
        const ref = { precio: d.precio, unidad: String(d.unidad ?? ""), moneda: String(d.moneda ?? ""), factor: d.factor };
        const pu = precioEnUnidad(ref, l.unidad, l.unidadBase ?? ref.unidad);
        if (!(pu != null && pu > 0)) return;
        setRows((rs) => rs.map((r) => (r.key === key && !(Number(r.precio) > 0) ? { ...r, precio: String(pu) } : r)));
      })
      .catch(() => {});
  }

  async function guardar() {
    if (!proveedorId) { toast("Seleccioná un proveedor.", "error"); return; }
    // Un cargo SIN tipo lo rechaza BC (necesita un Item Charge real): la línea se
    // cae al reescribir el pedido y el aviso llega después, con la orden ya guardada.
    // Mejor cortarlo acá — es la misma regla que ya exige compra directa.
    if (fleteNum > 0 && !cargoNo) {
      toast("Elegí el tipo del cargo de producto (flete, impuestos de exterior, etc.): sin tipo Business Central no lo acepta.", "error");
      return;
    }
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
    // Obra sin tarea: BC no acepta un Job No. sin Job Task No. Solo se exige si las
    // tareas de esa obra ya cargaron (si BC no contesta, no se bloquea el guardado).
    const sinTarea = rows.find((r) => r.proyecto && tareasDe(r.proyecto).length > 0 && !r.taskNo);
    if (sinTarea) { toast(`Elegí la tarea de la obra ${sinTarea.proyecto} en "${sinTarea.descripcion}": sin ella Business Central no acepta la línea.`, "error"); return; }
    // Variante sin elegir: mismo criterio que la tarea. Solo se exige cuando el
    // catálogo de variantes ya cargó y ofrece más de una.
    if (sinVariante.length) { toast(`Elegí la variante de "${sinVariante[0].descripcion}": sin ella Business Central no puede lanzar el pedido.`, "error"); return; }
    // Ordenar MÁS de lo solicitado NO se frena: es el caso real de "entregaron más"
    // (granel), y la orden tiene que reflejar lo que llegó para poder recibirlo y
    // facturarlo. El exceso se muestra en la fila; la decisión es de quien compra.
    setGuardando(true);
    try {
      const ls: Omit<OrdenLinea, "id" | "cantidadRecibida" | "cantidadFacturada">[] = rows.map((r) => ({
        // La variante viaja SIEMPRE: sin esto, editar una orden le borraba el color/
        // medida a la línea en el SQL y la reescribía en BC con la variante vacía.
        tipo: "articulo", articuloId: r.articuloId, variantCode: r.variantCode || undefined,
        pedidoLineaId: r.pedidoLineaId, pedidoNumero: r.pedidoNumero,
        descripcion: r.descripcion, cantidad: Number(r.cantidad), unidad: r.unidad,
        // El almacén de arriba manda sobre todas las líneas (es el punto de
        // "cambiarle el centro de costo a la orden"). Vacío = cada línea se queda
        // con el suyo, que es lo que pasa cuando la orden tiene varios.
        almacen: almacen || r.almacen,
        precioUnitario: Number(r.precio), ivaPct: Number(r.iva) || 0, descuentoPct: Number(r.descuento) || 0,
        // La obra viaja a BC como Project No. y SOLO si la línea de verdad tiene una:
        // antes se caía al almacén, y un "ALM-GRAL" en Project No. hace que BC rechace
        // la reescritura completa del pedido (se quedaba con las líneas viejas).
        proyecto: r.proyecto || undefined, taskNo: r.proyecto ? r.taskNo : undefined,
      }));
      // El cargo se rearma conservando lo que ya tenía la orden (tipo de Item Charge
      // de BC, método de reparto, descripción y cantidad). Antes se reescribía como
      // "FLETE / TRANSPORTE" sin `chargeNo`, y sin tipo BC rechaza el cargo: editar
      // una orden le borraba el tipo que la propia pantalla obliga a elegir.
      if (fleteNum > 0) {
        ls.push({
          tipo: "cargo",
          chargeNo: cargoNo || cargo?.chargeNo,
          chargeMethod: cargo?.chargeMethod,
          descripcion: cargoDesc || cargo?.descripcion || "CARGO",
          cantidad: cargo?.cantidad && cargo.cantidad > 0 ? cargo.cantidad : 1,
          unidad: cargo?.unidad || "UND",
          almacen: almacen || cargo?.almacen || rows[0]?.almacen || "",
          precioUnitario: fleteNum,
          ivaPct: cargo?.ivaPct ?? 13,
        });
      }
      // Cargos del 2.º en adelante: esta pantalla solo edita el primero, así que los
      // demás se reemiten TAL CUAL. Antes se caían al guardar sin decir nada, porque
      // el payload se armaba con un solo cargo.
      for (const c of cargos.slice(1)) {
        ls.push({
          tipo: "cargo", chargeNo: c.chargeNo, chargeMethod: c.chargeMethod,
          descripcion: c.descripcion, cantidad: c.cantidad > 0 ? c.cantidad : 1,
          unidad: c.unidad || "UND", almacen: almacen || c.almacen || "",
          precioUnitario: c.precioUnitario, ivaPct: c.ivaPct ?? 13,
        });
      }
      const r = await updateOrden(orden!.id, { proveedorId, proveedorNo: provSel?.code, proveedorNombre: provSel?.nombre, currencyCode: currency, almacenRecepcion: almacen || undefined, observaciones: observaciones.trim() || undefined, notaInterna: notaInterna.trim() || undefined, lineas: ls });
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
            {/* Mientras la orden no está en BC no tiene número, así que el título
                dice lo que se está haciendo. Con N.º de BC, el título ES el número:
                es el que Angie tiene que poder leer y buscar allá. */}
            <div className="row gap-3">
              <h1 className="ds-heading" title={`N.º interno de la app: ${orden.numero}`}>
                {orden.bcNumber ? `Editar ${orden.bcNumber}` : "Armando orden de compra"}
              </h1>
              <Badge tone="gray">Abierta</Badge>
            </div>
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
            {/* NO es "el flete": es el cargo de producto que traiga la orden, que
                puede ser impuestos de exterior, servicio de corte u otro. Antes esto
                era un campo llamado "Flete / transporte" que mostraba el monto de
                CUALQUIER cargo, así que una orden con Impuestos Exterior se leía como
                si alguien le hubiera puesto un flete que nadie puso — y el tipo no se
                veía ni se podía cambiar (Proveeduría, CP-005254). */}
            <Field label="Cargo de producto" help={cargo ? "El que ya trae la orden. Se distribuye entre las líneas al facturar." : "Opcional (flete, impuestos de exterior, etc.). Se distribuye al facturar."}>
              <Select value={cargoNo} onChange={(e) => {
                const no = e.target.value;
                const ic = itemCharges.find((x) => x.no === no);
                setCargoNo(no);
                // La descripción sigue al tipo, salvo que el usuario ya tenga una
                // propia que no sea el viejo texto por defecto.
                if (ic) setCargoDesc(ic.descripcion);
              }}>
                <option value="">— Sin cargo —</option>
                {/* El tipo que ya trae la orden se ofrece aunque el catálogo de BC no
                    haya cargado (o ya no lo tenga): si no, guardar lo borraría. */}
                {cargo?.chargeNo && !itemCharges.some((ic) => ic.no === cargo.chargeNo) && (
                  <option value={cargo.chargeNo}>{cargo.chargeNo} · {cargo.descripcion ?? ""}</option>
                )}
                {itemCharges.map((ic) => <option key={ic.no} value={ic.no}>{ic.no} · {ic.descripcion}</option>)}
              </Select>
            </Field>
            <Field label={`Monto del cargo${cargoDesc ? ` · ${cargoDesc}` : ""}`}
              help={cargos.length > 1 ? `OJO: esta orden tiene ${cargos.length} cargos. Acá se edita el primero; los otros se conservan como están.` : undefined}
              warning={cargos.length > 1}>
              <Input type="number" min={0} value={flete} onChange={(e) => setFlete(e.target.value)} placeholder="0" />
            </Field>
            <Field label="Almacén / centro de costo de recepción"
              help={almacen
                ? "Dónde entra el material en BC. Al guardar se aplica a TODAS las líneas de la orden."
                : "Las líneas tienen almacenes distintos. Elegí uno solo si querés moverlas todas al mismo; si lo dejás en blanco, cada una se queda con el suyo."}>
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
            <div className="row wrap gap-3" style={{ alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: "1.5px solid var(--ds-color-gray-100)", background: "color-mix(in srgb, var(--ds-color-green-100) 6%, var(--ds-tint-base))" }}>
              <span className="ds-body-sm ds-muted" style={{ flex: "1 1 320px" }}>
                Las líneas provienen de la solicitud ({peds.join(", ")}). Podés ajustar cantidad, precio y descuento, quitar líneas y sumar las que quedaron pendientes por ordenar. Artículos sueltos no: para compras libres usá una <span className="ds-strong">orden directa</span>.
              </span>
              <Button variant="outline" onClick={() => setAddOpen(true)} disabled={lineasDisponibles.length === 0}
                title={lineasDisponibles.length
                  ? "Sumar a esta orden líneas de solicitud que todavía no se ordenaron"
                  : "No quedan líneas de solicitud pendientes por ordenar"}>
                + De solicitudes{lineasDisponibles.length ? ` (${lineasDisponibles.length})` : ""}
              </Button>
            </div>
          )}
          <div className="ds-table-wrap" style={{ boxShadow: "none" }}>
            <table className="ds-table">
              <thead><tr><th>Artículo</th><th>Solicitud</th><th>Destino</th><th className="ds-num">Cantidad</th><th className="ds-num">Precio</th><th className="ds-num">Desc%</th><th className="ds-num">IVA%</th><th className="ds-num">Importe</th><th></th></tr></thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={9}><div className="empty">Sin líneas. Agregá al menos una.</div></td></tr>}
                {rows.map((r) => (
                  <tr key={r.key}>
                    <td>
                      <div className="ds-clamp-2" title={r.descripcion} style={{ maxWidth: 360, minWidth: 220 }}>{r.descripcion}</div>
                      {/* Variante: solo aparece si el ítem la tiene y hay más de una
                          (con una sola ya quedó puesta). BC no deja lanzar el pedido
                          sin ella, así que sin elegir se marca en rojo acá y no allá. */}
                      {variantesDe(r.articuloId).length > 1 && (
                        <div className="row gap-2 wrap" style={{ alignItems: "center", marginTop: 4, maxWidth: 360 }}>
                          <span className="ds-label ds-muted">Variante</span>
                          <span style={!(r.variantCode ?? "").trim() ? { outline: "1.5px solid var(--ds-color-red-100)", borderRadius: 8 } : undefined}>
                            <Select ariaLabel={`Variante de ${r.descripcion}`} className="ds-select--celda"
                              value={r.variantCode ?? ""} onChange={(e) => setRow(r.key, { variantCode: e.target.value })}>
                              <option value="">Elegí…</option>
                              {variantesDe(r.articuloId).map((v) => <option key={v.code} value={v.code}>{v.code} — {v.descripcion}</option>)}
                            </Select>
                          </span>
                          {/* Otra fila del mismo material para pedir otra variante
                              (dos tallas, dos grados), sin perder la solicitud. */}
                          {r.pedidoLineaId && (
                            <button type="button" className="link-btn ds-body-sm" onClick={() => partirLinea(r)}
                              title="Partir la línea: agrega otra fila del mismo material para pedir otra variante. Entre todas no se puede pasar de lo solicitado.">
                              + otra variante
                            </button>
                          )}
                        </div>
                      )}
                      {/* El reparto de la línea partida, y el exceso cuando se ordena
                          más de lo solicitado (que se puede: entregaron más). */}
                      {(() => {
                        const { total, pendiente, unidad } = repartoDe(r.pedidoLineaId);
                        if (pendiente == null) return null;
                        const exceso = total - pendiente;
                        const partida = filasDe(r.pedidoLineaId).length > 1;
                        if (exceso <= 1e-9 && !partida) return null;
                        return (
                          <div className={`ds-body-sm ${exceso > 1e-9 ? "ds-pending-text" : "ds-muted"}`} style={{ marginTop: 2 }}>
                            {exceso > 1e-9
                              ? `${num.format(total)} ${unidad} · ${num.format(exceso)} más de lo solicitado (${num.format(pendiente)})`
                              : `Repartido ${num.format(total)} de ${num.format(pendiente)} ${unidad}`}
                          </div>
                        );
                      })()}
                    </td>
                    <td className="ds-body-sm">{(() => {
                      const pid = pedidoIdDe(r.pedidoLineaId, r.pedidoNumero);
                      if (r.pedidoNumero && pid) return <button type="button" className="linklike" title="Ver la solicitud (quién la pidió)" onClick={() => router.push(`/proveeduria/solicitudes/${pid}`)}>{r.pedidoNumero}</button>;
                      return <span className="ds-muted">{r.pedidoNumero || "—"}</span>;
                    })()}</td>
                    {/* Destino de ESTA línea: UNA cosa sola. Consumo directo de una
                        obra (la línea lleva tarea) -> obra y tarea; compra para stock
                        -> el almacén al que entra. Se corrige en un diálogo: dos
                        buscadores no caben en la celda (la fila ya tiene seis campos).
                        Ver components/destino-linea.tsx. */}
                    <td className="ds-body-sm">
                      {(() => {
                        const alm = almacen || r.almacen || "";
                        return <DestinoLinea
                          almacen={alm} almacenNombre={nombreAlmacen(alm)}
                          obra={r.proyecto} obraNombre={nombreObra(r.proyecto ?? "")}
                          tarea={r.taskNo} tareaNombre={nombreTarea(r.proyecto ?? "", r.taskNo ?? "")} />;
                      })()}
                      <button type="button" className="link-btn" onClick={() => { setEditObra(r); if (r.proyecto) cargarTareas(r.proyecto); }}>
                        {r.proyecto ? "Cambiar obra/tarea" : "Asignar obra"}
                      </button>
                    </td>
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

      {editObra && (
        <Modal title="Obra y tarea de la línea" onClose={() => setEditObra(null)}
          footer={<>
            <Button variant="outline" onClick={() => setEditObra(null)}>Cancelar</Button>
            <Button
              disabled={!!editObra.proyecto && tareasDe(editObra.proyecto).length > 0 && !editObra.taskNo}
              onClick={() => {
                setRow(editObra.key, { proyecto: editObra.proyecto || undefined, taskNo: editObra.proyecto ? (editObra.taskNo || undefined) : undefined });
                setEditObra(null);
              }}>Guardar</Button>
          </>}>
          <p className="ds-body-sm ds-muted" style={{ marginBottom: 16 }}>{[editObra.articuloId, editObra.descripcion].filter(Boolean).join(" — ")}</p>
          <Field label="Obra" help="Con obra, el material se carga como CONSUMO de esa obra y no suma inventario. Sin obra, entra al almacén de recepción.">
            <Combobox items={obrasConVacio} value={editObra.proyecto ?? ""}
              onChange={(k) => { setEditObra({ ...editObra, proyecto: k, taskNo: "" }); if (k) cargarTareas(k); }}
              getKey={(o) => o.codigo} getLabel={etiquetaObra} getSearch={(o) => `${o.codigo} ${o.nombre}`} placeholder="Sin obra…" />
          </Field>
          {/* Casi todas las órdenes viejas traen el código del ALMACÉN copiado en el
              campo Obra (el bug que se arregló en el servidor). Si ese código no
              es una obra de BC, el Combobox de arriba no lo encuentra y sale
              vacío: hay que decir por qué, o parece que la línea no tiene obra. */}
          {!!editObra.proyecto && obras.length > 0 && !obras.some((o) => o.codigo === editObra.proyecto) && (
            <p className="ds-body-sm" style={{ color: "var(--ds-color-red-200)", margin: "8px 0 0" }}>
              La línea trae <span className="ds-strong">{editObra.proyecto}</span>, que no está en el catálogo de obras de
              Business Central (por eso el campo de arriba sale vacío). Elegí la obra real o dejala sin obra: BC rechaza
              el pedido completo si el Project No. no existe.
            </p>
          )}
          {!!editObra.proyecto && (
            <Field label="Tarea" help="Obligatoria cuando la línea va a una obra: BC no acepta un Job No. sin tarea." className="mt-4">
              <Combobox items={tareasDe(editObra.proyecto)} value={editObra.taskNo ?? ""}
                onChange={(k) => setEditObra({ ...editObra, taskNo: k })}
                getKey={(t) => t.jobTaskNo} getLabel={etiquetaTarea} getSearch={(t) => `${t.jobTaskNo} ${t.descripcion}`}
                placeholder={tareasDe(editObra.proyecto).length ? "Elegí tarea…" : "Sin tareas en BC"} />
            </Field>
          )}
        </Modal>
      )}

      {addOpen && (
        <AgregarLineasSolicitud
          lineas={lineasDisponibles}
          yaAgregada={(l) => yaEnOrden.has(l.id)}
          onAgregar={agregarDeSolicitud}
          onQuitar={quitarDeSolicitud}
          onClose={(n) => { setAddOpen(false); if (n > 0) toast(`${n} línea(s) agregada(s) — todavía hay que darle a “Guardar cambios”.`, "success"); }} />
      )}

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
