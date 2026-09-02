"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Select, Textarea, useToast } from "@/components/ui";
import { DestinoLinea } from "@/components/destino-linea";
import { Combobox } from "@/components/combobox";
import { IconCheck, IconWarning } from "@/components/icons";
import { useStore } from "@/lib/store";
import { leerBorrador, guardarBorrador, borrarBorrador, hace, type BorradorOrden } from "@/lib/borrador-orden";
import { money, num, ultimoPrecioProveedor, almacenesParaRecepcion, esAlmacenFisico, pedidoLineaPendiente, repartoDeLineaSolicitud, obraParaOrden, esConsumoDirecto, monedaApp, numeroOrden } from "@/lib/helpers";
import { precioEnUnidad, precioEntreUnidades, cantidadEntreUnidades, equivalencia, equivalenciaDeUnidad, mismaMoneda, codigoDeItem, opcionesDeUnidad, type PrecioRef, type UnidadDeItem } from "@/lib/unidad";
import { useVariantes } from "@/lib/use-variantes";
import type { OrdenLinea } from "@/lib/types";

interface Row {
  // id de la FILA. No alcanza el de la línea de solicitud: una misma línea puede
  // estar en VARIAS filas, una por variante (ver `partirLinea`).
  key: string;
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
  tareaDescr?: string;      // "Enchapes": la trae la solicitud, para no esperar a BC
}

// Obra (Job) y tarea (Job Task) de BC. OJO con los dos campos de destino, que NO
// son lo mismo:
//   almacen  -> locationCode: el centro de costo DONDE entra el material.
//   proyecto -> Project No.: a qué OBRA se carga como consumo (y entonces NO entra
//               al inventario). Solo lo lleva la línea que es consumo directo.
// El almacén NO es una obra: INF-HDAII o F-MAD-NUE son centros de costo. Copiarlo
// al campo obra hacía que la orden pidiera una tarea que la compra para stock no
// tiene por qué dar. La obra la trae la SOLICITUD (la pone quien pide el material)
// o se la asigna Proveeduría acá, línea por línea.
type Obra = { codigo: string; nombre: string };
type Tarea = { jobTaskNo: string; descripcion: string; tipo: string };

// Cargo de producto (Item Charge) a agregar a la orden: tipo (chargeNo del catálogo
// BC), cantidad, precio e IVA%. chargeNo "" = flete por defecto. `key` = id estable
// para React (no usar el índice: al quitar un cargo se corrían los valores).
interface Cargo { key: string; chargeNo: string; descripcion: string; cantidad: string; precio: string; iva: string; }
const cargoUid = () => Math.random().toString(36).slice(2, 9);
const filaUid = () => `f-${Math.random().toString(36).slice(2, 9)}`;

