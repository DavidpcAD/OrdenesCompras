"use client";

import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { AppShell } from "@/components/shell";
import { Card, Badge, Tile } from "@/components/ui";
import { DataTable } from "@/components/data-table";
import { useStore } from "@/lib/store";
import { num } from "@/lib/helpers";

// Fila de detalle por artículo dentro de una actividad.
type Linea = { code: string; desc: string; unidad: string; ordenado: number; recibido: number; pendiente: number };
type Actividad = { task: string; items: Linea[] };
type Proyecto = { proj: string; ordenado: number; pendiente: number; nLineas: number; tasks: Actividad[] };

// Desglose de materiales ordenados por proyecto (Job) → actividad (Job Task) → artículo.
// Panel maestro-detalle (patrón de la app): tiles arriba para elegir proyecto,
// y abajo una tabla filtrable por cada actividad. El nombre de cada actividad
// depende del catálogo de Job Tasks de BC (pendiente de conectar).
export default function PorActividadPage() {
  const { ordenes } = useStore();

  const proyectos = useMemo<Proyecto[]>(() => {
    const byProj = new Map<string, Map<string, Map<string, Linea>>>();
    for (const o of ordenes) for (const l of o.lineas) {
      if (l.tipo !== "articulo" || !l.articuloId) continue;
      const proj = l.proyecto || "(sin proyecto)";
      const task = l.taskNo || "(sin actividad)";
      if (!byProj.has(proj)) byProj.set(proj, new Map());
      const pm = byProj.get(proj)!;
      if (!pm.has(task)) pm.set(task, new Map());
      const tm = pm.get(task)!;
      const cur = tm.get(l.articuloId) ?? { code: l.articuloId, desc: l.descripcion, unidad: l.unidad, ordenado: 0, recibido: 0, pendiente: 0 };
      cur.ordenado += l.cantidad; cur.recibido += l.cantidadRecibida ?? 0;
      cur.pendiente = Math.max(0, cur.ordenado - cur.recibido);
      tm.set(l.articuloId, cur);
    }
    return [...byProj.entries()].map(([proj, pm]) => {
      const tasks = [...pm.entries()].map(([task, tm]) => ({ task, items: [...tm.values()] }));
      const ordenado = tasks.reduce((s, t) => s + t.items.reduce((a, i) => a + i.ordenado, 0), 0);
      const pendiente = tasks.reduce((s, t) => s + t.items.reduce((a, i) => a + i.pendiente, 0), 0);
      const nLineas = tasks.reduce((s, t) => s + t.items.length, 0);
      return { proj, ordenado, pendiente, nLineas, tasks };
    });
  }, [ordenes]);

  const [sel, setSel] = useState<string | null>(null);
  const activo = proyectos.find((p) => p.proj === sel) ?? proyectos[0] ?? null;

  const columns = useMemo<ColumnDef<Linea, any>[]>(() => [
    { id: "code", header: "Artículo", accessorFn: (i) => `${i.code} ${i.desc}`, meta: { label: "Artículo" }, cell: (c) => { const i = c.row.original; return <div><span className="ds-strong ds-body-sm">{i.code}</span> <span className="ds-muted">— {i.desc}</span></div>; } },
    { id: "ordenado", header: "Ordenado", accessorFn: (i) => i.ordenado, meta: { label: "Ordenado", num: true }, enableColumnFilter: false, cell: (c) => <>{num.format(c.getValue())} {c.row.original.unidad}</> },
    { id: "recibido", header: "Recibido", accessorFn: (i) => i.recibido, meta: { label: "Recibido", num: true }, enableColumnFilter: false, cell: (c) => num.format(c.getValue()) },
    { id: "pendiente", header: "Pendiente", accessorFn: (i) => i.pendiente, meta: { label: "Pendiente", num: true }, enableColumnFilter: false, cell: (c) => <span className="ds-strong">{num.format(c.getValue())}</span> },
  ], []);

  return (
    <AppShell role="ingenieria">
      <main className="page page--wide">
        <div className="page__head">
          <div className="page__title">
            <h1 className="ds-heading">Materiales por actividad</h1>
            <p className="ds-muted">Elegí un proyecto para ver lo ordenado y recibido por actividad (Job Task). Cada tabla se puede filtrar por columna.</p>
          </div>
        </div>

        <Card className="mt-2" style={{ borderLeft: "4px solid var(--ds-color-yellow)" }}>
          <div className="ds-strong">Nombres de actividades (Job Tasks): pendiente de conectar a BC</div>
          <div className="ds-muted ds-body-sm" style={{ marginTop: 4 }}>Se muestran los códigos de actividad que traen las órdenes. Cuando se conecte el catálogo de Job Tasks de BC se verá el nombre de cada actividad.</div>
        </Card>

        {proyectos.length === 0 ? (
          <div className="empty mt-4">Todavía no hay materiales ordenados.</div>
        ) : (
          <>
            {/* Panel de proyectos: clic para seleccionar (patrón tiles de la app). */}
            <div className="tiles mt-4">
              {proyectos.map((p) => (
                <Tile
                  key={p.proj}
                  value={p.pendiente}
                  label={`${p.proj} · pendiente`}
                  accent={p.pendiente > 0 ? "var(--ds-color-yellow)" : "var(--ds-color-green-200)"}
                  onClick={() => setSel(p.proj)}
                  active={activo?.proj === p.proj}
                />
              ))}
            </div>

            {/* Detalle del proyecto seleccionado: una tabla filtrable por actividad. */}
            {activo && (
              <div className="mt-6" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                <span className="ds-subtitle">Proyecto {activo.proj}</span>
                {activo.tasks.map((t) => (
                  <Card key={t.task} style={{ padding: 0, overflow: "hidden" }}>
                    <div className="row gap-3" style={{ alignItems: "center", padding: "10px 16px", borderBottom: "1.5px solid var(--ds-color-gray-100)", background: "color-mix(in srgb, var(--ds-color-green-100) 7%, #fff)" }}>
                      <Badge tone="gray">Actividad</Badge><span className="ds-strong">{t.task}</span>
                    </div>
                    <div style={{ padding: 12 }}>
                      <DataTable data={t.items} columns={columns} tablaKey={`poract-${activo.proj}-${t.task}`} vacio="Sin artículos en esta actividad." />
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </AppShell>
  );
}
