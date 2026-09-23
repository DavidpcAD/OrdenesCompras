"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Card, EmptyState, Tile } from "@/components/ui";
import { IconWarning } from "@/components/icons";
import { formatDate, formatDateTime, money, num } from "@/lib/helpers";
import { TIPOS } from "@/lib/cruce-correo-bc";
import type { FacturaCorreo } from "@/lib/repo-facturas-correo";

// EL BUZÓN, EN VIVO — cada comprobante que llegó y si ya se registró en BC.
//
// Esto es lo que pidió David: que no haya que cargar nada. El correo entra solo, la
// app lo coteja contra Business Central, y cada factura muestra si ya está registrada
// y CUÁNDO apareció.
//
// El cotejo se repite sobre todo lo pendiente, no solo sobre lo nuevo: una factura
// que llegó hace diez días se puede digitar hoy, y el momento en que aparece es
// justo lo que hay que detectar. Por eso "registrada" trae fecha propia y no la del
// documento en BC — de ahí sale cuánto tardó en digitarse.
//
// La pantalla se refresca sola mientras está abierta. No es un lujo: el sentido de
// esto es que Contabilidad la deje puesta y vea entrar las facturas.

type Sync = {
  marcador: string | null; ultimaCorrida: string | null;
  ultimoError: string | null; leidos: number | null; nuevos: number | null;
};
type EstadoBuzon = { listo: true; buzon: string } | { listo: false; falta: string; comoSeArregla: string };
type Datos = {
  hayTabla: boolean; error?: string; desde?: string;
  buzon: EstadoBuzon; sync: Sync | null; filas: FacturaCorreo[];
};

const CADA_MS = 3 * 60 * 1000;   // el buzón recibe ~45 correos al día; cada 3 min sobra

