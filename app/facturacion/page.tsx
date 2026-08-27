"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, EmptyState, Input, QtyRing, Tile } from "@/components/ui";
import { IconDelivery } from "@/components/icons";
import { useStore } from "@/lib/store";
import { money, formatDate, ordenAvance, ordenEsParcial, ordenRecibidoPct, ordenSubtotal, numeroOrden } from "@/lib/helpers";

// Filtros de la bandeja de bodega. Son los estados que le importan a quien recibe:
// lo que todavía no llegó, lo que llegó a medias (y hay que completar) y lo que ya
// se cerró. "Órdenes en sistema" no está: contaba borradores y órdenes esperando
// aprobación, que Bodega no ve en ninguna pantalla ni puede tocar.
type Filtro = "porRecibir" | "sinRecibir" | "parcial" | "completado";

export default function FacturacionPage() {
  const { ordenes, proveedores } = useStore();
  const router = useRouter();
  const prov = (id: string) => proveedores.find((p) => p.id === id);
  const [filtro, setFiltro] = useState<Filtro>("porRecibir");
  const listaRef = useRef<HTMLDivElement>(null);
  function seleccionar(f: Filtro) {
    setFiltro(f);
    // Con las tarjetas arriba, cambiar de filtro sin mover la vista deja al usuario
    // mirando los paneles sin saber que la lista de abajo cambió.
    setTimeout(() => listaRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }

  // órdenes lanzadas pendientes de recibir (total o parcial)
  const porRecibir = ordenes.filter((o) => o.estado === "lanzado");
  const parciales = porRecibir.filter(ordenEsParcial).length;
  // Todavía no llegó NADA de esta orden: es la cola real de bodega.
  const sinRecibir = porRecibir.filter((o) => ordenRecibidoPct(o) === 0).length;
  const completadas = ordenes.filter((o) => o.estado === "completado");
  const esCompletado = filtro === "completado";

  // Sobre qué universo se busca y se lista, según el panel elegido.
  const base = filtro === "completado" ? completadas
    : filtro === "parcial" ? porRecibir.filter(ordenEsParcial)
    : filtro === "sinRecibir" ? porRecibir.filter((o) => ordenRecibidoPct(o) === 0)
    : porRecibir;
  const etiqueta: Record<Filtro, string> = {
    porRecibir: "Órdenes por recibir",
    sinRecibir: "Sin recibir todavía",
    parcial: "Con recepción parcial",
    completado: "Completadas (ya se recibió todo)",
  };

  // Buscador: con decenas de órdenes abiertas, cuando llega el camión hay que
  // poder llegar a la orden por su N.º o por el proveedor de la factura sin
  // scrollear toda la lista.
  const [q, setQ] = useState("");
  const lista = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return base;
    return base.filter((o) => {
      const provNombre = o.proveedorNombre ?? prov(o.proveedorId)?.nombre ?? "";
      // Se busca por lo que se VE (el N.º de BC, el proveedor y los chips PED-)
      // y también por el CP- interno crudo, que es el que anda en correos y en
      // la bitácora.
      const pedidos = [...new Set(o.lineas.map((l) => l.pedidoNumero).filter(Boolean))].join(" ");
      return [numeroOrden(o), o.numero, o.bcNumber, provNombre, o.proveedorId, pedidos]
        .some((v) => (v ?? "").toLowerCase().includes(t));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ordenes, proveedores, q, filtro]);

  return (
    <>
      <main className="page">
        <div className="page__head">
          <div className="page__title">
            <h1 className="ds-heading">Órdenes por recibir</h1>
            <p className="ds-muted">Registrá la factura cuando el material llega a bodega. Soporta entregas parciales.</p>
          </div>
        </div>

        {/* Los paneles filtran la lista de abajo (mismo gesto que en Órdenes de
            Proveeduría): "¿cuáles vienen a medias?" se contesta tocando el panel. */}
        <div className="tiles mt-2">
          <Tile value={porRecibir.length} label="Órdenes por recibir" accent="var(--ds-color-red-100)"
            onClick={() => seleccionar("porRecibir")} active={filtro === "porRecibir"} />
          <Tile value={sinRecibir} label="Sin recibir todavía" accent="var(--ds-color-gray-300)"
            onClick={() => seleccionar("sinRecibir")} active={filtro === "sinRecibir"} />
          <Tile value={parciales} label="Con recepción parcial" accent="var(--ds-color-yellow)"
            onClick={() => seleccionar("parcial")} active={filtro === "parcial"} />
          <Tile value={completadas.length} label="Completadas" accent="var(--ds-color-green-200)"
            onClick={() => seleccionar("completado")} active={filtro === "completado"} />
        </div>

        {base.length > 0 && (
          <div className="mt-4">
            <Input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar orden"
              placeholder="Buscar por N.º de orden, proveedor o pedido…" />
            {q.trim() !== "" && (
              <p className="ds-body-sm ds-muted" style={{ margin: "6px 0 0" }} role="status">
                {lista.length} de {base.length} orden(es)
              </p>
            )}
          </div>
        )}

        <div ref={listaRef} className="row row--between mt-6" style={{ marginBottom: 12, alignItems: "baseline", scrollMarginTop: 80 }}>
          <span className="ds-label ds-muted">{etiqueta[filtro]}</span>
          {filtro !== "porRecibir" && <button type="button" className="link-btn" onClick={() => setFiltro("porRecibir")}>Ver las que faltan recibir</button>}
        </div>

        <div className="col gap-4">
          {base.length === 0 && <Card><EmptyState icon={<IconDelivery size={24} />}
            title={filtro === "porRecibir" ? "No hay órdenes pendientes de recibir."
              : filtro === "sinRecibir" ? "Todas las órdenes pendientes ya tienen algo recibido."
              : filtro === "parcial" ? "Ninguna orden viene a medias."
              : "Todavía no hay órdenes completadas."}
            hint={filtro === "porRecibir" ? <>Cuando llegue material a bodega vas a verlo acá.</> : <>Tocá otro panel de arriba para ver el resto.</>} /></Card>}
          {base.length > 0 && lista.length === 0 && <Card><EmptyState icon={<IconDelivery size={24} />} title="Ninguna orden coincide con la búsqueda." hint={<>Probá con el N.º de la orden (CP-…), el nombre del proveedor o el N.º de pedido.</>} /></Card>}
          {lista.map((o) => {
            // Mismo cálculo que la lista de órdenes (`ordenSubtotal`): antes esta
            // tarjeta ignoraba el descuento de línea, así que la misma orden se veía
            // con dos montos distintos según la pantalla. Sigue siendo SIN IVA.
            const total = ordenSubtotal(o);
            return (
              <Card key={o.id} interactive onClick={() => router.push(esCompletado ? `/facturacion/ver/${o.id}` : `/facturacion/${o.id}`)}>
                <div className="row row--between wrap gap-4">
                  <div className="row gap-4">
                    <QtyRing {...ordenAvance(o)} />
                    <div className="col" style={{ gap: 4 }}>
                      <div className="row gap-3">
                        <span className="ds-strong">{numeroOrden(o)}</span>
                        {esCompletado ? <Badge tone="green">Completada</Badge>
                          : ordenEsParcial(o) ? <Badge tone="yellow">Parcial · {ordenRecibidoPct(o)}%</Badge>
                          : <Badge tone="green">Lanzado</Badge>}
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
                    {/* Una orden completada ya no se recibe: el botón lleva a verla. */}
                    <Button variant={esCompletado ? "outline" : "green"}>{esCompletado ? "Ver detalle" : "Registrar factura"}</Button>
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
