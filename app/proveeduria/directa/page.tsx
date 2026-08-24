"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useState } from "react";
import { Badge, Button, Card, Field, Input, Modal, Select, Textarea, useToast } from "@/components/ui";
import { Combobox } from "@/components/combobox";
import { IconWarning } from "@/components/icons";
import { useStore } from "@/lib/store";
import { money, almacenesParaRecepcion, esAlmacenFisico, monedaApp } from "@/lib/helpers";
import { precioEnUnidad, precioEntreUnidades, cantidadEntreUnidades, equivalencia, equivalenciaDeUnidad, mismaMoneda, type UnidadDeItem } from "@/lib/unidad";
import type { OrdenLinea } from "@/lib/types";

// Orden DIRECTA: compra armada por Proveeduría sin partir de una solicitud de
// Ingeniería (material que no vino en ningún pedido). Todas las líneas son
// manuales (pedidoNumero "Manual"); en la lista/detalle se marca como "Directa".
// `unidad` es la de COMPRA (la que BC pone en la línea del pedido y la que factura
// el proveedor); `unidadBase` es la de inventario, solo para explicar la equivalencia.
// `obra`/`tarea` son OPCIONALES y van POR LÍNEA (Job No. + Job Task No. de BC): una
// directa puede mezclar material que entra a bodega con un servicio que se carga a
// una obra (ver comentario en crear()).
interface Row { key: string; articuloId: string; descripcion: string; unidad: string; unidadBase?: string; factorCompra?: number; cantidad: string; precio: string; iva: string; descuento: string; variantCode: string; variantNombre: string; obra: string; obraNombre: string; tarea: string; tareaNombre: string; }
type Variante = { code: string; descripcion: string };
type Obra = { codigo: string; nombre: string };
type Tarea = { jobTaskNo: string; descripcion: string; tipo: string };
// Cargo de producto (Item Charge) a agregar a la orden: tipo (chargeNo del catálogo
// BC), cantidad y precio. chargeNo "" = flete por defecto. Igual que en "nueva".
interface Cargo { key: string; chargeNo: string; descripcion: string; cantidad: string; precio: string; }
const uid = () => Math.random().toString(36).slice(2, 9);

