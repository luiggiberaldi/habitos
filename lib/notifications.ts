import type { AnclaSueno, AppState, Habit } from "./types";
import { habitoSueno } from "./anclas";
import { articuloDeVentana, avisoDeVentana } from "./dates";
import { getSupabase } from "./supabase";
import { leerPerfilActivoId } from "./perfiles";
import { logEvent } from "./logger";
import { claveNotifEnviadas } from "./ambito";

const LAST_SENT_KEY_BASE = "habitos-notificaciones-enviadas-v1";

/**
 * Sufijo de identidad (userId) para aislar las notificaciones enviadas por
 * usuario. Lo fija el StoreProvider al montar/cambiar de identidad; por
 * defecto se usa la clave histórica sin sufijo (modo local heredado).
 */
let sufijoNotif: string | null = null;

export function fijarSufijoNotificaciones(sufijo: string | null): void {
  sufijoNotif = sufijo;
}

function lastSentKey(): string {
  return sufijoNotif ? claveNotifEnviadas(sufijoNotif) : LAST_SENT_KEY_BASE;
}
const MINUTE = 60_000;

function vapidPublicKey(): string | null {
  return process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || null;
}

// ── Suscripción push (Opción A — web push + Supabase) ─────────────────────────

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const array = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) array[i] = raw.charCodeAt(i);
  return array;
}

/** Registra el service worker, pide permiso de notificación y suscribe a web push. */
export async function suscribirPush(): Promise<PushSubscription> {
  const registration = await prepararNotificaciones();
  if (!("PushManager" in window)) {
    throw new Error("Este navegador no admite notificaciones push.");
  }
  const publicKey = vapidPublicKey();
  if (!publicKey) {
    throw new Error("Las notificaciones push requieren configuración del servidor (clave VAPID).");
  }
  const existing = await registration.pushManager.getSubscription();
  if (existing) return existing;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
  await guardarSuscripcion(subscription);
  logEvent("PUSH_SUBSCRIBED", "push", null, null);
  return subscription;
}

/** Persiste la suscripción en Supabase para que el scheduler push pueda enviar. */
async function guardarSuscripcion(subscription: PushSubscription): Promise<void> {
  try {
    const supabase = getSupabase();
    const user = supabase ? await supabase.auth.getUser() : null;
    if (!supabase || !user?.data?.user) {
      // Sin sesión activa: seguimos funcionando en modo local (solo muestra en la app).
      return;
    }
    const p256dhKey = subscription.getKey("p256dh");
    const authKey = subscription.getKey("auth");
    const b64 = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf)));
    // P1.8/P1.9: columnas planas según el schema real (0001) + timezone del
    // dispositivo para que el scheduler calcule las fechas por usuario.
    // El perfil activo distingue las suscripciones: la misma cuenta puede
    // tener varios perfiles (cada uno con sus hábitos) en un solo dispositivo.
    const perfilId = leerPerfilActivoId();
    await supabase.from("push_subscriptions").upsert(
      {
        user_id: user.data.user.id,
        perfil_id: perfilId,
        endpoint: subscription.endpoint,
        p256dh: p256dhKey ? b64(p256dhKey) : "",
        auth: authKey ? b64(authKey) : "",
        user_agent: navigator.userAgent,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      { onConflict: "endpoint,perfil_id" },
    );
  } catch {
    // La suscripción local sigue siendo válida aunque la persistencia remota falle.
  }
}

/** Cancela la suscripción push en el navegador y la elimina de Supabase. */
export async function desuscribirPush(): Promise<void> {
  try {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return;
    try {
      const supabase = getSupabase();
      const user = supabase ? await supabase.auth.getUser() : null;
      const userId = user?.data?.user?.id;
      if (supabase && userId) {
        // E4: filtrar por user_id — el endpoint solo no basta (RLS y precisión).
        // Más el perfil activo: no borrar la suscripción de otro perfil.
        const q = supabase.from("push_subscriptions").delete().eq("endpoint", subscription.endpoint).eq("user_id", userId);
        const perfilId = leerPerfilActivoId();
        await (perfilId ? q.eq("perfil_id", perfilId) : q.is("perfil_id", null));
      }
    } catch {
      /* no crítico */
    }
    await subscription.unsubscribe();
    logEvent("PUSH_UNSUBSCRIBED", "push", null, null);
  } catch {
    /* no crítico */
  }
}

