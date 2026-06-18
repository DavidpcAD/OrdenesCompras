"use client";

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import type {
  Almacen, Articulo, Maquina, Movimiento, Obra, Orden, OrdenLinea, Pedido, PedidoLinea,
  Proveedor, Recepcion, RecepcionLinea, Role, TipoSolicitud,
} from "./types";
import * as seed from "./seed";
import { nextNumero, nowISO, ordenEstaCompleta, PERSONA_POR_ROL, todayISO } from "./helpers";
import { api, USE_API } from "./api";

export interface NewPedidoInput {
  tipoSolicitud: TipoSolicitud;
  obraCodigo?: string;
  obraNombre?: string;
  maquinaNo?: string;
  maquinaNombre?: string;
  solicitante: string;
  prioridad: Pedido["prioridad"];
  notas?: string;
  lineas: Omit<PedidoLinea, "id" | "cantidadOrdenada">[];
}

interface NewOrdenInput {
  proveedorId: string;
  currencyCode: string;
  fechaRecepEsperada?: string;
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
  cargando: boolean;

  proveedores: Proveedor[];
  articulos: Articulo[];
  obras: Obra[];
  maquinas: Maquina[];
  almacenes: Almacen[];
  pedidos: Pedido[];
  ordenes: Orden[];
  recepciones: Recepcion[];
  movimientos: Movimiento[];

  addPedido: (input: NewPedidoInput) => Promise<Pedido>;
  editPedido: (id: string, input: NewPedidoInput) => Promise<void>;
  updatePedido: (p: Pedido) => void;
  setPedidoEstado: (id: string, estado: Pedido["estado"]) => Promise<void>;
  deletePedido: (id: string) => Promise<void>;

  createOrden: (input: NewOrdenInput) => Promise<Orden>;
  setOrdenEstado: (id: string, estado: Orden["estado"]) => Promise<void>;

  registrarRecepcion: (input: RegistrarRecepcionInput) => Promise<Recepcion>;

  borrador: { pedidoLineaId: string; cantidad: number; precio: number; iva: number }[];
  setBorrador: (items: StoreShape["borrador"]) => void;

  reset: () => void;
}

const StoreCtx = createContext<StoreShape | null>(null);
const LS_KEY = "adelante_oc_state_v3";

interface Persisted {
  pedidos: Pedido[];
  ordenes: Orden[];
  recepciones: Recepcion[];
  movimientos: Movimiento[];
}

