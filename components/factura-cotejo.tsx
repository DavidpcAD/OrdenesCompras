"use client";

import { useEffect, useState } from "react";
import { Badge, Modal, Skeleton } from "@/components/ui";
import { IconWarning } from "@/components/icons";
import { formatDate, money, num } from "@/lib/helpers";
import { TIPOS, type LineaComprobante, type ResumenComprobante } from "@/lib/cruce-correo-bc";
import type { BcFacturaCompraDetalle } from "@/lib/bc";
import type { FacturaCorreo } from "@/lib/repo-facturas-correo";

// LOS DOS LADOS DE UNA FACTURA, UNO AL LADO DEL OTRO.
//
// La tabla de la auditoría contesta "¿está en BC?". Esto contesta la que viene
// después y es la que cuesta plata: "¿está por lo mismo?" — y cuando no, en cuál
// renglón. A la izquierda lo que cobró el proveedor (el XML que llegó al correo), a
// la derecha lo que se digitó en Business Central, cada columna con su total y con
// el enlace a su fuente: Outlook de un lado, BC del otro.
//
// Las líneas NO se aparean renglón contra renglón a propósito. La descripción que
// manda el proveedor y la que quedó en BC casi nunca son la misma frase —"MORTERO
// REPEMAX MURO SECO" contra el nombre del artículo del catálogo—, así que cualquier
// pareo automático acertaría a veces y mentiría el resto. Lo que sí se dice sin
// adivinar es lo que se puede probar: cuántas líneas trae cada lado y en cuánto
// difieren los totales. Eso es lo que hay que ir a mirar.

type Lado<T> = { ok: true } & T | { ok: false; error: string };
type Datos = {
  factura: FacturaCorreo;
  correo: Lado<{ archivo: string; lineas: LineaComprobante[]; resumen: ResumenComprobante }>;
  bc: Lado<{ factura: BcFacturaCompraDetalle }>;
};

