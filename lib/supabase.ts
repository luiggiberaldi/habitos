import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

const USER_ID_KEY = "habitos-anon-user-id";

export function getAnonUserId(): string {
  if (typeof window === "undefined") return "ssr-placeholder";
  let id = localStorage.getItem(USER_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(USER_ID_KEY, id);
    supabase.from("users").insert({ id }).then(() => {});
  }
  return id;
}
