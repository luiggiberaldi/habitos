// Edge Function push-notifications — Scheduler + envío (Fases 4 y 5 del plan)
// Se ejecuta cada minuto vía pg_cron (o invocación programada). Consulta hábitos con
// momento pendiente hoy ("hora" exacta, "ventana" 1h antes del fin, o "ancla" al
// sueño resuelta), excluye descanso y ya completados, y envía web push.
// Dedupe idempotente con push_log.
//
// Requiere variables de entorno:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//   VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY,
//   CRON_SECRET (compartida entre el scheduler y esta función)
//   DEFAULT_TIMEZONE (p. ej. "America/Caracas"); la zona real de cada usuario
//   sale de la columna push_subscriptions.timezone (la escribe el cliente).
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

/**
 * NOTA DE ZONAS HORARIAS: cada usuario puede sobrescribir su zona con la
 * columna push_subscriptions.timezone (la escribe el cliente al suscribirse).
 * DEFAULT_TIMEZONE es solo el fallback.
 */

/** Lee una variable de entorno obligatoria; falla en frío con mensaje claro
 *  en vez de propagar un `undefined` que rompería llamadas más tarde. */
function requiredEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Falta variable de entorno requerida: ${name}`);
  return v;
}

const supabaseUrl = requiredEnv("SUPABASE_URL");
const supabaseKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

webpush.setVapidDetails(
  Deno.env.get("VAPID_SUBJECT") ?? "mailto:dev@habitos.local",
  requiredEnv("VAPID_PUBLIC_KEY"),
  requiredEnv("VAPID_PRIVATE_KEY"),
);

const MINUTE = 60_000;
const ONE_MINUTE_AGO = new Date(Date.now() - MINUTE).toISOString();
// P1.1: fail-closed — sin secreto configurado NO se ejecuta nada.
const CRON_SECRET = Deno.env.get("CRON_SECRET");
if (!CRON_SECRET) {
  console.error("CRON_SECRET no configurado: la función rechaza todas las invocaciones.");
}
// P1.8: default para el público objetivo (Venezuela). Se sobrescribe por usuario
// con la columna push_subscriptions.timezone (P1.8), nunca con data.settings.
const DEFAULT_TIMEZONE = Deno.env.get("DEFAULT_TIMEZONE") ?? "America/Caracas";

/**
 * Obtiene fecha, HH:mm y día de la semana en una zona horaria concreta.
 * Intl funciona en Deno con datos de zona completos.
 */
function ahoraLocal(tz: string): { fecha: string; hhmm: string; dia: number } {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  // en-CA con hour12:false puede dar "24" para medianoche; normalizamos.
  let hour = Number(parts.hour);
  if (hour === 24) hour = 0;
  // weekday localizable → día 0..6 (0 = domingo), coincide con Habit.dias.
  const semana: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
  const dia = semana[parts.weekday!.slice(0, 3).toLowerCase()] ?? 0;
  return {
    fecha: `${parts.year}-${parts.month}-${parts.day}`,
    hhmm: `${String(hour).padStart(2, "0")}:${parts.minute}`,
    dia,
  };
}

function dentroDeDescanso(horas: { inicio: string; fin: string }, hhmm: string): boolean {
  if (horas.inicio === horas.fin) return false;
  if (horas.inicio < horas.fin) return hhmm >= horas.inicio && hhmm < horas.fin;
  // Intervalo cruza medianoche
  return hhmm >= horas.inicio || hhmm < horas.fin;
}

/** "HH:mm" de un timestamptz en la zona del usuario. */
function hhmmEnZona(iso: string, tz: string): string {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  let hour = Number(parts.hour);
  if (hour === 24) hour = 0;
  return `${String(hour).padStart(2, "0")}:${parts.minute}`;
}

type Debido = {
  habitId: string;
  momentId: string;
  userId: string;
  perfilId: string | null;
  nombre: string;
  sueno?: boolean;
  ancla?: "levantar" | "acostar";
  ventana?: string;
};

function eventId(habitId: string, momentId: string, fecha: string): string {
  return `${habitId}|${momentId}|${fecha}`;
}

/** Descanso por defecto (22:00–08:00); los usuarios pueden sobrescribirlo en data.settings. */
const DESCANSOS_DEFAULT = { inicio: "22:00", fin: "08:00" };

/**
 * Ventanas flexibles: a qué hora avisar (1h antes del fin, "última llamada").
 * Espejo de VENTANAS en lib/dates.ts (la función es autocontenida).
 */
const AVISOS_VENTANA: Record<string, { aviso: string; articulo: string }> = {
  manana: { aviso: "11:00", articulo: "la mañana" },
  tarde: { aviso: "17:00", articulo: "la tarde" },
  noche: { aviso: "21:00", articulo: "la noche" },
  cualquier: { aviso: "21:00", articulo: "el día" },
};

async function calcularDebidos(): Promise<
  { userId: string; perfilId: string | null; habitId: string; momentId: string; nombre: string; body: string; url: string; fecha: string }[]
> {
  // P1.8: timezone real por usuario desde push_subscriptions.timezone
  // (la escribe el cliente en guardarSuscripcion). Sin suscripción no hay a
  // quién enviar, así que solo importan los usuarios suscritos.
  // P3.4: paginado — PostgREST trunca en 1000 filas.
  const tzPorUsuario = new Map<string, string>();
  for (let from = 0; ; from += 1000) {
    const { data: tzRows, error: tzError } = await supabase
      .from("push_subscriptions")
      .select("user_id, timezone")
      .order("user_id")
      .range(from, from + 999);
    if (tzError) {
      console.error("Error leyendo timezones:", tzError.message);
      break;
    }
    for (const r of tzRows ?? []) {
      const row = r as { user_id: string; timezone?: string | null };
      if (row.user_id && !tzPorUsuario.has(row.user_id)) {
        tzPorUsuario.set(row.user_id, row.timezone || DEFAULT_TIMEZONE);
      }
    }
    if (!tzRows || tzRows.length < 1000) break;
  }

  // 1. Leer hábitos activos con su data (el estado está dentro de la columna jsonb "data",
  //    no como una columna separada). Filtramos por data->>'estado' = 'activo'.
  //    P3.4: paginado.
  const habits: { id: string; user_id: string; perfil_id: string | null; data: unknown }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("habits")
      .select("id, user_id, perfil_id, data")
      .filter("data->>estado", "eq", "activo")
      .order("id")
      .range(from, from + 999);
    if (error) {
      console.error("Error leyendo hábitos:", error.message);
      return [];
    }
    habits.push(...((data ?? []) as { id: string; user_id: string; perfil_id: string | null; data: unknown }[]));
    if (!data || data.length < 1000) break;
  }

  const debidos: Debido[] = [];
  const clavePerfil = (userId: string, perfilId: string | null) => `${userId}:${perfilId ?? ""}`;

  // 1b. Indexar hábitos Sueño por (usuario, perfil): los momentos anclados
  // ("Al levantarme"/"Al acostarme") resuelven su hora desde aquí.
  const suenoPorClave = new Map<string, { id: string; horaAcostar: string; horaLevantar: string }>();
  for (const row of habits) {
    const h = row.data as { id?: string; tipo?: string; estado?: string; horaAcostar?: string; horaLevantar?: string };
    if (h?.tipo === "sueno" && h.estado === "activo" && h.id === row.id) {
      suenoPorClave.set(clavePerfil(row.user_id, row.perfil_id), {
        id: h.id,
        horaAcostar: h.horaAcostar ?? "22:00",
        horaLevantar: h.horaLevantar ?? "06:00",
      });
    }
  }

  // Momentos anclados pendientes de resolver (su hora efectiva sale de la
  // marca real de sueño de hoy, o de la hora objetivo si aún no se marcó).
  const pendientesAncla: (Debido & { ancla: "levantar" | "acostar"; tz: string; fecha: string; hhmm: string })[] = [];

  // 2. Para cada usuario calcular su hora local y evaluar sus hábitos.
  for (const row of habits ?? []) {
    const habit = row.data as {
      id: string;
      nombre: string;
      estado?: string;
      dias?: number[];
      tipo?: string;
      horaAcostar?: string;
      horaLevantar?: string;
      momentos?: { id: string; tipo?: string; hora?: string; ventana?: string; ancla?: "levantar" | "acostar" }[];
      settings?: { horasDescanso?: { inicio: string; fin: string } };
    };
    if (!habit || habit.id !== row.id) continue;
    if (habit.estado !== "activo") continue;

    const tz = tzPorUsuario.get(row.user_id) ?? DEFAULT_TIMEZONE;
    const { hhmm, dia, fecha } = ahoraLocal(tz);

    const descanso = habit.settings?.horasDescanso ?? DESCANSOS_DEFAULT;
    // Sueño y momentos anclados se eximen del descanso (igual que el cliente:
    // acostarse/levantarse suele caer dentro de él).
    const esSueno = habit.tipo === "sueno";
    const enDescanso = !esSueno && dentroDeDescanso(descanso, hhmm);
    if (!habit.dias?.includes(dia)) continue;

    // Sueño: dos momentos virtuales con sus horas objetivo.
    const momentos: { id: string; tipo?: string; hora?: string; ancla?: "levantar" | "acostar" }[] = esSueno
      ? [
          { id: "acostar", tipo: "hora", hora: habit.horaAcostar ?? "22:00" },
          { id: "levantar", tipo: "hora", hora: habit.horaLevantar ?? "06:00" },
        ]
      : (habit.momentos ?? []);
    for (const moment of momentos) {
      const esAncla = moment.tipo === "ancla" && (moment.ancla === "levantar" || moment.ancla === "acostar");
      if (enDescanso && !esAncla) continue;
      if (moment.tipo === "hora") {
        if (moment.hora !== hhmm) continue;
        debidos.push({
          habitId: habit.id,
          momentId: moment.id,
          userId: row.user_id,
          perfilId: row.perfil_id,
          nombre: habit.nombre,
          sueno: esSueno || undefined,
        });
      } else if (esAncla) {
        pendientesAncla.push({
          habitId: habit.id,
          momentId: moment.id,
          userId: row.user_id,
          perfilId: row.perfil_id,
          nombre: habit.nombre,
          ancla: moment.ancla as "levantar" | "acostar",
          tz,
          fecha,
          hhmm,
        });
      } else if (moment.tipo === "ventana") {
        // Ventana flexible: "última llamada" 1h antes de que termine.
        const info = moment.ventana ? AVISOS_VENTANA[moment.ventana] : undefined;
        if (info && info.aviso === hhmm) {
          debidos.push({
            habitId: habit.id,
            momentId: moment.id,
            userId: row.user_id,
            perfilId: row.perfil_id,
            nombre: habit.nombre,
            ventana: moment.ventana,
          });
        }
      }
    }
  }

  // 2b. Resolver momentos anclados: hora real marcada hoy (created_at de la
  // marca de sueño en la zona del usuario) o la hora objetivo como fallback.
  if (pendientesAncla.length > 0) {
    const porMarca = new Map<string, typeof pendientesAncla>();
    for (const p of pendientesAncla) {
      const sueno = suenoPorClave.get(clavePerfil(p.userId, p.perfilId));
      if (!sueno) continue; // sin Sueño activo no hay a qué anclar
      const eid = `${sueno.id}|${p.ancla}|${p.fecha}`;
      const lista = porMarca.get(eid) ?? [];
      lista.push(p);
      porMarca.set(eid, lista);
    }
    const marcas = new Map<string, string>();
    if (porMarca.size > 0) {
      const { data: rowsMarcas, error: marcasError } = await supabase
        .from("completions")
        .select("event_id, created_at")
        .in("event_id", [...porMarca.keys()]);
      if (marcasError) console.error("Error leyendo marcas de sueño:", marcasError.message);
      for (const r of rowsMarcas ?? []) marcas.set(r.event_id as string, r.created_at as string);
    }
    for (const [eid, lista] of porMarca) {
      for (const p of lista) {
        const sueno = suenoPorClave.get(clavePerfil(p.userId, p.perfilId))!;
        const creada = marcas.get(eid);
        const horaEfectiva = creada
          ? hhmmEnZona(creada, p.tz)
          : p.ancla === "levantar"
            ? sueno.horaLevantar
            : sueno.horaAcostar;
        if (horaEfectiva === p.hhmm) debidos.push(p);
      }
    }
  }

  if (debidos.length === 0) return [];

  // 3. Excluir momentos ya completados hoy (JOIN con completions por event_id).
  //    Necesitamos la fecha por (userId) para calcular event_id correcto → usamos un mapa.
  //    Como event_id depende de la fecha local, la evaluamos por usuario.
  const debidosConFecha: { d: (typeof debidos)[number]; fecha: string }[] = [];
  for (const d of debidos) {
    const tz = tzPorUsuario.get(d.userId) ?? DEFAULT_TIMEZONE;
    debidosConFecha.push({ d, fecha: ahoraLocal(tz).fecha });
  }
  const eventIds = debidosConFecha.map(({ d, fecha }) => eventId(d.habitId, d.momentId, fecha));

  const { data: completions, error: compError } = await supabase
    .from("completions")
    .select("event_id")
    .in("event_id", eventIds);

  if (compError) {
    console.error("Error leyendo completions:", compError.message);
  }
  const yaCompletados = new Set((completions ?? []).map((c) => c.event_id));

  // 4. Excluir ya notificados en el último minuto (dedupe por push_log).
  const { data: logs, error: logError } = await supabase
    .from("push_log")
    .select("event_id")
    .gte("created_at", ONE_MINUTE_AGO);

  if (logError) {
    console.error("Error leyendo push_log:", logError.message);
  }
  const yaEnviados = new Set((logs ?? []).map((l) => l.event_id));

  return debidosConFecha
    .filter(({ d, fecha }) => {
      const eid = eventId(d.habitId, d.momentId, fecha);
      return !yaCompletados.has(eid) && !yaEnviados.has(eid);
    })
    .map(({ d, fecha }) => ({
      userId: d.userId,
      perfilId: d.perfilId,
      habitId: d.habitId,
      momentId: d.momentId,
      nombre: d.nombre,
      title: d.sueno
        ? d.momentId === "levantar"
          ? "Hora de levantarte"
          : "Hora de acostarte"
        : d.ancla
          ? d.ancla === "levantar"
            ? `Al levantarte: ${d.nombre}`
            : `Al acostarte: ${d.nombre}`
          : d.ventana
            ? `Se acaba ${AVISOS_VENTANA[d.ventana]?.articulo ?? "el día"}: ${d.nombre}`
            : "Recordatorio de hábito",
      body: d.sueno
        ? "Toca Listo al hacerlo: a tiempo ganas +10 XP."
        : d.ventana
          ? "Te queda 1 hora para completarlo hoy. ¡A por ello!"
          : `Es momento de "${d.nombre}". ¡A por ello!`,
      // Deep link de auto-registro: el botón "Listo" de la notificación abre
      // la app y registra el momento sin más taps (ver notificationclick en sw.js).
      // El perfil viaja en la URL: si no es el activo, la app no auto-registra.
      url: `/?complete=${d.habitId}|${d.momentId}${d.perfilId ? `&perfil=${d.perfilId}` : ""}`,
      fecha, // P1.9: fecha en la zona del usuario (para push_log y el tag).
    }));
}

async function enviarPush(
  row: { endpoint: string; user_id: string; perfil_id: string | null; p256dh?: string | null; auth?: string | null },
  payload: {
    title: string;
    body: string;
    actions?: { action: string; title: string }[];
    data: { habitId: string; momentId: string; perfilId: string | null; url: string; fecha: string };
  },
): Promise<boolean> {
  try {
    // Schema real (0001): p256dh/auth son columnas planas, no JSONB "keys".
    const subscription = {
      endpoint: row.endpoint,
      keys: { p256dh: row.p256dh ?? "", auth: row.auth ?? "" },
    };
    await webpush.sendNotification(subscription, JSON.stringify(payload));
    return true;
  } catch (err) {
    const code = (err as { statusCode?: number }).statusCode;
    // 404/410: suscripción caducada o eliminada → limpiarla (acotada al perfil:
    // el mismo endpoint puede servir a varios perfiles de la cuenta).
    if (code === 404 || code === 410) {
      const q = supabase.from("push_subscriptions").delete().eq("endpoint", row.endpoint).eq("user_id", row.user_id);
      await (row.perfil_id ? q.eq("perfil_id", row.perfil_id) : q.is("perfil_id", null));
    }
    console.error("Error enviando push:", (err as Error).message);
    return false;
  }
}

async function run(req: Request): Promise<Response> {
  // P1.1: fail-closed. Solo se acepta x-cron-secret; sin CRON_SECRET
  // configurado se rechaza todo (la función nunca corre abierta).
  const auth = req.headers.get("x-cron-secret");
  if (!CRON_SECRET || auth !== CRON_SECRET) {
    return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const debidos = await calcularDebidos();
  if (debidos.length === 0) {
    return new Response(JSON.stringify({ ok: true, sent: 0 }), { headers: { "Content-Type": "application/json" } });
  }

  // Agrupar por (usuario, perfil) y cargar sus suscripciones: cada perfil
  // tiene su propia fila por endpoint (unique endpoint+perfil_id).
  const userIds = [...new Set(debidos.map((d) => d.userId))];
  const { data: subs, error: subError } = await supabase
    .from("push_subscriptions")
    .select("endpoint, user_id, perfil_id, p256dh, auth")
    .in("user_id", userIds);

  if (subError) {
    console.error("Error leyendo suscripciones:", subError.message);
  }

  const clave = (userId: string, perfilId: string | null) => `${userId}:${perfilId ?? ""}`;
  const porPerfil = new Map<string, typeof subs>();
  for (const s of subs ?? []) {
    const k = clave(s.user_id, (s as { perfil_id?: string | null }).perfil_id ?? null);
    const list = porPerfil.get(k) ?? [];
    list.push(s);
    porPerfil.set(k, list);
  }

  let sent = 0;
  const logs: { event_id: string; habit_id: string; moment_id: string; user_id: string }[] = [];

  for (const d of debidos) {
    const userSubs = porPerfil.get(clave(d.userId, d.perfilId)) ?? [];
    if (userSubs.length === 0) continue;

    const fecha = d.fecha; // P1.9: ya calculada en la zona del usuario.
    const payload = {
      title: d.title,
      body: d.body,
      actions: [{ action: "hecho", title: "Listo" }],
      data: { habitId: d.habitId, momentId: d.momentId, perfilId: d.perfilId, url: d.url, fecha: d.fecha },
    };

    let exito = false;
    for (const sub of userSubs) {
      if (await enviarPush(sub, payload)) {
        exito = true;
        break;
      }
    }
    if (exito) {
      sent++;
      logs.push({ event_id: eventId(d.habitId, d.momentId, fecha), habit_id: d.habitId, moment_id: d.momentId, user_id: d.userId });
    }
  }

  // Persistir el log de envíos (dedupe idempotente para el próximo minuto).
  if (logs.length > 0) {
    const { error: insErr } = await supabase.from("push_log").insert(logs);
    if (insErr) console.error("Error escribiendo push_log:", insErr.message);
  }

  return new Response(JSON.stringify({ ok: true, sent }), { headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  return await run(req);
});
