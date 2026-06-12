"use client";

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import type {
  Articulo, Orden, OrdenLinea, Pedido, PedidoLinea, Proveedor, Recepcion, RecepcionLinea, Role,
} from "./types";
import * as seed from "./seed";
import { nextNumero, ordenEstaCompleta, todayISO } from "./helpers";

interface NewPedidoInput {
  proyecto: string;
  solicitante: string;
  prioridad: Pedido["prioridad"];
  notas?: string;
  lineas: Omit<PedidoLinea, "id" | "cantidadOrdenada">[];
}

interface NewOrdenInput {
  proveedorId: string;
  lineas: Omit<OrdenLinea, "id" | "cantidadRecibida" | "cantidadFacturada">[];
}

interface RegistrarRecepcionInput {
  ordenId: string;
  numeroFactura: string;
  fechaFactura: string;
  fechaRecepcion: string;
  fechaRegistro: string;
  total: number;
  lineas: RecepcionLinea[];
}

interface StoreShape {
  role: Role | null;
  setRole: (r: Role | null) => void;

  proveedores: Proveedor[];
  articulos: Articulo[];
  pedidos: Pedido[];
  ordenes: Orden[];
  recepciones: Recepcion[];

  addPedido: (input: NewPedidoInput) => Pedido;
  updatePedido: (p: Pedido) => void;
  setPedidoEstado: (id: string, estado: Pedido["estado"]) => void;
  deletePedido: (id: string) => void;

  createOrden: (input: NewOrdenInput) => Orden;
  setOrdenEstado: (id: string, estado: Orden["estado"]) => void;

  registrarRecepcion: (input: RegistrarRecepcionInput) => Recepcion;

  reset: () => void;
}

const StoreCtx = createContext<StoreShape | null>(null);
const LS_KEY = "adelante_oc_state_v1";

interface Persisted {
  pedidos: Pedido[];
  ordenes: Orden[];
  recepciones: Recepcion[];
}

