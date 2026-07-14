"use client";

import { useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { AppShell } from "@/components/shell";
import { Card, Badge } from "@/components/ui";
import { DataTable } from "@/components/data-table";
import { useStore } from "@/lib/store";
import { money, num } from "@/lib/helpers";
import type { Articulo } from "@/lib/types";

type Row = Articulo & { recibido: number };
type Existencia = { itemNo: string; variantCode: string; locationCode: string; descripcion: string; cantidad: number; unidad: string };
type EstadoBc = "idle" | "loading" | "ok" | "empty" | "error";

export default function InventariosPage() {
  const { articulos, ordenes } = useStore();

  const rows = useMemo<Row[]>(() => {
    // "Recibido (app)" = suma de cantidadRecibida por artículo (proxy de ingresos,
    // NO stock neto: la app no registra salidas/consumo). El stock neto real sale
    // de BC al seleccionar el artículo (existencias por ubicación).
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
    { id: "alm", header: "Almacén def.", accessorFn: (a) => a.almacenDefault ?? "—", meta: { label: "Almacén def." }, cell: (c) => c.getValue() },
    { id: "precio", header: "Precio ref.", accessorFn: (a) => a.precioReferencia ?? 0, meta: { label: "Precio ref.", num: true }, enableColumnFilter: false, cell: (c) => money(c.getValue(), "CRC") },
    { id: "recibido", header: "Recibido (app)", accessorFn: (a) => a.recibido, meta: { label: "Recibido (app)", num: true }, enableColumnFilter: false, cell: (c) => num.format(c.getValue()) },
  ], []);

  // --- Existencias BC del artículo seleccionado ---
  const [sel, setSel] = useState<Row | null>(null);
  const [estado, setEstado] = useState<EstadoBc>("idle");
  const [existencias, setExistencias] = useState<Existencia[]>([]);
  const [errMsg, setErrMsg] = useState("");

  useEffect(() => {
    if (!sel) { setEstado("idle"); setExistencias([]); return; }
    let vivo = true;
    setEstado("loading"); setExistencias([]); setErrMsg("");
    fetch(`/api/bc/existencias?itemNo=${encodeURIComponent(sel.code)}`)
      .then(async (r) => ({ ok: r.ok, body: await r.json().catch(() => ({})) }))
      .then(({ ok, body }) => {
        if (!vivo) return;
        if (!ok) { setEstado("error"); setErrMsg(body?.error || "Business Central no respondió."); return; }
        const ex: Existencia[] = Array.isArray(body?.existencias) ? body.existencias : [];
        setExistencias(ex);
        setEstado(ex.length ? "ok" : "empty");
      })
      .catch((e) => { if (vivo) { setEstado("error"); setErrMsg(String(e?.message ?? e)); } });
    return () => { vivo = false; };
  }, [sel]);

  const exColumns = useMemo<ColumnDef<Existencia, any>[]>(() => [
    { id: "almacen", header: "Almacén", accessorFn: (e) => e.locationCode || "—", meta: { label: "Almacén" }, cell: (c) => <span className="ds-strong">{c.getValue()}</span> },
    { id: "variante", header: "Variante", accessorFn: (e) => e.variantCode || "(sin variante)", meta: { label: "Variante" }, cell: (c) => c.getValue() },
    { id: "disponible", header: "Disponible", accessorFn: (e) => e.cantidad, meta: { label: "Disponible", num: true }, enableColumnFilter: false, cell: (c) => { const v = Number(c.getValue()); return <span className="ds-strong" style={{ color: v > 0 ? "var(--ds-color-green-300, inherit)" : "var(--ds-color-red-100)" }}>{num.format(v)}</span>; } },
    { id: "unidad", header: "Unidad", accessorFn: (e) => e.unidad || "—", meta: { label: "Unidad" }, enableColumnFilter: false, cell: (c) => c.getValue() },
  ], []);

  const totalDisp = existencias.reduce((s, e) => s + (Number(e.cantidad) || 0), 0);

  return (
    <AppShell role="ingenieria">
      <main className="page page--wide">
        <div className="page__head">
          <div className="page__title">
            <h1 className="ds-heading">Inventarios</h1>
            <p className="ds-muted">Catálogo de artículos. Hacé clic en uno para ver sus <strong>existencias por almacén</strong> desde Business Central (almacén general o el almacén virtual de cada obra), desglosadas por variante.</p>
          </div>
        </div>

        <div className="mt-4">
          <DataTable data={rows} columns={columns} tablaKey="inventarios-ing" getRowId={(a) => a.code} onRowClick={(a) => setSel(a)} rowClassName={(a) => (sel?.code === a.code ? "row-borrador" : "")} vacio="Sin artículos en el catálogo." />
        </div>

        {/* Detalle: existencias en BC del artículo seleccionado. */}
        {sel && (
          <div className="mt-6">
            <div className="row gap-3" style={{ alignItems: "baseline", flexWrap: "wrap" }}>
              <span className="ds-subtitle">Existencias en BC · <span className="ds-strong">{sel.code}</span> <span className="ds-muted">{sel.descripcion}</span></span>
              {estado === "ok" && <Badge tone={totalDisp > 0 ? "green" : "red"}>Total disponible: {num.format(totalDisp)} {sel.unidad}</Badge>}
            </div>

            <div className="mt-2">
              {estado === "loading" && <Card><span className="ds-muted">Consultando existencias en Business Central…</span></Card>}
              {estado === "error" && (
                <Card style={{ borderLeft: "4px solid var(--ds-color-red-100)" }}>
                  <div className="ds-strong">No se pudieron cargar las existencias desde BC</div>
                  <div className="ds-muted ds-body-sm" style={{ marginTop: 4 }}>{errMsg || "Business Central no está disponible."} Puede que el endpoint <code>inventoryByLocation</code> aún no esté publicado en este entorno, o que no haya conexión a BC.</div>
                </Card>
              )}
              {estado === "empty" && (
                <Card style={{ borderLeft: "4px solid var(--ds-color-yellow)" }}>
                  <div className="ds-strong">Sin existencias registradas</div>
                  <div className="ds-muted ds-body-sm" style={{ marginTop: 4 }}>BC no reporta stock de <strong>{sel.code}</strong> en ninguna ubicación.</div>
                </Card>
              )}
              {estado === "ok" && (
                <DataTable data={existencias} columns={exColumns} tablaKey="existencias-bc" vacio="Sin existencias." />
              )}
            </div>
          </div>
        )}
      </main>
    </AppShell>
  );
}
