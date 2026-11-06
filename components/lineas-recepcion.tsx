"use client";

import type { ReactNode } from "react";
import { Badge } from "@/components/ui";
import { DestinoLinea } from "@/components/destino-linea";
import { intercalar } from "@/components/ordenes-lista";
import { codigoDeItem } from "@/lib/unidad";
import { cuenta, esLineaRecibible, etiquetaTipoLinea, lineasDeRecepcion, money, num } from "@/lib/helpers";
import type { Orden, Recepcion } from "@/lib/types";

// LAS LÍNEAS DE UNA RECEPCIÓN: lo que entró en ESE registro, no lo acumulado de la
// orden. Va en el panel que se despliega en "Facturas en revisión" (Archivo y
// recepciones), con la misma rejilla `.ocl-*` del panel de líneas de la lista de
// órdenes, para que una línea de compra se lea igual en toda la app.
//
// `accion` es el link del cintillo (ir a la orden, o a la factura ya registrada):
// el panel vive en una `<tr>` aparte, así que sin él hay que cerrarlo para seguir.
// `motivo` = por qué Bodega la mandó a revisión: en el histórico es lo único que no
// está en la fila, y sin él no se entiende qué se revisó.
export function LineasDeRecepcion({ rec, orden, accion, motivo }: { rec: Recepcion; orden?: Orden; accion?: ReactNode; motivo?: string }) {
  const cur = orden?.currencyCode;
  const filas = lineasDeRecepcion(rec, orden);
  // `rec.total` es el importe sin IVA que guardó Bodega: de respaldo si la orden no
  // está en el store (no debería pasar) y las líneas no se pueden valorar.
  const subtotal = filas.reduce((s, f) => s + f.importe, 0) || rec.total;

  return (
    <>
      <div className="ocl-top">
        <span className="ocl-top__ttl">Líneas recibidas</span>
        <span className="ds-body-sm ds-muted">{cuenta(filas.length, "línea", "líneas")}</span>
        <span style={{ flex: 1 }} />
        {accion}
      </div>
      {motivo && (
        <div className="dt-exp-pad ds-body-sm" style={{ borderBottom: "1px solid var(--ds-color-gray-100)" }}>
          <span className="ds-muted">Fue a revisión por: </span>{motivo}
        </div>
      )}

      {filas.length === 0 ? (
        <div className="dt-exp-pad ds-body-sm ds-muted">Esta recepción no tiene líneas.</div>
      ) : (
        <>
          <div className="ocl-line ocl-line--head">
            <span>Material</span>
            <span className="ds-num">Recibido</span>
            <span className="ds-num">Precio unit.</span>
            <span className="ds-num">Importe</span>
          </div>
          {filas.map(({ rl, ol, precio, importe }) => {
            const recibible = !!ol && esLineaRecibible(ol);
            const codigo = recibible ? codigoDeItem(ol!.articuloId ?? "") : "";
            return (
              <div key={rl.ordenLineaId} className="ocl-line">
                <div className="ocl-line__desc">
                  {/* Una línea que se borró de la orden después de recibirla: el
                      renglón se deja (el material sí entró) y se dice por qué no tiene nombre. */}
                  <span className="ocl-line__name">{ol?.descripcion ?? "Línea que ya no está en la orden"}</span>
                  <span className="ocl-line__sub">{intercalar([
                    ol && ol.tipo !== "articulo"
                      ? <Badge key="tipo" tone={ol.tipo === "cargo" ? "yellow" : "green"}>{etiquetaTipoLinea(ol.tipo)}</Badge>
                      : null,
                    codigo ? <span key="cod" className="ocl-line__code">{codigo}</span> : null,
                    recibible
                      ? <DestinoLinea key="dest" inline almacen={ol!.almacen} obra={ol!.proyecto} obraInformativa={ol!.obraSolicitud}
                          tarea={ol!.taskNo} maquina={ol!.maquinaNo} maquinaNombre={ol!.maquinaNombre} avisarSinTarea={false} />
                      : null,
                    ol?.descuentoPct ? <span key="desc">−{ol.descuentoPct}%</span> : null,
                  ])}</span>
                </div>
                <div className="ds-num ocl-line__qty">
                  {num.format(rl.cantidadRecibida)} <span className="ocl-line__u">{ol?.unidad ?? ""}</span>
                </div>
                <div className="ds-num ocl-line__price"><span className="ocl-line__lbl">Precio unit. </span>{money(precio, cur)}</div>
                <div className="ds-num ocl-line__amt">{money(importe, cur)}</div>
              </div>
            );
          })}
        </>
      )}

      <div className="ocl-foot">
        <span className="ocl-foot__lbl">Total sin IVA</span>
        <span className="ocl-foot__val">{money(subtotal, cur)}</span>
      </div>
    </>
  );
}
