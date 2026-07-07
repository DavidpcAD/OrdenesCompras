"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import * as XLSX from "xlsx";
import { Button, Card, Field, Select, Textarea, useToast } from "@/components/ui";
import { IconTrash, IconPlus } from "@/components/icons";
import { Combobox } from "@/components/combobox";
import { useStore, type NewPedidoInput } from "@/lib/store";
import type { Almacen, Articulo, Obra, Pedido, TipoSolicitud } from "@/lib/types";

interface DraftLine { key: string; articuloId: string; obraCodigo: string; obraNombre: string; variantCode: string; variantNombre: string; cantidad: string; }
type Variante = { code: string; descripcion: string };

// Personas que pueden solicitar material (rol Ingeniería).
const SOLICITANTES = ["Laura Ureña", "Loana", "Michael Thames", "Roger Solano"];

// ---- Plantillas (persistidas en SQL: dbo.PlantillaSolicitud) ----
type PlantillaLinea = { code: string; cantidad: number; obraCodigo: string };
type Plantilla = { id: number; nombre: string; creadoPor: string; idClasificacion?: number | null; lineas: PlantillaLinea[] };
const normTxt = (v: unknown) => String(v ?? "").trim().toUpperCase();

export interface SolicitudInicial {
  tipoSolicitud: TipoSolicitud;
  obraCodigo?: string;
  maquinaNo?: string;
  solicitante: string;
  prioridad: Pedido["prioridad"];
  notas?: string;
  // En material, `almacen` de cada línea guarda el código de obra de esa línea.
  lineas: { articuloId: string; almacen: string; cantidad: number; variantCode?: string }[];
}

