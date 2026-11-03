const dev = process.env.NODE_ENV !== "production";

// Cabeceras de seguridad para TODA respuesta (páginas y /api).
// - HSTS: el navegador ya no intenta http:// con este sitio (la cookie de sesión es
//   `secure`, así que por http tampoco serviría).
// - Nada de iframes (X-Frame-Options + frame-ancestors): la app no se embebe en
//   ningún lado, y así nadie la puede montar debajo de otra página para robar clics.
// - La CSP que se APLICA es solo la parte que no puede romper nada. La completa va en
//   modo REPORTE: el script del tema en app/layout.tsx y los que inyecta Next son
//   inline, y una CSP estricta los bloquearía. Las violaciones salen en la consola
//   del navegador; cuando esté limpia por un tiempo, se puede pasar a aplicarla.
const cspAplicada = "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'";
const cspReporte = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob:",
  `connect-src 'self'${dev ? " ws:" : ""}`,
  cspAplicada,
].join("; ");

const cabeceras = [
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Content-Security-Policy", value: cspAplicada },
  { key: "Content-Security-Policy-Report-Only", value: cspReporte },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  poweredByHeader: false,
  // La app no usa next/image. Con esto /_next/image contesta 404 sin procesar nada,
  // y quedan apagados los fallos del optimizador que Next 14 no parcha (RCE con
  // SVG/AVIF, DoS, caché sin techo).
  images: { unoptimized: true },
  async headers() {
    return [{ source: "/:path*", headers: cabeceras }];
  },
};

export default nextConfig;