export function FacturaCotejo({ fila, onClose }: { fila: FacturaCorreo; onClose: () => void }) {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const ctl = new AbortController();
    (async () => {
      try {
        const r = await fetch(`/api/vigilancia/factura/${fila.clave}`, { cache: "no-store", signal: ctl.signal });
        const j = await r.json();
        if (!r.ok) throw new Error(j?.error ?? `Error ${r.status}`);
        setDatos(j as Datos);
      } catch (e: any) {
        if (e?.name !== "AbortError") setError(e?.message ?? "No se pudo abrir la factura.");
      }
    })();
    return () => ctl.abort();
  }, [fila.clave]);

  const tipo = TIPOS[fila.tipoDoc] ?? "Comprobante";
  const bc = datos?.bc.ok ? datos.bc.factura : null;
  const correo = datos?.correo.ok ? datos.correo : null;

  return (
    <Modal wide title={`${tipo} ${fila.consecutivo}`} onClose={onClose}>
      <div className="cot-cab">
        <div>
          <div className="ds-strong">{fila.nombreEmisor || fila.cedulaEmisor}</div>
          <div className="ds-muted ds-body-sm">
            Cédula {fila.cedulaEmisor} · emitida el {formatDate(fila.fechaEmision)}
            {fila.bcCalzePor === "nombre" && " · calzó por nombre, no por cédula"}
          </div>
        </div>
        <EstadoBadge estado={fila.estado} />
      </div>

      <Diferencia correo={correo?.resumen ?? null} bc={bc} />

      <div className="cot-cols">
        <Columna
          titulo="Lo que facturó el proveedor"
          fuente="del XML que llegó al correo"
          enlace={fila.webLink
            ? { href: fila.webLink, texto: "ver el correo en Outlook", title: "Abre este correo en Outlook, en una pestaña nueva." }
            : null}
          cargando={!datos && !error}
          error={datos && !datos.correo.ok ? datos.correo.error : ""}
          lineas={correo?.lineas.map((l) => ({
            clave: `x${l.numero}`,
            titulo: l.detalle || l.codigo || l.cabys,
            abajo: [l.codigo, l.cabys && `CABYS ${l.cabys}`].filter(Boolean).join(" · "),
            cantidad: l.cantidad,
            unidad: l.unidad,
            precioUnitario: l.precioUnitario,
            descuento: l.descuento,
            total: l.total,
          })) ?? []}
          moneda={correo?.resumen.moneda ?? fila.moneda}
          totales={correo ? [
            { rotulo: "Subtotal", monto: correo.resumen.subtotal },
            ...(correo.resumen.descuentos ? [{ rotulo: "Descuentos", monto: -correo.resumen.descuentos }] : []),
            ...(correo.resumen.otrosCargos ? [{ rotulo: "Otros cargos", monto: correo.resumen.otrosCargos }] : []),
            { rotulo: "Impuesto", monto: correo.resumen.impuesto },
            { rotulo: "Total", monto: correo.resumen.total, fuerte: true },
          ] : []}
        />

        <Columna
          titulo="Lo que se registró en Business Central"
          fuente={bc?.pedido ? `del pedido ${bc.pedido}` : "de la factura de compra"}
          enlace={fila.bcNumero && fila.bcUrl
            ? { href: fila.bcUrl, texto: fila.bcNumero, title: `Abre la factura ${fila.bcNumero} en Business Central, en una pestaña nueva.` }
            : null}
          cargando={!datos && !error}
          error={datos && !datos.bc.ok ? datos.bc.error : ""}
          lineas={bc?.lineas.map((l) => ({
            clave: `b${l.numeroLinea}`,
            titulo: l.descripcion || l.codigo,
            abajo: [l.codigo, ETIQUETA_TIPO[l.tipo]].filter(Boolean).join(" · "),
            cantidad: l.cantidad,
            unidad: l.unidad,
            precioUnitario: l.precioUnitario,
            descuento: l.descuento,
            total: l.total,
          })) ?? []}
          moneda={bc?.moneda ?? fila.moneda}
          totales={bc ? [
            { rotulo: "Subtotal", monto: bc.subtotal },
            { rotulo: "Impuesto", monto: bc.impuesto },
            { rotulo: "Total", monto: bc.total, fuerte: true },
          ] : []}
        />
      </div>

      {error && (
        <div className="ds-callout ds-callout--red mt-4">
          <span className="ds-callout__icon"><IconWarning size={18} /></span>
          <div className="ds-callout__body">{error}</div>
        </div>
      )}
    </Modal>
  );
}

const ETIQUETA_TIPO: Record<string, string> = {
  articulo: "artículo", recurso: "recurso", activo_fijo: "activo fijo", cargo: "cargo", otro: "cuenta",
};

function EstadoBadge({ estado }: { estado: FacturaCorreo["estado"] }) {
  if (estado === "registrada") return <Badge tone="green">Registrada</Badge>;
  if (estado === "descuadrada") return <Badge tone="yellow">No cuadra el monto</Badge>;
  if (estado === "otra_empresa") return <Badge tone="gray">De otra empresa</Badge>;
  if (estado === "no_aplica") return <Badge tone="gray">No aplica</Badge>;
  return <Badge tone="red">Sin registrar</Badge>;
}

// El número que hay que ver primero. Un céntimo es redondeo; de ahí para arriba
// alguien tecleó otra cosa, y decir cuánto y para qué lado ahorra la resta a mano.
function Diferencia({ correo, bc }: { correo: ResumenComprobante | null; bc: BcFacturaCompraDetalle | null }) {
  if (!correo || !bc) return null;
  if (correo.moneda !== bc.moneda) {
    return (
      <div className="ds-callout ds-callout--yellow mb-4">
        <span className="ds-callout__icon"><IconWarning size={18} /></span>
        <div>
          <div className="ds-callout__title">Están en monedas distintas</div>
          <div className="ds-callout__body">
            El proveedor facturó en {correo.moneda} y en Business Central quedó en {bc.moneda}. Los totales no se
            pueden comparar así.
          </div>
        </div>
      </div>
    );
  }
  const dif = Math.round((bc.total - correo.total) * 100) / 100;
  if (Math.abs(dif) <= 0.5) return null;
  return (
    <div className="ds-callout ds-callout--yellow mb-4">
      <span className="ds-callout__icon"><IconWarning size={18} /></span>
      <div>
        <div className="ds-callout__title">
          Business Central tiene {money(Math.abs(dif), bc.moneda)} {dif > 0 ? "de más" : "de menos"}
        </div>
        <div className="ds-callout__body">
          El proveedor cobró {money(correo.total, correo.moneda)} y en BC quedó {money(bc.total, bc.moneda)}.
          Comparando los renglones de abajo se ve en cuál está la diferencia.
        </div>
      </div>
    </div>
  );
}

