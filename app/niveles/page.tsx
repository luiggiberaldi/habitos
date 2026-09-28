import { redirect } from "next/navigation";

/** /niveles se mudó a la pestaña Niveles de /habitos. */
export default function NivelesRedirect() {
  redirect("/habitos?tab=niveles");
}