export function BuzonFacturas() {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [cargando, setCargando] = useState(true);
  const [sincronizando, setSincronizando] = useState(false);
  const [error, setError] = useState("");
  const vivo = useRef(true);

  const cargar = useCallback(async (): Promise<Datos | null> => {
    try {
      const r = await fetch("/api/vigilancia/facturas", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? `Error ${r.status}`);
      if (vivo.current) setDatos(j as Datos);
      return j as Datos;
    } catch (e: any) {
      if (vivo.current) setError(e?.message ?? "No se pudo leer la lista.");
      return null;
    } finally {
      if (vivo.current) setCargando(false);
    }
  }, []);

  const sincronizar = useCallback(async () => {
    setSincronizando(true);
    setError("");
    try {
      // La sincronización puede tardar (lee el buzón y todas las facturas de BC), así
      // que la lista se recarga después, no en paralelo: si no, se pinta la foto vieja.
      const r = await fetch("/api/vigilancia/sincronizar", { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok && j?.error) setError(j.error);
      else if (j?.correo?.error) setError(j.correo.error);
      else if (j?.cotejo?.error) setError(j.cotejo.error);
      await cargar();
    } catch (e: any) {
      setError(e?.message ?? "No se pudo sincronizar.");
    } finally {
      if (vivo.current) setSincronizando(false);
    }
  }, [cargar]);

  useEffect(() => {
    vivo.current = true;
    let t: ReturnType<typeof setInterval> | null = null;
    void (async () => {
      const d = await cargar();
      // Sin la tabla no hay nada que sincronizar y el reloj solo serviría para llenar
      // la consola de 503 cada tres minutos.
      if (!d?.hayTabla || !vivo.current) return;
      await sincronizar();
      t = setInterval(() => { void sincronizar(); }, CADA_MS);
    })();
    return () => { vivo.current = false; if (t) clearInterval(t); };
  }, [cargar, sincronizar]);

  if (cargando && !datos) return <Card className="mb-4"><p className="ds-muted">Leyendo…</p></Card>;

  // --- lo que impide que esto funcione, dicho en cristiano ---
  if (datos && !datos.hayTabla) {
    return (
      <Falta
        titulo="Falta crear la tabla en la base"
        que={datos.error ?? ""}
        como="Corré sql/factura_correo.sql en AdelantePRO. Es idempotente: se puede correr dos veces sin romper nada."
      />
    );
  }

  const buzon = datos?.buzon;
  const filas = datos?.filas ?? [];

  const pendientes = filas.filter((f) => f.estado === "pendiente");
  const registradas = filas.filter((f) => f.estado === "registrada");
  const descuadradas = filas.filter((f) => f.estado === "descuadrada");
  const hoy = Date.now();

  return (
    <>
      {buzon && !buzon.listo && (
        <Falta
          titulo="La app todavía no puede leer el buzón sola"
          que={buzon.falta}
          como={buzon.comoSeArregla}
        />
      )}

      <Card className="mb-4">
        <div className="row gap-3 wrap" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <span className="ds-strong">
              {buzon?.listo ? buzon.buzon : "Buzón sin conectar"}
            </span>
            <span className="ds-muted ds-body-sm">
              {" · "}
              {datos?.sync?.ultimaCorrida
                ? `última revisión ${formatDateTime(datos.sync.ultimaCorrida)}`
                : "sin revisar todavía"}
              {datos?.sync?.nuevos ? ` · ${datos.sync.nuevos} nuevos la última vez` : ""}
            </span>
          </div>
          <Button variant="outline" disabled={sincronizando} onClick={() => void sincronizar()}>
            {sincronizando ? "Revisando…" : "Revisar ahora"}
          </Button>
        </div>
        {error && (
          <div className="ds-callout ds-callout--red mt-4">
            <span className="ds-callout__icon"><IconWarning size={18} /></span>
            <div className="ds-callout__body">{error}</div>
          </div>
        )}
      </Card>

      {!!filas.length && (
        <div className="tiles mb-4">
          <Tile label="Sin registrar" value={String(pendientes.length)}
            accent={pendientes.length ? "var(--ds-color-red-200)" : undefined} />
          <Tile label="Ya registradas" value={String(registradas.length)} accent="var(--ds-color-green-200)" />
          <Tile label="No cuadra el monto" value={String(descuadradas.length)}
            accent={descuadradas.length ? "var(--ds-color-yellow)" : undefined} />
          <Tile label="Comprobantes" value={num.format(filas.length)} />
        </div>
      )}

      {!filas.length && (
        <EmptyState
          title="Todavía no ha entrado ningún comprobante"
          hint={buzon?.listo
            ? "Cuando llegue una factura al buzón va a aparecer acá sola."
            : "Falta conectar el buzón para que los comprobantes entren solos."}
        />
      )}

      {!!filas.length && (
        <Card className="mb-4">
          <h2 className="ds-subtitle">Lo que llegó al buzón</h2>
          <p className="ds-muted ds-body-sm" style={{ marginTop: 4 }}>
            Últimos 60 días. Cada comprobante con su estado en Business Central. Los días que aparecen al lado de
            «Registrada» son lo que tardó en digitarse desde que llegó el correo.
          </p>
          <div className="ds-table-wrap" style={{ boxShadow: "none", marginTop: 12 }}>
            <table className="ds-table">
              <thead>
                <tr>
                  <th>Emisor</th><th>Documento</th><th>Consecutivo</th>
                  <th>Llegó</th><th className="ds-num">Monto</th><th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={f.clave}>
                    <td>
                      <span className="ds-strong ds-body-sm">{f.nombreEmisor || f.cedulaEmisor}</span>
                      {f.webLink && (
                        <>
                          {" "}
                          <a href={f.webLink} target="_blank" rel="noreferrer" className="ds-body-sm">ver correo</a>
                        </>
                      )}
                    </td>
                    <td className="ds-body-sm">{TIPOS[f.tipoDoc] ?? f.tipoDoc}</td>
                    <td className="ds-body-sm ds-muted">{f.consecutivo}</td>
                    <td className="ds-body-sm">{formatDate(f.fechaEmision)}</td>
                    <td className="ds-num">{money(f.total, f.moneda)}</td>
                    <td className="ds-body-sm"><Estado f={f} hoy={hoy} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}

function Estado({ f, hoy }: { f: FacturaCorreo; hoy: number }) {
  if (f.estado === "registrada" || f.estado === "descuadrada") {
    const tardo = dias(f.fechaEmision, f.fechaRegistro);
    return (
      <>
        <span className="ds-strong">
          {f.estado === "registrada" ? "Registrada" : "Registrada, no cuadra"}
        </span>{" "}
        {/* El N.º de BC abre ESA factura allá. Es el gesto que ya existe en Recibidas y
            en la columna Factura BC de Órdenes, y es lo primero que uno quiere hacer
            cuando ve una fila que no cuadra: ir a mirarla. */}
        {f.bcUrl
          ? <a href={f.bcUrl} target="_blank" rel="noopener noreferrer" className="ds-strong">{f.bcNumero}</a>
          : <span className="ds-muted">{f.bcNumero}</span>}
        <span className="ds-muted">
          {f.fechaRegistro ? ` · se vio el ${formatDate(f.fechaRegistro.slice(0, 10))}` : ""}
          {tardo != null ? ` · tardó ${tardo} ${tardo === 1 ? "día" : "días"}` : ""}
        </span>
        {f.estado === "descuadrada" && f.bcTotal != null && (
          <div className="ds-muted">en BC: {money(f.bcTotal, f.moneda)}</div>
        )}
      </>
    );
  }
  if (f.estado === "otra_empresa") return <span className="ds-muted">De otra empresa del grupo</span>;
  if (f.estado === "no_aplica") return <span className="ds-muted">No aplica{f.nota ? ` — ${f.nota}` : ""}</span>;

  const esperando = f.fechaEmision
    ? Math.max(0, Math.round((hoy - Date.parse(f.fechaEmision)) / 86_400_000))
    : null;
  return (
    <>
      <span className="ds-strong">Sin registrar</span>{" "}
      <span className="ds-muted">
        {esperando != null ? `${esperando} ${esperando === 1 ? "día" : "días"} esperando` : ""}
      </span>
    </>
  );
}

function dias(desde: string, hasta: string | null): number | null {
  if (!desde || !hasta) return null;
  const a = Date.parse(desde), b = Date.parse(hasta);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

// Un bloqueo que depende de otra persona no se dice con un error rojo y ya: se dice
// qué falta y qué hay que hacer, porque quien lo lee es el que lo puede resolver.
function Falta({ titulo, que, como }: { titulo: string; que: string; como: string }) {
  return (
    <Card className="mb-4">
      <div className="row gap-2" style={{ alignItems: "flex-start" }}>
        <span className="ds-callout__icon"><IconWarning size={18} /></span>
        <div>
          <h2 className="ds-subtitle">{titulo}</h2>
          <p className="ds-body-sm" style={{ marginTop: 4 }}>{que}</p>
          <p className="ds-muted ds-body-sm" style={{ marginTop: 6 }}>{como}</p>
        </div>
      </div>
    </Card>
  );
}
