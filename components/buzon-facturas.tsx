"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, Card, EmptyState, Tile } from "@/components/ui";
import { DataTable } from "@/components/data-table";
import { IconWarning } from "@/components/icons";
import { formatDate, formatDateTime, money, num } from "@/lib/helpers";
import { TIPOS } from "@/lib/cruce-correo-bc";
import type { FacturaCorreo } from "@/lib/repo-facturas-correo";

// EL BUZÓN, EN VIVO — cada comprobante que llegó y si ya se registró en BC.
//
// El correo entra solo, la app lo coteja contra Business Central, y cada factura
// muestra si ya está registrada y CUÁNDO apareció.
//
// El cotejo se repite sobre todo lo pendiente, no solo sobre lo nuevo: una factura
// que llegó hace diez días se puede digitar hoy, y el momento en que aparece es
// justo lo que hay que detectar. Por eso "registrada" trae fecha propia y no la del
// documento en BC — de ahí sale cuánto tardó en digitarse.
//
// La tabla es el `DataTable` de la casa y no una <table> a mano: trae el buscador que
// mira TODAS las columnas —incluidas las que arrancan ocultas, como la clave de
// Hacienda y el proveedor de BC—, el selector de columnas, la exportación de lo que
// quedó filtrado y la memoria del filtro que vence sola.

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

type Filtro = "todas" | "pendiente" | "registrada" | "descuadrada";

export function BuzonFacturas() {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [cargando, setCargando] = useState(true);
  const [sincronizando, setSincronizando] = useState(false);
  const [error, setError] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todas");
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

  const filas = useMemo(() => datos?.filas ?? [], [datos]);
  const hoy = Date.now();

  const conteo = useMemo(() => ({
    pendiente: filas.filter((f) => f.estado === "pendiente").length,
    registrada: filas.filter((f) => f.estado === "registrada").length,
    descuadrada: filas.filter((f) => f.estado === "descuadrada").length,
  }), [filas]);

  const visibles = useMemo(
    () => (filtro === "todas" ? filas : filas.filter((f) => f.estado === filtro)),
    [filas, filtro],
  );

  // Cada columna aporta al buscador por su `accessorFn`: lo que se escriba se busca
  // contra TODAS, así que sirve igual un CFR-, una cédula, un consecutivo, el nombre
  // del proveedor o "sin registrar".
  const columns = useMemo<ColumnDef<FacturaCorreo, any>[]>(() => [
    {
      id: "emisor", header: "Emisor", meta: { label: "Emisor" },
      accessorFn: (f) => `${f.nombreEmisor} ${f.cedulaEmisor}`.trim(),
      cell: (c) => {
        const f = c.row.original;
        return (
          <div>
            <div className="ds-strong ds-body-sm">{f.nombreEmisor || f.cedulaEmisor}</div>
            <div className="ds-muted ds-body-sm">
              {f.cedulaEmisor}
              {f.webLink && (
                <> · <a href={f.webLink} target="_blank" rel="noopener noreferrer">ver correo</a></>
              )}
            </div>
          </div>
        );
      },
    },
    { id: "doc", header: "Documento", meta: { label: "Documento" }, accessorFn: (f) => TIPOS[f.tipoDoc] ?? f.tipoDoc, cell: (c) => <span className="ds-body-sm">{c.getValue()}</span> },
    { id: "consecutivo", header: "Consecutivo", meta: { label: "Consecutivo" }, accessorFn: (f) => f.consecutivo, cell: (c) => <span className="ds-body-sm ds-muted">{c.getValue()}</span> },
    { id: "llego", header: "Llegó", meta: { label: "Llegó", date: true }, accessorFn: (f) => f.fechaEmision, cell: (c) => <span className="ds-body-sm">{formatDate(c.getValue())}</span> },
    { id: "monto", header: "Monto", meta: { label: "Monto", num: true }, accessorFn: (f) => f.total, cell: (c) => money(c.row.original.total, c.row.original.moneda) },
    {
      // El N.º de BC, buscable y con enlace a esa factura allá.
      id: "bc", header: "N.º en BC", meta: { label: "N.º en BC" },
      accessorFn: (f) => f.bcNumero ?? "",
      cell: (c) => {
        const f = c.row.original;
        if (!f.bcNumero) return <span className="ds-muted">—</span>;
        return f.bcUrl
          ? <a href={f.bcUrl} target="_blank" rel="noopener noreferrer" className="ds-strong ds-body-sm">{f.bcNumero}</a>
          : <span className="ds-strong ds-body-sm">{f.bcNumero}</span>;
      },
    },
    {
      id: "estado", header: "Estado", meta: { label: "Estado" },
      accessorFn: (f) => etiquetaEstado(f),
      cell: (c) => <Estado f={c.row.original} hoy={hoy} />,
    },
    // Arrancan ocultas: existen para BUSCAR, no para llenar la pantalla.
    { id: "proveedorBc", header: "Proveedor en BC", meta: { label: "Proveedor en BC" }, accessorFn: (f) => f.bcProveedor ?? "", cell: (c) => <span className="ds-body-sm ds-muted">{c.getValue() || "—"}</span> },
    { id: "clave", header: "Clave de Hacienda", meta: { label: "Clave de Hacienda" }, accessorFn: (f) => f.clave, cell: (c) => <span className="ds-body-sm ds-muted">{c.getValue()}</span> },
  ], [hoy]);

  if (cargando && !datos) return <Card className="mb-4"><p className="ds-muted">Leyendo…</p></Card>;

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

  return (
    <>
      {buzon && !buzon.listo && (
        <Falta titulo="La app todavía no puede leer el buzón sola" que={buzon.falta} como={buzon.comoSeArregla} />
      )}

      <Card className="mb-4">
        <div className="row gap-3 wrap" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <span className="ds-strong">{buzon?.listo ? buzon.buzon : "Buzón sin conectar"}</span>
            <span className="ds-muted ds-body-sm">
              {" · "}
              {datos?.sync?.ultimaCorrida ? `última revisión ${formatDateTime(datos.sync.ultimaCorrida)}` : "sin revisar todavía"}
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
        // Los recuadros son además el filtro: tocar "Sin registrar" deja solo esas.
        // Es el mismo gesto que los chips del resto de la app.
        <div className="tiles mb-4">
          <Tile label="Sin registrar" value={String(conteo.pendiente)}
            accent={conteo.pendiente ? "var(--ds-color-red-200)" : undefined}
            active={filtro === "pendiente"}
            onClick={() => setFiltro(filtro === "pendiente" ? "todas" : "pendiente")} />
          <Tile label="Ya registradas" value={String(conteo.registrada)} accent="var(--ds-color-green-200)"
            active={filtro === "registrada"}
            onClick={() => setFiltro(filtro === "registrada" ? "todas" : "registrada")} />
          <Tile label="No cuadra el monto" value={String(conteo.descuadrada)}
            accent={conteo.descuadrada ? "var(--ds-color-yellow)" : undefined}
            active={filtro === "descuadrada"}
            onClick={() => setFiltro(filtro === "descuadrada" ? "todas" : "descuadrada")} />
          <Tile label="Comprobantes" value={num.format(filas.length)}
            active={filtro === "todas"}
            onClick={() => setFiltro("todas")} />
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
            Últimos 60 días. Buscá por lo que sea: proveedor, cédula, consecutivo, N.º de BC o estado. Los días
            al lado de «Registrada» son lo que tardó en digitarse desde que llegó el correo.
          </p>
          <div style={{ marginTop: 12 }}>
            <DataTable
              data={visibles}
              columns={columns}
              tablaKey="auditoria-buzon"
              titulo="Auditoría de facturas"
              buscarPlaceholder="Buscar por proveedor, cédula, consecutivo, N.º de BC…"
              getRowId={(f) => f.clave}
              columnVisibilityInicial={{ proveedorBc: false, clave: false }}
              vacio="Ningún comprobante coincide con la búsqueda."
            />
          </div>
        </Card>
      )}
    </>
  );
}