type LineaVista = {
  clave: string; titulo: string; abajo: string;
  cantidad: number; unidad: string; precioUnitario: number; descuento: number; total: number;
};

function Columna({ titulo, fuente, enlace, cargando, error, lineas, moneda, totales }: {
  titulo: string;
  fuente: string;
  enlace: { href: string; texto: string; title: string } | null;
  cargando: boolean;
  error: string;
  lineas: LineaVista[];
  moneda: string;
  totales: { rotulo: string; monto: number; fuerte?: boolean }[];
}) {
  return (
    <section className="cot-col" aria-label={titulo}>
      {/* El rótulo arriba y el enlace debajo, a la derecha. Con el enlace al lado del
          título, el de BC —que es más largo— se iba a un tercer renglón y las dos
          columnas arrancaban a alturas distintas: lo primero que se compara es la
          primera línea de cada lado, y desalineadas cuesta el doble. */}
      <header className="cot-col__head">
        <div className="ds-strong ds-body-sm">{titulo}</div>
        <div className="cot-col__meta">
          <span className="ds-muted ds-body-sm">
            {cargando ? fuente : lineas.length
              ? `${lineas.length} ${lineas.length === 1 ? "línea" : "líneas"} · ${fuente}`
              : fuente}
          </span>
          {enlace && (
            <a className="link-btn link-btn--sm" href={enlace.href} target="_blank" rel="noopener noreferrer" title={enlace.title}>
              {enlace.texto}<span className="chip-link__ir" aria-hidden>↗</span>
            </a>
          )}
        </div>
      </header>

      {cargando && (
        <div className="cot-col__cuerpo">
          {[0, 1, 2].map((i) => (
            <div className="cot-linea" key={i}>
              <Skeleton className="ds-skeleton--text" style={{ display: "block", width: "80%" }} />
              <Skeleton className="ds-skeleton--text" style={{ display: "block", width: 70 }} />
            </div>
          ))}
        </div>
      )}

      {!cargando && error && <p className="cot-col__aviso ds-body-sm ds-muted">{error}</p>}

      {!cargando && !error && !lineas.length && (
        <p className="cot-col__aviso ds-body-sm ds-muted">Este documento no trae líneas.</p>
      )}

      {!cargando && !error && lineas.map((l) => (
        <div className="cot-linea" key={l.clave}>
          <div>
            <div className="ds-body-sm ds-strong">{l.titulo || "—"}</div>
            {l.abajo && <div className="ds-muted ds-body-sm">{l.abajo}</div>}
          </div>
          <div className="cot-num">
            <div className="ds-body-sm ds-strong">{money(l.total, moneda)}</div>
            <div className="ds-muted ds-body-sm">
              {num.format(l.cantidad)}{l.unidad ? ` ${l.unidad}` : ""} × {money(l.precioUnitario, moneda)}
            </div>
            {l.descuento > 0 && (
              <div className="ds-muted ds-body-sm">menos {money(l.descuento, moneda)} de descuento</div>
            )}
          </div>
        </div>
      ))}

      {!cargando && !error && !!totales.length && (
        <footer className="cot-col__pie">
          {totales.map((t) => (
            <div className={`cot-tot ${t.fuerte ? "cot-tot--fuerte" : ""}`} key={t.rotulo}>
              <span>{t.rotulo}</span>
              <span className="cot-num">{money(t.monto, moneda)}</span>
            </div>
          ))}
        </footer>
      )}
    </section>
  );
}
