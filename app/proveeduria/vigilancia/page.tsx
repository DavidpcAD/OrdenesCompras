"use client";

import { useState } from "react";
import { Button, Card, EmptyState, Tile } from "@/components/ui";
import { IconWarning } from "@/components/icons";
import { formatDate, money, num } from "@/lib/helpers";
import { totalPorMoneda } from "@/lib/vigilancia-facturas";
import { BuzonFacturas } from "@/components/buzon-facturas";
import type {
  FacturaBc, ParDoble, ProveedorCallado, ProveedorSinCedula, FichaDuplicada,
} from "@/lib/vigilancia-facturas";

// VIGILANCIA DE FACTURAS — lo que se puede vigilar hoy, sin leer el correo.
//
// Para qué existe: al buzón de facturación entran ~1.300 correos al mes y a BC se
// registran ~1.000 facturas, y hasta el 22 de setiembre de 2026 nadie tenía forma de
// ver cuál de las dos cifras le faltaba a la otra. La vigilancia completa —qué
// comprobante llegó al correo y no está en BC— necesita leer los XML adjuntos, y eso
// necesita un registro de app en Entra que todavía no existe.
//
// Mientras tanto, esta pantalla contesta las tres preguntas que BC sí puede contestar
// solo. No son un consuelo: en la primera corrida encontraron 31 facturas en borrador
// por ₡7,5 millones —la más vieja de noviembre de 2025— y 13 pares con pinta de doble
// registro por ₡9,2 millones.
//
// Las listas dicen "posible" y "revisar" a propósito. Un detector que afirma de más se
// deja de leer a la segunda vez que se equivoca; la regla de los dobles se apretó justo
// por eso (ver el comentario de lib/vigilancia-facturas.ts).

type Datos = {
  desde: string; hoy: string; revisadas: number; proveedores: number;
  borradores: { n: number; montoCRC: number; filas: FacturaBc[] };
  dobles: { n: number; montoCRC: number; filas: ParDoble[] };
  callados: { n: number; filas: ProveedorCallado[] };
  sinCedula: { n: number; facturasAfectadas: number; filas: ProveedorSinCedula[] };
  duplicadas: { n: number; filas: FichaDuplicada[] };
};

type Vista = "buzon" | "bc";

