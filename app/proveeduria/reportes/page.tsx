"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { Button, Card, Checkbox, EmptyState, Field, Input, Select, Skeleton, Tile } from "@/components/ui";
import { IconChevronDown, IconList } from "@/components/icons";
import { useStore } from "@/lib/store";
import { formatDate, money, num, todayISO } from "@/lib/helpers";
import {
  aCsv, agruparPor, filasDeCompra, opcionesDeFiltro, porMaterial,
  type CompraFila, type ImportePorMoneda,
} from "@/lib/reportes";

type Tab = "materiales" | "obras" | "personas";

// Rango por defecto: los últimos 12 meses. Es la ventana con la que se negocia un
// precio ("¿a cómo lo compramos este año?") sin arrastrar histórico viejo.
function haceUnAno(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Importes por moneda. Casi siempre es solo colones, pero cuando hay dólares se
// muestran los dos: sumarlos sería inventar un tipo de cambio.
function Importes({ m }: { m: ImportePorMoneda }) {
  const entradas = Object.entries(m).filter(([, v]) => v !== 0);
  if (!entradas.length) return <>{money(0)}</>;
  return <>{entradas.map(([cur, v], i) => (
    <span key={cur}>{i > 0 ? " · " : ""}{money(v, cur)}</span>
  ))}</>;
}

export default function ReportesPage() {
  const { ordenes, pedidos, cargando } = useStore();
  const [tab, setTab] = useState<Tab>("materiales");
  const [desde, setDesde] = useState(haceUnAno());
  const [hasta, setHasta] = useState(todayISO());
  const [texto, setTexto] = useState("");
  const [obra, setObra] = useState("");
  const [proveedorNo, setProveedorNo] = useState("");
  const [incluirNoAprobadas, setIncluirNoAprobadas] = useState(false);
  const [abierto, setAbierto] = useState<string | null>(null);

  const { obras, proveedores } = useMemo(() => opcionesDeFiltro(ordenes, pedidos), [ordenes, pedidos]);
  const filas = useMemo(
    () => filasDeCompra(ordenes, pedidos, { desde, hasta, texto, obra, proveedorNo, incluirNoAprobadas }),
    [ordenes, pedidos, desde, hasta, texto, obra, proveedorNo, incluirNoAprobadas],
  );

  const materiales = useMemo(() => porMaterial(filas), [filas]);
  const porObra = useMemo(() => agruparPor(filas, "obra"), [filas]);
  const porSolicitante = useMemo(() => agruparPor(filas, "solicitante", "(sin solicitud)"), [filas]);
  const porComprador = useMemo(() => agruparPor(filas, "compradorOC", "(sin registro)"), [filas]);

  const totalOrdenes = new Set(filas.map((f) => f.ordenId)).size;
  const totalImporte = useMemo(() => filas.reduce<ImportePorMoneda>((m, f) => ({ ...m, [f.moneda]: (m[f.moneda] ?? 0) + f.importe }), {}), [filas]);

  function descargar() {
    const blob = new Blob([aCsv(filas)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `compras_${desde}_a_${hasta}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const limpiar = () => { setTexto(""); setObra(""); setProveedorNo(""); setDesde(haceUnAno()); setHasta(todayISO()); setIncluirNoAprobadas(false); };
  const hayFiltro = !!(texto || obra || proveedorNo || incluirNoAprobadas);
  const alternar = (k: string) => setAbierto(abierto === k ? null : k);

  if (cargando && !ordenes.length) {
    return <main className="page"><div className="col gap-4" aria-busy="true">
      <Skeleton style={{ display: "block", width: 260, height: 30, borderRadius: 8 }} />
      <Skeleton style={{ display: "block", width: "100%", height: 120, borderRadius: 16 }} />
      <Skeleton style={{ display: "block", width: "100%", height: 320, borderRadius: 16 }} />
    </div></main>;
  }

  // Detalle compartido por las tres pestañas: cada compra con su fecha, orden,
  // proveedor, precio, obra y las dos personas (quién pidió / quién compró).
  const Detalle = ({ fs }: { fs: CompraFila[] }) => (
    <div className="ds-table-wrap" style={{ boxShadow: "none", background: "var(--ds-color-surface)" }}>
      <table className="ds-table">
        <thead>
          <tr>
            <th>Fecha</th><th>Orden</th><th>Proveedor</th><th className="hide-mobile">Material</th>
            <th className="ds-num">Cantidad</th><th className="ds-num">Precio unit.</th><th className="ds-num">Importe</th>
            <th className="hide-mobile">Obra</th><th className="hide-mobile">Pidió</th><th className="hide-mobile">Generó la OC</th>
          </tr>
        </thead>
        <tbody>
          {fs.map((f, i) => (
            <tr key={`${f.ordenId}-${i}`}>
              <td>{formatDate(f.fecha)}</td>
              <td><Link className="linklike" href={`/proveeduria/ordenes/${f.ordenId}`}>{f.ordenNumero}</Link></td>
              <td>{f.proveedorNombre || f.proveedorNo || "—"}</td>
              <td className="hide-mobile ds-muted">{f.itemNo || "—"}</td>
              <td className="ds-num">{num.format(f.cantidad)} {f.unidad}</td>
              <td className="ds-num">{money(f.precioUnitario, f.moneda)}{f.descuentoPct ? <span className="ds-muted"> −{f.descuentoPct}%</span> : null}</td>
              <td className="ds-num ds-strong">{money(f.importe, f.moneda)}</td>
              <td className="hide-mobile">{f.obra || "—"}</td>
              <td className="hide-mobile">{f.solicitante || <span className="ds-muted">{f.pedidoNumero ? "—" : "directa"}</span>}</td>
              <td className="hide-mobile">{f.compradorOC || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const Expandir = ({ k }: { k: string }) => (
    <IconChevronDown size={16} style={{ transform: abierto === k ? "rotate(180deg)" : "none", transition: "transform .15s ease" }} />
  );

  return (
    <main className="page page--wide">
      <div className="page__head">
        <div className="page__title">
          <h1 className="ds-heading">Reportes de compras</h1>
          <p className="ds-muted">
            Qué se compró, cuántas veces, a quién, a qué precio y para qué obra. Sale de las órdenes de esta app —
            por defecto solo las <span className="ds-strong">lanzadas y completadas</span>, que son las que realmente se compraron.
          </p>
        </div>
        <Button variant="outline" onClick={descargar} disabled={!filas.length}
          title={filas.length ? "Descargar el detalle filtrado en CSV (se abre en Excel)" : "No hay líneas para exportar"}>
          Descargar CSV
        </Button>
      </div>

      <Card flat className="mb-4">
        <div className="row gap-3 wrap" style={{ alignItems: "flex-end" }}>
          <div style={{ flex: "2 1 260px" }}><Field label="Material (código o descripción)">
            <Input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Ej. M20-0141 o filtro de aceite" />
          </Field></div>
          <div style={{ flex: "1 1 150px" }}><Field label="Desde">
            <Input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
          </Field></div>
          <div style={{ flex: "1 1 150px" }}><Field label="Hasta">
            <Input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
          </Field></div>
          <div style={{ flex: "1 1 180px" }}><Field label="Obra / centro de costo">
            <Select value={obra} onChange={(e) => setObra(e.target.value)} placeholder="Todas">
              <option value="">Todas</option>
              {obras.map((o) => <option key={o} value={o}>{o}</option>)}
            </Select>
          </Field></div>
          <div style={{ flex: "1 1 200px" }}><Field label="Proveedor">
            <Select value={proveedorNo} onChange={(e) => setProveedorNo(e.target.value)} placeholder="Todos">
              <option value="">Todos</option>
              {proveedores.map(([no, nombre]) => <option key={no} value={no}>{nombre}</option>)}
            </Select>
          </Field></div>
        </div>
        <div className="row gap-4 wrap mt-3" style={{ alignItems: "center" }}>
          <Checkbox checked={incluirNoAprobadas} onChange={(e) => setIncluirNoAprobadas(e.target.checked)}
            label="Incluir órdenes en borrador y rechazadas" />
          {hayFiltro && <button className="link-btn" onClick={limpiar}>Limpiar filtros</button>}
        </div>
      </Card>

      <div className="tiles">
        <Tile value={totalOrdenes} label="Órdenes" />
        <Tile value={filas.length} label="Líneas compradas" />
        <Tile value={materiales.length} label="Materiales distintos" accent="var(--ds-color-green-100)" />
        <Tile value={<Importes m={totalImporte} />} label="Monto (sin IVA)" accent="var(--ds-color-green-200)" />
      </div>

      <div className="vista-toggle mt-4">
        <span className="ds-muted ds-body-sm">Ver por:</span>
        <div className="segmented" role="tablist" aria-label="Tipo de reporte">
          {([["materiales", "Material"], ["obras", "Obra / centro de costo"], ["personas", "Personas"]] as [Tab, string][]).map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k}
              className={`segmented__btn ${tab === k ? "is-active" : ""}`}
              onClick={() => { setTab(k); setAbierto(null); }}>{label}</button>
          ))}
        </div>
      </div>

      {!filas.length ? (
        <Card flat><EmptyState icon={<IconList size={24} />} title="No hay compras con esos filtros."
          hint="Probá ampliar el rango de fechas o quitar el filtro de obra/proveedor." /></Card>
      ) : tab === "materiales" ? (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <div className="ds-table-wrap">
            <table className="ds-table">
              <thead>
                <tr>
                  <th>Material</th>
                  <th className="ds-num">Compras</th>
                  <th className="ds-num">Cantidad</th>
                  <th className="ds-num">Precio mín.</th>
                  <th className="ds-num">Precio prom.</th>
                  <th className="ds-num">Precio máx.</th>
                  <th className="ds-num">Último precio</th>
                  <th className="hide-mobile">Último proveedor</th>
                  <th className="ds-num">Total</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {materiales.map((g) => (
                  <Fragment key={g.key}>
                    <tr className="is-clickable" onClick={() => alternar(g.key)}>
                      <td>
                        <div className="ds-strong">{g.descripcion}</div>
                        <div className="ds-body-sm ds-muted">
                          {g.itemNo || "sin código"}
                          {g.obras.length ? ` · ${g.obras.length === 1 ? g.obras[0] : `${g.obras.length} obras`}` : ""}
                          {g.proveedores.length > 1 ? ` · ${g.proveedores.length} proveedores` : ""}
                        </div>
                      </td>
                      <td className="ds-num">{g.ordenes}</td>
                      <td className="ds-num">{num.format(g.cantidad)} {g.unidad}</td>
                      <td className="ds-num">{money(g.precioMin, g.moneda)}</td>
                      <td className="ds-num">{money(g.precioPromedio, g.moneda)}</td>
                      <td className="ds-num">{money(g.precioMax, g.moneda)}</td>
                      <td className="ds-num ds-strong">{money(g.ultimoPrecio, g.moneda)}
                        <div className="ds-body-sm ds-muted">{formatDate(g.ultimaFecha)}</div>
                      </td>
                      <td className="hide-mobile">{g.ultimoProveedor || "—"}</td>
                      <td className="ds-num ds-strong"><Importes m={g.importePorMoneda} /></td>
                      <td className="ds-num ds-muted"><Expandir k={g.key} /></td>
                    </tr>
                    {/* Los precios se calculan sobre la moneda de la última compra: si
                        el material se compró en ₡ y en $, hay que decirlo o el
                        "promedio" se lee como si fuera de todo. */}
                    {g.monedasMezcladas && (
                      <tr><td colSpan={10} className="ds-body-sm ds-muted" style={{ paddingTop: 0 }}>
                        Ojo: este material se compró en más de una moneda. Los precios de arriba son solo de las compras en {g.moneda || "CRC"}.
                      </td></tr>
                    )}
                    {abierto === g.key && <tr><td colSpan={10} style={{ padding: "6px 12px 14px" }}><Detalle fs={g.filas} /></td></tr>}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : tab === "obras" ? (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <div className="ds-table-wrap">
            <table className="ds-table">
              <thead>
                <tr><th>Obra / centro de costo</th><th className="ds-num">Órdenes</th><th className="ds-num">Líneas</th>
                  <th className="ds-num">Materiales</th><th className="ds-num">Total (sin IVA)</th><th></th></tr>
              </thead>
              <tbody>
                {porObra.map((g) => (
                  <Fragment key={g.clave}>
                    <tr className="is-clickable" onClick={() => alternar(g.clave)}>
                      <td className="ds-strong">{g.clave}</td>
                      <td className="ds-num">{g.ordenes}</td>
                      <td className="ds-num">{g.lineas}</td>
                      <td className="ds-num">{g.materiales}</td>
                      <td className="ds-num ds-strong"><Importes m={g.importePorMoneda} /></td>
                      <td className="ds-num ds-muted"><Expandir k={g.clave} /></td>
                    </tr>
                    {abierto === g.clave && <tr><td colSpan={6} style={{ padding: "6px 12px 14px" }}><Detalle fs={g.filas} /></td></tr>}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <div className="col gap-6">
          {([["Quién pidió el material", porSolicitante, "solicitante"], ["Quién generó la orden de compra", porComprador, "comprador"]] as const).map(([titulo, grupos, pref]) => (
            <div key={pref}>
              <h3 className="ds-subtitle" style={{ marginBottom: 12 }}>{titulo}</h3>
              <Card style={{ padding: 0, overflow: "hidden" }}>
                <div className="ds-table-wrap">
                  <table className="ds-table">
                    <thead>
                      <tr><th>Persona</th><th className="ds-num">Órdenes</th><th className="ds-num">Líneas</th>
                        <th className="ds-num">Materiales</th><th className="ds-num">Total (sin IVA)</th><th></th></tr>
                    </thead>
                    <tbody>
                      {grupos.map((g) => {
                        const k = `${pref}:${g.clave}`;
                        return (
                          <Fragment key={k}>
                            <tr className="is-clickable" onClick={() => alternar(k)}>
                              <td className="ds-strong">{g.clave}</td>
                              <td className="ds-num">{g.ordenes}</td>
                              <td className="ds-num">{g.lineas}</td>
                              <td className="ds-num">{g.materiales}</td>
                              <td className="ds-num ds-strong"><Importes m={g.importePorMoneda} /></td>
                              <td className="ds-num ds-muted"><Expandir k={k} /></td>
                            </tr>
                            {abierto === k && <tr><td colSpan={6} style={{ padding: "6px 12px 14px" }}><Detalle fs={g.filas} /></td></tr>}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          ))}
        </div>
      )}

      <p className="ds-body-sm ds-muted mt-4">
        Los montos son <span className="ds-strong">sin IVA</span> y con el descuento de línea aplicado. El precio promedio es
        ponderado por cantidad (no el promedio simple de los precios). Las líneas de flete/cargo no entran: no son material comprado.
      </p>
    </main>
  );
}
