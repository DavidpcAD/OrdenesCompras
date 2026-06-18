"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/shell";
import { Badge, Button, Card, Field, Input, Select, Textarea, useToast } from "@/components/ui";
import { IconTrash } from "@/components/icons";
import { Combobox } from "@/components/combobox";
import { useStore } from "@/lib/store";
import { num } from "@/lib/helpers";
import type { Almacen, Articulo, Obra, Pedido, TipoSolicitud } from "@/lib/types";

interface DraftLine {
  key: string;
  articuloId: string;
  almacen: string;
  cantidad: string;
}

export default function NuevaSolicitudPage() {
  const { articulos, obras, maquinas, almacenes, addPedido } = useStore();
  const router = useRouter();
  const toast = useToast();

  // ---- catálogo desde Business Central (con respaldo al de ejemplo) ----
  const [bcArt, setBcArt] = useState<Articulo[] | null>(null);
  const [bcObras, setBcObras] = useState<Obra[] | null>(null);
  const [bcAlm, setBcAlm] = useState<Almacen[] | null>(null);
  const [fuente, setFuente] = useState<"cargando" | "bc" | "ejemplo">("cargando");

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const ri = await fetch("/api/bc/items");
        if (!ri.ok) throw new Error("bc");
        const items: Articulo[] = ((await ri.json()).items ?? []).map((i: any) => ({
          id: i.id, code: i.code, descripcion: i.descripcion, unidad: i.unidad || "UND",
          almacenDefault: "", precioReferencia: 0, tipo: "inventario" as const,
        }));
        const [ro, ra] = await Promise.all([fetch("/api/bc/obras"), fetch("/api/bc/almacenes")]);
        const obrasBc: Obra[] = ro.ok ? ((await ro.json()).obras ?? []) : [];
        const almBc: Almacen[] = ra.ok ? ((await ra.json()).almacenes ?? []) : [];
        if (cancel) return;
        if (items.length) { setBcArt(items); setFuente("bc"); } else setFuente("ejemplo");
        if (obrasBc.length) setBcObras(obrasBc);
        if (almBc.length) setBcAlm(almBc);
      } catch {
        if (!cancel) setFuente("ejemplo");
      }
    })();
    return () => { cancel = true; };
  }, []);

  const catArticulos = bcArt ?? articulos;
  const catObras = bcObras ?? obras;
  const catAlmacenes = bcAlm ?? almacenes;

  const [tipo, setTipo] = useState<TipoSolicitud>("material");
  const [obraId, setObraId] = useState("");
  const [maquinaId, setMaquinaId] = useState("");
  const [solicitante, setSolicitante] = useState("Laura Jiménez");
  const [prioridad, setPrioridad] = useState<Pedido["prioridad"]>("normal");
  const [notas, setNotas] = useState("");
  const [lineas, setLineas] = useState<DraftLine[]>([]);

  // catálogo filtrado: repuestos (R..) vs materiales
  const catalogo = useMemo(
    () => catArticulos.filter((a) => (tipo === "repuesto" ? a.code.startsWith("R") : !a.code.startsWith("R"))),
    [catArticulos, tipo]
  );

  // ---- alta rápida ----
  const [qaArticuloId, setQaArticuloId] = useState("");
  const [qaQuery, setQaQuery] = useState("");
  const [qaAlmacen, setQaAlmacen] = useState("");
  const [qaCantidad, setQaCantidad] = useState("");
  const [qaOpen, setQaOpen] = useState(false);
  const cantRef = useRef<HTMLInputElement>(null);

  const q = qaQuery.trim().toLowerCase();
  const sugerencias = useMemo(() => {
    const base = q
      ? catalogo.filter((a) => a.code.toLowerCase().includes(q) || a.descripcion.toLowerCase().includes(q))
      : catalogo;
    return base.slice(0, 50);
  }, [catalogo, q]);

  function elegir(a: Articulo) {
    setQaArticuloId(a.id);
    setQaQuery(`${a.code} — ${a.descripcion}`);
    setQaAlmacen(a.almacenDefault || "");
    setQaOpen(false);
    setTimeout(() => cantRef.current?.focus(), 0);
  }

  const qaArticulo = catArticulos.find((a) => a.id === qaArticuloId);
  const puedeAgregar = !!qaArticuloId && Number(qaCantidad) > 0;

  function agregar() {
    if (!puedeAgregar) return;
    setLineas((ls) => [
      { key: Math.random().toString(36).slice(2), articuloId: qaArticuloId, almacen: qaAlmacen || qaArticulo?.almacenDefault || "", cantidad: qaCantidad },
      ...ls,
    ]);
    setQaArticuloId(""); setQaQuery(""); setQaAlmacen(""); setQaCantidad(""); setQaOpen(false);
  }
  function removeLine(key: string) {
    setLineas((ls) => ls.filter((l) => l.key !== key));
  }
  function cambiarTipo(t: TipoSolicitud) {
    if (t === tipo) return;
    setTipo(t);
    setLineas([]);
    setQaArticuloId(""); setQaQuery(""); setQaAlmacen(""); setQaCantidad("");
  }

  const destinoOk = tipo === "material" ? !!obraId : !!maquinaId;
  const puedeGuardar = destinoOk && solicitante.trim() && lineas.length > 0;

  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    if (!puedeGuardar) {
      toast(`Indicá ${tipo === "material" ? "la obra" : "la máquina"} y al menos un ${tipo === "material" ? "material" : "repuesto"}.`, "error");
      return;
    }
    const obra = catObras.find((o) => o.id === obraId);
    const maquina = maquinas.find((m) => m.id === maquinaId);
    setGuardando(true);
    try {
      const p = await addPedido({
        tipoSolicitud: tipo,
        obraCodigo: tipo === "material" ? obra?.codigo : undefined,
        obraNombre: tipo === "material" ? obra?.nombre : undefined,
        maquinaNo: tipo === "repuesto" ? maquina?.no : undefined,
        maquinaNombre: tipo === "repuesto" ? maquina?.nombre : undefined,
        solicitante: solicitante.trim(),
        prioridad,
        notas: notas.trim() || undefined,
        lineas: lineas.map((l) => {
          const a = catArticulos.find((x) => x.id === l.articuloId)!;
          return {
            articuloId: a.id, descripcion: a.descripcion, cantidad: Number(l.cantidad),
            unidad: a.unidad, almacen: l.almacen || a.almacenDefault,
          };
        }),
      });
      toast(`Solicitud ${p.numero} creada`, "success");
      router.push(`/ingenieria/${p.id}`);
    } catch (e: any) {
      toast(String(e?.message ?? e), "error");
      setGuardando(false);
    }
  }

  return (
    <AppShell role="ingenieria">
      <main className="page">
        <div className="back-link" onClick={() => router.push("/ingenieria")}>‹ Volver a solicitudes</div>
        <div className="page__head">
          <div className="page__title">
            <h1 className="ds-heading">Nueva solicitud</h1>
            <p className="ds-muted">Indicá el destino y agregá los materiales que necesitás.</p>
          </div>
        </div>

        <Card>
          {/* toggle material / repuesto */}
          <div className="row gap-3" style={{ marginBottom: 20 }}>
            <button type="button" className={`role-option ${tipo === "material" ? "is-selected" : ""}`}
              style={{ flex: 1, padding: "12px 16px" }} onClick={() => cambiarTipo("material")}>
              <span className="col" style={{ gap: 2 }}>
                <span className="role-option__title">Material</span>
                <span className="role-option__desc">Va a una obra</span>
              </span>
            </button>
            <button type="button" className={`role-option ${tipo === "repuesto" ? "is-selected" : ""}`}
              style={{ flex: 1, padding: "12px 16px" }} onClick={() => cambiarTipo("repuesto")}>
              <span className="col" style={{ gap: 2 }}>
                <span className="role-option__title">Repuesto</span>
                <span className="role-option__desc">Va a una máquina</span>
              </span>
            </button>
          </div>

          <div className="grid-2">
            {tipo === "material" ? (
              <Field label="Obra destino">
                <Combobox
                  items={catObras}
                  value={obraId}
                  onChange={(k) => setObraId(k)}
                  getKey={(o) => o.id}
                  getLabel={(o) => `${o.codigo} — ${o.nombre}`}
                  placeholder="Buscar obra por código o nombre…"
                />
              </Field>
            ) : (
              <Field label="Máquina destino">
                <Combobox
                  items={maquinas}
                  value={maquinaId}
                  onChange={(k) => setMaquinaId(k)}
                  getKey={(m) => m.id}
                  getLabel={(m) => `${m.no} — ${m.nombre}`}
                  placeholder="Buscar máquina…"
                />
              </Field>
            )}
            <Field label="Solicitante">
              <Input value={solicitante} onChange={(e) => setSolicitante(e.target.value)} />
            </Field>
            <Field label="Prioridad">
              <Select value={prioridad} onChange={(e) => setPrioridad(e.target.value as Pedido["prioridad"])}>
                <option value="normal">Normal</option>
                <option value="alta">Alta</option>
                <option value="urgente">Urgente</option>
              </Select>
            </Field>
            <Field label="Notas (opcional)">
              <Textarea value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Indicaciones para proveeduría…" />
            </Field>
          </div>
        </Card>

        <Card className="mt-4">
          <div className="row row--between" style={{ marginBottom: 4 }}>
            <h3 className="ds-subtitle">{tipo === "material" ? "Materiales" : "Repuestos"}</h3>
            {fuente === "bc" ? <Badge tone="green">Catálogo: Business Central</Badge>
              : fuente === "ejemplo" ? <Badge tone="gray">Catálogo de ejemplo</Badge>
              : <span className="ds-muted ds-body-sm">Cargando catálogo…</span>}
          </div>
          <p className="ds-muted ds-body-sm" style={{ marginBottom: 16 }}>
            Buscá el {tipo === "material" ? "material" : "repuesto"}, elegí almacén y cantidad, y agregalo. Se van sumando a la lista.
          </p>

          {/* alta rápida */}
          <div className="qa-row">
            <div className="qa-field">
              <label>{tipo === "material" ? "Material" : "Repuesto"}</label>
              <div className="combo">
                <input
                  className="ds-form-field__input"
                  placeholder="Buscar por código o nombre…"
                  value={qaQuery}
                  onChange={(e) => { setQaQuery(e.target.value); setQaArticuloId(""); setQaOpen(true); }}
                  onFocus={() => setQaOpen(true)}
                  onBlur={() => setTimeout(() => setQaOpen(false), 150)}
                />
                {qaOpen && (
                  <div className="combo__menu">
                    {sugerencias.length === 0 && <div className="combo__empty">Sin coincidencias.</div>}
                    {sugerencias.map((a) => (
                      <button key={a.id} type="button" className="combo__item" onMouseDown={(e) => { e.preventDefault(); elegir(a); }}>
                        <strong>{a.code}</strong> — {a.descripcion} <small>· {a.unidad}</small>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="qa-field">
              <label>Almacén</label>
              <Combobox
                items={catAlmacenes}
                value={qaAlmacen}
                onChange={(k) => setQaAlmacen(k)}
                getKey={(a) => a.codigo}
                getLabel={(a) => (a.nombre ? `${a.codigo} — ${a.nombre}` : a.codigo)}
                placeholder="Buscar almacén…"
              />
            </div>
            <div className="qa-field">
              <label>Cantidad{qaArticulo ? ` (${qaArticulo.unidad})` : ""}</label>
              <input ref={cantRef} className="ds-form-field__input" type="number" min={0} value={qaCantidad}
                placeholder="0"
                onChange={(e) => setQaCantidad(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") agregar(); }} />
            </div>
            <Button onClick={agregar} disabled={!puedeAgregar}>+ Agregar</Button>
          </div>

          {/* lista (más reciente primero) */}
          <div className="ds-table-wrap mt-4" style={{ boxShadow: "none", border: "1.5px solid var(--ds-color-gray-100)" }}>
            <table className="ds-table">
              <thead>
                <tr><th style={{ minWidth: 280 }}>{tipo === "material" ? "Artículo" : "Repuesto"}</th><th>Unidad</th><th>Almacén</th><th className="ds-num">Cantidad</th><th></th></tr>
              </thead>
              <tbody>
                {lineas.length === 0 && (
                  <tr><td colSpan={5}><div className="empty" style={{ padding: "28px 0" }}>Todavía no agregaste {tipo === "material" ? "materiales" : "repuestos"}.</div></td></tr>
                )}
                {lineas.map((l) => {
                  const a = catArticulos.find((x) => x.id === l.articuloId);
                  return (
                    <tr key={l.key}>
                      <td><span className="ds-strong">{a?.code}</span> <span className="ds-muted">— {a?.descripcion}</span></td>
                      <td className="ds-muted">{a?.unidad ?? "—"}</td>
                      <td className="ds-muted">{l.almacen}</td>
                      <td className="ds-num ds-strong">{num.format(Number(l.cantidad))}</td>
                      <td><button className="icon-btn" onClick={() => removeLine(l.key)} aria-label="Quitar"><IconTrash /></button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="row gap-3 mt-6" style={{ justifyContent: "flex-end" }}>
          <Button variant="outline" onClick={() => router.push("/ingenieria")}>Cancelar</Button>
          <Button onClick={guardar} disabled={!puedeGuardar || guardando}>{guardando ? "Guardando…" : "Guardar solicitud"}</Button>
        </div>
      </main>
    </AppShell>
  );
}
