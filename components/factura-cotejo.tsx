"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Input, Modal, Select, Skeleton, Textarea, useToast } from "@/components/ui";
import { IconCheck, IconWarning } from "@/components/icons";
import { formatDate, money, num } from "@/lib/helpers";
import { TIPOS, type LineaComprobante, type ResumenComprobante } from "@/lib/cruce-correo-bc";
import type { Candidato, CotejoRenglones } from "@/lib/candidatos-bc";
import type { BcFacturaCompraDetalle } from "@/lib/bc";
import type { FacturaCorreo } from "@/lib/repo-facturas-correo";

// LOS DOS LADOS DE UNA FACTURA, UNO AL LADO DEL OTRO.
//
// La tabla de la auditoría contesta "¿está en BC?". Esto contesta las dos que vienen
// después, que son las que cuestan plata: "¿está por lo mismo?" y, cuando parece que
// no está, "¿no estará con otro número?".
//
// A la izquierda lo que cobró el proveedor (el XML que llegó al correo), a la derecha
// lo que se digitó en Business Central, cada columna con su total y con el enlace a su
// fuente. Si no hay nada en BC, la columna derecha se vuelve la lista de CANDIDATOS:
// las facturas del mismo proveedor, con el mismo monto y de la misma fecha, que son
// exactamente las que Contabilidad venía encontrando a pulso y anotando en un Excel
// ("REGISTRADA CON EL # 319869"). Se toca una para verle los renglones y, si es, se
// enlaza. Enlazar es de la persona: ver lib/candidatos-bc.ts para por qué.
//
// Las líneas NO se aparean renglón contra renglón en pantalla. La descripción del
// proveedor y la del catálogo de BC casi nunca son la misma frase, así que el pareo
// visual acertaría a veces y mentiría el resto. Lo que sí se afirma es lo que se puede
// probar: cuántos renglones calzan por importe y en cuánto difieren los totales.

type Lado<T> = { ok: true } & T | { ok: false; error: string };
type Datos = {
  factura: FacturaCorreo;
  correo: Lado<{ archivo: string; lineas: LineaComprobante[]; resumen: ResumenComprobante }>;
  bc: Lado<{ factura: BcFacturaCompraDetalle; esPrevia: boolean }>;
  candidatos: Candidato[];
  candidatosError?: string;
  renglones: CotejoRenglones | null;
};

