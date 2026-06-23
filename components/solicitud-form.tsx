"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { Button, Card, Field, Select, Textarea, useToast } from "@/components/ui";
import { IconTrash } from "@/components/icons";
import { Combobox } from "@/components/combobox";
import { useStore, type NewPedidoInput } from "@/lib/store";
import type { Almacen, Articulo, Obra, Pedido, TipoSolicitud } from "@/lib/types";

interface DraftLine { key: string; articuloId: string; obraCodigo: string; obraNombre: string; variantCode: string; variantNombre: string; cantidad: string; }
type Variante = { code: string; descripcion: string };

// Personas que pueden solicitar material (rol Ingeniería).
const SOLICITANTES = ["Laura Ureña", "Loana", "Michael Thames", "Roger Solano"];

// ---- Plantillas (persistidas en SQL: dbo.PlantillaSolicitud) ----
type PlantillaLinea = { code: string; cantidad: number; obraCodigo: string };
type Plantilla = { id: number; nombre: string; creadoPor: string; lineas: PlantillaLinea[] };
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
}: {
  inicial?: SolicitudInicial;
  guardar: (input: NewPedidoInput) => Promise<void>;
  textoBoton: string;
  onCancelar: () => void;
}) {
  const { articulos, obras, maquinas, almacenes } = useStore();
  const toast = useToast();

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
  void bcAlm; void almacenes; // almacén ya no se usa al solicitar

  const obraNombreDe = (codigo: string) => catObras.find((o) => o.codigo === codigo)?.nombre ?? codigo;

  const [tipo, setTipo] = useState<TipoSolicitud>(inicial?.tipoSolicitud ?? "material");
  const [maquinaId, setMaquinaId] = useState("");
  const [solicitante, setSolicitante] = useState(inicial?.solicitante ?? SOLICITANTES[0]);
  const opcionesSolicitante = inicial?.solicitante && !SOLICITANTES.includes(inicial.solicitante)
    ? [inicial.solicitante, ...SOLICITANTES] : SOLICITANTES;
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

  const catalogo = useMemo(
    () => catArticulos.filter((a) => (tipo === "repuesto" ? a.code.startsWith("R") : !a.code.startsWith("R"))),
    [catArticulos, tipo]
  );

  // ---- alta rápida ----
  const [qaArticuloId, setQaArticuloId] = useState("");
  const [qaQuery, setQaQuery] = useState("");
  const [qaObraId, setQaObraId] = useState("");
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
  async function recargarPlantillas() {
    try {
      const r = await fetch("/api/plantillas");
      if (!r.ok) return;
      const data = await r.json();
      setPlantillas((data.plantillas ?? []) as Plantilla[]);
    } catch { /* sin DB, queda vacío */ }
  }
  useEffect(() => { recargarPlantillas(); }, []);
  // por defecto, cada quien ve las suyas
  useEffect(() => { if (solicitante && filtroPlantilla === "") setFiltroPlantilla(solicitante); }, [solicitante]); // eslint-disable-line react-hooks/exhaustive-deps

  const q = qaQuery.trim().toLowerCase();
  const sugerencias = useMemo(() => {
    const base = q ? catalogo.filter((a) => a.code.toLowerCase().includes(q) || a.descripcion.toLowerCase().includes(q)) : catalogo;
    return base.slice(0, 50);
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
  const puedeAgregar = !!qaArticuloId && Number(qaCantidad) > 0 && (tipo === "repuesto" || !!qaObraId) && !variantePendiente;

  function agregar() {
    if (!puedeAgregar) return;
    const obra = catObras.find((o) => o.id === qaObraId);
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
    setQaArticuloId(""); setQaQuery(""); setQaObraId(""); setQaCantidad(""); setQaOpen(false);
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
    setLineas((ls) => [...nuevas, ...ls]);
    toast(`Plantilla "${pl.nombre}" cargada (${nuevas.length} línea/s${sinMatch ? `, ${sinMatch} omitida/s` : ""}).`, "success");
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
  const plantillasVisibles = filtroPlantilla && filtroPlantilla !== "*"
    ? plantillas.filter((p) => p.creadoPor === filtroPlantilla)
    : plantillas;
  const creadoresPlantillas = useMemo(
    () => Array.from(new Set(plantillas.map((p) => p.creadoPor).filter(Boolean))).sort(),
    [plantillas]
  );
  function cambiarTipo(t: TipoSolicitud) {
    if (t === tipo) return;
    setTipo(t); setLineas([]); setMaquinaId("");
    setQaArticuloId(""); setQaQuery(""); setQaObraId(""); setQaCantidad("");
    setQaVariantes([]); setQaVariante(""); setQaVariantesError(false);
  }

  const destinoOk = tipo === "material" ? true : !!maquinaId;
  const lineasOk = tipo === "repuesto" ? lineas.every((l) => Number(l.cantidad) > 0)
    : lineas.every((l) => Number(l.cantidad) > 0 && !!l.obraCodigo);
  const lineasSinObra = tipo === "material" ? lineas.filter((l) => !l.obraCodigo).length : 0;
  const puedeGuardar = destinoOk && !!solicitante && lineas.length > 0 && lineasOk;
  const [guardando, setGuardando] = useState(false);

  async function onGuardar() {
    if (!puedeGuardar) {
      if (tipo === "material" && lineasSinObra > 0) toast(`Faltan ${lineasSinObra} línea(s) sin obra. Asignales la obra antes de guardar.`, "error");
      else if (tipo === "material" && lineas.some((l) => !(Number(l.cantidad) > 0))) toast("Hay líneas con cantidad en 0.", "error");
      else toast(tipo === "repuesto" ? "Indicá la máquina y al menos un repuesto." : "Agregá al menos un material (con su obra).", "error");
      return;
    }
    const maquina = maquinas.find((m) => m.id === maquinaId);
    // En material, la obra del encabezado se deriva de las líneas.
    const obrasUnicas = [...new Set(lineas.map((l) => l.obraCodigo))];
    const headerObraCodigo = tipo === "material" ? (obrasUnicas.length === 1 ? obrasUnicas[0] : "(varias)") : undefined;
    const headerObraNombre = tipo === "material"
      ? (obrasUnicas.length === 1 ? (obraNombreDe(obrasUnicas[0]) || obrasUnicas[0]) : "Varias obras")
      : undefined;
    setGuardando(true);
    try {
      await guardar({
        tipoSolicitud: tipo,
        obraCodigo: headerObraCodigo,
        obraNombre: headerObraNombre,
        maquinaNo: tipo === "repuesto" ? maquina?.no : undefined,
        maquinaNombre: tipo === "repuesto" ? maquina?.nombre : undefined,
        solicitante,
        prioridad,
        notas: notas.trim() || undefined,
        lineas: lineas.map((l) => {
          const a = catArticulos.find((x) => x.id === l.articuloId)!;
          return { articuloId: a.id, descripcion: a.descripcion, cantidad: Number(l.cantidad), unidad: a.unidad, almacen: tipo === "material" ? l.obraCodigo : "", variantCode: l.variantCode || undefined };
        }),
      });
    } catch (e: any) {
      toast(String(e?.message ?? e), "error");
      setGuardando(false);
    }
  }

  const esMaterial = tipo === "material";

  return (
    <>
      <Card>
        <div className="row gap-3" style={{ marginBottom: 20 }}>
          <button type="button" className={`role-option ${esMaterial ? "is-selected" : ""}`} style={{ flex: 1, padding: "12px 16px" }} onClick={() => cambiarTipo("material")}>
            <span className="col" style={{ gap: 2 }}><span className="role-option__title">Material</span><span className="role-option__desc">Va a una obra</span></span>
          </button>
          <button type="button" className={`role-option ${!esMaterial ? "is-selected" : ""}`} style={{ flex: 1, padding: "12px 16px" }} onClick={() => cambiarTipo("repuesto")}>
            <span className="col" style={{ gap: 2 }}><span className="role-option__title">Repuesto</span><span className="role-option__desc">Va a una máquina</span></span>
          </button>
        </div>

        <div className="grid-2">
          {!esMaterial && (
            <Field label="Máquina destino">
              <Combobox items={maquinas} value={maquinaId} onChange={(k) => setMaquinaId(k)} getKey={(m) => m.id} getLabel={(m) => `${m.no} — ${m.nombre}`} placeholder="Buscar máquina…" />
            </Field>
          )}
          <Field label="Solicitante">
            <Select value={solicitante} onChange={(e) => setSolicitante(e.target.value)}>
              {opcionesSolicitante.map((n) => <option key={n} value={n}>{n}</option>)}
            </Select>
          </Field>
          <Field label="Prioridad">
            <Select value={prioridad} onChange={(e) => setPrioridad(e.target.value as Pedido["prioridad"])}>
              <option value="normal">Normal</option><option value="alta">Alta</option><option value="urgente">Urgente</option>
            </Select>
          </Field>
          <Field label="Observaciones (opcional)"><Textarea value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Indicaciones para proveeduría…" /></Field>
        </div>
      </Card>

      <Card className="mt-4">
        <h3 className="ds-subtitle">{esMaterial ? "Materiales" : "Repuestos"}</h3>
        <p className="ds-muted ds-body-sm" style={{ marginBottom: 16 }}>
          Buscá el {esMaterial ? "material, elegí la obra" : "repuesto"} y la cantidad, y agregalo. Se van sumando a la lista.
        </p>

        {esMaterial && (
          <div className="row wrap gap-3" style={{ marginBottom: 16, alignItems: "flex-end", justifyContent: "space-between" }}>
            <div className="row gap-2" style={{ alignItems: "flex-end" }}>
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) importarExcel(f); }} />
              <Button variant="outline" onClick={() => fileRef.current?.click()}>Importar Excel</Button>
              {plantillas.length > 0 && (
                <>
                  <div className="qa-field" style={{ minWidth: 170 }}>
                    <label>Plantillas de</label>
                    <Select value={filtroPlantilla} onChange={(e) => setFiltroPlantilla(e.target.value)}>
                      <option value="*">Todas</option>
                      {creadoresPlantillas.map((c) => <option key={c} value={c}>{c === solicitante ? `Mías (${c})` : c}</option>)}
                    </Select>
                  </div>
                  <div className="qa-field" style={{ minWidth: 220 }}>
                    <label>Cargar plantilla</label>
                    <Select defaultValue="" onChange={(e) => { if (e.target.value) { cargarPlantilla(e.target.value); e.target.value = ""; } }}>
                      <option value="">{plantillasVisibles.length ? "Elegí una plantilla…" : "Sin plantillas para este filtro"}</option>
                      {plantillasVisibles.map((p) => <option key={p.id} value={p.id}>{p.nombre} ({p.lineas.length})</option>)}
                    </Select>
                  </div>
                </>
              )}
            </div>
            {lineas.length > 0 && (
              <div className="row gap-2" style={{ alignItems: "flex-end" }}>
                <div className="qa-field" style={{ minWidth: 200 }}>
                  <label>Guardar líneas como plantilla</label>
                  <input className="ds-form-field__input" placeholder="Nombre de la plantilla…" value={nombrePlantilla}
                    onChange={(e) => setNombrePlantilla(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") guardarComoPlantilla(); }} />
                </div>
                <Button variant="outline" onClick={guardarComoPlantilla}>Guardar plantilla</Button>
              </div>
            )}
          </div>
        )}
        {esMaterial && plantillasVisibles.length > 0 && (
          <div className="row wrap gap-2" style={{ marginBottom: 16 }}>
            {plantillasVisibles.map((p) => (
              <span key={p.id} className="ds-badge" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <button type="button" className="linklike" style={{ background: "none", border: "none", cursor: "pointer", padding: 0, font: "inherit", color: "inherit" }}
                  title="Cargar esta plantilla" onClick={() => cargarPlantilla(String(p.id))}>
                  {p.nombre} <small className="ds-muted">· {p.creadoPor}</small>
                </button>
                {p.creadoPor === solicitante && (
                  <button type="button" className="icon-btn" style={{ width: 18, height: 18 }} title="Borrar plantilla"
                    onClick={() => borrarPlantilla(p.id)}>×</button>
                )}
              </span>
            ))}
          </div>
        )}

        <div className="qa-row" style={{ gridTemplateColumns: ["1fr", qaVariantes.length ? "190px" : null, esMaterial ? "230px" : null, "110px", "auto"].filter(Boolean).join(" ") }}>
          <div className="qa-field">
            <label>{esMaterial ? "Material" : "Repuesto"}</label>
            <div className="combo">
              <input className="ds-form-field__input" placeholder="Buscar por código o nombre…" value={qaQuery}
                onChange={(e) => { setQaQuery(e.target.value); setQaArticuloId(""); setQaOpen(true); }}
                onFocus={() => setQaOpen(true)} onBlur={() => setTimeout(() => setQaOpen(false), 150)} />
              {qaOpen && (
                <div className="combo__menu">
                  {sugerencias.length === 0 && <div className="combo__empty">Sin coincidencias.</div>}
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
          {esMaterial && (
            <div className="qa-field">
              <label>Obra</label>
              <Combobox items={catObras} value={qaObraId} onChange={(k) => setQaObraId(k)} getKey={(o) => o.id} getLabel={(o) => `${o.codigo} — ${o.nombre}`} placeholder="Buscar obra…" />
            </div>
          )}
          <div className="qa-field">
            <label>Cantidad{qaArticulo ? ` (${qaArticulo.unidad})` : ""}</label>
            <input ref={cantRef} className="ds-form-field__input" type="number" min={0} value={qaCantidad} placeholder="0"
              onChange={(e) => setQaCantidad(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") agregar(); }} />
          </div>
          <Button onClick={agregar} disabled={!puedeAgregar}>+ Agregar</Button>
        </div>
        {qaArticuloId && qaVariantesError && (
          <p className="ds-body-sm" style={{ color: "var(--ds-color-red, #c96c6c)", marginTop: 8 }}>
            No se pudieron cargar las variantes de este material. Si requiere variante, el pedido podría fallar en Business Central — avisá a proveeduría antes de continuar.
          </p>
        )}

        <div className="ds-table-wrap mt-4" style={{ boxShadow: "none", border: "1.5px solid var(--ds-color-gray-100)" }}>
          <table className="ds-table">
            <thead>
              <tr>
                <th style={{ minWidth: 260 }}>{esMaterial ? "Artículo" : "Repuesto"}</th>
                {esMaterial && <th>Obra</th>}
                <th>Unidad</th><th className="ds-num">Cantidad</th><th></th>
              </tr>
            </thead>
            <tbody>
              {lineas.length === 0 && (<tr><td colSpan={esMaterial ? 5 : 4}><div className="empty" style={{ padding: "28px 0" }}>Todavía no agregaste {esMaterial ? "materiales" : "repuestos"}.</div></td></tr>)}
              {lineas.map((l) => {
                const a = catArticulos.find((x) => x.id === l.articuloId);
                const obraId = catObras.find((o) => o.codigo === l.obraCodigo)?.id ?? "";
                return (
                  <tr key={l.key}>
                    <td><span className="ds-strong">{a?.code}</span> <span className="ds-muted">— {a?.descripcion}</span>{l.variantCode ? <span className="ds-body-sm ds-muted"> · var. {l.variantCode}{l.variantNombre ? ` (${l.variantNombre})` : ""}</span> : ""}</td>
                    {esMaterial && (
                      <td style={{ minWidth: 220 }}>
                        <div style={!l.obraCodigo ? { outline: "1.5px solid var(--ds-color-red, #c96c6c)", borderRadius: 12 } : undefined}>
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