function loadInitial(): Persisted {
  if (typeof window !== "undefined") {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) return JSON.parse(raw) as Persisted;
    } catch { /* ignore */ }
  }
  return {
    pedidos: structuredClone(seed.pedidos),
    ordenes: structuredClone(seed.ordenes),
    recepciones: structuredClone(seed.recepciones),
  };
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [role, setRole] = useState<Role | null>(null);
  const [data, setData] = useState<Persisted>(() => ({
    pedidos: structuredClone(seed.pedidos),
    ordenes: structuredClone(seed.ordenes),
    recepciones: structuredClone(seed.recepciones),
  }));
  const [hydrated, setHydrated] = useState(false);

  // hydrate from localStorage after mount (avoids SSR mismatch)
  useEffect(() => {
    setData(loadInitial());
    const r = localStorage.getItem("adelante_oc_role") as Role | null;
    if (r) setRole(r);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(LS_KEY, JSON.stringify(data));
  }, [data, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    if (role) localStorage.setItem("adelante_oc_role", role);
    else localStorage.removeItem("adelante_oc_role");
  }, [role, hydrated]);

  const api = useMemo<StoreShape>(() => {
    const uid = () => Math.random().toString(36).slice(2, 9);

    const addPedido: StoreShape["addPedido"] = (input) => {
      let created!: Pedido;
      setData((d) => {
        const numero = nextNumero("PED", d.pedidos.map((p) => p.numero));
        created = {
          id: uid(), numero, proyecto: input.proyecto, solicitante: input.solicitante,
          fecha: todayISO(), estado: "borrador", prioridad: input.prioridad, notas: input.notas,
          lineas: input.lineas.map((l) => ({ ...l, id: uid(), cantidadOrdenada: 0 })),
        };
        return { ...d, pedidos: [created, ...d.pedidos] };
      });
      return created;
    };

    const updatePedido: StoreShape["updatePedido"] = (p) =>
      setData((d) => ({ ...d, pedidos: d.pedidos.map((x) => (x.id === p.id ? p : x)) }));

    const setPedidoEstado: StoreShape["setPedidoEstado"] = (id, estado) =>
      setData((d) => ({ ...d, pedidos: d.pedidos.map((x) => (x.id === id ? { ...x, estado } : x)) }));

    const deletePedido: StoreShape["deletePedido"] = (id) =>
      setData((d) => ({ ...d, pedidos: d.pedidos.filter((x) => x.id !== id) }));

    const createOrden: StoreShape["createOrden"] = (input) => {
      let created!: Orden;
      setData((d) => {
        const numero = nextNumero("CP", d.ordenes.map((o) => o.numero));
        const lineas: OrdenLinea[] = input.lineas.map((l) => ({
          ...l, id: uid(), cantidadRecibida: 0, cantidadFacturada: 0,
        }));
        created = {
          id: uid(), numero, proveedorId: input.proveedorId, fecha: todayISO(),
          estado: "abierto", versionesArchivadas: 0, lineas,
        };
        // descontar saldo en las líneas de pedido origen + marcar pedido en_orden
        const pedidos = d.pedidos.map((p) => {
          let touched = false;
          const ls = p.lineas.map((pl) => {
            const consumo = lineas
              .filter((ol) => ol.pedidoLineaId === pl.id)
              .reduce((s, ol) => s + ol.cantidad, 0);
            if (consumo > 0) { touched = true; return { ...pl, cantidadOrdenada: pl.cantidadOrdenada + consumo }; }
            return pl;
          });
          if (!touched) return p;
          const sinSaldo = ls.every((pl) => pl.cantidadOrdenada >= pl.cantidad - 1e-9);
          return { ...p, lineas: ls, estado: (sinSaldo ? "en_orden" : "aprobado") as Pedido["estado"] };
        });
        return { ...d, ordenes: [created, ...d.ordenes], pedidos };
      });
      return created;
    };

    const setOrdenEstado: StoreShape["setOrdenEstado"] = (id, estado) =>
      setData((d) => ({ ...d, ordenes: d.ordenes.map((o) => (o.id === id ? { ...o, estado } : o)) }));

    const registrarRecepcion: StoreShape["registrarRecepcion"] = (input) => {
      let created!: Recepcion;
      setData((d) => {
        const orden = d.ordenes.find((o) => o.id === input.ordenId)!;
        const recibidoTotal = orden.lineas.reduce((s, l) => s + l.cantidad, 0);
        const recibidoAhora = input.lineas.reduce((s, l) => s + l.cantidadRecibida, 0);
        created = {
          id: uid(), ordenId: input.ordenId, numeroFactura: input.numeroFactura,
          fechaFactura: input.fechaFactura, fechaRecepcion: input.fechaRecepcion,
          fechaRegistro: input.fechaRegistro, total: input.total, lineas: input.lineas,
          parcial: recibidoAhora < recibidoTotal,
        };
        const ordenes = d.ordenes.map((o) => {
          if (o.id !== input.ordenId) return o;
          const lineas = o.lineas.map((l) => {
            const rl = input.lineas.find((x) => x.ordenLineaId === l.id);
            if (!rl) return l;
            return {
              ...l,
              cantidadRecibida: l.cantidadRecibida + rl.cantidadRecibida,
              cantidadFacturada: l.cantidadFacturada + rl.cantidadRecibida,
            };
          });
          const upd = { ...o, lineas };
          return { ...upd, estado: (ordenEstaCompleta(upd) ? "completado" : upd.estado) as Orden["estado"] };
        });
        return { ...d, ordenes, recepciones: [created, ...d.recepciones] };
      });
      return created;
    };

    const reset: StoreShape["reset"] = () =>
      setData({
        pedidos: structuredClone(seed.pedidos),
        ordenes: structuredClone(seed.ordenes),
        recepciones: structuredClone(seed.recepciones),
      });

    return {
      role, setRole,
      proveedores: seed.proveedores, articulos: seed.articulos,
      pedidos: data.pedidos, ordenes: data.ordenes, recepciones: data.recepciones,
      addPedido, updatePedido, setPedidoEstado, deletePedido,
      createOrden, setOrdenEstado, registrarRecepcion, reset,
    };
  }, [role, data]);

  return <StoreCtx.Provider value={api}>{children}</StoreCtx.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreCtx);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}