export function SolicitudForm({
  inicial,
  guardar,
  textoBoton,
  onCancelar,
  obraPreset,
  clasifPreset,
  compact,
}: {
  inicial?: SolicitudInicial;
  guardar: (input: NewPedidoInput) => Promise<void>;
  textoBoton: string;
  onCancelar: () => void;
  // Presets para usar el form embebido (p.ej. modal de la Matriz), sin depender
  // de la URL. Si vienen, mandan sobre los query params.
  obraPreset?: string;
  clasifPreset?: number;
  // Modo compacto (modal de la Matriz): oculta tipo/prioridad/observaciones,
  // Excel y guardar-plantilla, y el selector de obra (viene fijado por preset).
  compact?: boolean;
}) {
  const { articulos, obras, maquinas, almacenes, usuario, planContexto, setPlanContexto } = useStore();
  const toast = useToast();
  // Contexto opcional desde la Matriz por obra: por props (modal) o por URL.
  const search = useSearchParams();
  const clasifParam = clasifPreset != null ? String(clasifPreset) : search.get("clasif");
  const obraParam = obraPreset ?? search.get("obra");
  const [idClasificacion] = useState<number | null>(clasifParam ? Number(clasifParam) : null);

  const [bcArt, setBcArt] = useState<Articulo[] | null>(null);
  const [bcObras, setBcObras] = useState<Obra[] | null>(null);
  const [bcAlm, setBcAlm] = useState<Almacen[] | null>(null);

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const ri = await fetch("/api/bc/items");
        if (!ri.ok) throw new Error("bc");
        const items: Articulo[] = ((await ri.json()).items ?? []).map((i: any) => ({
          id: i.id, code: i.code, descripcion: i.descripcion, unidad: i.unidad || "UND",
          almacenDefault: "", precioReferencia: 0, tipo: "inventario" as const,
        }));
        const [ro, ra] = await Promise.all([fetch("/api/bc/obras"), fetch("/api/bc/almacenes")]);
        const obrasBc: Obra[] = ro.ok ? ((await ro.json()).obras ?? []) : [];
        const almBc: Almacen[] = ra.ok ? ((await ra.json()).almacenes ?? []) : [];
        if (cancel) return;
        if (items.length) setBcArt(items);
        if (obrasBc.length) setBcObras(obrasBc);
        if (almBc.length) setBcAlm(almBc);
      } catch { /* sin BC, usa catálogo de respaldo */ }
    })();
    return () => { cancel = true; };
  }, []);

  const catArticulos = bcArt ?? articulos;
  const catObras = bcObras ?? obras;
  const catAlm = bcAlm ?? almacenes; // bodegas para solicitudes de Stock

  const obraNombreDe = (codigo: string) => catObras.find((o) => o.codigo === codigo)?.nombre ?? codigo;

  const [tipo, setTipo] = useState<TipoSolicitud>(inicial?.tipoSolicitud ?? "material");
  const [maquinaId, setMaquinaId] = useState("");
  // Bodega destino para solicitudes de Stock (compra para inventario).
  const [almacenStock, setAlmacenStock] = useState("");
  // El solicitante es el usuario que hizo login (no se elige a mano).
  const solicitante = inicial?.solicitante ?? usuario ?? SOLICITANTES[0];
  const [prioridad, setPrioridad] = useState<Pedido["prioridad"]>(inicial?.prioridad ?? "normal");
  const [notas, setNotas] = useState(inicial?.notas ?? "");
  const [lineas, setLineas] = useState<DraftLine[]>(
    (inicial?.lineas ?? []).map((l) => ({
      key: Math.random().toString(36).slice(2),
      articuloId: l.articuloId,
      obraCodigo: l.almacen, // en material, almacen = código de obra
      obraNombre: "",
      variantCode: l.variantCode ?? "",
      variantNombre: "",
      cantidad: String(l.cantidad),
    }))
  );

  // máquina inicial (repuesto)
  useEffect(() => {
    if (inicial?.tipoSolicitud === "repuesto" && inicial.maquinaNo && !maquinaId) {
      const m = maquinas.find((x) => x.no === inicial.maquinaNo);
      if (m) setMaquinaId(m.id);
    }
  }, [maquinas]); // eslint-disable-line react-hooks/exhaustive-deps

  // bodega inicial (stock): se guardó reutilizando obraCodigo del encabezado.
  useEffect(() => {
    if (inicial?.tipoSolicitud === "stock" && inicial.obraCodigo && !almacenStock) setAlmacenStock(inicial.obraCodigo);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const catalogo = useMemo(
    () => catArticulos.filter((a) => (tipo === "repuesto" ? a.code.startsWith("R") : !a.code.startsWith("R"))),
    [catArticulos, tipo]
  );

  // ---- alta rápida ----
  const [qaArticuloId, setQaArticuloId] = useState("");
  const [qaQuery, setQaQuery] = useState("");
  const [qaCantidad, setQaCantidad] = useState("");
  const [qaOpen, setQaOpen] = useState(false);
  const [qaVariantes, setQaVariantes] = useState<Variante[]>([]);
  const [qaVariante, setQaVariante] = useState("");
  const [qaVariantesError, setQaVariantesError] = useState(false);
  const cantRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // ---- plantillas (SQL) ----
  const [plantillas, setPlantillas] = useState<Plantilla[]>([]);
  const [nombrePlantilla, setNombrePlantilla] = useState("");
  const [filtroPlantilla, setFiltroPlantilla] = useState<string>(""); // "" = todas; o creadoPor
  const [buscarPlantilla, setBuscarPlantilla] = useState("");
  const [plantillaCargada, setPlantillaCargada] = useState<string>("");
  const [obraTodas, setObraTodas] = useState("");
  async function recargarPlantillas() {
    try {
      const r = await fetch("/api/plantillas");
      if (!r.ok) return;
      const data = await r.json();
      setPlantillas((data.plantillas ?? []) as Plantilla[]);
    } catch { /* sin DB, queda vacío */ }
  }
  useEffect(() => { recargarPlantillas(); }, []);
  // Prefill desde la Matriz: carga la plantilla de esa clasificación y fija la obra.
  useEffect(() => {
    if (!clasifParam || plantillas.length === 0) return;
    const pl = plantillas.find((p) => Number(p.idClasificacion) === Number(clasifParam));
    if (pl) cargarPlantilla(String(pl.id));
  }, [plantillas]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (obraParam) {
      const o = catObras.find((x) => x.codigo === obraParam);
      if (o) setObraTodas(o.id);
      return;
    }
    // Al editar un pedido de material, precargar la obra del quick-add desde el
    // propio pedido; si no, "Agregar" queda deshabilitado (exige obra).
    if (inicial?.tipoSolicitud === "material" && !obraTodas) {
      const code = inicial.obraCodigo || inicial.lineas?.[0]?.almacen;
      const o = code ? catObras.find((x) => x.codigo === code) : null;
      if (o) setObraTodas(o.id);
    }
  }, [bcObras]); // eslint-disable-line react-hooks/exhaustive-deps
  // por defecto, cada quien ve las suyas
  useEffect(() => { if (solicitante && filtroPlantilla === "") setFiltroPlantilla(solicitante); }, [solicitante]); // eslint-disable-line react-hooks/exhaustive-deps

  const q = qaQuery.trim().toLowerCase();
  const sugerencias = useMemo(() => {
    if (!q) return [];
    return catalogo.filter((a) => a.code.toLowerCase().includes(q) || a.descripcion.toLowerCase().includes(q)).slice(0, 50);
  }, [catalogo, q]);

  function elegir(a: Articulo) {
    setQaArticuloId(a.id); setQaQuery(`${a.code} — ${a.descripcion}`); setQaOpen(false);
    setQaVariantes([]); setQaVariante(""); setQaVariantesError(false);
    // buscar variantes del item (si la API/permiso lo permite)
    fetch(`/api/bc/variants?item=${encodeURIComponent(a.code)}`)
      .then((r) => (r.ok ? r.json() : { variantes: [], disponible: false }))
      .then((d) => { setQaVariantes(d.variantes ?? []); setQaVariantesError(d.disponible === false); })
      .catch(() => { setQaVariantes([]); setQaVariantesError(true); });
    setTimeout(() => cantRef.current?.focus(), 0);
  }
  const qaArticulo = catArticulos.find((a) => a.id === qaArticuloId);
  const variantePendiente = qaVariantes.length > 0 && !qaVariante;
  const puedeAgregar = !!qaArticuloId && Number(qaCantidad) > 0 && (tipo === "material" ? !!obraTodas : true) && !variantePendiente;

  function agregar() {
    if (!puedeAgregar) return;
    const obra = catObras.find((o) => o.id === obraTodas);
    const variante = qaVariantes.find((v) => v.code === qaVariante);
    setLineas((ls) => [{
      key: Math.random().toString(36).slice(2),
      articuloId: qaArticuloId,
      obraCodigo: tipo === "material" ? (obra?.codigo ?? "") : "",
      obraNombre: tipo === "material" ? (obra?.nombre ?? "") : "",
      variantCode: qaVariante,
      variantNombre: variante?.descripcion ?? "",
      cantidad: qaCantidad,
    }, ...ls]);
    // Dejamos qaObraId puesto: la siguiente línea hereda por defecto la última obra agregada.
    setQaArticuloId(""); setQaQuery(""); setQaCantidad(""); setQaOpen(false);
    setQaVariantes([]); setQaVariante(""); setQaVariantesError(false);
  }
  function removeLine(key: string) { setLineas((ls) => ls.filter((l) => l.key !== key)); }
  function setLineCantidad(key: string, val: string) {
    setLineas((ls) => ls.map((l) => (l.key === key ? { ...l, cantidad: val } : l)));
  }
  function setLineObra(key: string, obraId: string) {
    const o = catObras.find((x) => x.id === obraId);
    setLineas((ls) => ls.map((l) => (l.key === key ? { ...l, obraCodigo: o?.codigo ?? "", obraNombre: o?.nombre ?? "" } : l)));
  }

  // ---- Importar Excel: detecta columnas por contenido (código BC, cantidad, obra) ----
  function lineasDesde(items: { code: string; cantidad: number; obraCodigo: string }[]): { nuevas: DraftLine[]; sinMatch: number } {
    const porCodigo = new Map(catArticulos.map((a) => [normTxt(a.code), a]));
    let sinMatch = 0;
    const nuevas: DraftLine[] = [];
    for (const it of items) {
      const a = porCodigo.get(normTxt(it.code));
      if (!a) { sinMatch++; continue; }
      const o = catObras.find((x) => normTxt(x.codigo) === normTxt(it.obraCodigo));
      nuevas.push({
        key: Math.random().toString(36).slice(2),
        articuloId: a.id,
        obraCodigo: o?.codigo ?? "",
        obraNombre: o?.nombre ?? "",
        variantCode: "", variantNombre: "",
        cantidad: it.cantidad > 0 ? String(it.cantidad) : "",
      });
    }
    return { nuevas, sinMatch };
  }

  async function importarExcel(file: File) {
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const aoa: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
      if (!aoa.length) { toast("El Excel está vacío.", "error"); return; }
      const codeSet = new Set(catArticulos.map((a) => normTxt(a.code)));
      const obraSet = new Set(catObras.map((o) => normTxt(o.codigo)));
      const nCols = Math.max(...aoa.map((r) => r.length));
      const count = (pred: (v: any) => boolean) =>
        Array.from({ length: nCols }, (_, c) => aoa.reduce((n, r) => n + (pred(r[c]) ? 1 : 0), 0));
      // columna de código = la que más valores hace match con el catálogo BC
      const codeHits = count((v) => codeSet.has(normTxt(v)));
      const codeCol = codeHits.indexOf(Math.max(...codeHits));
      if (codeHits[codeCol] === 0) { toast("No encontré ninguna columna con códigos de material de BC.", "error"); return; }
      // columna de obra = la que más match con códigos de obra (puede no existir)
      const obraHits = count((v) => obraSet.has(normTxt(v)));
      const obraCol = obraHits[obraHits.indexOf(Math.max(...obraHits))] > 0 ? obraHits.indexOf(Math.max(...obraHits)) : -1;
      // columna de cantidad = la más numérica, distinta de código/obra
      const numHits = count((v) => v !== "" && !isNaN(Number(v)) && Number(v) > 0).map((n, c) => (c === codeCol || c === obraCol ? -1 : n));
      const cantCol = Math.max(...numHits) > 0 ? numHits.indexOf(Math.max(...numHits)) : -1;
      const items = aoa
        .filter((r) => codeSet.has(normTxt(r[codeCol])))
        .map((r) => ({
          code: String(r[codeCol]),
          cantidad: cantCol >= 0 ? Number(r[cantCol]) || 0 : 0,
          obraCodigo: obraCol >= 0 ? String(r[obraCol]) : "",
        }));
      const { nuevas, sinMatch } = lineasDesde(items);
      if (!nuevas.length) { toast("Ninguna fila coincidió con el catálogo de BC.", "error"); return; }
      setLineas((ls) => [...nuevas, ...ls]);
      toast(`Se cargaron ${nuevas.length} línea(s)${sinMatch ? ` · ${sinMatch} sin coincidencia (omitidas)` : ""}. Revisá la obra de cada línea.`, "success");
    } catch (e: any) {
      toast(`No pude leer el Excel: ${String(e?.message ?? e)}`, "error");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  // Descargar una plantilla en Excel: hoja "Solicitud" con las columnas que el
  // importador entiende (Código / Obra / Cantidad) — precargada con las líneas
  // actuales si las hay — más una hoja "Catálogo BC" para buscar códigos. Se edita
  // en local (agregar filas) y se vuelve a subir con "Importar Excel".
  function descargarExcel() {
    const filas = lineas.length
      ? lineas.map((l) => {
          const a = catArticulos.find((x) => x.id === l.articuloId);
          return { Codigo: a?.code ?? "", Descripcion: a?.descripcion ?? "", Obra: l.obraCodigo ?? "", Cantidad: Number(l.cantidad) || 0 };
        })
      : [{ Codigo: catArticulos[0]?.code ?? "", Descripcion: "(ejemplo — podés borrar esta fila)", Obra: catObras[0]?.codigo ?? "", Cantidad: 1 }];
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(filas, { header: ["Codigo", "Descripcion", "Obra", "Cantidad"] });
    ws["!cols"] = [{ wch: 16 }, { wch: 48 }, { wch: 14 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, ws, "Solicitud");
    const cat = catArticulos.map((a) => ({ Codigo: a.code, Descripcion: a.descripcion, Unidad: a.unidad }));
    const wsCat = XLSX.utils.json_to_sheet(cat, { header: ["Codigo", "Descripcion", "Unidad"] });
    wsCat["!cols"] = [{ wch: 16 }, { wch: 52 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, wsCat, "Catalogo BC");
    XLSX.writeFile(wb, `plantilla-solicitud-${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast(lineas.length ? "Plantilla descargada con tus líneas actuales." : "Plantilla en blanco descargada. Llenala y subila con Importar Excel.", "success");
  }

  // ---- Plantillas (SQL) ----
  async function guardarComoPlantilla() {
    const nombre = nombrePlantilla.trim();
    if (!nombre) { toast("Poné un nombre para la plantilla.", "error"); return; }
    if (!lineas.length) { toast("No hay líneas para guardar.", "error"); return; }
    const lineasPl: PlantillaLinea[] = lineas.map((l) => {
      const a = catArticulos.find((x) => x.id === l.articuloId);
      return { code: a?.code ?? "", cantidad: Number(l.cantidad) || 0, obraCodigo: l.obraCodigo };
    }).filter((x) => x.code);
    try {
      const r = await fetch("/api/plantillas", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre, creadoPor: solicitante, lineas: lineasPl }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || "No se pudo guardar");
      setNombrePlantilla("");
      await recargarPlantillas();
      toast(`Plantilla "${nombre}" guardada.`, "success");
    } catch (e: any) {
      toast(`No se pudo guardar la plantilla: ${String(e?.message ?? e)}`, "error");
    }
  }
  function cargarPlantilla(id: string) {
    const pl = plantillas.find((p) => String(p.id) === String(id));
    if (!pl) return;
    const { nuevas, sinMatch } = lineasDesde(pl.lineas);
    if (!nuevas.length) { toast("Esa plantilla no coincide con el catálogo actual.", "error"); return; }
    // REEMPLAZA las líneas (no suma): al elegir otra plantilla, cambia la actual.
    setLineas(nuevas);
    setPlantillaCargada(id);
    toast(`Plantilla "${pl.nombre}" cargada (${nuevas.length} línea/s${sinMatch ? `, ${sinMatch} omitida/s` : ""}). Reemplaza las líneas anteriores.`, "success");
  }
  // Cambiar la obra de TODAS las líneas de una vez (tras cargar plantilla o copiar).
  function obraMasiva(obraId: string) {
    const o = catObras.find((x) => x.id === obraId);
    if (!o) return;
    setLineas((ls) => ls.map((l) => ({ ...l, obraCodigo: o.codigo, obraNombre: o.nombre })));
    toast(`Obra ${o.codigo} aplicada a las ${lineas.length} línea(s).`, "success");
  }
  async function borrarPlantilla(id: number) {
    try {
      const r = await fetch(`/api/plantillas/${id}?usuario=${encodeURIComponent(solicitante)}`, { method: "DELETE" });
      if (!r.ok) throw new Error("No se pudo borrar");
      await recargarPlantillas();
    } catch (e: any) {
      toast(`No se pudo borrar la plantilla: ${String(e?.message ?? e)}`, "error");
    }
  }
  const plantillasVisibles = (filtroPlantilla && filtroPlantilla !== "*"
    ? plantillas.filter((p) => p.creadoPor === filtroPlantilla)
    : plantillas
  ).filter((p) => { const q = buscarPlantilla.trim().toLowerCase(); return !q || p.nombre.toLowerCase().includes(q); });
  const creadoresPlantillas = useMemo(
    () => Array.from(new Set(plantillas.map((p) => p.creadoPor).filter(Boolean))).sort(),
    [plantillas]
  );
  function cambiarTipo(t: TipoSolicitud) {
    if (t === tipo) return;
    setTipo(t); setLineas([]); setMaquinaId(""); setAlmacenStock(""); setObraTodas("");
    setQaArticuloId(""); setQaQuery(""); setQaCantidad("");
    setQaVariantes([]); setQaVariante(""); setQaVariantesError(false);
  }

  const destinoOk = tipo === "material" ? true : tipo === "repuesto" ? !!maquinaId : !!almacenStock;
  const lineasOk = tipo === "material" ? lineas.every((l) => Number(l.cantidad) > 0 && !!l.obraCodigo)
    : lineas.every((l) => Number(l.cantidad) > 0);
  const lineasSinObra = tipo === "material" ? lineas.filter((l) => !l.obraCodigo).length : 0;
  const puedeGuardar = destinoOk && !!solicitante && lineas.length > 0 && lineasOk;
  const [guardando, setGuardando] = useState(false);

  async function onGuardar() {
    if (!puedeGuardar) {
      if (tipo === "material" && lineasSinObra > 0) toast(`Faltan ${lineasSinObra} línea(s) sin obra. Asignales la obra antes de guardar.`, "error");
      else if (tipo === "material" && lineas.some((l) => !(Number(l.cantidad) > 0))) toast("Hay líneas con cantidad en 0.", "error");
      else toast(tipo === "repuesto" ? "Indicá la máquina y al menos un repuesto." : tipo === "stock" ? "Indicá la bodega y al menos un material." : "Agregá al menos un material (con su obra).", "error");
      return;
    }
    const maquina = maquinas.find((m) => m.id === maquinaId);
    const bodega = catAlm.find((a) => a.codigo === almacenStock);
    // En material, la obra del encabezado se deriva de las líneas. En Stock se
    // reutilizan los campos de obra del encabezado para guardar la bodega destino.
    const obrasUnicas = [...new Set(lineas.map((l) => l.obraCodigo))];
    const headerObraCodigo = tipo === "material" ? (obrasUnicas.length === 1 ? obrasUnicas[0] : "(varias)")
      : tipo === "stock" ? almacenStock : undefined;
    const headerObraNombre = tipo === "material"
      ? (obrasUnicas.length === 1 ? (obraNombreDe(obrasUnicas[0]) || obrasUnicas[0]) : "Varias obras")
      : tipo === "stock" ? (bodega?.nombre ?? almacenStock) : undefined;
    setGuardando(true);
    try {
      await guardar({
        tipoSolicitud: tipo,
        obraCodigo: headerObraCodigo,
        obraNombre: headerObraNombre,
        maquinaNo: tipo === "repuesto" ? maquina?.no : undefined,
        maquinaNombre: tipo === "repuesto" ? maquina?.nombre : undefined,
        idClasificacion,
        solicitante,
        prioridad,
        notas: notas.trim() || undefined,
        loteRef: planContexto?.lote,
        lineas: lineas.map((l) => {
          const a = catArticulos.find((x) => x.id === l.articuloId)!;
          return { articuloId: a.id, descripcion: a.descripcion, cantidad: Number(l.cantidad), unidad: a.unidad, almacen: tipo === "material" ? l.obraCodigo : "", variantCode: l.variantCode || undefined };
        }),
      });
      setPlanContexto(null);
    } catch (e: any) {
      toast(String(e?.message ?? e), "error");
      setGuardando(false);
    }
  }

  const esMaterial = tipo === "material";
  const esRepuesto = tipo === "repuesto";
  const esStock = tipo === "stock";

  return (
    <>
      {planContexto && (
        <Card className="mt-0" style={{ marginBottom: 12, background: "color-mix(in srgb, var(--ds-color-green-100) 12%, #fff)", borderColor: "var(--ds-color-green-200)" }}>
          <div className="row row--between wrap gap-2" style={{ alignItems: "center" }}>
            <span className="ds-body-sm"><span className="ds-strong">Armando pedido desde Planificación</span> · {planContexto.modelo} {planContexto.lote ? `· lote ${planContexto.lote}` : ""}</span>
            <button type="button" className="link-btn" onClick={() => setPlanContexto(null)}>Quitar contexto</button>
          </div>
        </Card>
      )}
      {!compact && (
      <Card>
        <div className="row gap-3" style={{ marginBottom: 20 }}>
          <button type="button" className={`role-option ${esMaterial ? "is-selected" : ""}`} style={{ flex: 1, padding: "12px 16px" }} onClick={() => cambiarTipo("material")}>
            <span className="col" style={{ gap: 2 }}><span className="role-option__title">Material</span><span className="role-option__desc">Va a una obra</span></span>
          </button>
          <button type="button" className={`role-option ${esRepuesto ? "is-selected" : ""}`} style={{ flex: 1, padding: "12px 16px" }} onClick={() => cambiarTipo("repuesto")}>
            <span className="col" style={{ gap: 2 }}><span className="role-option__title">Repuesto</span><span className="role-option__desc">Va a una máquina</span></span>
          </button>
          <button type="button" className={`role-option ${esStock ? "is-selected" : ""}`} style={{ flex: 1, padding: "12px 16px" }} onClick={() => cambiarTipo("stock")}>
            <span className="col" style={{ gap: 2 }}><span className="role-option__title">Stock</span><span className="role-option__desc">Va a bodega (inventario)</span></span>
          </button>
        </div>

        <div className="grid-2">
          {esRepuesto && (
            <Field label="Máquina destino">
              <Combobox items={maquinas} value={maquinaId} onChange={(k) => setMaquinaId(k)} getKey={(m) => m.id} getLabel={(m) => `${m.no} — ${m.nombre}`} placeholder="Buscar máquina…" />
            </Field>
          )}
          {esStock && (
            <Field label="Bodega destino" help="Dónde entra el material comprado para inventario">
              <Combobox items={catAlm} value={almacenStock} onChange={(k) => setAlmacenStock(k)} getKey={(a) => a.codigo} getLabel={(a) => `${a.codigo} — ${a.nombre}`} placeholder="Buscar bodega…" />
            </Field>
          )}
          <Field label="Prioridad">
            <Select value={prioridad} onChange={(e) => setPrioridad(e.target.value as Pedido["prioridad"])}>
              <option value="normal">Normal</option><option value="alta">Alta</option><option value="urgente">Urgente</option>
            </Select>
          </Field>
          <Field label="Observaciones (opcional)"><Textarea value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Indicaciones para proveeduría…" /></Field>
        </div>
      </Card>
      )}

      <Card className={compact ? "" : "mt-4"} flat={compact}>
        <h3 className="ds-subtitle">{esRepuesto ? "Repuestos" : "Materiales"}</h3>
        <p className="ds-muted ds-body-sm" style={{ marginBottom: 16 }}>
          Buscá el {esMaterial ? "material, elegí la obra" : esRepuesto ? "repuesto" : "material"} y la cantidad, y agregalo. Se van sumando a la lista.
        </p>

        {esMaterial && (
          <div style={{ marginBottom: 16, borderRadius: 14, border: "1.5px solid var(--ds-color-gray-100)", background: "color-mix(in srgb, var(--ds-color-green-100) 6%, #fff)", overflow: "hidden" }}>
            {/* Encabezado: título + acciones de Excel */}
            <div className="row row--between wrap gap-2" style={{ alignItems: "center", padding: "10px 14px", borderBottom: "1.5px solid var(--ds-color-gray-100)", background: "color-mix(in srgb, var(--ds-color-green-100) 10%, #fff)" }}>
              <span className="ds-strong ds-body-sm">{compact ? "Plantilla a usar" : "📋 Plantillas y Excel"}</span>
              {!compact && (
              <div className="row gap-2" style={{ alignItems: "center" }}>
                <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) importarExcel(f); }} />
                <Button variant="outline" onClick={descargarExcel}>⬇ Descargar Excel</Button>
                <Button variant="outline" onClick={() => fileRef.current?.click()}>⬆ Importar Excel</Button>
              </div>
              )}
            </div>
            {/* Cuerpo: plantillas guardadas (tarjetas) + guardar */}
            <div style={{ padding: 14 }}>
              <div className="row row--between wrap gap-3" style={{ alignItems: "center", marginBottom: 12 }}>
                <div className="row gap-2 wrap" style={{ alignItems: "center" }}>
                  <span className="ds-body-sm ds-strong">Plantillas guardadas</span>
                  {creadoresPlantillas.length > 1 && (
                    <div className="seg-mini">
                      <button type="button" className={filtroPlantilla === solicitante ? "is-active" : ""} onClick={() => setFiltroPlantilla(solicitante)}>Mías</button>
                      <button type="button" className={filtroPlantilla === "*" ? "is-active" : ""} onClick={() => setFiltroPlantilla("*")}>Todas</button>
                    </div>
                  )}
                  {plantillas.length > 4 && (
                    <input className="ds-form-field__input" style={{ maxWidth: 180, height: 34 }} placeholder="Buscar plantilla…"
                      value={buscarPlantilla} onChange={(e) => setBuscarPlantilla(e.target.value)} />
                  )}
                </div>
                {!compact && lineas.length > 0 && (
                  <div className="row gap-2" style={{ alignItems: "center" }}>
                    <input className="ds-form-field__input" style={{ maxWidth: 210, height: 38 }} placeholder="Guardar estas líneas como plantilla…" value={nombrePlantilla}
                      onChange={(e) => setNombrePlantilla(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") guardarComoPlantilla(); }} />
                    <Button variant="outline" onClick={guardarComoPlantilla}>Guardar</Button>
                  </div>
                )}
              </div>
              {plantillasVisibles.length > 0 ? (
                <div className="tpl-cards">
                  {plantillasVisibles.map((p) => (
                    <div key={p.id} className={`tpl-card ${plantillaCargada === String(p.id) ? "is-active" : ""}`} role="button" tabIndex={0} title={`Cargar "${p.nombre}" (reemplaza las líneas)`}
                      onClick={() => cargarPlantilla(String(p.id))}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); cargarPlantilla(String(p.id)); } }}>
                      <span className="tpl-card__name">{p.nombre}</span>
                      <span className="tpl-card__meta">{p.lineas.length} ítem(s){filtroPlantilla === "*" && p.creadoPor ? ` · ${p.creadoPor}` : ""}</span>
                      {p.creadoPor === solicitante && (
                        <button type="button" className="tpl-card__del" title="Borrar plantilla"
                          onClick={(e) => { e.stopPropagation(); borrarPlantilla(p.id); }}>×</button>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="ds-body-sm ds-muted" style={{ margin: 0 }}>
                  No hay plantillas guardadas todavía. Agregá materiales abajo y guardá la lista, o descargá el Excel para armarla en tu compu.
                </p>
              )}
            </div>
          </div>
        )}

        <div className="qa-box">
        {esMaterial && !compact && (
          <div className="row row--between wrap gap-2" style={{ alignItems: "flex-end", marginBottom: 10 }}>
            <div style={{ flex: "1 1 320px", minWidth: 240 }}>
              <label className="ds-label ds-muted" style={{ display: "block", marginBottom: 4 }}>Obra (se aplica a lo que agregás)</label>
              <Combobox items={catObras} value={obraTodas} onChange={(k) => setObraTodas(k)} getKey={(o) => o.id} getLabel={(o) => `${o.codigo} — ${o.nombre}`} placeholder="Buscá la obra…" />
            </div>
            {lineas.length > 0 && obraTodas && (
              <Button variant="ghost" size="sm" onClick={() => obraMasiva(obraTodas)} style={{ whiteSpace: "nowrap" }}>Aplicar a todas</Button>
            )}
          </div>
        )}
        <div className="qa-row" style={{ gridTemplateColumns: ["1fr", qaVariantes.length ? "190px" : null, "120px", "auto"].filter(Boolean).join(" ") }}>
          <div className="qa-field">
            <label>{esRepuesto ? "Repuesto" : "Material"}</label>
            <div className="combo">
              <input className="ds-form-field__input" placeholder="Buscar por código o nombre…" value={qaQuery}
                onChange={(e) => { setQaQuery(e.target.value); setQaArticuloId(""); setQaOpen(true); }}
                onFocus={() => setQaOpen(true)} onBlur={() => setTimeout(() => setQaOpen(false), 150)} />
              {qaOpen && (
                <div className="combo__menu">
                  {!q && <div className="combo__empty">Escribí para buscar…</div>}
                  {q && sugerencias.length === 0 && <div className="combo__empty">Sin coincidencias.</div>}
                  {sugerencias.map((a) => (
                    <button key={a.id} type="button" className="combo__item" onMouseDown={(e) => { e.preventDefault(); elegir(a); }}>
                      <strong>{a.code}</strong> — {a.descripcion} <small>· {a.unidad}</small>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          {qaVariantes.length > 0 && (
            <div className="qa-field">
              <label>Variante</label>
              <Combobox items={qaVariantes} value={qaVariante} onChange={(k) => setQaVariante(k)} getKey={(v) => v.code} getLabel={(v) => `${v.code} — ${v.descripcion}`} placeholder="Elegí variante…" />
            </div>
          )}
          <div className="qa-field">
            <label>Cantidad{qaArticulo ? ` (${qaArticulo.unidad})` : ""}</label>
            <input ref={cantRef} className="ds-form-field__input" type="number" min={0} value={qaCantidad} placeholder="0"
              onChange={(e) => setQaCantidad(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") agregar(); }} />
          </div>
          <Button onClick={agregar} disabled={!puedeAgregar} style={{ gap: "10px" }}><IconPlus size={20} /> Agregar</Button>
        </div>
        {qaArticuloId && qaVariantesError && (
          <p className="ds-body-sm" style={{ color: "var(--ds-color-red-100)", marginTop: 8 }}>
            No se pudieron cargar las variantes de este material. Si requiere variante, el pedido podría fallar en Business Central — avisá a proveeduría antes de continuar.
          </p>
        )}
        </div>

        <div className="ds-table-wrap mt-4" style={{ boxShadow: "none", border: "1.5px solid var(--ds-color-gray-100)" }}>
          <table className="ds-table">
            <thead>
              <tr>
                <th style={{ minWidth: 260 }}>{esRepuesto ? "Repuesto" : "Artículo"}</th>
                {esMaterial && <th>Obra</th>}
                <th>Unidad</th><th className="ds-num">Cantidad</th><th></th>
              </tr>
            </thead>
            <tbody>
              {lineas.length === 0 && (<tr><td colSpan={esMaterial ? 5 : 4}><div className="empty" style={{ padding: "28px 0" }}>Todavía no agregaste {esRepuesto ? "repuestos" : "materiales"}.</div></td></tr>)}
              {lineas.map((l) => {
                const a = catArticulos.find((x) => x.id === l.articuloId);
                const obraId = catObras.find((o) => o.codigo === l.obraCodigo)?.id ?? "";
                return (
                  <tr key={l.key}>
                    <td><span className="ds-strong">{a?.code}</span> <span className="ds-muted">— {a?.descripcion}</span>{l.variantCode ? <span className="ds-body-sm ds-muted"> · var. {l.variantCode}{l.variantNombre ? ` (${l.variantNombre})` : ""}</span> : ""}</td>
                    {esMaterial && (
                      <td style={{ minWidth: 220 }}>
                        <div style={!l.obraCodigo ? { outline: "1.5px solid var(--ds-color-red-100)", borderRadius: 12 } : undefined}>
                          <Combobox items={catObras} value={obraId} onChange={(k) => setLineObra(l.key, k)} getKey={(o) => o.id} getLabel={(o) => `${o.codigo} — ${o.nombre}`} placeholder="Asigná la obra…" />
                        </div>
                      </td>
                    )}
                    <td className="ds-muted">{a?.unidad ?? "—"}</td>
                    <td className="ds-num">
                      <input className="ds-form-field__input" type="number" min={0} value={l.cantidad}
                        onChange={(e) => setLineCantidad(l.key, e.target.value)}
                        style={{ width: 90, textAlign: "right", padding: "6px 10px" }} />
                    </td>
                    <td><button className="icon-btn" onClick={() => removeLine(l.key)} aria-label="Quitar"><IconTrash /></button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="row gap-3 mt-6" style={{ justifyContent: "flex-end" }}>
        <Button variant="outline" onClick={onCancelar}>Cancelar</Button>
        <Button onClick={onGuardar} disabled={!puedeGuardar || guardando}>{guardando ? "Guardando…" : textoBoton}</Button>
      </div>
    </>
  );
}