export default function VigilanciaPage() {
  // "Buzón" es la vista de verdad: el correo entra solo y cada factura dice si ya se
  // registró. "Señales de BC" son las alertas que no necesitan el correo.
  //
  // Hubo una tercera, "Cargar XML", para cotejar una tanda de archivos a mano. Existió
  // mientras la app no tenía permiso para leer el buzón; con el buzón conectado ya no
  // tiene sentido pedirle a nadie que guarde adjuntos en una carpeta. El MOTOR de ese
  // cruce (lib/cruce-correo-bc.ts) se quedó: es el mismo que usa la sincronización.
  const [vista, setVista] = useState<Vista>("buzon");
  const [datos, setDatos] = useState<Datos | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");

  async function revisar() {
    setCargando(true);
    setError("");
    try {
      const r = await fetch("/api/reportes/vigilancia-facturas", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? `Error ${r.status}`);
      setDatos(j as Datos);
    } catch (e: any) {
      setError(e?.message ?? "No se pudo revisar.");
    } finally {
      setCargando(false);
    }
  }

  return (
    <main className="page page--wide">
      <div className="page__head">
        <div className="page__title">
          <h1 className="ds-heading">Auditoría de facturas</h1>
          <p className="ds-muted">
            Lo que llegó al buzón de facturación contra lo que se registró en Business Central — y lo que BC
            delata solo: facturas en borrador, facturas cobradas dos veces y proveedores que se callaron.
          </p>
        </div>
      </div>

      <div className="row gap-2 mb-4">
        <div className="segmented" role="tablist" aria-label="Ver">
          <button type="button" role="tab" aria-selected={vista === "buzon"}
            className={`segmented__btn ${vista === "buzon" ? "is-active" : ""}`}
            onClick={() => setVista("buzon")}>Buzón</button>
          <button type="button" role="tab" aria-selected={vista === "bc"}
            className={`segmented__btn ${vista === "bc" ? "is-active" : ""}`}
            onClick={() => setVista("bc")}>Señales de BC</button>
        </div>
      </div>

      {vista === "buzon" && <BuzonFacturas />}

      {vista === "bc" && (<>
      <Card className="mb-4">
        <div className="row gap-3 wrap" style={{ alignItems: "center" }}>
          <Button onClick={() => void revisar()} disabled={cargando}>
            {cargando ? "Revisando…" : datos ? "Volver a revisar" : "Revisar"}
          </Button>
          <span className="ds-body-sm ds-muted">
            {datos
              ? `${num.format(datos.revisadas)} facturas y ${num.format(datos.proveedores)} proveedores, desde ${formatDate(datos.desde)}.`
              : "Lee todas las facturas de compra de BC desde noviembre de 2025. Tarda unos segundos."}
          </span>
        </div>
        {error && (
          <div className="ds-callout ds-callout--red mt-4">
            <span className="ds-callout__icon"><IconWarning size={18} /></span>
            <div className="ds-callout__body">{error}</div>
          </div>
        )}
      </Card>

      {datos && (
        <>
          <div className="tiles mb-4">
            <Tile label="En borrador" value={String(datos.borradores.n)}
              accent={datos.borradores.n ? "var(--ds-color-red-200)" : undefined} />
            <Tile label="Sin registrar" value={money(datos.borradores.montoCRC)}
              accent={datos.borradores.montoCRC > 0 ? "var(--ds-color-red-200)" : undefined} />
            <Tile label="Posibles dobles" value={String(datos.dobles.n)}
              accent={datos.dobles.n ? "var(--ds-color-yellow)" : undefined} />
            <Tile label="Proveedores callados" value={String(datos.callados.n)}
              accent={datos.callados.n ? "var(--ds-color-yellow)" : undefined} />
          </div>

          <Seccion
            titulo="Facturas en borrador"
            n={datos.borradores.n}
            explica="Existen en BC pero nunca se registraron, así que no están en la contabilidad. De la más vieja a la más nueva: una de ayer puede estar en trámite, una del año pasado se le olvidó a alguien."
            vacio="Ninguna factura quedó a medias."
            // El total del recuadro suma SOLO colones, porque mezclar monedas daría un
            // número que no significa nada. Si hay borradores en otra moneda hay que
            // decirlo: un total que se come una factura en silencio es peor que no darlo.
            nota={notaOtrasMonedas(datos.borradores.filas)}
          >
            <table className="ds-table">
              <thead>
                <tr>
                  <th>Documento</th><th>Proveedor</th><th>N.º del proveedor</th>
                  <th>Fecha</th><th className="ds-num">Monto</th>
                </tr>
              </thead>
              <tbody>
                {datos.borradores.filas.map((f) => (
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
          </Seccion>

          <Seccion
            titulo="Posibles dobles registros"
            n={datos.dobles.n}
            explica="Mismo proveedor, mismo monto exacto y un número que es el otro con un sufijo — casi siempre «-1», que es lo que se teclea cuando BC no deja repetir el número. Pueden ser legítimas: dos entregas contra la misma factura. Hay que verlas."
            vacio="Ninguna factura se registró dos veces con el mismo número."
          >
            <table className="ds-table">
              <thead>
                <tr>
                  <th>Proveedor</th><th>Primera</th><th>Segunda</th>
                  <th className="ds-num">Días</th><th className="ds-num">Monto</th>
                </tr>
              </thead>
              <tbody>
                {datos.dobles.filas.map((p) => (
                  <tr key={`${p.a.numero}-${p.b.numero}`}>
                    <td>{p.a.proveedorNombre}</td>
                    <td className="ds-body-sm">
                      <span className="ds-strong">{p.a.numero}</span>{" "}
                      <span className="ds-muted">#{p.a.numeroProveedor} · {formatDate(p.a.fecha)}</span>
                    </td>
                    <td className="ds-body-sm">
                      <span className="ds-strong">{p.b.numero}</span>{" "}
                      <span className="ds-muted">#{p.b.numeroProveedor} · {formatDate(p.b.fecha)}</span>
                    </td>
                    <td className="ds-num">{p.dias}</td>
                    <td className="ds-num">{money(p.a.total, p.a.moneda)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Seccion>

          <Seccion
            titulo="Proveedores que se callaron"
            n={datos.callados.n}
            explica="Venían facturando con un ritmo y llevan más de cuatro veces ese ritmo sin aparecer en BC. O dejaron de venderles, o hay facturas suyas sin registrar. Las dos respuestas interesan."
            vacio="Todos los proveedores frecuentes siguen apareciendo."
          >
            <table className="ds-table">
              <thead>
                <tr>
                  <th>Proveedor</th><th className="ds-num">Facturas</th><th>Ritmo</th>
                  <th>Última factura</th><th className="ds-num">Días callado</th>
                </tr>
              </thead>
              <tbody>
                {datos.callados.filas.map((p) => (
                  <tr key={p.codigo}>
                    <td>
                      <span className="ds-strong ds-body-sm">{p.nombre}</span>{" "}
                      <span className="ds-muted ds-body-sm">{p.codigo}</span>
                    </td>
                    <td className="ds-num">{p.facturas}</td>
                    <td className="ds-body-sm ds-muted">cada ~{p.ritmoDias} {p.ritmoDias === 1 ? "día" : "días"}</td>
                    <td className="ds-body-sm">{formatDate(p.ultima)}</td>
                    <td className="ds-num ds-strong">{p.diasCallado}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Seccion>

          <Seccion
            titulo="Proveedores sin cédula"
            n={datos.sinCedula.n}
            explica={`La cédula del emisor viaja dentro de la clave de todo comprobante electrónico, así que es la única llave que va a cruzar el correo con BC sin adivinar. Hoy ${num.format(datos.sinCedula.facturasAfectadas)} facturas quedan sin esa llave. Está concentrado: arreglando las primeras fichas se cubre la mayor parte.`}
            vacio="Todos los proveedores con facturas tienen cédula."
          >
            <table className="ds-table">
              <thead>
                <tr><th>Proveedor</th><th>Código</th><th className="ds-num">Facturas</th></tr>
              </thead>
              <tbody>
                {datos.sinCedula.filas.slice(0, 40).map((p) => (
                  <tr key={p.codigo}>
                    <td><span className="ds-strong ds-body-sm">{p.nombre}</span></td>
                    <td className="ds-body-sm ds-muted">{p.codigo}</td>
                    <td className="ds-num">{p.facturas}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {datos.sinCedula.filas.length > 40 && (
              <p className="ds-body-sm ds-muted" style={{ marginTop: 8 }}>
                Se muestran los 40 que más facturas mueven, de {datos.sinCedula.filas.length}.
              </p>
            )}
          </Seccion>

          <Seccion
            titulo="Fichas de proveedor duplicadas"
            n={datos.duplicadas.n}
            explica="Dos fichas con la misma cédula. Parten el historial de compras en dos y rompen el cruce por cédula. Si una está en cero, es borrarla; si las dos tienen facturas, hay que mover movimientos."
            vacio="Ninguna cédula está repetida."
          >
            <table className="ds-table">
              <thead>
                <tr><th>Cédula</th><th>Fichas</th></tr>
              </thead>
              <tbody>
                {datos.duplicadas.filas.map((d) => (
                  <tr key={d.cedula}>
                    <td className="ds-body-sm ds-strong">{d.cedula}</td>
                    <td className="ds-body-sm">
                      {d.fichas.map((f, i) => (
                        <span key={f.codigo}>
                          {i > 0 && <span className="ds-muted"> · </span>}
                          <span className="ds-strong">{f.codigo}</span> {f.nombre}{" "}
                          <span className="ds-muted">({f.facturas} {f.facturas === 1 ? "factura" : "facturas"})</span>
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Seccion>
        </>
      )}

      {!datos && !cargando && !error && (
        <EmptyState
          title="Todavía no se ha revisado"
          hint="Dale a Revisar y se leen todas las facturas de compra de Business Central."
        />
      )}
      </>)}
    </main>
  );
}

// Cada señal es una tarjeta con su título, su conteo y —esto importa— una línea que
// explica qué significa y qué tan segura es. Una lista de números sin eso se lee como
// una acusación, y la mitad de estas filas piden criterio, no corrección.
function Seccion({ titulo, n, explica, vacio, nota, children }: {
  titulo: string; n: number; explica: string; vacio: string; nota?: string; children: React.ReactNode;
}) {
  return (
    <Card className="mb-4">
      <div className="row gap-2" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
        <h2 className="ds-subtitle">{titulo}</h2>
        <span className="ds-muted ds-body-sm">{n === 0 ? "nada" : n === 1 ? "1 caso" : `${n} casos`}</span>
      </div>
      <p className="ds-muted ds-body-sm" style={{ marginTop: 4 }}>{explica}</p>
      {n === 0
        ? <p className="ds-body-sm" style={{ marginTop: 12 }}>{vacio}</p>
        : <div className="ds-table-wrap" style={{ boxShadow: "none", marginTop: 12 }}>{children}</div>}
      {n > 0 && nota && <p className="ds-body-sm ds-muted" style={{ marginTop: 8 }}>{nota}</p>}
    </Card>
  );
}

// El recuadro "Sin registrar" suma colones y nada más. Si quedaron borradores en otra
// moneda, esta línea los nombra debajo de la tabla en vez de dejar que el total se los
// coma callado: entre los 31 borradores hay uno en dólares.
function notaOtrasMonedas(filas: FacturaBc[]): string | undefined {
  const { otras } = totalPorMoneda(filas);
  if (!otras.length) return undefined;
  const cuantas = otras.reduce((s, o) => s + o.n, 0);
  const detalle = otras.map((o) => money(o.total, o.moneda)).join(" · ");
  return `El total de arriba son solo colones. Aparte hay ${cuantas === 1 ? "una factura" : `${cuantas} facturas`} en otra moneda: ${detalle}.`;
}
