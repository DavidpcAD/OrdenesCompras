"use client";

import { useState } from "react";
import { AppShell } from "@/components/shell";
import { Button, Card, Input, useToast } from "@/components/ui";
import { useStore } from "@/lib/store";

export default function PlanificacionPage() {
  const { planCategorias, planFilas, usuario, addPlanCategoria, removePlanCategoria, addPlanFila, removePlanFila, setPlanCelda } = useStore();
  const toast = useToast();
  const [nuevaCat, setNuevaCat] = useState("");
  const [modelo, setModelo] = useState("");
  const [lote, setLote] = useState("");
  const [responsable, setResponsable] = useState(usuario ?? "");

  function agregarFila() {
    if (!modelo.trim() && !lote.trim()) { toast("Indicá al menos modelo o lote.", "error"); return; }
    addPlanFila({ modelo: modelo.trim(), lote: lote.trim(), responsable: responsable.trim() });
    setModelo(""); setLote("");
  }
  function agregarCat() {
    if (!nuevaCat.trim()) return;
    addPlanCategoria(nuevaCat.trim());
    setNuevaCat("");
  }

  return (
    <AppShell role="ingenieria">
      <main className="page page--wide">
        <div className="page__head">
          <div className="page__title">
            <h1 className="ds-heading">Planificación</h1>
            <p className="ds-muted">Programación por unidad y partida. Filas = unidades (modelo / lote / responsable); columnas = partidas. Escribí en cada celda la fecha, estado o valor (ej. color).</p>
          </div>
        </div>

        {/* Agregar partida (columna) */}
        <Card className="mt-2">
          <div className="row wrap gap-3" style={{ alignItems: "flex-end" }}>
            <div style={{ flex: "1 1 260px", minWidth: 220 }}>
              <label className="ds-label ds-muted" style={{ display: "block", marginBottom: 4 }}>Nueva partida (columna)</label>
              <Input value={nuevaCat} onChange={(e) => setNuevaCat(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") agregarCat(); }} placeholder="Ej. granito, repellos, puertas…" />
            </div>
            <Button variant="outline" onClick={agregarCat}>+ Partida</Button>
            <span className="ds-body-sm ds-muted" style={{ alignSelf: "center" }}>{planCategorias.length} partida(s) · {planFilas.length} unidad(es)</span>
          </div>
        </Card>

        <Card className="mt-4" style={{ padding: 0, overflow: "hidden" }}>
          <div className="ds-table-wrap" style={{ boxShadow: "none", overflowX: "auto" }}>
            <table className="ds-table" style={{ minWidth: 720 }}>
              <thead>
                <tr>
                  <th style={{ minWidth: 130 }}>Modelo</th>
                  <th style={{ minWidth: 80 }}>Lote</th>
                  <th style={{ minWidth: 110 }}>Responsable</th>
                  {planCategorias.map((c) => (
                    <th key={c.id} style={{ minWidth: 120 }}>
                      <div className="row gap-2" style={{ alignItems: "center", justifyContent: "space-between" }}>
                        <span>{c.nombre}</span>
                        <button type="button" className="tpl-card__del" style={{ position: "static" }} title="Quitar partida"
                          onClick={() => removePlanCategoria(c.id)}>×</button>
                      </div>
                    </th>
                  ))}
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {planFilas.length === 0 && (
                  <tr><td colSpan={planCategorias.length + 4}><div className="empty">Aún no hay unidades. Agregá la primera abajo.</div></td></tr>
                )}
                {planFilas.map((f) => (
                  <tr key={f.id}>
                    <td className="ds-strong">{f.modelo || "—"}</td>
                    <td>{f.lote || "—"}</td>
                    <td className="ds-muted ds-body-sm">{f.responsable || "—"}</td>
                    {planCategorias.map((c) => (
                      <td key={c.id} style={{ padding: "4px 6px" }}>
                        <input className="ds-cell-input" value={f.valores[c.id] ?? ""} placeholder="—"
                          onChange={(e) => setPlanCelda(f.id, c.id, e.target.value)}
                          style={{ width: "100%", minWidth: 100, boxSizing: "border-box" }} />
                      </td>
                    ))}
                    <td className="ds-num"><button type="button" className="icon-btn" title="Quitar fila" onClick={() => removePlanFila(f.id)}>×</button></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td style={{ padding: "8px 6px" }}><input className="ds-cell-input" value={modelo} onChange={(e) => setModelo(e.target.value)} placeholder="Modelo…" style={{ width: "100%", boxSizing: "border-box" }} /></td>
                  <td style={{ padding: "8px 6px" }}><input className="ds-cell-input" value={lote} onChange={(e) => setLote(e.target.value)} placeholder="Lote…" style={{ width: "100%", boxSizing: "border-box" }} /></td>
                  <td style={{ padding: "8px 6px" }}><input className="ds-cell-input" value={responsable} onChange={(e) => setResponsable(e.target.value)} placeholder="Responsable…" style={{ width: "100%", boxSizing: "border-box" }} /></td>
                  <td colSpan={planCategorias.length} style={{ padding: "8px 6px" }} className="ds-muted ds-body-sm">Las celdas de partida se llenan después de agregar la fila.</td>
                  <td style={{ padding: "8px 6px" }}><Button variant="outline" onClick={agregarFila}>+ Fila</Button></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      </main>
    </AppShell>
  );
}
