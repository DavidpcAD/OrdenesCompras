"use client";

import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/shell";
import { Button, Card, Field, Input, Select, useToast } from "@/components/ui";
import { useStore } from "@/lib/store";
import { CRC, num, pedidoLineaPendiente } from "@/lib/helpers";
import type { OrdenLinea } from "@/lib/types";

interface Row {
  pedidoLineaId: string;
  articuloId: string;
  descripcion: string;
  unidad: string;
  almacen: string;
  pendiente: number;
  incluir: boolean;
  cantidad: string;
  precio: string;
}

export default function CrearOrdenPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const { pedidos, proveedores, articulos, createOrden, setOrdenEstado } = useStore();

  const pedido = pedidos.find((p) => p.id === id);

  const [proveedorId, setProveedorId] = useState("");
  const [flete, setFlete] = useState("");
  const [rows, setRows] = useState<Row[]>(() =>
    (pedido?.lineas ?? [])
      .filter((l) => pedidoLineaPendiente(l) > 0)
      .map((l) => {
        const a = articulos.find((x) => x.id === l.articuloId);
        const pend = pedidoLineaPendiente(l);
        return {
          pedidoLineaId: l.id, articuloId: l.articuloId, descripcion: l.descripcion,
          unidad: l.unidad, almacen: l.almacen, pendiente: pend,
          incluir: true, cantidad: String(pend), precio: String(a?.precioReferencia ?? 0),
        };
      })
  );

  const setRow = (pid: string, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.pedidoLineaId === pid ? { ...r, ...patch } : r)));

  const incluidas = rows.filter((r) => r.incluir && Number(r.cantidad) > 0);
  const subtotal = useMemo(
    () => incluidas.reduce((s, r) => s + Number(r.cantidad) * Number(r.precio), 0),
    [incluidas]
  );
  const fleteNum = Number(flete) || 0;
  const total = subtotal + fleteNum;
  const puedeCrear = !!proveedorId && incluidas.length > 0;

  if (!pedido) {
    return <AppShell role="proveeduria"><main className="page"><div className="empty">Pedido no encontrado.</div></main></AppShell>;
  }

  function crear(lanzar: boolean) {
    if (!puedeCrear) { toast("Seleccioná proveedor y al menos una línea.", "error"); return; }
    const lineas: Omit<OrdenLinea, "id" | "cantidadRecibida" | "cantidadFacturada">[] = incluidas.map((r) => ({
      tipo: "articulo", articuloId: r.articuloId, pedidoLineaId: r.pedidoLineaId, pedidoNumero: pedido!.numero,
      descripcion: r.descripcion, cantidad: Number(r.cantidad), unidad: r.unidad, almacen: r.almacen,
      precioUnitario: Number(r.precio),
    }));
    if (fleteNum > 0) {
      lineas.push({
        tipo: "cargo", descripcion: "FLETE / TRANSPORTE", cantidad: 1, unidad: "UND",
        almacen: incluidas[0].almacen, precioUnitario: fleteNum,
      });
    }
    const orden = createOrden({ proveedorId, lineas });
    if (lanzar) setOrdenEstado(orden.id, "lanzado");
    toast(`Orden ${orden.numero} ${lanzar ? "creada y lanzada" : "creada"}`, "success");
    router.push(`/proveeduria/ordenes/${orden.id}`);
  }

  return (
    <AppShell role="proveeduria">
      <main className="page">
        <div className="back-link" onClick={() => router.push("/proveeduria")}>‹ Volver a pedidos por ordenar</div>
        <div className="page__head">
          <div className="page__title">
            <h1 className="ds-heading">Generar orden de compra</h1>
            <p className="ds-muted">Desde {pedido.numero} · {pedido.proyecto}</p>
          </div>
        </div>

        <Card>
          <div className="grid-2">
            <Field label="Proveedor" help="A quién se le envía la orden de compra">
              <Select value={proveedorId} onChange={(e) => setProveedorId(e.target.value)}>
                <option value="">Seleccionar proveedor…</option>
                {proveedores.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.nombre}</option>)}
              </Select>
            </Field>
            <Field label="Flete / transporte (CRC)" help="Se distribuye proporcionalmente entre las líneas al facturar">
              <Input type="number" min={0} value={flete} onChange={(e) => setFlete(e.target.value)} placeholder="0" />
            </Field>
          </div>
        </Card>

        <Card className="mt-4" style={{ padding: 0, overflow: "hidden" }}>
          <div className="ds-table-wrap" style={{ boxShadow: "none" }}>
            <table className="ds-table">
              <thead>
                <tr>
                  <th style={{ width: 36 }}></th>
                  <th>Artículo</th><th>Almacén</th>
                  <th className="ds-num">Pendiente</th><th className="ds-num">Cantidad a ordenar</th>
                  <th className="ds-num">Precio unit.</th><th className="ds-num">Importe</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const importe = Number(r.cantidad) * Number(r.precio);
                  return (
                    <tr key={r.pedidoLineaId} style={{ opacity: r.incluir ? 1 : 0.45 }}>
                      <td>
                        <input type="checkbox" checked={r.incluir} onChange={(e) => setRow(r.pedidoLineaId, { incluir: e.target.checked })} />
                      </td>
                      <td>{r.descripcion}</td>
                      <td className="ds-muted">{r.almacen}</td>
                      <td className="ds-num">{num.format(r.pendiente)} {r.unidad}</td>
                      <td className="ds-num">
                        <input className="ds-cell-input" type="number" min={0} max={r.pendiente} value={r.cantidad}
                          disabled={!r.incluir} onChange={(e) => setRow(r.pedidoLineaId, { cantidad: e.target.value })} />
                      </td>
                      <td className="ds-num">
                        <input className="ds-cell-input" type="number" min={0} value={r.precio}
                          disabled={!r.incluir} onChange={(e) => setRow(r.pedidoLineaId, { precio: e.target.value })} />
                      </td>
                      <td className="ds-num ds-strong">{CRC.format(importe || 0)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="row row--between wrap gap-4 mt-6" style={{ alignItems: "flex-end" }}>
          <div className="totals" style={{ minWidth: 320 }}>
            <div className="totals__row"><span>Subtotal</span><span>{CRC.format(subtotal)}</span></div>
            <div className="totals__row"><span>Flete</span><span>{CRC.format(fleteNum)}</span></div>
            <div className="totals__row totals__row--grand" style={{ gridColumn: "1 / -1" }}><span>Total</span><span>{CRC.format(total)}</span></div>
          </div>
          <div className="row gap-3">
            <Button variant="outline" onClick={() => crear(false)} disabled={!puedeCrear}>Guardar como abierta</Button>
            <Button onClick={() => crear(true)} disabled={!puedeCrear}>Crear y lanzar al proveedor</Button>
          </div>
        </div>
      </main>
    </AppShell>
  );
}