export default function ArmarOrdenPage() {
  const { pedidos, proveedores, ordenes, almacenes, borrador, usuario, createOrden, setOrdenEstado, setBorrador } = useStore();
  const router = useRouter();
  const toast = useToast();

  // RESCATE de lo que se estaba armando. Se lee UNA vez, antes del primer render,
  // porque de acá salen los valores iniciales de todo el formulario. Solo aplica si
  // se entró sin selección (refresh, "atrás", o volver mañana): con líneas recién
  // elegidas en Materiales manda esa selección, no lo guardado.
  const rescateRef = useRef<BorradorOrden<Row> | null | undefined>(undefined);
  if (rescateRef.current === undefined) {
    rescateRef.current = borrador.length === 0 ? leerBorrador<Row>("nueva", usuario) : null;
  }
  const rescate = rescateRef.current;
  const [avisoRescate, setAvisoRescate] = useState<string | null>(
    rescate ? `Seguimos con lo que estabas armando (${hace(rescate.ts, Date.now())}).` : null,
  );

  const [proveedorId, setProveedorId] = useState(rescate?.proveedorId ?? "");
  const [currency, setCurrency] = useState(rescate?.currency ?? "");
  const [cargos, setCargos] = useState<Cargo[]>((rescate?.cargos as Cargo[]) ?? []);
  const [metodoAsig, setMetodoAsig] = useState(rescate?.metodoAsig ?? "Amount"); // Amount|Weight|Volume|Equally
  const [itemCharges, setItemCharges] = useState<{ no: string; descripcion: string }[]>([]);
  const [almacen, setAlmacen] = useState(rescate?.almacen ?? "ALM-GRAL");
  const [observaciones, setObservaciones] = useState(rescate?.observaciones ?? "");
  // Comentario para el APROBADOR: interno, no viaja al proveedor.
  const [notaInterna, setNotaInterna] = useState(rescate?.notaInterna ?? "");

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
  // Catálogo de obras de BC y línea cuyo destino se está cambiando (null = cerrado).
  // Proveeduría puede marcar una línea como consumo de obra aunque la solicitud
  // haya venido para stock: es la única persona que ve la compra completa.
  const [obras, setObras] = useState<Obra[]>([]);
  const [editObra, setEditObra] = useState<Row | null>(null);
  useEffect(() => {
    fetch("/api/bc/obras").then((r) => (r.ok ? r.json() : { obras: [] }))
      .then((d) => { if (Array.isArray(d.obras)) setObras(d.obras.map((o: any) => ({ codigo: o.codigo, nombre: o.nombre }))); })
      .catch(() => { /* sin catálogo, la línea se queda con la obra que traiga */ });
  }, []);

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
  const addCargo = () => setCargos((cs) => [...cs, { key: cargoUid(), chargeNo: "", descripcion: "FLETE / TRANSPORTE", cantidad: "1", precio: "", iva: "13" }]);
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
          // Default solo cuando el usuario todavía no eligió: si venimos de rescatar
          // un borrador, su almacén manda (si no, esto se lo pisaba al cargar BC).
          if (!rescate && !d.almacenes.some((a: any) => a.codigo === "ALM-GRAL")) setAlmacen(d.almacenes[0].codigo);
        }
      })
      .catch(() => { /* sin BC, usa seed */ });
  }, []);
  const catAlm = almacenesParaRecepcion(bcAlm ?? almacenes);

  const [rows, setRows] = useState<Row[]>(() =>
    // Los borradores guardados ANTES de que las filas tuvieran `key` no la traen:
    // se les pone una al rescatarlos (sin esto la fila no se podría ni editar).
    rescate ? rescate.filas.map((f) => (f.key ? f : { ...f, key: filaUid() })) :
    borrador.map((b) => {
      let info: Partial<Row> = { pedidoNumero: "", articuloId: "", variantCode: "", descripcion: "", unidad: "", almacen: "", proyecto: "", tarea: "" };
      for (const p of pedidos) {
        const l = p.lineas.find((x) => x.id === b.pedidoLineaId);
        if (l) { info = { pedidoNumero: p.numero, articuloId: l.articuloId, variantCode: l.variantCode ?? "", descripcion: l.descripcion, unidad: l.unidad, unidadBase: l.unidadBase, factorCompra: l.factorCompra, almacen: l.almacen, proyecto: obraParaOrden(l), tarea: l.taskNo ?? "", tareaDescr: l.taskDescr ?? "" }; break; }
      }
      return {
        key: filaUid(), pedidoLineaId: b.pedidoLineaId, ...info,
        cantidad: String(b.cantidad), precio: String(b.precio), iva: String(b.iva), descuento: "0",
      } as Row;
    })
  );

  // Al entrar sin borrador (nav directa/refresh) volvemos a materiales. PERO no
  // cuando acabamos de crear la orden y estamos navegando a su detalle: ahí
  // vaciamos el borrador a propósito y este redirect pisaba el push al detalle
  // (la orden quedaba creada pero caías en "Materiales" en vez de verla).
  const navegandoRef = useRef(false);
  useEffect(() => {
    // Con un borrador rescatado NO se rebota: es justo el caso que se vino a salvar
    // (se entró sin selección porque se recargó o se salió de la pantalla).
    if (borrador.length === 0 && !rescate && !navegandoRef.current) router.replace("/proveeduria");
  }, [borrador, rescate, router]);

  // Guardado automático de lo que se está armando. Es lo único que evita perder
  // media hora de trabajo al salirse: no toca la base ni BC, es la libreta de quien
  // arma, en su navegador. Se escribe con un respiro para no pegarle al storage en
  // cada tecla del comentario.
  useEffect(() => {
    const t = setTimeout(() => {
      guardarBorrador<Row>("nueva", usuario, {
        proveedorId, currency, almacen, observaciones, notaInterna, metodoAsig, cargos, filas: rows,
      });
    }, 400);
    return () => clearTimeout(t);
  }, [usuario, proveedorId, currency, almacen, observaciones, notaInterna, metodoAsig, cargos, rows]);

  // Tirar lo rescatado y empezar de cero (vuelve a Materiales por el redirect).
  function descartarRescate() {
    borrarBorrador("nueva", usuario);
    setAvisoRescate(null);
    setRows([]);
    setBorrador([]);
    router.replace("/proveeduria");
  }

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

  const setRow = (key: string, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const removeRow = (key: string) => setRows((rs) => rs.filter((r) => r.key !== key));

  // Tareas de las obras que aparecen en las líneas. Se piden solas al entrar: la
  // tarea se elige de una lista, no se escribe, y esperar a que el usuario toque
  // algo para recién ir a buscarla haría que el selector se vea vacío.
  // Solo las de tipo "Posting" admiten movimientos; las Heading/Total son rótulos
  // del presupuesto. Si BC no manda el tipo, se dejan todas.
  const cargarTareas = (jobNo: string) => {
    const j = (jobNo ?? "").trim();
    if (!j || tareasPedidasRef.current.has(j)) return;
    tareasPedidasRef.current.add(j);
    fetch(`/api/bc/jobtasks?jobNo=${encodeURIComponent(j)}`)
      .then((r) => (r.ok ? r.json() : { jobTasks: [] }))
      .then((d) => {
        const todas: Tarea[] = Array.isArray(d.jobTasks) ? d.jobTasks : [];
        const posting = todas.filter((t) => (t.tipo ?? "").toLowerCase() === "posting");
        setTareasPorObra((m) => ({ ...m, [j]: posting.length ? posting : todas }));
      })
      .catch(() => setTareasPorObra((m) => ({ ...m, [j]: [] })));
  };
  useEffect(() => {
    for (const jobNo of new Set(rows.map((r) => r.proyecto).filter(Boolean))) cargarTareas(jobNo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);
  const tareasDe = (jobNo: string) => tareasPorObra[(jobNo ?? "").trim()];
  // El Combobox no se puede vaciar solo: "Sin obra" es una opción más (código "").
  const obrasConVacio = useMemo(() => [{ codigo: "", nombre: "Sin obra — entra al almacén" }, ...obras], [obras]);
  const etiquetaObra = (o: Obra) => (o.codigo ? `${o.codigo} — ${o.nombre}` : o.nombre);
  const etiquetaTarea = (t: Tarea) => `${t.jobTaskNo} — ${t.descripcion}`;
  const nombreTarea = (jobNo: string, taskNo: string) => (tareasDe(jobNo) ?? []).find((t) => t.jobTaskNo === taskNo)?.descripcion ?? "";
  const nombreObra = (jobNo: string) => obras.find((o) => o.codigo === jobNo)?.nombre ?? "";
  const nombreAlmacen = (cod: string) => catAlm.find((a) => a.codigo === cod)?.nombre ?? "";

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
  // Variantes de los materiales de las líneas, en UNA sola llamada para toda la tabla
  // (antes era una por material). BC EXIGE la variante en el ítem que la tiene, pero
  // solo lo dice al LANZAR el pedido: el error le caía al aprobador y acá no había
  // forma de elegirla (llegaba la que puso Ingeniería, o ninguna).
  const variantes = useVariantes(rows.map((r) => r.articuloId));
  const variantesDe = (itemNo: string) => variantes.variantesDe(itemNo);
  // Con UNA sola opción se pone sola: no hay nada que elegir y BC la exige igual.
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
      // Devolver el MISMO array cuando no hay nada que cambiar: uno nuevo volvería a
      // disparar este efecto (rows está en las dependencias) y no pararía nunca.
      return cambio ? out : rs;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variantes.version, rows]);
  const unidadesDe = (itemNo: string) => unidadesPorItem[codigoDeItem(itemNo)] ?? [];
  // Líneas cuyo ítem exige variante y siguen sin elegirla: BC no deja lanzar el
  // pedido así, y esta es la pantalla donde se puede arreglar.
  const sinVariante = rows.filter((r) => variantesDe(r.articuloId).length > 1 && !(r.variantCode ?? "").trim());

  // ---- Partir una línea de solicitud en varias filas, una por variante ----------
  //
  // La solicitud pide "10 PAR" de un zapato que en BC existe por TALLA: con una sola
  // fila hay que elegir una talla para las 10. Partiéndola se piden 2 de la 39 y 3 de
  // la 42 sin tocar la solicitud y sin recurrir a una línea manual (que pierde el
  // enlace con quien pidió el material). Varias líneas de orden contra la misma línea
  // de solicitud ya las soportan la base y el saldo (se suman antes de descontar).
  const lineaDeSolicitud = (pedidoLineaId: string) => {
    for (const p of pedidos) {
      const l = p.lineas.find((x) => x.id === pedidoLineaId);
      if (l) return l;
    }
    return null;
  };
  const filasDe = (pedidoLineaId: string) => rows.filter((r) => r.pedidoLineaId === pedidoLineaId);
  const repartoDe = (pedidoLineaId: string) =>
    repartoDeLineaSolicitud(filasDe(pedidoLineaId), lineaDeSolicitud(pedidoLineaId));
  function partirLinea(r: Row) {
    setRows((rs) => {
      const i = rs.findIndex((x) => x.key === r.key);
      if (i < 0) return rs;
      // La fila nueva arranca con lo que quede sin repartir del pendiente; si ya está
      // todo repartido, vacía (la cantidad se le quita a la fila de arriba).
      const { total, pendiente } = repartoDeLineaSolicitud(
        rs.filter((x) => x.pedidoLineaId === r.pedidoLineaId), lineaDeSolicitud(r.pedidoLineaId));
      const resto = pendiente != null ? Math.max(0, pendiente - total) : 0;
      const nueva: Row = { ...r, key: filaUid(), variantCode: "", cantidad: resto > 0 ? String(resto) : "" };
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
  // Cambiar con qué unidad se compra esta línea. La cantidad y el precio se
  // convierten con ella: la solicitud pidió 255.000 GR, que son 1 EST, no 255.000.
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
  // Líneas de CONSUMO DE OBRA a las que todavía les falta la tarea. Se avisa arriba
  // de la tabla y frena el envío a aprobación (BC no acepta un Job No. sin tarea),
  // pero no impide guardar el borrador.
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
      key: filaUid(), pedidoNumero: p.numero, pedidoLineaId: l.id, articuloId: l.articuloId, variantCode: l.variantCode ?? "",
      descripcion: l.descripcion, unidad: l.unidad, unidadBase: l.unidadBase, factorCompra: l.factorCompra, almacen: l.almacen,
      cantidad: String(pend), precio: String(hist || 0), iva: "13", descuento: "0",
      proyecto: obraParaOrden(l), tarea: l.taskNo ?? "", tareaDescr: l.taskDescr ?? "",
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
  // El IVA se aplica a los materiales Y al flete/cargo, igual que en BC, pero POR
  // CARGO: 13% por defecto y editable. Primero el cargo iba sin IVA (faltaba el 13%
  // del flete); después con el 13% fijo, que le inventaba IVA a los cargos exentos.
  const ivaCargos = cargos.reduce((s, c) => s + cargoImporte(c) * ((Number(c.iva) || 0) / 100), 0);
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
    // Pedir MÁS de lo solicitado NO se frena: pasa de verdad y es legítimo. El
    // proveedor de granel entrega lo que le cabe a la góndola (se pidieron 25.000 KG
    // de cemento y Holcim descargó 27.100), y la orden tiene que reflejar lo que va a
    // llegar para que Bodega pueda recibirlo y Contabilidad calce la factura. Lo que
    // corresponde es DECIRLO —el exceso se ve en la fila, ver `repartoDe`— no impedirlo.
    // (El modelo lo tolera desde siempre: el % ordenado de la solicitud topa en 100.)
    // Precio obligatorio para enviar a aprobación: ninguna línea puede ir a BC en 0.
    if (aprobar) {
      const sinPrecio = rows.filter((r) => !(Number(r.precio) > 0)).length;
      if (sinPrecio) { toast(`${sinPrecio} línea(s) sin precio. Poné el precio acordado antes de enviar a aprobación.`, "error"); return; }
      // Obra sin tarea: BC rechaza el pedido ENTERO, y ahora el pedido se crea al
      // enviar. Solo se exige si las tareas de esa obra ya cargaron: si BC no
      // contestó, no se bloquea el envío por algo que no se pudo verificar.
      const faltaTarea = rows.find((r) => r.proyecto && (tareasDe(r.proyecto) ?? []).length > 0 && !r.tarea);
      if (faltaTarea) { toast(`Elegí la tarea de la obra ${faltaTarea.proyecto} en "${faltaTarea.descripcion}": sin ella Business Central no acepta la línea.`, "error"); return; }
      // Variante sin elegir: mismo criterio que la tarea. BC no puede LANZAR un
      // pedido con una línea así, y el error saldría ya en manos del aprobador.
      if (sinVariante.length) { toast(`Elegí la variante de "${sinVariante[0].descripcion}": sin ella Business Central no puede lanzar el pedido.`, "error"); return; }
    }
    setGuardando(true);
    try {
    // El almacén de cada línea es el que puso quien pidió el material. Cuando la
    // solicitud vino SIN almacén, cae al que está elegido arriba en vez de viajar
    // vacío: sin locationCode BC crea y lanza el pedido igual y el material no entra a
    // ningún lado — y eso termina con Proveeduría rehaciendo el pedido allá, que es
    // lo que deja la orden huérfana (CP-004719, ago 2026).
    const ls: Omit<OrdenLinea, "id" | "cantidadRecibida" | "cantidadFacturada">[] = rows.map((r) => ({
      tipo: "articulo", articuloId: r.articuloId, variantCode: r.variantCode || undefined, pedidoLineaId: r.pedidoLineaId, pedidoNumero: r.pedidoNumero,
      descripcion: r.descripcion, cantidad: Number(r.cantidad), unidad: r.unidad, almacen: r.almacen || almacen,
      precioUnitario: Number(r.precio), ivaPct: Number(r.iva) || 0, descuentoPct: Number(r.descuento) || 0,
      proyecto: r.proyecto || undefined, taskNo: r.tarea || undefined,
    }));
    for (const c of cargos) {
      if (cargoImporte(c) <= 0) continue;
      ls.push({ tipo: "cargo", chargeNo: c.chargeNo || undefined, chargeMethod: metodoAsig, descripcion: c.descripcion || "CARGO",
        cantidad: Number(c.cantidad) || 1, unidad: "UND", almacen: rows[0].almacen || almacen,
        precioUnitario: Number(c.precio) || 0, ivaPct: Number(c.iva) || 0 });
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
    borrarBorrador("nueva", usuario);   // ya es una orden de verdad: no hay nada que rescatar
    if (aviso) toast(aviso, tono);
    else toast(aprobar ? "Orden enviada a aprobación" : `Orden guardada como abierta · ${numeroOrden(orden)}`, "success");
    // REPLACE, no push: el formulario NO puede quedar en el historial. Con `push`,
    // el "Volver" del detalle (y el atrás del navegador) devolvían al formulario de
    // armado — que rebota a materiales, o peor, rescata el borrador y parece que la
    // orden recién creada sigue a medio hacer. Con `replace` el atrás lleva a la
    // lista (o a la solicitud) de donde se venía.
    router.replace(`/proveeduria/ordenes/${orden.id}`);
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

        {/* Se recuperó lo que había quedado a medio armar. Se dice SIEMPRE: si no,
            alguien que entra a hacer una orden nueva se encuentra líneas viejas y no
            entiende de dónde salieron. */}
        {avisoRescate && (
          <div className="ds-callout mb-4" role="status">
            <span className="ds-callout__icon"><IconCheck size={18} /></span>
            <div>
              <div className="ds-callout__title">{avisoRescate}</div>
              <div className="ds-callout__body">
                Se guarda solo en esta computadora mientras armás: <span className="ds-strong">todavía no es una orden</span>.
                Lo será cuando la guardes como abierta o la envíes a aprobación.{" "}
                <button type="button" className="link-btn" onClick={descartarRescate}>Descartar y empezar de cero</button>
              </div>
            </div>
          </div>
        )}

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
              {/* IVA del cargo: 13% por defecto, pero editable. Hay cargos exentos
                  (p. ej. "Impuestos Exterior"), y antes el 13% estaba fijo en el
                  código: el total inventaba un IVA que BC no iba a cobrar. */}
              <div>
                <span className="ds-label ds-muted" style={{ display: "block", marginBottom: 4 }}>IVA %</span>
                <Input type="number" min={0} max={100} value={c.iva} placeholder="0" style={{ width: 96 }} onChange={(e) => setCargo(i, { iva: e.target.value })} />
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
                  {sinTarea} línea(s) de consumo de obra <span className="ds-strong">sin tarea</span>: elegila en “Cambiar obra/tarea”. Business Central no acepta una obra sin tarea.
                </span>
              )}
            </div>
            <Button onClick={() => setAddOpen(true)} disabled={lineasDisponibles.length === 0} title="Sumar líneas pendientes de solicitudes ya hechas">+ De solicitudes{lineasDisponibles.length ? ` (${lineasDisponibles.length})` : ""}</Button>
          </div>
          <div className="ds-table-wrap" style={{ boxShadow: "none" }}>
            <table className="ds-table">
              <thead>
                <tr>
                  <th>Pedido</th><th>Artículo</th><th>Destino</th>
                  <th className="ds-num">Cantidad</th><th className="ds-num">Precio</th><th className="ds-num">Desc%</th><th className="ds-num">IVA%</th>
                  <th className="ds-num">Importe</th><th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key}>
                    <td className="ds-body-sm ds-strong">{r.pedidoNumero}</td>
                    <td>
                      <div style={{ maxWidth: 400, minWidth: 240 }} title={`${r.articuloId} — ${r.descripcion}`}><div className="ds-strong ds-body-sm">{r.articuloId}</div><div className="ds-clamp-2">{r.descripcion}</div></div>
                      {/* Variante: solo si el ítem tiene más de una (con una sola ya
                          quedó puesta). BC no lanza el pedido sin ella, así que se
                          marca acá y no en manos del aprobador. */}
                      {variantesDe(r.articuloId).length > 1 && (
                        <div className="row gap-2 wrap" style={{ alignItems: "center", marginTop: 4, maxWidth: 400 }}>
                          <span className="ds-label ds-muted">Variante</span>
                          <span style={!(r.variantCode ?? "").trim() ? { outline: "1.5px solid var(--ds-color-red-100)", borderRadius: 8 } : undefined}>
                            <Select ariaLabel={`Variante de ${r.descripcion}`} className="ds-select--celda"
                              value={r.variantCode ?? ""} onChange={(e) => setRow(r.key, { variantCode: e.target.value })}>
                              <option value="">Elegí…</option>
                              {variantesDe(r.articuloId).map((v) => <option key={v.code} value={v.code}>{v.code} — {v.descripcion}</option>)}
                            </Select>
                          </span>
                          {/* Una fila más contra la MISMA solicitud, para pedir otra
                              variante del mismo material (dos tallas, dos grados). */}
                          <button type="button" className="link-btn ds-body-sm" onClick={() => partirLinea(r)}
                            title="Partir la línea: agrega otra fila del mismo material para pedir otra variante (p. ej. dos tallas). Entre todas no se puede pasar de lo solicitado.">
                            + otra variante
                          </button>
                        </div>
                      )}
                      {/* Cómo va la línea contra lo que se pidió: el reparto cuando
                          está partida por variante, y el exceso cuando se ordena más
                          (que se puede: el proveedor de granel entrega de más). */}
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
                    {/* Destino de ESTA línea: UNA cosa sola. Si el ingeniero la pidió
                        como CONSUMO DIRECTO (trae tarea), se ve la obra y la tarea; si
                        la pidió a almacén, se ve el almacén que eligió y nada más. Ver
                        components/destino-linea.tsx. La obra la trae la solicitud y acá
                        se puede corregir o asignar en un diálogo. */}
                    <td className="ds-body-sm">
                      <DestinoLinea
                        almacen={r.almacen} almacenNombre={nombreAlmacen(r.almacen)}
                        obra={r.proyecto} obraNombre={nombreObra(r.proyecto)}
                        tarea={r.tarea} tareaNombre={nombreTarea(r.proyecto, r.tarea) || r.tareaDescr} />
                      <button type="button" className="link-btn" onClick={() => { setEditObra(r); if (r.proyecto) cargarTareas(r.proyecto); }}>
                        {r.proyecto ? "Cambiar obra/tarea" : "Asignar obra"}
                      </button>
                    </td>
                    <td className="ds-num">
                      {/* La unidad al lado de la cantidad: "40" solo no dice nada
                          cuando el material se compra por M3, KG o SACO. */}
                      <span className="row gap-2" style={{ justifyContent: "flex-end", alignItems: "baseline" }}>
                        <input className="ds-cell-input" aria-label="Cantidad" type="number" min={0} value={r.cantidad} style={{ width: 70 }} onChange={(e) => setRow(r.key, { cantidad: e.target.value })} />
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
                      <input className="ds-cell-input" aria-label="Precio" type="number" min={0} value={r.precio} style={{ width: 92 }} onChange={(e) => setRow(r.key, { precio: e.target.value })} />
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
                            onClick={() => setRow(r.key, { precio: String(lp) })}
                            style={{ color: up ? "var(--ds-color-red-200)" : down ? "var(--ds-color-green-200)" : "var(--ds-color-gray-400)", cursor: igual ? "default" : "pointer" }}>
                            últ. {money(lp, currency)} {up ? "↑" : down ? "↓" : "="}
                          </button>
                        );
                      })()}
                    </td>
                    <td className="ds-num"><input className="ds-cell-input" aria-label="Descuento %" type="number" min={0} max={100} value={r.descuento} style={{ width: 64 }} onChange={(e) => setRow(r.key, { descuento: e.target.value })} /></td>
                    <td className="ds-num"><input className="ds-cell-input" aria-label="IVA %" type="number" min={0} value={r.iva} style={{ width: 64 }} onChange={(e) => setRow(r.key, { iva: e.target.value })} /></td>
                    <td className="ds-num ds-strong">
                      {money(calcImporte(r) || 0, currency)}
                      {fleteShare(r) > 0 && <div className="ds-body-sm ds-muted" style={{ fontWeight: 400 }}>+ cargos {money(fleteShare(r), currency)}</div>}
                    </td>
                    <td className="ds-num"><button type="button" className="icon-btn" title="Quitar línea" aria-label="Quitar línea" onClick={() => removeRow(r.key)}>×</button></td>
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
                    <td className="ds-num ds-body-sm">{Number(c.iva) || 0}</td>
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

      {editObra && (
        <Modal title="Obra y tarea de la línea" onClose={() => setEditObra(null)}
          footer={<>
            <Button variant="outline" onClick={() => setEditObra(null)}>Cancelar</Button>
            <Button
              disabled={!!editObra.proyecto && (tareasDe(editObra.proyecto) ?? []).length > 0 && !editObra.tarea}
              onClick={() => {
                setRow(editObra.key, { proyecto: editObra.proyecto || "", tarea: editObra.proyecto ? editObra.tarea : "", tareaDescr: "" });
                setEditObra(null);
              }}>Guardar</Button>
          </>}>
          <p className="ds-body-sm ds-muted" style={{ marginBottom: 16 }}>{[editObra.articuloId, editObra.descripcion].filter(Boolean).join(" — ")}</p>
          <Field label="Obra" help="Con obra, el material se carga como CONSUMO de esa obra y no suma inventario. Sin obra, entra al almacén / centro de costo de la línea.">
            <Combobox items={obrasConVacio} value={editObra.proyecto}
              onChange={(k) => { setEditObra({ ...editObra, proyecto: k, tarea: "" }); if (k) cargarTareas(k); }}
              getKey={(o) => o.codigo} getLabel={etiquetaObra} getSearch={(o) => `${o.codigo} ${o.nombre}`} placeholder="Sin obra…" />
          </Field>
          {/* Si la línea arrastra un código que BC no conoce como obra (el almacén
              copiado al campo obra, que es como se hacía antes), el Combobox de
              arriba sale vacío: hay que decir por qué o parece que no tiene obra. */}
          {!!editObra.proyecto && obras.length > 0 && !obras.some((o) => o.codigo === editObra.proyecto) && (
            <p className="ds-body-sm" style={{ color: "var(--ds-color-red-200)", margin: "8px 0 0" }}>
              La línea trae <span className="ds-strong">{editObra.proyecto}</span>, que no está en el catálogo de obras de
              Business Central (por eso el campo de arriba sale vacío). Elegí la obra real o dejala sin obra: BC rechaza
              el pedido completo si el Project No. no existe.
            </p>
          )}
          {!!editObra.proyecto && (
            <Field label="Tarea" help="Obligatoria cuando la línea va a una obra: BC no acepta un Job No. sin tarea." className="mt-4">
              <Combobox items={tareasDe(editObra.proyecto) ?? []} value={editObra.tarea}
                onChange={(k) => setEditObra({ ...editObra, tarea: k })}
                getKey={(t) => t.jobTaskNo} getLabel={etiquetaTarea} getSearch={(t) => `${t.jobTaskNo} ${t.descripcion}`}
                placeholder={(tareasDe(editObra.proyecto) ?? []).length ? "Elegí tarea…" : "Sin tareas en BC"} />
            </Field>
          )}
        </Modal>
      )}

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
                      {/* La tarea es lo que hace que la línea sea consumo de obra: con
                          ella se muestra la obra y la tarea, sin ella el almacén al que
                          va el material (la obra de la solicitud es apenas un dato). */}
                      <td className="ds-muted ds-body-sm">
                        <DestinoLinea inline
                          almacen={l.almacen || p.obraCodigo || ""}
                          obra={esConsumoDirecto(l) ? l.proyecto : ""}
                          tarea={l.taskNo} tareaNombre={l.taskDescr} />
                      </td>
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
