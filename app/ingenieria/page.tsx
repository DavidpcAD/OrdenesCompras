"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { AppShell } from "@/components/shell";
import { Badge, Button, Card, Tile } from "@/components/ui";
import { useStore } from "@/lib/store";
import { destinoLabel, formatDate, pedidoBadge } from "@/lib/helpers";

type Filtro = "todas" | "material" | "repuesto" | "aprobado";

export default function IngenieriaPage() {
  const { pedidos } = useStore();
  const router = useRouter();
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const listaRef = useRef<HTMLDivElement>(null);

  function seleccionar(f: Filtro) {
    setFiltro(f);
    // bajar a la lista para que se vea de inmediato lo filtrado
    setTimeout(() => listaRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }

  const material = pedidos.filter((p) => p.tipoSolicitud === "material").length;
  const repuesto = pedidos.filter((p) => p.tipoSolicitud === "repuesto").length;
  const aprobados = pedidos.filter((p) => p.estado === "aprobado").length;

  const visibles = pedidos.filter((p) =>
    filtro === "material" ? p.tipoSolicitud === "material"
      : filtro === "repuesto" ? p.tipoSolicitud === "repuesto"
      : filtro === "aprobado" ? p.estado === "aprobado"
      : true
  );
  const etiquetaFiltro: Record<Filtro, string> = {
    todas: "Todas las solicitudes",
    material: "Solicitudes de material",
    repuesto: "Solicitudes de repuesto",
    aprobado: "Solicitudes aprobadas",
  };

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
          <Tile value={pedidos.length} label="Solicitudes totales" onClick={() => seleccionar("todas")} active={filtro === "todas"} />
          <Tile value={material} label="De material (obra)" accent="var(--ds-color-green-100)" onClick={() => seleccionar("material")} active={filtro === "material"} />
          <Tile value={repuesto} label="De repuesto (máquina)" accent="var(--ds-color-yellow)" onClick={() => seleccionar("repuesto")} active={filtro === "repuesto"} />
          <Tile value={aprobados} label="Aprobadas" accent="var(--ds-color-green-200)" onClick={() => seleccionar("aprobado")} active={filtro === "aprobado"} />
        </div>

        <div ref={listaRef} className="row row--between mt-6" style={{ marginBottom: 12, alignItems: "baseline", scrollMarginTop: 80 }}>
          <span className="ds-label ds-muted">{etiquetaFiltro[filtro]} · {visibles.length}</span>
          {filtro !== "todas" && <button className="link-btn" onClick={() => setFiltro("todas")}>Ver todas</button>}
        </div>

        <Card style={{ padding: 0, overflow: "hidden" }}>
          <div className="ds-table-wrap" style={{ boxShadow: "none" }}>
            <table className="ds-table">
              <thead>
                <tr>
                  <th>N.º</th><th>Tipo</th><th>Destino</th><th>Solicitante</th><th>Fecha</th>
                  <th className="ds-num">Líneas</th><th>Prioridad</th><th>Estado</th><th></th>
                </tr>
              </thead>
              <tbody>
                {visibles.length === 0 && (
                  <tr><td colSpan={9}><div className="empty">{pedidos.length === 0 ? "Aún no hay solicitudes. Creá la primera." : "No hay solicitudes en esta categoría."}</div></td></tr>
                )}
                {visibles.map((p) => {
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
