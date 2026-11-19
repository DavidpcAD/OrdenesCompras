"use client";

import { useState } from "react";
import { Button, Field, Modal, Textarea } from "@/components/ui";
import { lineasDeRecepcion, money, num, numeroOrden } from "@/lib/helpers";
import type { Orden, Recepcion } from "@/lib/types";

// "NO LLEGÓ": Bodega dio por recibido algo que nunca llegó y quedó en revisión. Esto
// lo saca de revisión y la orden deja de contarlo como recibido. En BC hay que
// deshacer la recepción primero: el servidor lo revisa allá y, si todavía consta
// recibido, no deja y dice qué falta (el mensaje se queda acá, no en un toast, porque
// es largo y es lo que hay que ir a hacer en BC).
export function NoLlegoDialogo({ rec, orden, onConfirmar, onClose }: {
  rec: Recepcion; orden?: Orden; onConfirmar: (motivo: string) => Promise<void>; onClose: () => void;
}) {
  const [motivo, setMotivo] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const cur = orden?.currencyCode;
  const filas = lineasDeRecepcion(rec, orden);
  async function confirmar() {
    if (!motivo.trim()) return;
    setGuardando(true); setError("");
    try { await onConfirmar(motivo.trim()); }
    catch (e: any) { setError(String(e?.message ?? e)); }
    finally { setGuardando(false); }
  }
  return (
    <Modal wide title={`No llegó · ${orden ? numeroOrden(orden) : ""}`} onClose={() => { if (!guardando) onClose(); }}
      footer={<>
        <Button variant="outline" onClick={onClose} disabled={guardando}>Cancelar</Button>
        <Button variant="red" loading={guardando} disabled={!motivo.trim()} onClick={() => void confirmar()}>
          {guardando ? "Revisando en BC…" : "Sí, no llegó"}
        </Button>
      </>}>
      <p className="ds-body-sm" style={{ marginTop: 0 }}>
        Para material que se dio por recibido y <span className="ds-strong">nunca llegó</span>. Sale de “Facturas en revisión” y la orden
        deja de contarlo como recibido.
      </p>
      <ul className="rev-lineas">
        {filas.map(({ rl, ol, importe }) => (
          <li key={rl.ordenLineaId}>
            <span>{ol?.descripcion ?? "Línea"} <span className="ds-muted">· {num.format(rl.cantidadRecibida)} {ol?.unidad ?? ""}</span></span>
            <span className="ds-num ds-strong">{money(importe, cur)}</span>
          </li>
        ))}
      </ul>
      <div className="rev-otra" style={{ marginTop: "var(--ds-space-3)" }}>
        <div className="rev-otra__ttl">Antes, en Business Central</div>
        <p className="rev-otra__txt">
          Hay que deshacer esta recepción: Recepciones registradas → la recepción del pedido → la línea → Deshacer recepción. Si BC no
          deja porque la entrada ya se usó (por ejemplo, la ajustó una toma física), Contabilidad la desaplica primero. La app lo revisa
          en BC y, si allá todavía consta recibido, no deja.
        </p>
      </div>
      <Field label="¿Por qué no llegó?">
        <Textarea rows={2} maxLength={300} value={motivo} onChange={(e) => setMotivo(e.target.value)}
          placeholder="Ej. el proveedor no lo trajo; se dio por recibido por error" />
      </Field>
      {error && <div className="rev-error" role="alert">{error}</div>}
      <p className="ds-body-sm ds-muted" style={{ margin: "var(--ds-space-2) 0 0" }}>
        Después, Proveeduría puede cerrar la orden (“Cerrar orden”) para devolver a la solicitud lo que no llegó.
      </p>
    </Modal>
  );
}
