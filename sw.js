const CACHE_NAME = "anonchat-v36";
const APP_SHELL = [
  "./",
  "./index.html",
  "./timeline.html",
  "./profile.html",
  "./forgot-password.html",
  "./connections.html",
  "./community.html",
  "./delete-account.html",
  "./login.css",
  "./timeline.css",
  "./community.css",
  "./delete-account.css",
  "./firebase-config.js",
  "./legacy-profile.js",
  "./default-follows.js",
  "./loginfirebase.js",
  "./timeline.js",
  "./push-config.mjs",
  "./push-policy.mjs",
  "./push-client.mjs",
  "./push-alert-ui.mjs",
  "./push-session.mjs",
  "./push-exit.js",
  "./notification-storage.mjs",
  "./account-deletion-push.mjs",
  "./nav-menu.js",
  "./profile.js",
  "./forgot-password.js",
  "./connections.js",
  "./connections-target.mjs",
  "./community.js",
  "./message-request-policy.mjs",
  "./delete-account.js",
  "./upload.js",
  "./pwa.js",
  "./manifest.webmanifest",
  "./Untitled.jpeg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request, { cache: "no-store" })
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match("./index.html")))
  );
});


self.addEventListener("push", (event) => {
  let payload = { title: "AnonChat", body: "You have a new notification.", url: "./timeline.html" };
  try { payload = { ...payload, ...(event.data?.json?.() || {}) }; } catch {
    if (event.data) payload.body = event.data.text();
  }
  event.waitUntil(self.registration.showNotification(payload.title || "AnonChat", {
    body: payload.body,
    icon: "./Untitled.jpeg",
    badge: "./Untitled.jpeg",
    tag: payload.tag || "anonchat-update",
    data: { url: payload.url || "./timeline.html" }
  }));
});

const NOTIFICATION_ROUTES = new Set([
  "/timeline.html",
  "/community.html",
  "/profile.html",
  "/connections.html"
]);

const safeNotificationTarget = (value) => {
  const fallback = new URL("./timeline.html", self.location.origin).href;
  try {
    const candidate = new URL(String(value || "./timeline.html"), self.location.origin);
    if (
      candidate.origin !== self.location.origin
      || candidate.username
      || candidate.password
      || !NOTIFICATION_ROUTES.has(candidate.pathname)
    ) return fallback;
    return candidate.href;
  } catch {
    return fallback;
  }
};

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = safeNotificationTarget(event.notification.data?.url);
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
    const existing = windows.find((client) => client.url.startsWith(self.location.origin));
    if (existing) { existing.navigate(target); return existing.focus(); }
    return clients.openWindow(target);
  }));
});
