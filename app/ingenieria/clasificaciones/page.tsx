"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/shell";
import { Badge, Button, Card, Field, Input, Modal, Select, useToast } from "@/components/ui";

type Etapa = { id: number; codigo: string; nombre: string };
type Partida = { id: number; codigo: string; nombre: string; etapaId: number | null };
type SubPartida = { id: number; codigo: string; nombre: string; partidaId: number | null };
type Wbs = { etapas: Etapa[]; partidas: Partida[]; subpartidas: SubPartida[] };

export default function ClasificacionesPage() {
  const toast = useToast();
  const [wbs, setWbs] = useState<Wbs>({ etapas: [], partidas: [], subpartidas: [] });
  const [cargando, setCargando] = useState(true);
  const [fEtapa, setFEtapa] = useState(""); const [fPartida, setFPartida] = useState(""); const [fTexto, setFTexto] = useState("");
  const [modal, setModal] = useState(false);

  async function recargar() {
    setCargando(true);
    try {
      const r = await fetch("/api/clasificaciones");
      const d = await r.json();
      if (r.ok) setWbs({ etapas: d.etapas ?? [], partidas: d.partidas ?? [], subpartidas: d.subpartidas ?? [] });
      else toast(d.error ?? "No se pudo cargar", "error");
    } catch (e: any) { toast(String(e?.message ?? e), "error"); }
    finally { setCargando(false); }
  }
  useEffect(() => { recargar(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const etapaDe = (p?: Partida) => wbs.etapas.find((e) => e.id === p?.etapaId);
  const partidasFiltro = useMemo(() => wbs.partidas.filter((p) => !fEtapa || String(p.etapaId) === fEtapa), [wbs.partidas, fEtapa]);

  // Agrupar sub_partidas por partida, aplicando filtros.
  const grupos = useMemo(() => {
    const q = fTexto.trim().toLowerCase();
    const porPartida = new Map<number, SubPartida[]>();
    for (const s of wbs.subpartidas) {
      const p = wbs.partidas.find((x) => x.id === s.partidaId);
      if (!p) continue;
      if (fEtapa && String(p.etapaId) !== fEtapa) continue;
      if (fPartida && String(s.partidaId) !== fPartida) continue;
      if (q && !s.nombre.toLowerCase().includes(q) && !s.codigo.toLowerCase().includes(q)) continue;
      if (!porPartida.has(p.id)) porPartida.set(p.id, []);
      porPartida.get(p.id)!.push(s);
    }
    return wbs.partidas.filter((p) => porPartida.has(p.id)).map((p) => ({ partida: p, etapa: etapaDe(p), items: porPartida.get(p.id)! }));
  }, [wbs, fEtapa, fPartida, fTexto]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalSub = grupos.reduce((n, g) => n + g.items.length, 0);

  return (
    <AppShell role="ingenieria">
      <main className="page page--wide">
        <div className="page__head">
          <div className="page__title">
            <h1 className="ds-heading">Maestro de clasificaciones</h1>
            <p className="ds-muted">Catálogo de clasificaciones (sub-partidas). Cada una vive dentro de una partida y hereda su etapa. Las plantillas se amarran a estas clasificaciones.</p>
          </div>
          <Button onClick={() => setModal(true)}>+ Nueva clasificación</Button>
        </div>

        <Card className="mt-2">
          <div className="grid-3">
            <Field label="Etapa">
              <Select value={fEtapa} onChange={(e) => { setFEtapa(e.target.value); setFPartida(""); }}>
                <option value="">Todas las etapas</option>
                {wbs.etapas.map((e) => <option key={e.id} value={e.id}>{e.codigo} · {e.nombre}</option>)}
              </Select>
            </Field>
            <Field label="Partida">
              <Select value={fPartida} onChange={(e) => setFPartida(e.target.value)}>
                <option value="">Todas las partidas</option>
                {partidasFiltro.map((p) => <option key={p.id} value={p.id}>{p.codigo} · {p.nombre}</option>)}
              </Select>
            </Field>
            <Field label="Buscar clasificación">
              <Input value={fTexto} onChange={(e) => setFTexto(e.target.value)} placeholder="Código o nombre…" />
            </Field>
          </div>
          <div className="ds-body-sm ds-muted mt-2">{totalSub} clasificación(es) · {grupos.length} partida(s)</div>
        </Card>

        {cargando && <div className="empty mt-6">Cargando…</div>}

        <div className="mt-4" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {!cargando && grupos.length === 0 && <div className="empty">No hay clasificaciones con esos filtros.</div>}
          {grupos.map((g) => (
            <Card key={g.partida.id} style={{ padding: 0, overflow: "hidden" }}>
              <div className="row gap-3" style={{ alignItems: "center", padding: "12px 16px", borderBottom: "1.5px solid var(--ds-color-gray-100)", background: "var(--ds-color-gray-50, #f8fafc)" }}>
                {g.etapa && <Badge tone="gray">{g.etapa.nombre}</Badge>}
                <span className="ds-strong">{g.partida.nombre}</span>
                <span className="ds-muted ds-body-sm" style={{ fontFamily: "monospace" }}>{g.partida.codigo}</span>
                <span className="ds-muted ds-body-sm" style={{ marginLeft: "auto" }}>{g.items.length} clasificación(es)</span>
              </div>
              <div>
                {g.items.map((s) => (
                  <div key={s.id} className="row gap-3" style={{ alignItems: "center", padding: "10px 16px", borderTop: "1px solid var(--ds-color-gray-100)" }}>
                    <span className="ds-muted">↳</span>
                    <span className="ds-strong ds-body-sm">{s.nombre}</span>
                    <span className="ds-muted ds-body-sm" style={{ fontFamily: "monospace" }}>{s.codigo}</span>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>

        {modal && <NuevaClasificacionModal wbs={wbs} onClose={() => setModal(false)} onSaved={() => { setModal(false); recargar(); }} />}
      </main>
    </AppShell>
  );
}

function NuevaClasificacionModal({ wbs, onClose, onSaved }: { wbs: Wbs; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [etapaId, setEtapaId] = useState(String(wbs.etapas[0]?.id ?? ""));
  const partidas = wbs.partidas.filter((p) => String(p.etapaId) === etapaId);
  const [partidaId, setPartidaId] = useState(String(partidas[0]?.id ?? ""));
  const [nombre, setNombre] = useState("");
  const [guardando, setGuardando] = useState(false);
  const partidaSel = wbs.partidas.find((p) => String(p.id) === partidaId);

  async function guardar() {
    if (!partidaId || !nombre.trim()) { toast("Elegí la partida y el nombre.", "error"); return; }
    setGuardando(true);
    try {
      const r = await fetch("/api/clasificaciones", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ partidaId: Number(partidaId), nombre: nombre.trim() }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? "No se pudo guardar");
      toast("Clasificación creada", "success");
      onSaved();
    } catch (e: any) { toast(String(e?.message ?? e), "error"); setGuardando(false); }
  }

  return (
    <Modal title="Nueva clasificación" onClose={onClose}
      footer={<><Button variant="outline" onClick={onClose}>Cancelar</Button><Button onClick={guardar} disabled={guardando || !nombre.trim()}>{guardando ? "Guardando…" : "Guardar"}</Button></>}>
      <p className="ds-muted ds-body-sm" style={{ marginBottom: 12 }}>La jerarquía se resuelve sola: al elegir la partida queda amarrada su etapa. El código se genera automático.</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Field label="Etapa">
          <Select value={etapaId} onChange={(e) => { setEtapaId(e.target.value); const first = wbs.partidas.find((p) => String(p.etapaId) === e.target.value); setPartidaId(String(first?.id ?? "")); }}>
            {wbs.etapas.map((e) => <option key={e.id} value={e.id}>{e.codigo} · {e.nombre}</option>)}
          </Select>
        </Field>
        <Field label="Partida">
          <Select value={partidaId} onChange={(e) => setPartidaId(e.target.value)}>
            {partidas.map((p) => <option key={p.id} value={p.id}>{p.codigo} · {p.nombre}</option>)}
          </Select>
        </Field>
        <Field label="Nombre de la clasificación">
          <Input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej. Pisos, Ventanería, Melamina…" />
        </Field>
        <div className="ds-body-sm ds-muted">Se guardará en: {wbs.etapas.find((e) => String(e.id) === etapaId)?.nombre} → {partidaSel?.nombre} → <span className="ds-strong">{nombre || "…"}</span></div>
      </div>
    </Modal>
  );
}
