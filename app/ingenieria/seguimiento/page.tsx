"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/shell";
import { Badge, Button, Card } from "@/components/ui";
import { useStore } from "@/lib/store";
import { destinoLabel, num, recibidoDeLineaPedido, tipoSolicitudBadge } from "@/lib/helpers";

export default function SeguimientoPage() {
  const { pedidos, ordenes } = useStore();
  const router = useRouter();

  const [colF, setColF] = useState<Record<string, string>>({});
  const setCol = (k: string, v: string) => setColF((f) => ({ ...f, [k]: v }));
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

  const COLS = ["proyecto", "obra", "pedido", "articulo", "solicitado", "recibido", "porrecibir", "comentario"];
  const cellText = (f: typeof filas[number], k: string): string => {
    switch (k) {
      case "proyecto": return f.proyecto;
      case "obra": return f.almacen ?? "";
      case "pedido": return f.pedidoNumero;
      case "articulo": return f.articulo;
      case "solicitado": return `${f.solicitado} ${f.unidad}`;
      case "recibido": return String(f.recibido);
      case "porrecibir": return String(f.pendiente);
      case "comentario": return f.comentario ?? "";
      default: return "";
    }
  };
  const filtradas = filas.filter((f) => COLS.every((k) => { const v = (colF[k] ?? "").trim().toLowerCase(); return !v || cellText(f, k).toLowerCase().includes(v); }));
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

        <div className="ds-label ds-muted mt-4" style={{ marginBottom: 10 }}>{filtradas.length} línea(s)</div>

        <Card style={{ padding: 0, overflow: "hidden" }}>
          <div className="ds-table-wrap" style={{ boxShadow: "none" }}>
            <table className="ds-table">
              <thead>
                <tr>
                  <th>Proyecto</th><th>Obra</th><th>Pedido</th><th>Artículo</th>
                  <th className="ds-num">Solicitado</th><th className="ds-num">Recibido</th><th className="ds-num">Por recibir</th>
                  <th>Comentario</th>
                </tr>
                <tr>
                  {COLS.map((k) => (
                    <th key={k} style={{ padding: "4px 6px", fontWeight: 400 }}>
                      <input value={colF[k] ?? ""} placeholder="Filtrar…" onChange={(e) => { setCol(k, e.target.value); setLimite(PAGINA); }}
                        style={{ width: "100%", boxSizing: "border-box", borderRadius: 8, padding: "4px 8px", fontSize: 12, font: "inherit", border: "1.5px solid var(--ds-color-gray-100)", background: "#fff", textAlign: ["solicitado", "recibido", "porrecibir"].includes(k) ? "right" : "left" }} />
                    </th>
                  ))}
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
                      {(() => { const t = tipoSolicitudBadge(f.tipo); return <Badge tone={t.tone}>{t.label}</Badge>; })()}
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
