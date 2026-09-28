// Edge Function coach-alertas (Fase 4 — Inteligencia cruzada).
//
// Corre el briefing del coach por usuario con suscripciones push activas y
// envía web push solo por correlaciones NUEVAS (dedupe en
// coach_alertas_enviadas por user_id + correlacion_id + ventana).
// Sin emojis. Cada alerta abre /coach, donde la cifra se verifica en la app.
//
// Se ejecuta 2 veces al día vía pg_cron (8am y 6pm America/Caracas).
// Requiere: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VAPID_* , CRON_SECRET.
// Fail-closed: sin CRON_SECRET no se ejecuta nada.
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

function requiredEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Falta variable de entorno requerida: ${name}`);
  return v;
}

const supabaseUrl = requiredEnv("SUPABASE_URL");
const supabaseKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

webpush.setVapidDetails(
  Deno.env.get("VAPID_SUBJECT") ?? "mailto:dev@habitos.local",
  requiredEnv("VAPID_PUBLIC_KEY"),
  requiredEnv("VAPID_PRIVATE_KEY"),
);

const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
if (!CRON_SECRET) console.error("CRON_SECRET no configurado: la función rechaza todas las invocaciones.");

interface Correlacion {
  id: string;
  titulo: string;
  detalle: string;
  ver_en: string;
}

async function enviarPush(
  row: { endpoint: string; user_id: string; p256dh?: string | null; auth?: string | null },
  payload: { title: string; body: string; tag: string; data: { url: string; modulo: string } },
): Promise<boolean> {
  try {
    const subscription = {
      endpoint: row.endpoint,
      keys: { p256dh: row.p256dh ?? "", auth: row.auth ?? "" },
    };
    await webpush.sendNotification(subscription, JSON.stringify(payload));
    return true;
  } catch (err) {
    const code = (err as { statusCode?: number }).statusCode;
    if (code === 404 || code === 410) {
      await supabase.from("push_subscriptions").delete().eq("endpoint", row.endpoint).eq("user_id", row.user_id);
    }
    console.error("Error enviando push coach:", (err as Error).message);
    return false;
  }
}

Deno.serve(async (req: Request) => {
  if (!CRON_SECRET || req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return new Response(JSON.stringify({ ok: false, error: "no_autorizado" }), { status: 401 });
  }

  // Secreto de integración para el RPC del coach (service_role lo lee).
  const { data: secRow, error: secErr } = await supabase
    .from("fin_rpc_secrets")
    .select("value")
    .eq("name", "rpc-secret")
    .single();
  if (secErr || !secRow?.value) {
    return new Response(JSON.stringify({ ok: false, error: "sin_secreto_fin" }), { status: 500 });
  }
  const finSecret: string = secRow.value;

  const { data: subs, error: subsErr } = await supabase
    .from("push_subscriptions")
    .select("user_id, endpoint, p256dh, auth");
  if (subsErr) {
    return new Response(JSON.stringify({ ok: false, error: subsErr.message }), { status: 500 });
  }
  const porUsuario = new Map<string, typeof subs>();
  for (const s of subs ?? []) {
    if (!porUsuario.has(s.user_id)) porUsuario.set(s.user_id, []);
    porUsuario.get(s.user_id)!.push(s);
  }

  let usuarios = 0;
  let alertas = 0;
  const errores: string[] = [];

  for (const [userId, userSubs] of porUsuario) {
    usuarios++;
    // Cliente con el secreto de integración como header global: el RPC del
    // coach lo acepta (el JS client maneja apikey/Authorization solo).
    const supaFin = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false },
      global: { headers: { "x-fin-rpc-secret": finSecret } },
    });
    let briefing: { ventana: { desde: string }; correlaciones: Correlacion[] };
    try {
      const { data, error } = await supaFin.rpc("rpc_coach_briefing", { p_user_id: userId });
      if (error) throw new Error(`briefing: ${error.message.slice(0, 120)}`);
      briefing = data as { ventana: { desde: string }; correlaciones: Correlacion[] };
    } catch (e) {
      errores.push(`${userId.slice(0, 8)}: ${(e as Error).message}`);
      continue;
    }
    const ventana = briefing.ventana?.desde ?? new Date().toISOString().slice(0, 10);
    for (const c of briefing.correlaciones ?? []) {
      // Dedupe: ¿ya se avisó esta correlación en esta ventana?
      const { data: ya } = await supabase
        .from("coach_alertas_enviadas")
        .select("id")
        .eq("user_id", userId)
        .eq("correlacion_id", c.id)
        .eq("ventana_desde", ventana)
        .limit(1);
      if (ya && ya.length > 0) continue;

      const tag = `coach-${c.id}-${ventana}`;
      let exito = false;
      for (const sub of userSubs) {
        if (await enviarPush(sub, {
          title: "Senda · Coach",
          body: c.titulo,
          tag,
          data: { url: "/coach", modulo: "coach" },
        })) { exito = true; break; }
      }
      if (!exito) continue;
      const { error: insErr } = await supabase.from("coach_alertas_enviadas").insert({
        user_id: userId,
        correlacion_id: c.id,
        ventana_desde: ventana,
        titulo: c.titulo,
      });
      if (insErr) console.error("Error registrando alerta:", insErr.message);
      else alertas++;
    }
  }

  return new Response(JSON.stringify({ ok: true, usuarios, alertas, errores: errores.slice(0, 5) }));
});
