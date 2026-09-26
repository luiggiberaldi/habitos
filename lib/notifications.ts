import type { AppState, Habit } from "./types";
import { getSupabase } from "./supabase";

const LAST_SENT_KEY = "habitos-notificaciones-enviadas-v1";
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
    await supabase.from("push_subscriptions").upsert(
      {
        user_id: user.data.user.id,
        endpoint: subscription.endpoint,
        keys: {
          p256dh: p256dhKey ? b64(p256dhKey) : null,
          auth: authKey ? b64(authKey) : null,
        },
        user_agent: navigator.userAgent,
      },
      { onConflict: "endpoint" },
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
      if (supabase) {
        await supabase.from("push_subscriptions").delete().eq("endpoint", subscription.endpoint);
      }
    } catch {
      /* no crítico */
    }
    await subscription.unsubscribe();
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
    icon: "/icon.svg",
    badge: "/icon.svg",
    data: { url: "/" },
  });
}

export function reproducirSonido(): void {
  try {
    const AudioContextClass = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(880, context.currentTime);
    oscillator.frequency.setValueAtTime(660, context.currentTime + 0.12);
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.16, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.3);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.31);
    oscillator.onended = () => void context.close();
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
    const data: unknown = JSON.parse(localStorage.getItem(LAST_SENT_KEY) ?? "[]");
    return new Set(Array.isArray(data) ? data.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

function guardarEnviadas(keys: Set<string>, now: number): void {
  const cutoff = now - 2 * 24 * 60 * MINUTE;
  const fresh = [...keys].filter((key) => Number(key.split("|").at(-1)) >= cutoff).slice(-300);
  try { localStorage.setItem(LAST_SENT_KEY, JSON.stringify(fresh)); } catch { /* almacenamiento no disponible */ }
}

export async function revisarRecordatorios(state: AppState): Promise<number> {
  if (!state.settings.notificaciones || !("Notification" in window) || Notification.permission !== "granted") return 0;
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  if (estaEnDescanso(hhmm, state.settings.horasDescanso.inicio, state.settings.horasDescanso.fin)) return 0;
  const fecha = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const weekDay = now.getDay();
  const done = new Set(state.completions.filter((item) => item.fecha === fecha).map((item) => `${item.habitId}|${item.momentId}`));
  const sent = obtenerEnviadas();
  const due: { key: string; habit: Habit; momentId: string }[] = [];
  for (const habit of state.habits) {
    if (habit.estado !== "activo" || !habit.dias.includes(weekDay)) continue;
    for (const moment of habit.momentos) {
      if (!moment.hora || moment.hora !== hhmm || done.has(`${habit.id}|${moment.id}`)) continue;
      // El identificador por minuto evita reenvíos al reabrir/refrescar la app.
      const stableKey = `${fecha}|${habit.id}|${moment.id}|${Math.floor(now.getTime() / MINUTE) * MINUTE}`;
      if (!sent.has(stableKey)) due.push({ key: stableKey, habit, momentId: moment.id });
    }
  }
  if (due.length === 0) { guardarEnviadas(sent, now.getTime()); return 0; }
  const registration = await navigator.serviceWorker.ready;
  for (const item of due.slice(0, 3)) {
    await registration.showNotification(`Momento de ${item.habit.nombre}`, {
      body: "Tu recordatorio de hábito está listo. Tómate un momento para hacerlo.",
      tag: `habito-${item.habit.id}-${item.momentId}-${fecha}`,
      icon: "/icon.svg",
      badge: "/icon.svg",
      data: { url: "/" },
    });
    sent.add(item.key);
  }
  guardarEnviadas(sent, now.getTime());
  return Math.min(due.length, 3);
}
