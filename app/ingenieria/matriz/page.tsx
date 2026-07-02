"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/shell";
import { Badge, Card, Field, Input, Select, useToast } from "@/components/ui";

type Etapa = { id: number; codigo: string; nombre: string };
type Partida = { id: number; codigo: string; nombre: string; etapaId: number | null };
type SubPartida = { id: number; codigo: string; nombre: string; partidaId: number | null };
type Obra = { idObra: number; numeroObra: string; nombreMostrado: string };
type Celda = { idObra: number; idSubPartida: number; estado: string };

const TONO: Record<string, string> = { ENTREGADO: "green", COMPRADO: "green", PEDIDO: "yellow", BORRADOR: "gray" };
const LABEL: Record<string, string> = { ENTREGADO: "Entregado", COMPRADO: "Comprado", PEDIDO: "Pedido", BORRADOR: "Borrador" };

export default function MatrizPage() {
  const toast = useToast();
  const [etapas, setEtapas] = useState<Etapa[]>([]);
  const [partidas, setPartidas] = useState<Partida[]>([]);
  const [subpartidas, setSubpartidas] = useState<SubPartida[]>([]);
  const [obras, setObras] = useState<Obra[]>([]);
  const [celdas, setCeldas] = useState<Celda[]>([]);
  const [cargando, setCargando] = useState(true);
  const [etapaSel, setEtapaSel] = useState(""); const [buscarObra, setBuscarObra] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/matriz"); const d = await r.json();
        if (!r.ok) { toast(d.error ?? "No se pudo cargar", "error"); return; }
        setEtapas(d.etapas ?? []); setPartidas(d.partidas ?? []); setSubpartidas(d.subpartidas ?? []);
        setObras(d.obras ?? []); setCeldas(d.celdas ?? []);
        if ((d.etapas ?? []).length) setEtapaSel(String(d.etapas[0].id));
      } catch (e: any) { toast(String(e?.message ?? e), "error"); }
      finally { setCargando(false); }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const partidaDe = (s: SubPartida) => partidas.find((p) => p.id === s.partidaId);
  // Columnas = sub_partidas de la etapa elegida (para que la matriz no tenga 90+ columnas).
  const columnas = useMemo(() => {
    return subpartidas.filter((s) => { const p = partidaDe(s); return !etapaSel || (p && String(p.etapaId) === etapaSel); });
  }, [subpartidas, partidas, etapaSel]);

  const mapa = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of celdas) m.set(`${c.idObra}|${c.idSubPartida}`, c.estado);
    return m;
  }, [celdas]);

  const obrasVis = useMemo(() => {
    const q = buscarObra.trim().toLowerCase();
    return obras.filter((o) => !q || o.numeroObra.toLowerCase().includes(q) || (o.nombreMostrado ?? "").toLowerCase().includes(q));
  }, [obras, buscarObra]);

  return (
    <AppShell role="ingenieria">
      <main className="page page--wide">
        <div className="page__head">
          <div className="page__title">
            <h1 className="ds-heading">Matriz por obra</h1>
            <p className="ds-muted">Filas = obras, columnas = clasificaciones (sub-partidas). Cada celda dice en qué va el pedido de esa clasificación para esa obra. Se llena sola con los pedidos.</p>
          </div>
        </div>

        <Card className="mt-2">
          <div className="grid-2">
            <Field label="Etapa (columnas)">
              <Select value={etapaSel} onChange={(e) => setEtapaSel(e.target.value)}>
                {etapas.map((e) => <option key={e.id} value={e.id}>{e.codigo} · {e.nombre}</option>)}
              </Select>
            </Field>
            <Field label="Buscar obra">
              <Input value={buscarObra} onChange={(e) => setBuscarObra(e.target.value)} placeholder="Código o nombre de obra…" />
            </Field>
          </div>
          <div className="row gap-2 wrap mt-2">
            {(["ENTREGADO", "COMPRADO", "PEDIDO", "BORRADOR"] as const).map((k) => <Badge key={k} tone={TONO[k]}>{LABEL[k]}</Badge>)}
            <span className="ds-muted ds-body-sm">· celda vacía = sin pedido</span>
          </div>
        </Card>

        {cargando ? <div className="empty mt-6">Cargando…</div> : (
          <Card className="mt-4" style={{ padding: 0, overflow: "hidden" }}>
            <div className="ds-table-wrap" style={{ boxShadow: "none", overflowX: "auto" }}>
              <table className="ds-table" style={{ minWidth: 720 }}>
                <thead>
                  <tr>
                    <th style={{ minWidth: 180, position: "sticky", left: 0, background: "#fff", zIndex: 2 }}>Obra</th>
                    {columnas.map((c) => (
                      <th key={c.id} style={{ minWidth: 130 }}>
                        <div className="ds-body-sm">{c.nombre}</div>
                        <div className="ds-muted ds-body-sm" style={{ fontFamily: "monospace", fontWeight: 400 }}>{c.codigo}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {obrasVis.length === 0 && <tr><td colSpan={columnas.length + 1}><div className="empty">{obras.length === 0 ? "No hay obras." : "Ninguna obra coincide."}</div></td></tr>}
                  {obrasVis.map((o) => (
                    <tr key={o.idObra}>
                      <td style={{ position: "sticky", left: 0, background: "#fff", zIndex: 1 }}>
                        <div className="ds-strong ds-body-sm">{o.numeroObra}</div>
                        {o.nombreMostrado && <div className="ds-muted ds-body-sm ds-truncate" style={{ maxWidth: 180 }} title={o.nombreMostrado}>{o.nombreMostrado}</div>}
                      </td>
                      {columnas.map((c) => {
                        const est = mapa.get(`${o.idObra}|${c.id}`);
                        return <td key={c.id}>{est ? <Badge tone={TONO[est] ?? "gray"}>{LABEL[est] ?? est}</Badge> : <span className="ds-muted">—</span>}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </main>
    </AppShell>
  );
}
