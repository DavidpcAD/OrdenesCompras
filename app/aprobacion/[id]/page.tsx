"use client";

import { useParams } from "next/navigation";
import { AppShell } from "@/components/shell";
import { Button, useToast } from "@/components/ui";
import { OrdenDetalle } from "@/components/orden-detalle";
import { useStore } from "@/lib/store";

export default function AprobacionOrdenDetallePage() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const { ordenes, setOrdenEstado } = useStore();

  const orden = ordenes.find((o) => o.id === id);
  if (!orden) {
    return <AppShell role="aprobacion"><main className="page"><div className="empty">Orden no encontrada.</div></main></AppShell>;
  }

  // Aprobar (Luis Roberto): recién aquí el pedido viaja a BC y entra directo como
  // "Lanzado" (la app lo crea y lo libera en un paso vía /api/bc/lanzar). Si BC no
  // está disponible o AdelantePO no está publicado, no se bloquea: la orden queda
  // lanzada localmente y se avisa.
  async function aprobar() {
    const o = orden!;
    const lineasBc = o.lineas
      .filter((l) => l.tipo === "articulo" && l.articuloId && l.cantidad > 0)
      .map((l) => ({ itemNo: l.articuloId!, cantidad: l.cantidad, precio: l.precioUnitario || 0, descripcion: l.descripcion }));
    let bcNumber = o.bcNumber ?? "";
    let bcDeepLink = o.bcDeepLink ?? "";
    let aviso = "";
    if (o.proveedorNo && lineasBc.length) {
      try {
        const res = await fetch("/api/bc/lanzar", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ vendorNo: o.proveedorNo, currencyCode: o.currencyCode, locationCode: o.almacenRecepcion || "ALM-GRAL", lineas: lineasBc }),
        });
        const d = await res.json().catch(() => ({}));
        if (res.ok) {
          bcNumber = d.number || bcNumber;
          bcDeepLink = d.deepLink || bcDeepLink;
          if (d.released === false) aviso = ` · creada en BC (${bcNumber}) como Abierto, no se pudo lanzar: ${d.releaseError ?? "error desconocido"}. Usá "Reintentar lanzar en BC".`;
          else if (bcNumber) aviso = ` · creada y lanzada en BC (${bcNumber})`;
          if (Array.isArray(d.omitidas) && d.omitidas.length) aviso += `. Omitidas en BC: ${d.omitidas.join(", ")}`;
        } else {
          aviso = ` · no se pudo crear en BC (${d.error ?? res.status})`;
        }
      } catch { aviso = " · BC no disponible, quedó lanzada solo localmente"; }
    }
    await setOrdenEstado(o.id, "lanzado", { bcNumber: bcNumber || undefined, bcDeepLink: bcDeepLink || undefined });
    toast(`${bcNumber || o.numero} aprobada y lanzada${aviso}`, "success");
  }
  async function rechazar() { await setOrdenEstado(orden!.id, "abierto"); toast(`${orden!.numero} devuelta a proveeduría`, "info"); }

  const acciones = orden.estado === "pendiente_aprobacion" ? (
    <>
      <Button variant="red" onClick={rechazar}>Rechazar</Button>
      <Button onClick={aprobar}>Aprobar y lanzar</Button>
    </>
  ) : null;

  return (
    <AppShell role="aprobacion">
      <OrdenDetalle orden={orden} volverHref="/aprobacion/todas" volverLabel="‹ Volver a órdenes" acciones={acciones} />
    </AppShell>
  );
}
