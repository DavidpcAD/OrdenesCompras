"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge, FiltroChip } from "@/components/ui";
import { IconWarning } from "@/components/icons";
import { DataTable } from "@/components/data-table";
import { useStore } from "@/lib/store";
import { useFiltroPantalla } from "@/lib/use-filtro-pantalla";
import { cuenta, formatDate, money, motivoNC, ordenPedidos } from "@/lib/helpers";
import { etiquetaBloqueo, ncPendientesPorProveedor, tieneContacto, type NcDeProveedor, type ProveedorFicha } from "@/lib/proveedores";

// PROVEEDORES: la ficha de cada proveedor tal como está en Business Central, con las
// notas de crédito que tiene pendientes. Para llamarle o escribirle por una NC sin
// abrir BC (pedido de nov 2026). Solo consulta: lo que falta se completa en BC.
type Fila = ProveedorFicha & { nc?: NcDeProveedor };
type Vista = "todos" | "nc" | "sinContacto" | "bloqueados";
const VISTAS: Vista[] = ["todos", "nc", "sinContacto", "bloqueados"];
const enVista = (f: Fila, v: Vista) =>
  v === "nc" ? !!f.nc : v === "sinContacto" ? !tieneContacto(f) : v === "bloqueados" ? !!f.bloqueado : true;

const vacio = <span className="ds-muted">—</span>;
const montosNc = (nc: NcDeProveedor) => nc.porMoneda.map(([m, v]) => money(v, m)).join(" + ");

