"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/shell";
import { Badge, Card, Field, Input, Modal, Select, useToast } from "@/components/ui";
import { SolicitudForm } from "@/components/solicitud-form";
import { IconPlus } from "@/components/icons";
import { useStore } from "@/lib/store";

type Etapa = { id: number; codigo: string; nombre: string };
type Partida = { id: number; codigo: string; nombre: string; etapaId: number | null };
type SubPartida = { id: number; codigo: string; nombre: string; partidaId: number | null };
type Clasif = { id: number; nombre: string; partidaId: number | null; subPartidaId: number | null };
type Obra = { idObra: number; numeroObra: string; nombreMostrado: string; areaCosteo: string; proyecto: string };
type Celda = { idObra: number; idClasificacion: number; estado: string };

const TONO: Record<string, string> = { ENTREGADO: "green", COMPRADO: "green", PEDIDO: "yellow", BORRADOR: "gray" };
const LABEL: Record<string, string> = { ENTREGADO: "Entregado", COMPRADO: "Comprado", PEDIDO: "Pedido", BORRADOR: "Borrador" };

export default function MatrizPage() {
  const toast = useToast();
  const { addPedido } = useStore();
  // Armar el pedido SIN salir de la matriz: modal con el formulario prellenado.
  const [armar, setArmar] = useState<{ idObra: number; obra: string; clasif: number; nombre: string } | null>(null);
  const [etapas, setEtapas] = useState<Etapa[]>([]); const [partidas, setPartidas] = useState<Partida[]>([]);
  const [subpartidas, setSubpartidas] = useState<SubPartida[]>([]); const [clasifs, setClasifs] = useState<Clasif[]>([]);
  const [obras, setObras] = useState<Obra[]>([]); const [celdas, setCeldas] = useState<Celda[]>([]);
  const [cargando, setCargando] = useState(true);
  const [etapaSel, setEtapaSel] = useState(""); const [fArea, setFArea] = useState(""); const [fProy, setFProy] = useState(""); const [buscar, setBuscar] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/matriz"); const d = await r.json();
        if (!r.ok) { toast(d.error ?? "No se pudo cargar", "error"); return; }
        setEtapas(d.etapas ?? []); setPartidas(d.partidas ?? []); setSubpartidas(d.subpartidas ?? []);
        setClasifs(d.clasificaciones ?? []); setObras(d.obras ?? []); setCeldas(d.celdas ?? []);
        if ((d.etapas ?? []).length) setEtapaSel(String(d.etapas[0].id));
      } catch (e: any) { toast(String(e?.message ?? e), "error"); }
      finally { setCargando(false); }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const etapaDeClas = (c: Clasif) => {
    const sub = c.subPartidaId ? subpartidas.find((s) => s.id === c.subPartidaId) : undefined;
    const p = partidas.find((x) => x.id === (c.partidaId ?? sub?.partidaId));
    return p?.etapaId ?? null;
  };
  const columnas = useMemo(() => clasifs.filter((c) => !etapaSel || String(etapaDeClas(c)) === etapaSel), [clasifs, partidas, subpartidas, etapaSel]); // eslint-disable-line react-hooks/exhaustive-deps
  const mapa = useMemo(() => { const m = new Map<string, string>(); for (const c of celdas) m.set(`${c.idObra}|${c.idClasificacion}`, c.estado); return m; }, [celdas]);

  const areas = useMemo(() => [...new Set(obras.map((o) => o.areaCosteo).filter(Boolean))].sort(), [obras]);
  const proyectos = useMemo(() => [...new Set(obras.map((o) => o.proyecto).filter(Boolean))].sort(), [obras]);
  const obrasVis = useMemo(() => {
    const q = buscar.trim().toLowerCase();
    return obras.filter((o) => (!fArea || o.areaCosteo === fArea) && (!fProy || o.proyecto === fProy)
      && (!q || o.numeroObra.toLowerCase().includes(q) || (o.nombreMostrado ?? "").toLowerCase().includes(q)));
  }, [obras, fArea, fProy, buscar]);

  return (
    <AppShell role="ingenieria">
      <main className="page page--wide">
        <div className="page__head">
          <div className="page__title">
            <h1 className="ds-heading">Matriz por obra</h1>
            <p className="ds-muted">Filas = obras, columnas = clasificaciones. Cada celda dice en qué va el pedido de esa clasificación para esa obra. En las vacías, “+” arma el pedido desde su plantilla.</p>
          </div>
        </div>

        <Card className="mt-2">
          <div className="grid-2">
            <Field label="Etapa (columnas)">
              <Select value={etapaSel} onChange={(e) => setEtapaSel(e.target.value)}>
                {etapas.map((e) => <option key={e.id} value={e.id}>{e.codigo} · {e.nombre}</option>)}
              </Select>
            </Field>
            <Field label="Buscar obra"><Input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Código o nombre…" /></Field>
            <Field label="Área de costeo">
              <Select value={fArea} onChange={(e) => setFArea(e.target.value)}>
                <option value="">Todas</option>{areas.map((a) => <option key={a} value={a}>{a}</option>)}
              </Select>
            </Field>
            <Field label="Proyecto">
              <Select value={fProy} onChange={(e) => setFProy(e.target.value)}>
                <option value="">Todos</option>{proyectos.map((p) => <option key={p} value={p}>{p}</option>)}
              </Select>
            </Field>
          </div>
          <div className="row gap-2 wrap mt-2">
            {(["ENTREGADO", "COMPRADO", "PEDIDO", "BORRADOR"] as const).map((k) => <Badge key={k} tone={TONO[k]}>{LABEL[k]}</Badge>)}
            <span className="ds-muted ds-body-sm">· vacío = sin pedido ( + para armarlo )</span>
          </div>
        </Card>

        {cargando ? <div className="empty mt-6">Cargando…</div> : columnas.length === 0 ? (
          <div className="empty mt-6">No hay clasificaciones en esta etapa. Creá clasificaciones en el Maestro.</div>
        ) : (
          <Card className="mt-4" style={{ padding: 0, overflow: "hidden" }}>
            <div className="ds-table-wrap" style={{ boxShadow: "none", overflowX: "auto" }}>
              <table className="ds-table" style={{ tableLayout: "auto" }}>
                <thead>
                  <tr>
                    <th style={{ width: 200, position: "sticky", left: 0, background: "var(--ds-color-white)", zIndex: 2 }}>Obra</th>
                    {columnas.map((c) => <th key={c.id} style={{ width: 150, textAlign: "center" }}>{c.nombre}</th>)}
                    {/* columna espaciadora: absorbe el ancho sobrante para que las celdas no se estiren */}
                    <th aria-hidden style={{ width: "100%" }} />
                  </tr>
                </thead>
                <tbody>
                  {obrasVis.length === 0 && <tr><td colSpan={columnas.length + 2}><div className="empty">Ninguna obra coincide.</div></td></tr>}
                  {obrasVis.map((o) => (
                    <tr key={o.idObra}>
                      <td style={{ position: "sticky", left: 0, background: "var(--ds-color-white)", zIndex: 1 }}>
                        <div className="ds-strong ds-body-sm">{o.numeroObra}</div>
                        {o.nombreMostrado && <div className="ds-muted ds-body-sm ds-truncate" style={{ maxWidth: 180 }} title={o.nombreMostrado}>{o.nombreMostrado}</div>}
                      </td>
                      {columnas.map((c) => {
                        const est = mapa.get(`${o.idObra}|${c.id}`);
                        return (
                          <td key={c.id} style={{ width: 150, textAlign: "center" }}>
                            {est ? <Badge tone={TONO[est] ?? "gray"}>{LABEL[est] ?? est}</Badge>
                              : <button className="icon-btn" title={`Armar pedido de ${c.nombre} para ${o.numeroObra}`}
                                  onClick={() => setArmar({ idObra: o.idObra, obra: o.numeroObra, clasif: c.id, nombre: c.nombre })}
                                  style={{ border: "1.5px dashed var(--ds-color-gray-200)", borderRadius: 8, width: 32, height: 32, display: "inline-grid", placeItems: "center", margin: "0 auto", color: "var(--ds-color-gray-400)" }}><IconPlus size={16} /></button>}
                          </td>
                        );
                      })}
                      <td aria-hidden />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {armar && (
          <Modal wide title={`Armar pedido · ${armar.nombre} · ${armar.obra}`} onClose={() => setArmar(null)}>
            <SolicitudForm
              obraPreset={armar.obra}
              clasifPreset={armar.clasif}
              textoBoton="Crear solicitud"
              onCancelar={() => setArmar(null)}
              guardar={async (input) => {
                const p = await addPedido(input);
                setCeldas((cs) => [...cs, { idObra: armar.idObra, idClasificacion: armar.clasif, estado: "BORRADOR" }]);
                toast(`Solicitud ${p.numero} creada`, "success");
                setArmar(null);
              }}
            />
          </Modal>
        )}
      </main>
    </AppShell>
  );
}
