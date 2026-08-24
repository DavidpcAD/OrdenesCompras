"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge, ProgressBar, EmptyState } from "@/components/ui";
import { DataTable } from "@/components/data-table";
import { IconChevronDown } from "@/components/icons";
import { useStore } from "@/lib/store";
import { money, formatDate, ordenAvance, ordenBadge, ordenRecibidoPct, ordenSubtotal, ordenPedidos, ordenEsDirecta, ordenLineaImporte, proveedorLabel, num, numeroOrden } from "@/lib/helpers";
import type { Orden } from "@/lib/types";

// N.º de solicitud de origen. Con link es un botón que abre esa solicitud (y no
// dispara el clic de la fila, que va a la orden); sin link, la etiqueta de siempre.
export function ChipPedido({ numero, href }: { numero: string; href: string | null }) {
  const router = useRouter();
  if (!href) return <Badge tone="gray">{numero}</Badge>;
  return (
    <button type="button" className="chip-link" title={`Abrir la solicitud ${numero}`}
      onClick={(e) => { e.stopPropagation(); router.push(href); }}>
      {numero}<span className="chip-link__ir" aria-hidden>↗</span>
    </button>
  );
}

// Lista de órdenes reutilizable (Proveeduría / Aprobación / Bodega), sobre DataTable
// (ordenar, filtrar, columnas, vistas). Toggle "Por proveedor" agrupa las órdenes
// del mismo proveedor en secciones colapsables con su total por moneda.
export function OrdenesLista({
  ordenes,
  hrefDetalle,
  pedidoHref,
  vacio = "No hay órdenes.",
}: {
  ordenes: Orden[];
  hrefDetalle: (id: string) => string;
  // Link a la solicitud de origen. Lo arma la PÁGINA porque la ruta depende del rol
  // (Proveeduría entra a /proveeduria/solicitudes/…; Bodega no tiene esa pantalla).
  // Sin esta prop los N.º de solicitud se muestran como hasta ahora, sin link.
  pedidoHref?: (numeroPedido: string) => string | null;
  vacio?: string;
}) {
  const { proveedores } = useStore();
  const router = useRouter();
  const prov = (id: string) => proveedores.find((p) => p.id === id);
  const nombreProv = (o: Orden) => proveedorLabel(o, proveedores);

  const [agrupar, setAgrupar] = useState(false);
  // Proveedores colapsados por defecto: se abre uno para ver sus OC.
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());
  const toggleGrupo = (k: string) => setAbiertos((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });

  const columns = useMemo<ColumnDef<Orden, any>[]>(() => [
    {
      // El N.º que se maneja es el de BC. El interno CRUDO (CP-000037) viaja igual en
      // el accessor para poder buscar por los dos: ya no se muestra en ningún lado,
      // pero está en los correos y en la bitácora, y soporte lo tiene a mano.
      id: "num", header: "N.º", accessorFn: (o) => `${numeroOrden(o)} ${o.numero}`,
      meta: { label: "N.º" }, cell: (c) => <span className="ds-strong">{numeroOrden(c.row.original)}</span>,
    },
    { id: "prov", header: "Proveedor", accessorFn: (o) => proveedorLabel(o, proveedores), meta: { label: "Proveedor" }, cell: (c) => c.getValue() },
    {
      id: "solic", header: "Solicitudes", accessorFn: (o) => (ordenEsDirecta(o) ? "Directa" : ordenPedidos(o).join(" ")), meta: { label: "Solicitudes" },
      cell: (c) => {
        const o = c.row.original; const peds = ordenPedidos(o); const dir = ordenEsDirecta(o);
        return <div className="row gap-2 wrap">{dir && <Badge tone="yellow">Directa</Badge>}{peds.slice(0, 2).map((n) => <ChipPedido key={n} numero={n} href={pedidoHref?.(n) ?? null} />)}{peds.length > 2 && <span className="ds-muted ds-body-sm">+{peds.length - 2}</span>}</div>;
      },
    },
    { id: "fecha", header: "Fecha", accessorFn: (o) => o.fecha, meta: { label: "Fecha", date: true }, cell: (c) => formatDate(c.getValue()) },
    // "Total" a secas se confundía con el "Total orden" del detalle, que SÍ lleva
    // IVA. Acá es la suma de líneas (artículos + cargos) con descuento y sin IVA.
    { id: "total", header: "Total sin IVA", accessorFn: (o) => ordenSubtotal(o), meta: { label: "Total sin IVA", num: true }, cell: (c) => money(c.getValue(), c.row.original.currencyCode) },
    {
      id: "recibido", header: "Recibido", accessorFn: (o) => ordenRecibidoPct(o), meta: { label: "Recibido" }, enableColumnFilter: false,
      cell: (c) => {
        const o = c.row.original;
        return <ProgressBar compact value={ordenAvance(o).recibida} total={ordenAvance(o).total} />;
      },
    },
    { id: "estado", header: "Estado", accessorFn: (o) => ordenBadge(o.estado).label, meta: { label: "Estado" }, cell: (c) => { const b = ordenBadge(c.row.original.estado); return <Badge tone={b.tone}>{b.label}</Badge>; } },
  ], [proveedores, pedidoHref]); // eslint-disable-line react-hooks/exhaustive-deps

  const renderLineas = (o: Orden) => (
    <table className="ds-table" style={{ boxShadow: "none", background: "transparent" }}>
      <thead>
        <tr><th>Descripción</th><th className="ds-num">Cantidad</th><th className="ds-num">Precio</th><th className="ds-num">Importe</th></tr>
      </thead>
      <tbody>
        {o.lineas.map((l) => (
          <tr key={l.id}>
            <td>{l.descripcion}{l.pedidoNumero && <div className="ds-body-sm ds-muted">{l.pedidoNumero}</div>}</td>
            <td className="ds-num">{num.format(l.cantidad)} {l.unidad}</td>
            <td className="ds-num">{money(l.precioUnitario, o.currencyCode)}</td>
            <td className="ds-num ds-strong">{money(ordenLineaImporte(l), o.currencyCode)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  // Agrupación por proveedor (nombre), con total por moneda y % recibido.
  const grupos = useMemo(() => {
    const map = new Map<string, Orden[]>();
    for (const o of ordenes) {
      const k = nombreProv(o);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(o);
    }
    return [...map.entries()]
      .map(([nombre, ords]) => {
        const totales = new Map<string, number>();
        let rec = 0, tot = 0, completas = 0;
        for (const o of ords) {
          const cur = o.currencyCode || "CRC";
          totales.set(cur, (totales.get(cur) ?? 0) + ordenSubtotal(o));
          rec += o.lineas.reduce((a, l) => a + l.cantidadRecibida, 0);
          tot += o.lineas.reduce((a, l) => a + l.cantidad, 0);
          if (ordenRecibidoPct(o) >= 100) completas += 1;
        }
        const ordsSort = [...ords].sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));
        return { nombre, ords: ordsSort, totales: [...totales.entries()], rec, tot, completas };
      })
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [ordenes, proveedores]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <div className="segmented" role="tablist" aria-label="Ver órdenes" style={{ marginBottom: 12 }}>
        <button type="button" role="tab" aria-selected={!agrupar} className={`segmented__btn ${!agrupar ? "is-active" : ""}`} onClick={() => setAgrupar(false)}>Lista</button>
        <button type="button" role="tab" aria-selected={agrupar} className={`segmented__btn ${agrupar ? "is-active" : ""}`} onClick={() => setAgrupar(true)}>Por proveedor</button>
      </div>

      {!agrupar ? (
        <DataTable
          data={ordenes}
          columns={columns}
          tablaKey="ordenes"
          buscarPlaceholder="Buscar por N.º de orden o proveedor…"
          getRowId={(o) => o.id}
          onRowClick={(o) => router.push(hrefDetalle(o.id))}
          vacio={vacio}
          renderExpanded={renderLineas}
        />
      ) : grupos.length === 0 ? (
        <EmptyState title={vacio} />
      ) : (
        <div className="col gap-3">
          {grupos.map((g) => {
            const abierto = abiertos.has(g.nombre);
            return (
              <div key={g.nombre} className="ord-grp">
                <button type="button" className={`ord-grp-head${abierto ? "" : " is-collapsed"}`} onClick={() => toggleGrupo(g.nombre)}>
                  <IconChevronDown size={18} className="ord-grp-head__chev" />
                  <span className="ord-grp-head__main">
                    <span className="ds-strong">{g.nombre}</span>
                    <span className="ord-grp-head__meta ds-body-sm ds-muted">{g.ords.length} OC{g.ords.length === 1 ? "" : "s"} · {g.completas} completada{g.completas === 1 ? "" : "s"}</span>
                  </span>
                  <span className="ord-grp-head__prog"><ProgressBar compact value={g.rec} total={g.tot} /></span>
                  <span className="ord-grp-head__total ds-strong">
                    {g.totales.map(([cur, sum], i) => <span key={cur}>{i > 0 ? " · " : ""}{money(sum, cur)}</span>)}
                  </span>
                </button>
                {abierto && (
                  <div className="ds-table-wrap" style={{ boxShadow: "none", borderRadius: 0 }}>
                    <table className="ds-table">
                      <thead>
                        <tr><th>N.º</th><th>Solicitudes</th><th>Fecha</th><th className="ds-num">Total sin IVA</th><th>Recibido</th><th>Estado</th></tr>
                      </thead>
                      <tbody>
                        {g.ords.map((o) => {
                          const peds = ordenPedidos(o); const dir = ordenEsDirecta(o); const b = ordenBadge(o.estado);
                          return (
                            <tr key={o.id} className="is-clickable" onClick={() => router.push(hrefDetalle(o.id))} style={{ cursor: "pointer" }}
                              tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); router.push(hrefDetalle(o.id)); } }}>
                              <td className="ds-strong">{numeroOrden(o)}</td>
                              <td><div className="row gap-2 wrap">{dir && <Badge tone="yellow">Directa</Badge>}{peds.slice(0, 2).map((n) => <ChipPedido key={n} numero={n} href={pedidoHref?.(n) ?? null} />)}{peds.length > 2 && <span className="ds-muted ds-body-sm">+{peds.length - 2}</span>}</div></td>
                              <td className="ds-body-sm">{formatDate(o.fecha)}</td>
                              <td className="ds-num ds-strong">{money(ordenSubtotal(o), o.currencyCode)}</td>
                              <td><ProgressBar compact value={ordenAvance(o).recibida} total={ordenAvance(o).total} /></td>
                              <td><Badge tone={b.tone}>{b.label}</Badge></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
