"use client";

import { IconTrack } from "@/components/icons";
import { ordenAlmacenes, ordenObras } from "@/lib/helpers";
import type { Orden } from "@/lib/types";

// DESTINO de una línea de orden: UNA cosa, no dos.
//
// Ingeniería pide cada material de una de dos formas, y son excluyentes:
//   · CONSUMO DIRECTO (CD): se carga contra una OBRA y su TAREA. BC lo mete al
//     presupuesto de la obra y el inventario NO sube  -> se muestra obra + tarea.
//   · A ALMACÉN (ALM): entra al inventario del almacén / centro de costo elegido
//     -> se muestra el almacén (y debajo, para qué obra se pidió; ver más abajo).
//
// Lo que decide cuál de las dos es, es la TAREA (`esConsumoDirecto` en
// lib/helpers.ts): una compra para stock igual dice para qué obra es, así que la
// obra sola no significa consumo. Antes la celda mostraba las dos cosas pegadas
// ("ALM-GRAL / Sin obra · entra al almacén"), y se leían como dos destinos donde
// hay uno solo.
//
// El almacén de una línea de consumo directo no se pierde: va en el `title` (a BC
// igual le viaja como locationCode, pero no es lo que Proveeduría necesita ver).
//
// La MÁQUINA es aparte de esas dos: no dice a dónde entra el material sino QUÉ
// EQUIPO se lo va a comer (el "N.º máquina" de la línea en BC). Se agrega debajo
// del destino cuando la línea la trae, y una línea la trae solo si alguien se lo
// puso — así que el renglón no aparece en las compras que no son de repuestos.
//
// Y LA CASA (`obraInformativa`) es una tercera cosa, que tampoco es el destino:
// un material que entra al almacén igual se pidió PARA una obra, y el ingeniero la
// eligió al armar el pedido. Esa obra no viaja a BC —sin tarea, BC rechaza el Job
// No.— pero Proveeduría la necesita para saber a qué casa es lo que está comprando
// y para decírselo al proveedor que además instala. Va DEBAJO del almacén y con el
// rótulo "Para obra", que es distinto de "Obra" a propósito: arriba sigue estando
// el destino de verdad, y esto es para quién es. Antes se borraba en el camino y la
// casa desaparecía apenas la línea salía de la solicitud.
export function DestinoLinea({
  almacen = "",
  almacenNombre = "",
  obra = "",
  obraNombre = "",
  obraInformativa = "",
  tarea = "",
  tareaNombre = "",
  maquina = "",
  maquinaNombre = "",
  avisarSinTarea = true,
  inline = false,
}: {
  almacen?: string;
  almacenNombre?: string;
  obra?: string;          // Job No. — solo lo lleva el consumo directo
  obraNombre?: string;
  obraInformativa?: string; // la casa de la solicitud: se muestra, no viaja a BC
  tarea?: string;         // Job Task No.
  tareaNombre?: string;
  maquina?: string;       // N.º máquina (GomEqp) — el equipo que consume el repuesto
  maquinaNombre?: string;
  avisarSinTarea?: boolean; // false donde la línea ya no se puede corregir ahí
  inline?: boolean;         // una sola línea de texto (celdas angostas, móvil)
}) {
  const alm = (almacen ?? "").trim();
  const job = (obra ?? "").trim();
  // Con Job No. la obra YA se ve arriba (es el destino): repetirla abajo sobraría.
  const casa = job ? "" : (obraInformativa ?? "").trim();
  const task = (tarea ?? "").trim();
  const maq = (maquina ?? "").trim();
  const maqNom = (maquinaNombre ?? "").trim();
  const maqTitulo = maq ? `Máquina ${maq}${maqNom ? ` — ${maqNom}` : ""}` : "";
  // El N.º en su renglón y el nombre debajo, igual que la obra y la tarea: en una
  // celda angosta, con las dos cosas juntas el recorte se comía el propio código
  // ("Máquina MAQ00017…"), que es justo el dato que hay que leer.
  const maqBloque = maq ? (
    <div title={maqTitulo}>
      <div className="ds-muted">Máquina <span className="ds-strong">{maq}</span></div>
      {maqNom && maqNom !== maq && <div className="ds-muted ds-clamp-2">{maqNom}</div>}
    </div>
  ) : null;
  const maqInline = maq ? <> · máq. {maq}</> : null;

  if (job) {
    const title = [
      obraNombre ? `Obra ${job} — ${obraNombre}` : `Obra ${job}`,
      task ? `Tarea ${task}${tareaNombre ? ` — ${tareaNombre}` : ""}` : "",
      maqTitulo,
      alm ? `Entra al almacén ${alm}` : "",
    ].filter(Boolean).join(" · ");
    const sinTarea = avisarSinTarea ? <span className="ds-pending-text">sin tarea</span> : null;
    if (inline) {
      return (
        <span title={title}>
          Obra <span className="ds-strong">{job}</span>
          {task ? <> · tarea {task}</> : sinTarea ? <> · {sinTarea}</> : null}
          {maqInline}
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
        {maqBloque}
      </div>
    );
  }

  const titleAlm = [
    almacenNombre ? `${alm} — ${almacenNombre}` : alm,
    casa ? `Pedido para la obra ${casa} — entra al almacén, no se carga al proyecto en BC` : "",
    maqTitulo,
  ].filter(Boolean).join(" · ");
  if (inline) return <span title={titleAlm}>{alm || "—"}{casa ? <> · obra {casa}</> : null}{maqInline}</span>;
  return (
    <div title={titleAlm}>
      <div className="ds-strong">{alm || "—"}</div>
      {almacenNombre && <div className="ds-muted ds-clamp-2">{almacenNombre}</div>}
      {/* El CÓDIGO no se parte: en una celda angosta "OBRA-001" quedaba cortado en
          "OBRA-" y "001", que es justo el dato que hay que leer. El rótulo sí puede
          bajar de renglón. */}
      {casa && <div className="ds-muted">Para obra <span className="ds-strong" style={{ whiteSpace: "nowrap" }}>{casa}</span></div>}
      {maqBloque}
    </div>
  );
}

// DESTINO de la ORDEN entera, para las pantallas de Bodega: "¿a qué almacén entra
// esto?" sin abrir la orden. Los proveedores no traen la OC y el material termina
// descargado donde no toca; con esto, quien recibe lo ve en la tarjeta y en la
// pantalla de registrar. Es el `locationCode` de las líneas de artículo —casi
// siempre uno— y, si la orden se carga como consumo, la obra al lado. El código va
// crudo a propósito (ALM-GRAL): es el que está rotulado en las bodegas y el que usa
// BC; el nombre del catálogo puede no calzar con BC, así que no se adivina.
export function DestinoOrden({ orden, inline = false, className }: {
  orden: Orden;
  inline?: boolean;   // una sola línea de texto, sin ícono (espacios apretados)
  className?: string;
}) {
  const alms = ordenAlmacenes(orden);
  const obras = ordenObras(orden);
  if (!alms.length && !obras.length) return null;
  const masAlm = alms.length > 1 ? ` +${alms.length - 1}` : "";
  const obraTxt = obras.length ? `obra ${obras[0]}${obras.length > 1 ? ` +${obras.length - 1}` : ""}` : "";
  const title = [
    alms.length ? `Recepción en ${alms.join(" · ")}` : "Consumo directo (no entra a bodega)",
    obras.length ? `Se carga como consumo de ${obras.join(" · ")}` : "",
  ].filter(Boolean).join(" · ");
  const texto = (
    <>
      {alms.length
        ? <>Recepción en <span className="ds-strong">{alms[0]}</span>{masAlm}</>
        : <>Consumo directo</>}
      {obraTxt && <span className="ds-muted"> · {obraTxt}</span>}
    </>
  );
  if (inline) return <span className={className} title={title}>{texto}</span>;
  return (
    <span className={`row gap-2${className ? ` ${className}` : ""}`} style={{ alignItems: "center", minWidth: 0 }} title={title}>
      <IconTrack size={14} className="ds-muted" />
      <span>{texto}</span>
    </span>
  );
}
