"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, Card, Checkbox, EmptyState, Field, ProgressBar, Tile } from "@/components/ui";
import { DataTable } from "@/components/data-table";
import { CampoRangoFechas } from "@/components/calendario-rango";
import type { Rango } from "@/lib/fechas";
import { IconWarning } from "@/components/icons";
import { FacturaCotejo } from "@/components/factura-cotejo";
import { formatDate, formatDateTime, money, num, todayISO as hoyISO } from "@/lib/helpers";
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

type Filtro = "todas" | "pendiente" | "registrada" | "descuadrada" | "porRevisar";

// Qué está pasando, en palabras. Un porcentaje sin decir de qué no informa nada.
const FASES: Record<string, string> = {
  correo: "Leyendo el buzón y abriendo los adjuntos…",
  guardando: "Guardando lo que llegó…",
  anotando: "Anotando lo que se encontró…",
  bc: "Bajando las facturas de Business Central…",
  cotejo: "Cotejando contra Business Central…",
};

export function BuzonFacturas() {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [cargando, setCargando] = useState(true);
  const [sincronizando, setSincronizando] = useState(false);
  const [avance, setAvance] = useState<{ fase: string; hechos: number; total: number } | null>(null);
  const [error, setError] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todas");
  // El rango de fechas viaja al servidor, no se filtra acá: así se puede ir más atrás
  // de los 60 días que trae por defecto sin cargar toda la tabla en cada visita.
  const [rango, setRango] = useState<Rango>({});
  // El rango se lee por ref para que `cargar` no cambie de identidad con cada fecha
  // elegida: si cambiara, el efecto de montaje se volvería a correr y con él la
  // sincronización completa y un reloj nuevo cada vez que alguien toca el calendario.
  const rangoRef = useRef(rango);
  rangoRef.current = rango;
  // Las palomitas se pintan de inmediato y se guardan de fondo: ir bajando una lista
  // de 400 esperando al servidor en cada clic sería insoportable. Si el guardado
  // falla, la fila vuelve sola a como estaba y se avisa.
  const [revisadas, setRevisadas] = useState<Record<string, boolean>>({});
  // La factura que se abrió para verle las líneas. Se guarda la CLAVE y no la fila:
  // el bootstrap recarga la lista cada pocos minutos y una fila vieja dejaría el
  // diálogo mostrando el estado de antes justo mientras alguien la está mirando.
  const [abierta, setAbierta] = useState<string | null>(null);
  const vivo = useRef(true);

  const cargar = useCallback(async (): Promise<Datos | null> => {
    try {
      const { from, to } = rangoRef.current;
      const q = new URLSearchParams();
      if (from) q.set("desde", from);
      if (to) q.set("hasta", to);
      const cola = q.toString();
      const r = await fetch(`/api/vigilancia/facturas${cola ? `?${cola}` : ""}`, { cache: "no-store" });
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
    setAvance(null);
    try {
      const r = await fetch("/api/vigilancia/sincronizar", { method: "POST" });

      // La respuesta viene en chorro: una línea JSON por avance y la última con el
      // resultado. Si el navegador o un proxy no dan el cuerpo por partes, igual se
      // lee entero al final y el resultado llega: se pierde el avance, no el dato.
      let fin: any = null;
      if (r.body) {
        const lector = r.body.getReader();
        const dec = new TextDecoder();
        let resto = "";
        for (;;) {
          const { value, done } = await lector.read();
          if (done) break;
          resto += dec.decode(value, { stream: true });
          const lineas = resto.split("\n");
          resto = lineas.pop() ?? "";
          for (const l of lineas) {
            if (!l.trim()) continue;
            let o: any; try { o = JSON.parse(l); } catch { continue; }
            if (o.fin) fin = o;
            else if (vivo.current) setAvance({ fase: o.fase, hechos: o.hechos ?? 0, total: o.total ?? 0 });
          }
        }
        if (resto.trim()) { try { fin = JSON.parse(resto); } catch { /* cola incompleta */ } }
      } else {
        fin = await r.json().catch(() => null);
      }

      if (!r.ok && fin?.error) setError(fin.error);
      else if (fin?.correo?.error) setError(fin.correo.error);
      else if (fin?.cotejo?.error) setError(fin.cotejo.error);
      await cargar();
    } catch (e: any) {
      setError(e?.message ?? "No se pudo sincronizar.");
    } finally {
      if (vivo.current) { setSincronizando(false); setAvance(null); }
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

  // Cambiar el rango solo recarga la lista: no hay que volver a leer el buzón ni a
  // cotejar contra BC para mirar otro mes.
  const primera = useRef(true);
  useEffect(() => {
    if (primera.current) { primera.current = false; return; }
    void cargar();
  }, [rango.from, rango.to, cargar]);

  const crudas = useMemo(() => datos?.filas ?? [], [datos]);
  // Lo que el usuario acaba de palomear manda sobre lo que trajo el servidor, hasta
  // que la siguiente carga lo confirme.
  const filas = useMemo(
    () => crudas.map((f) => (f.clave in revisadas ? { ...f, revisada: revisadas[f.clave] } : f)),
    [crudas, revisadas],
  );
  const hoy = Date.now();

  const palomear = useCallback(async (clave: string, revisada: boolean) => {
    setRevisadas((r) => ({ ...r, [clave]: revisada }));
    try {
      const res = await fetch("/api/vigilancia/facturas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clave, revisada }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? `Error ${res.status}`);
    } catch (e: any) {
      setRevisadas((r) => { const n = { ...r }; delete n[clave]; return n; });
      setError(e?.message ?? "No se pudo guardar la marca de revisada.");
    }
  }, []);

  const conteo = useMemo(() => ({
    pendiente: filas.filter((f) => f.estado === "pendiente").length,
    registrada: filas.filter((f) => f.estado === "registrada").length,
    descuadrada: filas.filter((f) => f.estado === "descuadrada").length,
    porRevisar: filas.filter((f) => !f.revisada).length,
  }), [filas]);

  // La base del porcentaje: solo lo que de verdad le tocaba a esta compañía.
  const base = conteo.registrada + conteo.descuadrada + conteo.pendiente;
  const pctEnBc = base ? Math.round(((conteo.registrada + conteo.descuadrada) / base) * 100) : 0;

  const visibles = useMemo(() => {
    if (filtro === "todas") return filas;
    if (filtro === "porRevisar") return filas.filter((f) => !f.revisada);
    return filas.filter((f) => f.estado === filtro);
  }, [filas, filtro]);

  // Cada columna aporta al buscador por su `accessorFn`: lo que se escriba se busca
  // contra TODAS, así que sirve igual un CFR-, una cédula, un consecutivo, el nombre
  // del proveedor o "sin registrar".
  const columns = useMemo<ColumnDef<FacturaCorreo, any>[]>(() => [
    {
      // La palomita de "ya la vi". Va primera porque el gesto es ir bajando la lista
      // marcando. El buscador la encuentra por "revisada" / "sin revisar".
      id: "revisada", header: "✓", meta: { label: "Revisada" },
      accessorFn: (f) => (f.revisada ? "revisada" : "sin revisar"),
      enableSorting: true,
      cell: (c) => {
        const f = c.row.original;
        return (
          // El clic se para acá: la fila entera abre el cotejo, y palomear no es abrir.
          <span onClick={(e) => e.stopPropagation()}>
            <Checkbox
              checked={f.revisada}
              aria-label={`Marcar ${f.consecutivo} como revisada`}
              title={f.revisada && f.revisadoPor ? `Revisada por ${f.revisadoPor}` : "Marcar como revisada"}
              onChange={(e) => void palomear(f.clave, e.target.checked)}
            />
          </span>
        );
      },
    },
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
              {/* Saca de la app: abre ESE correo en Outlook, en otra pestaña. Antes era
                  un <a> pelado y con `a { color: inherit }` se leía como texto gris
                  cualquiera — nadie podía adivinar que era un link ni a dónde iba. Va
                  con el verde del DS, la flecha ↗ que ya usan los chips que navegan, y
                  el `title` que dice a dónde lleva (en una tabla no se puede usar
                  `.ds-tip`: el contenedor tiene overflow y lo recorta). */}
              {f.webLink && (
                <> · <a className="link-btn link-btn--sm" href={f.webLink} target="_blank" rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  title="Abre este correo en Outlook, en una pestaña nueva. Es para leerlo: no cambia nada acá.">
                  ver correo en Outlook<span className="chip-link__ir" aria-hidden>↗</span>
                </a></>
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
        // Mismo trato que "ver correo": con `a { color: inherit; text-decoration: none }`
        // un <a> pelado se lee como texto cualquiera y nadie adivina que abre BC. Verde
        // del DS, la flecha ↗ de "esto te saca de la app", y el `title` diciendo a dónde
        // va (en una tabla no sirve `.ds-tip`: el contenedor recorta por overflow).
        return f.bcUrl
          ? (
            <a className="link-btn link-btn--sm" href={f.bcUrl} target="_blank" rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              title={`Abre la factura ${f.bcNumero} en Business Central, en una pestaña nueva.`}>
              {f.bcNumero}<span className="chip-link__ir" aria-hidden>↗</span>
            </a>
          )
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
  ], [hoy, palomear]);

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
        {sincronizando && (
          <div className="col gap-2" style={{ marginTop: 12 }}>
            <div className="row gap-2" style={{ justifyContent: "space-between" }}>
              <span className="ds-body-sm">{FASES[avance?.fase ?? ""] ?? "Preparando…"}</span>
              <span className="ds-body-sm ds-muted">
                {avance && avance.total > 0 ? `${avance.hechos} de ${avance.total}` : ""}
              </span>
            </div>
            <ProgressBar value={avance?.hechos ?? 0} total={avance?.total ?? 0} />
          </div>
        )}
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
        <div className="tiles tiles--5 mb-4">
          {/* EL NÚMERO QUE CONTESTA LA PREGUNTA: de todo lo que llegó al correo,
              ¿cuánto está en BC? Va de primero porque es el titular; los otros
              recuadros son el desglose.

              El denominador deja fuera lo de las empresas hermanas y lo marcado
              "no aplica": eso nunca tuvo que estar en BC, y contarlo bajaría el
              porcentaje acusando un atraso que no existe. Las descuadradas cuentan
              como que SÍ están —la factura se digitó— y se desglosan en su propio
              recuadro, porque "está con otro monto" es otro problema y otro dueño.

              Sin `onClick`: los demás recuadros filtran, este es un titular. Si
              filtrara, filtraría por "lo mismo que ya estás viendo". */}
          <Tile label={`${num.format(conteo.registrada + conteo.descuadrada)} de ${num.format(base)} ya en BC`}
            value={`${pctEnBc}%`}
            accent={pctEnBc >= 90 ? "var(--ds-color-green-200)" : pctEnBc >= 70 ? "var(--ds-color-yellow)" : "var(--ds-color-red-200)"} />
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
          <Tile label="Sin revisar" value={num.format(conteo.porRevisar)}
            accent={conteo.porRevisar ? "var(--ds-color-gray-300)" : "var(--ds-color-green-200)"}
            active={filtro === "porRevisar"}
            onClick={() => setFiltro(filtro === "porRevisar" ? "todas" : "porRevisar")} />
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
            Buscá por lo que sea: proveedor, cédula, consecutivo, N.º de BC o estado. Los días al lado de
            «Registrada» son lo que tardó en digitarse desde que llegó el correo.
          </p>
          <div className="row gap-3 wrap" style={{ marginTop: 12, alignItems: "flex-end" }}>
            <Field label="Fecha del comprobante">
              <CampoRangoFechas valor={rango} onCambio={setRango} vacio="Últimos 60 días" max={hoyISO()} />
            </Field>
            {(rango.from || rango.to) && (
              <Button variant="outline" size="sm" onClick={() => setRango({})}>Volver a los últimos 60 días</Button>
            )}
          </div>
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
              onRowClick={(f) => setAbierta(f.clave)}
            />
          </div>
        </Card>
      )}

      {abierta && filas.some((f) => f.clave === abierta) && (
        <FacturaCotejo fila={filas.find((f) => f.clave === abierta)!} onClose={() => setAbierta(null)} />
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
