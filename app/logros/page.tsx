import { redirect } from "next/navigation";

/** /logros se mudó a la pestaña Logros de /habitos. */
export default function LogrosRedirect() {
  redirect("/habitos?tab=logros");
}
