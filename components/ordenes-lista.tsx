"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, QtyRing } from "@/components/ui";
import { useStore } from "@/lib/store";
import { money, formatDate, ordenBadge, ordenRecibidoPct, ordenSubtotal, ordenPedidos, ordenEsDirecta } from "@/lib/helpers";
import type { Orden } from "@/lib/types";

// Tabla de órdenes reutilizable: incluye buscador y paginación ("Mostrar más")
// para que no se pegue con muchos registros. Cada fila navega al detalle según el rol.
export function OrdenesLista({
  ordenes,
  hrefDetalle,
  vacio = "No hay órdenes.",
}: {
  ordenes: Orden[];
  hrefDetalle: (id: string) => string;
  vacio?: string;
}) {
  const { proveedores } = useStore();
  const router = useRouter();
  const prov = (id: string) => proveedores.find((p) => p.id === id);

  const [colF, setColF] = useState<Record<string, string>>({});
  const setCol = (k: string, v: string) => setColF((f) => ({ ...f, [k]: v }));
  const PAGINA = 50;
  const [limite, setLimite] = useState(PAGINA);

  const COLS = ["num", "prov", "solic", "fecha", "total", "recibido", "estado"];
  const cellText = (o: Orden, k: string): string => {
    switch (k) {
      case "num": return o.numero;
      case "prov": return o.proveedorNombre ?? prov(o.proveedorId)?.nombre ?? "";
      case "solic": return ordenEsDirecta(o) ? "Directa" : ordenPedidos(o).join(" ");
      case "fecha": return formatDate(o.fecha);
      case "total": return money(ordenSubtotal(o), o.currencyCode);
      case "recibido": return `${ordenRecibidoPct(o)}%`;
      case "estado": return ordenBadge(o.estado).label;
      default: return "";
    }
  };

  const filtradas = ordenes
    .filter((o) => COLS.every((k) => { const v = (colF[k] ?? "").trim().toLowerCase(); return !v || cellText(o, k).toLowerCase().includes(v); }));
  const visibles = filtradas.slice(0, limite);

  return (
    <>
      <div className="row row--between wrap gap-3" style={{ marginBottom: 12, alignItems: "center" }}>
        <span className="ds-label ds-muted">{filtradas.length} orden(es)</span>
      </div>

      <Card style={{ padding: 0, overflow: "hidden" }}>
        <div className="ds-table-wrap" style={{ boxShadow: "none" }}>
          <table className="ds-table">
            <thead>
              <tr><th>N.º</th><th>Proveedor</th><th>Solicitudes</th><th>Fecha</th><th className="ds-num">Total</th><th>Recibido</th><th>Estado</th><th></th></tr>
              <tr>
                {COLS.map((k) => (
                  <th key={k} style={{ padding: "4px 6px", fontWeight: 400 }}>
                    <input value={colF[k] ?? ""} placeholder="Filtrar…" onChange={(e) => { setCol(k, e.target.value); setLimite(PAGINA); }}
                      style={{ width: "100%", boxSizing: "border-box", borderRadius: 8, padding: "4px 8px", fontSize: 12, font: "inherit", border: "1.5px solid var(--ds-color-gray-100)", background: "#fff", textAlign: k === "total" ? "right" : "left" }} />
                  </th>
                ))}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtradas.length === 0 && <tr><td colSpan={8}><div className="empty">{ordenes.length ? "Ninguna orden coincide con los filtros." : vacio}</div></td></tr>}
              {visibles.map((o) => {
                const b = ordenBadge(o.estado);
                const peds = ordenPedidos(o);
                const directa = ordenEsDirecta(o);
                return (
                  <tr key={o.id} className="is-clickable" onClick={() => router.push(hrefDetalle(o.id))}>
                    <td className="ds-strong">{o.numero}</td>
                    <td>{o.proveedorNombre ?? prov(o.proveedorId)?.nombre ?? "—"}</td>
                    <td>
                      <div className="row gap-2 wrap">
                        {directa && <Badge tone="yellow">Directa</Badge>}
                        {peds.slice(0, 2).map((n) => <Badge key={n} tone="gray">{n}</Badge>)}
                        {peds.length > 2 && <span className="ds-muted ds-body-sm">+{peds.length - 2}</span>}
                      </div>
                    </td>
                    <td>{formatDate(o.fecha)}</td>
                    <td className="ds-num">{money(ordenSubtotal(o), o.currencyCode)}</td>
                    <td><div className="row gap-3"><QtyRing recibida={o.lineas.reduce((s, l) => s + l.cantidadRecibida, 0)} total={o.lineas.reduce((s, l) => s + l.cantidad, 0)} /><span className="ds-body-sm ds-muted">{ordenRecibidoPct(o)}%</span></div></td>
                    <td><Badge tone={b.tone}>{b.label}</Badge></td>
                    <td className="ds-num">›</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {filtradas.length > limite && (
        <div className="row mt-4" style={{ justifyContent: "center" }}>
          <Button variant="outline" onClick={() => setLimite((n) => n + PAGINA)}>
            Mostrar más ({filtradas.length - limite} restantes)
          </Button>
        </div>
      )}
    </>
  );
}
