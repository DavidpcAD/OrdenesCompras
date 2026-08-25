"use client";

import { useState } from "react";
import { Button, Modal } from "./ui";
import { pesoLegible } from "@/lib/foto";
import type { RecepcionFoto } from "@/lib/types";

// De dónde sale la imagen: en producción la sirve la API por su id; en modo demo
// la foto vive en memoria como dataURL (ver store.guardarFotosRecepcion).
export const fotoSrc = (recepcionId: string, f: RecepcionFoto) =>
  f.url ?? `/api/recepciones/${recepcionId}/foto?foto=${f.id}`;

// Fotos de la factura física de una recepción: tira de miniaturas y, al tocar
// una, la imagen grande. "Abrir imagen" la deja en una pestaña aparte para poder
// hacer zoom con los dedos (leer un total borroso en el celular).
export function FotosFactura({ recepcionId, fotos, compacto }: {
  recepcionId: string;
  fotos?: RecepcionFoto[];
  compacto?: boolean;   // dentro de una tarjeta ya apretada (Recibidas)
}) {
  const [abierta, setAbierta] = useState<number | null>(null);
  if (!fotos?.length) return null;
  const f = abierta != null ? fotos[abierta] : null;
  const src = f ? fotoSrc(recepcionId, f) : "";
  return (
    <div className={`foto-strip${compacto ? " foto-strip--compacto" : ""}`}>
      {fotos.map((x, i) => (
        <button key={x.id} type="button" className="foto-thumb" onClick={() => setAbierta(i)}
          title={`Ver la foto de la factura${x.tamano ? ` (${pesoLegible(x.tamano)})` : ""}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={fotoSrc(recepcionId, x)} alt={`Foto ${i + 1} de la factura`} loading="lazy" />
        </button>
      ))}
      {f && (
        <Modal title={`Foto de la factura${fotos.length > 1 ? ` (${abierta! + 1} de ${fotos.length})` : ""}`}
          wide onClose={() => setAbierta(null)}
          footer={<>
            {fotos.length > 1 && <>
              <Button variant="outline" onClick={() => setAbierta((i) => ((i! - 1 + fotos.length) % fotos.length))}>Anterior</Button>
              <Button variant="outline" onClick={() => setAbierta((i) => ((i! + 1) % fotos.length))}>Siguiente</Button>
            </>}
            <a className="ds-btn ds-btn--white" href={src} target="_blank" rel="noopener noreferrer">Abrir imagen</a>
            <Button variant="green" onClick={() => setAbierta(null)}>Cerrar</Button>
          </>}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="foto-view__img" src={src} alt="Factura del proveedor" />
          {f.tamano ? <p className="ds-body-sm ds-muted" style={{ margin: "8px 0 0" }}>{pesoLegible(f.tamano)}{f.ancho && f.alto ? ` · ${f.ancho}×${f.alto}` : ""}</p> : null}
        </Modal>
      )}
    </div>
  );
}
