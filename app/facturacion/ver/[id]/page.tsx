"use client";

import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { OrdenDetalle } from "@/components/orden-detalle";
import { useStore } from "@/lib/store";

export default function BodegaOrdenDetallePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { ordenes } = useStore();

  const orden = ordenes.find((o) => o.id === id);
  if (!orden) {
    return <><main className="page"><div className="empty">Orden no encontrada.</div></main></>;
  }

  const acciones = orden.estado === "lanzado" ? (
    <Button variant="red" onClick={() => router.push(`/facturacion/${orden.id}`)}>Registrar factura</Button>
  ) : null;

  return (
    <>
      <OrdenDetalle orden={orden} volverHref="/facturacion/todas" volverLabel="Volver a órdenes" acciones={acciones} />
    </>
  );
}
