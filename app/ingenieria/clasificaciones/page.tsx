"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/shell";
import { Badge, Button, Card, Field, Input, Modal, Select, useToast } from "@/components/ui";

type Etapa = { id: number; codigo: string; nombre: string };
type Partida = { id: number; codigo: string; nombre: string; etapaId: number | null };
type SubPartida = { id: number; codigo: string; nombre: string; partidaId: number | null };
type Clasif = { id: number; nombre: string; partidaId: number | null; subPartidaId: number | null };
type Wbs = { etapas: Etapa[]; partidas: Partida[]; subpartidas: SubPartida[]; clasificaciones: Clasif[] };

export default function ClasificacionesPage() {
  const toast = useToast();
  const [wbs, setWbs] = useState<Wbs>({ etapas: [], partidas: [], subpartidas: [], clasificaciones: [] });
  const [cargando, setCargando] = useState(true);
  const [fEtapa, setFEtapa] = useState(""); const [fPartida, setFPartida] = useState(""); const [fTexto, setFTexto] = useState("");
  const [modal, setModal] = useState(false);

  async function recargar() {
    setCargando(true);
    try {
      const r = await fetch("/api/clasificaciones"); const d = await r.json();
      if (r.ok) setWbs({ etapas: d.etapas ?? [], partidas: d.partidas ?? [], subpartidas: d.subpartidas ?? [], clasificaciones: d.clasificaciones ?? [] });
      else toast(d.error ?? "No se pudo cargar", "error");
    } catch (e: any) { toast(String(e?.message ?? e), "error"); }
    finally { setCargando(false); }
  }
  useEffect(() => { recargar(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Contexto (etapa/partida/subpartida) de una clasificación, cuelgue de donde cuelgue.
  const ctx = (c: Clasif) => {
    const sub = c.subPartidaId ? wbs.subpartidas.find((s) => s.id === c.subPartidaId) : undefined;
    const partida = wbs.partidas.find((p) => p.id === (c.partidaId ?? sub?.partidaId));
    const etapa = wbs.etapas.find((e) => e.id === partida?.etapaId);
    return { sub, partida, etapa };
  };
  const partidasFiltro = useMemo(() => wbs.partidas.filter((p) => !fEtapa || String(p.etapaId) === fEtapa), [wbs.partidas, fEtapa]);

  // Agrupar clasificaciones por partida, aplicando filtros.
  const grupos = useMemo(() => {
    const q = fTexto.trim().toLowerCase();
    const porPartida = new Map<number, { c: Clasif; sub?: SubPartida }[]>();
    for (const c of wbs.clasificaciones) {
      const { sub, partida, etapa } = ctx(c);
      if (!partida) continue;
      if (fEtapa && String(etapa?.id) !== fEtapa) continue;
      if (fPartida && String(partida.id) !== fPartida) continue;
      if (q && !c.nombre.toLowerCase().includes(q)) continue;
      if (!porPartida.has(partida.id)) porPartida.set(partida.id, []);
      porPartida.get(partida.id)!.push({ c, sub });
    }
    return wbs.partidas.filter((p) => porPartida.has(p.id)).map((p) => ({ partida: p, etapa: wbs.etapas.find((e) => e.id === p.etapaId), items: porPartida.get(p.id)! }));
  }, [wbs, fEtapa, fPartida, fTexto]); // eslint-disable-line react-hooks/exhaustive-deps

  const total = grupos.reduce((n, g) => n + g.items.length, 0);

  return (
    <AppShell role="ingenieria">
      <main className="page page--wide">
        <div className="page__head">
          <div className="page__title">
            <h1 className="ds-heading">Maestro de clasificaciones</h1>
            <p className="ds-muted">Clasificaciones que usa Ingeniería para su control. Cada una cuelga de una partida o de una sub-partida (y hereda su etapa). Las plantillas se amarran a estas clasificaciones.</p>
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
              <Input value={fTexto} onChange={(e) => setFTexto(e.target.value)} placeholder="Nombre…" />
            </Field>
          </div>
          <div className="ds-body-sm ds-muted mt-2">{total} clasificación(es) · {grupos.length} partida(s)</div>
        </Card>

        {cargando && <div className="empty mt-6">Cargando…</div>}
        <div className="mt-4" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {!cargando && grupos.length === 0 && <div className="empty">No hay clasificaciones. Creá la primera con “+ Nueva clasificación”.</div>}
          {grupos.map((g) => (
            <Card key={g.partida.id} style={{ padding: 0, overflow: "hidden" }}>
              <div className="row gap-3" style={{ alignItems: "center", padding: "12px 16px", borderBottom: "1.5px solid var(--ds-color-gray-100)", background: "color-mix(in srgb, var(--ds-color-green-100) 6%, #fff)" }}>
                {g.etapa && <Badge tone="gray">{g.etapa.nombre}</Badge>}
                <span className="ds-strong">{g.partida.nombre}</span>
                <span className="ds-muted ds-body-sm" style={{ fontFamily: "monospace" }}>{g.partida.codigo}</span>
                <span className="ds-muted ds-body-sm" style={{ marginLeft: "auto" }}>{g.items.length} clasificación(es)</span>
              </div>
              <div>
                {g.items.map(({ c, sub }) => (
                  <div key={c.id} className="row gap-3" style={{ alignItems: "center", padding: "10px 16px", borderTop: "1px solid var(--ds-color-gray-100)" }}>
                    <span className="ds-muted">↳</span>
                    <span className="ds-strong ds-body-sm">{c.nombre}</span>
                    {sub && <span className="ds-muted ds-body-sm">en {sub.codigo} · {sub.nombre}</span>}
                    <Badge tone={sub ? "yellow" : "green"}>{sub ? "Sub-partida" : "Partida"}</Badge>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>

        {modal && <NuevaClasifModal wbs={wbs} onClose={() => setModal(false)} onSaved={() => { setModal(false); recargar(); }} />}
      </main>
    </AppShell>
  );
}

function NuevaClasifModal({ wbs, onClose, onSaved }: { wbs: Wbs; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [etapaId, setEtapaId] = useState(String(wbs.etapas[0]?.id ?? ""));
  const partidas = wbs.partidas.filter((p) => String(p.etapaId) === etapaId);
  const [partidaId, setPartidaId] = useState(String(partidas[0]?.id ?? ""));
  const [nivel, setNivel] = useState<"partida" | "subpartida">("partida");
  const subs = wbs.subpartidas.filter((s) => String(s.partidaId) === partidaId);
  const [subId, setSubId] = useState("");
  const [nombre, setNombre] = useState("");
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    if (!nombre.trim() || !partidaId) { toast("Elegí partida y nombre.", "error"); return; }
    if (nivel === "subpartida" && !subId) { toast("Elegí la sub-partida.", "error"); return; }
    setGuardando(true);
    try {
      const payload = nivel === "partida" ? { nombre: nombre.trim(), partidaId: Number(partidaId) } : { nombre: nombre.trim(), subPartidaId: Number(subId) };
      const r = await fetch("/api/clasificaciones", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? "No se pudo guardar");
      toast("Clasificación creada", "success"); onSaved();
    } catch (e: any) { toast(String(e?.message ?? e), "error"); setGuardando(false); }
  }

  return (
    <Modal title="Nueva clasificación" onClose={onClose}
      footer={<><Button variant="outline" onClick={onClose}>Cancelar</Button><Button onClick={guardar} disabled={guardando || !nombre.trim()}>{guardando ? "Guardando…" : "Guardar"}</Button></>}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Field label="Etapa">
          <Select value={etapaId} onChange={(e) => { setEtapaId(e.target.value); const f = wbs.partidas.find((p) => String(p.etapaId) === e.target.value); setPartidaId(String(f?.id ?? "")); setSubId(""); }}>
            {wbs.etapas.map((e) => <option key={e.id} value={e.id}>{e.codigo} · {e.nombre}</option>)}
          </Select>
        </Field>
        <Field label="Partida">
          <Select value={partidaId} onChange={(e) => { setPartidaId(e.target.value); setSubId(""); }}>
            {partidas.map((p) => <option key={p.id} value={p.id}>{p.codigo} · {p.nombre}</option>)}
          </Select>
        </Field>
        <Field label="La clasificación cuelga de…">
          <Select value={nivel} onChange={(e) => setNivel(e.target.value as "partida" | "subpartida")}>
            <option value="partida">La partida</option>
            <option value="subpartida">Una sub-partida</option>
          </Select>
        </Field>
        {nivel === "subpartida" && (
          <Field label="Sub-partida">
            <Select value={subId} onChange={(e) => setSubId(e.target.value)}>
              <option value="">Elegí la sub-partida…</option>
              {subs.map((s) => <option key={s.id} value={s.id}>{s.codigo} · {s.nombre}</option>)}
            </Select>
          </Field>
        )}
        <Field label="Nombre de la clasificación">
          <Input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej. Pisos, Ventanería, Melamina…" />
        </Field>
      </div>
    </Modal>
  );
}
