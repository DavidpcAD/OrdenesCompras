import { esLineaRecibible, ordenEsperaCorreccion, pedidoOrdenadoPct } from "./helpers";
import { monedaDe } from "./compras-kpis";
import type { Orden, Pedido } from "./types";

// LO QUE ESTÁ EN LA CANCHA DE PROVEEDURÍA.
//
// El resto del Resumen contesta "cómo vamos"; esto contesta "qué tengo que hacer hoy", que
// es la pregunta que Angie se hace de verdad varias veces al día. Son las cinco paradas
// donde el trabajo se queda quieto esperando a ALGUIEN, y cada una dice a quién:
//
//   · Solicitudes sin orden .......... espera a Proveeduría (hay que comprarlas)
//   · Órdenes abiertas ............... espera a Proveeduría (armadas y sin enviar)
//   · Rechazadas ..................... espera a Proveeduría (corregir y reenviar)
//   · Aprobadas sin mandar ........... espera a Proveeduría (el proveedor no se enteró)
//   · Esperando corrección ........... espera al ingeniero
//
// La cuarta es la que nadie estaba mirando: una orden puede estar aprobada y lanzada en
// BC desde hace una semana y el proveedor no saber que existe, porque el PDF nunca salió.
// El dato ya vivía en la bitácora (`envioProveedor`) y solo se veía como una columna
// dentro de la lista.

export type ItemCancha = {
  clave: string;
  etiqueta: string;
  detalle: string;
  cuenta: number;
  monto: number | null;       // null cuando contar plata no significa nada
  color: string;
  vista: "solicitudes" | "ordenes";
  filtro: string;             // el chip que queda encendido al aterrizar
  deQuien: "vos" | "ingeniero";
};

const importe = (o: Orden) => o.lineas
  .filter(esLineaRecibible)
  .reduce((s, l) => s + l.cantidad * l.precioUnitario * (1 - (l.descuentoPct ?? 0) / 100), 0);

export function loQueEstaEnTuCancha(ordenes: Orden[], pedidos: Pedido[], moneda: string): ItemCancha[] {
  const dela = ordenes.filter((o) => monedaDe(o) === moneda);
  const suma = (lista: Orden[]) => lista.reduce((s, o) => s + importe(o), 0);

  const sinOrden = pedidos.filter(
    (p) => p.estado !== "borrador" && p.estado !== "devuelto" && p.estado !== "cerrado" && pedidoOrdenadoPct(p) === 0,
  );
  const abiertas = dela.filter((o) => o.estado === "abierto" && !ordenEsperaCorreccion(o));
  const esperan = dela.filter(ordenEsperaCorreccion);
  const rechazadas = dela.filter((o) => o.estado === "rechazado");
  // Ya la aprobaron y el proveedor todavía no la tiene. Las completadas no cuentan:
  // si ya llegó todo el material, que el PDF nunca saliera dejó de ser un problema.
  const sinMandar = dela.filter((o) => o.estado === "lanzado" && !o.envioProveedor);

  const items: ItemCancha[] = [
    {
      clave: "sin-orden", etiqueta: "Solicitudes sin orden de compra",
      detalle: "Ingeniería las mandó y nadie las ha comprado",
      cuenta: sinOrden.length, monto: null, color: "var(--ds-color-gray-300)",
      vista: "solicitudes", filtro: "pendiente", deQuien: "vos",
    },
    {
      clave: "abierto", etiqueta: "Órdenes abiertas sin enviar a aprobación",
      detalle: "Armadas acá, todavía no existen en Business Central",
      cuenta: abiertas.length, monto: suma(abiertas), color: "var(--ds-color-gray-300)",
      vista: "ordenes", filtro: "abierto", deQuien: "vos",
    },
    {
      clave: "rechazado", etiqueta: "Rechazadas",
      detalle: "Aprobación las devolvió: corregir y reenviar",
      cuenta: rechazadas.length, monto: suma(rechazadas), color: "var(--ds-color-red-200)",
      vista: "ordenes", filtro: "rechazado", deQuien: "vos",
    },
    {
      clave: "sin-mandar", etiqueta: "Aprobadas sin mandarle al proveedor",
      detalle: "Están lanzadas en BC y el proveedor no se ha enterado",
      cuenta: sinMandar.length, monto: suma(sinMandar), color: "var(--ds-color-yellow)",
      vista: "ordenes", filtro: "lanzado", deQuien: "vos",
    },
    {
      clave: "espera", etiqueta: "Esperando la corrección del ingeniero",
      detalle: "No hay nada que hacer hasta que devuelva el material",
      cuenta: esperan.length, monto: null, color: "var(--ds-color-yellow)",
      vista: "ordenes", filtro: "espera", deQuien: "ingeniero",
    },
  ];

  // Lo que está en cero no se dibuja: una lista de pendientes con filas vacías obliga a
  // leerla entera para descubrir que no hay nada. Si no queda ninguna, el panel lo dice.
  return items.filter((i) => i.cuenta > 0);
}
