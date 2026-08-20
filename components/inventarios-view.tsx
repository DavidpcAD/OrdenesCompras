"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table";
import { IconWarning } from "@/components/icons";
import { useStore } from "@/lib/store";
import { money, num } from "@/lib/helpers";

type Row = { code: string; descripcion: string; unidad: string; precioReferencia: number; recibido: number };
type ItemLite = { code: string; descripcion: string; unidad: string; lastDirectCost?: number };
type Existencia = { itemNo: string; variantCode: string; locationCode: string; descripcion: string; cantidad: number; unidad: string };
type StockInfo = { total: number; detalle: Existencia[] };

// Cuántos artículos por página del catálogo. Chico para que la primera pintada sea
// casi inmediata; el resto entra solo, sin que la pantalla se sienta trabada.
const TAM_PAGINA = 250;
// Consultas de stock en paralelo. Es una por ALMACÉN, y hay uno por obra (~220):
// de a 8 el barrido baja de minutos a segundos sin ahogar a BC.
const CONCURRENCIA = 8;
// No re-barrer el stock si se acaba de hacer (cambiar de pestaña no debe disparar
// 220 consultas cada vez).
const MIN_ENTRE_BARRIDOS = 60_000;
const REFRESCO_MS = 5 * 60_000;

// ¿Es un almacén FÍSICO (bodega) o el almacén virtual de una obra? Mismo criterio
// que `almacenesFisicos` en lib/helpers: los físicos son ALM-*.
const esFisico = (codigo: string) => codigo.toUpperCase().startsWith("ALM-");

