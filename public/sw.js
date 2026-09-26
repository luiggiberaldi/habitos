/* Service worker: caché offline del conjunto de páginas de la app.
 *
 * P2.7: reglas de alcance estrictas —
 *  - Solo se interceptan GET del MISMO origen (nunca Supabase ni CDNs: evita
 *    cachear respuestas autenticadas en dispositivos compartidos).
 *  - `/_next/static/` → cache-first con purga LRU (tope MAX_ENTRIES).
 *  - Navegaciones → network-first con fallback a /offline (precacheada).
 *  - El resto de GET same-origin (manifest, iconos) → network-first con
 *    fallback a caché, sin dejar crecer la caché sin cota.
 */
const VERSION = "habitos-v2";
const CORE = ["/", "/offline", "/manifest.json", "/icon.svg", "/icon-192.png"];
const MAX_ENTRIES = 50;
const OFFLINE_URL = "/offline";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(CORE)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

/** Guarda en caché con política LRU: re-inserta al final y purga los más viejos. */
async function putLRU(cache, request, response) {
  await cache.delete(request);
  await cache.put(request, response);
  const keys = await cache.keys();
  const sobrantes = keys.length - MAX_ENTRIES;
  for (let i = 0; i < sobrantes; i++) {
    await cache.delete(keys[i]);
  }
}

/* Notificaciones push remoto (Edge Function). Garantiza "user visible". */
self.addEventListener("push", (event) => {
  const data = event.data?.json() ?? {};
  const habitId = data.data?.habitId || "";
  const momentId = data.data?.momentId || "";
  event.waitUntil(
    self.registration.showNotification(data.title || "Hábitos", {
      body: data.body || "Tu recordatorio de hábito está listo.",
      icon: "/icon.svg",
      badge: "/icon.svg",
      tag: `habito-${habitId}-${momentId}-${new Date().toISOString().slice(0, 16)}`,
      data: data.data || { url: "/" },
      actions: data.actions || [],
      vibrate: [120, 80, 120],
    }),
  );
});

/* Estrategia: red primero, fallback con caché (siempre lo más reciente posible). */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/", self.registration.scope).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((client) => client.url.startsWith(self.registration.scope));
      // Acción "hecho": la URL lleva ?complete=... y la app auto-registra el
      // momento al abrir. Si ya hay ventana abierta, navegarla ahí.
      if (event.action === "hecho") {
        if (existing && "navigate" in existing) {
          return existing.navigate(target).then((c) => c.focus());
        }
        return self.clients.openWindow(target);
      }
      if (existing) return existing.focus();
      return self.clients.openWindow(target);
    }),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  // P2.7: no interceptar peticiones a otros orígenes (API de Supabase, CDNs…).
  // Cachearlas expondría respuestas autenticadas en dispositivos compartidos.
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // 1. Estáticos de Next: cache-first con LRU.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(VERSION);
        const cached = await cache.match(request);
        if (cached) {
          // "Tocar" la entrada la mueve al final (LRU real), sin bloquear.
          putLRU(cache, request, cached.clone()).catch(() => {});
          return cached;
        }
        const response = await fetch(request);
        if (response && response.ok) {
          await putLRU(cache, request, response.clone());
        }
        return response;
      })(),
    );
    return;
  }

  // 2. Navegaciones: network-first; sin red, la página /offline dedicada.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(VERSION);
        return (
          (await cache.match(request)) ||
          (await cache.match(OFFLINE_URL)) ||
          Response.error()
        );
      }),
    );
    return;
  }

  // 3. Otro GET same-origin (manifest, iconos): network-first con fallback a
  // caché. Solo se cachean respuestas OK de recursos estáticos conocidos.
  event.respondWith(
    (async () => {
      try {
        const response = await fetch(request);
        if (
          response &&
          response.ok &&
          (url.pathname === "/manifest.json" ||
            url.pathname.endsWith(".png") ||
            url.pathname.endsWith(".svg") ||
            url.pathname.endsWith(".ico"))
        ) {
          const cache = await caches.open(VERSION);
          await putLRU(cache, request, response.clone());
        }
        return response;
      } catch {
        const cache = await caches.open(VERSION);
        return (await cache.match(request)) || Response.error();
      }
    })(),
  );
});