export default function OrdenDirectaPage() {
  const { proveedores, almacenes, createOrden, setOrdenEstado } = useStore();
  const router = useRouter();
  const toast = useToast();

  const qtyId = useId();
  const priceId = useId();
  const [proveedorId, setProveedorId] = useState("");
  const [currency, setCurrency] = useState("");
  const [almacen, setAlmacen] = useState("ALM-GRAL");
  const [observaciones, setObservaciones] = useState("");
  // Comentario para el APROBADOR: interno, no viaja al proveedor.
  const [notaInterna, setNotaInterna] = useState("");
  // Cargos de producto (Item Charge): igual que al armar una orden desde un pedido.
  const [cargos, setCargos] = useState<Cargo[]>([]);
  const [metodoAsig, setMetodoAsig] = useState("Amount"); // Amount|Weight|Volume|Equally
  const [itemCharges, setItemCharges] = useState<{ no: string; descripcion: string }[]>([]);

  // Catálogos en vivo desde Business Central (con respaldo al catálogo seed).
  const [bcProv, setBcProv] = useState<typeof proveedores | null>(null);
  const [itemsBc, setItemsBc] = useState<{ code: string; descripcion: string; unidad: string; unidadBase?: string; factorCompra?: number }[]>([]);
  const [bcAlm, setBcAlm] = useState<typeof almacenes | null>(null);
  const [bcCaido, setBcCaido] = useState(false);
  useEffect(() => {
    fetch("/api/bc/vendors").then((r) => (r.ok ? r.json() : { proveedores: [] }))
      .then((d) => {
        if (Array.isArray(d.proveedores) && d.proveedores.length) setBcProv(d.proveedores);
        else setBcCaido(true);   // se ve el catálogo de respaldo: hay que avisarlo
      }).catch(() => setBcCaido(true));
    // La unidad que se muestra y se guarda es la de COMPRA: este material se pide
    // por ESTAÑON aunque el inventario lo lleve en gramos.
    fetch("/api/bc/items").then((r) => (r.ok ? r.json() : { items: [] })).then((d) => { if (Array.isArray(d.items)) setItemsBc(d.items.map((i: any) => ({ code: i.code, descripcion: i.descripcion, unidad: (i.unidadCompra || i.unidad || "UND"), unidadBase: i.unidad || undefined, factorCompra: i.factorCompra }))); }).catch(() => {});
    fetch("/api/bc/almacenes").then((r) => (r.ok ? r.json() : { almacenes: [] })).then((d) => {
      if (Array.isArray(d.almacenes) && d.almacenes.length) { setBcAlm(d.almacenes); if (!d.almacenes.some((a: any) => a.codigo === "ALM-GRAL")) setAlmacen(d.almacenes[0].codigo); }
    }).catch(() => {});
    // Catálogo de Cargos de producto (Item Charge) de BC para el selector de tipo.
    fetch("/api/bc/itemcharges").then((r) => (r.ok ? r.json() : { itemCharges: [] }))
      .then((d) => { if (Array.isArray(d.itemCharges)) setItemCharges(d.itemCharges); }).catch(() => {});
    // Obras (Jobs) de BC, para poder cargar una línea a una obra. Si no responde,
    // el selector queda vacío y la orden se arma sin obra, como antes.
    fetch("/api/bc/obras").then((r) => (r.ok ? r.json() : { obras: [] }))
      .then((d) => { if (Array.isArray(d.obras)) setObras(d.obras.map((o: any) => ({ codigo: o.codigo, nombre: o.nombre }))); }).catch(() => {});
  }, []);
  const catProv = bcProv ?? proveedores;
  const catAlm = almacenesParaRecepcion(bcAlm ?? almacenes);
  const provSel = catProv.find((x) => x.id === proveedorId);

  const [rows, setRows] = useState<Row[]>([]);
  const [qaCode, setQaCode] = useState(""); const [qaQty, setQaQty] = useState(""); const [qaPrecio, setQaPrecio] = useState("");
  // Último precio de BC del artículo elegido, con la unidad y la moneda a las que
  // corresponde (puede no ser la de esta línea).
  const [qaRef, setQaRef] = useState<{ precio: number; unidad: string; moneda: string; factor?: number } | null>(null);
  // Variantes del artículo elegido (color/medida/etc. en BC). Si el item tiene
  // variantes, hay que elegir una ANTES de agregar la línea (BC la exige).
  const [qaVariantes, setQaVariantes] = useState<Variante[]>([]);
  const [qaVariante, setQaVariante] = useState("");
  const [qaVariantesError, setQaVariantesError] = useState(false);
  // Unidades de cada material tal como están en BC (GR 1, EST 255.000, LT 244,01914…),
  // cacheadas por código. Con esto se elige CON QUÉ unidad se le pide al proveedor
  // en vez de que la app imponga la de compra del catálogo.
  const [unidadesPorItem, setUnidadesPorItem] = useState<Record<string, UnidadDeItem[]>>({});
  // La unidad elegida para la próxima línea. Arranca en la de compra del material.
  const [qaUnidad, setQaUnidad] = useState("");

  // Obra (Job No.) y tarea (Job Task No.) que se le van a poner a la PRÓXIMA línea.
  // Quedan pegadas después de agregar: una orden de servicio a una obra suele traer
  // varias líneas de la misma obra y volver a elegirla en cada una es puro trámite.
  const [obras, setObras] = useState<Obra[]>([]);
  const [qaObra, setQaObra] = useState("");
  const [qaTarea, setQaTarea] = useState("");
  // Tareas por obra, cacheadas: las pide la barra de agregar y también el diálogo
  // que corrige la obra de una línea ya agregada.
  const [tareasPorObra, setTareasPorObra] = useState<Record<string, Tarea[]>>({});
  // Línea cuya obra/tarea se está corrigiendo en el diálogo (null = cerrado).
  const [editObra, setEditObra] = useState<Row | null>(null);
  // Unidad de medida del artículo elegido en "Agregar artículo".
  const qaItem = itemsBc.find((x) => x.code === qaCode);
  const qaEquiv = equivalenciaDeUnidad(unidadesPorItem[qaCode], qaUnidad, qaItem?.unidadBase ?? qaItem?.unidad ?? "")
    // Respaldo mientras la lista de BC no llegó (o la página no está publicada):
    // la equivalencia de la unidad de compra, que es lo que había antes.
    ?? equivalencia({ base: qaItem?.unidadBase ?? "", compra: qaUnidad, factor: qaItem?.factorCompra });
  const variantePendiente = qaVariantes.length > 0 && !qaVariante;

  // Unidades de un material, una sola vez por material. Si BC no las da (página sin
  // publicar), queda [] y la pantalla se queda con la unidad de siempre: el selector
  // no aparece y no se inventa ninguna.
  function cargarUnidades(itemNo: string) {
    const c = (itemNo ?? "").trim();
    if (!c || unidadesPorItem[c]) return;
    fetch(`/api/bc/unidades?item=${encodeURIComponent(c)}`)
      .then((r) => (r.ok ? r.json() : { unidades: [] }))
      .then((d) => setUnidadesPorItem((m) => ({ ...m, [c]: Array.isArray(d.unidades) ? d.unidades : [] })))
      .catch(() => setUnidadesPorItem((m) => ({ ...m, [c]: [] })));
  }
  const unidadesDe = (itemNo: string) => unidadesPorItem[(itemNo ?? "").trim()] ?? [];
  const factorDe = (itemNo: string, code: string) => {
    const c = (code ?? "").trim().toUpperCase();
    return unidadesDe(itemNo).find((u) => u.code.trim().toUpperCase() === c)?.factor;
  };
  // Un precio pasado de una unidad a otra del MISMO material. Primero con la tabla
  // de BC (sabe de todas las unidades); si no llegó, con lo que conoce el catálogo
  // (base <-> compra). Null = no se puede convertir con certeza, y entonces el
  // precio se limpia en vez de quedar en la unidad vieja.
  function precioEnOtraUnidad(itemNo: string, precio: number, desde: string, hasta: string): number | null {
    if (!(precio > 0) || !desde || !hasta) return null;
    if (desde.trim().toUpperCase() === hasta.trim().toUpperCase()) return precio;
    const porTabla = precioEntreUnidades(precio, factorDe(itemNo, desde), factorDe(itemNo, hasta));
    if (porTabla != null) return porTabla;
    const it = itemsBc.find((x) => x.code === itemNo);
    return precioEnUnidad({ precio, unidad: desde, moneda: currency, factor: it?.factorCompra }, hasta, it?.unidadBase ?? "");
  }
  // Cambiar la unidad de la próxima línea: la CANTIDAD y el PRECIO van con ella.
  // Cambiar solo la etiqueta convierte un pedido de 1 estañón en uno de 255.000, y
  // deja un precio por estañón cobrándose por litro. Si algo no se puede convertir
  // con certeza, el precio se limpia en vez de quedar en la unidad vieja.
  function elegirUnidadQa(code: string) {
    const p = Number(qaPrecio) || 0;
    const q = Number(qaQty) || 0;
    const nuevoP = precioEnOtraUnidad(qaCode, p, qaUnidad, code);
    const nuevaQ = cantidadEntreUnidades(q, factorDe(qaCode, qaUnidad), factorDe(qaCode, code));
    setQaUnidad(code);
    if (p > 0) setQaPrecio(nuevoP != null ? String(Number(nuevoP.toFixed(5))) : "");
    if (q > 0 && nuevaQ != null) setQaQty(String(Number(nuevaQ.toFixed(8))));
  }

  // Lo mismo para una línea ya agregada.
  function elegirUnidadFila(r: Row, code: string) {
    const p = Number(r.precio) || 0;
    const q = Number(r.cantidad) || 0;
    const nuevoP = precioEnOtraUnidad(r.articuloId, p, r.unidad, code);
    const nuevaQ = cantidadEntreUnidades(q, factorDe(r.articuloId, r.unidad), factorDe(r.articuloId, code));
    setRow(r.key, {
      unidad: code,
      factorCompra: factorDe(r.articuloId, code),
      ...(p > 0 ? { precio: nuevoP != null ? String(Number(nuevoP.toFixed(5))) : "" } : {}),
      ...(q > 0 && nuevaQ != null ? { cantidad: String(Number(nuevaQ.toFixed(8))) } : {}),
    });
  }
  // La equivalencia de la unidad que tiene la línea ("1 LT = 244,01914 GR").
  const equivFila = (r: Row) =>
    equivalenciaDeUnidad(unidadesDe(r.articuloId), r.unidad, r.unidadBase ?? "")
    ?? equivalencia({ base: r.unidadBase ?? "", compra: r.unidad, factor: r.factorCompra });

  // Tareas de una obra, una sola vez por obra. Solo se ofrecen las de tipo
  // "Posting": las de tipo Heading/Total son rótulos del presupuesto y BC rechaza
  // la línea de compra que apunte a una de ellas. Si la API no manda el tipo, se
  // dejan todas antes que quedarse sin ninguna.
  function cargarTareas(jobNo: string) {
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
  }
  const tareasDe = (jobNo: string) => tareasPorObra[(jobNo ?? "").trim()] ?? [];
  // El Combobox no tiene forma de vaciarse, así que "Sin obra" es una opción más
  // (código ""). Sin ella, elegir una obra por error sería irreversible.
  const obrasConVacio = useMemo(() => [{ codigo: "", nombre: "Sin obra — entra a bodega" }, ...obras], [obras]);
  const etiquetaObra = (o: Obra) => (o.codigo ? `${o.codigo} — ${o.nombre}` : o.nombre);
  const etiquetaTarea = (t: Tarea) => `${t.jobTaskNo} — ${t.descripcion}`;
  const nombreObra = (codigo: string) => obras.find((o) => o.codigo === codigo)?.nombre ?? "";
  const nombreTarea = (jobNo: string, taskNo: string) => tareasDe(jobNo).find((t) => t.jobTaskNo === taskNo)?.descripcion ?? "";
  // Al cambiar la obra hay que soltar la tarea: una tarea pertenece a UNA obra y
  // dejarla puesta manda a BC un Job Task No. que no existe en la obra nueva.
  function elegirObra(codigo: string) { setQaObra(codigo); setQaTarea(""); if (codigo) cargarTareas(codigo); }
  // La obra sin tarea no la acepta BC; solo se exige si las tareas ya cargaron.
  const tareaPendiente = !!qaObra && tareasDe(qaObra).length > 0 && !qaTarea;

  const setRow = (k: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === k ? { ...r, ...patch } : r)));
  const removeRow = (k: string) => setRows((rs) => rs.filter((r) => r.key !== k));
  // Cargos de producto (mismo comportamiento que en "nueva").
  const addCargo = () => setCargos((cs) => [...cs, { key: uid(), chargeNo: "", descripcion: "FLETE / TRANSPORTE", cantidad: "1", precio: "" }]);
  const setCargo = (i: number, patch: Partial<Cargo>) => setCargos((cs) => cs.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  const removeCargo = (i: number) => setCargos((cs) => cs.filter((_, idx) => idx !== i));
  const onTipoCargo = (i: number, chargeNo: string) => { const ic = itemCharges.find((x) => x.no === chargeNo); setCargo(i, { chargeNo, descripcion: ic ? ic.descripcion : "FLETE / TRANSPORTE" }); };
  const cargoImporte = (c: Cargo) => (Number(c.cantidad) || 0) * (Number(c.precio) || 0);
  function agregarLinea() {
    const it = itemsBc.find((x) => x.code === qaCode);
    if (!it || !(Number(qaQty) > 0)) { toast("Elegí un artículo y una cantidad.", "error"); return; }
    if (variantePendiente) { toast("Este artículo tiene variantes: elegí una antes de agregar la línea.", "error"); return; }
    // BC exige la tarea cuando la línea va a una obra (Job Task No. obligatorio si
    // hay Job No.). Si las tareas no cargaron (BC caído) no se bloquea: se avisa en
    // crear() y la orden se arma igual.
    if (tareaPendiente) { toast("Elegí la tarea de la obra: sin ella Business Central no acepta la línea.", "error"); return; }
    const variante = qaVariantes.find((v) => v.code === qaVariante);
    const unidadElegida = qaUnidad || it.unidad;
    setRows((rs) => [...rs, { key: `m-${uid()}`, articuloId: it.code, descripcion: it.descripcion,
      unidad: unidadElegida, unidadBase: it.unidadBase,
      // El factor de la unidad ELEGIDA (no el de la de compra): es el que explica
      // "1 LT = 244,01914 GR" cuando se compró por litro.
      factorCompra: factorDe(it.code, unidadElegida) ?? (unidadElegida === it.unidad ? it.factorCompra : undefined),
      cantidad: String(Number(qaQty)), precio: String(Number(qaPrecio) || 0), iva: "13", descuento: "0", variantCode: qaVariante, variantNombre: variante?.descripcion ?? "",
      obra: qaObra, obraNombre: nombreObra(qaObra), tarea: qaTarea, tareaNombre: nombreTarea(qaObra, qaTarea) }]);
    // La obra y la tarea NO se limpian a propósito (ver el estado): siguen a la vista
    // en la barra, así que es evidente a qué obra va a ir la línea siguiente.
    setQaCode(""); setQaQty(""); setQaPrecio(""); setQaVariantes([]); setQaVariante(""); setQaVariantesError(false);
  }

  const calcImporte = (r: Row) => Number(r.cantidad) * Number(r.precio) * (1 - (Number(r.descuento) || 0) / 100);
  const subtotal = useMemo(() => rows.reduce((s, r) => s + calcImporte(r), 0), [rows]);
  const cargosTotal = cargos.reduce((s, c) => s + cargoImporte(c), 0);
  // El IVA (13%) se aplica a los materiales Y a los cargos, igual que en BC.
  const ivaCargos = cargosTotal * 0.13;
  const ivaTotal = useMemo(() => rows.reduce((s, r) => s + calcImporte(r) * ((Number(r.iva) || 0) / 100), 0), [rows]) + ivaCargos;
  const total = subtotal + cargosTotal + ivaTotal;
  const puedeCrear = !!proveedorId && rows.length > 0;
  const [guardando, setGuardando] = useState(false);

  function elegirProveedor(id: string) {
    setProveedorId(id);
    const p = catProv.find((x) => x.id === id);
    if (p) setCurrency(monedaApp(p.currencyCode));
  }

  async function crear(aprobar: boolean) {
    if (!puedeCrear) { toast("Seleccioná un proveedor y agregá al menos una línea.", "error"); return; }
    // Todo cargo con importe debe tener un TIPO válido (Item Charge de BC): sin tipo,
    // BC rechaza el cargo y la orden queda sin el flete. Se bloquea acá.
    if (cargos.some((c) => cargoImporte(c) > 0 && !c.chargeNo)) {
      toast("Elegí el tipo de cargo (transporte) antes de continuar. Sin tipo, BC no acepta el flete.", "error"); return;
    }
    // Cantidad/precio válidos: con el campo vacío `Number()` da 0 o NaN y la orden
    // se creaba con una cantidad imposible (o el INSERT fallaba con error de SQL).
    const malaCant = rows.find((r) => !(Number(r.cantidad) > 0));
    if (malaCant) { toast(`Poné una cantidad mayor que 0 en "${malaCant.descripcion}".`, "error"); return; }
    const malPrecio = rows.find((r) => !Number.isFinite(Number(r.precio)) || Number(r.precio) < 0);
    if (malPrecio) { toast(`El precio de "${malPrecio.descripcion}" no es un número válido.`, "error"); return; }
    // Última red antes de guardar: si una línea quedó con obra y sin tarea (p. ej.
    // las tareas no habían cargado al agregarla), BC va a rechazarla.
    const sinTarea = rows.find((r) => r.obra && !r.tarea);
    if (sinTarea) { toast(`Falta la tarea de la obra ${sinTarea.obra} en "${sinTarea.descripcion}". Sin ella BC no acepta la línea.`, "error"); return; }
    setGuardando(true);
    try {
      // La obra va POR LÍNEA y es opcional. Sin obra la línea es lo de siempre: el
      // material entra al ALMACÉN de recepción elegido arriba y suma inventario. CON
      // obra, BC la carga como CONSUMO de la obra y el stock NO sube — por eso el
      // campo es explícito y la pantalla lo avisa, en vez de la vieja casilla "Obra"
      // que se usaba a la vez de almacén y de Job No. sin que nadie lo supiera.
      // El almacén de recepción se manda igual: es el locationCode de la línea.
      const ls: Omit<OrdenLinea, "id" | "cantidadRecibida" | "cantidadFacturada">[] = rows.map((r) => ({
        tipo: "articulo", articuloId: r.articuloId, variantCode: r.variantCode || undefined, pedidoNumero: "Manual",
        descripcion: r.descripcion, cantidad: Number(r.cantidad), unidad: r.unidad, almacen,
        precioUnitario: Number(r.precio), ivaPct: Number(r.iva) || 0, descuentoPct: Number(r.descuento) || 0,
        proyecto: r.obra || undefined, taskNo: r.tarea || undefined,
      }));
      for (const c of cargos) {
        if (cargoImporte(c) <= 0) continue;
        ls.push({ tipo: "cargo", chargeNo: c.chargeNo || undefined, chargeMethod: metodoAsig, descripcion: c.descripcion || "CARGO",
          cantidad: Number(c.cantidad) || 1, unidad: "UND", almacen, precioUnitario: Number(c.precio) || 0, ivaPct: 13 });
      }
      const orden = await createOrden({ proveedorId, proveedorNo: provSel?.code, proveedorNombre: provSel?.nombre, currencyCode: currency, almacenRecepcion: almacen, observaciones: observaciones.trim() || undefined, notaInterna: notaInterna.trim() || undefined, lineas: ls });
      if (aprobar) await setOrdenEstado(orden.id, "pendiente_aprobacion");
      toast(`Orden directa ${orden.numero} ${aprobar ? "enviada a aprobación" : "guardada como abierta"}`, "success");
      router.push(`/proveeduria/ordenes/${orden.id}`);
    } catch (e: any) { toast(String(e?.message ?? e), "error"); setGuardando(false); }
  }

  return (
    <>
      <main className="page page--wide" style={{ paddingBottom: 120 }}>
        <button type="button" className="back-link" onClick={() => router.push("/proveeduria/ordenes")}>Volver a órdenes</button>
        <div className="page__head">
          <div className="page__title">
            <div className="row gap-3"><h1 className="ds-heading">Nueva orden directa</h1><Badge tone="yellow">Directa</Badge></div>
            <p className="ds-muted">Compra que no viene de una solicitud de Ingeniería. Agregá los artículos del catálogo directamente.</p>
          </div>
        </div>

        {bcCaido && (
          <div className="ds-callout ds-callout--yellow mb-4" role="status">
            <span className="ds-callout__icon"><IconWarning size={18} /></span>
            <div>
              <div className="ds-callout__title">Business Central no respondió</div>
              <div className="ds-callout__body">
                Los catálogos de <span className="ds-strong">proveedores y almacenes</span> son de respaldo y pueden no coincidir con BC; el de artículos queda vacío, así que no vas a poder agregar líneas del catálogo de BC. Verificá el proveedor antes de enviar la orden a aprobación.
              </div>
            </div>
          </div>
        )}

        <Card>
          <h3 className="ds-subtitle" style={{ marginBottom: 16 }}>Datos de la orden</h3>
          <div className="grid-3">
            <Field label="Proveedor" help="Hereda términos y moneda">
              <Combobox items={catProv} value={proveedorId} onChange={(k) => elegirProveedor(k)}
                getKey={(p) => p.id} getLabel={(p) => `${p.code} — ${p.nombre}`} getSearch={(p) => `${p.code} ${p.nombre}`} placeholder="Buscar proveedor…" />
            </Field>
            <Field label="Moneda">
              <Select value={currency} onChange={(e) => setCurrency(e.target.value)}><option value="">CRC (colones)</option><option value="USD">USD (dólares)</option></Select>
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
          <div className="row wrap gap-2" style={{ alignItems: "flex-end", padding: "12px 16px", borderBottom: "1.5px solid var(--ds-color-gray-100)", background: "color-mix(in srgb, var(--ds-color-green-100) 6%, var(--ds-tint-base))" }}>
            <div style={{ flex: "1 1 280px", minWidth: 220 }}>
              <label className="ds-label ds-muted" style={{ display: "block", marginBottom: 4 }}>Agregar artículo</label>
              <Combobox items={itemsBc} value={qaCode} onChange={(k) => {
                  setQaCode(k);
                  setQaVariantes([]); setQaVariante(""); setQaVariantesError(false);
                  const it = itemsBc.find((x) => x.code === k);
                  setQaPrecio(""); setQaRef(null);
                  // Arranca en la unidad con la que BC compra este material; la lista
                  // completa llega aparte y solo sirve para poder cambiarla.
                  setQaUnidad(it?.unidad ?? "");
                  if (k) {
                    cargarUnidades(k);
                    fetch(`/api/bc/lastprice?item=${encodeURIComponent(k)}&vendor=${encodeURIComponent(provSel?.code ?? "")}`)
                      .then((r) => r.json()).then((d) => {
                        if (!(typeof d.precio === "number" && d.precio > 0)) return;
                        const ref = { precio: d.precio, unidad: String(d.unidad ?? ""), moneda: String(d.moneda ?? ""), factor: d.factor };
                        setQaRef(ref);
                        // Solo se prellena si ese precio corresponde a ESTA unidad y a la
                        // moneda de la orden. Si no, se muestra rotulado y lo escribe
                        // Proveeduría: un costo por gramo en una línea de estañones deja
                        // la orden 255.000 veces más barata.
                        const p = mismaMoneda(ref.moneda, currency)
                          ? precioEnUnidad(ref, it?.unidad ?? ref.unidad, it?.unidadBase ?? ref.unidad)
                          : null;
                        if (p != null) setQaPrecio(String(p));
                      }).catch(() => {});
                    // Variantes del item: si tiene, se exige elegir una antes de agregar.
                    fetch(`/api/bc/variants?item=${encodeURIComponent(k)}`)
                      .then((r) => (r.ok ? r.json() : { variantes: [], disponible: false }))
                      .then((d) => { setQaVariantes(d.variantes ?? []); setQaVariantesError(d.disponible === false); })
                      .catch(() => { setQaVariantes([]); setQaVariantesError(true); });
                  }
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
            {qaVariantes.length > 0 && (
              <div style={{ flex: "0 1 200px", minWidth: 170 }}>
                <label className="ds-label ds-muted" style={{ display: "block", marginBottom: 4 }}>Variante</label>
                <div style={!qaVariante ? { outline: "1.5px solid var(--ds-color-red-100)", borderRadius: 12 } : undefined}>
                  <Combobox items={qaVariantes} value={qaVariante} onChange={(k) => setQaVariante(k)} getKey={(v) => v.code} getLabel={(v) => `${v.code} — ${v.descripcion}`} getSearch={(v) => `${v.code} ${v.descripcion}`} placeholder="Elegí variante…" />
                </div>
              </div>
            )}
            {/* Obra y tarea de la línea (Job No. + Job Task No. de BC). Opcionales: sin
                obra la línea entra a bodega como siempre. Se quedan puestas después
                de agregar, así que se ve a qué obra va a ir la línea siguiente. */}
            <div style={{ flex: "0 1 240px", minWidth: 190 }}>
              <label className="ds-label ds-muted" style={{ display: "block", marginBottom: 4 }}>Obra <span className="ds-body-sm">(opcional)</span></label>
              <Combobox items={obrasConVacio} value={qaObra} onChange={(k) => elegirObra(k)}
                getKey={(o) => o.codigo} getLabel={etiquetaObra} getSearch={(o) => `${o.codigo} ${o.nombre}`} placeholder="Sin obra…" />
            </div>
            {qaObra && (
              <div style={{ flex: "0 1 230px", minWidth: 180 }}>
                <label className="ds-label ds-muted" style={{ display: "block", marginBottom: 4 }}>Tarea</label>
                <div style={tareaPendiente ? { outline: "1.5px solid var(--ds-color-red-100)", borderRadius: 12 } : undefined}>
                  <Combobox items={tareasDe(qaObra)} value={qaTarea} onChange={(k) => setQaTarea(k)}
                    getKey={(t) => t.jobTaskNo} getLabel={etiquetaTarea} getSearch={(t) => `${t.jobTaskNo} ${t.descripcion}`}
                    placeholder={tareasDe(qaObra).length ? "Elegí tarea…" : "Sin tareas en BC"} />
                </div>
              </div>
            )}
            <div>
              <label className="ds-label ds-muted" htmlFor={qtyId} style={{ display: "block", marginBottom: 4 }}>Cantidad</label>
              {/* La unidad del artículo elegido, al lado del campo: al escribir "40"
                  hay que saber 40 de qué (UND, M3, SACO…). Aparece al elegir. */}
              <span className="row gap-2" style={{ alignItems: "center" }}>
                <Input id={qtyId} type="number" min={0} value={qaQty} onChange={(e) => setQaQty(e.target.value)} placeholder="0" style={{ width: 90 }} />
                {/* Con qué unidad se le pide al proveedor. Si BC devolvió más de una
                    para este material, se puede elegir (CUB, EST, LT, TANQUETA…);
                    si no, se muestra la de siempre como texto. */}
                {unidadesDe(qaCode).length > 1 ? (
                  <Select ariaLabel="Unidad de compra" value={qaUnidad} onChange={(e) => elegirUnidadQa(e.target.value)} style={{ width: 130 }}>
                    {unidadesDe(qaCode).map((u) => (
                      <option key={u.code} value={u.code}>{u.code}{u.descripcion ? ` · ${u.descripcion}` : ""}</option>
                    ))}
                  </Select>
                ) : (
                  qaUnidad && <span className="ds-body-sm ds-muted" style={{ whiteSpace: "nowrap" }} title={qaEquiv ?? undefined}>{qaUnidad}</span>
                )}
              </span>
              {/* La equivalencia a la vista: "1 EST = 255 000 GR". Sin esto nadie sabe
                  cuánto está pidiendo cuando la unidad de compra no es la de inventario. */}
              {qaEquiv && <div className="ds-body-sm ds-muted" style={{ marginTop: 2 }}>{qaEquiv}</div>}
            </div>
            <div><label className="ds-label ds-muted" htmlFor={priceId} style={{ display: "block", marginBottom: 4 }}>Precio</label><Input id={priceId} type="number" min={0} value={qaPrecio} onChange={(e) => setQaPrecio(e.target.value)} placeholder="0" style={{ width: 110 }} />{qaRef ? <div className="ds-body-sm ds-muted" style={{ marginTop: 2 }}>últ. compra {money(qaRef.precio, monedaApp(qaRef.moneda))}{qaRef.unidad ? ` / ${qaRef.unidad}` : ""}</div> : null}</div>
            <Button variant="outline" onClick={agregarLinea} disabled={!qaCode || !(Number(qaQty) > 0) || variantePendiente || tareaPendiente}>+ Agregar línea</Button>
          </div>
          {qaCode && qaVariantesError && (
            <div role="alert" className="ds-body-sm" style={{ color: "var(--ds-color-red-100)", padding: "0 16px 10px" }}>
              No se pudieron cargar las variantes de este material. Si requiere variante, la orden podría fallar en Business Central.
            </div>
          )}
          {/* Lo que NO es obvio y ya nos mordió una vez: con Job No. la recepción se
              carga como consumo de la obra y el stock no sube. Se dice en la
              pantalla, no en un comentario del código. */}
          {rows.some((r) => r.obra) && (
            <div className="ds-callout mb-4" role="status" style={{ margin: "12px 16px" }}>
              <div>
                <div className="ds-callout__title">Hay líneas cargadas a una obra</div>
                <div className="ds-callout__body">
                  En Business Central esas líneas se registran como <span className="ds-strong">consumo de la obra</span>: el material no suma inventario.
                  Las líneas sin obra sí entran al almacén de recepción elegido arriba.
                </div>
              </div>
            </div>
          )}
          <div className="ds-table-wrap" style={{ boxShadow: "none" }}>
            <table className="ds-table">
              <thead><tr><th>Artículo</th><th>Obra / tarea</th><th className="ds-num">Cantidad</th><th className="ds-num">Precio</th><th className="ds-num">Desc%</th><th className="ds-num">IVA%</th><th className="ds-num">Importe</th><th></th></tr></thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={8}><div className="empty">Sin líneas. Buscá un artículo del catálogo y agregalo.</div></td></tr>}
                {rows.map((r) => (
                  <tr key={r.key}>
                    <td><div className="ds-clamp-2" title={r.descripcion} style={{ maxWidth: 380, minWidth: 240 }}>{r.descripcion}</div><div className="ds-body-sm ds-muted">{r.articuloId}{r.variantCode ? ` · var. ${r.variantCode}${r.variantNombre ? ` (${r.variantNombre})` : ""}` : ""}</div></td>
                    {/* Obra y tarea de ESTA línea. Se corrige en un diálogo y no con
                        dos selectores dentro de la celda: la tabla ya tiene seis
                        campos editables y no le caben dos buscadores más. */}
                    <td>
                      {r.obra ? (
                        <>
                          <div className="ds-body-sm ds-strong" title={r.obraNombre || undefined}>{r.obra}</div>
                          <div className="ds-body-sm ds-muted" title={r.tareaNombre || undefined}>{r.tarea ? `Tarea ${r.tarea}` : "Sin tarea"}</div>
                        </>
                      ) : (
                        <div className="ds-body-sm ds-muted">Bodega</div>
                      )}
                      <button type="button" className="link-btn" onClick={() => { setEditObra(r); if (r.obra) cargarTareas(r.obra); }}>
                        {r.obra ? "Cambiar" : "Asignar obra"}
                      </button>
                    </td>
                    <td className="ds-num">
                      {/* La unidad al lado de la cantidad: "40" solo no dice nada
                          cuando el material se compra por M3, KG o SACO. */}
                      <span className="row gap-2" style={{ justifyContent: "flex-end", alignItems: "baseline" }}>
                        <input className="ds-cell-input" aria-label="Cantidad" type="number" min={0} value={r.cantidad} style={{ width: 70 }} onChange={(e) => setRow(r.key, { cantidad: e.target.value })} />
                        {/* La unidad de la línea se puede corregir acá mismo: al
                            cambiarla, el precio se convierte con ella. */}
                        {unidadesDe(r.articuloId).length > 1 ? (
                          <select className="ds-cell-input" aria-label="Unidad de compra" value={r.unidad}
                            title={equivFila(r) ?? undefined} style={{ width: 92 }}
                            onChange={(e) => elegirUnidadFila(r, e.target.value)}>
                            {unidadesDe(r.articuloId).map((u) => <option key={u.code} value={u.code}>{u.code}</option>)}
                          </select>
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

        {/* Cargos de producto (Item Charge): Transporte, Seguro, etc. Se reparten
            entre los artículos al registrar en BC. Igual que al armar la orden
            desde un pedido de compra. */}
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

        <div className="row mt-6" style={{ justifyContent: "flex-end" }}>
          <div className="totals" style={{ minWidth: 340 }}>
            <div className="totals__row"><span>Subtotal (excl. IVA)</span><span>{money(subtotal, currency)}</span></div>
            <div className="totals__row"><span>Cargos</span><span>{money(cargosTotal, currency)}</span></div>
            <div className="totals__row"><span>IVA</span><span>{money(ivaTotal, currency)}</span></div>
            <div className="totals__row totals__row--grand" style={{ gridColumn: "1 / -1" }}><span>Total</span><span>{money(total, currency)}</span></div>
          </div>
        </div>
      </main>

      {editObra && (
        <Modal title="Obra y tarea de la línea" onClose={() => setEditObra(null)}
          footer={
            <>
              <Button variant="outline" onClick={() => setEditObra(null)}>Cancelar</Button>
              <Button
                disabled={!!editObra.obra && tareasDe(editObra.obra).length > 0 && !editObra.tarea}
                onClick={() => {
                  setRow(editObra.key, { obra: editObra.obra, obraNombre: editObra.obraNombre, tarea: editObra.tarea, tareaNombre: editObra.tareaNombre });
                  setEditObra(null);
                }}>Guardar</Button>
            </>
          }>
          <p className="ds-body-sm ds-muted" style={{ marginBottom: 16 }}>{editObra.articuloId} — {editObra.descripcion}</p>
          <Field label="Obra" help="Sin obra, la línea entra al almacén de recepción y suma inventario.">
            <Combobox items={obrasConVacio} value={editObra.obra}
              onChange={(k) => { setEditObra({ ...editObra, obra: k, obraNombre: nombreObra(k), tarea: "", tareaNombre: "" }); if (k) cargarTareas(k); }}
              getKey={(o) => o.codigo} getLabel={etiquetaObra} getSearch={(o) => `${o.codigo} ${o.nombre}`} placeholder="Sin obra…" />
          </Field>
          {editObra.obra && (
            <Field label="Tarea" help="Obligatoria cuando la línea va a una obra: BC no acepta un Job No. sin tarea." className="mt-4">
              <Combobox items={tareasDe(editObra.obra)} value={editObra.tarea}
                onChange={(k) => setEditObra({ ...editObra, tarea: k, tareaNombre: nombreTarea(editObra.obra, k) })}
                getKey={(t) => t.jobTaskNo} getLabel={etiquetaTarea} getSearch={(t) => `${t.jobTaskNo} ${t.descripcion}`}
                placeholder={tareasDe(editObra.obra).length ? "Elegí tarea…" : "Sin tareas en BC"} />
            </Field>
          )}
        </Modal>
      )}

      <div className="action-bar">
        <div className="action-bar__inner">
          <span className="ds-muted">{rows.length} línea(s) · <span className="ds-strong">{money(total, currency)}</span></span>
          <div className="row gap-3 action-bar__cta">
            <Button variant="outline" onClick={() => crear(false)} disabled={!puedeCrear || guardando}>Guardar como abierta</Button>
            <Button onClick={() => crear(true)} disabled={!puedeCrear || guardando}>{guardando ? "Enviando…" : "Enviar a aprobación"}</Button>
          </div>
        </div>
      </div>
    </>
  );
}
