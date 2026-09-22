"use client";

import { useRef, useState } from "react";
import { Button, Card, EmptyState, Tile } from "@/components/ui";
import { IconWarning } from "@/components/icons";
import { formatDate, money, num } from "@/lib/helpers";
import { leerComprobanteXml, TIPOS, type Calzada, type Comprobante } from "@/lib/cruce-correo-bc";
import type { FacturaBc } from "@/lib/vigilancia-facturas";

// EL CRUCE CON EL CORREO — las tres listas que pidió David:
// lo que calza, lo que está en BC y no llegó por correo, y lo que llegó y no está en BC.
//
// Por qué se cargan archivos y no se lee el buzón solo: la app todavía no tiene permiso
// para leer `facturacion@adelantedesarrollos.com` (hace falta un registro de app en
// Entra con Mail.Read acotado a ese buzón). Mientras tanto entra por los XML, que es lo
// que Contabilidad ya tiene: en Outlook se seleccionan los correos, se guardan los
// adjuntos en una carpeta, y esa carpeta se suelta acá.
//
// Los XML se leen EN EL NAVEGADOR. No es un detalle de rendimiento: el comprobante
// nunca sale de la máquina de quien lo carga, y al servidor solo viaja lo extraído.
//
// Cuando exista el permiso, el ingestor va a producir estos mismos `Comprobante` y esta
// pantalla no cambia — solo deja de pedir archivos.

type Lista<T> = { n: number; filas: T[] };
type Resultado = {
  leidos: number;
  facturasBc: number;
  ventana: { desde: string; hasta: string } | null;
  calzadas: Lista<Calzada>;
  descuadradas: Lista<Calzada>;
  soloEnCorreo: Lista<Comprobante>;
  soloEnBc: Lista<FacturaBc>;
  otrasEmpresas: Lista<Comprobante>;
};

