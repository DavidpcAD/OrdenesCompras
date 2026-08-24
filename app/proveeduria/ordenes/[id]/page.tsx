"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button, Checkbox, EmptyState, Field, Modal, Select, Skeleton, Textarea, useToast } from "@/components/ui";
import { IconWarning } from "@/components/icons";
import { OrdenDetalle } from "@/components/orden-detalle";
import { useStore } from "@/lib/store";
import { num, ordenPendienteResumen, numeroOrden, etiquetaInterna } from "@/lib/helpers";

export default function ProvOrdenDetallePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const { ordenes, pedidos, recepciones, setOrdenEstado, cerrarOrden, nuevaOrdenConPendiente, cargando } = useStore();
  const [procesando, setProcesando] = useState(false);
  // Aviso de BC que NO se puede perder (el toast se desvanece y el usuario se queda
  // creyendo que el pedido en BC también se reabrió).
  const [avisoBc, setAvisoBc] = useState<string | null>(null);
  // Modal de cierre. `crearNueva` convierte el cierre en "pasar el pendiente a una
  // orden nueva": por eso obliga a devolver el saldo (la nueva lo vuelve a tomar).
  const [cerrando, setCerrando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [nota, setNota] = useState("");
  const [devolver, setDevolver] = useState(true);
  const [crearNueva, setCrearNueva] = useState(false);

  const orden = ordenes.find((o) => o.id === id);
  if (!orden) {
    // Durante la carga inicial (SQL/BC) el store aún está vacío: mostrar skeleton
    // en vez de parpadear "no encontrada".
    if (cargando) {
      return <main className="page"><div className="col gap-4" aria-busy="true">
        <Skeleton style={{ display: "block", width: 240, height: 30, borderRadius: 8 }} />
        <Skeleton style={{ display: "block", width: 360, height: 16, borderRadius: 6 }} />
        <Skeleton style={{ display: "block", width: "100%", height: 340, borderRadius: 16, marginTop: 8 }} />
      </div></main>;
    }
    return <><main className="page"><EmptyState icon={<IconWarning size={24} />} title="Orden no encontrada." /></main></>;
  }
  // Link de cada línea a su solicitud de origen (para ver quién la pidió).
  const solicitudHref = (l: NonNullable<typeof orden>["lineas"][number]) => {
    const p = (l.pedidoLineaId && pedidos.find((x) => x.lineas.some((ln) => ln.id === l.pedidoLineaId)))
      || (l.pedidoNumero && pedidos.find((x) => x.numero === l.pedidoNumero));
    return p ? `/proveeduria/solicitudes/${p.id}` : null;
  };

  // Cambiar el estado de la orden. Si el servidor falla hay que DECIRLO: antes la
  // promesa se rechazaba sin manejar y el botón parecía no hacer nada.
  async function act(estado: NonNullable<typeof orden>["estado"], msg: string, opts?: { reabrirBc?: boolean }) {
    if (procesando) return;            // evita el doble clic
    setProcesando(true);
    try {
      const r = await setOrdenEstado(orden!.id, estado, { reabrirBc: opts?.reabrirBc });
      // Si BC no pudo acompañar el cambio, ese aviso manda sobre el "listo" — y queda
      // fijo en la pantalla, no solo como toast.
      if (r?.bcAviso) { setAvisoBc(r.bcAviso); toast(r.bcAviso, "info"); }
      else { setAvisoBc(null); toast(msg, "success"); }
    } catch (e: any) {
      toast(`No se pudo actualizar la orden: ${String(e?.message ?? e)}`, "error");
    } finally {
      setProcesando(false);
    }
  }

  // Con material ya recibido/facturado la orden no se reabre: en BC el pedido ya
  // tiene recepciones registradas y no se puede des-lanzar. Lo que llegó mal va por
  // devolución, no por corregir la orden.
  const tieneRecepciones = recepciones.some((r) => r.ordenId === orden.id)
    || orden.lineas.some((l) => (l.cantidadRecibida ?? 0) > 0 || (l.cantidadFacturada ?? 0) > 0);

  // Motivos típicos por los que una orden se cierra con material pendiente. El
  // motivo es obligatorio: sin él, dentro de un mes nadie sabe por qué faltó.
  const MOTIVOS = [
    "El proveedor no entregó el resto",
    "Se compró en otro lado",
    "Ya no se necesita",
    "El material se descontinuó",
    "Error en la orden",
  ];
  const pendiente = ordenPendienteResumen(orden);

  async function confirmarCierre() {
    if (!motivo) { toast("Elegí el motivo del cierre.", "error"); return; }
    if (procesando) return;
    const texto = [motivo, nota.trim()].filter(Boolean).join(" — ");
    setProcesando(true);
    try {
      if (crearNueva) {
        const n = await nuevaOrdenConPendiente(orden!.id, texto);
        setCerrando(false);
        // `n` es una orden recién creada: nunca tiene N.º de BC todavía, así que va
        // el rótulo. Si no, el toast decía "CP-000046" sobre una pantalla cuyo
        // título ya dice "Interno 46".
        toast(`${numeroOrden(orden!)} cerrada · ${etiquetaInterna(n.numero)} creada con lo pendiente`, "success");
        if (n.id) router.push(`/proveeduria/ordenes/${n.id}`);
        return;
      }
      const r = await cerrarOrden(orden!.id, texto, devolver);
      setCerrando(false);
      toast(r.pendienteDevuelto > 0
        ? `${numeroOrden(orden!)} cerrada · ${num.format(r.pendienteDevuelto)} u. sin recibir ${devolver ? "volvieron a las solicitudes" : "quedaron consumidas"}`
        : `${numeroOrden(orden!)} cerrada`, "success");
    } catch (e: any) {
      toast(`No se pudo cerrar la orden: ${String(e?.message ?? e)}`, "error");
    } finally {
      setProcesando(false);
    }
  }

  const acciones = (
    <>
      {orden.estado === "abierto" && (
        <>
          <Button variant="outline" onClick={() => router.push(`/proveeduria/ordenes/${orden.id}/editar`)}>Editar</Button>
          <Button disabled={procesando} onClick={() => act("pendiente_aprobacion", `${numeroOrden(orden)} enviada a aprobación`)}>
            {procesando ? "Enviando…" : "Enviar a aprobación"}
          </Button>
        </>
      )}
      {orden.estado === "pendiente_aprobacion" && (
        <>
          <span className="ds-muted ds-label" style={{ alignSelf: "center" }}>En espera de aprobación de Luis Roberto</span>
          <Button variant="outline" disabled={procesando} onClick={() => act("abierto", "Solicitud de aprobación cancelada")}>Cancelar envío</Button>
        </>
      )}
      {orden.estado === "rechazado" && (
        <>
          <Button variant="outline" onClick={() => router.push(`/proveeduria/ordenes/${orden.id}/editar`)}>Editar</Button>
          <Button disabled={procesando} onClick={() => act("pendiente_aprobacion", `${numeroOrden(orden)} corregida y reenviada a aprobación`)}>
            {procesando ? "Reenviando…" : "Reenviar a aprobación"}
          </Button>
        </>
      )}
      {/* Reabrir = des-lanzar también el pedido en BC (lo hace el server): con el
          pedido lanzado allá no se puede corregir ni re-sincronizar. Si BC no pudo,
          el toast lo dice y el aviso amarillo del detalle queda visible. */}
      {orden.estado === "lanzado" && (
        <Button variant="outline" disabled={procesando || tieneRecepciones}
          title={tieneRecepciones
            ? "Ya tiene facturas/recepciones registradas: no se puede volver a abrir. Lo que llegó mal va por devolución."
            : "Reabre la orden acá y des-lanza el pedido en Business Central para corregirla y volver a enviarla a aprobación."}
          onClick={() => void act("abierto", `${numeroOrden(orden)} reabierta${orden.bcNumber ? ` · ${orden.bcNumber} des-lanzado en BC` : ""} — corregila y volvé a enviarla a aprobación`, { reabrirBc: true })}>
          Volver a abrir
        </Button>
      )}
      {/* Cerrar: la orden se da por terminada aunque falte material (el proveedor no
          lo trajo, se compró en otro lado). Distinto de reabrir, que es para corregirla. */}
      {orden.estado === "lanzado" && (
        <Button variant="outline" disabled={procesando}
          title="Dar por terminada la orden aunque quede material sin recibir"
          onClick={() => { setMotivo(""); setNota(""); setDevolver(true); setCrearNueva(false); setCerrando(true); }}>
          Cerrar orden
        </Button>
      )}
    </>
  );

  return (
    <>
      <OrdenDetalle orden={orden} volverHref="/proveeduria/ordenes" volverLabel="Volver a órdenes" acciones={acciones} solicitudHref={solicitudHref}
        pedidoHref={(n) => { const p = pedidos.find((x) => x.numero === n); return p ? `/proveeduria/solicitudes/${p.id}` : null; }}
        aviso={avisoBc ? (
          <div className="ds-callout ds-callout--yellow mb-4" role="alert">
            <span className="ds-callout__icon"><IconWarning size={18} /></span>
            <div style={{ flex: 1 }}>
              <div className="ds-callout__title">Business Central quedó desalineado</div>
              <div className="ds-callout__body">{avisoBc}</div>
            </div>
            <Button variant="outline" size="sm" onClick={() => setAvisoBc(null)}>Entendido</Button>
          </div>
        ) : null} />

      {cerrando && (
        <Modal title={`Cerrar ${numeroOrden(orden)}`} onClose={() => setCerrando(false)} footer={
          <>
            <Button variant="outline" onClick={() => setCerrando(false)} disabled={procesando}>Cancelar</Button>
            <Button onClick={() => void confirmarCierre()} disabled={procesando || !motivo}>
              {procesando ? "Cerrando…" : crearNueva ? "Cerrar y crear la nueva" : "Cerrar orden"}
            </Button>
          </>
        }>
          <div className="col gap-4">
            <p className="ds-body-sm">
              {pendiente.unidades > 0
                ? <>Quedan <span className="ds-strong">{num.format(pendiente.unidades)} unidad(es)</span> sin recibir en {pendiente.lineas} línea(s). La orden pasa a <span className="ds-strong">Completada</span> y sale de “por recibir”.</>
                : <>Esta orden ya se recibió completa. Pasa a <span className="ds-strong">Completada</span>.</>}
            </p>
            <Field label="Motivo del cierre">
              <Select value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Elegí un motivo…">
                {MOTIVOS.map((m) => <option key={m} value={m}>{m}</option>)}
              </Select>
            </Field>
            <Field label="Nota (opcional)">
              <Textarea rows={2} value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Detalle para el historial" />
            </Field>
            {pendiente.unidades > 0 && (
              <div className="col gap-2">
                <Checkbox checked={crearNueva}
                  onChange={(e) => { setCrearNueva(e.target.checked); if (e.target.checked) setDevolver(true); }}
                  label="Crear una orden nueva con lo pendiente (para comprárselo a otro proveedor)" />
                <Checkbox checked={devolver} disabled={crearNueva}
                  onChange={(e) => setDevolver(e.target.checked)}
                  label="Devolver lo pendiente a las solicitudes, para poder volver a comprarlo" />
                {/* Sin devolver el saldo, esas unidades quedan "ya ordenadas" y nadie
                    las puede volver a pedir sin abrir una solicitud nueva. */}
                {!devolver && <span className="ds-body-sm ds-muted">Ojo: si no las devolvés, esas unidades quedan consumidas y no van a aparecer para comprar de nuevo.</span>}
              </div>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
