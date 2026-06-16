"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/shell";
import { Badge, Button, Card, Field, Input, Select, Tile, useToast } from "@/components/ui";
import { useStore } from "@/lib/store";
import { destinoLabel, money, num, pedidoLineaPendiente } from "@/lib/helpers";
import type { OrdenLinea } from "@/lib/types";

interface Row {
  pedidoId: string;
  pedidoNumero: string;
  destino: string;
  tipo: "material" | "repuesto";
  pedidoLineaId: string;
  articuloId: string;
  descripcion: string;
  unidad: string;
  almacen: string;
  pendiente: number;
  // editable
  incluir: boolean;
  cantidad: string;
  precio: string;
  iva: string;
}

export default function ProveeduriaMaterialesPage() {
  const { pedidos, articulos, proveedores, createOrden, setOrdenEstado, ordenes } = useStore();
  const router = useRouter();
  const toast = useToast();

  // Aplana TODAS las líneas pendientes de TODOS los pedidos aprobados
  const baseRows = useMemo<Row[]>(() => {
    const rows: Row[] = [];
    pedidos
      .filter((p) => p.estado === "aprobado")
      .forEach((p) => {
        p.lineas.forEach((l) => {
          const pend = pedidoLineaPendiente(l);
          if (pend <= 0) return;
          const a = articulos.find((x) => x.id === l.articuloId);
          rows.push({
            pedidoId: p.id, pedidoNumero: p.numero, destino: destinoLabel(p), tipo: p.tipoSolicitud,
            pedidoLineaId: l.id, articuloId: l.articuloId, descripcion: l.descripcion,
            unidad: l.unidad, almacen: l.almacen, pendiente: pend,
            incluir: false, cantidad: String(pend), precio: String(a?.precioReferencia ?? 0), iva: "13",
          });
        });
      });
    return rows;
  }, [pedidos, articulos]);

  const [rows, setRows] = useState<Row[]>(baseRows);
  // re-sincroniza si cambian los pedidos base (al crear una orden)
  const baseKey = baseRows.map((r) => r.pedidoLineaId).join(",");
  const [lastKey, setLastKey] = useState(baseKey);
  if (baseKey !== lastKey) { setRows(baseRows); setLastKey(baseKey); }

  const [proveedorId, setProveedorId] = useState("");
  const [currency, setCurrency] = useState("");
  const [flete, setFlete] = useState("");

  const setRow = (id: string, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.pedidoLineaId === id ? { ...r, ...patch } : r)));

  const incluidas = rows.filter((r) => r.incluir && Number(r.cantidad) > 0);
  const subtotal = incluidas.reduce((s, r) => s + Number(r.cantidad) * Number(r.precio), 0);
  const fleteNum = Number(flete) || 0;
  const pedidosDistintos = new Set(incluidas.map((r) => r.pedidoNumero)).size;
  const puedeCrear = !!proveedorId && incluidas.length > 0;

  // al elegir proveedor, heredar moneda
  function elegirProveedor(id: string) {
    setProveedorId(id);
    const p = proveedores.find((x) => x.id === id);
    if (p) setCurrency(p.currencyCode ?? "");
  }

  function crear(lanzar: boolean) {
    if (!puedeCrear) { toast("Seleccioná proveedor y al menos una línea.", "error"); return; }
    const lineas: Omit<OrdenLinea, "id" | "cantidadRecibida" | "cantidadFacturada">[] = incluidas.map((r) => ({
      tipo: "articulo", articuloId: r.articuloId, pedidoLineaId: r.pedidoLineaId, pedidoNumero: r.pedidoNumero,
      descripcion: r.descripcion, cantidad: Number(r.cantidad), unidad: r.unidad, almacen: r.almacen,
      precioUnitario: Number(r.precio), ivaPct: Number(r.iva) || 0,
    }));
    if (fleteNum > 0) {
      lineas.push({
        tipo: "cargo", descripcion: "FLETE / TRANSPORTE", cantidad: 1, unidad: "UND",
        almacen: incluidas[0].almacen, precioUnitario: fleteNum, ivaPct: 13,
      });
    }
    const orden = createOrden({ proveedorId, currencyCode: currency, lineas });
    if (lanzar) setOrdenEstado(orden.id, "lanzado");
    toast(`Orden ${orden.numero} creada con ${incluidas.length} línea(s) de ${pedidosDistintos} pedido(s)`, "success");
    router.push(`/proveeduria/ordenes/${orden.id}`);
  }

  const abiertas = ordenes.filter((o) => o.estado !== "completado").length;

  return (
    <AppShell role="proveeduria">
      <main className="page">
        <div className="page__head">
          <div className="page__title">
            <h1 className="ds-heading">Materiales solicitados</h1>
            <p className="ds-muted">Seleccioná líneas de distintos pedidos y armá una sola orden para el proveedor.</p>
          </div>
        </div>

        <div className="tiles mt-2">
          <Tile value={rows.length} label="Líneas por ordenar" accent="var(--ds-color-yellow)" />
          <Tile value={new Set(rows.map((r) => r.pedidoNumero)).size} label="Pedidos con saldo" />
          <Tile value={incluidas.length} label="Seleccionadas" accent="var(--ds-color-green-100)" />
          <Tile value={abiertas} label="Órdenes abiertas" accent="var(--ds-color-gray-300)" />
        </div>

        <Card className="mt-6" style={{ padding: 0, overflow: "hidden" }}>
          <div className="ds-table-wrap" style={{ boxShadow: "none" }}>
            <table className="ds-table">
              <thead>
                <tr>
                  <th style={{ width: 36 }}></th>
                  <th>Pedido</th><th>Destino</th><th>Artículo</th><th>Almacén</th>
                  <th className="ds-num">Pendiente</th><th className="ds-num">A ordenar</th>
                  <th className="ds-num">Precio</th><th className="ds-num">IVA %</th><th className="ds-num">Importe</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={10}><div className="empty">No hay materiales pendientes de ordenar.</div></td></tr>
                )}
                {rows.map((r) => {
                  const importe = Number(r.cantidad) * Number(r.precio);
                  return (
                    <tr key={r.pedidoLineaId} style={{ background: r.incluir ? "color-mix(in srgb, var(--ds-color-green-100) 10%, #fff)" : undefined }}>
                      <td><input type="checkbox" checked={r.incluir} onChange={(e) => setRow(r.pedidoLineaId, { incluir: e.target.checked })} /></td>
                      <td className="ds-strong">{r.pedidoNumero}</td>
                      <td>
                        <div className="ds-body-sm">{r.destino}</div>
                        {r.tipo === "repuesto" ? <Badge tone="yellow">Repuesto</Badge> : <Badge tone="green">Material</Badge>}
                      </td>
                      <td>{r.descripcion}</td>
                      <td className="ds-muted">{r.almacen}</td>
                      <td className="ds-num">{num.format(r.pendiente)} {r.unidad}</td>
                      <td className="ds-num">
                        <input className="ds-cell-input" type="number" min={0} max={r.pendiente} value={r.cantidad}
                          disabled={!r.incluir} onChange={(e) => setRow(r.pedidoLineaId, { cantidad: e.target.value })} />
                      </td>
                      <td className="ds-num">
                        <input className="ds-cell-input" type="number" min={0} value={r.precio} style={{ width: 100 }}
                          disabled={!r.incluir} onChange={(e) => setRow(r.pedidoLineaId, { precio: e.target.value })} />
                      </td>
                      <td className="ds-num">
                        <input className="ds-cell-input" type="number" min={0} value={r.iva} style={{ width: 60 }}
                          disabled={!r.incluir} onChange={(e) => setRow(r.pedidoLineaId, { iva: e.target.value })} />
                      </td>
                      <td className="ds-num ds-strong">{money(importe || 0, currency)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Panel para armar la orden */}
        <Card className="mt-6">
          <h3 className="ds-subtitle" style={{ marginBottom: 16 }}>Armar orden de compra</h3>
          <div className="grid-3">
            <Field label="Proveedor" help="Hereda términos y moneda">
              <Select value={proveedorId} onChange={(e) => elegirProveedor(e.target.value)}>
                <option value="">Seleccionar proveedor…</option>
                {proveedores.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.nombre}</option>)}
              </Select>
            </Field>
            <Field label="Moneda">
              <Select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                <option value="">CRC (colones)</option>
                <option value="USD">USD (dólares)</option>
              </Select>
            </Field>
            <Field label="Flete / transporte" help="Opcional, se distribuye al facturar">
              <Input type="number" min={0} value={flete} onChange={(e) => setFlete(e.target.value)} placeholder="0" />
            </Field>
          </div>

          <div className="row row--between wrap gap-4 mt-6" style={{ alignItems: "flex-end" }}>
            <div className="totals" style={{ minWidth: 320 }}>
              <div className="totals__row"><span>Líneas seleccionadas</span><span>{incluidas.length} de {pedidosDistintos} pedido(s)</span></div>
              <div className="totals__row"><span>Subtotal</span><span>{money(subtotal, currency)}</span></div>
              <div className="totals__row"><span>Flete</span><span>{money(fleteNum, currency)}</span></div>
              <div className="totals__row totals__row--grand" style={{ gridColumn: "1 / -1" }}>
                <span>Total</span><span>{money(subtotal + fleteNum, currency)}</span>
              </div>
            </div>
            <div className="row gap-3">
              <Button variant="outline" onClick={() => crear(false)} disabled={!puedeCrear}>Guardar como abierta</Button>
              <Button onClick={() => crear(true)} disabled={!puedeCrear}>Crear y lanzar al proveedor</Button>
            </div>
          </div>
        </Card>
      </main>
    </AppShell>
  );
}