export function CruceCorreo() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [leyendo, setLeyendo] = useState(false);
  const [cruzando, setCruzando] = useState(false);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [res, setRes] = useState<Resultado | null>(null);

  async function elegir(files: FileList | null) {
    if (!files?.length) return;
    setError(""); setAviso(""); setRes(null); setLeyendo(true);
    try {
      const xmls = [...files].filter((f) => /\.xml$/i.test(f.name));
      if (!xmls.length) {
        setError("No venía ningún .xml. De cada correo hay que guardar el XML, no el PDF.");
        return;
      }

      // La clave de Hacienda es única por ley, así que sirve de llave para no contar dos
      // veces el mismo comprobante cuando el proveedor reenvía el correo.
      const porClave = new Map<string, Comprobante>();
      let descartados = 0;
      for (const f of xmls) {
        const c = leerComprobanteXml(await f.text(), f.name);
        if (!c) { descartados++; continue; }   // acuses de Hacienda y archivos que no son comprobantes
        porClave.set(c.clave, c);
      }
      const comprobantes = [...porClave.values()];
      if (!comprobantes.length) {
        setError(`Se leyeron ${xmls.length} archivos y ninguno era un comprobante. Los XML de respuesta de Hacienda no sirven: hace falta el del documento.`);
        return;
      }
      const repetidos = xmls.length - descartados - comprobantes.length;
      setAviso(
        `${num.format(comprobantes.length)} comprobantes` +
        (descartados ? ` · ${descartados} acuses de Hacienda descartados` : "") +
        (repetidos > 0 ? ` · ${repetidos} repetidos` : ""),
      );

      setLeyendo(false); setCruzando(true);
      const r = await fetch("/api/reportes/cruce-correo-bc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comprobantes }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? `Error ${r.status}`);
      setRes(j as Resultado);
    } catch (e: any) {
      setError(e?.message ?? "No se pudo leer la carpeta.");
    } finally {
      setLeyendo(false); setCruzando(false);
      if (fileRef.current) fileRef.current.value = "";   // para poder recargar la misma carpeta
    }
  }

  const ocupado = leyendo || cruzando;

  return (
    <>
      <Card className="mb-4">
        <div className="row gap-3 wrap" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
          <div style={{ maxWidth: "52ch" }}>
            <h2 className="ds-subtitle">El cruce con el correo</h2>
            <p className="ds-muted ds-body-sm" style={{ marginTop: 4 }}>
              Soltá acá los XML que llegaron al buzón de facturación y se cotejan contra las facturas de
              Business Central. En Outlook: seleccionás los correos, guardás los adjuntos en una carpeta y
              elegís esa carpeta. Los archivos no salen de tu máquina.
            </p>
          </div>
          <Button disabled={ocupado} onClick={() => fileRef.current?.click()}>
            {leyendo ? "Leyendo los XML…" : cruzando ? "Cruzando con BC…" : res ? "Cargar otra tanda" : "Elegir los XML"}
          </Button>
        </div>
        <input ref={fileRef} type="file" accept=".xml,text/xml,application/xml" multiple hidden
          aria-label="XML de los comprobantes" onChange={(e) => void elegir(e.target.files)} />

        {aviso && <p className="ds-body-sm ds-muted" style={{ marginTop: 10 }}>{aviso}</p>}
        {error && (
          <div className="ds-callout ds-callout--red mt-4">
            <span className="ds-callout__icon"><IconWarning size={18} /></span>
            <div className="ds-callout__body">{error}</div>
          </div>
        )}
      </Card>

      {res && (
        <>
          <div className="tiles mb-4">
            <Tile label="Calzan" value={String(res.calzadas.n)} accent="var(--ds-color-green-200)" />
            <Tile label="En el correo, no en BC" value={String(res.soloEnCorreo.n)}
              accent={res.soloEnCorreo.n ? "var(--ds-color-red-200)" : undefined} />
            <Tile label="En BC, sin comprobante" value={String(res.soloEnBc.n)}
              accent={res.soloEnBc.n ? "var(--ds-color-yellow)" : undefined} />
            <Tile label="No cuadra el monto" value={String(res.descuadradas.n)}
              accent={res.descuadradas.n ? "var(--ds-color-yellow)" : undefined} />
          </div>

          {res.ventana && (
            <p className="ds-body-sm ds-muted mb-4">
              Se comparan las facturas de BC entre {formatDate(res.ventana.desde)} y {formatDate(res.ventana.hasta)},
              que es el tramo que cubren los comprobantes cargados. Fuera de ahí no se puede decir que falte nada:
              solo significa que no se cargó ese correo.
            </p>
          )}

          <Bloque
            titulo="Llegaron al correo y NO están en Business Central"
            n={res.soloEnCorreo.n}
            explica="Esto es lo que hay que digitar, o averiguar por qué no se digitó. Se descartaron los comprobantes a nombre de otras empresas del grupo."
            vacio="Todo lo que llegó por correo está registrado."
          >
            <table className="ds-table">
              <thead>
                <tr><th>Emisor</th><th>Cédula</th><th>Documento</th><th>Consecutivo</th><th>Fecha</th><th className="ds-num">Monto</th></tr>
              </thead>
              <tbody>
                {res.soloEnCorreo.filas.map((c) => (
                  <tr key={c.clave}>
                    <td><span className="ds-strong ds-body-sm">{c.nombreEmisor || "—"}</span></td>
                    <td className="ds-body-sm ds-muted">{c.cedulaEmisor}</td>
                    <td className="ds-body-sm">{TIPOS[c.tipo] ?? c.tipo}</td>
                    <td className="ds-body-sm ds-muted">{c.consecutivo}</td>
                    <td className="ds-body-sm">{formatDate(c.fecha)}</td>
                    <td className="ds-num">{money(c.total, c.moneda)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Bloque>

          <Bloque
            titulo="Están en Business Central y NO llegó comprobante"
            n={res.soloEnBc.n}
            explica="Una factura de contado que trajeron en papel es normal que no tenga correo. Sirve para ver lo que se digitó sin respaldo electrónico."
            vacio="Toda factura de BC en este tramo tiene su comprobante."
            aviso={avisoDeCobertura(res)}
          >
            <table className="ds-table">
              <thead>
                <tr><th>Documento</th><th>Proveedor</th><th>N.º del proveedor</th><th>Fecha</th><th className="ds-num">Monto</th></tr>
              </thead>
              <tbody>
                {res.soloEnBc.filas.map((f) => (
                  <tr key={f.numero}>
                    <td><span className="ds-strong ds-body-sm">{f.numero}</span></td>
                    <td>{f.proveedorNombre}</td>
                    <td className="ds-body-sm ds-muted">{f.numeroProveedor || "—"}</td>
                    <td className="ds-body-sm">{formatDate(f.fecha)}</td>
                    <td className="ds-num">{money(f.total, f.moneda)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Bloque>

          <Bloque
            titulo="Calzan pero el monto no cuadra"
            n={res.descuadradas.n}
            explica="Mismo proveedor y mismo número, distinto total. No es que falte: es que se digitó otra cifra."
            vacio="Todo lo que calza, cuadra al céntimo."
          >
            <TablaCalzadas filas={res.descuadradas.filas} conDiferencia />
          </Bloque>

          <Bloque
            titulo="Calzan"
            n={res.calzadas.n}
            explica="El comprobante del correo y la factura de BC son el mismo documento. Los que dicen «por nombre» calzaron sin cédula del proveedor en BC, así que son los menos seguros."
            vacio="Ninguno calzó."
          >
            <TablaCalzadas filas={res.calzadas.filas} />
          </Bloque>

          {res.otrasEmpresas.n > 0 && (
            <Bloque
              titulo="De otras empresas del grupo"
              n={res.otrasEmpresas.n}
              explica="Llegaron al mismo buzón pero vienen a nombre de otra cédula, así que no se buscan en esta compañía."
              vacio=""
            >
              <table className="ds-table">
                <thead><tr><th>Emisor</th><th>Receptor (cédula)</th><th>Consecutivo</th><th>Fecha</th><th className="ds-num">Monto</th></tr></thead>
                <tbody>
                  {res.otrasEmpresas.filas.map((c) => (
                    <tr key={c.clave}>
                      <td className="ds-body-sm">{c.nombreEmisor || "—"}</td>
                      <td className="ds-body-sm ds-muted">{c.cedulaReceptor}</td>
                      <td className="ds-body-sm ds-muted">{c.consecutivo}</td>
                      <td className="ds-body-sm">{formatDate(c.fecha)}</td>
                      <td className="ds-num">{money(c.total, c.moneda)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Bloque>
          )}
        </>
      )}

      {!res && !ocupado && !error && (
        <EmptyState
          title="Todavía no se ha cargado ningún comprobante"
          hint="Elegí los XML del buzón y se cruzan contra Business Central."
        />
      )}
    </>
  );
}

function TablaCalzadas({ filas, conDiferencia }: { filas: Calzada[]; conDiferencia?: boolean }) {
  return (
    <table className="ds-table">
      <thead>
        <tr>
          <th>Emisor</th><th>Consecutivo</th><th>En BC</th><th>Fecha</th>
          <th className="ds-num">Monto</th>
          {conDiferencia && <th className="ds-num">Diferencia</th>}
          <th>Calzó</th>
        </tr>
      </thead>
      <tbody>
        {filas.map(({ comprobante: c, factura: f, diferencia, por }) => (
          <tr key={c.clave}>
            <td><span className="ds-strong ds-body-sm">{c.nombreEmisor || f.proveedorNombre}</span></td>
            <td className="ds-body-sm ds-muted">{c.consecutivo}</td>
            <td className="ds-body-sm"><span className="ds-strong">{f.numero}</span> <span className="ds-muted">#{f.numeroProveedor}</span></td>
            <td className="ds-body-sm">{formatDate(f.fecha)}</td>
            <td className="ds-num">{money(c.total, c.moneda)}</td>
            {conDiferencia && <td className="ds-num ds-strong">{money(diferencia, f.moneda)}</td>}
            <td className="ds-body-sm ds-muted">{por === "cedula" ? "por cédula" : "por nombre"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Bloque({ titulo, n, explica, vacio, aviso, children }: {
  titulo: string; n: number; explica: string; vacio: string; aviso?: string; children: React.ReactNode;
}) {
  return (
    <Card className="mb-4">
      <div className="row gap-2" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
        <h2 className="ds-subtitle">{titulo}</h2>
        <span className="ds-muted ds-body-sm">{n === 0 ? "nada" : n === 1 ? "1" : String(n)}</span>
      </div>
      <p className="ds-muted ds-body-sm" style={{ marginTop: 4 }}>{explica}</p>
      {aviso && (
        <div className="ds-callout ds-callout--yellow mt-3">
          <span className="ds-callout__icon"><IconWarning size={18} /></span>
          <div className="ds-callout__body">{aviso}</div>
        </div>
      )}
      {n === 0
        ? <p className="ds-body-sm" style={{ marginTop: 12 }}>{vacio}</p>
        : <div className="ds-table-wrap" style={{ boxShadow: "none", marginTop: 12 }}>{children}</div>}
    </Card>
  );
}

// "Está en BC y no llegó comprobante" solo significa algo si se cargó TODO el correo del
// tramo. Con seis XML sueltos contra un mes de facturas, la lista da 281 y es pura
// ilusión: lo que falta es el correo, no la factura. Cuando la cobertura es baja hay que
// decirlo encima de la tabla, no en una nota al pie que nadie lee.
function avisoDeCobertura(res: Resultado): string | undefined {
  const enVentana = res.calzadas.n + res.descuadradas.n + res.soloEnBc.n;
  if (!enVentana) return undefined;
  const cubiertas = res.calzadas.n + res.descuadradas.n;
  if (cubiertas / enVentana >= 0.7) return undefined;
  return `Cargaste ${num.format(res.leidos)} comprobantes y en este tramo hay ${num.format(enVentana)} facturas en BC. ` +
    `Esta lista solo sirve si cargaste TODO el correo del período — si no, lo que falta es el correo, no la factura.`;
}
