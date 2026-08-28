const CACHE_NAME = "anonchat-v38";
const APP_SHELL = [
  "./",
  "./index.html",
  "./timeline.html",
  "./profile.html",
  "./forgot-password.html",
  "./connections.html",
  "./community.html",
  "./delete-account.html",
  "./admin.html",
  "./login.css",
  "./timeline.css",
  "./community.css",
  "./delete-account.css",
  "./admin.css",
  "./firebase-config.js",
  "./legacy-profile.js",
  "./default-follows.js",
  "./auth-persistence-policy.mjs",
  "./access-activity-gate.mjs",
  "./activity-policy.mjs",
  "./activity.js",
  "./activity-integration.mjs",
  "./loginfirebase.js",
  "./timeline.js",
  "./push-config.mjs",
  "./push-policy.mjs",
  "./push-client.mjs",
  "./push-alert-ui.mjs",
  "./push-session.mjs",
  "./push-exit.js",
  "./notification-storage.mjs",
  "./notification-ui-policy.mjs",
  "./account-deletion-push.mjs",
  "./nav-menu.js",
  "./profile.js",
  "./forgot-password.js",
  "./connections.js",
  "./connections-target.mjs",
  "./community.js",
  "./message-request-policy.mjs",
  "./delete-account.js",
  "./admin.js",
  "./admin-dashboard-policy.mjs",
  "./admin-deletion-policy.mjs",
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
      .catch(async () => {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        if (event.request.mode === "navigate" || event.request.destination === "document") {
          return caches.match("./index.html");
        }
        return Response.error();
      })
  );
});


const PUSH_PAYLOADS = Object.freeze({
  reaction: Object.freeze({ title: "New reaction", body: "Someone reacted to your post.", url: "/timeline.html" }),
  comment: Object.freeze({ title: "New comment", body: "Someone commented on your post.", url: "/timeline.html" }),
  "message-request": Object.freeze({ title: "New message request", body: "You have a new private conversation request.", url: "/community.html#messages-panel" }),
  "room-message": Object.freeze({ title: "New room message", body: "A temporary room you joined has a new message.", url: "/community.html#rooms-panel" }),
  "reveal-request": Object.freeze({ title: "New mutual reveal request", body: "You have a new mutual reveal request.", url: "/community.html#messages-panel" })
});
const FALLBACK_PUSH_PAYLOAD = Object.freeze({
  title: "AnonChat",
  body: "You have a new notification.",
  url: "/timeline.html",
  tag: "anonchat-update"
});
const exactPushPayload = (payload) => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const keys = Object.keys(payload).sort();
  if (keys.join("\u0000") !== ["body", "tag", "title", "type", "url"].sort().join("\u0000")) return null;
  const fixed = PUSH_PAYLOADS[payload.type];
  if (!fixed || payload.title !== fixed.title || payload.body !== fixed.body || payload.url !== fixed.url) return null;
  if (payload.title.length > 80 || payload.body.length > 160 || !/^anonchat-[0-9a-f]{64}$/.test(payload.tag)) return null;
  return payload;
};

self.addEventListener("push", (event) => {
  let payload;
  try { payload = exactPushPayload(event.data?.json?.()); } catch {}
  payload ??= FALLBACK_PUSH_PAYLOAD;
  const target = safeNotificationTarget(payload.url);
  event.waitUntil(self.registration.showNotification(payload.title, {
    body: payload.body,
    icon: "./Untitled.jpeg",
    badge: "./Untitled.jpeg",
    tag: payload.tag,
    data: { url: target }
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
