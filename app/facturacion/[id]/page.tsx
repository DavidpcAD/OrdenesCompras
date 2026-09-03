"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, Card, Checkbox, EmptyState, Field, Input, Modal, Select, Skeleton, Textarea, useToast } from "@/components/ui";
import { IconWarning } from "@/components/icons";
import { DateField } from "@/components/date-field";
import { useStore } from "@/lib/store";
import { useVolver } from "@/lib/use-volver";
import { esNombreObraVacio, money, distribuirCargo, num, ordenBadge, ordenLineaPendiente, ordenRecibidoPct, todayISO, numeroOrden } from "@/lib/helpers";
import { codigoDeItem } from "@/lib/unidad";
import { comprimirFoto, pesoLegible } from "@/lib/foto";
import type { FotoComprimida } from "@/lib/foto";
import type { MotivoNC, OrdenLinea } from "@/lib/types";

// Resumen que se muestra al terminar de registrar ("cómo quedó en BC").
// `aInventario` es lo que DEBE subir el stock; lo que va a una obra (Job No. en la
// línea) BC lo carga como CONSUMO en el mismo movimiento, así que no sube el stock.
// OJO con las unidades: `antes`/`despues` los devuelve BC en la unidad BASE del
// ítem (gramos), mientras que lo recibido está en la unidad de COMPRA de la línea
// (estañones). Por eso se guarda el factor: sin convertir, el chequeo
// "después = antes + recibido" salía ⚠️ aunque BC hubiera hecho todo bien.
type InvItem = { itemNo: string; desc: string; antes: number | null; recibido: number; aInventario: number; aObra: number; despues?: number | null;
  unidad?: string; unidadBase?: string; factor?: number };
// Material consumido de una vez en una obra (no queda en inventario).
type ConsumoObra = { obra: string; obraNombre?: string; taskNo?: string; itemNo?: string; desc: string; unidad: string; cantidad: number; importe: number };
// Lo que se factura AHORA, línea por línea, con la obra de cada una. Alimenta las
// líneas que viajan a BC y el resumen final (inventario vs. consumo).
type DetalleLinea = { l: OrdenLinea; qty: number; obra: { codigo: string; nombre?: string } | null };
// Por qué dijo NO Business Central, tal como lo diagnostica /api/bc/registrar.
// "reintentable" es el caso de siempre; los otros dos significan que BC YA tiene el
// movimiento y que reintentar no va a servir nunca (ver diagnosticarFalloBc).
type DiagBc = {
  motivo?: "factura-duplicada" | "pedido-no-existe" | "reintentable";
  yaEnBc?: boolean;
  pedido?: "existe" | "no-existe" | "sin-respuesta" | null;
  facturaBc?: { numero: string; vendorNo: string; fecha: string; total: number; estado: string } | null;
};

const MOTIVO_NC: { v: MotivoNC; label: string }[] = [
  { v: "precio_distinto", label: "Precio distinto" },
  { v: "menos_cantidad", label: "Menos cantidad" },
  { v: "danado", label: "Material dañado" },
  // Llegó OTRO artículo (no el de la orden): se recibe y se marca para NC.
  { v: "material_distinto", label: "Material distinto" },
];

// Cuántas fotos de la factura se pueden adjuntar (igual que el límite de la API).
const MAX_FOTOS = 4;

