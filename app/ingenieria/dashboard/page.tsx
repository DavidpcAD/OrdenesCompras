"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/shell";
import { Button, Card, Tile } from "@/components/ui";
import { useStore } from "@/lib/store";
import { num } from "@/lib/helpers";

type ItemBc = { code: string; descripcion: string; unidad: string; reorderPoint?: number; safetyStock?: number; reorderQty?: number };
type Existencia = { itemNo: string; cantidad: number };
type InvEstado = "loading" | "ok" | "error";

// Dashboard de Ingeniería (pensado para quien pide material): estado de solicitudes
// y órdenes + FALTANTES contra inventario (materiales bajo su punto de reorden en BC,
// considerando lo que ya está en camino, con sugerencia de cuánto pedir).
export default function DashboardPage() {
  const { pedidos, ordenes } = useStore();

  const k = useMemo(() => {
    let ordCant = 0, recCant = 0;
    for (const o of ordenes) for (const l of o.lineas) {
      if (l.tipo !== "articulo") continue;
      ordCant += l.cantidad; recCant += l.cantidadRecibida ?? 0;
    }
    const pct = ordCant > 0 ? Math.round((recCant / ordCant) * 100) : 0;
    return { solic: pedidos.length, orden: ordenes.length, pct, pend: Math.max(0, ordCant - recCant) };
  }, [pedidos, ordenes]);

  // Lo que ya está pedido y falta recibir, por artículo (para no sugerir pedir de más).
  const enCamino = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of ordenes) for (const l of o.lineas) {
      if (l.tipo === "articulo" && l.articuloId) m.set(l.articuloId, (m.get(l.articuloId) ?? 0) + Math.max(0, l.cantidad - (l.cantidadRecibida ?? 0)));
    }
    return m;
  }, [ordenes]);

  // Catálogo de BC (con punto de reorden) + stock total por artículo (agregado por almacén).
  const [items, setItems] = useState<ItemBc[] | null>(null);
  const [stockByItem, setStockByItem] = useState<Record<string, number>>({});
  const [invEstado, setInvEstado] = useState<InvEstado>("loading");

  useEffect(() => {
    fetch("/api/bc/items")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => { if (Array.isArray(d.items)) setItems(d.items.map((i: any) => ({ code: i.code, descripcion: i.descripcion, unidad: i.unidad || "UND", reorderPoint: i.reorderPoint, safetyStock: i.safetyStock, reorderQty: i.reorderQty }))); else setItems([]); })
      .catch(() => setItems([]));
  }, []);

  useEffect(() => {
    let vivo = true;
    (async () => {
      setInvEstado("loading");
      let locs: string[] = [];
      try {
        const r = await fetch("/api/bc/almacenes");
        const d = await r.json().catch(() => ({}));
        locs = Array.isArray(d.almacenes) ? d.almacenes.map((a: any) => a.codigo).filter(Boolean) : [];
      } catch { /* sin BC */ }
      if (!vivo) return;
      if (!locs.length) { setInvEstado("error"); return; }
      const map: Record<string, number> = {};
      let i = 0, okAlguno = false;
      const worker = async () => {
        while (vivo && i < locs.length) {
          const loc = locs[i++];
          try {
            const r = await fetch(`/api/bc/existencias?locationCode=${encodeURIComponent(loc)}`);
            const d = await r.json().catch(() => ({}));
            if (!r.ok) continue;
            okAlguno = true;
            for (const e of (d.existencias ?? []) as Existencia[]) {
              if (!e.itemNo) continue;
              map[e.itemNo] = (map[e.itemNo] ?? 0) + (Number(e.cantidad) || 0);
            }
          } catch { /* salta */ }
        }
      };
      await Promise.all(Array.from({ length: Math.min(6, locs.length) }, worker));
      if (!vivo) return;
      setStockByItem(map);
      setInvEstado(okAlguno ? "ok" : "error");
    })();
    return () => { vivo = false; };
  }, []);

  const hayReorden = useMemo(() => !!items && items.some((it) => (it.reorderPoint ?? 0) > 0), [items]);
  const faltantes = useMemo(() => {
    if (!items) return [];
    return items
      .filter((it) => (it.reorderPoint ?? 0) > 0)
      .map((it) => {
        const stock = stockByItem[it.code] ?? 0;
        const camino = enCamino.get(it.code) ?? 0;
        const proyectado = stock + camino;
        const reorden = it.reorderPoint ?? 0;
        const falta = reorden - proyectado;
        const sugerido = (it.reorderQty ?? 0) > 0 ? Math.max(it.reorderQty!, Math.ceil(falta)) : Math.ceil(falta);
        return { ...it, stock, camino, proyectado, reorden, falta, sugerido };
      })
      .filter((x) => x.falta > 0)
      .sort((a, b) => a.proyectado / a.reorden - b.proyectado / b.reorden); // más críticos primero
  }, [items, stockByItem, enCamino]);

  return (
    <AppShell role="ingenieria">
      <main className="page page--wide">
        <div className="page__head">
          <div className="page__title">
            <h1 className="ds-heading">Dashboard</h1>
            <p className="ds-muted">Resumen de solicitudes, órdenes y recepción, y los materiales que conviene pedir según el inventario de Business Central.</p>
          </div>
        </div>

        <div className="tiles mt-2">
          <Tile value={k.solic} label="Solicitudes" />
          <Tile value={k.orden} label="Órdenes de compra" accent="var(--ds-color-yellow)" />
          <Tile value={`${k.pct}%`} label="Recibido (global)" accent="var(--ds-color-green-200)" />
          <Tile value={k.pend} label="Pendiente por recibir" accent="var(--ds-color-red-100)" />
        </div>

        <div className="row row--between wrap gap-3" style={{ alignItems: "baseline", marginTop: 28 }}>
          <h2 className="ds-subtitle">Faltantes y sugerencia de reorden</h2>
          {invEstado === "ok" && hayReorden && <span className="ds-muted ds-body-sm">Contra el stock real de BC + lo que ya está en camino.</span>}
        </div>

        {invEstado === "loading" && (
          <Card className="mt-2"><span className="ds-muted">Calculando faltantes contra el stock de Business Central…</span></Card>
        )}
        {invEstado === "error" && (
          <Card className="mt-2" style={{ borderLeft: "4px solid var(--ds-color-red-100)" }}>
            <div className="ds-strong">No se pudo consultar el stock de BC</div>
            <div className="ds-muted ds-body-sm" style={{ marginTop: 4 }}>Business Central no respondió o <code>inventoryByLocation</code> no está disponible en este entorno.</div>
          </Card>
        )}
        {invEstado === "ok" && !hayReorden && (
          <Card className="mt-2" style={{ borderLeft: "4px solid var(--ds-color-yellow)" }}>
            <div className="ds-strong">Ningún artículo tiene punto de reorden configurado en BC</div>
            <div className="ds-muted ds-body-sm" style={{ marginTop: 4 }}>Configurá el <strong>Punto de reorden</strong> (y opcionalmente la cantidad de reorden) en la ficha de cada ítem en Business Central para ver acá los materiales por reponer.</div>
          </Card>
        )}
        {invEstado === "ok" && hayReorden && faltantes.length === 0 && (
          <Card className="mt-2" style={{ borderLeft: "4px solid var(--ds-color-green-200)" }}>
            <div className="ds-strong">Todo cubierto ✅</div>
            <div className="ds-muted ds-body-sm" style={{ marginTop: 4 }}>Ningún material está por debajo de su punto de reorden (contando lo que ya está en camino).</div>
          </Card>
        )}
        {invEstado === "ok" && faltantes.length > 0 && (
          <Card className="mt-2" style={{ padding: 0, overflow: "hidden" }}>
            <div className="ds-body-sm" style={{ padding: "12px 16px", borderBottom: "1.5px solid var(--ds-color-gray-100)", background: "color-mix(in srgb, var(--ds-color-red-100) 6%, #fff)" }}>
              <span className="ds-strong">{faltantes.length}</span> material(es) por debajo de su punto de reorden.
            </div>
            <div className="ds-table-wrap" style={{ boxShadow: "none" }}>
              <table className="ds-table">
                <thead>
                  <tr>
                    <th>Material</th>
                    <th className="ds-num">Stock</th>
                    <th className="ds-num">En camino</th>
                    <th className="ds-num">Reorden</th>
                    <th className="ds-num">Falta</th>
                    <th className="ds-num">Sugerido pedir</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {faltantes.map((x) => (
                    <tr key={x.code}>
                      <td><span className="ds-strong">{x.code}</span> <span className="ds-muted">{x.descripcion}</span></td>
                      <td className="ds-num" style={{ color: x.stock <= 0 ? "var(--ds-color-red-200)" : undefined }}>{num.format(x.stock)}</td>
                      <td className="ds-num ds-muted">{x.camino > 0 ? num.format(x.camino) : "—"}</td>
                      <td className="ds-num">{num.format(x.reorden)}</td>
                      <td className="ds-num ds-strong" style={{ color: "var(--ds-color-red-200)" }}>{num.format(x.falta)}</td>
                      <td className="ds-num ds-strong">{num.format(x.sugerido)} {x.unidad}</td>
                      <td className="ds-num"><Link href="/ingenieria/nuevo"><Button variant="outline" size="sm">Pedir</Button></Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </main>
    </AppShell>
  );
}
