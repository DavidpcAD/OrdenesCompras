"use client";

import { useMemo, useState } from "react";
import { AppShell } from "@/components/shell";
import { Badge, Button, Card } from "@/components/ui";
import { useStore } from "@/lib/store";
import { num, formatDate } from "@/lib/helpers";

type Estado = "pendiente" | "parcial" | "llego";

interface Row {
  ordenId: string;
  ordenNumero: string;
  itemNo: string;
  descripcion: string;
  proveedor: string;
  pedido: string;
  solicitante: string;
  unidad: string;
  ordenado: number;
  recibido: number;
  estado: Estado;
}

function estadoLabel(e: Estado): string {
  return e === "llego" ? "Llegó" : e === "parcial" ? "Parcial" : "Pendiente";
}
function estadoTone(e: Estado): string {
  return e === "llego" ? "green" : e === "parcial" ? "yellow" : "gray";
}

const EMPRESA_NOMBRE = "Adelante Desarrollos S.A.";
// Columnas de texto con filtro por columna (estilo Excel)
const COLS = ["orden", "itemNo", "descripcion", "proveedor", "pedido", "solicitante", "ordenado", "recibido", "estado"] as const;

export default function ProveeduriaLineasPedidasPage() {
  const { ordenes, proveedores, pedidos, articulos } = useStore();

  // Aplana TODAS las líneas de artículo que ya fueron ordenadas (tienen orden y proveedor).
  const baseRows = useMemo<Row[]>(() => {
    const rows: Row[] = [];
    ordenes.forEach((o) => {
      const prov = proveedores.find((p) => p.id === o.proveedorId);
      o.lineas.forEach((l) => {
        if (l.tipo !== "articulo") return;
        const art = articulos.find((a) => a.id === l.articuloId || a.code === l.articuloId);
        const ped =
          pedidos.find((p) => p.lineas.some((pl) => pl.id === l.pedidoLineaId)) ??
          pedidos.find((p) => p.numero === l.pedidoNumero);
        const recibido = l.cantidadRecibida ?? 0;
        const estado: Estado =
          recibido >= l.cantidad - 1e-9 ? "llego" : recibido > 0 ? "parcial" : "pendiente";
        rows.push({
          ordenId: o.id,
          ordenNumero: o.numero,
          itemNo: art?.code ?? l.articuloId ?? "—",
          descripcion: l.descripcion,
          proveedor: o.proveedorNombre ? `${o.proveedorNo ?? prov?.code ?? ""} · ${o.proveedorNombre}`.trim().replace(/^· /, "") : prov ? `${prov.code} · ${prov.nombre}` : "—",
          pedido: l.pedidoNumero ?? "—",
          solicitante: ped?.solicitante ?? "—",
          unidad: l.unidad,
          ordenado: l.cantidad,
          recibido,
          estado,
        });
      });
    });
    return rows;
  }, [ordenes, proveedores, pedidos, articulos]);

  const [estadoF, setEstadoF] = useState<"all" | "pendiente" | "llego">("all");
  const [colF, setColF] = useState<Record<string, string>>({});
  const setCol = (k: string, v: string) => setColF((f) => ({ ...f, [k]: v }));

  const cellText = (r: Row, k: string): string => {
    switch (k) {
      case "orden": return r.ordenNumero;
      case "itemNo": return r.itemNo;
      case "descripcion": return r.descripcion;
      case "proveedor": return r.proveedor;
      case "pedido": return r.pedido;
      case "solicitante": return r.solicitante;
      case "ordenado": return `${r.ordenado} ${r.unidad}`;
      case "recibido": return `${r.recibido} ${r.unidad}`;
      case "estado": return estadoLabel(r.estado);
      default: return "";
    }
  };

  const matchEstado = (r: Row) =>
    estadoF === "all" ? true : estadoF === "llego" ? r.estado === "llego" : r.estado !== "llego";

  const visibles = baseRows
    .filter(matchEstado)
    .filter((r) => COLS.every((k) => {
      const v = (colF[k] ?? "").trim().toLowerCase();
      return !v || cellText(r, k).toLowerCase().includes(v);
    }));

  const totPend = baseRows.filter((r) => r.estado !== "llego").length;
  const totLlego = baseRows.filter((r) => r.estado === "llego").length;

  function exportar() {
    if (visibles.length === 0) return;
    window.print();
  }

  const estadoFLabel =
    estadoF === "all" ? "Todas" : estadoF === "llego" ? "Ya llegó / facturado" : "Pendiente de llegar";

  return (
    <AppShell role="proveeduria">
      <style>{`
        .print-report { display: none; }
        @media print {
          .no-print { display: none !important; }
          .topbar { display: none !important; }
          .print-report { display: block !important; }
          @page { size: A4 landscape; margin: 12mm; }
          body { background: #fff; }
        }
        .lp-tbl-filter { width:100%; box-sizing:border-box; border-radius:8px; padding:4px 8px; font-size:12px; font:inherit; border:1.5px solid var(--ds-color-gray-100); background:#fff; }
      `}</style>

      <main className="page no-print">
        <div className="page__head">
          <div className="page__title">
            <h1 className="ds-heading">Líneas pedidas</h1>
            <p className="ds-muted">Todos los materiales ya ordenados a proveedores. Filtrá por estado o por columna y exportá el detalle a PDF.</p>
          </div>
          <div className="row gap-3">
            <Button variant="outline" onClick={exportar}>Exportar PDF</Button>
          </div>
        </div>

        {/* filtro por estado */}
        <div className="segmented mt-2" style={{ maxWidth: 520 }}>
          <button className={`segmented__btn ${estadoF === "all" ? "is-active" : ""}`} onClick={() => setEstadoF("all")}>
            Todas ({baseRows.length})
          </button>
          <button className={`segmented__btn ${estadoF === "pendiente" ? "is-active" : ""}`} onClick={() => setEstadoF("pendiente")}>
            Pendiente de llegar ({totPend})
          </button>
          <button className={`segmented__btn ${estadoF === "llego" ? "is-active" : ""}`} onClick={() => setEstadoF("llego")}>
            Ya llegó ({totLlego})
          </button>
        </div>

        <Card className="mt-4" style={{ padding: 0, overflow: "hidden" }}>
          <div className="row row--between" style={{ padding: "14px 16px", borderBottom: "1.5px solid var(--ds-color-gray-100)" }}>
            <span className="ds-label ds-muted">{visibles.length} línea(s)</span>
          </div>
          <div className="ds-table-wrap" style={{ boxShadow: "none" }}>
            <table className="ds-table">
              <thead>
                <tr>
                  <th>Orden</th><th>Item</th><th>Descripción</th><th>Proveedor</th>
                  <th>Pedido</th><th>Solicitó</th>
                  <th className="ds-num">Ordenado</th><th className="ds-num">Recibido</th><th>Estado</th>
                </tr>
                <tr>
                  {COLS.map((k, i) => (
                    <th key={k} style={{ padding: "4px 6px", fontWeight: 400 }}>
                      <input className="lp-tbl-filter" value={colF[k] ?? ""} placeholder="Filtrar…"
                        onChange={(e) => setCol(k, e.target.value)}
                        style={{ textAlign: i === 6 || i === 7 ? "right" : "left" }} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibles.length === 0 && (
                  <tr><td colSpan={9}><div className="empty">No hay líneas que coincidan con el filtro.</div></td></tr>
                )}
                {visibles.map((r, idx) => (
                  <tr key={`${r.ordenId}-${r.itemNo}-${idx}`}>
                    <td className="ds-body-sm ds-strong">{r.ordenNumero}</td>
                    <td className="ds-body-sm">{r.itemNo}</td>
                    <td><div className="ds-truncate" title={r.descripcion}>{r.descripcion}</div></td>
                    <td className="ds-body-sm">{r.proveedor}</td>
                    <td className="ds-body-sm">{r.pedido}</td>
                    <td className="ds-body-sm">{r.solicitante}</td>
                    <td className="ds-num ds-body-sm">{num.format(r.ordenado)} {r.unidad}</td>
                    <td className="ds-num ds-body-sm">{num.format(r.recibido)} {r.unidad}</td>
                    <td><Badge tone={estadoTone(r.estado)}>{estadoLabel(r.estado)}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </main>

      {/* ====== Reporte imprimible (solo en print / exportar PDF) ====== */}
      <div className="print-report">
        <div style={{ fontFamily: '"Segoe UI",Roboto,system-ui,sans-serif', color: "#1a1a1a", fontSize: 11 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "2px solid #1a1a1a", paddingBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <svg width="42" height="36" viewBox="0 0 46 40" aria-hidden>
                <path d="M4 30 C14 6 26 4 42 4 C30 12 26 24 22 36 C16 30 10 30 4 30 Z" fill="#7faf1b" />
                <path d="M2 36 C12 18 24 16 38 16 C28 22 24 30 21 38 C15 34 9 35 2 36 Z" fill="#9ec813" />
              </svg>
              <div style={{ fontWeight: 800, letterSpacing: 1, color: "#5f7d12", fontSize: 13, lineHeight: 1 }}>
                ADELANTE<br /><span style={{ fontSize: 8, letterSpacing: 3, color: "#888" }}>DESARROLLOS</span>
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 20, fontWeight: 800 }}>Líneas pedidas</div>
              <div style={{ color: "#555", marginTop: 4 }}>{EMPRESA_NOMBRE}</div>
              <div style={{ color: "#555" }}>Generado {formatDate(new Date().toISOString())} · Filtro: {estadoFLabel}</div>
              <div style={{ color: "#555" }}>{visibles.length} línea(s)</div>
            </div>
          </div>

          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 16, fontSize: 10 }}>
            <thead>
              <tr>
                {["Orden", "Item", "Descripción", "Proveedor", "Pedido", "Solicitó", "Ordenado", "Recibido", "Estado"].map((h, i) => (
                  <th key={h} style={{ borderBottom: "1.5px solid #1a1a1a", padding: "6px 5px", textAlign: i === 6 || i === 7 ? "right" : "left", fontWeight: 700 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibles.map((r, idx) => (
                <tr key={`p-${r.ordenId}-${r.itemNo}-${idx}`}>
                  <td style={{ padding: "5px 5px", borderBottom: "1px solid #ededed", fontWeight: 600, whiteSpace: "nowrap" }}>{r.ordenNumero}</td>
                  <td style={{ padding: "5px 5px", borderBottom: "1px solid #ededed", whiteSpace: "nowrap" }}>{r.itemNo}</td>
                  <td style={{ padding: "5px 5px", borderBottom: "1px solid #ededed" }}>{r.descripcion}</td>
                  <td style={{ padding: "5px 5px", borderBottom: "1px solid #ededed" }}>{r.proveedor}</td>
                  <td style={{ padding: "5px 5px", borderBottom: "1px solid #ededed", whiteSpace: "nowrap" }}>{r.pedido}</td>
                  <td style={{ padding: "5px 5px", borderBottom: "1px solid #ededed", whiteSpace: "nowrap" }}>{r.solicitante}</td>
                  <td style={{ padding: "5px 5px", borderBottom: "1px solid #ededed", textAlign: "right", whiteSpace: "nowrap" }}>{num.format(r.ordenado)} {r.unidad}</td>
                  <td style={{ padding: "5px 5px", borderBottom: "1px solid #ededed", textAlign: "right", whiteSpace: "nowrap" }}>{num.format(r.recibido)} {r.unidad}</td>
                  <td style={{ padding: "5px 5px", borderBottom: "1px solid #ededed", whiteSpace: "nowrap" }}>{estadoLabel(r.estado)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
