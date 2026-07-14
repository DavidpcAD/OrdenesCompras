"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import * as XLSX from "xlsx";
import { Button, Card, Field, Select, Textarea, useToast } from "@/components/ui";
import { IconTrash, IconPlus } from "@/components/icons";
import { Combobox } from "@/components/combobox";
import { SlideConfirm } from "@/components/slide-confirm";
import { useStore, type NewPedidoInput } from "@/lib/store";
import type { Almacen, Articulo, Obra, Pedido, TipoSolicitud } from "@/lib/types";

interface DraftLine { key: string; articuloId: string; obraCodigo: string; obraNombre: string; variantCode: string; variantNombre: string; cantidad: string; }
type Variante = { code: string; descripcion: string };

// Personas que pueden solicitar material (rol Ingeniería).
const SOLICITANTES = ["Laura Ureña", "Loana", "Michael Thames", "Roger Solano"];

// ---- Plantillas (persistidas en SQL: dbo.PlantillaSolicitud) ----
type PlantillaLinea = { code: string; cantidad: number; obraCodigo: string };
type Plantilla = { id: number; nombre: string; creadoPor: string; idClasificacion?: number | null; lineas: PlantillaLinea[] };
// WBS para filtrar plantillas por etapa/partida.
type WbsNodo = { id: number; codigo: string; nombre: string };
type WbsPartida = { id: number; codigo: string; nombre: string; etapaId: number | null };
type WbsSubPartida = { id: number; codigo: string; nombre: string; partidaId: number | null };
type WbsClasif = { id: number; nombre: string; partidaId: number | null; subPartidaId: number | null };
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
  guardarSecundario,
  textoBotonSecundario,
  onCancelar,
  obraPreset,
  clasifPreset,
  compact,
}: {
  inicial?: SolicitudInicial;
  guardar: (input: NewPedidoInput) => Promise<void>;
  textoBoton: string;
  // Acción secundaria opcional (p.ej. "Crear y enviar a proveeduría" en la Matriz).
  guardarSecundario?: (input: NewPedidoInput) => Promise<void>;
  textoBotonSecundario?: string;
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
  // Reactivo (no useState): si viene clasifPreset de la Matriz, siempre se manda.
  const idClasificacion: number | null = clasifParam ? Number(clasifParam) : null;

  const [bcArt, setBcArt] = useState<Articulo[] | null>(null);
  const [bcObras, setBcObras] = useState<Obra[] | null>(null);
  const [bcAlm, setBcAlm] = useState<Almacen[] | null>(null);
  // El catálogo de BC ya terminó de cargar (con éxito o no). Evita autocargar una
  // plantilla contra el catálogo seed y disparar "no coincide" por una carrera.
  const [catalogoCargado, setCatalogoCargado] = useState(false);

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
      finally { if (!cancel) setCatalogoCargado(true); }
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

  // Catálogo de ítems. La antigua convención "código empieza con R = repuesto" NO
  // existe en el catálogo real de BC (los ítems son M01-…, M13-…), así que dejaba
  // el buscador de Repuesto vacío. Mostramos el catálogo completo para todos los
  // tipos; el tipo define el DESTINO (obra/máquina/bodega), no qué ítems se pueden
  // pedir. (Si más adelante hay una categoría de BC para repuestos, se filtra acá.)
  const catalogo = catArticulos;

  // ---- alta rápida ----
  const [qaArticuloId, setQaArticuloId] = useState("");
  const [qaQuery, setQaQuery] = useState("");
  const [qaCantidad, setQaCantidad] = useState("");
  const [qaOpen, setQaOpen] = useState(false);
  const [qaVariantes, setQaVariantes] = useState<Variante[]>([]);
  const [qaVariante, setQaVariante] = useState("");
  const [qaVariantesError, setQaVariantesError] = useState(false);

  // Variantes por CÓDIGO de artículo, para EXIGIRLAS por línea (no solo al
  // agregar a mano). Así un material que requiere variante no puede salir del
  // pedido sin ella, venga de donde venga (manual, Excel, plantilla o Matriz).
  const [varMap, setVarMap] = useState<Record<string, { variantes: Variante[]; disponible: boolean }>>({});
  const varPromises = useRef<Map<string, Promise<{ variantes: Variante[]; disponible: boolean }>>>(new Map());
  const codeDeLinea = (l: DraftLine) => catArticulos.find((a) => a.id === l.articuloId)?.code ?? "";
  function getVariantes(code: string): Promise<{ variantes: Variante[]; disponible: boolean }> {
    if (!code) return Promise.resolve({ variantes: [], disponible: true });
    const cached = varPromises.current.get(code);
    if (cached) return cached;
    const p = fetch(`/api/bc/variants?item=${encodeURIComponent(code)}`)
      .then((r) => (r.ok ? r.json() : { variantes: [], disponible: false }))
      .then((d) => ({ variantes: (d.variantes ?? []) as Variante[], disponible: d.disponible !== false }))
      .catch(() => ({ variantes: [] as Variante[], disponible: false }));
    varPromises.current.set(code, p);
    p.then((res) => setVarMap((m) => ({ ...m, [code]: res })));
    return p;
  }
  // Precarga las variantes de todas las líneas del borrador.
  useEffect(() => {
    for (const l of lineas) { const c = codeDeLinea(l); if (c) getVariantes(c); }
  }, [lineas, catArticulos]); // eslint-disable-line react-hooks/exhaustive-deps
  const varDeLinea = (l: DraftLine) => varMap[codeDeLinea(l)];
  // "Necesita variante": el artículo tiene variantes en BC y la línea no eligió ninguna.
  const lineaNecesitaVariante = (l: DraftLine) => { const v = varDeLinea(l); return !!v && v.variantes.length > 0 && !l.variantCode; };
  function setLineVariante(key: string, code: string) {
    setLineas((ls) => ls.map((l) => {
      if (l.key !== key) return l;
      const found = varDeLinea(l)?.variantes.find((x) => x.code === code);
      return { ...l, variantCode: code, variantNombre: found?.descripcion ?? "" };
    }));
  }
  const cantRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // ---- plantillas (SQL) ----
  const [plantillas, setPlantillas] = useState<Plantilla[]>([]);
  const [nombrePlantilla, setNombrePlantilla] = useState("");
  const [filtroPlantilla, setFiltroPlantilla] = useState<string>(""); // "" = todas; o creadoPor
  const [buscarPlantilla, setBuscarPlantilla] = useState("");
  const [plantillaCargada, setPlantillaCargada] = useState<string>("");
  const [obraTodas, setObraTodas] = useState("");
  // Filtros de plantillas por etapa/partida (cuando hay muchas). Requiere el WBS.
  const [fEtapaPl, setFEtapaPl] = useState("");
  const [fPartidaPl, setFPartidaPl] = useState("");
  const [wbs, setWbs] = useState<{ etapas: WbsNodo[]; partidas: WbsPartida[]; subpartidas: WbsSubPartida[]; clasificaciones: WbsClasif[] }>({ etapas: [], partidas: [], subpartidas: [], clasificaciones: [] });
  async function recargarPlantillas() {
    try {
      const r = await fetch("/api/plantillas");
      if (!r.ok) return;
      const data = await r.json();
      setPlantillas((data.plantillas ?? []) as Plantilla[]);
    } catch { /* sin DB, queda vacío */ }
  }
  useEffect(() => { recargarPlantillas(); }, []);
  useEffect(() => {
    fetch("/api/clasificaciones").then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (d) setWbs({ etapas: d.etapas ?? [], partidas: d.partidas ?? [], subpartidas: d.subpartidas ?? [], clasificaciones: d.clasificaciones ?? [] });
    }).catch(() => { /* sin WBS, filtros vacíos */ });
  }, []);
  // clasificación -> partida/etapa (para filtrar y etiquetar plantillas).
  const ctxDeClasPl = (idClas?: number | null) => {
    const c = idClas != null ? wbs.clasificaciones.find((x) => x.id === idClas) : undefined;
    const sub = c?.subPartidaId ? wbs.subpartidas.find((s) => s.id === c.subPartidaId) : undefined;
    const partida = c ? wbs.partidas.find((p) => p.id === (c.partidaId ?? sub?.partidaId)) : undefined;
    const etapa = wbs.etapas.find((e) => e.id === partida?.etapaId);
    return { partida, etapa };
  };
  const partidasDeEtapaPl = useMemo(() => wbs.partidas.filter((p) => !fEtapaPl || String(p.etapaId) === fEtapaPl), [wbs.partidas, fEtapaPl]);
  // Prefill desde la Matriz: carga la plantilla de esa clasificación y fija la obra.
  useEffect(() => {
    if (!clasifParam || plantillas.length === 0 || !catalogoCargado) return;
    const pl = plantillas.find((p) => Number(p.idClasificacion) === Number(clasifParam));
    if (pl) cargarPlantilla(String(pl.id), true);
  }, [plantillas, catalogoCargado]); // eslint-disable-line react-hooks/exhaustive-deps
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
  // Obra FIJA (celda de Matriz / deep-link ?obra=): el pedido se arma para una obra
  // ya elegida, así que la forzamos en TODAS las líneas (incluidas las de plantilla)
  // y no se puede cambiar por línea.
  useEffect(() => {
    if (!obraParam || tipo !== "material") return;
    // Forzamos el CÓDIGO del preset aunque la obra no esté en el catálogo del form
    // (la Matriz usa dbo.Obra.numeroObra, que puede no venir en el catálogo BC/seed).
    // Así el encabezado del pedido queda con la obra real y no "(varias)".
    const o = catObras.find((x) => x.codigo === obraParam);
    const code = o?.codigo ?? obraParam;
    const nombre = o?.nombre ?? "";
    setLineas((ls) => (ls.some((l) => l.obraCodigo !== code)
      ? ls.map((l) => ({ ...l, obraCodigo: code, obraNombre: nombre }))
      : ls));
  }, [obraParam, catObras, lineas, tipo]); // eslint-disable-line react-hooks/exhaustive-deps

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
  // En material se exige obra; pero si viene fija por preset (Matriz), esa alcanza.
  const puedeAgregar = !!qaArticuloId && Number(qaCantidad) > 0 && (tipo === "material" ? (!!obraTodas || !!obraParam) : true) && !variantePendiente;

  function agregar() {
    if (!puedeAgregar) return;
    const obra = catObras.find((o) => o.id === obraTodas);
    const variante = qaVariantes.find((v) => v.code === qaVariante);
    // Si la obra viene fija por preset (Matriz) y no está en el catálogo, usamos el código del preset.
    const obraCode = tipo === "material" ? (obra?.codigo ?? obraParam ?? "") : "";
    setLineas((ls) => [{
      key: Math.random().toString(36).slice(2),
      articuloId: qaArticuloId,
      obraCodigo: obraCode,
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
  function cargarPlantilla(id: string, auto = false) {
    const pl = plantillas.find((p) => String(p.id) === String(id));
    if (!pl) return;
    const { nuevas, sinMatch } = lineasDesde(pl.lineas);
    if (!nuevas.length) {
      // En autocarga no molestamos; en manual avisamos suave (no rojo).
      if (!auto) toast(`La plantilla "${pl.nombre}" tiene materiales que ya no están en el catálogo. Buscalos manualmente.`, "info");
      return;
    }
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
  const plantillasVisibles = plantillas
    // En contexto de una clasificación (Matriz), SOLO las plantillas de esa clasificación.
    .filter((p) => idClasificacion == null || Number(p.idClasificacion) === Number(idClasificacion))
    .filter((p) => (filtroPlantilla && filtroPlantilla !== "*" ? p.creadoPor === filtroPlantilla : true))
    // Filtros por etapa/partida (para acotar cuando hay muchas plantillas).
    .filter((p) => {
      if (!fEtapaPl && !fPartidaPl) return true;
      const { etapa, partida } = ctxDeClasPl(p.idClasificacion);
      if (fEtapaPl && String(etapa?.id) !== fEtapaPl) return false;
      if (fPartidaPl && String(partida?.id) !== fPartidaPl) return false;
      return true;
    })
    .filter((p) => { const q = buscarPlantilla.trim().toLowerCase(); return !q || p.nombre.toLowerCase().includes(q); });
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
  const lineasSinVariante = lineas.filter(lineaNecesitaVariante).length;
  const puedeGuardar = destinoOk && !!solicitante && lineas.length > 0 && lineasOk && lineasSinVariante === 0;
  const [guardando, setGuardando] = useState(false);

  async function onGuardar(handler: (input: NewPedidoInput) => Promise<void> = guardar) {
    if (!puedeGuardar) {
      if (tipo === "material" && lineasSinObra > 0) toast(`Faltan ${lineasSinObra} línea(s) sin obra. Asignales la obra antes de guardar.`, "error");
      else if (tipo === "material" && lineas.some((l) => !(Number(l.cantidad) > 0))) toast("Hay líneas con cantidad en 0.", "error");
      else if (lineasSinVariante > 0) toast(`${lineasSinVariante} línea(s) requieren elegir variante antes de continuar.`, "error");
      else toast(tipo === "repuesto" ? "Indicá la máquina y al menos un repuesto." : tipo === "stock" ? "Indicá la bodega y al menos un material." : "Agregá al menos un material (con su obra).", "error");
      return;
    }
    // Garantía final: verificamos contra BC que ninguna línea salga sin su
    // variante si el artículo la exige (cubre Excel/plantilla/Matriz aunque el
    // catálogo aún no se hubiera precargado en pantalla).
    const codes = Array.from(new Set(lineas.map(codeDeLinea).filter(Boolean)));
    const reslist = await Promise.all(codes.map(getVariantes));
    const porCode = new Map(codes.map((c, i) => [c, reslist[i]]));
    const faltan = lineas.filter((l) => { const v = porCode.get(codeDeLinea(l)); return !!v && v.variantes.length > 0 && !l.variantCode; });
    if (faltan.length) { toast(`${faltan.length} línea(s) requieren elegir variante antes de continuar.`, "error"); return; }
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
      await handler({
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

        {(esMaterial || esStock) && (
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
                  {!compact && wbs.etapas.length > 0 && (
                    <>
                      <div style={{ minWidth: 150 }}>
                        <Select value={fEtapaPl} onChange={(e) => { setFEtapaPl(e.target.value); setFPartidaPl(""); }}>
                          <option value="">Todas las etapas</option>
                          {wbs.etapas.map((et) => <option key={et.id} value={et.id}>{et.codigo} · {et.nombre}</option>)}
                        </Select>
                      </div>
                      <div style={{ minWidth: 170 }}>
                        <Select value={fPartidaPl} onChange={(e) => setFPartidaPl(e.target.value)}>
                          <option value="">Todas las partidas</option>
                          {partidasDeEtapaPl.map((p) => <option key={p.id} value={p.id}>{p.codigo} · {p.nombre}</option>)}
                        </Select>
                      </div>
                    </>
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
                  {idClasificacion != null
                    ? "No hay plantillas para esta clasificación todavía. Buscá el material abajo y agregalo."
                    : "No hay plantillas guardadas todavía. Agregá materiales abajo y guardá la lista, o descargá el Excel para armarla en tu compu."}
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
                <th>Variante</th>
                <th className="ds-num">Cantidad</th><th>Unidad</th><th></th>
              </tr>
            </thead>
            <tbody>
              {lineas.length === 0 && (<tr><td colSpan={esMaterial ? 6 : 5}><div className="empty" style={{ padding: "28px 0" }}>Todavía no agregaste {esRepuesto ? "repuestos" : "materiales"}.</div></td></tr>)}
              {lineas.map((l) => {
                const a = catArticulos.find((x) => x.id === l.articuloId);
                const obraId = catObras.find((o) => o.codigo === l.obraCodigo)?.id ?? "";
                return (
                  <tr key={l.key}>
                    <td><span className="ds-strong">{a?.code}</span> <span className="ds-muted">— {a?.descripcion}</span></td>
                    {esMaterial && (
                      <td style={{ minWidth: 220 }}>
                        {obraParam ? (
                          // Obra fija por la celda de la Matriz: se muestra, no se edita.
                          <span className="ds-body-sm">{l.obraNombre ? `${l.obraCodigo} — ${l.obraNombre}` : (l.obraCodigo || obraParam)}</span>
                        ) : (
                          <div style={!l.obraCodigo ? { outline: "1.5px solid var(--ds-color-red-100)", borderRadius: 12 } : undefined}>
                            <Combobox items={catObras} value={obraId} onChange={(k) => setLineObra(l.key, k)} getKey={(o) => o.id} getLabel={(o) => `${o.codigo} — ${o.nombre}`} placeholder="Asigná la obra…" />
                          </div>
                        )}
                      </td>
                    )}
                    <td style={{ minWidth: 200 }}>
                      {(() => {
                        const v = varDeLinea(l);
                        if (!v) return <span className="ds-muted ds-body-sm">…</span>;
                        if (v.variantes.length === 0) return <span className="ds-muted ds-body-sm">{v.disponible ? "—" : "sin verificar"}</span>;
                        return (
                          <div style={!l.variantCode ? { outline: "1.5px solid var(--ds-color-red-100)", borderRadius: 12 } : undefined}>
                            <Combobox items={v.variantes} value={l.variantCode} onChange={(k) => setLineVariante(l.key, k)} getKey={(x) => x.code} getLabel={(x) => `${x.code} — ${x.descripcion}`} placeholder="Falta variante…" />
                          </div>
                        );
                      })()}
                    </td>
                    <td className="ds-num">
                      <input className="ds-form-field__input" type="number" min={0} value={l.cantidad}
                        onChange={(e) => setLineCantidad(l.key, e.target.value)}
                        style={{ width: 90, textAlign: "right", padding: "6px 10px" }} />
                    </td>
                    <td className="ds-muted">{a?.unidad ?? "—"}</td>
                    <td><button className="icon-btn icon-btn--quitar" onClick={() => removeLine(l.key)} aria-label="Quitar" title="Quitar"><IconTrash size={18} /></button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Acciones secundarias arriba; el "pedir" primario es un slide-to-confirm (DS). */}
      <div className="mt-6" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="row gap-3" style={{ justifyContent: "flex-end" }}>
          <Button variant="outline" onClick={onCancelar}>Cancelar</Button>
          {guardarSecundario && textoBotonSecundario && (
            <Button variant="outline" onClick={() => onGuardar(guardarSecundario)} disabled={!puedeGuardar || guardando}>{textoBotonSecundario}</Button>
          )}
        </div>
        <SlideConfirm oneWay approveLabel={textoBoton} busy={guardando} disabled={!puedeGuardar} onApprove={() => onGuardar()} height={60} />
      </div>
    </>
  );
}
