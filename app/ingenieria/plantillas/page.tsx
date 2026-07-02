"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/shell";
import { Badge, Button, Card, Field, Input, Modal, useToast } from "@/components/ui";
import { Combobox } from "@/components/combobox";
import { useStore } from "@/lib/store";

type SubPartida = { id: number; codigo: string; nombre: string; partidaId: number | null };
type Partida = { id: number; codigo: string; nombre: string; etapaId: number | null };
type Etapa = { id: number; codigo: string; nombre: string };
type Wbs = { etapas: Etapa[]; partidas: Partida[]; subpartidas: SubPartida[] };
type Linea = { code: string; descripcion?: string; cantidad: number; unidad?: string; obraCodigo?: string };
type Plantilla = { id: number; nombre: string; creadoPor: string; idSubPartida: number | null; lineas: Linea[] };
type ItemBc = { code: string; descripcion: string; unidad: string };

export default function PlantillasPage() {
  const toast = useToast();
  const { usuario } = useStore();
  const [plantillas, setPlantillas] = useState<Plantilla[]>([]);
  const [wbs, setWbs] = useState<Wbs>({ etapas: [], partidas: [], subpartidas: [] });
  const [items, setItems] = useState<ItemBc[]>([]);
  const [buscar, setBuscar] = useState("");
  const [editor, setEditor] = useState<Plantilla | "new" | null>(null);

  async function recargar() {
    try {
      const [rp, rc] = await Promise.all([fetch("/api/plantillas"), fetch("/api/clasificaciones")]);
      const dp = await rp.json(); const dc = await rc.json();
      if (rp.ok) setPlantillas(dp.plantillas ?? []);
      if (rc.ok) setWbs({ etapas: dc.etapas ?? [], partidas: dc.partidas ?? [], subpartidas: dc.subpartidas ?? [] });
    } catch (e: any) { toast(String(e?.message ?? e), "error"); }
  }
  useEffect(() => { recargar(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    fetch("/api/bc/items").then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => { if (Array.isArray(d.items)) setItems(d.items.map((i: any) => ({ code: i.code, descripcion: i.descripcion, unidad: i.unidad || "UND" }))); })
      .catch(() => {});
  }, []);

  const subDe = (id: number | null) => wbs.subpartidas.find((s) => s.id === id);
  const partDe = (s?: SubPartida) => wbs.partidas.find((p) => p.id === s?.partidaId);
  const etapaDe = (p?: Partida) => wbs.etapas.find((e) => e.id === p?.etapaId);

  const visibles = useMemo(() => {
    const q = buscar.trim().toLowerCase();
    return plantillas.filter((pl) => {
      if (!q) return true;
      const s = subDe(pl.idSubPartida);
      return pl.nombre.toLowerCase().includes(q) || (s?.nombre.toLowerCase().includes(q) ?? false);
    });
  }, [plantillas, buscar, wbs]); // eslint-disable-line react-hooks/exhaustive-deps

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
            <p className="ds-muted">Cada plantilla se asocia a una clasificación (sub-partida) y trae sus líneas base. Ese amarre alimenta la matriz por obra.</p>
          </div>
          <Button onClick={() => setEditor("new")}>+ Nueva plantilla</Button>
        </div>

        <Card className="mt-2">
          <Field label="Buscar plantilla">
            <Input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Nombre o clasificación…" />
          </Field>
          <div className="ds-body-sm ds-muted mt-2">{visibles.length} plantilla(s)</div>
        </Card>

        <div className="mt-4" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
          {visibles.length === 0 && <div className="empty">No hay plantillas.</div>}
          {visibles.map((pl) => {
            const s = subDe(pl.idSubPartida); const p = partDe(s); const e = etapaDe(p);
            return (
              <Card key={pl.id} className="is-clickable" onClick={() => setEditor(pl)} style={{ cursor: "pointer" }}>
                <div className="row row--between" style={{ alignItems: "flex-start" }}>
                  <span className="ds-strong">{pl.nombre}</span>
                  <button className="icon-btn" title="Borrar" onClick={(ev) => { ev.stopPropagation(); borrar(pl); }}>×</button>
                </div>
                <div className="row gap-2 wrap mt-2">
                  {e && <Badge tone="gray">{e.nombre}</Badge>}
                  {s ? <Badge tone="green">{s.nombre}</Badge> : <Badge tone="red">Sin clasificación</Badge>}
                </div>
                <div className="ds-body-sm ds-muted mt-2">{pl.lineas.length} línea(s){p ? ` · Partida ${p.codigo}` : ""}</div>
              </Card>
            );
          })}
        </div>

        {editor && (
          <PlantillaEditor
            plantilla={editor === "new" ? null : editor}
            wbs={wbs} items={items} usuario={usuario ?? ""}
            onClose={() => setEditor(null)}
            onSaved={() => { setEditor(null); recargar(); }}
          />
        )}
      </main>
    </AppShell>
  );
}

