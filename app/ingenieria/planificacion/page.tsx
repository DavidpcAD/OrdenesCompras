"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import { AppShell } from "@/components/shell";
import { Badge, Button, Card, Input, useToast } from "@/components/ui";
import { useStore } from "@/lib/store";
import { pedidoBadge } from "@/lib/helpers";
import type { PlanCategoria, PlanFila } from "@/lib/types";

export default function PlanificacionPage() {
  const { planCategorias, planFilas, pedidos, usuario, addPlanCategoria, removePlanCategoria, addPlanFila, removePlanFila, setPlanCelda, cargarPlanificacion, setPlanContexto } = useStore();
  const router = useRouter();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [nuevaCat, setNuevaCat] = useState("");
  const [modelo, setModelo] = useState("");
  const [lote, setLote] = useState("");
  const [responsable, setResponsable] = useState(usuario ?? "");
  const [buscar, setBuscar] = useState("");

  function agregarFila() {
    if (!modelo.trim() && !lote.trim()) { toast("Indicá al menos modelo o lote.", "error"); return; }
    addPlanFila({ modelo: modelo.trim(), lote: lote.trim(), responsable: responsable.trim() });
    setModelo(""); setLote("");
  }
  function agregarCat() { if (nuevaCat.trim()) { addPlanCategoria(nuevaCat.trim()); setNuevaCat(""); } }

  // Importar la hoja "Programación" del Excel: detecta partidas (columnas) y unidades (filas).
  async function importar(file: File) {
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
      const ws = wb.Sheets["Programacion"] || wb.Sheets[wb.SheetNames[0]];
      const aoa: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: false });
      let hr = -1;
      for (let i = 0; i < Math.min(aoa.length, 12); i++) if (aoa[i].some((c) => String(c).trim().toLowerCase() === "modelo")) { hr = i; break; }
      if (hr < 0) { toast("No encontré la fila de encabezados (con 'modelo').", "error"); return; }
      const headers = aoa[hr].map((c) => String(c).trim());
      const grupos = hr > 0 ? aoa[hr - 1].map((c) => String(c).trim()) : [];
      const ciModelo = headers.findIndex((h) => h.toLowerCase() === "modelo");
      const ciCasa = headers.findIndex((h) => ["casa", "lote"].includes(h.toLowerCase()));
      const ciResp = ciModelo + 1;
      const partidas: { col: number; nombre: string }[] = [];
      headers.forEach((h, i) => {
        if (!h || i === ciModelo || i === ciCasa || i === ciResp || /^\d+$/.test(h)) return;
        const g = grupos[i] ?? "";
        partidas.push({ col: i, nombre: h.toLowerCase() === "color" && g ? `color (${g})` : h });
      });
      const categorias: PlanCategoria[] = partidas.map((p, idx) => ({ id: `c${idx + 1}`, nombre: p.nombre }));
      const filas: PlanFila[] = [];
      for (let i = hr + 1; i < aoa.length; i++) {
        const r = aoa[i];
        const md = String(r[ciModelo] ?? "").trim();
        const lt = ciCasa >= 0 ? String(r[ciCasa] ?? "").trim() : "";
        if (!md && !lt) continue;
        const valores: Record<string, string> = {};
        partidas.forEach((p, idx) => { const v = String(r[p.col] ?? "").trim(); if (v && v.toLowerCase() !== "n/a") valores[`c${idx + 1}`] = v; });
        filas.push({ id: `f${i}-${Math.random().toString(36).slice(2, 6)}`, modelo: md, lote: lt, responsable: String(r[ciResp] ?? "").trim(), valores });
      }
      if (!categorias.length || !filas.length) { toast("No pude leer partidas/unidades de esa hoja.", "error"); return; }
      cargarPlanificacion(categorias, filas);
      toast(`Planificación importada: ${filas.length} unidades · ${categorias.length} partidas.`, "success");
    } catch (e: any) {
      toast(`No pude leer el Excel: ${String(e?.message ?? e)}`, "error");
    } finally { if (fileRef.current) fileRef.current.value = ""; }
  }

  function armarPedido(f: PlanFila) {
    setPlanContexto({ modelo: f.modelo, lote: f.lote });
    router.push("/ingenieria/nuevo");
  }

  const filasVis = planFilas.filter((f) => { const q = buscar.trim().toLowerCase(); return !q || f.modelo.toLowerCase().includes(q) || f.lote.toLowerCase().includes(q) || f.responsable.toLowerCase().includes(q); });
  const pedidosDe = (lote: string) => (lote ? pedidos.filter((p) => p.loteRef === lote) : []);

  return (
    <AppShell role="ingenieria">
      <main className="page page--wide">
        <div className="page__head">
          <div className="page__title">
            <h1 className="ds-heading">Planificación</h1>
            <p className="ds-muted">Programación por unidad y partida (como el Excel). Desde cada unidad armás el pedido de compra y ves qué se pidió, qué falta y qué se está pidiendo.</p>
          </div>
          <div className="row gap-2">
            <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) importar(f); }} />
            <Button variant="outline" onClick={() => fileRef.current?.click()}>⬆ Importar Excel</Button>
          </div>
        </div>

        <Card className="mt-2">
          <div className="row wrap gap-3" style={{ alignItems: "flex-end" }}>
            <div style={{ flex: "1 1 240px", minWidth: 200 }}>
              <label className="ds-label ds-muted" style={{ display: "block", marginBottom: 4 }}>Nueva partida (columna)</label>
              <Input value={nuevaCat} onChange={(e) => setNuevaCat(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") agregarCat(); }} placeholder="Ej. granito, repellos, puertas…" />
            </div>
            <Button variant="outline" onClick={agregarCat}>+ Partida</Button>
            <div style={{ flex: "1 1 200px", minWidth: 180 }}>
              <label className="ds-label ds-muted" style={{ display: "block", marginBottom: 4 }}>Buscar unidad</label>
              <Input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Modelo, lote o responsable…" />
            </div>
            <span className="ds-body-sm ds-muted" style={{ alignSelf: "center" }}>{planCategorias.length} partida(s) · {planFilas.length} unidad(es)</span>
          </div>
        </Card>

        <Card className="mt-4" style={{ padding: 0, overflow: "hidden" }}>
          <div className="ds-table-wrap" style={{ boxShadow: "none", overflowX: "auto" }}>
            <table className="ds-table" style={{ minWidth: 900 }}>
              <thead>
                <tr>
                  <th style={{ minWidth: 140, position: "sticky", left: 0, background: "#fff", zIndex: 2 }}>Unidad</th>
                  <th style={{ minWidth: 100 }}>Responsable</th>
                  <th style={{ minWidth: 200 }}>Pedidos</th>
                  {planCategorias.map((c) => (
                    <th key={c.id} style={{ minWidth: 120 }}>
                      <div className="row gap-2" style={{ alignItems: "center", justifyContent: "space-between" }}>
                        <span className="ds-body-sm">{c.nombre}</span>
                        <button type="button" className="tpl-card__del" style={{ position: "static" }} title="Quitar partida" onClick={() => removePlanCategoria(c.id)}>×</button>
                      </div>
                    </th>
                  ))}
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filasVis.length === 0 && (
                  <tr><td colSpan={planCategorias.length + 4}><div className="empty">{planFilas.length === 0 ? "Importá tu Excel o agregá unidades abajo." : "Ninguna unidad coincide con la búsqueda."}</div></td></tr>
                )}
                {filasVis.map((f) => {
                  const peds = pedidosDe(f.lote);
                  return (
                    <tr key={f.id}>
                      <td style={{ position: "sticky", left: 0, background: "#fff", zIndex: 1 }}>
                        <div className="ds-strong ds-body-sm">{f.modelo || "—"}</div>
                        <div className="ds-muted ds-body-sm">{f.lote}</div>
                      </td>
                      <td className="ds-muted ds-body-sm">{f.responsable || "—"}</td>
                      <td>
                        <div className="row gap-2 wrap" style={{ alignItems: "center" }}>
                          {peds.length === 0
                            ? <span className="ds-body-sm ds-muted">Sin pedir</span>
                            : peds.map((p) => { const b = pedidoBadge(p.estado); return <Badge key={p.id} tone={b.tone}>{p.numero}: {b.label}</Badge>; })}
                          <button type="button" className="link-btn" title="Armar pedido de compra para esta unidad" onClick={() => armarPedido(f)}>+ Armar pedido</button>
                        </div>
                      </td>
                      {planCategorias.map((c) => (
                        <td key={c.id} style={{ padding: "4px 6px" }}>
                          <input className="ds-cell-input" value={f.valores[c.id] ?? ""} placeholder="—" onChange={(e) => setPlanCelda(f.id, c.id, e.target.value)} style={{ width: "100%", minWidth: 100, boxSizing: "border-box" }} />
                        </td>
                      ))}
                      <td className="ds-num"><button type="button" className="icon-btn" title="Quitar unidad" onClick={() => removePlanFila(f.id)}>×</button></td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3} style={{ padding: "8px 6px" }}>
                    <div className="row gap-2 wrap">
                      <input className="ds-cell-input" value={modelo} onChange={(e) => setModelo(e.target.value)} placeholder="Modelo…" style={{ width: 150 }} />
                      <input className="ds-cell-input" value={lote} onChange={(e) => setLote(e.target.value)} placeholder="Lote…" style={{ width: 90 }} />
                      <input className="ds-cell-input" value={responsable} onChange={(e) => setResponsable(e.target.value)} placeholder="Responsable…" style={{ width: 130 }} />
                      <Button variant="outline" onClick={agregarFila}>+ Unidad</Button>
                    </div>
                  </td>
                  <td colSpan={planCategorias.length + 1} className="ds-muted ds-body-sm" style={{ padding: "8px 6px" }}>Las celdas de partida se llenan después de agregar la unidad.</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      </main>
    </AppShell>
  );
}