// Lo que ve el buscador de cada fila en la columna Estado. Va aparte del render
// porque el texto que se busca y el que se dibuja no son el mismo: en pantalla el
// estado se lee en dos renglones, y buscar "registrada CFR-010077" tiene que calzar.
const etiquetaEstado = (f: FacturaCorreo): string => {
  if (f.estado === "registrada") return `Registrada ${f.bcNumero ?? ""}`;
  if (f.estado === "descuadrada") return `Registrada no cuadra ${f.bcNumero ?? ""}`;
  if (f.estado === "otra_empresa") return "De otra empresa del grupo";
  if (f.estado === "no_aplica") return `No aplica ${f.nota ?? ""}`;
  return "Sin registrar";
};

function Estado({ f, hoy }: { f: FacturaCorreo; hoy: number }) {
  if (f.estado === "registrada" || f.estado === "descuadrada") {
    const tardo = dias(f.fechaEmision, f.fechaRegistro);
    return (
      <div className="ds-body-sm">
        <span className="ds-strong">{f.estado === "registrada" ? "Registrada" : "No cuadra"}</span>
        <div className="ds-muted">
          {f.fechaRegistro ? `se vio el ${formatDate(f.fechaRegistro.slice(0, 10))}` : ""}
          {tardo != null ? ` · tardó ${tardo} ${tardo === 1 ? "día" : "días"}` : ""}
        </div>
        {f.estado === "descuadrada" && f.bcTotal != null && (
          <div className="ds-muted">en BC: {money(f.bcTotal, f.moneda)}</div>
        )}
      </div>
    );
  }
  if (f.estado === "otra_empresa") return <span className="ds-muted ds-body-sm">De otra empresa</span>;
  if (f.estado === "no_aplica") return <span className="ds-muted ds-body-sm">No aplica{f.nota ? ` — ${f.nota}` : ""}</span>;

  const esperando = f.fechaEmision
    ? Math.max(0, Math.round((hoy - Date.parse(f.fechaEmision)) / 86_400_000))
    : null;
  return (
    <div className="ds-body-sm">
      <span className="ds-strong">Sin registrar</span>
      {esperando != null && (
        <div className="ds-muted">{esperando} {esperando === 1 ? "día" : "días"} esperando</div>
      )}
    </div>
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
