"use client";

// DESTINO de una línea de orden: UNA cosa, no dos.
//
// Ingeniería pide cada material de una de dos formas, y son excluyentes:
//   · CONSUMO DIRECTO (CD): se carga contra una OBRA y su TAREA. BC lo mete al
//     presupuesto de la obra y el inventario NO sube  -> se muestra obra + tarea.
//   · A ALMACÉN (ALM): entra al inventario del almacén / centro de costo elegido
//     -> se muestra el almacén y nada más.
//
// Lo que decide cuál de las dos es, es la TAREA (`esConsumoDirecto` en
// lib/helpers.ts): una compra para stock igual dice para qué obra es, así que la
// obra sola no significa consumo. Antes la celda mostraba las dos cosas pegadas
// ("ALM-GRAL / Sin obra · entra al almacén"), y se leían como dos destinos donde
// hay uno solo.
//
// El almacén de una línea de consumo directo no se pierde: va en el `title` (a BC
// igual le viaja como locationCode, pero no es lo que Proveeduría necesita ver).
export function DestinoLinea({
  almacen = "",
  almacenNombre = "",
  obra = "",
  obraNombre = "",
  tarea = "",
  tareaNombre = "",
  avisarSinTarea = true,
  inline = false,
}: {
  almacen?: string;
  almacenNombre?: string;
  obra?: string;          // Job No. — solo lo lleva el consumo directo
  obraNombre?: string;
  tarea?: string;         // Job Task No.
  tareaNombre?: string;
  avisarSinTarea?: boolean; // false donde la línea ya no se puede corregir ahí
  inline?: boolean;         // una sola línea de texto (celdas angostas, móvil)
}) {
  const alm = (almacen ?? "").trim();
  const job = (obra ?? "").trim();
  const task = (tarea ?? "").trim();

  if (job) {
    const title = [
      obraNombre ? `Obra ${job} — ${obraNombre}` : `Obra ${job}`,
      task ? `Tarea ${task}${tareaNombre ? ` — ${tareaNombre}` : ""}` : "",
      alm ? `Entra al almacén ${alm}` : "",
    ].filter(Boolean).join(" · ");
    const sinTarea = avisarSinTarea ? <span className="ds-pending-text">sin tarea</span> : null;
    if (inline) {
      return (
        <span title={title}>
          Obra <span className="ds-strong">{job}</span>
          {task ? <> · tarea {task}</> : sinTarea ? <> · {sinTarea}</> : null}
        </span>
      );
    }
    return (
      <div title={title}>
        <div><span className="ds-muted">Obra</span> <span className="ds-strong">{job}</span></div>
        {obraNombre && <div className="ds-muted ds-clamp-2">{obraNombre}</div>}
        {task
          ? <div className="ds-muted ds-clamp-2">Tarea <span className="ds-strong">{task}</span>{tareaNombre ? ` — ${tareaNombre}` : ""}</div>
          : sinTarea && <div>{sinTarea}</div>}
      </div>
    );
  }

  const titleAlm = almacenNombre ? `${alm} — ${almacenNombre}` : alm;
  if (inline) return <span title={titleAlm}>{alm || "—"}</span>;
  return (
    <div title={titleAlm}>
      <div className="ds-strong">{alm || "—"}</div>
      {almacenNombre && <div className="ds-muted ds-clamp-2">{almacenNombre}</div>}
    </div>
  );
}
