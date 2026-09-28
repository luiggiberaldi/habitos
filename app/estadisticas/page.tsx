import { redirect } from "next/navigation";

/** /estadisticas se mudó a la pestaña Datos de /habitos. */
export default function EstadisticasRedirect() {
  redirect("/habitos?tab=datos");
}
