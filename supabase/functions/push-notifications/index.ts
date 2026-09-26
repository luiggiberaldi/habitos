// Edge Function push-notifications — Scheduler + envío (Fases 4 y 5 del plan)
// Se ejecuta cada minuto vía pg_cron. Consulta hábitos con momento "hora" pendiente
// hoy, excluye descanso y ya completados, y envía web push. Dedupe idempotente con push_log.
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

webpush.setVapidDetails(
  Deno.env.get("VAPID_SUBJECT") ?? "mailto:dev@habitos.local",
  Deno.env.get("VAPID_PUBLIC_KEY")!,
  Deno.env.get("VAPID_PRIVATE_KEY")!,
);

const MINUTE = 60_000;
const ONE_MINUTE_AGO = new Date(Date.now() - MINUTE).toISOString();

function ahoraLocal(): { fecha: string; hhmm: string; dia: number } {
  // El scheduler corre en UTC; usamos la zona del proyecto. Para robustez leemos la
  // hora en la zona del usuario no es posible de forma global, así que asumimos una zona
  // configurable vía TZ del entorno (Supabase usa UTC por defecto; ajustar TZ en la función).
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    fecha: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    hhmm: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    dia: now.getDay(), // 0 = domingo ... 6 = sábado (coincide con Habit.dias)
  };
}

function dentroDeDescanso(horas: { inicio: string; fin: string }, hhmm: string): boolean {
  if (horas.inicio === horas.fin) return false;
  if (horas.inicio < horas.fin) return hhmm >= horas.inicio && hhmm < horas.fin;
  // Intervalo cruza medianoche
  return hhmm >= horas.inicio || hhmm < horas.fin;
}

function eventId(habitId: string, momentId: string, fecha: string): string {
  return `${habitId}|${momentId}|${fecha}`;
}

async function calcularDebidos(): Promise<
  { userId: string; habitId: string; momentId: string; nombre: string; body: string; url: string }[]
> {
  const { fecha, hhmm, dia } = ahoraLocal();

  // Fuera de la franja de descanso por defecto (22:00–08:00), igual que en el cliente.
  // Nota: settings se guardan en localStorage (sin tabla en BBDD); se usa el mismo default.
  if (dentroDeDescanso({ inicio: "22:00", fin: "08:00" }, hhmm)) return [];

  // 1. Hábitos activos cuyos momentos "hora" coinciden con HH:mm actual, del día actual.
  const { data: habits, error } = await supabase
    .from("habits")
    .select("id, user_id, data")
    .eq("estado", "activo");

  if (error) {
    console.error("Error leyendo hábitos:", error.message);
    return [];
  }

  const debidos: { habitId: string; momentId: string; userId: string; nombre: string }[] = [];

  for (const row of habits ?? []) {
    const habit = row.data as {
      id: string;
      nombre: string;
      estado?: string;
      dias?: number[];
      momentos?: { id: string; tipo?: string; hora?: string; ventana?: string }[];
    };
    if (!habit || habit.id !== row.id) continue;

    if (!habit.dias?.includes(dia)) continue;
    if (habit.estado !== "activo") continue;

    for (const moment of habit.momentos ?? []) {
      if (moment.tipo !== "hora" || moment.hora !== hhmm) continue;
      debidos.push({
        habitId: habit.id,
        momentId: moment.id,
        userId: row.user_id,
        nombre: habit.nombre,
      });
    }
  }

  if (debidos.length === 0) return [];

  // 2. Excluir momentos ya completados hoy (JOIN con completions por event_id).
  const eventIds = debidos.map((d) => eventId(d.habitId, d.momentId, fecha));
  const { data: completions, error: compError } = await supabase
    .from("completions")
    .select("event_id")
    .in("event_id", eventIds);

  if (compError) {
    console.error("Error leyendo completions:", compError.message);
  }
  const yaCompletados = new Set((completions ?? []).map((c) => c.event_id));

  // 3. Excluir ya notificados en el último minuto (dedupe por push_log).
  const { data: logs, error: logError } = await supabase
    .from("push_log")
    .select("event_id")
    .gte("created_at", ONE_MINUTE_AGO);

  if (logError) {
    console.error("Error leyendo push_log:", logError.message);
  }
  const yaEnviados = new Set((logs ?? []).map((l) => l.event_id));

  return debidos
    .filter((d) => {
      const eid = eventId(d.habitId, d.momentId, fecha);
      return !yaCompletados.has(eid) && !yaEnviados.has(eid);
    })
    .map((d) => ({
      userId: d.userId,
      habitId: d.habitId,
      momentId: d.momentId,
      nombre: d.nombre,
      body: `Es momento de "${d.nombre}". ¡A por ello!`,
      url: "/",
    }));
}