function PlantillaEditor({ plantilla, wbs, items, usuario, onClose, onSaved }: {
  plantilla: Plantilla | null; wbs: Wbs; items: ItemBc[]; usuario: string; onClose: () => void; onSaved: () => void;
}) {
  const toast = useToast();
  const [nombre, setNombre] = useState(plantilla?.nombre ?? "");
  const [idSub, setIdSub] = useState<string>(plantilla?.idSubPartida ? String(plantilla.idSubPartida) : String(wbs.subpartidas[0]?.id ?? ""));
  const [lineas, setLineas] = useState<Linea[]>(plantilla?.lineas ?? []);
  const [qaCode, setQaCode] = useState(""); const [qaQty, setQaQty] = useState("");
  const [guardando, setGuardando] = useState(false);

  const sub = wbs.subpartidas.find((s) => String(s.id) === idSub);
  const part = wbs.partidas.find((p) => p.id === sub?.partidaId);
  const etapa = wbs.etapas.find((e) => e.id === part?.etapaId);

  function agregar() {
    const it = items.find((x) => x.code === qaCode);
    if (!it || !(Number(qaQty) > 0)) { toast("Elegí un artículo y una cantidad.", "error"); return; }
    setLineas((L) => [...L, { code: it.code, descripcion: it.descripcion, unidad: it.unidad, cantidad: Number(qaQty), obraCodigo: "" }]);
    setQaCode(""); setQaQty("");
  }
  const delLinea = (i: number) => setLineas((L) => L.filter((_, idx) => idx !== i));

  async function guardar() {
    if (!nombre.trim()) { toast("Poné un nombre.", "error"); return; }
    setGuardando(true);
    try {
      const body = { nombre: nombre.trim(), idSubPartida: idSub ? Number(idSub) : null, lineas, creadoPor: usuario, usuario };
      const r = plantilla
        ? await fetch(`/api/plantillas/${plantilla.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
        : await fetch("/api/plantillas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? "No se pudo guardar");
      toast(`Plantilla ${plantilla ? "actualizada" : "creada"}`, "success");
      onSaved();
    } catch (e: any) { toast(String(e?.message ?? e), "error"); setGuardando(false); }
  }

  return (
    <Modal title={plantilla ? "Editar plantilla" : "Nueva plantilla de pedido"} onClose={onClose}
      footer={<><Button variant="outline" onClick={onClose}>Cancelar</Button><Button onClick={guardar} disabled={guardando || !nombre.trim()}>{guardando ? "Guardando…" : "Guardar plantilla"}</Button></>}>
      <div className="grid-2">
        <Field label="Nombre de la plantilla">
          <Input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej. Pisos porcelanato 60x120" />
        </Field>
        <Field label="Clasificación (sub-partida)">
          <Combobox items={wbs.subpartidas} value={idSub} onChange={(k) => setIdSub(k)} getKey={(s) => String(s.id)}
            getLabel={(s) => `${s.codigo} · ${s.nombre}`} getSearch={(s) => `${s.codigo} ${s.nombre}`} placeholder="Buscar clasificación…" />
        </Field>
        <Field label="Partida (auto)"><Input value={part ? `${part.codigo} · ${part.nombre}` : "—"} readOnly /></Field>
        <Field label="Etapa (auto)"><Input value={etapa?.nombre ?? "—"} readOnly /></Field>
      </div>

      <div className="mt-4">
        <div className="row row--between" style={{ alignItems: "flex-end", marginBottom: 8 }}>
          <span className="ds-label ds-muted">Líneas de la plantilla</span>
        </div>
        <div className="row wrap gap-2" style={{ alignItems: "flex-end", marginBottom: 10 }}>
          <div style={{ flex: "1 1 260px", minWidth: 200 }}>
            <label className="ds-label ds-muted" style={{ display: "block", marginBottom: 4 }}>Artículo</label>
            <Combobox items={items} value={qaCode} onChange={(k) => setQaCode(k)} getKey={(i) => i.code} getLabel={(i) => `${i.code} — ${i.descripcion}`} getSearch={(i) => `${i.code} ${i.descripcion}`} placeholder="Buscar artículo…" />
          </div>
          <div><label className="ds-label ds-muted" style={{ display: "block", marginBottom: 4 }}>Cantidad</label><Input type="number" min={0} value={qaQty} onChange={(e) => setQaQty(e.target.value)} placeholder="0" style={{ width: 100 }} /></div>
          <Button variant="outline" onClick={agregar} disabled={!qaCode || !(Number(qaQty) > 0)}>+ Agregar</Button>
        </div>
        <div className="ds-table-wrap" style={{ boxShadow: "none", border: "1.5px solid var(--ds-color-gray-100)" }}>
          <table className="ds-table">
            <thead><tr><th>Artículo</th><th>Unidad</th><th className="ds-num">Cantidad</th><th></th></tr></thead>
            <tbody>
              {lineas.length === 0 && <tr><td colSpan={4}><div className="empty">Sin líneas. Agregá artículos.</div></td></tr>}
              {lineas.map((l, i) => (
                <tr key={i}>
                  <td><span className="ds-strong ds-body-sm">{l.code}</span> <span className="ds-muted">— {l.descripcion}</span></td>
                  <td className="ds-muted">{l.unidad ?? "—"}</td>
                  <td className="ds-num">{l.cantidad}</td>
                  <td className="ds-num"><button className="icon-btn" title="Quitar" onClick={() => delLinea(i)}>×</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
}
