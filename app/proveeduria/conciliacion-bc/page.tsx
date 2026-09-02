"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Button, Card, EmptyState, Field, Input, Tile } from "@/components/ui";
import { IconWarning } from "@/components/icons";
import { formatDate, money } from "@/lib/helpers";

// CONCILIACIÓN CON BUSINESS CENTRAL
//
// Para qué existe: el 2 de septiembre de 2026 se encontró que CP-005172 tenía 7
// líneas en la app y 6 en BC — ₡22.820 de tornillos que el proveedor facturó, que
// nunca entraron al inventario ni a la contabilidad, y que la app daba por recibidos
// al 100%. No se descubrió con una alarma: se descubrió porque alguien puso la
// factura de papel al lado de la pantalla. Esta pantalla hace eso, orden por orden.
//
// Va por tandas porque cada orden son una o dos llamadas a BC: revisar de a 15 y
// seguir es mucho mejor que un botón que se muere a los dos minutos sin decir nada.

type Diferencia = { clase: string; itemNo: string; descripcion: string; importe: number; texto: string };
type Fila = {
  id: string; numero: string; bcNumber: string; fecha: string; proveedor: string;
  estadoOrden: string; moneda: string; estado: string; contra: string; mensaje: string;
  importeEnJuego: number; diferencias: Diferencia[]; facturas: string[];
};
type Resumen = { ok: number; desalineadas: number; sinPedido: number; sinLectura: number; importeEnJuego: number };

function haceTresMeses(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 3);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const TITULO: Record<string, string> = {
  desalineado: "No coincide con BC",
  "sin-pedido": "BC no tiene el pedido",
  "sin-lectura": "No se pudo verificar",
  ok: "Coincide",
};