export default function RegistrarFacturaPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  // volver = pantalla anterior, con su filtro (el rótulo se ajusta solo)
  const { volver, etiqueta: volverTexto } = useVolver("/facturacion", "Volver a órdenes por recibir");
  const toast = useToast();
  const { ordenes, pedidos, proveedores, recepciones, registrarRecepcion, guardarFotosRecepcion, marcarNotasCredito, role, cargando } = useStore();
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
  // Confirmación de lo que pasó en BC: stock antes → después (inventario) y el
  // material que se consumió directo en una obra.
  // despues: number = stock BC verificado · null = BC no devolvió · undefined = verificando.
  const [confirmInv, setConfirmInv] = useState<null | { items: InvItem[]; consumo: ConsumoObra[]; bcFacturaNo?: string }>(null);
  // BC rechazó el registro porque YA lo tiene (factura ya registrada allá, o pedido
  // ya completado y por eso borrado). Reintentar no sirve: lo que falta es guardar la
  // recepción en la app, y eso lo decide Bodega acá. Guarda todo lo necesario para
  // terminar el registro sin volver a pasar por BC.
  const [conciliar, setConciliar] = useState<null | {
    diag: DiagBc; error: string; lineas: { ordenLineaId: string; cantidadRecibida: number }[];
    items: string[]; antes: Record<string, number | null>; detalle: DetalleLinea[];
  }>(null);
  // El pedido de la orden NO está en BC (sondeado al abrir la pantalla). No es lo
  // mismo que "BC no contesta": con esto, registrar va a fallar seguro, así que se
  // avisa ANTES de que Bodega llene todo. false mientras no se sepa.
  const [bcSinPedido, setBcSinPedido] = useState(false);
  // El servidor comprobó contra BC que una o más líneas de esta factura NO se
  // pueden registrar allá (el pedido no las tiene, la variante no calza, o no
  // queda saldo). Es un aviso que se QUEDA: el codeunit de BC se salta esas líneas
  // sin decir nada, y así se registró CP-005172 con ₡22.820 de menos.
  // Los tres frenos que el servidor comprueba contra BC antes de mover un peso:
  // "lineas" (no están en el pedido o no hay saldo), "proveedor" (el pedido de allá
  // es de otro proveedor), "no-lanzado" (en BC sigue Abierto) y "dimensiones" (el CC
  // de la línea choca con el que su almacén amarra en BC). Los cuatro se muestran en
  // el MISMO aviso que se queda en pantalla: ninguno se arregla reintentando.
  const [frenoBc, setFrenoBc] = useState<null | { error: string; problemas: string[]; tipo: "lineas" | "proveedor" | "no-lanzado" | "dimensiones" }>(null);
  // Sonda al ABRIR: ¿está el pedido en BC? Si BC contesta que no lo tiene, registrar
  // va a fallar seguro — y es mejor decirlo antes de que Bodega cuente el camión
  // entero. "BC no contesta" NO cuenta como ausencia (eso se arregla solo), por eso
  // se mira `motivo` y no la falta de totales.
  useEffect(() => {
    const bcNo = orden?.bcNumber;
    if (!bcNo) { setBcSinPedido(false); return; }
    let vivo = true;
    fetch(`/api/bc/orden-totales?orderNo=${encodeURIComponent(bcNo)}`)
      .then((r) => r.json())
      .then((d) => { if (vivo) setBcSinPedido(d?.motivo === "no-existe"); })
      .catch(() => { /* BC no contesta: no se avisa nada */ });
    return () => { vivo = false; };
  }, [orden?.bcNumber]);

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
  // Foto de la factura física: se comprime en el navegador (lib/foto.ts) y se
  // guarda con la recepción. Es respaldo para Contabilidad, no bloquea nada.
  const [fotos, setFotos] = useState<FotoComprimida[]>([]);
  const [fotoOcupado, setFotoOcupado] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  async function elegirFotos(files: FileList | null) {
    if (!files?.length) return;
    const libres = MAX_FOTOS - fotos.length;
    if (libres <= 0) { toast(`Ya adjuntaste el máximo de ${MAX_FOTOS} fotos.`, "error"); return; }
    setFotoOcupado(true);
    try {
      const nuevas: FotoComprimida[] = [];
      for (const f of Array.from(files).slice(0, libres)) nuevas.push(await comprimirFoto(f));
      setFotos((p) => [...p, ...nuevas]);
    } catch (e: any) {
      toast(String(e?.message ?? e), "error");
    } finally {
      setFotoOcupado(false);
      if (fileRef.current) fileRef.current.value = "";   // permite volver a elegir el mismo archivo
    }
  }
  // Sube las fotos de una recepción ya registrada. Nunca lanza: devuelve el
  // texto que se le agrega al toast (la recepción ya quedó hecha).
  async function subirFotos(recepcionId: string): Promise<string> {
    if (!fotos.length) return "";
    try {
      const n = await guardarFotosRecepcion(recepcionId, fotos);
      return n ? ` · ${n} foto(s) de la factura guardada(s)` : "";
    } catch (e: any) {
      return ` · OJO: la foto de la factura NO se guardó (${String(e?.message ?? e)})`;
    }
  }

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

  // Obra de una línea = su Job No., y NADA MÁS. Es lo único que hace que BC cargue el
  // material como CONSUMO de la obra en lugar de meterlo al inventario.
  //
  // Antes, si la línea no traía Job No. se caía al destino de la solicitud. Pero ese
  // destino es el ALMACÉN / centro de costo (INF-HDAII, F-MAD-NUE): con eso, una
  // compra para stock salía en el resumen como "consumido en obra" y encima se
  // saltaba la verificación de existencias, que es justo la línea que hay que
  // verificar. Desde que la orden distingue almacén de obra, no hay nada que adivinar.
  const obraDeLinea = (l: OrdenLinea): { codigo: string; nombre?: string } | null => {
    const codigo = (l.proyecto ?? "").trim();
    if (!codigo) return null;
    const ped = pedidos.find((p) =>
      (l.pedidoLineaId && p.lineas.some((pl) => pl.id === l.pedidoLineaId)) ||
      (!!l.pedidoNumero && p.numero === l.pedidoNumero));
    // El nombre de obra suele venir "POR DEFINIR" de BC: en ese caso no se muestra.
    const nombre = ped && (ped.obraCodigo ?? "").trim() === codigo && !esNombreObraVacio(ped.obraNombre)
      ? ped.obraNombre?.trim() : undefined;
    return { codigo, nombre };
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
    // Detalle de lo que se factura ahora, con la obra de cada línea: alimenta tanto
    // las líneas que viajan a BC como el resumen final (inventario vs. consumo).
    const detalle = articulo
      .filter((l) => Number(recibir[l.id] || 0) > 0 && l.articuloId)
      .map((l) => ({ l, qty: Number(recibir[l.id]), obra: obraDeLinea(l) }));
    // Líneas para BC: cantidad recibida en esta factura por item (solo artículos).
    const bcLineas = detalle.map((d) => ({ itemNo: d.l.articuloId as string, qty: d.qty, variantCode: d.l.variantCode }));

    setGuardando(true);
    const items = [...new Set(bcLineas.map((l) => l.itemNo))];
    // ¿Esta orden va a BC? (tiene N.º allá y hay artículos que mandar). Si no va, se
    // guarda solo acá, como siempre.
    if (!orden!.bcNumber || !bcLineas.length) {
      await guardarLocal({
        // Los dos casos se ven MUY distinto y antes salían iguales: sin N.º de BC la
        // orden no va a BC y punto; CON N.º de BC y sin líneas que mandar, lo que pasó
        // es que ninguna línea recibida tiene artículo — y eso hay que decirlo, porque
        // el registro queda solo acá y BC no se entera de nada.
        aviso: orden!.bcNumber
          ? " · OJO: NO se registró nada en BC (ninguna línea recibida tiene artículo). Quedó guardado solo en la app."
          : " · (la orden no tiene N.º de BC, no se registró en BC)",
        bcOk: false, lineas, items, antes: {}, detalle,
      });
      return;
    }
    let aviso = ""; let bcOk = false; let diag: DiagBc | null = null; let bcFacturaNo = "";
    const antes = await stockDeItems(items); // stock ANTES de registrar
    try {
      // Registrar (Recibir + Facturar) en BC con todos sus movimientos contables.
      const r = await fetch("/api/bc/registrar", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderNo: orden!.bcNumber, vendorInvoiceNo: numeroFactura.trim(), lineas: bcLineas, postingDate: fechaRegistro,
          // Solo para poder BUSCAR en BC la factura ya registrada si BC dice que
          // existe, y mostrarle a Bodega cuál es. No cambia lo que se postea.
          vendorNo: orden!.proveedorNo || orden!.proveedorId,
          // Para el freno de proveedor: el servidor lee la orden y coteja contra el
          // encabezado del pedido en BC. Va el id, no el proveedor, porque el freno
          // no puede depender de lo que mande el navegador.
          ordenId: orden!.id,
        }),
      });
      const d = await r.json().catch(() => ({} as any));
      if (r.ok) {
        // BC devuelve el N.º del documento que quedó registrado allá. Cuando el
        // codeunit no lo dice, la ruta cae a "Registrado", que no es un número:
        // eso no se guarda ni se muestra como si lo fuera.
        const posted = String(d.postedNo ?? "").trim();
        bcFacturaNo = posted && !/^(registrado|ok)$/i.test(posted) ? posted : "";
        aviso = ` · registrada en BC (${posted || "OK"})`; bcOk = true;
      }
      else if (d?.frenoLineas || d?.frenoEncabezado || d?.frenoDimensiones) {
        // El servidor comprobó contra BC que esto NO se puede registrar: las líneas
        // no están en el pedido / no queda saldo, el pedido de allá es de OTRO
        // proveedor, o todavía no está lanzado en BC. Ninguno se concilia ni se
        // reintenta a ciegas. Va a un aviso que se queda en pantalla, porque es
        // exactamente el error que se perdía en un toast de 3 segundos.
        setFrenoBc({
          error: String(d.error ?? ""), problemas: (d.problemas ?? []) as string[],
          tipo: d?.frenoDimensiones ? "dimensiones" : d?.frenoNoLanzado ? "no-lanzado" : d?.frenoProveedor ? "proveedor" : "lineas",
        });
        setGuardando(false);
        return;
      }
      else { aviso = ` · NO se pudo registrar en BC: ${d.error ?? r.status}`; diag = d as DiagBc; }
    } catch (e: any) { aviso = ` · BC no disponible: ${String(e?.message ?? e)}`; }
    if (!bcOk) {
      // BC no confirmó: NO se registra localmente ni se mueve la orden, queda "por
      // recibir". PERO hay dos "no" contra los que reintentar no sirve NUNCA: BC ya
      // tiene la factura, o el pedido ya no existe allá porque se completó (al
      // completarlo, BC borra el pedido). Ahí lo que falta es guardar la recepción
      // acá, y eso se decide en el diálogo de conciliación — no reintentando.
      if (diag?.motivo && diag.motivo !== "reintentable") {
        setConciliar({ diag, error: aviso.replace(/^ · NO se pudo registrar en BC: /, ""), lineas, items, antes, detalle });
        setGuardando(false);
        return;
      }
      toast(`No se registró: ${aviso.replace(/^ · /, "") || "BC no confirmó el movimiento"}. La orden queda por recibir para reintentar.`, "error");
      setGuardando(false);
      return;
    }
    await guardarLocal({ aviso, bcOk: true, lineas, items, antes, detalle, bcFacturaNo });
  }

  // La parte LOCAL del registro: la recepción en la app, la foto de la factura y las
  // líneas marcadas para nota de crédito. Se llama con lo de BC YA resuelto —
  // registrado ahora, conciliado porque BC ya lo tenía, o una orden que no va a BC—,
  // así que acá no se vuelve a hablar con BC. `nota` queda en la bitácora.
  async function guardarLocal(p: {
    aviso: string; bcOk: boolean; nota?: string; bcFacturaNo?: string;
    lineas: { ordenLineaId: string; cantidadRecibida: number }[];
    items: string[]; antes: Record<string, number | null>; detalle: DetalleLinea[];
  }) {
    const { aviso, bcOk, items, antes, detalle } = p;
    setGuardando(true);
    try {
      const rec = await registrarRecepcion({
        ordenId: orden!.id, numeroFactura: numeroFactura.trim(),
        fechaFactura, fechaRecepcion, fechaRegistro, total: totalFactura, lineas: p.lineas,
        cargoAviso: cargoAvisoPayload(), nota: p.nota, bcFacturaNo: p.bcFacturaNo,
      });
      // Foto de la factura: va aparte y después (la recepción ya está hecha).
      const avisoFoto = await subirFotos(rec.id);
      // Líneas marcadas → notas de crédito (no bloquea el registro).
      const nc = articulo.filter((l) => marcadas[l.id]).map((l) => ({ ordenLineaId: l.id, articuloNo: l.articuloId, descripcion: l.descripcion, motivo: marcadas[l.id].motivo, cantidad: Number(marcadas[l.id].cantidad) || 0, precioUnitario: Number(marcadas[l.id].precio) || 0, nota: marcadas[l.id].nota || undefined }));
      // No debe tumbar el registro (la factura ya viajó a BC), pero SÍ hay que
      // avisar: si esto falla en silencio, Bodega marcó líneas para nota de crédito
      // y Contabilidad nunca las ve.
      let avisoNc = "";
      if (nc.length) {
        try { await marcarNotasCredito(orden!.id, numeroOrden(orden!), orden!.proveedorNombre ?? prov?.nombre, nc); }
        catch (e: any) { avisoNc = ` · OJO: no se pudieron guardar las ${nc.length} línea(s) marcadas para nota de crédito (${String(e?.message ?? e)}). Avisale a Contabilidad.`; }
      }
      const falloBc = aviso.includes("NO se pudo") || aviso.includes("no disponible") || aviso.includes("conciliada");
      toast(`Factura ${numeroFactura} registrada${completaOrden ? " — orden completada" : " (parcial)"}${aviso}${cargoAvisoPayload() ? " · se avisó a Contabilidad del cargo adicional" : ""}${avisoNc}${avisoFoto}`, falloBc || avisoNc || avisoFoto.includes("OJO") ? "info" : "success");
      if (bcOk) {
        // Mostramos el modal de inmediato (antes + facturado) y desbloqueamos; la
        // verificación del stock "después" en BC se consulta en segundo plano (no
        // re-bloquea el POST ya lento). despues=undefined → "verificando…".
        setConfirmInv({
          bcFacturaNo: p.bcFacturaNo,
          items: items.map((it) => {
            const dels = detalle.filter((d) => d.l.articuloId === it);
            const qty = dels.reduce((s, d) => s + d.qty, 0);
            const aObra = dels.filter((d) => d.obra).reduce((s, d) => s + d.qty, 0);
            const l0 = dels[0]?.l;
            return {
              itemNo: it, desc: l0?.descripcion ?? it, antes: antes[it] ?? null,
              recibido: qty, aObra, aInventario: qty - aObra, despues: undefined,
              unidad: l0?.unidad, unidadBase: l0?.unidadBase, factor: l0?.factorCompra,
            };
          }),
          // Consumo directo: material que NO queda en inventario porque BC lo carga a
          // la obra al registrar. Se guarda por línea (un item puede ir a dos obras).
          consumo: detalle.filter((d) => d.obra).map((d) => ({
            obra: d.obra!.codigo, obraNombre: d.obra!.nombre, taskNo: d.l.taskNo,
            itemNo: d.l.articuloId, desc: d.l.descripcion, unidad: d.l.unidad, cantidad: d.qty,
            importe: importeRecibir(d.l) + (distrib[d.l.id] ?? 0),
          })),
        });
        setGuardando(false);
        stockDeItems(items)
          .then((despues) => setConfirmInv((prev) => prev && { ...prev, items: prev.items.map((x) => ({ ...x, despues: despues[x.itemNo] ?? null })) }))
          .catch(() => setConfirmInv((prev) => prev && { ...prev, items: prev.items.map((x) => ({ ...x, despues: null })) }));
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
    let aviso = ""; let bcOk = false; let diag: DiagBc | null = null;
    try {
      if (orden!.bcNumber && bcLineas.length) {
        try {
          const r = await fetch("/api/bc/recibir", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ orderNo: orden!.bcNumber, lineas: bcLineas, postingDate: fechaRecepcion, ordenId: orden!.id, vendorNo: orden!.proveedorNo || orden!.proveedorId }),
          });
          const d = await r.json().catch(() => ({}));
          if (r.ok) { aviso = ` · recibido en BC (${d.receiptNo ?? "OK"})`; bcOk = true; }
          else if ((d as any)?.frenoLineas || (d as any)?.frenoEncabezado || (d as any)?.frenoDimensiones) {
            // Mismo tratamiento que al registrar: esto no se reintenta, se corrige.
            // Va al aviso que se queda en pantalla y no se guarda nada.
            setFrenoBc({
              error: String((d as any).error ?? ""), problemas: ((d as any).problemas ?? []) as string[],
              tipo: (d as any).frenoDimensiones ? "dimensiones" : (d as any).frenoNoLanzado ? "no-lanzado" : (d as any).frenoProveedor ? "proveedor" : "lineas",
            });
            setGuardando(false);
            return;
          }
          else { aviso = ` · NO se pudo recibir en BC: ${d.error ?? r.status}`; diag = d as DiagBc; }
        } catch (e: any) { aviso = ` · BC no disponible: ${String(e?.message ?? e)}`; }
      } else if (!orden!.bcNumber) {
        aviso = " · (sin N.º de BC, no se recibió en BC)";
      }
      // Si va a BC pero BC no confirmó, no recibimos localmente: queda por recibir.
      // Salvo que BC ya no tenga el pedido: ahí reintentar no va a servir nunca y
      // mandar a reintentar es mentirle a Bodega (acá no hay N.º de factura, así que
      // no se puede confirmar si ya se recibió allá — eso lo dice el mensaje).
      if (orden!.bcNumber && bcLineas.length && !bcOk) {
        toast(diag?.motivo === "pedido-no-existe"
          ? `No se recibió: Business Central ya no tiene el pedido ${orden!.bcNumber}. Puede que la recepción ya esté registrada allá (al completarse, BC borra el pedido). Revisalo en BC antes de volver a intentar, y avisale a Proveeduría.`
          : `No se recibió: ${aviso.replace(/^ · /, "") || "BC no confirmó el movimiento"}. La orden queda por recibir para reintentar.`, "error");
        setGuardando(false);
        return;
      }
      const rec = await registrarRecepcion({
        ordenId: orden!.id, numeroFactura: "", fechaFactura, fechaRecepcion, fechaRegistro,
        total: subtotalRecibido, lineas, facturaEnRevision: true,
        cargoAviso: cargoAvisoPayload(),
      });
      const avisoFoto = await subirFotos(rec.id);
      const nc = articulo.filter((l) => marcadas[l.id]).map((l) => ({ ordenLineaId: l.id, articuloNo: l.articuloId, descripcion: l.descripcion, motivo: marcadas[l.id].motivo, cantidad: Number(marcadas[l.id].cantidad) || 0, precioUnitario: Number(marcadas[l.id].precio) || 0, nota: marcadas[l.id].nota || undefined }));
      // No debe tumbar el registro (la factura ya viajó a BC), pero SÍ hay que
      // avisar: si esto falla en silencio, Bodega marcó líneas para nota de crédito
      // y Contabilidad nunca las ve.
      let avisoNc = "";
      if (nc.length) {
        try { await marcarNotasCredito(orden!.id, numeroOrden(orden!), orden!.proveedorNombre ?? prov?.nombre, nc); }
        catch (e: any) { avisoNc = ` · OJO: no se pudieron guardar las ${nc.length} línea(s) marcadas para nota de crédito (${String(e?.message ?? e)}). Avisale a Contabilidad.`; }
      }
      const falloBc = aviso.includes("NO se pudo") || aviso.includes("no disponible");
      toast(`Material recibido — factura EN REVISIÓN${aviso}${cargoAvisoPayload() ? " · se avisó a Contabilidad del cargo adicional" : ""}${avisoNc}${avisoFoto}`, falloBc || avisoNc || avisoFoto.includes("OJO") ? "info" : "success");
      router.push(`/facturacion`);
    } catch (e: any) {
      toast(String(e?.message ?? e), "error");
      setGuardando(false);
    }
  }

  return (
    <>
      <main className={esContabilidad ? "page page--wide" : "page"} style={esContabilidad ? undefined : { maxWidth: 760 }}>
        <button type="button" className="back-link" onClick={volver}>{volverTexto}</button>
        <div className="page__head">
          <div className="page__title">
            <div className="row gap-3">
              <h1 className="ds-heading">Registrar factura · {numeroOrden(orden)}</h1>
              <Badge tone={ordenBadge(orden.estado).tone}>{ordenBadge(orden.estado).label}</Badge>
            </div>
            <p className="ds-muted">{orden.proveedorNombre ?? prov?.nombre} · recibido {ordenRecibidoPct(orden)}%</p>
          </div>
        </div>

        {/* BC contestó y NO tiene el pedido de esta orden. Registrar va a fallar
            seguro, así que se dice acá arriba y no después de llenar todo. El botón
            NO se desactiva a propósito: si lo que pasó es que ya se registró allá,
            el intento es justo lo que abre el diálogo para conciliarlo. */}
        {frenoBc && (
          <div className="ds-callout ds-callout--red mb-4" role="alert">
            <span className="ds-callout__icon"><IconWarning /></span>
            <div>
              <div className="ds-callout__title">
                {frenoBc.tipo === "proveedor"
                  ? <>El pedido {orden.bcNumber} en Business Central es de OTRO proveedor</>
                  : frenoBc.tipo === "no-lanzado"
                  ? <>El pedido {orden.bcNumber} todavía no está lanzado en Business Central</>
                  : frenoBc.tipo === "dimensiones"
                  ? <>Business Central rechazó las dimensiones del pedido {orden.bcNumber}</>
                  : <>NO se registró: Business Central no tiene estas líneas en el pedido {orden.bcNumber}</>}
              </div>
              <div className="ds-callout__body">
                {frenoBc.tipo === "proveedor" ? (
                  <>
                    <div style={{ margin: "6px 0 8px" }}>{frenoBc.error}</div>
                    Registrarlo así le cargaría esta compra a la <span className="ds-strong">cuenta por pagar de otro proveedor</span>,
                    y eso después solo se deshace con una nota de crédito. Avisale a Proveeduría: hay que ver
                    si al pedido le cambiaron el proveedor en BC o si la orden quedó apuntando al pedido
                    equivocado. Nada se guardó.
                  </>
                ) : frenoBc.tipo === "dimensiones" ? (
                  <>
                    <div style={{ margin: "6px 0 8px", whiteSpace: "pre-line" }}>{frenoBc.error}</div>
                    El centro de costo que lleva la línea y el que su almacén exige en BC no pueden convivir, y eso
                    BC lo revisa <span className="ds-strong">solo al registrar</span>: por eso el pedido se creó y se
                    lanzó sin chistar, y el “no” aparece recién acá. Reintentar va a dar exactamente el mismo error —
                    esto se corrige en Business Central. Nada se guardó.
                  </>
                ) : frenoBc.tipo === "no-lanzado" ? (
                  <>
                    <div style={{ margin: "6px 0 8px" }}>{frenoBc.error}</div>
                    La orden figura aprobada acá, pero el <span className="ds-strong">lanzamiento en Business Central
                    todavía no entró</span>, y BC no deja recibir contra un pedido sin lanzar. No es un error tuyo
                    y no hace falta reintentar a ciegas: avisale a Aprobación para que lance el pedido, y volvé
                    a intentar cuando esté Lanzado. Nada se guardó.
                  </>
                ) : (
                  <>
                    <ul style={{ margin: "6px 0 8px 18px" }}>
                      {frenoBc.problemas.map((p, i) => <li key={i}>{p}</li>)}
                    </ul>
                    Si se registrara igual, BC saltaría esas líneas <span className="ds-strong">sin avisar</span>: la app diría
                    “recibido” y el material nunca entraría al inventario ni a la factura de compra. Corregí el
                    pedido en BC (o la orden con Proveeduría) y volvé a intentar. Nada se guardó.
                  </>
                )}
                <div className="mt-2">
                  <Button variant="outline" size="sm" onClick={() => setFrenoBc(null)}>Entendido</Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {bcSinPedido && (
          <div className="ds-callout ds-callout--red mb-4" role="status">
            <span className="ds-callout__icon"><IconWarning /></span>
            <div>
              <div className="ds-callout__title">Business Central ya no tiene el pedido {orden.bcNumber}</div>
              <div className="ds-callout__body">
                Puede ser que <span className="ds-strong">esta recepción ya se registró allá</span> (cuando un pedido se recibe y
                factura completo, BC lo borra), o que el número que guardó la app no llegó a existir.
                Si la factura ya está en BC, escribí su número y dale <span className="ds-strong">Registrar factura</span>: la app lo
                detecta y te ofrece guardar la recepción acá sin volver a registrarla. Si no, avisale a Proveeduría.
              </div>
            </div>
          </div>
        )}

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
                              {[codigoDeItem(l.articuloId ?? ""), l.pedidoNumero, l.proyecto && `Proy. ${l.proyecto}`, l.taskNo && `Tarea ${l.taskNo}`, l.descuentoPct ? `−${l.descuentoPct}%` : null].filter(Boolean).join(" · ")}
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
              const importeLinea = importeRecibir(l);
              return (
                <div key={l.id} className={`recv-card ${marcada ? "is-nc" : full ? "is-full" : zero ? "is-zero" : ""}`}>
                  <div className="recv-card__row">
                    <div className="recv-card__name">
                      {l.descripcion}
                      {/* El código del material, debajo del nombre: es con lo que
                          Bodega confirma contra la factura del proveedor que llegó
                          justo ese material, y con lo que se busca en BC. Va pelado
                          (el guardado puede traer la variante pegada). */}
                      {codigoDeItem(l.articuloId ?? "") && (
                        <div className="recv-card__code">{codigoDeItem(l.articuloId ?? "")}</div>
                      )}
                    </div>
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
                    {/* Importe de la línea: se recalcula con la cantidad que
                        escribe Bodega (cantidad × precio, menos el descuento de
                        la línea) — la misma cuenta que arma el subtotal de abajo.
                        Antes solo se veía el precio unitario y había que hacer la
                        multiplicación a mano contra la factura del proveedor. */}
                    <div className="recv-card__money">
                      <span className={`recv-card__linetot ${val > 0 ? "" : "is-zero"}`}
                        title="Cantidad a recibir × precio (sin IVA)">
                        {money(importeLinea, orden.currencyCode)}
                      </span>
                      <span className="recv-card__price">
                        {num.format(val)}{l.unidad ? ` ${l.unidad}` : ""} × <b>{money(l.precioUnitario, orden.currencyCode)}</b> c/u
                        {l.descuentoPct ? ` · −${l.descuentoPct}%` : ""}
                      </span>
                    </div>
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

        {/* Foto de la factura física. Va al final, antes de registrar: Bodega
            recibe, le saca la foto a la factura y queda pegada a la recepción
            (se ve después en "Recibidas" junto con las líneas). Sin `capture`
            a propósito: así el celular ofrece cámara O galería, porque muchas
            veces la foto ya se tomó antes de llegar a la pantalla. */}
        <Card className="mt-4">
          <div className="row row--between wrap gap-3" style={{ alignItems: "flex-start" }}>
            <div style={{ minWidth: 0 }}>
              <div className="ds-strong">Foto de la factura <span className="ds-muted ds-body-sm">(opcional)</span></div>
              <p className="ds-label ds-muted" style={{ margin: "4px 0 0", maxWidth: 480 }}>
                Sacale una foto a la factura del proveedor: queda guardada con esta recepción y la ves después en <strong>Recibidas</strong>.
                Se comprime antes de subirla, así que no pesa.
              </p>
            </div>
            <Button variant="outline" size="sm" disabled={fotoOcupado || fotos.length >= MAX_FOTOS}
              onClick={() => fileRef.current?.click()}>
              {fotoOcupado ? "Procesando…" : fotos.length ? "Agregar otra" : "Agregar foto"}
            </Button>
          </div>
          <input ref={fileRef} type="file" accept="image/*" multiple hidden
            aria-label="Foto de la factura" onChange={(e) => elegirFotos(e.target.files)} />
          {fotos.length > 0 && (
            <>
              <div className="foto-strip mt-3">
                {fotos.map((f, i) => (
                  <div className="foto-pick" key={`${f.nombre}-${i}`}>
                    <div className="foto-thumb" style={{ cursor: "default" }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={f.dataUrl} alt={`Foto ${i + 1} de la factura`} />
                    </div>
                    <button type="button" className="foto-pick__del" onClick={() => setFotos((p) => p.filter((_, j) => j !== i))}
                      aria-label={`Quitar la foto ${i + 1}`} title="Quitar esta foto">×</button>
                  </div>
                ))}
              </div>
              <p className="ds-body-sm ds-muted" style={{ margin: "8px 0 0" }}>
                {fotos.length} foto(s) · {pesoLegible(fotos.reduce((s2, f) => s2 + f.tamano, 0))} en total
              </p>
            </>
          )}
        </Card>

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
            {/* Llegó otro artículo: a Contabilidad le sirve saber CUÁNTO vino
                mal y QUÉ vino en su lugar (eso va en el comentario). */}
            {ncModal.motivo === "material_distinto" && (
              <Field label="Cantidad que llegó equivocada"
                help="Anotá en el comentario qué material llegó en su lugar.">
                <Input type="number" inputMode="numeric" min={0} value={ncModal.cantidad} placeholder="0"
                  onChange={(e) => setNcModal((m) => m && { ...m, cantidad: e.target.value })} />
              </Field>
            )}
            <Field label={ncModal.motivo === "material_distinto" ? "¿Qué llegó en su lugar?" : "Comentario (opcional)"}>
              <Textarea rows={3} value={ncModal.nota}
                placeholder={ncModal.motivo === "material_distinto" ? "Ej. llegó disco de 7\" en vez de 9\"…" : "Qué pasó con esta línea…"}
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
            <div className="col gap-3" style={{ borderTop: "1.5px solid var(--ds-color-gray-100)", paddingTop: 12 }}>
              {articulo.filter((l) => Number(recibir[l.id] || 0) > 0).sort((a, b) => a.descripcion.localeCompare(b.descripcion, "es")).map((l) => (
                <div key={l.id} className="row row--between gap-4" style={{ alignItems: "baseline" }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="ds-clamp-2" title={l.descripcion}>{l.descripcion}</div>
                    <div className="ds-body-sm ds-muted">
                      {num.format(Number(recibir[l.id]))} {l.unidad}
                      {distrib[l.id] ? ` · + flete ${money(distrib[l.id], orden.currencyCode)}` : ""}
                    </div>
                  </div>
                  <span className="ds-strong" style={{ whiteSpace: "nowrap" }}>{money(importeRecibir(l), orden.currencyCode)}</span>
                </div>
              ))}
              {fleteAplicado > 0 && (
                <div className="row row--between gap-4" style={{ alignItems: "baseline" }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="ds-clamp-2">{cargo?.descripcion}</div>
                    <div className="ds-body-sm ds-muted">cargo de producto</div>
                  </div>
                  <span className="ds-strong" style={{ whiteSpace: "nowrap" }}>{money(fleteAplicado, orden.currencyCode)}</span>
                </div>
              )}
            </div>
            <p className="ds-body-sm ds-muted mt-4">
              Verificá que el total físico de la factura coincida. Fecha de registro: {fechaRegistro}
              {!fechasCoinciden && " — no coincide con la fecha de factura"}.
            </p>
          </Modal>
        )}

        {/* BC rechazó el registro porque YA lo tiene. Este diálogo es la salida:
            conciliar = guardar la recepción SOLO en la app, sin volver a postear.
            Antes acá salía "la orden queda por recibir para reintentar", y esas
            órdenes se quedaban trabadas para siempre (el material ya había entrado
            en BC y ningún reintento iba a pasar). */}
        {conciliar && (() => {
          const { diag } = conciliar;
          const fBc = diag.facturaBc;
          const sinPedido = diag.motivo === "pedido-no-existe";
          // yaEnBc = hay prueba de que BC ya tiene el movimiento (lo dijo BC o se
          // encontró la factura registrada). Sin prueba no se pinta como seguro.
          const seguro = !!diag.yaEnBc;
          const titulo = seguro
            ? (sinPedido ? "Esta recepción ya está registrada en BC" : "Business Central ya tiene esta factura")
            : `Business Central ya no tiene el pedido ${orden.bcNumber}`;
          const conciliarAhora = async () => {
            const c = conciliar;
            setConciliar(null);
            await guardarLocal({
              aviso: ` · conciliada: BC ya tenía el movimiento, no se volvió a registrar allá${fBc?.numero ? ` (factura ${fBc.numero} en BC)` : ""}`,
              bcOk: false, nota: [
                "Conciliada con BC: la recepción se guardó en la app SIN volver a registrarla en BC.",
                sinPedido ? `BC ya no tenía el pedido ${orden.bcNumber}.` : "BC ya tenía esta factura del proveedor.",
                fBc?.numero ? `Factura en BC: ${fBc.numero}${fBc.fecha ? ` del ${fBc.fecha.slice(0, 10)}` : ""}.` : "",
              ].filter(Boolean).join(" "),
              lineas: c.lineas, items: c.items, antes: c.antes, detalle: c.detalle,
            });
          };
          return (
          <Modal
            title={titulo}
            onClose={() => setConciliar(null)}
            footer={<>
              <Button variant="white" onClick={() => setConciliar(null)}>Cancelar</Button>
              <Button variant={seguro ? "green" : "red"} onClick={conciliarAhora} disabled={guardando}>
                {seguro ? "Guardar la recepción acá" : "Conciliar de todos modos"}
              </Button>
            </>}
          >
            <p className="ds-label">
              {seguro
                ? <>El material <span className="ds-strong">ya entró en Business Central</span>: volver a intentarlo no va a servir nunca. Lo único que falta es guardar esta recepción en la app.</>
                : <>BC contestó que no tiene ningún pedido con ese número, así que no se puede registrar desde acá. Puede que ya se haya registrado allá (al completarse, BC borra el pedido) — pero <span className="ds-strong">no encontramos la factura {numeroFactura.trim()} en BC para confirmarlo</span>.</>}
            </p>

            {fBc && (
              <Card flat className="mt-4">
                <div className="ds-label ds-muted">Factura que BC ya tiene</div>
                <div className="row row--between wrap gap-2 mt-2" style={{ alignItems: "baseline" }}>
                  <span className="ds-strong">{fBc.numero}</span>
                  <span className="ds-body-sm ds-muted">
                    {[fBc.fecha ? fBc.fecha.slice(0, 10) : "", fBc.estado, fBc.total ? money(fBc.total, orden.currencyCode) : ""].filter(Boolean).join(" · ")}
                  </span>
                </div>
              </Card>
            )}

            <Card flat className="mt-4">
              <div className="ds-label ds-muted">Al conciliar</div>
              <ul className="ds-body-sm mt-2" style={{ paddingLeft: 18, display: "grid", gap: 4 }}>
                <li>Se guarda la recepción en la app con las cantidades de esta pantalla y la factura {numeroFactura.trim()}.</li>
                <li>La orden deja de estar "por recibir"{completaOrden ? " y queda completada" : " (queda parcial)"}.</li>
                <li><span className="ds-strong">No se toca Business Central</span>: no se registra nada allá, no se mueve inventario ni contabilidad.</li>
                <li>Queda anotado en la bitácora de la recepción, para que después se entienda por qué las fechas no calzan.</li>
              </ul>
            </Card>

            {!seguro && (
              <Card flat className="mt-4 ds-form-field--advertencia">
                <div className="row gap-3">
                  <span style={{ color: "var(--ds-color-red-200)" }}><IconWarning /></span>
                  <div>
                    <div className="ds-strong">Verificá en BC antes de conciliar</div>
                    <p className="ds-label ds-muted">
                      Si la recepción NO está registrada en BC, conciliar deja la app diciendo que el material entró cuando en BC no entró.
                      Buscá la factura {numeroFactura.trim()} del proveedor en BC; si no está, cancelá y avisale a Proveeduría —
                      esta orden necesita que le arreglen el pedido allá.
                    </p>
                  </div>
                </div>
              </Card>
            )}

            <p className="ds-body-sm ds-muted mt-4">Lo que contestó BC: {conciliar.error}</p>
          </Modal>
          );
        })()}

        {confirmInv && (() => {
          const cerrar = () => { setConfirmInv(null); router.push("/facturacion"); };
          // Consumo directo agrupado POR OBRA: "tales materiales, tales cantidades,
          // en tal obra". Un mismo item puede ir a dos obras en la misma factura.
          const porObra = confirmInv.consumo.reduce<{ obra: string; nombre?: string; filas: ConsumoObra[]; total: number }[]>((acc, c) => {
            let g = acc.find((x) => x.obra === c.obra);
            if (!g) { g = { obra: c.obra, nombre: c.obraNombre, filas: [], total: 0 }; acc.push(g); }
            g.filas.push(c); g.total += c.importe;
            return acc;
          }, []);
          // Solo se verifica el stock de lo que DEBÍA entrar a inventario. Lo de obra
          // ya no sale con ⚠️ por no subir el stock: es justo lo que se espera.
          const inv = confirmInv.items.filter((x) => x.aInventario > 1e-9);
          // Si el stock subió TAMBIÉN lo que iba a la obra, BC no lo cargó como
          // consumo: quedó en inventario y hay que decirlo (no darlo por bueno).
          // Todo lo que se compara con el stock de BC va convertido a unidad base.
          const enBase = (x: InvItem, qty: number) => qty * (x.factor && x.factor > 0 ? x.factor : 1);
          const quedoEnStock = confirmInv.items.filter((x) => x.aObra > 1e-9 && x.antes != null && x.despues != null
            && Math.abs((x.despues as number) - ((x.antes as number) + enBase(x, x.recibido))) < 1e-6);
          return (
          <Modal
            title={porObra.length ? (inv.length ? "Así quedó en Business Central" : "Material consumido en la obra") : "Inventario actualizado en BC"}
            onClose={cerrar}
            footer={<Button onClick={cerrar}>Listo</Button>}
          >
            {/* N.º de la factura REGISTRADA en BC. Va acá arriba y no en el aviso
                de abajo porque el aviso se va solo en segundos: este cartel se
                queda hasta que le den Listo, así se puede anotar. Y de todas
                formas queda guardado con la recepción, visible en "Recibidas". */}
            {confirmInv.bcFacturaNo && (
              <div className="bc-doc">
                <span className="ds-label ds-muted">Factura registrada en Business Central</span>
                <span className="bc-doc__no">{confirmInv.bcFacturaNo}</span>
                <span className="ds-body-sm ds-muted">Con este N.º se encuentra el movimiento en BC. Queda guardado en <span className="ds-strong">Recibidas</span>.</span>
              </div>
            )}
            {porObra.length > 0 && (
              <>
                <p className="ds-label">
                  Consumo directo: este material <span className="ds-strong">no queda en inventario</span> — BC lo carga a la obra al registrar la factura.
                </p>
                {porObra.map((g) => (
                  <div key={g.obra} className="mt-4">
                    <div className="row row--between wrap gap-2" style={{ alignItems: "baseline" }}>
                      <span className="ds-strong">{g.obra}{g.nombre ? <span className="ds-muted"> · {g.nombre}</span> : null}</span>
                      <span className="ds-body-sm ds-muted">Cargado a la obra {money(g.total, orden.currencyCode)} (sin IVA)</span>
                    </div>
                    <div className="ds-table-wrap" style={{ boxShadow: "none", border: "1.5px solid var(--ds-color-gray-100)", marginTop: "var(--ds-space-2)" }}>
                      <table className="ds-table">
                        <thead><tr><th>Material</th><th className="ds-num">Consumido</th><th className="ds-num">Importe</th></tr></thead>
                        <tbody>
                          {g.filas.map((c, i) => (
                            <tr key={`${c.itemNo ?? "s/item"}-${i}`}>
                              <td>
                                {c.desc}
                                {(c.itemNo || c.taskNo) && (
                                  <div className="ds-body-sm ds-muted">{[c.itemNo, c.taskNo && `Tarea ${c.taskNo}`].filter(Boolean).join(" · ")}</div>
                                )}
                              </td>
                              <td className="ds-num ds-strong">{num.format(c.cantidad)}{c.unidad ? ` ${c.unidad}` : ""}</td>
                              <td className="ds-num">{money(c.importe, orden.currencyCode)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
                {quedoEnStock.length > 0 && (
                  <Card flat className="mt-4 ds-form-field--advertencia">
                    <div className="row gap-3">
                      <span style={{ color: "var(--ds-color-red-200)" }}><IconWarning /></span>
                      <div>
                        <div className="ds-strong">En BC quedó en inventario, no como consumo de la obra</div>
                        <p className="ds-label ds-muted">
                          El stock de {quedoEnStock.map((x) => x.itemNo).join(", ")} subió todo lo facturado. Revisá en BC si la línea llevaba la obra (Job No.).
                        </p>
                      </div>
                    </div>
                  </Card>
                )}
              </>
            )}
            {inv.length > 0 && (
              <>
                <p className={`ds-label${porObra.length ? " mt-4" : ""}`}>Stock en Business Central <span className="ds-strong">antes → después</span> de registrar esta factura:</p>
                <div className="ds-table-wrap" style={{ boxShadow: "none", border: "1.5px solid var(--ds-color-gray-100)", marginTop: 8 }}>
                  <table className="ds-table">
                    <thead><tr><th>Artículo</th><th className="ds-num">Antes</th><th className="ds-num">{porObra.length ? "A inventario" : "Facturado"}</th><th className="ds-num">Después</th><th></th></tr></thead>
                    <tbody>
                      {inv.map((x) => {
                        const verificando = x.despues === undefined;
                        const sd = !verificando && (x.antes == null || x.despues == null);
                        const ok = !verificando && !sd && Math.abs((x.despues as number) - ((x.antes as number) + enBase(x, x.aInventario))) < 1e-6;
                        return (
                          <tr key={x.itemNo}>
                            <td>
                              {x.desc}
                              <div className="ds-body-sm ds-muted">{x.itemNo}</div>
                              {x.aObra > 1e-9 && <div className="ds-body-sm ds-muted">Otras {num.format(x.aObra)} {x.unidad ?? ""} se consumieron en obra</div>}
                            </td>
                            <td className="ds-num">{x.antes == null ? "—" : num.format(x.antes)}</td>
                            <td className="ds-num ds-strong" style={{ color: "var(--ds-color-green-300)" }}>
                              +{num.format(enBase(x, x.aInventario))}{x.unidadBase ? ` ${x.unidadBase}` : ""}
                              {/* Si se compró en otra unidad, se dice de dónde salen esos
                                  gramos: "= 1 EST". Antes el número no cuadraba con nada. */}
                              {enBase(x, x.aInventario) !== x.aInventario && (
                                <div className="ds-body-sm ds-muted" style={{ fontWeight: 400 }}>= {num.format(x.aInventario)} {x.unidad ?? ""}</div>
                              )}
                            </td>
                            <td className="ds-num ds-strong">{verificando ? <Skeleton style={{ display: "inline-block", width: 48, height: 14, borderRadius: 6 }} /> : x.despues == null ? "—" : num.format(x.despues)}</td>
                            <td className="ds-num">{verificando ? <span className="ds-muted" title="Verificando en BC…">…</span> : sd ? <span className="ds-muted" title="BC no devolvió stock">s/d</span> : ok ? "✅" : <span title="El cambio no coincide con lo que debía entrar a inventario" style={{ color: "var(--ds-color-red-200)" }}>⚠️</span>}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="ds-body-sm ds-muted mt-4">
                  El material entró al almacén de recepción{orden.almacenRecepcion ? <> <span className="ds-strong">{orden.almacenRecepcion}</span></> : ""}. Un ✅ confirma que el stock subió justo lo que debía entrar.
                </p>
              </>
            )}
          </Modal>
          );
        })()}
      </main>
    </>
  );
}