function freshData(): Persisted {
  return {
    pedidos: structuredClone(seed.pedidos),
    ordenes: structuredClone(seed.ordenes),
    recepciones: structuredClone(seed.recepciones),
    movimientos: structuredClone(seed.movimientos),
  };
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [role, setRole] = useState<Role | null>(null);
  const [data, setData] = useState<Persisted>(() => freshData());
  const [borrador, setBorrador] = useState<StoreShape["borrador"]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [cargando, setCargando] = useState(USE_API);

  // hidratación
  useEffect(() => {
    const r = localStorage.getItem("adelante_oc_role") as Role | null;
    if (r) setRole(r);
    if (USE_API) {
      api.bootstrap()
        .then((b) => setData({ pedidos: b.pedidos, ordenes: b.ordenes, recepciones: b.recepciones, movimientos: b.movimientos }))
        .catch((e) => console.error("bootstrap", e))
        .finally(() => { setCargando(false); setHydrated(true); });
    } else {
      try {
        const raw = localStorage.getItem(LS_KEY);
        if (raw) setData(JSON.parse(raw) as Persisted);
      } catch { /* ignore */ }
      setHydrated(true);
    }
  }, []);

  // persistencia local solo en modo mock
  useEffect(() => {
    if (!hydrated || USE_API) return;
    localStorage.setItem(LS_KEY, JSON.stringify(data));
  }, [data, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    if (role) localStorage.setItem("adelante_oc_role", role);
    else localStorage.removeItem("adelante_oc_role");
  }, [role, hydrated]);

  async function refreshFromApi() {
    const b = await api.bootstrap();
    setData({ pedidos: b.pedidos, ordenes: b.ordenes, recepciones: b.recepciones, movimientos: b.movimientos });
  }

  const api2 = useMemo<StoreShape>(() => {
    const uid = () => Math.random().toString(36).slice(2, 9);
    const persona = role ? PERSONA_POR_ROL[role] : "Sistema";
    const rolActual: Role = role ?? "ingenieria";
    const mkMov = (m: Omit<Movimiento, "id" | "usuario" | "rol" | "fecha">): Movimiento =>
      ({ id: uid(), usuario: persona, rol: rolActual, fecha: nowISO(), ...m });
    const prov = (id: string) => seed.proveedores.find((p) => p.id === id);

    // ---------------- ADD PEDIDO ----------------
    const addPedido: StoreShape["addPedido"] = async (input) => {
      if (USE_API) {
        const { idPedidoCompra } = await api.createPedido({
          tipoSolicitud: input.tipoSolicitud, obra: input.obraCodigo, obraNombre: input.obraNombre,
          maquinaNo: input.maquinaNo, solicitante: input.solicitante, prioridad: input.prioridad,
          notas: input.notas, usuario: persona, rol: rolActual,
          lineas: input.lineas.map((l) => ({ itemNo: l.articuloId, descripcion: l.descripcion, cantidad: l.cantidad, unidad: l.unidad, almacen: l.almacen, variantCode: l.variantCode })),
        });
        const p = await api.getPedido(String(idPedidoCompra));
        await refreshFromApi();
        return p;
      }
      let created!: Pedido;
      setData((d) => {
        const numero = nextNumero("PED", d.pedidos.map((p) => p.numero));
        created = {
          id: uid(), numero, tipoSolicitud: input.tipoSolicitud,
          obraCodigo: input.obraCodigo, obraNombre: input.obraNombre,
          maquinaNo: input.maquinaNo, maquinaNombre: input.maquinaNombre,
          solicitante: input.solicitante, fecha: todayISO(), estado: "borrador",
          prioridad: input.prioridad, notas: input.notas,
          lineas: input.lineas.map((l) => ({ ...l, id: uid(), cantidadOrdenada: 0 })),
        };
        const mov = mkMov({ entidad: "pedido", idEntidad: created.id, documentoNo: created.numero, tipoMovimiento: "creado", estadoNuevo: "borrador", detalle: `${created.lineas.length} línea(s)` });
        return { ...d, pedidos: [created, ...d.pedidos], movimientos: [mov, ...d.movimientos] };
      });
      return created;
    };

    const editPedido: StoreShape["editPedido"] = async (id, input) => {
      if (USE_API) {
        await api.putPedido(id, {
          tipoSolicitud: input.tipoSolicitud, obra: input.obraCodigo, obraNombre: input.obraNombre,
          maquinaNo: input.maquinaNo, solicitante: input.solicitante, prioridad: input.prioridad,
          notas: input.notas, usuario: persona, rol: rolActual,
          lineas: input.lineas.map((l) => ({ itemNo: l.articuloId, descripcion: l.descripcion, cantidad: l.cantidad, unidad: l.unidad, almacen: l.almacen, variantCode: l.variantCode })),
        });
        await refreshFromApi();
        return;
      }
      setData((d) => ({
        ...d,
        pedidos: d.pedidos.map((x) => (x.id === id ? {
          ...x, tipoSolicitud: input.tipoSolicitud, obraCodigo: input.obraCodigo, obraNombre: input.obraNombre,
          maquinaNo: input.maquinaNo, maquinaNombre: input.maquinaNombre, prioridad: input.prioridad, notas: input.notas,
          lineas: input.lineas.map((l) => ({ ...l, id: uid(), cantidadOrdenada: 0 })),
        } : x)),
      }));
    };

    const updatePedido: StoreShape["updatePedido"] = (p) =>
      setData((d) => ({ ...d, pedidos: d.pedidos.map((x) => (x.id === p.id ? p : x)) }));

    // ---------------- SET PEDIDO ESTADO ----------------
    const setPedidoEstado: StoreShape["setPedidoEstado"] = async (id, estado) => {
      if (USE_API) {
        await api.patchPedidoEstado(id, { estado, usuario: persona, rol: rolActual });
        await refreshFromApi();
        return;
      }
      setData((d) => {
        const prevp = d.pedidos.find((x) => x.id === id);
        const tipo = estado === "aprobado" ? "aprobado" : estado === "borrador" ? "reabierto" : estado;
        const mov = mkMov({ entidad: "pedido", idEntidad: id, documentoNo: prevp?.numero ?? "", tipoMovimiento: tipo, estadoAnterior: prevp?.estado, estadoNuevo: estado });
        return { ...d, pedidos: d.pedidos.map((x) => (x.id === id ? { ...x, estado } : x)), movimientos: [mov, ...d.movimientos] };
      });
    };

    const deletePedido: StoreShape["deletePedido"] = async (id) => {
      if (USE_API) {
        await api.deletePedido(id, { usuario: persona, rol: rolActual });
        await refreshFromApi();
        return;
      }
      setData((d) => {
        const prevp = d.pedidos.find((x) => x.id === id);
        const mov = mkMov({ entidad: "pedido", idEntidad: id, documentoNo: prevp?.numero ?? "", tipoMovimiento: "eliminado", estadoAnterior: prevp?.estado });
        return { ...d, pedidos: d.pedidos.filter((x) => x.id !== id), movimientos: [mov, ...d.movimientos] };
      });
    };

    // ---------------- CREATE ORDEN ----------------
    const createOrden: StoreShape["createOrden"] = async (input) => {
      if (USE_API) {
        const p = prov(input.proveedorId);
        const { idOrdenCompra } = await api.createOrden({
          proveedorNo: p?.code ?? input.proveedorId, proveedorNombre: p?.nombre, currencyCode: input.currencyCode,
          usuario: persona, rol: rolActual,
          lineas: input.lineas.map((l) => ({
            tipoLinea: l.tipo, itemNo: l.articuloId, idPedidoCompraDet: l.pedidoLineaId ? Number(l.pedidoLineaId) : undefined,
            descripcion: l.descripcion, cantidad: l.cantidad, unidad: l.unidad, almacen: l.almacen,
            precioUnitario: l.precioUnitario, ivaPct: l.ivaPct, descuentoPct: l.descuentoPct, jobNo: l.proyecto, taskNo: l.taskNo,
          })),
        });
        const o = await api.getOrden(String(idOrdenCompra));
        await refreshFromApi();
        return o;
      }
      let created!: Orden;
      setData((d) => {
        const numero = nextNumero("CP", d.ordenes.map((o) => o.numero));
        const lineas: OrdenLinea[] = input.lineas.map((l) => ({ ...l, id: uid(), cantidadRecibida: 0, cantidadFacturada: 0 }));
        created = {
          id: uid(), numero, proveedorId: input.proveedorId, fecha: todayISO(),
          fechaRecepEsperada: input.fechaRecepEsperada, currencyCode: input.currencyCode,
          estado: "abierto", versionesArchivadas: 0, lineas,
        };
        const pedidos = d.pedidos.map((p) => {
          let touched = false;
          const ls = p.lineas.map((pl) => {
            const consumo = lineas.filter((ol) => ol.pedidoLineaId === pl.id).reduce((s, ol) => s + ol.cantidad, 0);
            if (consumo > 0) { touched = true; return { ...pl, cantidadOrdenada: pl.cantidadOrdenada + consumo }; }
            return pl;
          });
          if (!touched) return p;
          const sinSaldo = ls.every((pl) => pl.cantidadOrdenada >= pl.cantidad - 1e-9);
          return { ...p, lineas: ls, estado: (sinSaldo ? "en_orden" : "aprobado") as Pedido["estado"] };
        });
        const peds = [...new Set(lineas.filter((l) => l.pedidoNumero).map((l) => l.pedidoNumero!))];
        const mov = mkMov({ entidad: "orden", idEntidad: created.id, documentoNo: created.numero, tipoMovimiento: "creado", estadoNuevo: "abierto", detalle: peds.length ? `Desde ${peds.join(", ")}` : undefined });
        return { ...d, ordenes: [created, ...d.ordenes], pedidos, movimientos: [mov, ...d.movimientos] };
      });
      return created;
    };

    // ---------------- SET ORDEN ESTADO ----------------
    const setOrdenEstado: StoreShape["setOrdenEstado"] = async (id, estado) => {
      if (USE_API) {
        await api.patchOrdenEstado(id, { estado, usuario: persona, rol: rolActual });
        await refreshFromApi();
        return;
      }
      setData((d) => {
        const prevo = d.ordenes.find((o) => o.id === id);
        const tipo = estado === "pendiente_aprobacion" ? "enviado_aprobacion" : estado === "lanzado" ? "aprobado_lanzado" : estado === "abierto" ? "reabierto" : estado === "completado" ? "completado" : estado;
        const mov = mkMov({ entidad: "orden", idEntidad: id, documentoNo: prevo?.numero ?? "", tipoMovimiento: tipo, estadoAnterior: prevo?.estado, estadoNuevo: estado });
        return { ...d, ordenes: d.ordenes.map((o) => (o.id === id ? { ...o, estado } : o)), movimientos: [mov, ...d.movimientos] };
      });
    };

    // ---------------- REGISTRAR RECEPCION ----------------
    const registrarRecepcion: StoreShape["registrarRecepcion"] = async (input) => {
      if (USE_API) {
        const { idRecepcionCompra } = await api.createRecepcion({
          idOrdenCompra: Number(input.ordenId), numeroFactura: input.numeroFactura,
          fechaFactura: input.fechaFactura, fechaRecepcion: input.fechaRecepcion, fechaRegistro: input.fechaRegistro,
          total: input.total, usuario: persona, rol: rolActual,
          lineas: input.lineas.map((l) => ({ idOrdenCompraDet: Number(l.ordenLineaId), cantidadRecibida: l.cantidadRecibida })),
        });
        await refreshFromApi();
        return { id: String(idRecepcionCompra), ordenId: input.ordenId, numeroFactura: input.numeroFactura,
          fechaFactura: input.fechaFactura, fechaRecepcion: input.fechaRecepcion, fechaRegistro: input.fechaRegistro,
          total: input.total, lineas: input.lineas, parcial: false };
      }
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
        let completada = false;
        const ordenes = d.ordenes.map((o) => {
          if (o.id !== input.ordenId) return o;
          const lineas = o.lineas.map((l) => {
            const rl = input.lineas.find((x) => x.ordenLineaId === l.id);
            if (!rl) return l;
            return { ...l, cantidadRecibida: l.cantidadRecibida + rl.cantidadRecibida, cantidadFacturada: l.cantidadFacturada + rl.cantidadRecibida };
          });
          const upd = { ...o, lineas };
          completada = ordenEstaCompleta(upd);
          return { ...upd, estado: (completada ? "completado" : upd.estado) as Orden["estado"] };
        });
        const movRec = mkMov({ entidad: "recepcion", idEntidad: created.id, documentoNo: input.numeroFactura, tipoMovimiento: "creado", detalle: `Factura ${input.numeroFactura}` });
        const movOrd = mkMov({ entidad: "orden", idEntidad: input.ordenId, documentoNo: orden.numero, tipoMovimiento: completada ? "recepcion_total" : "recepcion_parcial", estadoNuevo: completada ? "completado" : orden.estado, detalle: `Factura ${input.numeroFactura}` });
        return { ...d, ordenes, recepciones: [created, ...d.recepciones], movimientos: [movOrd, movRec, ...d.movimientos] };
      });
      return created;
    };

    const reset: StoreShape["reset"] = () => setData(freshData());

    return {
      role, setRole, cargando,
      proveedores: seed.proveedores, articulos: seed.articulos, obras: seed.obras,
      maquinas: seed.maquinas, almacenes: seed.almacenes,
      pedidos: data.pedidos, ordenes: data.ordenes, recepciones: data.recepciones, movimientos: data.movimientos,
      addPedido, editPedido, updatePedido, setPedidoEstado, deletePedido,
      createOrden, setOrdenEstado, registrarRecepcion, reset,
      borrador, setBorrador,
    };
  }, [role, data, borrador, cargando]);

  return <StoreCtx.Provider value={api2}>{children}</StoreCtx.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreCtx);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}
