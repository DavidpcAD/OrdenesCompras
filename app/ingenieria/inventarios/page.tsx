"use client";

import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { AppShell } from "@/components/shell";
import { Card } from "@/components/ui";
import { DataTable } from "@/components/data-table";
import { useStore } from "@/lib/store";
import { money, num } from "@/lib/helpers";
import type { Articulo } from "@/lib/types";

type Row = Articulo & { recibido: number };

export default function InventariosPage() {
  const { articulos, ordenes } = useStore();

  const rows = useMemo<Row[]>(() => {
    // "Recibido (app)" = suma de cantidadRecibida por artículo (proxy de ingresos,
    // NO stock neto: la app no registra salidas/consumo).
    const rec = new Map<string, number>();
    for (const o of ordenes) for (const l of o.lineas) {
      if (l.tipo === "articulo" && l.articuloId) rec.set(l.articuloId, (rec.get(l.articuloId) ?? 0) + (l.cantidadRecibida ?? 0));
    }
    return articulos.map((a) => ({ ...a, recibido: rec.get(a.code) ?? rec.get(a.id) ?? 0 }));
  }, [articulos, ordenes]);

  const columns = useMemo<ColumnDef<Row, any>[]>(() => [
    { id: "code", header: "Código", accessorFn: (a) => a.code, meta: { label: "Código" }, cell: (c) => <span className="ds-strong">{c.getValue()}</span> },
    { id: "desc", header: "Descripción", accessorFn: (a) => a.descripcion, meta: { label: "Descripción" }, cell: (c) => c.getValue() },
    { id: "unidad", header: "Unidad", accessorFn: (a) => a.unidad, meta: { label: "Unidad" }, cell: (c) => c.getValue() },
    { id: "alm", header: "Almacén", accessorFn: (a) => a.almacenDefault ?? "—", meta: { label: "Almacén" }, cell: (c) => c.getValue() },
    { id: "precio", header: "Precio ref.", accessorFn: (a) => a.precioReferencia ?? 0, meta: { label: "Precio ref.", num: true }, enableColumnFilter: false, cell: (c) => money(c.getValue(), "CRC") },
    { id: "recibido", header: "Recibido (app)", accessorFn: (a) => a.recibido, meta: { label: "Recibido (app)", num: true }, enableColumnFilter: false, cell: (c) => num.format(c.getValue()) },
  ], []);

  return (
    <AppShell role="ingenieria">
      <main className="page page--wide">
        <div className="page__head">
          <div className="page__title">
            <h1 className="ds-heading">Inventarios</h1>
            <p className="ds-muted">Catálogo de artículos y su avance recibido. Las existencias por almacén (general y por obra) se conectan a Business Central.</p>
          </div>
        </div>

        <Card className="mt-2" style={{ borderLeft: "4px solid var(--ds-color-yellow)" }}>
          <div className="ds-strong">Existencias por almacén: pendiente de conectar a Business Central</div>
          <div className="ds-muted ds-body-sm" style={{ marginTop: 4 }}>Hoy se muestra el <strong>recibido registrado por la app</strong> (proxy de ingresos), no el stock neto. Cuando BC exponga existencias por ubicación se agregan las columnas de stock por almacén general y por obra.</div>
        </Card>

        <div className="mt-4">
          <DataTable data={rows} columns={columns} tablaKey="inventarios-ing" vacio="Sin artículos en el catálogo." />
        </div>
      </main>
    </AppShell>
  );
}
