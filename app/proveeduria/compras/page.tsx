"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ComprasSolicitudes } from "@/components/compras-solicitudes";
import { ComprasOrdenes } from "@/components/compras-ordenes";
import { ComprasProveedores } from "@/components/compras-proveedores";
import { ComprasResumen } from "@/components/compras-resumen";
import { IconReceipt, IconList } from "@/components/icons";
import { useStore } from "@/lib/store";
import { resumenPorProveedor } from "@/lib/compras-proveedores";
import { todayISO } from "@/lib/helpers";
import { kpisDeCompras, type TipoCambioApp } from "@/lib/compras-kpis";

// ÓRDENES DE COMPRA — Resumen, Solicitudes, Órdenes y Proveedores en una sola pantalla.
//
// Eran tres pantallas (Dashboard, Solicitudes, Órdenes) y son vistas de la MISMA tubería:
// lo que pidió Ingeniería → lo que se ordenó → lo que falta que llegue. Las tres
// repetían el mismo mobiliario (título, recuadros, toggle, buscador) y en Órdenes eso
// empujaba la primera fila de datos a los ~1 180 px: Angie abría la pantalla y no veía
// ni una orden. Por eso juntarlas vino con comprimir el encabezado en el mismo
// movimiento —los recuadros bajaron a chips—, si no el arreglo habría sido peor que el
// problema. Y por lo mismo NINGÚN panel vive en el encabezado: los números y los
// gráficos están todos en la pestaña Resumen, y las otras tres arrancan en su tabla.
//
// La pestaña vive en la URL (?vista=) para que un enlace de otra pantalla caiga en la
// correcta y el botón de atrás funcione, y se lee EN EL RENDER y no en un efecto: la
// lista de órdenes remonta con `key={filtro}` y un efecto traería el doble montaje que
// se come la marca de la fila (ver el comentario de components/compras-ordenes.tsx).

type Vista = "resumen" | "solicitudes" | "ordenes" | "proveedores";
const VISTAS: Vista[] = ["resumen", "solicitudes", "ordenes", "proveedores"];

export default function ComprasPage() {
  return (
    // useSearchParams pide un límite de Suspense para el prerender. El contenido es
    // el mismo en las cuatro pestañas hasta que el store carga, así que no hay flash.
    <Suspense fallback={<main className="page page--wide" />}>
      <Compras />
    </Suspense>
  );
}