/** Estado de la suscripción push activa (para mostrarlo en Ajustes). */
export async function suscripcionActiva(): Promise<boolean> {
  try {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return false;
    const registration = await navigator.serviceWorker.ready;
    return Boolean(await registration.pushManager.getSubscription());
  } catch {
    return false;
  }
}


export async function prepararNotificaciones(): Promise<ServiceWorkerRegistration> {
  if (!("serviceWorker" in navigator) || !("Notification" in window)) {
    throw new Error("Este navegador no admite notificaciones. Prueba desde la app instalada o en otro navegador.");
  }
  if (!window.isSecureContext) throw new Error("Las notificaciones requieren HTTPS o localhost.");
  if (Notification.permission === "denied") throw new Error("Las notificaciones están bloqueadas en los ajustes del navegador.");
  if (Notification.permission !== "granted") {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") throw new Error("No se concedió permiso para mostrar notificaciones.");
  }
  // Fase 1: ruta absoluta para que el SW cubra toda la app (./sw.js falla desde rutas anidadas).
  return navigator.serviceWorker.register("/sw.js");
}

export async function notificarAhora(title: string, body: string, tag: string): Promise<void> {
  const registration = await navigator.serviceWorker.ready;
  await registration.showNotification(title, {
    body,
    tag,
    icon: "/icon-192.png",
    badge: "/badge.png",
    data: { url: "/" },
  });
}

export function reproducirSonido(): void {
  try {
    const AudioContextClass = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    // Chime de 3 notas (arpegio de Do mayor, onda triangular con decaimiento
    // suave): cálido y corto, sin el pitido agresivo del aviso anterior.
    // Nota: esto solo suena con la app abierta; la notificación push en
    // segundo plano usa el sonido del sistema (Android no permite otro).
    const notas = [784.0, 1046.5, 1318.5]; // G5, C6, E6
    const t0 = context.currentTime + 0.02;
    notas.forEach((freq, i) => {
      const osc = context.createOscillator();
      const gain = context.createGain();
      const inicio = t0 + i * 0.1;
      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, inicio);
      gain.gain.setValueAtTime(0.0001, inicio);
      gain.gain.exponentialRampToValueAtTime(0.22, inicio + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, inicio + 0.45);
      osc.connect(gain);
      gain.connect(context.destination);
      osc.start(inicio);
      osc.stop(inicio + 0.5);
    });
    const ms = (t0 + notas.length * 0.1 + 0.5 - context.currentTime) * 1000 + 100;
    window.setTimeout(() => void context.close(), ms);
  } catch {
    // Los navegadores pueden bloquear audio si no procede de una interacción del usuario.
  }
}

function estaEnDescanso(hora: string, inicio: string, fin: string): boolean {
  if (inicio === fin) return false;
  return inicio < fin ? hora >= inicio && hora < fin : hora >= inicio || hora < fin;
}

