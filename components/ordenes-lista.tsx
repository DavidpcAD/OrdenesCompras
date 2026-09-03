"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge, Checkbox, ProgressBar, EmptyState } from "@/components/ui";
import { DataTable } from "@/components/data-table";
import { IconChevronDown } from "@/components/icons";
import { useStore } from "@/lib/store";
import { useSoloMias } from "@/lib/use-solo-mias";
import { money, formatDate, ordenAlmacenes, ordenAvance, ordenBadge, ordenBadgeDe, ordenObras, ordenRecibidoPct, ordenSubtotal, ordenPedidos, ordenEsDirecta, ordenLineaImporte, proveedorLabel, num, numeroOrden, tieneBc, ordenEsperaCorreccion } from "@/lib/helpers";
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

// A dónde va la compra: almacén/centro de costo de las líneas y, si va a una obra
// (consumo directo), la obra. Casi siempre hay uno solo; con varios se muestra el
// primero y "+N" para no romper la fila.
function CeldaDestino({ orden }: { orden: Orden }) {
  const alms = ordenAlmacenes(orden);
  const obras = ordenObras(orden);
  if (!alms.length && !obras.length) return <span className="ds-muted">—</span>;
  return (
    <div className="col" style={{ gap: 1 }}>
      <span title={alms.join(" · ")}>{alms[0] ?? "—"}{alms.length > 1 ? ` +${alms.length - 1}` : ""}</span>
      {obras.length > 0 && (
        <span className="ds-body-sm ds-muted" title={`Se carga como consumo de ${obras.join(" · ")}`}>
          Obra {obras[0]}{obras.length > 1 ? ` +${obras.length - 1}` : ""}
        </span>
      )}
    </div>
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
  filtroMias = false,
}: {
  ordenes: Orden[];
  hrefDetalle: (id: string) => string;
  // Link a la solicitud de origen. Lo arma la PÁGINA porque la ruta depende del rol
  // (Proveeduría entra a /proveeduria/solicitudes/…; Bodega no tiene esa pantalla).
  // Sin esta prop los N.º de solicitud se muestran como hasta ahora, sin link.
  pedidoHref?: (numeroPedido: string) => string | null;
  vacio?: string;
  // Muestra el atajo "Solo mis órdenes" (compara creadoPor con la sesión). Solo
  // tiene sentido donde quien mira también crea órdenes (Proveeduría).
  filtroMias?: boolean;
}) {
  const { proveedores, usuario } = useStore();
  const router = useRouter();
  const prov = (id: string) => proveedores.find((p) => p.id === id);
  const nombreProv = (o: Orden) => proveedorLabel(o, proveedores);

  const [agrupar, setAgrupar] = useState(false);
  // "Solo mis órdenes" se recuerda por sesión (la página remonta la lista al cambiar
  // de panel KPI con key={filtro}, y sin esto el check se perdía en cada clic).
  const [soloMias, elegirMias] = useSoloMias();
  // creadoPor guarda el nombre según la cookie firmada, el mismo que `usuario` en el
  // store — por eso la comparación es directa. Órdenes viejas sin creadoPor quedan fuera.
  const lista = useMemo(
    () => (filtroMias && soloMias && usuario ? ordenes.filter((o) => o.creadoPor === usuario) : ordenes),
    [ordenes, filtroMias, soloMias, usuario],
  );
  // Proveedores colapsados por defecto: se abre uno para ver sus OC.
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());
  const toggleGrupo = (k: string) => setAbiertos((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });

  const columns = useMemo<ColumnDef<Orden, any>[]>(() => [
    {
      // El N.º que se maneja es el de BC. El interno CRUDO (CP-000037) viaja igual en
      // el accessor para poder buscar por los dos: ya no se muestra en ningún lado,
      // pero está en los correos y en la bitácora, y soporte lo tiene a mano.
      id: "num", header: "N.º", accessorFn: (o) => `${numeroOrden(o)} ${o.numero}`,
      meta: { label: "N.º" },
      // En la celda, la orden que todavía no está en BC dice "En armado" y no un
      // número: la columna ya se llama N.º, así que la frase larga sobra. El
      // interno va en el title, para soporte.
      cell: (c) => { const o = c.row.original; return tieneBc(o)
        ? <span className="ds-strong">{o.bcNumber}</span>
        : <span className="ds-muted" title={`N.º interno de la app: ${o.numero}`}>En armado</span>; },
    },
    { id: "prov", header: "Proveedor", accessorFn: (o) => proveedorLabel(o, proveedores), meta: { label: "Proveedor" }, cell: (c) => c.getValue() },
    {
      id: "solic", header: "Solicitudes", accessorFn: (o) => (ordenEsDirecta(o) ? "Directa" : ordenPedidos(o).join(" ")), meta: { label: "Solicitudes" },
      cell: (c) => {
        // Sin líneas y con N.º de BC, la orden no es "Directa": está esperando el
        // material que volvió al ingeniero (ver `ordenEsperaCorreccion`).
        const o = c.row.original; const peds = ordenPedidos(o); const espera = ordenEsperaCorreccion(o); const dir = ordenEsDirecta(o) && !espera;
        return <div className="row gap-2 wrap">{espera && <Badge tone="yellow">Esperando corrección</Badge>}{dir && <Badge tone="yellow">Directa</Badge>}{peds.slice(0, 2).map((n) => <ChipPedido key={n} numero={n} href={pedidoHref?.(n) ?? null} />)}{peds.length > 2 && <span className="ds-muted ds-body-sm">+{peds.length - 2}</span>}</div>;
      },
    },
    // A dónde entra el material (locationCode) + la obra si es consumo de obra.
    // Se busca y se filtra por los dos códigos.
    {
      id: "almacen", header: "Almacén", meta: { label: "Almacén" },
      accessorFn: (o) => [...ordenAlmacenes(o), ...ordenObras(o)].join(" "),
      cell: (c) => <CeldaDestino orden={c.row.original} />,
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
    { id: "estado", header: "Estado", accessorFn: (o) => ordenBadgeDe(o).label, meta: { label: "Estado" }, cell: (c) => { const b = ordenBadgeDe(c.row.original); return <Badge tone={b.tone}>{b.label}</Badge>; } },
    // Quién generó la OC (creadoPor). Además de leerse, da el filtro por persona del
    // encabezado: cada quien puede quedarse con las suyas o ver las de un compañero.
    { id: "creadaPor", header: "Creada por", accessorFn: (o) => o.creadoPor ?? "", meta: { label: "Creada por" }, cell: (c) => c.getValue() || <span className="ds-muted">—</span> },
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
    for (const o of lista) {
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
  }, [lista, proveedores]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <div className="row row--between wrap gap-3" style={{ marginBottom: 12, alignItems: "center" }}>
        <div className="segmented" role="tablist" aria-label="Ver órdenes">
          <button type="button" role="tab" aria-selected={!agrupar} className={`segmented__btn ${!agrupar ? "is-active" : ""}`} onClick={() => setAgrupar(false)}>Lista</button>
          <button type="button" role="tab" aria-selected={agrupar} className={`segmented__btn ${agrupar ? "is-active" : ""}`} onClick={() => setAgrupar(true)}>Por proveedor</button>
        </div>
        {filtroMias && usuario && (
          <Checkbox checked={soloMias} onChange={(e) => elegirMias(e.target.checked)}
            label={<>Solo mis órdenes <span className="ds-muted ds-body-sm">({usuario})</span></>} />
        )}
      </div>

      {!agrupar ? (
        <DataTable
          data={lista}
          columns={columns}
          tablaKey="ordenes"
          columnVisibilityInicial={{ interno: false }}
          buscarPlaceholder="Buscar por N.º de orden, proveedor o almacén…"
          getRowId={(o) => o.id}
          onRowClick={(o) => router.push(hrefDetalle(o.id))}
          vacio={filtroMias && soloMias ? "No hay órdenes creadas por vos en esta categoría." : vacio}
          renderExpanded={renderLineas}
        />
      ) : grupos.length === 0 ? (
        <EmptyState title={filtroMias && soloMias ? "No hay órdenes creadas por vos en esta categoría." : vacio} />
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
                        <tr><th>N.º</th><th>Solicitudes</th><th>Almacén</th><th>Fecha</th><th className="ds-num">Total sin IVA</th><th>Recibido</th><th>Estado</th></tr>
                      </thead>
                      <tbody>
                        {g.ords.map((o) => {
                          const peds = ordenPedidos(o); const espera = ordenEsperaCorreccion(o); const dir = ordenEsDirecta(o) && !espera; const b = ordenBadgeDe(o);
                          return (
                            <tr key={o.id} className="is-clickable" onClick={() => router.push(hrefDetalle(o.id))} style={{ cursor: "pointer" }}
                              tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); router.push(hrefDetalle(o.id)); } }}>
                              <td className="ds-strong">{numeroOrden(o)}</td>
                              <td><div className="row gap-2 wrap">{espera && <Badge tone="yellow">Esperando corrección</Badge>}{dir && <Badge tone="yellow">Directa</Badge>}{peds.slice(0, 2).map((n) => <ChipPedido key={n} numero={n} href={pedidoHref?.(n) ?? null} />)}{peds.length > 2 && <span className="ds-muted ds-body-sm">+{peds.length - 2}</span>}</div></td>
                              <td className="ds-body-sm"><CeldaDestino orden={o} /></td>
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
