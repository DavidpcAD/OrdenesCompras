import { redirect } from "next/navigation";

// Esta pantalla se fusionó con las otras dos en /proveeduria/compras (ver el
// comentario de cabecera de app/proveeduria/compras/page.tsx). Queda el redirect
// porque la ruta anda en marcadores y en enlaces viejos; los detalles
// (/proveeduria/ordenes/{id}) siguen viviendo en su propia ruta y no pasan por acá.
export default function Redirigir() {
  redirect("/proveeduria/compras?vista=ordenes");
}
