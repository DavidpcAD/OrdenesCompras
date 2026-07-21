"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/shell";
import { Badge, Button, Card, Field, Input, Modal, Select, useToast } from "@/components/ui";
import { Combobox } from "@/components/combobox";
import { IconEdit } from "@/components/icons";
import { useStore } from "@/lib/store";

type Etapa = { id: number; codigo: string; nombre: string };
type Partida = { id: number; codigo: string; nombre: string; etapaId: number | null };
type SubPartida = { id: number; codigo: string; nombre: string; partidaId: number | null };
type Clasif = { id: number; nombre: string; partidaId: number | null; subPartidaId: number | null };
type Wbs = { etapas: Etapa[]; partidas: Partida[]; subpartidas: SubPartida[]; clasificaciones: Clasif[] };
type Linea = { code: string; descripcion?: string; cantidad: number; unidad?: string; obraCodigo?: string };
type Plantilla = { id: number; nombre: string; creadoPor: string; idClasificacion: number | null; lineas: Linea[] };
type ItemBc = { code: string; descripcion: string; unidad: string };

export default function PlantillasPage() {
  const toast = useToast();
  const { usuario } = useStore();
  const [plantillas, setPlantillas] = useState<Plantilla[]>([]);
  const [wbs, setWbs] = useState<Wbs>({ etapas: [], partidas: [], subpartidas: [], clasificaciones: [] });
  const [items, setItems] = useState<ItemBc[]>([]);
  const [buscar, setBuscar] = useState(""); const [fPartida, setFPartida] = useState("");
  const [editor, setEditor] = useState<Plantilla | "new" | null>(null);

  async function recargar() {
    try {
      const [rp, rc] = await Promise.all([fetch("/api/plantillas"), fetch("/api/clasificaciones")]);
      const dp = await rp.json(); const dc = await rc.json();
      if (rp.ok) setPlantillas(dp.plantillas ?? []);
      if (rc.ok) setWbs({ etapas: dc.etapas ?? [], partidas: dc.partidas ?? [], subpartidas: dc.subpartidas ?? [], clasificaciones: dc.clasificaciones ?? [] });
    } catch (e: any) { toast(String(e?.message ?? e), "error"); }
  }
  useEffect(() => { recargar(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    fetch("/api/bc/items").then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => { if (Array.isArray(d.items)) setItems(d.items.map((i: any) => ({ code: i.code, descripcion: i.descripcion, unidad: i.unidad || "UND" }))); })
      .catch(() => {});
  }, []);

  const clasDe = (id: number | null) => wbs.clasificaciones.find((c) => c.id === id);
  const ctxDeClas = (c?: Clasif) => {
    if (!c) return { partida: undefined as Partida | undefined, etapa: undefined as Etapa | undefined, sub: undefined as SubPartida | undefined };
    const sub = c.subPartidaId ? wbs.subpartidas.find((s) => s.id === c.subPartidaId) : undefined;
    const partida = wbs.partidas.find((p) => p.id === (c.partidaId ?? sub?.partidaId));
    const etapa = wbs.etapas.find((e) => e.id === partida?.etapaId);
    return { partida, etapa, sub };
  };

  const visibles = useMemo(() => {
    const q = buscar.trim().toLowerCase();
    return plantillas.filter((pl) => {
      const c = clasDe(pl.idClasificacion); const { partida } = ctxDeClas(c);
      if (fPartida && String(partida?.id) !== fPartida) return false;
      if (!q) return true;
      return pl.nombre.toLowerCase().includes(q) || (c?.nombre.toLowerCase().includes(q) ?? false);
    }).sort((a, b) => {
      // Ordenar por partida (código) → clasificación → nombre; sin clasificación al final.
      const pa = ctxDeClas(clasDe(a.idClasificacion)).partida?.codigo ?? "￿";
      const pb = ctxDeClas(clasDe(b.idClasificacion)).partida?.codigo ?? "￿";
      if (pa !== pb) return pa.localeCompare(pb, "es", { numeric: true });
      const ca = clasDe(a.idClasificacion)?.nombre ?? ""; const cb = clasDe(b.idClasificacion)?.nombre ?? "";
      if (ca !== cb) return ca.localeCompare(cb, "es", { numeric: true });
      return a.nombre.localeCompare(b.nombre, "es", { numeric: true });
    });
  }, [plantillas, buscar, fPartida, wbs]); // eslint-disable-line react-hooks/exhaustive-deps

  async function borrar(pl: Plantilla) {
    if (!confirm(`¿Borrar la plantilla "${pl.nombre}"?`)) return;
    try {
      const r = await fetch(`/api/plantillas/${pl.id}?usuario=${encodeURIComponent(usuario ?? "")}`, { method: "DELETE" });
      if (!r.ok) throw new Error("No se pudo borrar");
      toast("Plantilla borrada", "success"); recargar();
    } catch (e: any) { toast(String(e?.message ?? e), "error"); }
  }

  return (
    <AppShell role="ingenieria">
      <main className="page page--wide">
        <div className="page__head">
          <div className="page__title">
            <h1 className="ds-heading">Plantillas de pedido</h1>
            <p className="ds-muted">Cada plantilla trae sus líneas base. La clasificación es opcional: si la asignás, alimenta la matriz por obra; si no, la plantilla queda disponible para cualquier pedido.</p>
          </div>
          <Button onClick={() => setEditor("new")}>+ Nueva plantilla</Button>
        </div>

        <Card className="mt-2">
          <div className="grid-2">
            <Field label="Buscar plantilla"><Input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Nombre o clasificación…" /></Field>
            <Field label="Partida">
              <Select value={fPartida} onChange={(e) => setFPartida(e.target.value)}>
                <option value="">Todas las partidas</option>
                {wbs.partidas.map((p) => <option key={p.id} value={p.id}>{p.codigo} · {p.nombre}</option>)}
              </Select>
            </Field>
          </div>
          <div className="ds-body-sm ds-muted mt-2">{visibles.length} plantilla(s)</div>
        </Card>

        <div className="mt-4" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
          {visibles.length === 0 && <div className="empty">No hay plantillas.</div>}
          {visibles.map((pl) => {
            const c = clasDe(pl.idClasificacion); const { partida, etapa } = ctxDeClas(c);
            return (
              <Card key={pl.id} onClick={() => setEditor(pl)} style={{ cursor: "pointer" }}>
                <div className="row row--between" style={{ alignItems: "flex-start" }}>
                  <span className="ds-strong">{pl.nombre}</span>
                  <span className="row gap-1">
                    <button className="icon-btn" title="Editar plantilla" aria-label="Editar" onClick={(ev) => { ev.stopPropagation(); setEditor(pl); }}><IconEdit size={15} /></button>
                    <button className="icon-btn" title="Borrar" onClick={(ev) => { ev.stopPropagation(); borrar(pl); }}>×</button>
                  </span>
                </div>
                <div className="row gap-2 wrap mt-2">
                  {etapa && <Badge tone="gray">{etapa.nombre}</Badge>}
                  {c ? <Badge tone="green">{c.nombre}</Badge> : <Badge tone="red">Sin clasificación</Badge>}
                </div>
                <div className="ds-body-sm ds-muted mt-2">{pl.lineas.length} línea(s){partida ? ` · Partida ${partida.codigo}` : ""}</div>
              </Card>
            );
          })}
        </div>

        {editor && (
          <PlantillaEditor plantilla={editor === "new" ? null : editor} wbs={wbs} items={items} usuario={usuario ?? ""}
            onClose={() => setEditor(null)} onSaved={() => { setEditor(null); recargar(); }} />
        )}
      </main>
    </AppShell>
  );
}

