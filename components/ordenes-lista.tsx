"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge, Checkbox, ProgressBar, EmptyState, useToast } from "@/components/ui";
import { DataTable, TODAS_LAS_FILAS } from "@/components/data-table";
import { IconChevronDown, IconDescargar } from "@/components/icons";
import { useStore } from "@/lib/store";
import { useSoloMias } from "@/lib/use-solo-mias";
import { money, formatDate, formatDateTime, isoLocal, ordenAlmacenes, ordenAvance, ordenBadge, ordenBadgeDe, ordenObras, ordenRecibidoPct, ordenSubtotal, ordenPedidos, ordenEsDirecta, ordenLineaImporte, proveedorLabel, num, numeroOrden, tieneBc, ordenEsperaCorreccion } from "@/lib/helpers";
import { ordenEnviada, resumenEnvio, vaAlProveedor } from "@/lib/envio-proveedor";
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

// "¿Ya se la mandé al proveedor?" — la celda con la que se barren las aprobadas del
// viernes: el PDF se baja DESDE LA LISTA (entrar al detalle para bajarlo era lo que
// hacía perder la página) y la orden queda marcada como enviada. La marca también
// se pone y se quita a mano, para la que se mandó por WhatsApp o para la fila que se
// marcó por error.
function CeldaEnvio({ orden }: { orden: Orden }) {
  const { marcarEnviadaProveedor, recargar } = useStore();
  const toast = useToast();
  const [ocupado, setOcupado] = useState(false);
  // Antes de que Aprobación la lance no hay nada que mandar: la celda no ofrece un
  // botón que el servidor va a rechazar.
  if (!vaAlProveedor(orden)) {
    return <span className="ds-muted" title="Al proveedor solo se le manda una orden aprobada (Lanzada).">—</span>;
  }
  const env = orden.envioProveedor;
  const marca = env
    ? `Enviada al proveedor${env.usuario ? ` por ${env.usuario}` : ""} el ${formatDateTime(env.fecha)} · ${env.manual ? "marcada a mano" : "se bajó el PDF"}. Clic para quitar la marca.`
    : "Marcar como enviada al proveedor (para la que mandaste por otro lado). Bajar el PDF la marca sola.";

  const alternar = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setOcupado(true);
    try { await marcarEnviadaProveedor(orden.id, !env); }
    catch (err: any) { toast(`No se pudo marcar ${numeroOrden(orden)}: ${String(err?.message ?? err)}`, "error"); }
    finally { setOcupado(false); }
  };

  return (
    <div className="envio-cel" onClick={(e) => e.stopPropagation()}>
      <a className="icon-btn" href={`/api/ordenes/${orden.id}/pdf`} download
        title={`Bajar el PDF de ${numeroOrden(orden)} para el proveedor · queda marcada como enviada`}
        aria-label={`Bajar el PDF de ${numeroOrden(orden)}`}
        // La marca la deja el servidor al generar el PDF, así que la lista se entera
        // en el siguiente refresco. Sin este empujón, bajar el PDF no se veía y
        // parecía que el botón no había hecho nada.
        onClick={() => window.setTimeout(() => { void recargar(); }, 1200)}>
        <IconDescargar size={16} />
      </a>
      {/* aria-label aparte del texto: leído solo, "✓ 12/09/2026" no dice de qué es. */}
      <button type="button" className={`envio-check${env ? " is-on" : ""}`} aria-pressed={!!env}
        aria-label={env ? `${numeroOrden(orden)}: enviada al proveedor. Quitar la marca` : `${numeroOrden(orden)}: marcar como enviada al proveedor`}
        disabled={ocupado} title={marca} onClick={alternar}>
        <span className="envio-check__box" aria-hidden>{env ? "✓" : ""}</span>
        <span className="envio-check__txt">{env ? formatDate(isoLocal(env.fecha)) : "Sin enviar"}</span>
      </button>
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
  conEnvioProveedor = false,
  deCorrido = false,
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
  // Columna "Al proveedor" (bajar el PDF + la marca de enviada) y su contador.
  // Solo para Proveeduría: es quien le manda la orden al proveedor —Bodega ve estas
  // mismas listas, y ahí la columna sería un botón que la API le va a rechazar—.
  conEnvioProveedor?: boolean;
  // Arranca mostrando TODAS las órdenes de corrido, sin páginas (el selector de
  // filas sigue ahí por si la lista se vuelve larguísima). Es lo que Angie pidió
  // para las solicitudes y después para las órdenes: "poder ver en toda la pantalla
  // todo lo pendiente, que sea solo de bajar… como está en BC".
  deCorrido?: boolean;
}) {
  const { proveedores, usuario, recepciones } = useStore();
  const router = useRouter();
  // LAS FACTURAS QUE QUEDARON REGISTRADAS EN BC, por orden. Un pase sobre las
  // recepciones en vez de recorrerlas por cada fila. Una orden puede tener varias: se
  // recibe y se factura por partes. Se guarda al lado el N.º del papel del proveedor
  // para el title, porque son dos números distintos y se confunden.
  const facturasBcPorOrden = useMemo(() => {
    const m = new Map<string, { bc: string; prov: string }[]>();
    for (const r of recepciones) {
      const bc = r.bcFacturaNo?.trim();
      if (!bc) continue;
      const arr = m.get(r.ordenId) ?? [];
      if (!arr.some((x) => x.bc === bc)) arr.push({ bc, prov: (r.numeroFactura ?? "").trim() });
      m.set(r.ordenId, arr);
    }
    return m;
  }, [recepciones]);
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
    // CUÁNDO LA APROBARON, que NO es la fecha de la orden: una se arma el martes y
    // Aprobación la lanza el viernes. Es la columna por la que se filtra "todas las
    // aprobadas el viernes" (el filtro de la cabecera trae Hoy / Ayer / Últimos 7
    // días / rango). Sin fecha va "—": puede no haberla en órdenes viejas, y poner
    // ahí la de emisión sería contestar otra pregunta.
    {
      // `isoLocal`: el filtro de fecha compara los 10 primeros caracteres del texto,
      // así que tiene que ser el día DE ACÁ y no el de UTC (ver isoLocal).
      id: "aprobada", header: "Aprobada el", accessorFn: (o) => isoLocal(o.aprobacion?.fecha ?? ""),
      meta: { label: "Aprobada el", date: true },
      cell: (c) => { const a = c.row.original.aprobacion;
        return a ? <span title={`Aprobada${a.usuario ? ` por ${a.usuario}` : ""} el ${formatDateTime(a.fecha)}`}>{formatDate(c.getValue())}</span>
          : <span className="ds-muted" title="Esta orden no tiene fecha de aprobación registrada.">—</span>; },
    },
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
    // EL N.º DE LA FACTURA EN BC: el documento que quedó registrado allá al facturar la
    // recepción, que es el que se busca en el histórico de facturas registradas de
    // Business Central. NO es el número del papel que trae el camión (ese es el del
    // proveedor y va en el title). Una orden completada suele traer una, pero puede
    // traer varias: se recibe y se factura por partes.
    //
    // Va vacío en lo viejo: solo lo traen las recepciones registradas después de que se
    // empezó a guardar (sql/recepcion_bc_factura.sql). Ahí no hay nada que inventar, y
    // por eso dice "—" en vez de mentir.
    {
      id: "facturaBc", header: "Factura BC", meta: { label: "Factura BC" },
      accessorFn: (o) => (facturasBcPorOrden.get(o.id) ?? []).map((f) => f.bc).join(" "),
      cell: (c) => {
        const fs = facturasBcPorOrden.get(c.row.original.id) ?? [];
        if (fs.length === 0) return <span className="ds-muted">—</span>;
        const detalle = fs.map((f) => (f.prov ? `${f.bc} · factura del proveedor ${f.prov}` : f.bc)).join("\n");
        return (
          <span title={detalle} style={{ userSelect: "all" }}>
            {fs[0].bc}{fs.length > 1 ? <span className="ds-muted ds-body-sm"> +{fs.length - 1}</span> : null}
          </span>
        );
      },
    },
    // ¿Ya salió hacia el proveedor? Se filtra por "Sin enviar" para quedarse con
    // justo lo que falta mandar.
    ...(conEnvioProveedor ? [{
      id: "envio", header: "Al proveedor", meta: { label: "Al proveedor" }, enableSorting: false,
      accessorFn: (o: Orden) => (!vaAlProveedor(o) ? "" : ordenEnviada(o) ? "Enviada" : "Sin enviar"),
      cell: (c: any) => <CeldaEnvio orden={c.row.original} />,
    }] : []),
    // Quién generó la OC (creadoPor). Además de leerse, da el filtro por persona del
    // encabezado: cada quien puede quedarse con las suyas o ver las de un compañero.
    { id: "creadaPor", header: "Creada por", accessorFn: (o) => o.creadoPor ?? "", meta: { label: "Creada por" }, cell: (c) => c.getValue() || <span className="ds-muted">—</span> },
  ], [proveedores, pedidoHref, conEnvioProveedor, facturasBcPorOrden]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // El contador de arriba, sobre lo que se está VIENDO: filtrá "aprobadas el
  // viernes" y contesta de una la pregunta de siempre —"¿las mandé todas?"—. Un
  // contador que ignorara el filtro no serviría para eso.
  const resumen = (filas: Orden[]) => {
    const r = resumenEnvio(filas);
    if (!conEnvioProveedor || r.alProveedor === 0) return null;
    return (
      <div className="dt-resumen" role="status">
        <span><span className="ds-strong">{r.enviadas}</span> de {r.alProveedor} enviadas al proveedor</span>
        {r.faltan > 0
          ? <span className="dt-resumen__falta">faltan {r.faltan}</span>
          : <span className="dt-resumen__ok">✓ todas</span>}
        {/* Ninguna trae fecha de aprobación: el filtro de "Aprobada el" no va a
            encontrar nada y sin decirlo parece que la pantalla está rota. La fecha
            la escribe la app de Producción al aprobar; si no está, es allá. */}
        {r.conFechaAprobacion === 0 && (
          <span className="dt-resumen__falta" title="La fecha de aprobación la registra la app de Producción cuando Aprobación lanza la orden. Avisale a TI si ninguna la trae.">
            · sin fecha de aprobación
          </span>
        )}
      </div>
    );
  };

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
          resumen={resumen}
          pageSizeInicial={deCorrido ? TODAS_LAS_FILAS : undefined}
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
                        <tr><th>N.º</th><th>Solicitudes</th><th>Almacén</th><th>Fecha</th><th className="ds-num">Total sin IVA</th><th>Recibido</th><th>Estado</th>{conEnvioProveedor && <th>Al proveedor</th>}</tr>
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
                              {conEnvioProveedor && <td><CeldaEnvio orden={o} /></td>}
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