export default function ProveedoresPage() {
  const { notasCredito, cargarNotasCredito, ordenes } = useStore();
  useEffect(() => { cargarNotasCredito(); /* eslint-disable-next-line */ }, []);

  const [fichas, setFichas] = useState<ProveedorFicha[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    fetch("/api/bc/proveedores-ficha", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => { setFichas(Array.isArray(d.proveedores) ? d.proveedores : []); setError(d.error ? String(d.error) : ""); })
      .catch((e) => { setFichas([]); setError(String(e?.message ?? e)); });
  }, []);

  const [vista, setVista] = useFiltroPantalla<Vista>("adelante_oc_proveedores_vista", "todos", (v) => (VISTAS as string[]).includes(v));

  const ncPorProv = useMemo(() => ncPendientesPorProveedor(notasCredito, ordenes, fichas ?? []), [notasCredito, ordenes, fichas]);
  // Los que tienen NC pendiente primero (más líneas arriba), después por nombre.
  const filas = useMemo<Fila[]>(() => (fichas ?? [])
    .map((f) => ({ ...f, nc: ncPorProv.get(f.codigo) }))
    .sort((a, b) => (b.nc?.lineas.length ?? 0) - (a.nc?.lineas.length ?? 0) || a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" })),
  [fichas, ncPorProv]);
  const cuentaVista = (v: Vista) => filas.filter((f) => enVista(f, v)).length;
  const lista = useMemo(() => filas.filter((f) => enVista(f, vista)), [filas, vista]);
  const ordenDe = (id: string) => ordenes.find((o) => String(o.id) === String(id));

  const columns = useMemo<ColumnDef<Fila, any>[]>(() => [
    { id: "codigo", header: "Código", accessorFn: (f) => f.codigo, meta: { label: "Código" }, cell: (c) => <span className="ds-nowrap">{c.getValue()}</span> },
    {
      id: "nombre", header: "Proveedor", accessorFn: (f) => f.nombre, meta: { label: "Proveedor" },
      cell: (c) => {
        const b = etiquetaBloqueo(c.row.original.bloqueado);
        return <span className="ds-clamp-2 ds-celda-nombre" title={c.getValue()}>{c.getValue()}{b ? <> <Badge tone="red">{b}</Badge></> : null}</span>;
      },
    },
    { id: "tipoId", header: "Tipo de identificación", accessorFn: (f) => f.tipoId, meta: { label: "Tipo de identificación" }, cell: (c) => c.getValue() || vacio },
    { id: "cedula", header: "Cédula", accessorFn: (f) => f.cedula, meta: { label: "Cédula" }, cell: (c) => c.getValue() ? <span className="ds-nowrap">{c.getValue()}</span> : vacio },
    { id: "telefono", header: "Teléfono", accessorFn: (f) => f.telefono, meta: { label: "Teléfono" }, cell: (c) => c.getValue() ? <a className="linklike ds-nowrap" href={`tel:${c.getValue()}`}>{c.getValue()}</a> : vacio },
    { id: "celular", header: "Celular", accessorFn: (f) => f.celular, meta: { label: "Celular" }, cell: (c) => c.getValue() ? <a className="linklike ds-nowrap" href={`tel:${c.getValue()}`}>{c.getValue()}</a> : vacio },
    { id: "correo", header: "Correo", accessorFn: (f) => f.correo, meta: { label: "Correo" }, cell: (c) => c.getValue() ? <a className="linklike" href={`mailto:${c.getValue()}`}>{c.getValue()}</a> : vacio },
    {
      id: "nc", header: "NC pendientes", accessorFn: (f) => f.nc?.lineas.length ?? 0, meta: { label: "NC pendientes", num: true },
      cell: (c) => {
        const nc = c.row.original.nc;
        return nc
          ? <span className="col" style={{ gap: 1, alignItems: "flex-end" }}><span className="ds-strong">{cuenta(nc.lineas.length, "línea", "líneas")}</span><span className="ds-body-sm ds-muted ds-nowrap">{montosNc(nc)}</span></span>
          : vacio;
      },
    },
    { id: "saldo", header: "Saldo", accessorFn: (f) => f.saldo, meta: { label: "Saldo (colones)", num: true }, cell: (c) => c.getValue() ? money(c.getValue()) : vacio },
    { id: "vencido", header: "Vencido", accessorFn: (f) => f.vencido, meta: { label: "Vencido (colones)", num: true }, cell: (c) => c.getValue() ? money(c.getValue()) : vacio },
    { id: "terminos", header: "Términos de pago", accessorFn: (f) => f.terminosPago, meta: { label: "Términos de pago" }, cell: (c) => c.getValue() || vacio },
    { id: "forma", header: "Forma de pago", accessorFn: (f) => f.formaPago, meta: { label: "Forma de pago" }, cell: (c) => c.getValue() || vacio },
    { id: "moneda", header: "Moneda", accessorFn: (f) => f.moneda || "CRC", meta: { label: "Moneda" }, cell: (c) => c.getValue() },
    { id: "direccion", header: "Dirección", accessorFn: (f) => f.direccion, meta: { label: "Dirección" }, cell: (c) => c.getValue() ? <span className="ds-clamp-2">{c.getValue()}</span> : vacio },
    { id: "ciudad", header: "Ciudad", accessorFn: (f) => f.ciudad, meta: { label: "Ciudad" }, cell: (c) => c.getValue() || vacio },
    { id: "provincia", header: "Provincia", accessorFn: (f) => f.provincia, meta: { label: "Provincia" }, cell: (c) => c.getValue() || vacio },
    { id: "pais", header: "País", accessorFn: (f) => f.pais, meta: { label: "País" }, cell: (c) => c.getValue() || vacio },
    { id: "codPostal", header: "Código postal", accessorFn: (f) => f.codPostal, meta: { label: "Código postal" }, cell: (c) => c.getValue() || vacio },
    { id: "grupoNegocio", header: "Grupo contable negocio", accessorFn: (f) => f.grupoNegocio, meta: { label: "Grupo contable negocio" }, cell: (c) => c.getValue() || vacio },
    { id: "grupoIva", header: "Grupo IVA negocio", accessorFn: (f) => f.grupoIva, meta: { label: "Grupo IVA negocio" }, cell: (c) => c.getValue() || vacio },
    { id: "grupoProveedor", header: "Grupo contable proveedor", accessorFn: (f) => f.grupoProveedor, meta: { label: "Grupo contable proveedor" }, cell: (c) => c.getValue() || vacio },
    { id: "estado", header: "Estado en BC", accessorFn: (f) => etiquetaBloqueo(f.bloqueado) || "Activo", meta: { label: "Estado en BC" }, cell: (c) => c.getValue() },
    { id: "modificado", header: "Ficha modificada", accessorFn: (f) => f.modificado, meta: { label: "Ficha modificada", date: true }, cell: (c) => c.getValue() ? formatDate(c.getValue()) : vacio },
  ], []);

  // A la vista, lo que se usa para llamar por una NC. El resto de la ficha está en
  // "Columnas" y completo en el detalle de cada fila (⇕).
  const ocultas = {
    tipoId: false, vencido: false, forma: false, moneda: false, direccion: false, ciudad: false, provincia: false,
    pais: false, codPostal: false, grupoNegocio: false, grupoIva: false, grupoProveedor: false, estado: false, modificado: false,
  };

  const fichaCompleta = (f: Fila) => {
    const dato = (v: string) => v || "—";
    return (
      <div className="prov-ficha">
        <div className="prov-ficha__grid">
          <section>
            <div className="ds-label ds-muted">Contacto</div>
            <dl className="rev-datos">
              <dt>Teléfono</dt><dd>{f.telefono ? <a className="linklike" href={`tel:${f.telefono}`}>{f.telefono}</a> : "—"}</dd>
              <dt>Celular</dt><dd>{f.celular ? <a className="linklike" href={`tel:${f.celular}`}>{f.celular}</a> : "—"}</dd>
              <dt>Correo</dt><dd>{f.correo ? <a className="linklike" href={`mailto:${f.correo}`}>{f.correo}</a> : "—"}</dd>
              <dt>Dirección</dt><dd>{dato([f.direccion, f.ciudad, f.provincia, f.pais, f.codPostal].filter(Boolean).join(", "))}</dd>
            </dl>
          </section>
          <section>
            <div className="ds-label ds-muted">Identificación y pago</div>
            <dl className="rev-datos">
              <dt>Código</dt><dd>{f.codigo}</dd>
              <dt>Cédula</dt><dd>{f.cedula ? `${f.cedula}${f.tipoId ? ` (${f.tipoId})` : ""}` : "—"}</dd>
              <dt>Moneda</dt><dd>{f.moneda || "CRC"}</dd>
              <dt>Términos de pago</dt><dd>{dato(f.terminosPago)}</dd>
              <dt>Forma de pago</dt><dd>{dato(f.formaPago)}</dd>
              <dt>Estado en BC</dt><dd>{etiquetaBloqueo(f.bloqueado) || "Activo"}</dd>
            </dl>
          </section>
          <section>
            <div className="ds-label ds-muted">Contabilidad</div>
            <dl className="rev-datos">
              <dt>Saldo</dt><dd>{money(f.saldo)}</dd>
              <dt>Vencido</dt><dd>{money(f.vencido)}</dd>
              <dt>Grupo contable negocio</dt><dd>{dato(f.grupoNegocio)}</dd>
              <dt>Grupo IVA negocio</dt><dd>{dato(f.grupoIva)}</dd>
              <dt>Grupo contable proveedor</dt><dd>{dato(f.grupoProveedor)}</dd>
              <dt>Ficha modificada</dt><dd>{f.modificado ? formatDate(f.modificado) : "—"}</dd>
            </dl>
          </section>
        </div>
        {f.nc && (
          <>
            <div className="row row--between wrap gap-2" style={{ alignItems: "baseline", margin: "var(--ds-space-2) 0" }}>
              <span className="ds-label ds-muted">Notas de crédito pendientes · {montosNc(f.nc)} sin IVA</span>
              <Link className="linklike ds-body-sm" href="/facturacion/notas-credito">Ir a Notas de crédito</Link>
            </div>
            <div className="ds-table-wrap" style={{ boxShadow: "none" }}>
              <table className="ds-table" style={{ background: "transparent" }}>
                <thead><tr><th>Orden</th><th>Solicitud</th><th>Creada por</th><th>Material</th><th>Motivo</th><th className="ds-num">Cantidad</th><th className="ds-num">Importe</th><th>Fecha</th></tr></thead>
                <tbody>
                  {f.nc.lineas.map((n) => {
                    const o = ordenDe(n.ordenId);
                    const mo = motivoNC(n.motivo);
                    const peds = o ? ordenPedidos(o) : [];
                    return (
                      <tr key={n.id}>
                        <td className="ds-nowrap">{o ? <Link className="linklike" href={`/facturacion/ver/${o.id}`}>{n.ordenNumero}</Link> : n.ordenNumero || "—"}</td>
                        <td className="ds-body-sm">{o ? (peds.length ? peds.join(", ") : "Directa") : "—"}</td>
                        <td className="ds-body-sm">{o?.creadoPor || "—"}</td>
                        <td className="ds-body-sm">{n.articuloNo ? `${n.articuloNo} · ` : ""}{n.descripcion}</td>
                        <td><Badge tone={mo.tone}>{mo.label}</Badge></td>
                        <td className="ds-num">{n.cantidad}</td>
                        <td className="ds-num">{n.precioUnitario != null ? money(n.precioUnitario * n.cantidad, o?.currencyCode) : "—"}</td>
                        <td className="ds-body-sm ds-muted">{formatDate(n.fecha)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <main className="page page--wide">
      <div className="page__head">
        <div className="page__title">
          <h1 className="ds-heading">Proveedores</h1>
          <p className="ds-muted">La ficha de cada proveedor tal como está en Business Central, con las notas de crédito que tiene pendientes. Lo que falte (teléfono, correo, cédula) se completa en BC.</p>
        </div>
      </div>

      {error && (
        <div className="ds-callout ds-callout--yellow mt-2" role="status">
          <span className="ds-callout__icon"><IconWarning size={18} /></span>
          <div>
            <div className="ds-callout__title">No se pudieron leer los proveedores de Business Central</div>
            <div className="ds-callout__body">{error.replace(/\.?\s*$/, ".")} Probá de nuevo en un momento; si sigue, avisale a Proveeduría.</div>
          </div>
        </div>
      )}

      {fichas && fichas.length > 0 && (
        <div className="filtros" style={{ marginTop: "var(--ds-space-2)" }}>
          <FiltroChip value={cuentaVista("todos")} label="Todos" onClick={() => setVista("todos")} active={vista === "todos"} />
          <FiltroChip value={cuentaVista("nc")} label="Con NC pendientes" accent="var(--ds-color-red-100)"
            onClick={() => setVista("nc")} active={vista === "nc"} />
          <FiltroChip value={cuentaVista("sinContacto")} label="Sin teléfono ni correo" accent="var(--ds-color-gray-300)"
            title="La ficha de BC no tiene teléfono, celular ni correo: hay que completarla allá."
            onClick={() => setVista("sinContacto")} active={vista === "sinContacto"} />
          {(cuentaVista("bloqueados") > 0 || vista === "bloqueados") && (
            <FiltroChip value={cuentaVista("bloqueados")} label="Bloqueados en BC" accent="var(--ds-color-gray-400)"
              onClick={() => setVista("bloqueados")} active={vista === "bloqueados"} />
          )}
        </div>
      )}

      <div className="mt-4">
        <DataTable
          data={lista}
          columns={columns}
          tablaKey="proveedores-ficha"
          getRowId={(f) => f.codigo}
          columnVisibilityInicial={ocultas}
          loading={fichas === null}
          titulo="Proveedores"
          buscarPlaceholder="Buscar por nombre, código, cédula, teléfono o correo…"
          vacio={vista === "nc" ? "Ningún proveedor tiene notas de crédito pendientes." : "No hay proveedores en esta vista."}
          renderExpanded={fichaCompleta}
        />
      </div>
    </main>
  );
}