export default function ConciliacionBcPage() {
  const [desde, setDesde] = useState(haceTresMeses());
  const [corriendo, setCorriendo] = useState(false);
  // El botón de parar se lee con un ref: dentro del while, el valor del useState
  // queda congelado en el del render que arrancó la corrida y el "Parar" no haría nada.
  const pararRef = useRef(false);
  const [parar, setParar] = useState(false);
  const [filas, setFilas] = useState<Fila[]>([]);
  const [resumen, setResumen] = useState<Resumen>({ ok: 0, desalineadas: 0, sinPedido: 0, sinLectura: 0, importeEnJuego: 0 });
  const [revisadas, setRevisadas] = useState(0);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState("");

  async function revisar() {
    setCorriendo(true); setParar(false); pararRef.current = false; setError("");
    setFilas([]); setRevisadas(0); setTotal(0);
    setResumen({ ok: 0, desalineadas: 0, sinPedido: 0, sinLectura: 0, importeEnJuego: 0 });
    let saltar = 0;
    let seguir = true;
    try {
      while (seguir) {
        const r = await fetch(`/api/reportes/conciliacion-bc?desde=${encodeURIComponent(desde)}&limite=15&saltar=${saltar}`, { cache: "no-store" });
        const d = await r.json();
        if (!r.ok) { setError(String(d?.error ?? `Error ${r.status}`)); break; }
        const nuevas: Fila[] = (d.filas ?? []).filter((f: Fila) => f.estado !== "ok");
        setFilas((prev) => [...prev, ...nuevas]);
        setRevisadas(d.revisadas ?? 0);
        setTotal(d.total ?? 0);
        setResumen((prev) => ({
          ok: prev.ok + (d.resumen?.ok ?? 0),
          desalineadas: prev.desalineadas + (d.resumen?.desalineadas ?? 0),
          sinPedido: prev.sinPedido + (d.resumen?.sinPedido ?? 0),
          sinLectura: prev.sinLectura + (d.resumen?.sinLectura ?? 0),
          importeEnJuego: prev.importeEnJuego + (d.resumen?.importeEnJuego ?? 0),
        }));
        saltar = d.revisadas ?? saltar + 15;
        seguir = (d.quedan ?? 0) > 0 && !pararRef.current;
      }
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally { setCorriendo(false); }
  }

  const pct = total ? Math.round((revisadas / total) * 100) : 0;

  return (
    <main className="page page--wide">
      <div className="page__head">
        <div className="page__title">
          <h1 className="ds-heading">Conciliación con Business Central</h1>
          <p className="ds-muted">
            Compara, orden por orden, las líneas de la app contra las del pedido en BC — y, si la orden ya se
            completó (allá el pedido se borra), contra las facturas registradas. Encuentra el material que
            está en una orden y no llegó a BC.
          </p>
        </div>
      </div>

      <Card className="mb-4">
        <div className="row gap-3 wrap" style={{ alignItems: "flex-end" }}>
          <Field label="Órdenes emitidas desde">
            <Input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
          </Field>
          <Button onClick={() => void revisar()} disabled={corriendo}>
            {corriendo ? `Revisando… ${revisadas}/${total}` : "Revisar"}
          </Button>
          {corriendo && <Button variant="outline" disabled={parar} onClick={() => { pararRef.current = true; setParar(true); }}>{parar ? "Parando…" : "Parar al terminar la tanda"}</Button>}
        </div>
        {(corriendo || revisadas > 0) && (
          <div className="mt-2">
            <div className="ds-body-sm ds-muted">{revisadas} de {total} órdenes revisadas ({pct}%)</div>
          </div>
        )}
        {error && <div className="ds-callout ds-callout--red mt-4"><span className="ds-callout__icon"><IconWarning size={18} /></span><div className="ds-callout__body">{error}</div></div>}
      </Card>

      {revisadas > 0 && (
        <div className="tiles mb-4">
          <Tile label="Coinciden" value={String(resumen.ok)} accent="var(--ds-color-green-200)" />
          <Tile label="No coinciden" value={String(resumen.desalineadas)} accent={resumen.desalineadas ? "var(--ds-color-red-200)" : undefined} />
          <Tile label="Sin pedido en BC" value={String(resumen.sinPedido)} accent={resumen.sinPedido ? "var(--ds-color-yellow)" : undefined} />
          <Tile label="Plata en juego" value={money(resumen.importeEnJuego)} accent={resumen.importeEnJuego > 0.01 ? "var(--ds-color-red-200)" : undefined} />
        </div>
      )}

      {!filas.length && !corriendo && revisadas > 0 && (
        <EmptyState title="Todo cuadra" hint="Las órdenes revisadas tienen en Business Central las mismas líneas que acá." />
      )}

      {filas.map((f) => (
        <Card key={f.id} className="mb-4">
          <div className="row gap-3 wrap" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div className="row gap-2">
                <Link href={`/proveeduria/ordenes/${f.id}`} className="ds-strong">{f.bcNumber || f.numero}</Link>
                <span className="ds-muted ds-body-sm">{f.proveedor} · {formatDate(f.fecha)} · {f.estadoOrden}</span>
              </div>
              <div className="ds-body-sm" style={{ marginTop: 4 }}>{f.mensaje}</div>
              {!!f.diferencias.length && (
                <ul style={{ margin: "6px 0 0 18px" }}>
                  {f.diferencias.map((d, i) => <li key={i} className="ds-body-sm">{d.texto}</li>)}
                </ul>
              )}
            </div>
            <div className="col" style={{ alignItems: "flex-end", gap: 2 }}>
              <span className={f.estado === "desalineado" ? "ds-strong" : "ds-muted"}>{TITULO[f.estado] ?? f.estado}</span>
              {f.importeEnJuego > 0.01 && <span className="ds-body-sm">{money(f.importeEnJuego, f.moneda)}</span>}
              {!!f.facturas.length && <span className="ds-body-sm ds-muted">vs {f.facturas.join(", ")}</span>}
            </div>
          </div>
        </Card>
      ))}
    </main>
  );
}
