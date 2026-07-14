"use client";

import { useMemo } from "react";
import { AppShell } from "@/components/shell";
import { Card, Badge } from "@/components/ui";
import { useStore } from "@/lib/store";
import { num } from "@/lib/helpers";

// Desglose de materiales ordenados por proyecto (Job) → actividad (Job Task) → artículo.
// Sale de las órdenes ya creadas (OrdenLinea.proyecto/taskNo). El nombre de cada
// actividad depende del catálogo de Job Tasks de BC (pendiente).
export default function PorActividadPage() {
  const { ordenes } = useStore();

  const grupos = useMemo(() => {
    const byProj = new Map<string, Map<string, Map<string, { desc: string; unidad: string; ordenado: number; recibido: number }>>>();
    for (const o of ordenes) for (const l of o.lineas) {
      if (l.tipo !== "articulo" || !l.articuloId) continue;
      const proj = l.proyecto || "(sin proyecto)";
      const task = l.taskNo || "(sin actividad)";
      if (!byProj.has(proj)) byProj.set(proj, new Map());
      const pm = byProj.get(proj)!;
      if (!pm.has(task)) pm.set(task, new Map());
      const tm = pm.get(task)!;
      const cur = tm.get(l.articuloId) ?? { desc: l.descripcion, unidad: l.unidad, ordenado: 0, recibido: 0 };
      cur.ordenado += l.cantidad; cur.recibido += l.cantidadRecibida ?? 0;
      tm.set(l.articuloId, cur);
    }
    return [...byProj.entries()].map(([proj, pm]) => ({
      proj,
      tasks: [...pm.entries()].map(([task, tm]) => ({ task, items: [...tm.entries()].map(([code, v]) => ({ code, ...v })) })),
    }));
  }, [ordenes]);

  return (
    <AppShell role="ingenieria">
      <main className="page page--wide">
        <div className="page__head">
          <div className="page__title">
            <h1 className="ds-heading">Materiales por actividad</h1>
            <p className="ds-muted">Lo ordenado y recibido, desglosado por proyecto y actividad (Job Task), para seguir el consumo en tiempo real.</p>
          </div>
        </div>

        <Card className="mt-2" style={{ borderLeft: "4px solid var(--ds-color-yellow)" }}>
          <div className="ds-strong">Nombres de actividades (Job Tasks): pendiente de conectar a BC</div>
          <div className="ds-muted ds-body-sm" style={{ marginTop: 4 }}>Se muestran los códigos de actividad que traen las órdenes. Cuando BC exponga el catálogo de Job Tasks se verá el nombre de cada actividad y se podrá elegir la actividad al pedir.</div>
        </Card>

        <div className="mt-4" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {grupos.length === 0 && <div className="empty">Todavía no hay materiales ordenados.</div>}
          {grupos.map((g) => (
            <section key={g.proj} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <span className="ds-subtitle">Proyecto {g.proj}</span>
              {g.tasks.map((t) => (
                <Card key={t.task} style={{ padding: 0, overflow: "hidden" }}>
                  <div className="row gap-3" style={{ alignItems: "center", padding: "10px 16px", borderBottom: "1.5px solid var(--ds-color-gray-100)", background: "color-mix(in srgb, var(--ds-color-green-100) 7%, #fff)" }}>
                    <Badge tone="gray">Actividad</Badge><span className="ds-strong">{t.task}</span>
                  </div>
                  <div className="ds-table-wrap" style={{ boxShadow: "none" }}>
                    <table className="ds-table">
                      <thead><tr><th>Artículo</th><th className="ds-num">Ordenado</th><th className="ds-num">Recibido</th><th className="ds-num">Pendiente</th></tr></thead>
                      <tbody>
                        {t.items.map((it) => (
                          <tr key={it.code}>
                            <td><span className="ds-strong ds-body-sm">{it.code}</span> <span className="ds-muted">— {it.desc}</span></td>
                            <td className="ds-num">{num.format(it.ordenado)} {it.unidad}</td>
                            <td className="ds-num">{num.format(it.recibido)}</td>
                            <td className="ds-num ds-strong">{num.format(Math.max(0, it.ordenado - it.recibido))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              ))}
            </section>
          ))}
        </div>
      </main>
    </AppShell>
  );
}
