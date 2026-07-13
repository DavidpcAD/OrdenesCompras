import type { Metadata } from "next";
import "./globals.css";
import { StoreProvider } from "@/lib/store";
import { ToastProvider } from "@/components/ui";

export const metadata: Metadata = {
  title: "Compras Adelante — Solicitud de material",
  description: "Pedidos, órdenes de compra y recepción de material. Integrado con Business Central + SQL.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Runtime (no build-time): permite activar el modo SQL con la env `USE_API=1`
  // en el App Service sin rebuild. Cae al flag público de build si no está.
  const useApi = process.env.USE_API === "1" || process.env.NEXT_PUBLIC_USE_API === "1";
  return (
    <html lang="es">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <StoreProvider useApi={useApi}>
          <ToastProvider>{children}</ToastProvider>
        </StoreProvider>
      </body>
    </html>
  );
}
