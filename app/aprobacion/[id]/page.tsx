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

  async function aprobar() { await setOrdenEstado(orden!.id, "lanzado"); toast(`${orden!.numero} aprobada y lanzada`, "success"); }
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
