"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, QtyRing } from "@/components/ui";
import { useStore } from "@/lib/store";
import { money, formatDate, ordenBadge, ordenRecibidoPct, ordenSubtotal } from "@/lib/helpers";
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

  const [busqueda, setBusqueda] = useState("");
  const PAGINA = 50;
  const [limite, setLimite] = useState(PAGINA);

  const q = busqueda.trim().toLowerCase();
  const filtradas = ordenes.filter((o) =>
    !q
    || o.numero.toLowerCase().includes(q)
    || (prov(o.proveedorId)?.nombre ?? "").toLowerCase().includes(q)
    || o.lineas.some((l) => l.pedidoNumero?.toLowerCase().includes(q))
  );
  const visibles = filtradas.slice(0, limite);

  return (
    <>
      <div className="row row--between wrap gap-3" style={{ marginBottom: 12, alignItems: "center" }}>
        <span className="ds-label ds-muted">{filtradas.length} orden(es)</span>
        <input className="ds-form-field__input" style={{ maxWidth: 280, borderRadius: 12, padding: "8px 14px" }}
          placeholder="Buscar por N.º, proveedor o solicitud…" value={busqueda}
          onChange={(e) => { setBusqueda(e.target.value); setLimite(PAGINA); }} />
      </div>

      <Card style={{ padding: 0, overflow: "hidden" }}>
        <div className="ds-table-wrap" style={{ boxShadow: "none" }}>
          <table className="ds-table">
            <thead>
              <tr><th>N.º</th><th>Proveedor</th><th>Solicitudes</th><th>Fecha</th><th className="ds-num">Total</th><th>Recibido</th><th>Estado</th><th></th></tr>
            </thead>
            <tbody>
              {filtradas.length === 0 && <tr><td colSpan={8}><div className="empty">{q ? "No se encontró ninguna orden con esa búsqueda." : vacio}</div></td></tr>}
              {visibles.map((o) => {
                const b = ordenBadge(o.estado);
                const peds = [...new Set(o.lineas.filter((l) => l.pedidoNumero).map((l) => l.pedidoNumero!))];
                return (
                  <tr key={o.id} className="is-clickable" onClick={() => router.push(hrefDetalle(o.id))}>
                    <td className="ds-strong">{o.numero}</td>
                    <td>{prov(o.proveedorId)?.nombre ?? "—"}</td>
                    <td>
                      <div className="row gap-2 wrap">
                        {peds.slice(0, 2).map((n) => <Badge key={n} tone="gray">{n}</Badge>)}
                        {peds.length > 2 && <span className="ds-muted ds-body-sm">+{peds.length - 2}</span>}
                        {peds.length === 0 && <span className="ds-muted ds-body-sm">—</span>}
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
