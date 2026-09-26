// Edge Function push-subscriptions
// Plan Opción A — docs/plan-notificaciones-push.md
// Recibe suscripciones web push del cliente y las persiste por usuario.
import { createClient } from "npm:@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, supabaseKey);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, DELETE, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");

  // Autenticamos al usuario mediante su token de sesión (JWT anónimo con claim sub).
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return json({ error: "No autorizado" }, 401);
  }

  if (req.method === "POST") {
    const body = await req.json();
    const { endpoint, keys } = body;
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return json({ error: "Faltan endpoint o keys de la suscripción" }, 400);
    }
    const { error } = await supabase.from("push_subscriptions").upsert(
      {
        user_id: user.id,
        endpoint,
        keys,
        user_agent: body.userAgent || null,
      },
      { onConflict: "endpoint" },
    );
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  if (req.method === "DELETE") {
    const { endpoint } = await req.json();
    if (!endpoint) return json({ error: "Falta endpoint" }, 400);
    const { error } = await supabase
      .from("push_subscriptions")
      .delete()
      .eq("endpoint", endpoint)
      .eq("user_id", user.id);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  return json({ error: "Método no soportado" }, 405);
});
