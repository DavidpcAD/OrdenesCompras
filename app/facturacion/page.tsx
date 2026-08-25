"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, EmptyState, Input, QtyRing, Tile } from "@/components/ui";
import { IconDelivery } from "@/components/icons";
import { useStore } from "@/lib/store";
import { money, formatDate, ordenAvance, ordenEsParcial, ordenRecibidoPct, ordenSubtotal, numeroOrden } from "@/lib/helpers";

export default function FacturacionPage() {
  const { ordenes, proveedores } = useStore();
  const router = useRouter();
  const prov = (id: string) => proveedores.find((p) => p.id === id);

  // órdenes lanzadas pendientes de recibir (total o parcial)
  const porRecibir = ordenes.filter((o) => o.estado === "lanzado");
  const parciales = porRecibir.filter(ordenEsParcial).length;

  // Buscador: con decenas de órdenes abiertas, cuando llega el camión hay que
  // poder llegar a la orden por su N.º o por el proveedor de la factura sin
  // scrollear toda la lista.
  const [q, setQ] = useState("");
  const lista = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return porRecibir;
    return porRecibir.filter((o) => {
      const provNombre = o.proveedorNombre ?? prov(o.proveedorId)?.nombre ?? "";
      // Se busca por lo que se VE (el N.º de BC, el proveedor y los chips PED-)
      // y también por el CP- interno crudo, que es el que anda en correos y en
      // la bitácora.
      const pedidos = [...new Set(o.lineas.map((l) => l.pedidoNumero).filter(Boolean))].join(" ");
      return [numeroOrden(o), o.numero, o.bcNumber, provNombre, o.proveedorId, pedidos]
        .some((v) => (v ?? "").toLowerCase().includes(t));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ordenes, proveedores, q]);

  return (
    <>
      <main className="page">
        <div className="page__head">
          <div className="page__title">
            <h1 className="ds-heading">Órdenes por recibir</h1>
            <p className="ds-muted">Registrá la factura cuando el material llega a bodega. Soporta entregas parciales.</p>
          </div>
        </div>

        <div className="tiles mt-2">
          <Tile value={porRecibir.length} label="Órdenes por recibir" accent="var(--ds-color-red-100)" />
          <Tile value={parciales} label="Con recepción parcial" accent="var(--ds-color-yellow)" />
          <Tile value={ordenes.filter((o) => o.estado === "completado").length} label="Completadas" accent="var(--ds-color-green-200)" />
          <Tile value={ordenes.length} label="Órdenes en sistema" accent="var(--ds-color-gray-300)" />
        </div>

        {porRecibir.length > 0 && (
          <div className="mt-4">
            <Input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar orden por recibir"
              placeholder="Buscar por N.º de orden, proveedor o pedido…" />
            {q.trim() !== "" && (
              <p className="ds-body-sm ds-muted" style={{ margin: "6px 0 0" }} role="status">
                {lista.length} de {porRecibir.length} orden(es)
              </p>
            )}
          </div>
        )}

        <div className="col gap-4 mt-6">
          {porRecibir.length === 0 && <Card><EmptyState icon={<IconDelivery size={24} />} title="No hay órdenes pendientes de recibir." hint={<>Cuando llegue material a bodega vas a verlo acá. Para el histórico completo, abrí <strong>“Todas las órdenes”</strong>.</>} /></Card>}
          {porRecibir.length > 0 && lista.length === 0 && <Card><EmptyState icon={<IconDelivery size={24} />} title="Ninguna orden coincide con la búsqueda." hint={<>Probá con el N.º de la orden (CP-…), el nombre del proveedor o el N.º de pedido.</>} /></Card>}
          {lista.map((o) => {
            // Mismo cálculo que la lista de órdenes (`ordenSubtotal`): antes esta
            // tarjeta ignoraba el descuento de línea, así que la misma orden se veía
            // con dos montos distintos según la pantalla. Sigue siendo SIN IVA.
            const total = ordenSubtotal(o);
            return (
              <Card key={o.id} interactive onClick={() => router.push(`/facturacion/${o.id}`)}>
                <div className="row row--between wrap gap-4">
                  <div className="row gap-4">
                    <QtyRing {...ordenAvance(o)} />
                    <div className="col" style={{ gap: 4 }}>
                      <div className="row gap-3">
                        <span className="ds-strong">{numeroOrden(o)}</span>
                        {ordenEsParcial(o) ? <Badge tone="yellow">Parcial · {ordenRecibidoPct(o)}%</Badge> : <Badge tone="green">Lanzado</Badge>}
                      </div>
                      <span className="ds-muted ds-label">{o.proveedorNombre ?? prov(o.proveedorId)?.nombre} · emitida {formatDate(o.fecha)}</span>
                      <div className="row gap-2 wrap">
                        {[...new Set(o.lineas.filter((l) => l.pedidoNumero).map((l) => l.pedidoNumero!))].slice(0, 3).map((n) => <Badge key={n} tone="gray">{n}</Badge>)}
                      </div>
                    </div>
                  </div>
                  <div className="row gap-6">
                    <div className="col" style={{ alignItems: "flex-end" }}>
                      <span className="ds-strong">{money(total, o.currencyCode)}</span>
                      <span className="ds-muted ds-body-sm">total sin IVA</span>
                    </div>
                    <Button variant="green">Registrar factura</Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      </main>
    </>
  );
}