function PlantillaEditor({ plantilla, wbs, items, usuario, onClose, onSaved }: {
  plantilla: Plantilla | null; wbs: Wbs; items: ItemBc[]; usuario: string; onClose: () => void; onSaved: () => void;
}) {
  const toast = useToast();
  // Contexto inicial desde la clasificación de la plantilla (si edita).
  const clasInicial = wbs.clasificaciones.find((c) => c.id === plantilla?.idClasificacion);
  const subInicial = clasInicial?.subPartidaId ? wbs.subpartidas.find((s) => s.id === clasInicial.subPartidaId) : undefined;
  const partInicial = wbs.partidas.find((p) => p.id === (clasInicial?.partidaId ?? subInicial?.partidaId));
  const [etapaId, setEtapaId] = useState(String(wbs.etapas.find((e) => e.id === partInicial?.etapaId)?.id ?? wbs.etapas[0]?.id ?? ""));
  const partidasEt = wbs.partidas.filter((p) => String(p.etapaId) === etapaId);
  const [partidaId, setPartidaId] = useState(String(partInicial?.id ?? partidasEt[0]?.id ?? ""));
  const [idClas, setIdClas] = useState(plantilla?.idClasificacion ? String(plantilla.idClasificacion) : "");
  const [nombre, setNombre] = useState(plantilla?.nombre ?? "");
  const [lineas, setLineas] = useState<Linea[]>(plantilla?.lineas ?? []);
  const [qaCode, setQaCode] = useState(""); const [qaQty, setQaQty] = useState("");
  const [guardando, setGuardando] = useState(false);
  // Stock actual en Business Central por material (código → total | null s/d | "…" cargando).
  const [stockBc, setStockBc] = useState<Record<string, number | null | "loading">>({});
  const codigosLineas = useMemo(() => [...new Set(lineas.map((l) => l.code).filter(Boolean))].join(","), [lineas]);
  useEffect(() => {
    const codes = codigosLineas ? codigosLineas.split(",") : [];
    const faltan = codes.filter((c) => !(c in stockBc));
    if (!faltan.length) return;
    setStockBc((s) => { const n = { ...s }; for (const c of faltan) n[c] = "loading"; return n; });
    let vivo = true;
    Promise.all(faltan.map(async (c) => {
      try {
        const r = await fetch(`/api/bc/existencias?itemNo=${encodeURIComponent(c)}`);
        const d = await r.json().catch(() => ({}));
        const tot = r.ok && Array.isArray(d.existencias)
          ? d.existencias.reduce((a: number, e: any) => a + (Number(e.cantidad) || 0), 0)
          : null;
        return [c, tot] as const;
      } catch { return [c, null] as const; }
    })).then((pares) => { if (vivo) setStockBc((s) => ({ ...s, ...Object.fromEntries(pares) })); });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codigosLineas]);

  // Clasificaciones bajo la partida elegida (directas o vía sus sub-partidas).
  const clasOpciones = useMemo(() => {
    const subsPartida = new Set(wbs.subpartidas.filter((s) => String(s.partidaId) === partidaId).map((s) => s.id));
    return wbs.clasificaciones.filter((c) => String(c.partidaId) === partidaId || (c.subPartidaId != null && subsPartida.has(c.subPartidaId)));
  }, [wbs, partidaId]);

  function agregar() {
    const it = items.find((x) => x.code === qaCode);
    if (!it || !(Number(qaQty) > 0)) { toast("Elegí un artículo y una cantidad.", "error"); return; }
    setLineas((L) => [...L, { code: it.code, descripcion: it.descripcion, unidad: it.unidad, cantidad: Number(qaQty), obraCodigo: "" }]);
    setQaCode(""); setQaQty("");
  }
  const delLinea = (i: number) => setLineas((L) => L.filter((_, idx) => idx !== i));
  const setLinea = (i: number, patch: Partial<Linea>) => setLineas((L) => L.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  async function guardar() {
    if (!nombre.trim()) { toast("Poné un nombre.", "error"); return; }
    setGuardando(true);
    try {
      const body = { nombre: nombre.trim(), idClasificacion: idClas ? Number(idClas) : null, lineas, creadoPor: usuario, usuario };
      const r = plantilla
        ? await fetch(`/api/plantillas/${plantilla.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
        : await fetch("/api/plantillas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? "No se pudo guardar");
      toast(`Plantilla ${plantilla ? "actualizada" : "creada"}`, "success"); onSaved();
    } catch (e: any) { toast(String(e?.message ?? e), "error"); setGuardando(false); }
  }

  return (
    <Modal title={plantilla ? "Editar plantilla" : "Nueva plantilla de pedido"} onClose={onClose}
      footer={<><Button variant="outline" onClick={onClose}>Cancelar</Button><Button onClick={guardar} disabled={guardando || !nombre.trim()}>{guardando ? "Guardando…" : "Guardar plantilla"}</Button></>}>
      <div className="grid-2">
        <Field label="Nombre de la plantilla"><Input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej. Pisos porcelanato 60x120" /></Field>
        <Field label="Etapa">
          <Select value={etapaId} onChange={(e) => { setEtapaId(e.target.value); const f = wbs.partidas.find((p) => String(p.etapaId) === e.target.value); setPartidaId(String(f?.id ?? "")); setIdClas(""); }}>
            {wbs.etapas.map((e) => <option key={e.id} value={e.id}>{e.codigo} · {e.nombre}</option>)}
          </Select>
        </Field>
        <Field label="Partida">
          <Select value={partidaId} onChange={(e) => { setPartidaId(e.target.value); setIdClas(""); }}>
            {partidasEt.map((p) => <option key={p.id} value={p.id}>{p.codigo} · {p.nombre}</option>)}
          </Select>
        </Field>
        <Field label="Clasificación (opcional)">
          <Select value={idClas} onChange={(e) => setIdClas(e.target.value)}>
            <option value="">Sin clasificación</option>
            {clasOpciones.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </Select>
        </Field>
      </div>

      <div className="mt-4">
        <span className="ds-label ds-muted">Líneas de la plantilla</span>
        <div className="row wrap gap-2" style={{ alignItems: "flex-end", margin: "8px 0 10px" }}>
          <div style={{ flex: "1 1 260px", minWidth: 200 }}>
            <label className="ds-label ds-muted" style={{ display: "block", marginBottom: 4 }}>Artículo</label>
            <Combobox items={items} value={qaCode} onChange={(k) => setQaCode(k)} getKey={(i) => i.code} getLabel={(i) => `${i.code} — ${i.descripcion}`} getSearch={(i) => `${i.code} ${i.descripcion}`} placeholder="Buscar artículo…" />
          </div>
          <div><label className="ds-label ds-muted" style={{ display: "block", marginBottom: 4 }}>Cantidad</label><Input type="number" min={0} value={qaQty} onChange={(e) => setQaQty(e.target.value)} placeholder="0" style={{ width: 100 }} /></div>
          <Button variant="outline" onClick={agregar} disabled={!qaCode || !(Number(qaQty) > 0)}>+ Agregar</Button>
        </div>
        <div className="ds-table-wrap" style={{ boxShadow: "none", border: "1.5px solid var(--ds-color-gray-100)" }}>
          <table className="ds-table">
            <thead><tr><th>Artículo</th><th>Unidad</th><th className="ds-num">Stock BC</th><th className="ds-num">Cantidad</th><th></th></tr></thead>
            <tbody>
              {lineas.length === 0 && <tr><td colSpan={5}><div className="empty">Sin líneas. Agregá artículos.</div></td></tr>}
              {lineas.map((l, i) => {
                const st = stockBc[l.code];
                return (
                <tr key={i}>
                  <td><span className="ds-strong ds-body-sm">{l.code}</span> <span className="ds-muted">— {l.descripcion}</span></td>
                  <td className="ds-muted">{l.unidad ?? "—"}</td>
                  <td className="ds-num">
                    {st === undefined || st === "loading"
                      ? <span className="ds-muted">…</span>
                      : st === null
                        ? <span className="ds-muted" title="Sin conexión a Business Central">s/d</span>
                        : <span className={st > 0 ? "ds-strong" : "ds-muted"}>{st.toLocaleString("es-CR")}</span>}
                  </td>
                  <td className="ds-num"><Input type="number" min={0} value={l.cantidad} onChange={(e) => setLinea(i, { cantidad: Number(e.target.value) })} style={{ width: 90, textAlign: "right", padding: "6px 10px" }} /></td>
                  <td className="ds-num"><button className="icon-btn icon-btn--quitar" title="Quitar" onClick={() => delLinea(i)}>×</button></td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
}
