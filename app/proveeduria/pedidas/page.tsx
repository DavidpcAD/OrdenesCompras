"use client";

import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge, Checkbox } from "@/components/ui";
import { DataTable } from "@/components/data-table";
import { VistaToggle } from "@/components/vista-toggle";
import { IconReceipt, IconList } from "@/components/icons";
import { useStore } from "@/lib/store";
import { num, formatDate, numeroOrden } from "@/lib/helpers";
import { useSoloMias } from "@/lib/use-solo-mias";

type Estado = "pendiente" | "parcial" | "llego";
interface Row {
  ordenId: string; ordenNumero: string; itemNo: string; descripcion: string; proveedor: string;
  pedido: string; solicitante: string; creadaPor: string; unidad: string; ordenado: number; recibido: number; estado: Estado;
}
const estadoLabel = (e: Estado) => (e === "llego" ? "Llegó" : e === "parcial" ? "Parcial" : "Pendiente");
const estadoTone = (e: Estado) => (e === "llego" ? "green" : e === "parcial" ? "yellow" : "gray");
const EMPRESA_NOMBRE = "Adelante Desarrollos S.A.";

export default function ProveeduriaLineasPedidasPage() {
  const { ordenes, proveedores, pedidos, articulos, usuario } = useStore();

  // Índices armados una sola vez: si no, cada línea de cada orden recorría el
  // catálogo de artículos y TODOS los pedidos con TODAS sus líneas.
  const artPorClave = useMemo(() => {
    const m = new Map<string, typeof articulos[number]>();
    for (const a of articulos) { m.set(a.id, a); m.set(a.code, a); }
    return m;
  }, [articulos]);
  const pedidoPorLinea = useMemo(() => {
    const m = new Map<string, typeof pedidos[number]>();
    for (const p of pedidos) for (const pl of p.lineas) m.set(pl.id, p);
    return m;
  }, [pedidos]);
  const pedidoPorNumero = useMemo(() => new Map(pedidos.map((p) => [p.numero, p])), [pedidos]);

  const baseRows = useMemo<Row[]>(() => {
    const rows: Row[] = [];
    ordenes.forEach((o) => {
      const prov = proveedores.find((p) => p.id === o.proveedorId);
      o.lineas.forEach((l) => {
        if (l.tipo !== "articulo") return;
        const art = l.articuloId ? artPorClave.get(l.articuloId) : undefined;
        const ped = (l.pedidoLineaId ? pedidoPorLinea.get(l.pedidoLineaId) : undefined)
          ?? (l.pedidoNumero ? pedidoPorNumero.get(l.pedidoNumero) : undefined);
        const recibido = l.cantidadRecibida ?? 0;
        const estado: Estado = recibido >= l.cantidad - 1e-9 ? "llego" : recibido > 0 ? "parcial" : "pendiente";
        rows.push({
          ordenId: o.id, ordenNumero: numeroOrden(o), itemNo: art?.code ?? l.articuloId ?? "—", descripcion: l.descripcion,
          proveedor: o.proveedorNombre ? `${o.proveedorNo ?? prov?.code ?? ""} · ${o.proveedorNombre}`.trim().replace(/^· /, "") : prov ? `${prov.code} · ${prov.nombre}` : "—",
          pedido: l.pedidoNumero ?? "—", solicitante: ped?.solicitante ?? "—", creadaPor: o.creadoPor ?? "", unidad: l.unidad, ordenado: l.cantidad, recibido, estado,
        });
      });
    });
    return rows;
  }, [ordenes, proveedores, artPorClave, pedidoPorLinea, pedidoPorNumero]);

  const [estadoF, setEstadoF] = useState<"all" | "pendiente" | "llego">("all");
  // "Solo mis órdenes" se aplica ANTES de los chips: así los conteos son los de la
  // persona (mismo toggle y misma clave de sesión que la vista Por orden).
  const [soloMias, setSoloMias] = useSoloMias();
  const misRows = useMemo(
    () => (soloMias && usuario ? baseRows.filter((r) => r.creadaPor === usuario) : baseRows),
    [baseRows, soloMias, usuario],
  );
  const matchEstado = (r: Row) => estadoF === "all" ? true : estadoF === "llego" ? r.estado === "llego" : r.estado !== "llego";
  const base = useMemo(() => misRows.filter(matchEstado), [misRows, estadoF]); // eslint-disable-line react-hooks/exhaustive-deps
  const totPend = misRows.filter((r) => r.estado !== "llego").length;
  const totLlego = misRows.filter((r) => r.estado === "llego").length;
  const estadoFLabel = (estadoF === "all" ? "Todas" : estadoF === "llego" ? "Ya llegó / facturado" : "Pendiente de llegar")
    + (soloMias && usuario ? ` · Solo mis órdenes (${usuario})` : "");

  const columns = useMemo<ColumnDef<Row, any>[]>(() => [
    { id: "orden", header: "Orden", accessorFn: (r) => r.ordenNumero, meta: { label: "Orden" }, cell: (c) => <span className="ds-strong ds-body-sm">{c.getValue()}</span> },
    { id: "itemNo", header: "Item", accessorFn: (r) => r.itemNo, meta: { label: "Item" }, cell: (c) => <span className="ds-body-sm">{c.getValue()}</span> },
    { id: "descripcion", header: "Descripción", accessorFn: (r) => r.descripcion, meta: { label: "Descripción" }, cell: (c) => <div className="ds-clamp-2" title={c.getValue()} style={{ maxWidth: 380, minWidth: 220 }}>{c.getValue()}</div> },
    { id: "proveedor", header: "Proveedor", accessorFn: (r) => r.proveedor, meta: { label: "Proveedor" }, cell: (c) => <span className="ds-body-sm">{c.getValue()}</span> },
    { id: "pedido", header: "Pedido", accessorFn: (r) => r.pedido, meta: { label: "Pedido" }, cell: (c) => <span className="ds-body-sm">{c.getValue()}</span> },
    { id: "solicitante", header: "Solicitó", accessorFn: (r) => r.solicitante, meta: { label: "Solicitó" }, cell: (c) => <span className="ds-body-sm">{c.getValue()}</span> },
    // Quién generó la orden (no confundir con "Solicitó", que es el ingeniero del
    // pedido). Con el embudo se filtra por compañero de Proveeduría.
    { id: "creadaPor", header: "Creada por", accessorFn: (r) => r.creadaPor, meta: { label: "Creada por" }, cell: (c) => c.getValue() ? <span className="ds-body-sm">{c.getValue()}</span> : <span className="ds-muted">—</span> },
    { id: "ordenado", header: "Ordenado", accessorFn: (r) => r.ordenado, meta: { label: "Ordenado", num: true }, enableColumnFilter: false, cell: (c) => <span className="ds-body-sm">{num.format(c.getValue())} {c.row.original.unidad}</span> },
    { id: "recibido", header: "Recibido", accessorFn: (r) => r.recibido, meta: { label: "Recibido", num: true }, enableColumnFilter: false, cell: (c) => <span className="ds-body-sm">{num.format(c.getValue())} {c.row.original.unidad}</span> },
    { id: "estado", header: "Estado", accessorFn: (r) => estadoLabel(r.estado), meta: { label: "Estado" }, cell: (c) => <Badge tone={estadoTone(c.row.original.estado)}>{estadoLabel(c.row.original.estado)}</Badge> },
  ], []);

  return (
    <>
      <style>{`
        .print-report { display: none; }
        @media print { .no-print { display: none !important; } .topbar { display: none !important; } .print-report { display: block !important; } @page { size: A4 landscape; margin: 12mm; } body { background: var(--ds-color-white); } }
      `}</style>

      <main className="page page--wide no-print">
        <div className="page__head">
          <div className="page__title">
            <h1 className="ds-heading">Líneas pedidas</h1>
            <p className="ds-muted">Todos los materiales ya ordenados a proveedores. Filtrá por estado o por columna y exportá el detalle a PDF.</p>
          </div>
          <div className="row gap-3 wrap" style={{ alignItems: "center" }}>
            <VistaToggle opciones={[
              { label: "Por orden", href: "/proveeduria/ordenes", active: false, icon: <IconReceipt size={16} /> },
              { label: "Por línea", href: "/proveeduria/pedidas", active: true, icon: <IconList size={16} /> },
            ]} />
          </div>
        </div>

        <div className="filterbar">
          <span className="filterbar__label">Estado</span>
          <button type="button" className={`filter-chip ${estadoF === "all" ? "is-active" : ""}`} onClick={() => setEstadoF("all")}>Todas <span className="filter-chip__count">{misRows.length}</span></button>
          <button type="button" className={`filter-chip ${estadoF === "pendiente" ? "is-active" : ""}`} onClick={() => setEstadoF("pendiente")}>Pendiente de llegar <span className="filter-chip__count">{totPend}</span></button>
          <button type="button" className={`filter-chip ${estadoF === "llego" ? "is-active" : ""}`} onClick={() => setEstadoF("llego")}>Ya llegó <span className="filter-chip__count">{totLlego}</span></button>
          {usuario && (
            <span style={{ marginLeft: "auto" }}>
              <Checkbox checked={soloMias} onChange={(e) => setSoloMias(e.target.checked)}
                label={<>Solo mis órdenes <span className="ds-muted ds-body-sm">({usuario})</span></>} />
            </span>
          )}
        </div>

        <div className="mt-2">
          <DataTable data={base} columns={columns} tablaKey="lineas-pedidas" titulo="Líneas pedidas" buscarPlaceholder="Buscar por material, pedido o proveedor…"
            vacio={soloMias ? "No hay líneas de órdenes creadas por vos que coincidan." : "No hay líneas que coincidan con el filtro."} />
        </div>
      </main>

      {/* Reporte imprimible (usa el filtro de estado) */}
      <div className="print-report">
        <div style={{ fontFamily: '"Segoe UI",Roboto,system-ui,sans-serif', color: "var(--ds-color-black)", fontSize: 11 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "2px solid var(--ds-color-black)", paddingBottom: 12 }}>
            <div style={{ fontWeight: 800, letterSpacing: 1, color: "var(--ds-color-green-200)", fontSize: 13, lineHeight: 1 }}>ADELANTE<br /><span style={{ fontSize: 8, letterSpacing: 3, color: "var(--ds-color-gray-400)" }}>DESARROLLOS</span></div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 20, fontWeight: 800 }}>Líneas pedidas</div>
              <div style={{ color: "var(--ds-color-gray-500)", marginTop: 4 }}>{EMPRESA_NOMBRE}</div>
              <div style={{ color: "var(--ds-color-gray-500)" }}>Generado {formatDate(new Date().toISOString())} · Filtro: {estadoFLabel}</div>
              <div style={{ color: "var(--ds-color-gray-500)" }}>{base.length} línea(s)</div>
            </div>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 16, fontSize: 10 }}>
            <thead>
              <tr>{["Orden", "Item", "Descripción", "Proveedor", "Pedido", "Solicitó", "Ordenado", "Recibido", "Estado"].map((h, i) => (
                <th key={h} style={{ borderBottom: "1.5px solid var(--ds-color-black)", padding: "6px 5px", textAlign: i === 6 || i === 7 ? "right" : "left", fontWeight: 700 }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {base.map((r, idx) => (
                <tr key={`p-${r.ordenId}-${r.itemNo}-${idx}`}>
                  <td style={{ padding: "5px 5px", borderBottom: "1px solid var(--ds-color-gray-100)", fontWeight: 600, whiteSpace: "nowrap" }}>{r.ordenNumero}</td>
                  <td style={{ padding: "5px 5px", borderBottom: "1px solid var(--ds-color-gray-100)", whiteSpace: "nowrap" }}>{r.itemNo}</td>
                  <td style={{ padding: "5px 5px", borderBottom: "1px solid var(--ds-color-gray-100)" }}>{r.descripcion}</td>
                  <td style={{ padding: "5px 5px", borderBottom: "1px solid var(--ds-color-gray-100)" }}>{r.proveedor}</td>
                  <td style={{ padding: "5px 5px", borderBottom: "1px solid var(--ds-color-gray-100)", whiteSpace: "nowrap" }}>{r.pedido}</td>
                  <td style={{ padding: "5px 5px", borderBottom: "1px solid var(--ds-color-gray-100)", whiteSpace: "nowrap" }}>{r.solicitante}</td>
                  <td style={{ padding: "5px 5px", borderBottom: "1px solid var(--ds-color-gray-100)", textAlign: "right", whiteSpace: "nowrap" }}>{num.format(r.ordenado)} {r.unidad}</td>
                  <td style={{ padding: "5px 5px", borderBottom: "1px solid var(--ds-color-gray-100)", textAlign: "right", whiteSpace: "nowrap" }}>{num.format(r.recibido)} {r.unidad}</td>
                  <td style={{ padding: "5px 5px", borderBottom: "1px solid var(--ds-color-gray-100)", whiteSpace: "nowrap" }}>{estadoLabel(r.estado)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
