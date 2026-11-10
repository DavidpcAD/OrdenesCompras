"use client";

import { useState } from "react";
import { Button, Field, Modal, Textarea } from "@/components/ui";
import { useStore } from "@/lib/store";
import { aprobacionAutomatica } from "@/lib/aprobacion-automatica";
import { DECIMALES_PRECIO, lineasCorregibles, ordenConPrecios, precioTxt, validarCorreccionPrecio } from "@/lib/corregir-precio";
import { codigoDeItem } from "@/lib/unidad";
import { cuenta, money, num, numeroOrden, ordenTotalConIva } from "@/lib/helpers";
import type { Orden } from "@/lib/types";

export type ResultadoCorreccion = { relanzada: boolean; pendienteAprobacion: boolean; aviso?: string; avisos: string[] };

// "1234,5678", "1 234.5678" o "1234.5678": se acepta coma o punto como decimal y se
// ignoran los espacios. Cualquier otra cosa es NaN y la línea lo dice.
function leerPrecio(s: string): number {
  const t = String(s ?? "").replace(/\s/g, "");
  if (!/^\d+([.,]\d+)?$/.test(t)) return Number.NaN;
  return Number(t.replace(",", "."));
}

// CORREGIR EL PRECIO de una orden que ya tiene material recibido (ver
// lib/corregir-precio.ts). Cada línea que todavía no está facturada completa trae su
// precio de hoy; se escribe el nuevo solo en la que cambia. El precio se cambia en su
// lugar, en BC y acá, sin tocar las recepciones.
export function CorregirPrecioDialogo({ orden, onClose, onHecho }: {
  orden: Orden; onClose: () => void; onHecho: (r: ResultadoCorreccion) => void;
}) {
  const { corregirPrecio } = useStore();
  const [precios, setPrecios] = useState<Record<string, string>>({});
  const [motivo, setMotivo] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  // Antes de escribir en BC, un paso para REVISAR el cambio: qué precio cambia, cuánto
  // pasa a valer la orden y qué va a pasar con el pedido allá.
  const [revisando, setRevisando] = useState(false);
  const cur = orden.currencyCode;
  const lineas = lineasCorregibles(orden);

  const escritas = lineas.filter((l) => (precios[l.id] ?? "").trim() !== "");
  const cambios = escritas.map((l) => ({ ordenLineaId: l.id, precio: leerPrecio(precios[l.id]) }));
  // Los precios se validan solos (sin el motivo) para poder decir en la línea qué falla.
  const deLosPrecios = validarCorreccionPrecio(orden, cambios, "motivo de la pantalla");
  const nueva = ordenConPrecios(orden, deLosPrecios.cambios.map((c) => ({ ordenLineaId: c.linea.id, precio: c.nuevo })));
  const antes = ordenTotalConIva(orden);
  const despues = ordenTotalConIva(nueva);
  const dif = despues - antes;
  const haCambio = !deLosPrecios.error && deLosPrecios.cambios.length > 0;
  const sinAprobacion = aprobacionAutomatica(orden, { app: despues }).aplica;
  const faltaMotivo = motivo.trim().length < 5;

  function revisar() {
    const v = validarCorreccionPrecio(orden, cambios, motivo);
    if (v.error) { setError(v.error); return; }
    setError("");
    setRevisando(true);
  }

  async function confirmar() {
    const v = validarCorreccionPrecio(orden, cambios, motivo);
    if (v.error) { setError(v.error); setRevisando(false); return; }
    setGuardando(true);
    setError("");
    try {
      const r = await corregirPrecio(orden.id, v.cambios.map((c) => ({ ordenLineaId: c.linea.id, precio: c.nuevo })), motivo.trim());
      onHecho(r);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setGuardando(false);
    }
  }

  if (revisando) {
    return (
      <Modal wide title={`Revisá el cambio de precio · ${numeroOrden(orden)}`} onClose={() => { if (!guardando) onClose(); }} footer={
        <>
          <Button variant="outline" onClick={() => setRevisando(false)} disabled={guardando}>Volver</Button>
          <Button loading={guardando} onClick={() => void confirmar()}>{guardando ? "Corrigiéndolo en BC…" : "Sí, corregir precio"}</Button>
        </>
      }>
        <p className="ds-body-sm" style={{ marginTop: 0 }}>
          Esto cambia el precio <span className="ds-strong">en Business Central y en la app</span>. Para hacerlo, el pedido se
          reabre un momento en BC y {sinAprobacion
            ? <>se <span className="ds-strong">vuelve a lanzar solo</span> (esta orden no necesita aprobación): la factura se puede registrar de una vez.</>
            : <>queda <span className="ds-strong">pendiente de aprobación</span>: hasta que la aprueben no se puede registrar la factura.</>}
        </p>
        <ul className="rev-lineas">
          {deLosPrecios.cambios.map((c) => (
            <li key={c.linea.id}>
              <span>{c.linea.descripcion} <span className="ds-muted">· {num.format(c.linea.cantidad)} {c.linea.unidad}</span></span>
              <span className="ds-num"><span className="ds-muted">{precioTxt(c.antes, cur)}</span> → <span className="ds-strong">{precioTxt(c.nuevo, cur)}</span></span>
            </li>
          ))}
        </ul>
        <div className="rev-total">
          <div className="panel-orden__fila"><span className="ds-muted">Total con IVA hoy</span><span className="ds-num">{money(antes, cur)}</span></div>
          <div className="panel-orden__fila panel-orden__fila--total"><span>Total con IVA nuevo</span><span className="ds-num">{money(despues, cur)}</span></div>
          <div className="panel-orden__fila"><span className="ds-muted">Diferencia</span><span className="ds-num">{dif >= 0 ? "+" : "−"}{money(Math.abs(dif), cur)}</span></div>
        </div>
        <dl className="rev-datos">
          <dt>Motivo</dt><dd>{motivo.trim()}</dd>
        </dl>
        {error && <p className="ds-body-sm" role="alert" style={{ color: "var(--ds-text-danger)", margin: "8px 0 0", whiteSpace: "pre-wrap" }}>{error}</p>}
      </Modal>
    );
  }

  return (
    <Modal wide conLista title={`Corregir precio · ${numeroOrden(orden)}`} onClose={() => { if (!guardando) onClose(); }} footer={
      <>
        <Button variant="outline" onClick={onClose} disabled={guardando}>Cancelar</Button>
        <Button onClick={revisar} disabled={guardando || !haCambio || faltaMotivo}>Revisar el cambio</Button>
      </>
    }>
      <p className="ds-body-sm" style={{ marginTop: 0 }}>
        El material ya se recibió. Escribí el precio de la factura en la línea que cambia: se corrige
        en <span className="ds-strong">Business Central y acá</span>, sin tocar las recepciones. Al registrar la factura,
        BC lleva la diferencia a lo que ya salió a las obras con su ajuste de costo.
      </p>

      <div className="frv-box modal__lista">
        <div className="ocl-top">
          <span className="ocl-top__ttl">Precio por línea</span>
          <span className="ds-body-sm ds-muted">{cuenta(lineas.length, "línea sin facturar", "líneas sin facturar")}</span>
        </div>
        <div className="frv-scroll">
          <div className="frv-line frv-line--precio frv-line--head" aria-hidden>
            <span>Material</span><span className="ds-num">Cantidad</span><span className="ds-num">Precio hoy</span><span className="ds-num">Precio nuevo</span><span className="ds-num">Importe</span>
          </div>
          {lineas.map((l) => {
            const crudo = precios[l.id] ?? "";
            const p = crudo.trim() ? leerPrecio(crudo) : Number.NaN;
            const valido = Number.isFinite(p) && p > 0;
            const malo = crudo.trim() !== "" && (!valido || (String(p).split(".")[1]?.length ?? 0) > DECIMALES_PRECIO);
            // El importe solo cambia con un precio que se puede guardar: con uno inválido
            // la línea mostraría una plata que no va a quedar en ningún lado.
            const cambia = valido && !malo && Math.abs(p - l.precioUnitario) > 1e-6;
            const importe = (Number(l.cantidad) || 0) * (cambia ? p : l.precioUnitario) * (1 - (l.descuentoPct ?? 0) / 100);
            const codigo = l.articuloId ? codigoDeItem(l.articuloId) : "";
            return (
              <div key={l.id} className="frv-line frv-line--precio">
                <div className="ocl-line__desc frv-line__desc">
                  <span className="ocl-line__name">{l.descripcion}</span>
                  <span className="ocl-line__sub">
                    {codigo && <span className="ocl-line__code">{codigo}</span>}
                    {codigo && l.almacen && <span className="ocl-line__sep" aria-hidden>·</span>}
                    {l.almacen && <span>{l.almacen}</span>}
                    {l.cantidadRecibida > 0 && <span>· {num.format(l.cantidadRecibida)} recibido{l.cantidadRecibida === 1 ? "" : "s"}</span>}
                  </span>
                </div>
                <div className="ds-num frv-line__rec"><span className="frv-line__lbl">Cantidad </span>{num.format(l.cantidad)} <span className="ocl-line__u">{l.unidad}</span></div>
                <div className="ds-num frv-line__act"><span className="frv-line__lbl">Hoy </span>{precioTxt(l.precioUnitario, cur)}</div>
                <div className="frv-line__qty">
                  <input className={`qty-input qty-input--sm qty-input--precio ${cambia ? "is-parcial" : ""}`} type="text" inputMode="decimal"
                    value={crudo} placeholder={String(l.precioUnitario)}
                    aria-label={`Precio nuevo de ${l.descripcion} (hoy ${precioTxt(l.precioUnitario, cur)})`}
                    aria-invalid={malo || undefined}
                    onChange={(e) => { setPrecios((x) => ({ ...x, [l.id]: e.target.value })); setError(""); }} />
                </div>
                <div className="ds-num frv-line__amt">{money(importe, cur)}</div>
                {malo && (
                  <div className="frv-hint frv-hint--danger" role="status">
                    Escribí un precio mayor que cero, con hasta {DECIMALES_PRECIO} decimales (por ejemplo 1234,5678).
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="frv-sum">
          <span className="ds-body-sm ds-muted">
            Total con IVA {money(antes, cur)} → <span className="ds-strong">{money(despues, cur)}</span>
            {haCambio && Math.abs(dif) >= 0.005 && <> ({dif > 0 ? "+" : "−"}{money(Math.abs(dif), cur)})</>}
          </span>
          {haCambio && (
            <span className="ds-body-sm frv-sum__resto">
              {sinAprobacion
                ? "No necesita aprobación: el pedido se vuelve a lanzar en Business Central solo y la factura se puede registrar de una vez."
                : "Vuelve a Aprobación: hasta que la aprueben no se puede registrar la factura."}
            </span>
          )}
        </div>
      </div>

      <Field className="frv-nota" label="¿Por qué cambia el precio?" warning={!!error && faltaMotivo}
        help="Queda en la bitácora de la orden. Por ejemplo, el N.º de la factura del proveedor.">
        <Textarea rows={2} value={motivo} maxLength={300} placeholder="Ej. la factura del proveedor trae el precio nuevo"
          onChange={(e) => { setMotivo(e.target.value); setError(""); }} />
      </Field>
      {error && <p className="ds-body-sm" role="alert" style={{ color: "var(--ds-text-danger)", margin: "8px 0 0", whiteSpace: "pre-wrap" }}>{error}</p>}
    </Modal>
  );
}