function obtenerEnviadas(): Set<string> {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(lastSentKey()) ?? "[]");
    return new Set(Array.isArray(data) ? data.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

function guardarEnviadas(keys: Set<string>, now: number): void {
  const cutoff = now - 2 * 24 * 60 * MINUTE;
  const fresh = [...keys].filter((key) => Number(key.split("|").at(-1)) >= cutoff).slice(-300);
  try { localStorage.setItem(lastSentKey(), JSON.stringify(fresh)); } catch { /* almacenamiento no disponible */ }
}

export async function revisarRecordatorios(state: AppState): Promise<number> {
  if (!state.settings.notificaciones || !("Notification" in window) || Notification.permission !== "granted") return 0;
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  // Los recordatorios de sueño se envían incluso en horario de descanso
  // (acostarse 22:00 y levantarse 6:00 suelen caer dentro de él).
  const enDescanso = estaEnDescanso(hhmm, state.settings.horasDescanso.inicio, state.settings.horasDescanso.fin);
  const fecha = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const weekDay = now.getDay();
  const done = new Set(state.completions.filter((item) => item.fecha === fecha).map((item) => `${item.habitId}|${item.momentId}`));
  const sent = obtenerEnviadas();
  const sueno = habitoSueno(state.habits);
  const due: { key: string; habit: Habit; momentId: string; ancla?: AnclaSueno; ventana?: string }[] = [];
  for (const habit of state.habits) {
    if (habit.estado !== "activo" || !habit.dias.includes(weekDay)) continue;
    // Sueño: dos momentos virtuales con sus horas objetivo (no tiene `momentos`).
    const momentos: { id: string; hora?: string; ancla?: AnclaSueno; tipo?: string; ventana?: string }[] =
      habit.tipo === "sueno"
        ? [
            { id: "acostar", hora: habit.horaAcostar ?? "22:00" },
            { id: "levantar", hora: habit.horaLevantar ?? "06:00" },
          ]
        : habit.momentos;
    for (const moment of momentos) {
      // Momento anclado: se programa con la hora objetivo del sueño (la hora
      // real solo se conoce después de marcar, y para entonces ya sobra).
      // Momento por ventana: se avisa 1h antes de que termine la ventana.
      const hora =
        moment.hora ??
        (moment.ancla
          ? (moment.ancla === "levantar" ? (sueno?.horaLevantar ?? "06:00") : (sueno?.horaAcostar ?? "22:00"))
          : undefined) ??
        avisoDeVentana(moment.tipo === "ventana" ? moment.ventana : undefined);
      // La rutina de sueño (incluidos los momentos anclados) se avisa incluso
      // en horario de descanso: acostarse suele caer dentro de él.
      if (enDescanso && habit.tipo !== "sueno" && !moment.ancla) continue;
      if (!hora || hora !== hhmm || done.has(`${habit.id}|${moment.id}`)) continue;
      // El identificador por minuto evita reenvíos al reabrir/refrescar la app.
      const stableKey = `${fecha}|${habit.id}|${moment.id}|${Math.floor(now.getTime() / MINUTE) * MINUTE}`;
      if (!sent.has(stableKey)) {
        due.push({
          key: stableKey,
          habit,
          momentId: moment.id,
          ancla: moment.ancla,
          ventana: moment.tipo === "ventana" ? moment.ventana : undefined,
        });
      }
    }
  }
  if (due.length === 0) { guardarEnviadas(sent, now.getTime()); return 0; }
  const registration = await navigator.serviceWorker.ready;
  for (const item of due.slice(0, 3)) {
    const esSueno = item.habit.tipo === "sueno";
    const titulo = esSueno
      ? item.momentId === "levantar"
        ? "Hora de levantarte"
        : "Hora de acostarte"
      : item.ancla
        ? `${item.ancla === "levantar" ? "Al levantarte" : "Al acostarte"}: ${item.habit.nombre}`
        : item.ventana
          ? `Se acaba ${articuloDeVentana(item.ventana)}: ${item.habit.nombre}`
          : `Momento de ${item.habit.nombre}`;
    const cuerpo = esSueno
      ? item.momentId === "levantar"
        ? "Márcalo en la app: a tiempo ganas +10 XP."
        : "Márcalo en la app antes de dormir: a tiempo ganas +10 XP."
      : item.ventana
        ? "Te queda 1 hora para completarlo hoy. ¡A por ello!"
        : "Tu recordatorio de hábito está listo. Tómate un momento para hacerlo.";
    await registration.showNotification(titulo, {
      body: cuerpo,
      tag: `habito-${item.habit.id}-${item.momentId}-${fecha}`,
      icon: "/icon-192.png",
      badge: "/badge.png",
      data: { url: esSueno ? "/?sueno=1" : "/" },
    });
    sent.add(item.key);
  }
  guardarEnviadas(sent, now.getTime());
  return Math.min(due.length, 3);
}
