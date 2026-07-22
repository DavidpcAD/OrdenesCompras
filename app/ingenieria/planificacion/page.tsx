"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/shell";
import { Button, Card, Input } from "@/components/ui";
import { useStore } from "@/lib/store";

// Planificación = matriz OBRA × PARTIDA que se llena SOLA con las solicitudes de
// material. Las columnas (partidas) salen de la CATEGORÍA del ítem en Business
// Central. Cada celda resume cuántos ítems se pidieron y cuántos faltan por
// comprar. No se importa Excel ni se llena a mano.
const SIN_CAT = "Sin categoría";

export default function PlanificacionPage() {
  const { pedidos } = useStore();
  const [itemCat, setItemCat] = useState<Record<string, string>>({});
  const [obraNombre, setObraNombre] = useState<Record<string, string>>({});
  const [cargandoBc, setCargandoBc] = useState(true);
  const [buscar, setBuscar] = useState("");

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const [ri, ro] = await Promise.all([fetch("/api/bc/items"), fetch("/api/bc/obras")]);
        const items = ri.ok ? ((await ri.json()).items ?? []) : [];
        const obras = ro.ok ? ((await ro.json()).obras ?? []) : [];
        if (cancel) return;
        setItemCat(Object.fromEntries(items.map((i: any) => [i.code, (i.categoria ?? "").trim()]).filter((x: any[]) => x[0])));
        setObraNombre(Object.fromEntries(obras.map((o: any) => [o.codigo, o.nombre])));
      } catch { /* sin BC: se muestran códigos y todo cae en "Sin categoría" */ }
      finally { if (!cancel) setCargandoBc(false); }
    })();
    return () => { cancel = true; };
  }, []);

  // Solo material (va a obra). Cada línea aporta a la celda [obra][partida].
  type Celda = { items: number; pendientes: number; detalle: string[] };
  const { obras, partidas, matriz } = useMemo(() => {
    const m: Record<string, Record<string, Celda>> = {};
    const setObras = new Set<string>();
    const setPart = new Set<string>();
    for (const p of pedidos) {
      if (p.tipoSolicitud !== "material") continue;
      for (const l of p.lineas) {
        const obra = l.almacen || (p.obraCodigo && p.obraCodigo !== "(varias)" ? p.obraCodigo : "");
        if (!obra) continue;
        const cat = (itemCat[l.articuloId] || "").trim() || SIN_CAT;
        setObras.add(obra); setPart.add(cat);
        m[obra] ??= {};
        m[obra][cat] ??= { items: 0, pendientes: 0, detalle: [] };
        const c = m[obra][cat];
        c.items += 1;
        if (l.cantidad - l.cantidadOrdenada > 1e-9) c.pendientes += 1;
        c.detalle.push(`${l.articuloId} · ${l.cantidad} ${l.unidad}${l.cantidadOrdenada > 0 ? ` (comprado ${l.cantidadOrdenada})` : ""}`);
      }
    }
    const obras = [...setObras].sort();
    const partidas = [...setPart].sort((a, b) => (a === SIN_CAT ? 1 : b === SIN_CAT ? -1 : a.localeCompare(b)));
    return { obras, partidas, matriz: m };
  }, [pedidos, itemCat]);

  const obrasVis = obras.filter((o) => { const q = buscar.trim().toLowerCase(); return !q || o.toLowerCase().includes(q) || (obraNombre[o] ?? "").toLowerCase().includes(q); });

  return (
    <AppShell role="ingenieria">
      <main className="page page--wide">
        <div className="page__head">
          <div className="page__title">
            <h1 className="ds-heading">Planificación</h1>
            <p className="ds-muted">Se llena sola con las solicitudes de material: filas = obra, columnas = partida (categoría del ítem en Business Central). Cada celda muestra cuántos ítems se pidieron y cuántos faltan por comprar.</p>
          </div>
          <Link href="/ingenieria/nuevo"><Button>+ Nueva solicitud</Button></Link>
        </div>

        <Card className="mt-2">
          <div className="row wrap gap-3" style={{ alignItems: "flex-end" }}>
            <div style={{ flex: "1 1 240px", minWidth: 200 }}>
              <label className="ds-label ds-muted" style={{ display: "block", marginBottom: 4 }}>Buscar obra</label>
              <Input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Código o nombre de obra…" />
            </div>
            <span className="ds-body-sm ds-muted" style={{ alignSelf: "center" }}>{obras.length} obra(s) · {partidas.length} partida(s)</span>
          </div>
        </Card>

        <Card className="mt-4" style={{ padding: 0, overflow: "hidden" }}>
          <div className="ds-table-wrap" style={{ boxShadow: "none", overflowX: "auto" }}>
            <table className="ds-table" style={{ minWidth: 720 }}>
              <thead>
                <tr>
                  <th style={{ minWidth: 200, position: "sticky", left: 0, color: "var(--ds-color-black)", background: "var(--ds-color-white)", zIndex: 2 }}>Obra</th>
                  {partidas.map((c) => <th key={c} style={{ minWidth: 120 }} className="ds-num">{c}</th>)}
                </tr>
              </thead>
              <tbody>
                {obrasVis.length === 0 && (
                  <tr><td colSpan={partidas.length + 1}><div className="empty">{obras.length === 0 ? (cargandoBc ? "Cargando…" : "Todavía no hay solicitudes de material. Cuando se creen, la matriz se llena sola.") : "Ninguna obra coincide con la búsqueda."}</div></td></tr>
                )}
                {obrasVis.map((o) => (
                  <tr key={o}>
                    <td style={{ position: "sticky", left: 0, background: "var(--ds-color-white)", zIndex: 1 }}>
                      <div className="ds-strong ds-body-sm">{o}</div>
                      {obraNombre[o] && <div className="ds-muted ds-body-sm ds-truncate" style={{ maxWidth: 200 }} title={obraNombre[o]}>{obraNombre[o]}</div>}
                    </td>
                    {partidas.map((c) => {
                      const cel = matriz[o]?.[c];
                      if (!cel) return <td key={c} className="ds-num ds-muted">—</td>;
                      const todoComprado = cel.pendientes === 0;
                      return (
                        <td key={c} className="ds-num" title={cel.detalle.join("\n")}>
                          <div className="ds-strong" style={{ color: todoComprado ? "var(--ds-color-green-200)" : undefined }}>{cel.items} ítem(s)</div>
                          {cel.pendientes > 0
                            ? <div className="ds-body-sm ds-pending-text">faltan {cel.pendientes}</div>
                            : <div className="ds-body-sm ds-muted">comprado</div>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {!cargandoBc && obras.length > 0 && partidas.length === 1 && partidas[0] === SIN_CAT && (
          <p className="ds-body-sm ds-muted mt-4">
            Todas las líneas cayeron en “{SIN_CAT}”. Para separar por partida, asigná la <span className="ds-strong">categoría de ítem</span> a los materiales en Business Central.
          </p>
        )}
      </main>
    </AppShell>
  );
}
