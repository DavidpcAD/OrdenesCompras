"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/shell";
import { Badge, Button, Card, Field, Input, Modal, Select, useToast } from "@/components/ui";
import { SolicitudForm } from "@/components/solicitud-form";
import { IconPlus } from "@/components/icons";
import { useStore } from "@/lib/store";
import { pedidoBadge } from "@/lib/helpers";

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
  const router = useRouter();
  const { addPedido, pedidos, setPedidoEstado, usuario } = useStore();
  // Armar/ver el pedido SIN salir de la matriz: modal con el formulario prellenado.
  const [armar, setArmar] = useState<{ idObra: number; obra: string; clasif: number; nombre: string } | null>(null);
  const [etapas, setEtapas] = useState<Etapa[]>([]); const [partidas, setPartidas] = useState<Partida[]>([]);
  const [subpartidas, setSubpartidas] = useState<SubPartida[]>([]); const [clasifs, setClasifs] = useState<Clasif[]>([]);
  const [obras, setObras] = useState<Obra[]>([]); const [celdas, setCeldas] = useState<Celda[]>([]);
  const [cargando, setCargando] = useState(true);
  const [etapaSel, setEtapaSel] = useState(""); const [fArea, setFArea] = useState(""); const [fProy, setFProy] = useState(""); const [buscar, setBuscar] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/matriz", { cache: "no-store" }); const d = await r.json();
        if (!r.ok) { toast(d.error ?? "No se pudo cargar", "error"); return; }
        setEtapas(d.etapas ?? []); setPartidas(d.partidas ?? []); setSubpartidas(d.subpartidas ?? []);
        setClasifs(d.clasificaciones ?? []); setObras(d.obras ?? []); setCeldas(d.celdas ?? []);
        // Por defecto "Todas las etapas" (etapaSel = ""), para no esconder clasificaciones.
      } catch (e: any) { toast(String(e?.message ?? e), "error"); }
      finally { setCargando(false); }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const partidaDeClas = (c: Clasif): Partida | null => {
    const sub = c.subPartidaId ? subpartidas.find((s) => s.id === c.subPartidaId) : undefined;
    return partidas.find((x) => x.id === (c.partidaId ?? sub?.partidaId)) ?? null;
  };
  const etapaDeClas = (c: Clasif) => partidaDeClas(c)?.etapaId ?? null;

  // Recordar la etapa (especialidad) elegida por cada ingeniero: así, según quién
  // entra, la matriz arranca en las clasificaciones que le corresponden.
  useEffect(() => {
    if (!usuario) return;
    const saved = localStorage.getItem(`matriz_etapa_${usuario}`);
    if (saved != null) setEtapaSel(saved);
  }, [usuario]);
  useEffect(() => {
    if (usuario) localStorage.setItem(`matriz_etapa_${usuario}`, etapaSel);
  }, [usuario, etapaSel]);
  const columnas = useMemo(() => clasifs.filter((c) => !etapaSel || String(etapaDeClas(c)) === etapaSel), [clasifs, partidas, subpartidas, etapaSel]); // eslint-disable-line react-hooks/exhaustive-deps
  // Estado de cada celda: se arma desde la vista SQL (celdas) Y desde los pedidos
  // del store (siempre frescos), quedándose con el estado de mayor avance. Así la
  // celda refleja al instante lo recién solicitado y sobrevive a recargas aunque la
  // vista venga desfasada o cacheada.
  const mapa = useMemo(() => {
    const RANK: Record<string, number> = { ENTREGADO: 4, COMPRADO: 3, PEDIDO: 2, BORRADOR: 1 };
    const EST_DE_CODIGO: Record<string, string> = { cerrado: "ENTREGADO", en_orden: "COMPRADO", aprobado: "PEDIDO", borrador: "BORRADOR" };
    const m = new Map<string, string>();
    const put = (idObra: number, idClas: number, est?: string) => {
      if (!est) return;
      const k = `${idObra}|${idClas}`;
      const prev = m.get(k);
      if (!prev || (RANK[est] ?? 0) > (RANK[prev] ?? 0)) m.set(k, est);
    };
    for (const c of celdas) put(c.idObra, c.idClasificacion, c.estado);
    const idPorObra = new Map(obras.map((o) => [o.numeroObra, o.idObra]));
    for (const p of pedidos) {
      if (p.idClasificacion == null || !p.obraCodigo) continue;
      const io = idPorObra.get(p.obraCodigo);
      if (io != null) put(io, p.idClasificacion, EST_DE_CODIGO[p.estado]);
    }
    return m;
  }, [celdas, pedidos, obras]);

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
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
            <Field label="Etapa · tu especialidad">
              <Select value={etapaSel} onChange={(e) => setEtapaSel(e.target.value)}>
                <option value="">Todas las etapas</option>
                {etapas.map((e) => <option key={e.id} value={e.id}>{e.codigo} · {e.nombre}</option>)}
              </Select>
            </Field>
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
            <Field label="Buscar obra"><Input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Código o nombre…" /></Field>
          </div>
          <div className="row gap-2 wrap" style={{ alignItems: "center", marginTop: 14, paddingTop: 12, borderTop: "1.5px solid var(--ds-color-gray-100)" }}>
            <span className="ds-label ds-muted" style={{ marginRight: 2 }}>Estados:</span>
            {(["ENTREGADO", "COMPRADO", "PEDIDO", "BORRADOR"] as const).map((k) => <Badge key={k} tone={TONO[k]}>{LABEL[k]}</Badge>)}
            <span className="ds-muted ds-body-sm">· vacío = sin pedido ( <strong>+</strong> para armarlo )</span>
          </div>
        </Card>

        {cargando ? <div className="empty mt-6">Cargando…</div> : columnas.length === 0 ? (
          <div className="empty mt-6">{etapaSel ? "No hay clasificaciones en esta etapa." : "No hay clasificaciones."} Creá clasificaciones en el Maestro.</div>
        ) : (
          <Card className="mt-4" style={{ padding: 0, overflow: "hidden" }}>
            <div className="ds-table-wrap" style={{ boxShadow: "none", overflowX: "auto" }}>
              <table className="ds-table" style={{ tableLayout: "auto" }}>
                <thead>
                  <tr>
                    <th style={{ width: 200, position: "sticky", left: 0, background: "var(--ds-color-white)", zIndex: 2 }}>Obra</th>
                    {columnas.map((c) => { const par = partidaDeClas(c); return (
                      <th key={c.id} style={{ width: 150, textAlign: "center", verticalAlign: "bottom" }}>
                        {par && <div className="ds-body-sm ds-muted ds-truncate" title={par.nombre} style={{ fontWeight: 400, maxWidth: 150, margin: "0 auto" }}>{par.codigo ? `${par.codigo} · ` : ""}{par.nombre}</div>}
                        <div className="ds-strong ds-body-sm">{c.nombre}</div>
                      </th>
                    ); })}
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
                            {est ? (
                              <button type="button" title={`Ver / armar · ${c.nombre} · ${o.numeroObra}`}
                                onClick={() => setArmar({ idObra: o.idObra, obra: o.numeroObra, clasif: c.id, nombre: c.nombre })}
                                style={{ border: 0, background: "transparent", padding: 0, cursor: "pointer" }}>
                                <Badge tone={TONO[est] ?? "gray"}>{LABEL[est] ?? est}</Badge>
                              </button>
                            ) : (
                              <button className="icon-btn" title={`Armar pedido de ${c.nombre} para ${o.numeroObra}`}
                                onClick={() => setArmar({ idObra: o.idObra, obra: o.numeroObra, clasif: c.id, nombre: c.nombre })}
                                style={{ border: "1.5px dashed var(--ds-color-gray-200)", borderRadius: 8, width: 32, height: 32, display: "inline-grid", placeItems: "center", margin: "0 auto", color: "var(--ds-color-gray-400)" }}><IconPlus size={16} /></button>
                            )}
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

        {armar && (() => {
          const pedidosCelda = pedidos.filter((p) => p.obraCodigo === armar.obra && p.idClasificacion === armar.clasif);
          return (
            <Modal wide title={`Pedido · ${armar.obra}`} onClose={() => setArmar(null)}>
              <div className="row gap-2 wrap" style={{ marginBottom: 14 }}>
                <Badge tone="gray">{armar.nombre}</Badge>
              </div>

              {pedidosCelda.length > 0 && (
                <Card flat style={{ marginBottom: 14 }}>
                  <div className="ds-body-sm ds-strong" style={{ marginBottom: 8 }}>Ya solicitado</div>
                  {pedidosCelda.map((p) => {
                    const b = pedidoBadge(p.estado);
                    return (
                      <div key={p.id} className="row row--between gap-3" style={{ padding: "6px 0", borderTop: "1px solid var(--ds-color-gray-100)" }}>
                        <span className="ds-body-sm"><span className="ds-strong">{p.numero}</span> · {p.lineas.length} línea(s)</span>
                        <span className="row gap-2" style={{ alignItems: "center" }}>
                          <Badge tone={b.tone}>{b.label}</Badge>
                          {p.estado === "borrador" && (
                            <Button variant="outline" size="sm" onClick={async () => {
                              await setPedidoEstado(p.id, "aprobado");
                              setCeldas((cs) => [...cs, { idObra: armar.idObra, idClasificacion: armar.clasif, estado: "PEDIDO" }]);
                              toast(`${p.numero} enviada a proveeduría`, "success");
                              setArmar(null);
                            }}>Enviar a proveeduría</Button>
                          )}
                          <Button variant="ghost" size="sm" onClick={() => router.push(`/ingenieria/${p.id}`)}>Ver / editar</Button>
                        </span>
                      </div>
                    );
                  })}
                </Card>
              )}

              <div className="ds-body-sm ds-strong" style={{ marginBottom: 8 }}>{pedidosCelda.length > 0 ? "Armar otro pedido" : "Armar pedido"}</div>
              <SolicitudForm
                compact
                obraPreset={armar.obra}
                clasifPreset={armar.clasif}
                textoBoton="Crear y enviar a proveeduría"
                onCancelar={() => setArmar(null)}
                guardar={async (input) => {
                  // Primario: crear el pedido y enviarlo a proveeduría de una vez.
                  const p = await addPedido(input);
                  await setPedidoEstado(p.id, "aprobado");
                  setCeldas((cs) => [...cs, { idObra: armar.idObra, idClasificacion: armar.clasif, estado: "PEDIDO" }]);
                  toast(`Solicitud ${p.numero} creada y enviada a proveeduría`, "success");
                  setArmar(null);
                }}
                textoBotonSecundario="Guardar borrador"
                guardarSecundario={async (input) => {
                  // Secundario: dejarlo en borrador (aún sin enviar).
                  const p = await addPedido(input);
                  setCeldas((cs) => [...cs, { idObra: armar.idObra, idClasificacion: armar.clasif, estado: "BORRADOR" }]);
                  toast(`Borrador ${p.numero} guardado`, "success");
                  setArmar(null);
                }}
              />
            </Modal>
          );
        })()}
      </main>
    </AppShell>
  );
}
