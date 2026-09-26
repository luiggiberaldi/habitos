/* Service worker: caché offline del conjunto de páginas de la app. */
const VERSION = "habitos-v1";
const CORE = ["./", "./manifest.json", "./icon.svg"];

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

/* Notificaciones push remoto (Edge Function). Garantiza "user visible". */
self.addEventListener("push", (event) => {
  const data = event.data?.json() ?? {};
  const habitId = data.data?.habitId || "";
  const momentId = data.data?.momentId || "";
  event.waitUntil(
    self.registration.showNotification(data.title || "Hábitos", {
      body: data.body || "Tu recordatorio de hábito está listo.",
      icon: "./icon.svg",
      badge: "./icon.svg",
      tag: `habito-${habitId}-${momentId}-${new Date().toISOString().slice(0, 16)}`,
      data: data.data || { url: "./" },
      vibrate: [120, 80, 120],
    }),
  );
});

/* Estrategia: red primero, fallback con caché (siempre lo más reciente posible). */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "./", self.registration.scope).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((client) => client.url.startsWith(self.registration.scope));
      if (existing) return existing.focus();
      return self.clients.openWindow(target);
    }),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(VERSION).then((cache) => cache.put(request, copy));
        return response;
      })
      .catch(() =>
        caches.match(request).then((cached) => cached || caches.match("./")),
      ),
  );
});