function Compras() {
  const { ordenes, proveedores, pedidos, modoApi } = useStore();
  const router = useRouter();
  const params = useSearchParams();

  const pedida = params.get("vista");
  // Sin `?vista=` la pantalla abre en RESUMEN, que es también a donde manda el login
  // (ROLE_META.home en components/shell.tsx). Antes el riel caía en "ordenes" y el
  // login en "resumen": la misma pantalla abría distinto según por dónde entraras.
  const vista: Vista = VISTAS.includes(pedida as Vista) ? (pedida as Vista) : "resumen";
  // `replace` y no `push`: cambiar de pestaña no es navegar, y con push el botón de
  // atrás se llenaba de pestañas antes de salir de la pantalla.
  const irA = (v: Vista) => router.replace(`/proveeduria/compras?vista=${v}`, { scroll: false });

  const porProveedor = useMemo(() => resumenPorProveedor(ordenes, proveedores), [ordenes, proveedores]);
  // EL TIPO DE CAMBIO DE BC, para que el Resumen no deje afuera las órdenes en
  // dólares y en euros. Se pide una vez por visita y no frena nada: mientras no
  // llegue (o si BC no contesta), los KPI se calculan sin él y el aviso dice cuáles
  // quedaron fuera — que es exactamente lo que hacían antes.
  const [tipoCambio, setTipoCambio] = useState<TipoCambioApp | undefined>(undefined);
  useEffect(() => {
    if (!modoApi) return;
    let vivo = true;
    fetch("/api/bc/tipo-cambio", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (vivo && d?.factor && Object.keys(d.factor).length) setTipoCambio({ factor: d.factor, fecha: d.fecha }); })
      .catch(() => { /* sin BC: los montos van solo en colones y el aviso lo dice */ });
    return () => { vivo = false; };
  }, [modoApi]);
  // Los números del Resumen. Se calculan acá y no adentro del componente porque el
  // recorrido de las órdenes es uno solo y así no se repite en cada render de la pestaña.
  const k = useMemo(() => kpisDeCompras(ordenes, todayISO(), tipoCambio), [ordenes, tipoCambio]);
  // Mismo criterio que la pestaña: Proveeduría cuenta las ENVIADAS (ni borrador, ni
  // devueltas, ni archivadas), que es lo que ahí sale como "Todas".
  const nSolicitudes = pedidos.filter((p) => p.estado !== "borrador" && p.estado !== "devuelto" && p.estado !== "cerrado").length;

  return (
    <main className="page page--wide">
      <div className="page__head">
        <div className="page__title">
          <h1 className="ds-heading">Órdenes de compra</h1>
          <p className="ds-muted">Lo que pidió Ingeniería, lo que se ordenó y lo que falta que llegue.</p>
        </div>

        {/* El botón de compra directa NO va acá: ya está el flotante de la esquina
            (components/shell.tsx), que es el mismo destino. Dos botones para lo
            mismo en la misma pantalla es una pregunta, no una comodidad. */}
      </div>

      {/* Pegajosas: al bajar por 400 órdenes, cambiar de vista no debería costar volver
          hasta arriba. El conteo va en la pestaña porque es el papel de marcador que
          tenían los recuadros grandes antes de volverse chips. */}
      <div className="tabs-compras">
        <div className="tabs-compras__tabs" role="tablist" aria-label="Ver">
          <Tab v="resumen" actual={vista} onClick={irA}>Resumen</Tab>
          <Tab v="solicitudes" actual={vista} onClick={irA} n={nSolicitudes}>Solicitudes</Tab>
          <Tab v="ordenes" actual={vista} onClick={irA} n={ordenes.length}>Órdenes</Tab>
          <Tab v="proveedores" actual={vista} onClick={irA} n={porProveedor.filas.length}>Proveedores</Tab>
        </div>

        {/* "Ver por" sale a su ruta como antes: la vista por línea de Solicitudes no es
            otra tabla, es la pantalla donde se ARMA la orden (borrador, precios, barra
            de acción), y meterla acá mezclaría mirar con trabajar. */}
        {vista === "solicitudes" && (
          <VerPor activo="Solicitud" otro="Línea" href="/proveeduria" />
        )}
        {vista === "ordenes" && (
          <VerPor activo="Orden" otro="Línea" href="/proveeduria/pedidas" />
        )}
      </div>

      {vista === "resumen" && <ComprasResumen k={k} filas={porProveedor.filas} onVerProveedores={() => irA("proveedores")}
          onConciliacion={() => router.push("/proveeduria/conciliacion-bc")}
          onIrA={(v) => irA(v)} />}
      {vista === "solicitudes" && <ComprasSolicitudes />}
      {vista === "ordenes" && <ComprasOrdenes />}
      {vista === "proveedores" && <ComprasProveedores filas={porProveedor.filas} />}
    </main>
  );
}

function Tab({ v, actual, n, onClick, children }: {
  v: Vista; actual: Vista; n?: number; onClick: (v: Vista) => void; children: React.ReactNode;
}) {
  const active = v === actual;
  return (
    <button type="button" role="tab" aria-selected={active}
      className={`tab-compras ${active ? "is-active" : ""}`}
      onClick={() => { if (!active) onClick(v); }}>
      {children}
      {/* "Resumen" no lleva conteo: no es una lista de nada. */}
      {n !== undefined && <span className="tab-compras__n">{n}</span>}
    </button>
  );
}

function VerPor({ activo, otro, href }: { activo: string; otro: string; href: string }) {
  const router = useRouter();
  return (
    <div className="tabs-compras__ver">
      <span className="ds-muted ds-body-sm">Ver por:</span>
      <div className="segmented" role="tablist" aria-label="Ver por">
        <button type="button" role="tab" aria-selected className="segmented__btn is-active">
          <IconReceipt size={16} />{activo}
        </button>
        <button type="button" role="tab" aria-selected={false} className="segmented__btn" onClick={() => router.push(href)}>
          <IconList size={16} />{otro}
        </button>
      </div>
    </div>
  );
}
