"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AppShell } from "@/components/shell";
import { Button, Card, Field, Input, Select, Textarea, useToast } from "@/components/ui";
import { useStore } from "@/lib/store";
import type { Pedido } from "@/lib/types";

interface DraftLine {
  key: string;
  articuloId: string;
  cantidad: string;
}

export default function NuevoPedidoPage() {
  const { articulos, addPedido } = useStore();
  const router = useRouter();
  const toast = useToast();

  const [proyecto, setProyecto] = useState("");
  const [solicitante, setSolicitante] = useState("");
  const [prioridad, setPrioridad] = useState<Pedido["prioridad"]>("normal");
  const [notas, setNotas] = useState("");
  const [lineas, setLineas] = useState<DraftLine[]>([
    { key: Math.random().toString(36).slice(2), articuloId: "", cantidad: "" },
  ]);

  function setLine(key: string, patch: Partial<DraftLine>) {
    setLineas((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLineas((ls) => [...ls, { key: Math.random().toString(36).slice(2), articuloId: "", cantidad: "" }]);
  }
  function removeLine(key: string) {
    setLineas((ls) => (ls.length === 1 ? ls : ls.filter((l) => l.key !== key)));
  }

  const lineasValidas = lineas.filter((l) => l.articuloId && Number(l.cantidad) > 0);
  const puedeGuardar = proyecto.trim() && solicitante.trim() && lineasValidas.length > 0;

  function guardar() {
    if (!puedeGuardar) {
      toast("Completá proyecto, solicitante y al menos una línea válida.", "error");
      return;
    }
    const p = addPedido({
      proyecto: proyecto.trim(),
      solicitante: solicitante.trim(),
      prioridad,
      notas: notas.trim() || undefined,
      lineas: lineasValidas.map((l) => {
        const a = articulos.find((x) => x.id === l.articuloId)!;
        return {
          articuloId: a.id, descripcion: a.descripcion, cantidad: Number(l.cantidad),
          unidad: a.unidad, almacen: a.almacenDefault,
        };
      }),
    });
    toast(`Pedido ${p.numero} creado`, "success");
    router.push(`/ingenieria/${p.id}`);
  }

  return (
    <AppShell role="ingenieria">
      <main className="page">
        <div className="back-link" onClick={() => router.push("/ingenieria")}>‹ Volver a pedidos</div>
        <div className="page__head">
          <div className="page__title">
            <h1 className="ds-heading">Nuevo pedido de compra</h1>
            <p className="ds-muted">Indicá el proyecto y las líneas de material que necesitás.</p>
          </div>
        </div>

        <Card>
          <h3 className="ds-subtitle" style={{ marginBottom: 16 }}>Datos generales</h3>
          <div className="grid-2">
            <Field label="Proyecto">
              <Input value={proyecto} onChange={(e) => setProyecto(e.target.value)} placeholder="Ej. Torre Escazú — Fase 2" />
            </Field>
            <Field label="Solicitante">
              <Input value={solicitante} onChange={(e) => setSolicitante(e.target.value)} placeholder="Tu nombre" />
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
            <h3 className="ds-subtitle">Líneas de material</h3>
            <Button variant="outline" size="sm" onClick={addLine}>+ Agregar línea</Button>
          </div>

          <div className="ds-table-wrap" style={{ boxShadow: "none" }}>
            <table className="ds-table">
              <thead>
                <tr><th style={{ minWidth: 320 }}>Artículo</th><th>Unidad</th><th>Almacén</th><th className="ds-num">Cantidad</th><th></th></tr>
              </thead>
              <tbody>
                {lineas.map((l) => {
                  const a = articulos.find((x) => x.id === l.articuloId);
                  return (
                    <tr key={l.key}>
                      <td>
                        <select className="ds-form-field__select" style={{ borderRadius: 8, padding: "8px 12px" }}
                          value={l.articuloId} onChange={(e) => setLine(l.key, { articuloId: e.target.value })}>
                          <option value="">Seleccionar artículo…</option>
                          {articulos.map((x) => (
                            <option key={x.id} value={x.id}>{x.code} — {x.descripcion}</option>
                          ))}
                        </select>
                      </td>
                      <td className="ds-muted">{a?.unidad ?? "—"}</td>
                      <td className="ds-muted">{a?.almacenDefault ?? "—"}</td>
                      <td className="ds-num">
                        <input className="ds-cell-input" type="number" min={0} value={l.cantidad}
                          onChange={(e) => setLine(l.key, { cantidad: e.target.value })} placeholder="0" />
                      </td>
                      <td><button className="icon-btn" onClick={() => removeLine(l.key)} aria-label="Borrar línea">🗑</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="row gap-3 mt-6" style={{ justifyContent: "flex-end" }}>
          <Button variant="outline" onClick={() => router.push("/ingenieria")}>Cancelar</Button>
          <Button onClick={guardar} disabled={!puedeGuardar}>Guardar pedido</Button>
        </div>
      </main>
    </AppShell>
  );
}
