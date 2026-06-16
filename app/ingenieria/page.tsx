"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/shell";
import { Badge, Button, Card, Tile } from "@/components/ui";
import { useStore } from "@/lib/store";
import { destinoLabel, formatDate, pedidoBadge } from "@/lib/helpers";

export default function IngenieriaPage() {
  const { pedidos } = useStore();
  const router = useRouter();

  const material = pedidos.filter((p) => p.tipoSolicitud === "material").length;
  const repuesto = pedidos.filter((p) => p.tipoSolicitud === "repuesto").length;
  const aprobados = pedidos.filter((p) => p.estado === "aprobado").length;

  return (
    <AppShell role="ingenieria">
      <main className="page">
        <div className="page__head">
          <div className="page__title">
            <h1 className="ds-heading">Mis solicitudes de material</h1>
            <p className="ds-muted">Pedí material para una obra o repuestos para una máquina. Proveeduría se encarga del proveedor.</p>
          </div>
          <Link href="/ingenieria/nuevo"><Button>+ Nueva solicitud</Button></Link>
        </div>

        <div className="tiles mt-2">
          <Tile value={pedidos.length} label="Solicitudes totales" />
          <Tile value={material} label="De material (obra)" accent="var(--ds-color-green-100)" />
          <Tile value={repuesto} label="De repuesto (máquina)" accent="var(--ds-color-yellow)" />
          <Tile value={aprobados} label="Aprobadas" accent="var(--ds-color-green-200)" />
        </div>

        <Card className="mt-6" style={{ padding: 0, overflow: "hidden" }}>
          <div className="ds-table-wrap" style={{ boxShadow: "none" }}>
            <table className="ds-table">
              <thead>
                <tr>
                  <th>N.º</th><th>Tipo</th><th>Destino</th><th>Solicitante</th><th>Fecha</th>
                  <th className="ds-num">Líneas</th><th>Prioridad</th><th>Estado</th><th></th>
                </tr>
              </thead>
              <tbody>
                {pedidos.length === 0 && (
                  <tr><td colSpan={9}><div className="empty">Aún no hay solicitudes. Creá la primera.</div></td></tr>
                )}
                {pedidos.map((p) => {
                  const b = pedidoBadge(p.estado);
                  return (
                    <tr key={p.id} className="is-clickable" onClick={() => router.push(`/ingenieria/${p.id}`)}>
                      <td className="ds-strong">{p.numero}</td>
                      <td>{p.tipoSolicitud === "repuesto" ? <Badge tone="yellow">Repuesto</Badge> : <Badge tone="green">Material</Badge>}</td>
                      <td>{destinoLabel(p)}</td>
                      <td>{p.solicitante}</td>
                      <td>{formatDate(p.fecha)}</td>
                      <td className="ds-num">{p.lineas.length}</td>
                      <td>
                        {p.prioridad === "urgente" ? <Badge tone="red">Urgente</Badge>
                          : p.prioridad === "alta" ? <Badge tone="yellow">Alta</Badge>
                          : <Badge tone="gray">Normal</Badge>}
                      </td>
                      <td><Badge tone={b.tone}>{b.label}</Badge></td>
                      <td className="ds-num">›</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </main>
    </AppShell>
  );
}