// Catálogo COMPLETO de artículos de Business Central con su stock total, en una
// sola tabla. Al expandir una fila se ve el desglose por almacén y variante.
//
// Se carga POR BLOQUES a propósito: el catálogo tiene 5000+ artículos y el stock
// sale de una consulta por almacén (uno por obra). Antes no se dibujaba NADA hasta
// tener todo — la pantalla parecía colgada y las celdas eran puro esqueleto. Ahora:
//   1. entran las primeras páginas del catálogo y la tabla ya se puede usar/buscar,
//   2. el stock se va sumando y se pinta a medida que llega, empezando por los
//      almacenes de bodega (ALM-*), que es lo que la gente viene a ver,
//   3. al volver a la pestaña se re-barre en silencio, para que esté al día.
// Compartido por Ingeniería y Proveeduría (cambia solo el AppShell que lo envuelve).
export function InventariosView({ tablaKey = "inventarios" }: { tablaKey?: string }) {
  const { articulos, ordenes } = useStore();

  // Liveness por GENERACIÓN, no por un booleano: cada carga se queda con su número
  // y se detiene sola en cuanto arranca otra (o se desmonta la pantalla). Con un
  // candado booleano, el doble montaje de React en desarrollo dejaba al primer
  // barrido marcando "ocupado" y al segundo saliéndose sin hacer nada: el stock no
  // se cargaba NUNCA.
  const genCatalogo = useRef(0);
  const genCostos = useRef(0);
  const genStock = useRef(0);
  const enCurso = useRef(false);
  const ultimoBarridoRef = useRef<number | null>(null);
  const flushPend = useRef(false);

  // ---------------------------------------------------------------- catálogo
  const [items, setItems] = useState<ItemLite[] | null>(null);
  const [catalogoCompleto, setCatalogoCompleto] = useState(false);
  const [catalogoError, setCatalogoError] = useState(false);

  const cargarCatalogo = useCallback(async () => {
    const mi = ++genCatalogo.current;
    const vivo = () => genCatalogo.current === mi;
    const acc: ItemLite[] = [];
    for (let pagina = 0; pagina < 60; pagina++) {
      if (!vivo()) return;
      let d: any;
      try {
        const r = await fetch(`/api/bc/items?top=${TAM_PAGINA}&skip=${pagina * TAM_PAGINA}`);
        if (!r.ok) throw new Error(String(r.status));
        d = await r.json();
      } catch {
        // Si falla la PRIMERA página no hay catálogo que mostrar (se cae al local);
        // si falla una del medio, nos quedamos con lo que ya entró.
        if (!acc.length) setCatalogoError(true);
        break;
      }
      const lote: ItemLite[] = (Array.isArray(d.items) ? d.items : []).map((i: any) => ({
        code: i.code, descripcion: i.descripcion, unidad: i.unidad || "UND",
        lastDirectCost: typeof i.lastDirectCost === "number" ? i.lastDirectCost : undefined,
      }));
      if (!lote.length) break;
      acc.push(...lote);
      if (!vivo()) return;
      setItems([...acc]);          // se pinta lo que ya llegó
      if (!d.hayMas) break;
    }
    if (vivo()) setCatalogoCompleto(true);
  }, []);

  // Precio de la ÚLTIMA COMPRA por artículo. Va aparte del catálogo porque BC no lo
  // trae en `items` (ahí el costo viene en 0 para todo) y porque no debe retrasar la
  // primera pintada: cuando llega, la columna se rellena sola.
  const [costos, setCostos] = useState<Record<string, number>>({});
  const cargarCostos = useCallback(async () => {
    const mi = ++genCostos.current;   // contador PROPIO: si comparte el del catálogo, lo cancela
    try {
      const r = await fetch("/api/bc/ultimos-costos");
      if (!r.ok) return;
      const d = await r.json();
      if (genCostos.current === mi && d.costos) setCostos(d.costos);
    } catch { /* la columna queda como estaba */ }
  }, []);

  // ------------------------------------------------------------------- stock
  const [stock, setStock] = useState<Record<string, StockInfo>>({});
  const [avance, setAvance] = useState<{ hechos: number; total: number } | null>(null);
  const [stockError, setStockError] = useState(false);
  const [ultimoBarrido, setUltimoBarrido] = useState<number | null>(null);

  // Pintar el parcial sin re-renderizar en cada respuesta (son ~220): se agrupa.
  const pintarParcial = (mapa: Record<string, StockInfo>) => {
    if (flushPend.current) return;
    flushPend.current = true;
    setTimeout(() => { flushPend.current = false; setStock({ ...mapa }); }, 200);
  };

  const barrerStock = useCallback(async (incremental: boolean) => {
    const mi = ++genStock.current;
    const vivo = () => genStock.current === mi;
    enCurso.current = true;
    try {
      let locs: string[] = [];
      try {
        const r = await fetch("/api/bc/almacenes");
        const d = await r.json().catch(() => ({}));
        locs = Array.isArray(d.almacenes) ? d.almacenes.map((a: any) => a.codigo).filter(Boolean) : [];
      } catch { /* sin BC */ }
      if (!vivo()) return;
      if (!locs.length) { setStockError(true); setAvance(null); return; }

      // Bodega primero, obras después: así los números que importan aparecen ya.
      const orden = [...locs].sort((a, b) => Number(esFisico(b)) - Number(esFisico(a)));
      const acumulado: Record<string, StockInfo> = {};
      let hechos = 0, okAlguno = false, i = 0;
      if (incremental) setAvance({ hechos: 0, total: orden.length });

      const worker = async () => {
        while (vivo() && i < orden.length) {
          const loc = orden[i++];
          try {
            const r = await fetch(`/api/bc/existencias?locationCode=${encodeURIComponent(loc)}`);
            const d = await r.json().catch(() => ({}));
            if (r.ok) {
              okAlguno = true;
              for (const e of (d.existencias ?? []) as Existencia[]) {
                const it = e.itemNo; if (!it) continue;
                const cant = Number(e.cantidad) || 0;
                if (!acumulado[it]) acumulado[it] = { total: 0, detalle: [] };
                acumulado[it].total += cant;
                if (cant !== 0) acumulado[it].detalle.push(e);
              }
            }
          } catch { /* salta este almacén */ }
          hechos++;
          if (!vivo()) return;
          if (incremental) { setAvance({ hechos, total: orden.length }); pintarParcial(acumulado); }
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONCURRENCIA, orden.length) }, worker));
      if (!vivo()) return;
      setStock({ ...acumulado });      // total definitivo (también en modo silencioso)
      setStockError(!okAlguno);
      setAvance(null);
      setUltimoBarrido(Date.now());
      ultimoBarridoRef.current = Date.now();
    } finally {
      enCurso.current = false;
    }
  }, []);

  // Carga inicial: catálogo y stock arrancan a la vez (no se esperan entre sí).
  useEffect(() => {
    cargarCatalogo();
    cargarCostos();
    barrerStock(true);
    // Al desmontar, se invalidan: los fetch en vuelo ya no tocan estado.
    return () => { genCatalogo.current++; genCostos.current++; genStock.current++; };
  }, [cargarCatalogo, cargarCostos, barrerStock]);

  // Siempre al día: al volver a la pestaña y cada 5 min se re-barre EN SILENCIO
  // (sin borrar lo que se ve ni mostrar la barra de progreso). Si el último barrido
  // fue hace menos de un minuto, no se repite.
  useEffect(() => {
    const refrescar = () => {
      if (document.hidden || enCurso.current) return;
      if (ultimoBarridoRef.current && Date.now() - ultimoBarridoRef.current < MIN_ENTRE_BARRIDOS) return;
      barrerStock(false);
      if (catalogoError) cargarCatalogo();   // reintentar el catálogo si falló
    };
    const id = setInterval(refrescar, REFRESCO_MS);
    document.addEventListener("visibilitychange", refrescar);
    window.addEventListener("focus", refrescar);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", refrescar);
      window.removeEventListener("focus", refrescar);
    };
  }, [barrerStock, cargarCatalogo, catalogoError]);

  // En pantalla angosta (tablet vertical) la tabla no cabe y el STOCK — que es lo
  // que la gente viene a ver — quedaba fuera, solo alcanzable con scroll horizontal.
  // Ahí se muestran únicamente las columnas que importan: la unidad ya va dentro de
  // la celda de stock ("2 225,8 KG") y "Recibido (app)" es dato secundario.
  const [angosto, setAngosto] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1100px)");
    const on = () => setAngosto(mq.matches);
    on();
    // `resize` además del `change` del media query: girar la tablet tiene que
    // reacomodar las columnas, y hay entornos donde el `change` no llega.
    mq.addEventListener("change", on);
    window.addEventListener("resize", on);
    return () => { mq.removeEventListener("change", on); window.removeEventListener("resize", on); };
  }, []);

  // ------------------------------------------------------------------- filas
  const recibidoMap = useMemo(() => {
    const rec = new Map<string, number>();
    for (const o of ordenes) for (const l of o.lineas) {
      if (l.tipo === "articulo" && l.articuloId) rec.set(l.articuloId, (rec.get(l.articuloId) ?? 0) + (l.cantidadRecibida ?? 0));
    }
    return rec;
  }, [ordenes]);
  const artByCode = useMemo(() => { const m = new Map<string, any>(); for (const a of articulos) m.set(a.code, a); return m; }, [articulos]);

  const rows = useMemo<Row[]>(() => {
    // Mientras entra la primera página, la tabla muestra su propio esqueleto (no el
    // catálogo local: cambiar 8 filas de prueba por 5000 reales se veía como un salto).
    const base: ItemLite[] = items ?? (catalogoError
      ? articulos.map((a) => ({ code: a.code, descripcion: a.descripcion, unidad: a.unidad }))
      : []);
    return base.map((b) => {
      const a = artByCode.get(b.code);
      return {
        code: b.code,
        descripcion: b.descripcion,
        unidad: b.unidad,
        // Lo que de verdad se pagó la última vez manda sobre el precio de catálogo.
        precioReferencia: costos[b.code] ?? a?.precioReferencia ?? b.lastDirectCost ?? 0,
        recibido: recibidoMap.get(b.code) ?? 0,
      };
    });
  }, [items, catalogoError, articulos, artByCode, recibidoMap, costos]);

  // Mientras se suman almacenes, el total es PARCIAL: se muestra apagado (no en
  // verde) y el título dice por dónde va. Un número que crece sin avisar engaña.
  const parcial = avance !== null;
  const tituloParcial = parcial ? `Parcial: ${avance!.hechos} de ${avance!.total} almacenes sumados` : undefined;

  const columns = useMemo<ColumnDef<Row, any>[]>(() => [
    { id: "code", header: "Código", accessorFn: (a) => a.code, meta: { label: "Código" }, cell: (c) => <span className="ds-strong">{c.getValue()}</span> },
    { id: "desc", header: "Descripción", accessorFn: (a) => a.descripcion, meta: { label: "Descripción" },
      cell: (c) => <div className="ds-truncate" title={c.getValue()} style={{ maxWidth: angosto ? 132 : 340 }}>{c.getValue()}</div> },
    ...(angosto ? [] : [{ id: "unidad", header: "Unidad", accessorFn: (a: Row) => a.unidad, meta: { label: "Unidad" }, cell: (c: any) => c.getValue() }]),
    {
      id: "stock", header: "Stock (BC)", accessorFn: (a) => stock[a.code]?.total ?? 0,
      meta: { label: "Stock (BC)", num: true }, enableColumnFilter: false,
      cell: (c) => {
        const a = c.row.original as Row;
        if (stockError) return <span className="ds-muted" title="Business Central no respondió">s/d</span>;
        const info = stock[a.code];
        if (!info && parcial) return <span className="ds-muted" title={tituloParcial}>…</span>;
        const v = info?.total ?? 0;
        return (
          <span className="ds-strong" title={tituloParcial}
            style={{ color: parcial ? "var(--ds-color-gray-400)" : v > 0 ? "var(--ds-color-green-300)" : "var(--ds-color-gray-400)" }}>
            {num.format(v)} {a.unidad}
          </span>
        );
      },
    },
    { id: "precio", header: angosto ? "Últ. compra" : "Última compra", accessorFn: (a) => a.precioReferencia, meta: { label: "Última compra", num: true }, enableColumnFilter: false,
      cell: (c) => { const v = c.getValue() as number; return v > 0 ? money(v, "CRC") : <span className="ds-muted" title="No hay compras registradas de este artículo">—</span>; } },
    ...(angosto ? [] : [{ id: "recibido", header: "Recibido (app)", accessorFn: (a: Row) => a.recibido, meta: { label: "Recibido (app)", num: true }, enableColumnFilter: false, cell: (c: any) => num.format(c.getValue()) }]),
  ], [stock, stockError, parcial, tituloParcial, angosto]);

  // Desglose por almacén/variante al expandir la fila (solo ubicaciones con stock).
  const renderExpanded = (a: Row) => {
    if (stockError) return <div className="ds-body-sm" style={{ padding: "6px 2px", color: "var(--ds-color-red-200)" }}>No se pudo cargar el stock de BC. Puede que <code>inventoryByLocation</code> no esté publicado o no haya conexión.</div>;
    const info = stock[a.code];
    if (!info && parcial) return <div className="ds-muted ds-body-sm" style={{ padding: "6px 2px" }}>Buscando existencias… ({avance!.hechos} de {avance!.total} almacenes)</div>;
    const det = (info?.detalle ?? []).filter((e) => Number(e.cantidad) !== 0).sort((x, y) => y.cantidad - x.cantidad);
    if (!det.length) return <div className="ds-muted ds-body-sm" style={{ padding: "6px 2px" }}>Sin existencias en ninguna ubicación.{parcial ? " (todavía sumando almacenes)" : ""}</div>;
    return (
      <div className="ds-table-wrap" style={{ boxShadow: "none" }}>
        <table className="ds-table">
          <thead>
            <tr><th>Almacén</th><th>Variante</th><th className="ds-num">Disponible</th><th>Unidad</th></tr>
          </thead>
          <tbody>
            {det.map((e, i) => (
              <tr key={`${e.locationCode}-${e.variantCode}-${i}`}>
                <td className="ds-strong">{e.locationCode || "—"}</td>
                <td>{e.variantCode || "(sin variante)"}</td>
                <td className="ds-num ds-strong" style={{ color: "var(--ds-color-green-300)" }}>{num.format(e.cantidad)}</td>
                <td className="ds-muted">{e.unidad || a.unidad}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  const pct = avance && avance.total ? Math.round((avance.hechos / avance.total) * 100) : 0;

  return (
    <main className="page page--wide">
      <div className="page__head">
        <div className="page__title">
          <h1 className="ds-heading">Inventarios</h1>
          <p className="ds-muted">Todos los artículos de Business Central con su <strong>stock total</strong>. Expandí un material (⌄) para ver en <strong>qué almacenes y variantes</strong> tiene existencias (almacén general o el almacén virtual de cada obra).</p>
        </div>
      </div>

      {/* Estado de la carga, en una línea: la tabla ya se puede usar mientras el
          stock se sigue sumando. Antes esto era un esqueleto en CADA celda. */}
      <div className="inv-estado mt-4" role="status" aria-live="polite">
        {avance ? (
          <>
            <span className="inv-barra" aria-hidden><i style={{ width: `${pct}%` }} /></span>
            <span className="ds-body-sm ds-muted">
              Sumando stock: <span className="ds-strong">{avance.hechos}</span> de {avance.total} almacenes
              {!catalogoCompleto && items ? ` · catálogo ${num.format(items.length)} artículos y contando` : ""}
            </span>
          </>
        ) : !catalogoCompleto && items ? (
          <span className="ds-body-sm ds-muted">Cargando catálogo… {num.format(items.length)} artículos</span>
        ) : ultimoBarrido ? (
          <span className="ds-body-sm ds-muted">
            Stock al día · {new Date(ultimoBarrido).toLocaleTimeString("es-CR", { hour: "2-digit", minute: "2-digit" })}
            {items ? ` · ${num.format(items.length)} artículos` : ""}
          </span>
        ) : null}
      </div>

      {/* Decirlo una vez arriba: la columna llena de "s/d" no se explica sola (el
          motivo estaba solo en el title de cada celda). */}
      {stockError && (
        <div className="ds-callout ds-callout--yellow mt-4" role="status">
          <span className="ds-callout__icon"><IconWarning size={18} /></span>
          <div>
            <div className="ds-callout__title">No se pudo consultar el stock en Business Central</div>
            <div className="ds-callout__body">La columna <span className="ds-strong">Stock (BC)</span> queda en “s/d”. El resto del catálogo (código, descripción, precio de referencia) sí es válido.</div>
          </div>
        </div>
      )}

      <div className="mt-4 ds-reveal">
        <DataTable data={rows} columns={columns} tablaKey={tablaKey} buscarPlaceholder="Buscar por código o descripción…"
          getRowId={(a) => a.code} renderExpanded={renderExpanded} loading={items === null && !catalogoError}
          vacio="Sin artículos en el catálogo." />
      </div>
    </main>
  );
}
