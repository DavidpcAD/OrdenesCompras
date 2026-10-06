"use client";
// ── EL ÚLTIMO VISTAZO ANTES DE QUE LA ORDEN SALGA A NOMBRE DE ALGUIEN ─────────
//
// Enviar a aprobación no es guardar: crea el pedido en Business Central a nombre
// del proveedor que diga la orden, y de ahí en adelante todo lo arrastra. Si el
// proveedor está mal, la factura queda cargada a la cuenta por pagar de otro y eso
// ya no se arregla desde la app — necesita nota de crédito de Contabilidad.
//
// Pasó tres veces (CP-005183, CP-005249, CP-005289) y las tres nacieron igual: la
// persona venía de armar otra orden para OTRO proveedor y el selector se quedó con
// el anterior. Ninguna validación lo puede atajar —los dos proveedores existen y
// los dos venden eso—, así que lo único que queda es enseñar el nombre en grande y
// pedir que lo lea antes de mandarlo.
//
// Por eso el diálogo dice el nombre y nada más que lo imprescindible: un diálogo
// lleno de datos se cierra sin leerlo, que es exactamente lo que no se quiere acá.
import { Button, Modal } from "./ui.tsx";

export function ConfirmarProveedor({
  nombre, codigo, resumen, enviando, etiqueta = "Sí, enviar a aprobación", onConfirmar, onCancelar,
}: {
  nombre: string;
  codigo?: string;
  // Línea de contexto: cuántas líneas y por cuánto. Sirve para reconocer la orden,
  // no para revisarla (para eso está la pantalla que quedó atrás).
  resumen?: string;
  enviando?: boolean;
  etiqueta?: string;
  onConfirmar: () => void;
  onCancelar: () => void;
}) {
  return (
    <Modal
      title="¿Es este el proveedor?"
      onClose={onCancelar}
      footer={<>
        <Button variant="outline" onClick={onCancelar} disabled={enviando}>Cancelar</Button>
        <Button loading={enviando} onClick={onConfirmar}>{etiqueta}</Button>
      </>}
    >
      <div className="col gap-2">
        <span className="ds-body-sm ds-muted">La orden se va a enviar a aprobación a nombre de:</span>
        <span className="ds-subtitle-lg">{nombre || "— sin proveedor —"}</span>
        {(codigo || resumen) && (
          <span className="ds-body-sm ds-muted">{[codigo, resumen].filter(Boolean).join(" · ")}</span>
        )}
        <span className="ds-body-sm mt-2" style={{ lineHeight: 1.5 }}>
          Al aprobarse, el pedido y la factura quedan a nombre de este proveedor en Business Central.
          Si está equivocado, cambiarlo después ya no se arregla desde acá: lo tiene que deshacer
          Contabilidad con una nota de crédito.
        </span>
      </div>
    </Modal>
  );
}