async function enviarPush(
  row: { endpoint: string; keys?: { p256dh?: string; auth?: string } | null; p256dh?: string | null; auth?: string | null },
  payload: { title: string; body: string; data: { habitId: string; momentId: string; url: string } },
): Promise<boolean> {
  try {
    const subscription = {
      endpoint: row.endpoint,
      keys: {
        p256dh: row.keys?.p256dh ?? row.p256dh ?? "",
        auth: row.keys?.auth ?? row.auth ?? "",
      },
    };
    await webpush.sendNotification(subscription, JSON.stringify(payload));
    return true;
  } catch (err) {
    const code = (err as { statusCode?: number }).statusCode;
    // 404/410: suscripción caducada o eliminada → limpiarla.
    if (code === 404 || code === 410) {
      await supabase.from("push_subscriptions").delete().eq("endpoint", row.endpoint);
    }
    console.error("Error enviando push:", (err as Error).message);
    return false;
  }
}

async function run(): Promise<Response> {
  const debidos = await calcularDebidos();
  if (debidos.length === 0) {
    return new Response(JSON.stringify({ ok: true, sent: 0 }), { headers: { "Content-Type": "application/json" } });
  }

  // Agrupar por usuario y cargar sus suscripciones.
  const userIds = [...new Set(debidos.map((d) => d.userId))];
  const { data: subs, error: subError } = await supabase
    .from("push_subscriptions")
    .select("endpoint, user_id, keys, p256dh, auth")
    .in("user_id", userIds);

  if (subError) {
    console.error("Error leyendo suscripciones:", subError.message);
  }

  const porUsuario = new Map<string, typeof subs>();
  for (const s of subs ?? []) {
    const list = porUsuario.get(s.user_id) ?? [];
    list.push(s);
    porUsuario.set(s.user_id, list);
  }

  const fecha = ahoraLocal().fecha;
  let sent = 0;
  const logs: { event_id: string; habit_id: string; moment_id: string; user_id: string }[] = [];

  for (const d of debidos) {
    const userSubs = porUsuario.get(d.userId) ?? [];
    if (userSubs.length === 0) continue;

    const payload = { title: "Recordatorio de hábito 🎯", body: d.body, data: { habitId: d.habitId, momentId: d.momentId, url: d.url } };
    let ok = false;
    for (const sub of userSubs) {
      if (await enviarPush(sub, payload)) {
        ok = true;
        break; // basta con una suscripción por usuario
      }
    }
    if (ok) {
      sent++;
      logs.push({
        event_id: eventId(d.habitId, d.momentId, fecha),
        habit_id: d.habitId,
        moment_id: d.momentId,
        user_id: d.userId,
      });
    }
  }

  // Registrar envíos para dedupe idempotente.
  if (logs.length > 0) {
    const { error: insError } = await supabase.from("push_log").insert(logs);
    if (insError) {
      console.error("Error insertando push_log (dedupe):", insError.message);
    }
  }

  return new Response(JSON.stringify({ ok: true, sent }), { headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (_req) => {
  return await run();
});
