"use client";

import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { AppShell } from "@/components/shell";
import { Button, Modal, Textarea, useToast } from "@/components/ui";
import { OrdenDetalle } from "@/components/orden-detalle";
import { useStore } from "@/lib/store";
import { aprobarYLanzar } from "@/lib/aprobar";

export default function AprobacionOrdenDetallePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const { ordenes, setOrdenEstado, devolverOrden } = useStore();
  const [rechazarOpen, setRechazarOpen] = useState(false);
  const [motivo, setMotivo] = useState("");

  const orden = ordenes.find((o) => o.id === id);
  if (!orden) {
    return <AppShell role="aprobacion"><main className="page"><div className="empty">Orden no encontrada.</div></main></AppShell>;
  }

  // Aprobar (Luis Roberto): crea y LANZA el pedido en BC en un paso. La orden solo
  // pasa a "lanzado" si BC de verdad la creó con líneas y la lanzó; si BC falla,
  // queda pendiente y se muestra el motivo real (ver lib/aprobar.ts).
  const [aprobando, setAprobando] = useState(false);
  async function aprobar() {
    setAprobando(true);
    const r = await aprobarYLanzar(orden!, setOrdenEstado);
    toast(r.message, r.tone);
    setAprobando(false);
  }

  // Rechazar/denegar: el motivo es OBLIGATORIO. Vuelve a Proveeduría con la nota
  // registrada en el historial y como notificación.
  async function confirmarRechazo() {
    if (!motivo.trim()) { toast("Escribí el motivo del rechazo.", "error"); return; }
    await devolverOrden(orden!.id, motivo.trim());
    toast(`${orden!.numero} devuelta a proveeduría`, "info");
    setRechazarOpen(false);
    router.push("/aprobacion");
  }

  const acciones = orden.estado === "pendiente_aprobacion" ? (
    <>
      <Button variant="red" onClick={() => setRechazarOpen(true)} disabled={aprobando}>Rechazar</Button>
      <Button onClick={aprobar} disabled={aprobando}>{aprobando ? "Lanzando…" : "Aprobar y lanzar"}</Button>
    </>
  ) : null;

  return (
    <AppShell role="aprobacion">
      <OrdenDetalle orden={orden} volverHref="/aprobacion/todas" volverLabel="Volver a órdenes" acciones={acciones} />
      {rechazarOpen && (
        <Modal title={`Rechazar ${orden.numero}`} onClose={() => setRechazarOpen(false)}
          footer={<><Button variant="outline" onClick={() => setRechazarOpen(false)}>Cancelar</Button><Button variant="red" onClick={confirmarRechazo}>Rechazar y devolver</Button></>}>
          <p className="ds-muted ds-body-sm" style={{ marginTop: 0 }}>Indicá por qué se devuelve la orden. Le llega una notificación a Proveeduría y el motivo queda en el historial.</p>
          <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo del rechazo…" rows={4} style={{ width: "100%" }} />
        </Modal>
      )}
    </AppShell>
  );
}
