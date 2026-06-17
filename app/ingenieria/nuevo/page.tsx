"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AppShell } from "@/components/shell";
import { Button, Card, Field, Input, Select, Textarea, useToast } from "@/components/ui";
import { IconTrash } from "@/components/icons";
import { useStore } from "@/lib/store";
import type { Pedido, TipoSolicitud } from "@/lib/types";

interface DraftLine {
  key: string;
  articuloId: string;
  almacen: string;
  cantidad: string;
}

export default function NuevaSolicitudPage() {
  const { articulos, obras, maquinas, almacenes, addPedido } = useStore();
  const router = useRouter();
  const toast = useToast();

  const [tipo, setTipo] = useState<TipoSolicitud>("material");
  const [obraId, setObraId] = useState("");
  const [maquinaId, setMaquinaId] = useState("");
  const [solicitante, setSolicitante] = useState("Laura Jiménez");
  const [prioridad, setPrioridad] = useState<Pedido["prioridad"]>("normal");
  const [notas, setNotas] = useState("");
  const [lineas, setLineas] = useState<DraftLine[]>([
    { key: Math.random().toString(36).slice(2), articuloId: "", almacen: "", cantidad: "" },
  ]);

  // catálogo filtrado: repuestos (R..) vs materiales
  const catalogo = articulos.filter((a) =>
    tipo === "repuesto" ? a.code.startsWith("R") : !a.code.startsWith("R")
  );

  function setLine(key: string, patch: Partial<DraftLine>) {
    setLineas((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLineas((ls) => [...ls, { key: Math.random().toString(36).slice(2), articuloId: "", almacen: "", cantidad: "" }]);
  }
  function removeLine(key: string) {
    setLineas((ls) => (ls.length === 1 ? ls : ls.filter((l) => l.key !== key)));
  }

  const destinoOk = tipo === "material" ? !!obraId : !!maquinaId;
  const lineasValidas = lineas.filter((l) => l.articuloId && Number(l.cantidad) > 0);
  const puedeGuardar = destinoOk && solicitante.trim() && lineasValidas.length > 0;

  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    if (!puedeGuardar) {
      toast(`Indicá ${tipo === "material" ? "la obra" : "la máquina"} y al menos una línea válida.`, "error");
      return;
    }
    const obra = obras.find((o) => o.id === obraId);
    const maquina = maquinas.find((m) => m.id === maquinaId);
    setGuardando(true);
    try {
    const p = await addPedido({
      tipoSolicitud: tipo,
      obraCodigo: tipo === "material" ? obra?.codigo : undefined,
      obraNombre: tipo === "material" ? obra?.nombre : undefined,
      maquinaNo: tipo === "repuesto" ? maquina?.no : undefined,
      maquinaNombre: tipo === "repuesto" ? maquina?.nombre : undefined,
      solicitante: solicitante.trim(),
      prioridad,
      notas: notas.trim() || undefined,
      lineas: lineasValidas.map((l) => {
        const a = articulos.find((x) => x.id === l.articuloId)!;
        return {
          articuloId: a.id, descripcion: a.descripcion, cantidad: Number(l.cantidad),
          unidad: a.unidad, almacen: l.almacen || a.almacenDefault,
        };
      }),
    });
    toast(`Solicitud ${p.numero} creada`, "success");
    router.push(`/ingenieria/${p.id}`);
    } catch (e: any) {
      toast(String(e?.message ?? e), "error");
      setGuardando(false);
    }
  }

  return (
    <AppShell role="ingenieria">
      <main className="page">
        <div className="back-link" onClick={() => router.push("/ingenieria")}>‹ Volver a solicitudes</div>
        <div className="page__head">
          <div className="page__title">
            <h1 className="ds-heading">Nueva solicitud</h1>
            <p className="ds-muted">Indicá el destino y las líneas de material que necesitás.</p>
          </div>
        </div>

        <Card>
          {/* toggle material / repuesto */}
          <div className="row gap-3" style={{ marginBottom: 20 }}>
            <button type="button" className={`role-option ${tipo === "material" ? "is-selected" : ""}`}
              style={{ flex: 1, padding: "12px 16px" }} onClick={() => setTipo("material")}>
              <span className="col" style={{ gap: 2 }}>
                <span className="role-option__title">Material</span>
                <span className="role-option__desc">Va a una obra</span>
              </span>
            </button>
            <button type="button" className={`role-option ${tipo === "repuesto" ? "is-selected" : ""}`}
              style={{ flex: 1, padding: "12px 16px" }} onClick={() => setTipo("repuesto")}>
              <span className="col" style={{ gap: 2 }}>
                <span className="role-option__title">Repuesto</span>
                <span className="role-option__desc">Va a una máquina</span>
              </span>
            </button>
          </div>

          <div className="grid-2">
            {tipo === "material" ? (
              <Field label="Obra destino">
                <Select value={obraId} onChange={(e) => setObraId(e.target.value)}>
                  <option value="">Seleccionar obra…</option>
                  {obras.map((o) => <option key={o.id} value={o.id}>{o.codigo} — {o.nombre}</option>)}
                </Select>
              </Field>
            ) : (
              <Field label="Máquina destino">
                <Select value={maquinaId} onChange={(e) => setMaquinaId(e.target.value)}>
                  <option value="">Seleccionar máquina…</option>
                  {maquinas.map((m) => <option key={m.id} value={m.id}>{m.no} — {m.nombre}</option>)}
                </Select>
              </Field>
            )}
            <Field label="Solicitante">
              <Input value={solicitante} onChange={(e) => setSolicitante(e.target.value)} />
            </Field>
            <Field label="Prioridad">
              <Select value={prioridad} onChange={(e) => setPrioridad(e.target.value as Pedido["prioridad"])}>
                <option value="normal">Normal</option>
                <option value="alta">Alta</option>
                <option value="urgente">Urgente</option>
              </Select>
            </Field>
            <Field label="Notas (opcional)">
              <Textarea value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Indicaciones para proveeduría…" />
            </Field>
          </div>
        </Card>

        <Card className="mt-4">
          <div className="row row--between" style={{ marginBottom: 16 }}>
            <h3 className="ds-subtitle">{tipo === "material" ? "Materiales" : "Repuestos"}</h3>
            <Button variant="outline" size="sm" onClick={addLine}>+ Agregar línea</Button>
          </div>

          <div className="ds-table-wrap" style={{ boxShadow: "none" }}>
            <table className="ds-table">
              <thead>
                <tr><th style={{ minWidth: 300 }}>{tipo === "material" ? "Artículo" : "Repuesto"}</th><th>Unidad</th><th>Almacén</th><th className="ds-num">Cantidad</th><th></th></tr>
              </thead>
              <tbody>
                {lineas.map((l) => {
                  const a = articulos.find((x) => x.id === l.articuloId);
                  return (
                    <tr key={l.key}>
                      <td>
                        <select className="ds-form-field__select" style={{ borderRadius: 8, padding: "8px 12px" }}
                          value={l.articuloId} onChange={(e) => setLine(l.key, { articuloId: e.target.value })}>
                          <option value="">Seleccionar…</option>
                          {catalogo.map((x) => (
                            <option key={x.id} value={x.id}>{x.code} — {x.descripcion}</option>
                          ))}
                        </select>
                      </td>
                      <td className="ds-muted">{a?.unidad ?? "—"}</td>
                      <td>
                        <select className="ds-form-field__select" style={{ borderRadius: 8, padding: "8px 12px" }}
                          value={l.almacen || a?.almacenDefault || ""} onChange={(e) => setLine(l.key, { almacen: e.target.value })}>
                          {almacenes.map((al) => <option key={al.codigo} value={al.codigo}>{al.codigo}</option>)}
                        </select>
                      </td>
                      <td className="ds-num">
                        <input className="ds-cell-input" type="number" min={0} value={l.cantidad}
                          onChange={(e) => setLine(l.key, { cantidad: e.target.value })} placeholder="0" />
                      </td>
                      <td><button className="icon-btn" onClick={() => removeLine(l.key)} aria-label="Borrar línea"><IconTrash /></button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="row gap-3 mt-6" style={{ justifyContent: "flex-end" }}>
          <Button variant="outline" onClick={() => router.push("/ingenieria")}>Cancelar</Button>
          <Button onClick={guardar} disabled={!puedeGuardar || guardando}>{guardando ? "Guardando…" : "Guardar solicitud"}</Button>
        </div>
      </main>
    </AppShell>
  );
}
