"use client";

import { useParams, useRouter } from "next/navigation";
import { AppShell } from "@/components/shell";
import { useToast } from "@/components/ui";
import { SolicitudForm, type SolicitudInicial } from "@/components/solicitud-form";
import { useStore } from "@/lib/store";

export default function EditarSolicitudPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const { pedidos, editPedido } = useStore();

  const pedido = pedidos.find((p) => p.id === id);
  if (!pedido) {
    return <AppShell role="ingenieria"><main className="page"><div className="empty">Pedido no encontrado.</div></main></AppShell>;
  }

  const editable = (pedido.estado === "borrador" || pedido.estado === "devuelto") && pedido.lineas.every((l) => l.cantidadOrdenada === 0);
  if (!editable) {
    return (
      <AppShell role="ingenieria">
        <main className="page">
          <div className="back-link" onClick={() => router.push(`/ingenieria/${id}`)}>Volver al pedido</div>
          <div className="empty" style={{ padding: "48px 16px" }}>
            Este pedido ya no se puede editar: fue enviado a proveeduría o ya tiene orden de compra.
          </div>
        </main>
      </AppShell>
    );
  }

  const inicial: SolicitudInicial = {
    tipoSolicitud: pedido.tipoSolicitud,
    obraCodigo: pedido.obraCodigo,
    maquinaNo: pedido.maquinaNo,
    solicitante: pedido.solicitante,
    prioridad: pedido.prioridad,
    notas: pedido.notas,
    lineas: pedido.lineas.map((l) => ({ articuloId: l.articuloId, almacen: l.almacen, cantidad: l.cantidad, variantCode: l.variantCode })),
  };

  return (
    <AppShell role="ingenieria">
      <main className="page">
        <div className="back-link" onClick={() => router.push(`/ingenieria/${id}`)}>Volver al pedido</div>
        <div className="page__head">
          <div className="page__title">
            <h1 className="ds-heading">Editar {pedido.numero}</h1>
            <p className="ds-muted">Modificá el destino y las líneas. Solo se puede mientras el pedido esté en borrador.</p>
          </div>
        </div>
        <SolicitudForm
          inicial={inicial}
          textoBoton="Guardar cambios"
          onCancelar={() => router.push(`/ingenieria/${id}`)}
          guardar={async (input) => {
            await editPedido(id, input);
            toast("Cambios guardados", "success");
            router.push(`/ingenieria/${id}`);
          }}
        />
      </main>
    </AppShell>
  );
}
