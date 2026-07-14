"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/shell";
import { Badge, Button, Card, Field, Input, Modal, Select, useToast } from "@/components/ui";
import { IconEdit } from "@/components/icons";

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
  const [editar, setEditar] = useState<Clasif | null>(null);

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

  const ctx = (c: Clasif) => {
    const partida = wbs.partidas.find((p) => p.id === c.partidaId);
    const etapa = wbs.etapas.find((e) => e.id === partida?.etapaId);
    return { partida, etapa };
  };
  const partidasFiltro = useMemo(() => wbs.partidas.filter((p) => !fEtapa || String(p.etapaId) === fEtapa), [wbs.partidas, fEtapa]);

  // Agrupación anidada etapa → partida → clasificaciones, con filtros.
  const secciones = useMemo(() => {
    const q = fTexto.trim().toLowerCase();
    const byEtapa = new Map<number, Map<number, Clasif[]>>();
    for (const c of wbs.clasificaciones) {
      const { partida, etapa } = ctx(c);
      if (!partida || !etapa) continue;
      if (fEtapa && String(etapa.id) !== fEtapa) continue;
      if (fPartida && String(partida.id) !== fPartida) continue;
      if (q && !c.nombre.toLowerCase().includes(q)) continue;
      if (!byEtapa.has(etapa.id)) byEtapa.set(etapa.id, new Map());
      const pm = byEtapa.get(etapa.id)!;
      if (!pm.has(partida.id)) pm.set(partida.id, []);
      pm.get(partida.id)!.push(c);
    }
    return wbs.etapas.filter((e) => byEtapa.has(e.id)).map((etapa) => ({
      etapa,
      partidas: wbs.partidas.filter((p) => p.etapaId === etapa.id && byEtapa.get(etapa.id)!.has(p.id)).map((partida) => ({
        partida,
        items: byEtapa.get(etapa.id)!.get(partida.id)!.slice().sort((a, b) => a.nombre.localeCompare(b.nombre, "es", { numeric: true })),
      })),
    }));
  }, [wbs, fEtapa, fPartida, fTexto]); // eslint-disable-line react-hooks/exhaustive-deps

  const total = secciones.reduce((n, s) => n + s.partidas.reduce((m, p) => m + p.items.length, 0), 0);
  const nPartidas = secciones.reduce((n, s) => n + s.partidas.length, 0);

  return (
    <AppShell role="ingenieria">
      <main className="page page--wide">
        <div className="page__head">
          <div className="page__title">
            <h1 className="ds-heading">Maestro de clasificaciones</h1>
            <p className="ds-muted">Clasificaciones que usa Ingeniería para su control, ordenadas por etapa y partida. Tocá el lápiz para editar una. Las plantillas se amarran a estas clasificaciones.</p>
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
          <div className="ds-body-sm ds-muted mt-2">{total} clasificación(es) · {nPartidas} partida(s) · {secciones.length} etapa(s)</div>
        </Card>

        {cargando && <div className="empty mt-6">Cargando…</div>}
        <div className="mt-4" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {!cargando && secciones.length === 0 && <div className="empty">No hay clasificaciones. Creá la primera con “+ Nueva clasificación”.</div>}
          {secciones.map((s) => (
            <section key={s.etapa.id} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div className="row gap-3" style={{ alignItems: "baseline" }}>
                <span className="ds-subtitle">{s.etapa.nombre}</span>
                <span className="ds-muted ds-body-sm" style={{ fontFamily: "monospace" }}>{s.etapa.codigo}</span>
                <span className="ds-muted ds-body-sm" style={{ marginLeft: "auto" }}>{s.partidas.reduce((m, p) => m + p.items.length, 0)} clasificación(es)</span>
              </div>
              {s.partidas.map(({ partida, items }) => (
                <Card key={partida.id} style={{ padding: 0, overflow: "hidden" }}>
                  <div className="row gap-3" style={{ alignItems: "center", padding: "10px 16px", borderBottom: "1.5px solid var(--ds-color-gray-100)", background: "color-mix(in srgb, var(--ds-color-green-100) 7%, #fff)" }}>
                    <span className="ds-muted ds-body-sm" style={{ fontFamily: "monospace" }}>{partida.codigo}</span>
                    <span className="ds-strong">{partida.nombre}</span>
                    <span className="ds-muted ds-body-sm" style={{ marginLeft: "auto" }}>{items.length}</span>
                  </div>
                  <div>
                    {items.map((c) => (
                      <div key={c.id} className="row gap-3" style={{ alignItems: "center", padding: "10px 16px", borderTop: "1px solid var(--ds-color-gray-100)" }}>
                        <span className="ds-muted">↳</span>
                        <span className="ds-strong ds-body-sm">{c.nombre}</span>
                        <button type="button" className="icon-btn" title="Editar clasificación" aria-label="Editar" style={{ marginLeft: "auto" }} onClick={() => setEditar(c)}>
                          <IconEdit size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                </Card>
              ))}
            </section>
          ))}
        </div>

        {(modal || editar) && (
          <ClasifModal wbs={wbs} inicial={editar} onClose={() => { setModal(false); setEditar(null); }}
            onSaved={() => { setModal(false); setEditar(null); recargar(); }} />
        )}
      </main>
    </AppShell>
  );
}

function ClasifModal({ wbs, inicial, onClose, onSaved }: { wbs: Wbs; inicial: Clasif | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const editing = !!inicial;
  const initPartida = inicial ? wbs.partidas.find((p) => p.id === inicial.partidaId) : undefined;
  const [etapaId, setEtapaId] = useState(String(initPartida?.etapaId ?? wbs.etapas[0]?.id ?? ""));
  const partidas = wbs.partidas.filter((p) => String(p.etapaId) === etapaId);
  const [partidaId, setPartidaId] = useState(String(inicial?.partidaId ?? partidas[0]?.id ?? ""));
  const [nombre, setNombre] = useState(inicial?.nombre ?? "");
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    if (!nombre.trim() || !partidaId) { toast("Elegí partida y nombre.", "error"); return; }
    setGuardando(true);
    try {
      const payload = { nombre: nombre.trim(), partidaId: Number(partidaId) };
      const r = await fetch(editing ? `/api/clasificaciones/${inicial!.id}` : "/api/clasificaciones", {
        method: editing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? "No se pudo guardar");
      toast(editing ? "Clasificación actualizada" : "Clasificación creada", "success"); onSaved();
    } catch (e: any) { toast(String(e?.message ?? e), "error"); setGuardando(false); }
  }

  return (
    <Modal title={editing ? "Editar clasificación" : "Nueva clasificación"} onClose={onClose}
      footer={<><Button variant="outline" onClick={onClose}>Cancelar</Button><Button onClick={guardar} disabled={guardando || !nombre.trim()}>{guardando ? "Guardando…" : editing ? "Guardar cambios" : "Guardar"}</Button></>}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Field label="Etapa">
          <Select value={etapaId} onChange={(e) => { setEtapaId(e.target.value); const f = wbs.partidas.find((p) => String(p.etapaId) === e.target.value); setPartidaId(String(f?.id ?? "")); }}>
            {wbs.etapas.map((e) => <option key={e.id} value={e.id}>{e.codigo} · {e.nombre}</option>)}
          </Select>
        </Field>
        <Field label="Partida">
          <Select value={partidaId} onChange={(e) => setPartidaId(e.target.value)}>
            {partidas.map((p) => <option key={p.id} value={p.id}>{p.codigo} · {p.nombre}</option>)}
          </Select>
        </Field>
        <Field label="Nombre de la clasificación">
          <Input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej. Pisos, Ventanería, Melamina…" autoFocus />
        </Field>
      </div>
    </Modal>
  );
}
