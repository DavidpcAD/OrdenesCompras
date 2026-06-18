"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/shell";
import { Badge, Button, Card } from "@/components/ui";
import { Combobox } from "@/components/combobox";
import { useStore } from "@/lib/store";
import { destinoLabel, num, recibidoDeLineaPedido } from "@/lib/helpers";

export default function SeguimientoPage() {
  const { pedidos, ordenes } = useStore();
  const router = useRouter();

  const [proyecto, setProyecto] = useState(""); // "" = todos
  const [busqueda, setBusqueda] = useState("");
  const PAGINA = 100;
  const [limite, setLimite] = useState(PAGINA);

  // Una fila por línea de cada pedido, con lo solicitado y lo que ya llegó.
  const filas = useMemo(() => {
    return pedidos.flatMap((p) =>
      p.lineas.map((l) => {
        const recibido = recibidoDeLineaPedido(ordenes, l.id);
        return {
          key: l.id,
          proyecto: destinoLabel(p),
          pedidoId: p.id,
          pedidoNumero: p.numero,
          tipo: p.tipoSolicitud,
          articulo: l.descripcion,
          unidad: l.unidad,
          almacen: l.almacen,
          solicitado: l.cantidad,
          recibido,
          pendiente: Math.max(0, l.cantidad - recibido),
          comentario: p.notas ?? "",
        };
      })
    );
  }, [pedidos, ordenes]);

  const proyectosItems = useMemo(() => {
    const set = Array.from(new Set(filas.map((f) => f.proyecto))).sort();
    return [{ key: "", label: "Todos los proyectos" }, ...set.map((p) => ({ key: p, label: p }))];
  }, [filas]);

  const q = busqueda.trim().toLowerCase();
  const filtradas = filas
    .filter((f) => !proyecto || f.proyecto === proyecto)
    .filter((f) => !q || f.articulo.toLowerCase().includes(q) || f.pedidoNumero.toLowerCase().includes(q) || f.comentario.toLowerCase().includes(q));
  const visibles = filtradas.slice(0, limite);

  return (
    <AppShell role="ingenieria">
      <main className="page">
        <div className="page__head">
          <div className="page__title">
            <h1 className="ds-heading">Seguimiento por proyecto</h1>
            <p className="ds-muted">Todas las líneas que pediste, agrupadas por proyecto: lo solicitado, lo que ya llegó y lo que falta.</p>
          </div>
        </div>

        <div className="row row--between wrap gap-3 mt-2" style={{ alignItems: "flex-end" }}>
          <div className="qa-field" style={{ minWidth: 280, flex: "0 1 360px" }}>
            <label style={{ fontSize: "var(--ds-font-size-body-sm)", color: "var(--ds-color-gray-500)", fontWeight: 600 }}>Proyecto</label>
            <Combobox
              items={proyectosItems}
              value={proyecto}
              onChange={(k) => { setProyecto(k); setLimite(PAGINA); }}
              getKey={(p) => p.key}
              getLabel={(p) => p.label}
              placeholder="Buscar / elegir proyecto…"
            />
          </div>
          <input className="ds-form-field__input" style={{ maxWidth: 300, borderRadius: 12, padding: "8px 14px" }}
            placeholder="Buscar artículo, pedido o comentario…" value={busqueda}
            onChange={(e) => { setBusqueda(e.target.value); setLimite(PAGINA); }} />
        </div>

        <div className="ds-label ds-muted mt-4" style={{ marginBottom: 10 }}>{filtradas.length} línea(s){proyecto ? ` · ${proyecto}` : ""}</div>

        <Card style={{ padding: 0, overflow: "hidden" }}>
          <div className="ds-table-wrap" style={{ boxShadow: "none" }}>
            <table className="ds-table">
              <thead>
                <tr>
                  <th>Proyecto</th><th>Almacén</th><th>Pedido</th><th>Artículo</th>
                  <th className="ds-num">Solicitado</th><th className="ds-num">Recibido</th><th className="ds-num">Por recibir</th>
                  <th>Comentario</th>
                </tr>
              </thead>
              <tbody>
                {filtradas.length === 0 && (
                  <tr><td colSpan={8}><div className="empty">No hay líneas para mostrar.</div></td></tr>
                )}
                {visibles.map((f) => (
                  <tr key={f.key} className="is-clickable" onClick={() => router.push(`/ingenieria/${f.pedidoId}`)}>
                    <td>{f.proyecto}</td>
                    <td className="ds-muted">{f.almacen}</td>
                    <td><span className="row gap-2" style={{ alignItems: "center" }}>
                      {f.tipo === "repuesto" ? <Badge tone="yellow">Rep.</Badge> : <Badge tone="green">Mat.</Badge>}
                      <span className="ds-body-sm ds-strong">{f.pedidoNumero}</span>
                    </span></td>
                    <td>{f.articulo}</td>
                    <td className="ds-num">{num.format(f.solicitado)} {f.unidad}</td>
                    <td className="ds-num ds-strong">{num.format(f.recibido)}</td>
                    <td className="ds-num">{f.pendiente > 0 ? <span className="ds-pending-text">{num.format(f.pendiente)}</span> : <span className="ds-muted">0</span>}</td>
                    <td className="ds-muted ds-body-sm">{f.comentario || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {filtradas.length > limite && (
          <div className="row mt-4" style={{ justifyContent: "center" }}>
            <Button variant="outline" onClick={() => setLimite((n) => n + PAGINA)}>Mostrar más ({filtradas.length - limite} restantes)</Button>
          </div>
        )}
      </main>
    </AppShell>
  );
}