export function FacturaCotejo({ fila, onCambio, onClose }: {
  fila: FacturaCorreo;
  /** Se llama cuando la factura cambió en la base, para que la lista se refresque. */
  onCambio?: () => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState("");
  // El N.º de BC que se está MIRANDO sin haberlo enlazado todavía. Es el paso que
  // faltaba: antes de decir "es esta" hay que poder verle los renglones.
  const [previa, setPrevia] = useState<string | null>(null);
  const [aMano, setAMano] = useState("");
  const [nota, setNota] = useState(fila.nota ?? "");
  const [motivo, setMotivo] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async (bc: string | null, señal?: AbortSignal) => {
    try {
      const q = bc ? `?bc=${encodeURIComponent(bc)}` : "";
      const r = await fetch(`/api/vigilancia/factura/${fila.clave}${q}`, { cache: "no-store", signal: señal });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? `Error ${r.status}`);
      setDatos(j as Datos);
      setError("");
    } catch (e: any) {
      if (e?.name !== "AbortError") setError(e?.message ?? "No se pudo abrir la factura.");
    }
  }, [fila.clave]);

  useEffect(() => {
    const ctl = new AbortController();
    void cargar(previa, ctl.signal);
    return () => ctl.abort();
  }, [cargar, previa]);

  // Guardar: enlazar (bcNumero), soltar (bcNumero: null) o solo comentar (nota).
  const guardar = useCallback(async (cuerpo: Record<string, unknown>, exito: string) => {
    setOcupado(true);
    try {
      const r = await fetch(`/api/vigilancia/factura/${fila.clave}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cuerpo),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? `Error ${r.status}`);
      toast(exito, "success");
      setPrevia(null);
      await cargar(null);
      onCambio?.();
      return true;
    } catch (e: any) {
      toast(e?.message ?? "No se pudo guardar.", "error");
      return false;
    } finally {
      setOcupado(false);
    }
  }, [fila.clave, cargar, onCambio, toast]);

  const actual = datos?.factura ?? fila;
  const bc = datos?.bc.ok ? datos.bc.factura : null;
  const esPrevia = (datos?.bc.ok && datos.bc.esPrevia) || false;
  const correo = datos?.correo.ok ? datos.correo : null;
  const cargando = !datos && !error;
  const tipo = TIPOS[actual.tipoDoc] ?? "Comprobante";

  return (
    <Modal wide title={`${tipo} ${actual.consecutivo}`} onClose={onClose}>
      <div className="cot-cab">
        <div>
          <div className="ds-strong">{actual.nombreEmisor || actual.cedulaEmisor}</div>
          <div className="ds-muted ds-body-sm">
            Cédula {actual.cedulaEmisor} · emitida el {formatDate(actual.fechaEmision)}
            {actual.bcCalzePor === "nombre" && " · calzó por nombre, no por cédula"}
          </div>
        </div>
        <EstadoBadge factura={actual} />
      </div>

      <Diferencia correo={correo?.resumen ?? null} bc={bc} renglones={datos?.renglones ?? null} esPrevia={esPrevia} />

      <div className="cot-cols">
        <Columna
          titulo="Lo que facturó el proveedor"
          fuente="del XML que llegó al correo"
          enlace={actual.webLink
            ? { href: actual.webLink, texto: "ver el correo en Outlook", title: "Abre este correo en Outlook, en una pestaña nueva." }
            : null}
          cargando={cargando}
          error={datos && !datos.correo.ok ? datos.correo.error : ""}
          lineas={correo?.lineas.map((l) => ({
            clave: `x${l.numero}`,
            titulo: l.detalle || l.codigo || l.cabys,
            abajo: [l.codigo, l.cabys && `CABYS ${l.cabys}`].filter(Boolean).join(" · "),
            cantidad: l.cantidad, unidad: l.unidad, precioUnitario: l.precioUnitario,
            descuento: l.descuento, total: l.total,
          })) ?? []}
          moneda={correo?.resumen.moneda ?? actual.moneda}
          totales={correo ? [
            { rotulo: "Subtotal", monto: correo.resumen.subtotal },
            ...(correo.resumen.descuentos ? [{ rotulo: "Descuentos", monto: -correo.resumen.descuentos }] : []),
            ...(correo.resumen.otrosCargos ? [{ rotulo: "Otros cargos", monto: correo.resumen.otrosCargos }] : []),
            { rotulo: "Impuesto", monto: correo.resumen.impuesto },
            { rotulo: "Total", monto: correo.resumen.total, fuerte: true },
          ] : []}
        />

        {/* La columna derecha tiene tres caras: la factura enlazada, un candidato que
            se está mirando, o —cuando no hay nada— la lista de candidatos. */}
        {bc ? (
          <Columna
            titulo={esPrevia ? "¿Será esta? (todavía sin enlazar)" : "Lo que se registró en Business Central"}
            fuente={bc.pedido ? `del pedido ${bc.pedido}` : `N.º del proveedor ${bc.numeroProveedor || "—"}`}
            enlace={bc.url ? { href: bc.url, texto: bc.numero, title: `Abre la factura ${bc.numero} en Business Central, en una pestaña nueva.` } : null}
            cargando={cargando}
            error=""
            lineas={bc.lineas.map((l) => ({
              clave: `b${l.numeroLinea}`,
              titulo: l.descripcion || l.codigo,
              abajo: [l.codigo, ETIQUETA_TIPO[l.tipo]].filter(Boolean).join(" · "),
              cantidad: l.cantidad, unidad: l.unidad, precioUnitario: l.precioUnitario,
              descuento: l.descuento, total: l.total,
            }))}
            moneda={bc.moneda}
            totales={[
              { rotulo: "Subtotal", monto: bc.subtotal },
              { rotulo: "Impuesto", monto: bc.impuesto },
              { rotulo: "Total", monto: bc.total, fuerte: true },
            ]}
            pie={esPrevia ? (
              <div className="row gap-2 wrap" style={{ justifyContent: "space-between" }}>
                <Button variant="outline" size="sm" onClick={() => setPrevia(null)} disabled={ocupado}>
                  ← Ver los otros
                </Button>
                <Button size="sm" disabled={ocupado}
                  onClick={() => void guardar({ bcNumero: bc.numero, nota: nota.trim() || undefined }, `Quedó enlazada a ${bc.numero}.`)}>
                  Sí, es esta
                </Button>
              </div>
            ) : actual.bcCalzePor === "manual" ? (
              <div className="row gap-2 wrap" style={{ justifyContent: "space-between", alignItems: "center" }}>
                <span className="ds-muted ds-body-sm">
                  Enlazada a mano{actual.revisadoPor ? ` por ${actual.revisadoPor}` : ""}
                </span>
                <Button variant="outline" size="sm" disabled={ocupado}
                  onClick={() => void guardar({ bcNumero: null }, "Se soltó el enlace: vuelve a la cola.")}>
                  Soltar
                </Button>
              </div>
            ) : undefined}
          />
        ) : (
          <Candidatos
            cargando={cargando}
            cerrada={actual.estado === "no_aplica" || actual.estado === "otra_empresa"}
            error={datos && !datos.bc.ok ? datos.bc.error : ""}
            candidatosError={datos?.candidatosError}
            lista={datos?.candidatos ?? []}
            moneda={actual.moneda}
            ocupado={ocupado}
            aMano={aMano}
            setAMano={setAMano}
            onMirar={(numero) => setPrevia(numero)}
          />
        )}
      </div>

      {/* El comentario de revisión. Reemplaza la columna "Comentarios" del Excel que
          Contabilidad llevaba aparte: acá viaja con la factura y lo ve el que la
          abra después. */}
      <div className="cot-nota">
        <label className="ds-body-sm ds-strong" htmlFor="cot-nota">Comentario de revisión</label>
        <Textarea id="cot-nota" rows={2} value={nota} maxLength={500}
          placeholder="Lo que haya que dejar dicho: por qué no cuadra, con quién se habló, qué falta…"
          onChange={(e) => setNota(e.target.value)} />
        <div className="row gap-2" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <span className="ds-muted ds-body-sm">
            {actual.revisadoPor && actual.nota ? `Último: ${actual.revisadoPor}` : "Se guarda con tu nombre y la fecha."}
          </span>
          <Button size="sm" variant="outline" disabled={ocupado || nota === (actual.nota ?? "")}
            onClick={() => void guardar({ nota }, "Comentario guardado.")}>
            Guardar comentario
          </Button>
        </div>
      </div>

      <Cierre
        factura={actual}
        motivo={motivo}
        setMotivo={setMotivo}
        comentario={nota}
        ocupado={ocupado}
        onCerrar={(estado, texto) => void guardar({ estado, nota: texto }, "Caso cerrado: sale de las pendientes.")}
        onReabrir={() => void guardar({ estado: "pendiente", nota }, "Vuelve a la cola de pendientes.")}
      />

      {error && (
        <div className="ds-callout ds-callout--red mt-4">
          <span className="ds-callout__icon"><IconWarning size={18} /></span>
          <div className="ds-callout__body">{error}</div>
        </div>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------- cierre
//
// LA SALIDA PARA LO QUE NUNCA VA A ESTAR EN BC: una compra personal, algo de otra
// empresa del grupo, un comprobante que el proveedor mandó dos veces. No es una
// factura perdida ni un error del digitador, y dejarla "sin registrar" para siempre
// ensucia la lista y baja el porcentaje acusando un atraso que no existe.
//
// El motivo es OBLIGATORIO y se guarda en el comentario, que es la columna que se ve
// en la tabla y viaja en la exportación. Un caso cerrado sin explicación no se puede
// distinguir, un mes después, de uno que alguien quiso sacar de la lista.

const MOTIVOS: { id: string; estado: "no_aplica" | "otra_empresa"; label: string }[] = [
  { id: "otra_empresa", estado: "otra_empresa", label: "Es de otra empresa del grupo" },
  { id: "personal", estado: "no_aplica", label: "Es una compra personal, no de la empresa" },
  { id: "duplicada", estado: "no_aplica", label: "Llegó dos veces: está duplicada" },
  { id: "sin_compra", estado: "no_aplica", label: "No lleva factura de compra en BC" },
  { id: "otro", estado: "no_aplica", label: "Otro motivo (lo escribo en el comentario)" },
];

function Cierre({ factura, motivo, setMotivo, comentario, ocupado, onCerrar, onReabrir }: {
  factura: FacturaCorreo;
  motivo: string;
  setMotivo: (v: string) => void;
  comentario: string;
  ocupado: boolean;
  onCerrar: (estado: "no_aplica" | "otra_empresa", nota: string) => void;
  onReabrir: () => void;
}) {
  const cerrada = factura.estado === "no_aplica" || factura.estado === "otra_empresa";

  if (cerrada) {
    return (
      <div className="ds-callout ds-callout--green mt-4">
        <span className="ds-callout__icon"><IconCheck size={18} /></span>
        <div style={{ flex: 1 }}>
          <div className="ds-callout__title">
            Caso cerrado — {factura.estado === "otra_empresa" ? "es de otra empresa" : "no aplica"}
          </div>
          <div className="ds-callout__body">
            {factura.nota || "Sin motivo anotado."}
            {factura.revisadoPor && ` · ${factura.revisadoPor}`}
            {factura.revisadoEn && ` · ${formatDate(factura.revisadoEn.slice(0, 10))}`}
          </div>
        </div>
        <Button variant="outline" size="sm" disabled={ocupado} onClick={onReabrir}>Reabrir</Button>
      </div>
    );
  }

  // Solo se cierra lo que está esperando. Una factura que ya apareció en BC no se
  // cierra: se arregla o se suelta el enlace.
  if (factura.estado !== "pendiente") return null;

  const elegido = MOTIVOS.find((m) => m.id === motivo);
  const detalle = comentario.trim();
  const falta = elegido?.id === "otro" && !detalle;

  return (
    <div className="cot-cierre">
      <div>
        <div className="ds-body-sm ds-strong">¿Esta factura no tiene que estar en Business Central?</div>
        <div className="ds-muted ds-body-sm">
          Cerrala con el motivo y sale de las pendientes. Deja de contar como atraso y el motivo queda anotado.
        </div>
      </div>
      <div className="row gap-2 wrap" style={{ alignItems: "center" }}>
        <Select value={motivo} onChange={(e) => setMotivo(e.target.value)} disabled={ocupado}
          placeholder="¿Por qué no aplica?" ariaLabel="Motivo del cierre" style={{ width: 320, maxWidth: "100%" }}>
          {MOTIVOS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </Select>
        <Button variant="outline" disabled={ocupado || !elegido || falta}
          onClick={() => elegido && onCerrar(elegido.estado, detalle ? `${elegido.label} — ${detalle}` : elegido.label)}>
          Cerrar el caso
        </Button>
        {falta && <span className="ds-muted ds-body-sm">Escribí arriba de qué se trata.</span>}
      </div>
    </div>
  );
}

const ETIQUETA_TIPO: Record<string, string> = {
  articulo: "artículo", recurso: "recurso", activo_fijo: "activo fijo", cargo: "cargo", otro: "cuenta",
};

// Verde = acá no queda nada pendiente, y eso vale igual para la que se registró en BC
// que para la que se cerró porque nunca tenía que estar. La diferencia la dicen las
// palabras; el color contesta "¿me tengo que ocupar de esto?".
function EstadoBadge({ factura }: { factura: FacturaCorreo }) {
  const manual = factura.bcCalzePor === "manual";
  if (factura.estado === "registrada") return <Badge tone="green">{manual ? "Enlazada a mano" : "Registrada"}</Badge>;
  if (factura.estado === "descuadrada") return <Badge tone="yellow">No cuadra el monto</Badge>;
  if (factura.estado === "otra_empresa") return <Badge tone="green">Cerrada · otra empresa</Badge>;
  if (factura.estado === "no_aplica") return <Badge tone="green">Cerrada · no aplica</Badge>;
  return <Badge tone="red">Sin registrar</Badge>;
}

// Lo primero que hay que ver: en cuánto difieren los totales y cuántos renglones
// calzan. Un céntimo es redondeo; de ahí para arriba alguien tecleó otra cosa.
//
// Cuando se está MIRANDO un candidato el aviso cambia de trabajo: ya no reporta un
// problema de una factura enlazada, sino que ayuda a decidir si esa es. Por eso ahí
// sí se dice en verde que todo calza — es el dato que uno busca justo antes de tocar
// "Sí, es esta", y callárselo obliga a comparar los números a ojo.
function Diferencia({ correo, bc, renglones, esPrevia }: {
  correo: ResumenComprobante | null;
  bc: BcFacturaCompraDetalle | null;
  renglones: CotejoRenglones | null;
  esPrevia: boolean;
}) {
  if (!correo || !bc) return null;
  if (correo.moneda !== bc.moneda) {
    return (
      <Aviso tono="yellow" titulo="Están en monedas distintas">
        El proveedor facturó en {correo.moneda} y en Business Central quedó en {bc.moneda}. Los totales no se
        pueden comparar así.
      </Aviso>
    );
  }
  const dif = Math.round((bc.total - correo.total) * 100) / 100;
  const cuadranRenglones = !!renglones && renglones.calzan === renglones.enCorreo && renglones.calzan === renglones.enBc;
  const cuadraTodo = Math.abs(dif) <= 0.5 && cuadranRenglones;

  if (cuadraTodo) {
    if (!esPrevia) return null;   // enlazada y sin novedad: no hay nada que avisar
    return (
      <Aviso tono="green" titulo="Calza en todo">
        Mismo total y {renglones!.calzan === 1 ? "el renglón coincide" : `los ${renglones!.calzan} renglones coinciden`} por
        importe. Ojo igual con la fecha: dos compras iguales del mismo material se ven idénticas.
      </Aviso>
    );
  }

  if (Math.abs(dif) <= 0.5) {
    return (
      <Aviso tono="yellow" titulo="El total cuadra, pero los renglones no">
        {renglones ? `${frase(renglones)} ` : ""}Puede ser que en BC se juntaran o partieran líneas; vale la pena mirarlo.
      </Aviso>
    );
  }
  return (
    <Aviso tono="yellow" titulo={`Business Central tiene ${money(Math.abs(dif), bc.moneda)} ${dif > 0 ? "de más" : "de menos"}`}>
      El proveedor cobró {money(correo.total, correo.moneda)} y en BC quedó {money(bc.total, bc.moneda)}.
      {renglones ? ` ${frase(renglones)}` : ""} Comparando los renglones de abajo se ve en cuál está la diferencia.
    </Aviso>
  );
}

const frase = (r: CotejoRenglones): string =>
  r.calzan === r.enCorreo && r.calzan === r.enBc
    ? `Los ${r.calzan} renglones calzan por importe.`
    : `Calzan ${r.calzan} de ${r.enCorreo} renglones del correo contra ${r.enBc} de BC.`;

function Aviso({ tono, titulo, children }: { tono: "yellow" | "green"; titulo: string; children: React.ReactNode }) {
  return (
    <div className={`ds-callout ds-callout--${tono} mb-4`}>
      <span className="ds-callout__icon">{tono === "green" ? <IconCheck size={18} /> : <IconWarning size={18} />}</span>
      <div>
        <div className="ds-callout__title">{titulo}</div>
        <div className="ds-callout__body">{children}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- candidatos

function Candidatos({ cargando, cerrada, error, candidatosError, lista, moneda, ocupado, aMano, setAMano, onMirar }: {
  cargando: boolean; cerrada: boolean; error: string; candidatosError?: string;
  lista: Candidato[]; moneda: string; ocupado: boolean;
  aMano: string; setAMano: (v: string) => void;
  onMirar: (numero: string) => void;
}) {
  // Un caso cerrado no tiene nada que buscar en BC, y dejar el "todavía no se ha
  // encontrado" ahí contradice la decisión que alguien acaba de tomar.
  if (cerrada) {
    return (
      <section className="cot-col" aria-label="Business Central">
        <header className="cot-col__head">
          <div className="ds-strong ds-body-sm">Lo que se registró en Business Central</div>
          <div className="cot-col__meta"><span className="ds-muted ds-body-sm">nada, y está bien</span></div>
        </header>
        <p className="cot-col__aviso ds-body-sm ds-muted">
          Este comprobante se cerró: no tiene que estar en Business Central. Si fue un error, reabrilo abajo.
        </p>
      </section>
    );
  }

  return (
    <section className="cot-col" aria-label="Candidatos en Business Central">
      <header className="cot-col__head">
        <div className="ds-strong ds-body-sm">Lo que se registró en Business Central</div>
        <div className="cot-col__meta">
          <span className="ds-muted ds-body-sm">
            {cargando ? "buscando…"
              : lista.length ? `no calzó sola · ${lista.length} ${lista.length === 1 ? "candidata" : "candidatas"}`
              : "no calzó con ninguna"}
          </span>
        </div>
      </header>

      {cargando && (
        <div className="cot-linea"><Skeleton className="ds-skeleton--text" style={{ display: "block", width: "70%" }} /></div>
      )}

      {!cargando && (
        <>
          {!!error && !lista.length && <p className="cot-col__aviso ds-body-sm ds-muted">{error}</p>}
          {!!candidatosError && (
            <p className="cot-col__aviso ds-body-sm ds-muted">No se pudieron buscar candidatos: {candidatosError}</p>
          )}

          {!!lista.length && (
            <p className="cot-col__aviso ds-body-sm ds-muted" style={{ paddingBottom: 0 }}>
              Facturas del mismo proveedor que podrían ser esta. Tocá una para verle los renglones antes de decidir.
            </p>
          )}

          {lista.map((c) => (
            <button type="button" key={c.factura.numero} className="cot-cand" disabled={ocupado}
              onClick={() => onMirar(c.factura.numero)}>
              <div>
                <div className="ds-body-sm ds-strong">
                  {c.factura.numero}
                  {c.factura.numeroProveedor && <span className="ds-muted"> · N.º {c.factura.numeroProveedor}</span>}
                </div>
                <div className="ds-muted ds-body-sm">{c.razones.join(" · ")}</div>
              </div>
              <div className="cot-num">
                <div className="ds-body-sm">{money(c.factura.total, c.factura.moneda || moneda)}</div>
                <div className="ds-muted ds-body-sm">{formatDate(c.factura.fecha)}</div>
              </div>
            </button>
          ))}

          {/* La salida cuando la lista no la trae: teclear el N.º a mano. Hay casos en
              que la factura de BC está fuera de la ventana de fechas o a nombre de
              otra ficha del proveedor, y ahí la persona ya sabe cuál es. */}
          <div className="cot-col__aviso">
            <label className="ds-body-sm ds-strong" htmlFor="cot-amano">
              {lista.length ? "¿Es otra?" : "Si ya sabés cuál es"}
            </label>
            <div className="row gap-2" style={{ marginTop: 6 }}>
              <Input id="cot-amano" value={aMano} placeholder="CFR-010253" disabled={ocupado}
                onChange={(e) => setAMano(e.target.value.toUpperCase())}
                onKeyDown={(e) => { if (e.key === "Enter" && aMano.trim()) onMirar(aMano.trim()); }} />
              <Button variant="outline" disabled={ocupado || !aMano.trim()} onClick={() => onMirar(aMano.trim())}>
                Ver
              </Button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ columna

type LineaVista = {
  clave: string; titulo: string; abajo: string;
  cantidad: number; unidad: string; precioUnitario: number; descuento: number; total: number;
};

function Columna({ titulo, fuente, enlace, cargando, error, lineas, moneda, totales, pie }: {
  titulo: string;
  fuente: string;
  enlace: { href: string; texto: string; title: string } | null;
  cargando: boolean;
  error: string;
  lineas: LineaVista[];
  moneda: string;
  totales: { rotulo: string; monto: number; fuerte?: boolean }[];
  pie?: React.ReactNode;
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

      {!cargando && pie && <div className="cot-col__acciones">{pie}</div>}
    </section>
  );
}
