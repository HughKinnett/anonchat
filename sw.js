const CACHE_NAME = "anonchat-v144";
const APP_SHELL = [
  "./",
  "./index.html",
  "./timeline.html",
  "./profile.html",
  "./profile-style.html",
  "./experience.html",
  "./premium-playlist.html",
  "./forgot-password.html",
  "./connections.html",
  "./community.html",
  "./premium.html",
  "./customize.html",
  "./premium-rooms.html",
  "./delete-account.html",
  "./admin.html",
  "./terms.html",
  "./privacy.html",
  "./support.html",
  "./community-guidelines.html",
  "./child-safety.html",
  "./copyright.html",
  "./subscriptions.html",
  "./data-use.html",
  "./login.css",
  "./controls.css",
  "./timeline.css",
  "./mobile-hotfix.css",
  "./community.css",
  "./premium.css",
  "./payment-preparation.css",
  "./delete-account.css",
  "./admin.css",
  "./legal.css",
  "./sharing-privacy.css",
  "./firebase-config.js",
  "./legacy-profile.js",
  "./default-follows.js",
  "./auth-persistence-policy.mjs",
  "./designated-admin-policy.mjs",
  "./access-activity-gate.mjs",
  "./activity-policy.mjs",
  "./activity.js",
  "./activity-integration.mjs",
  "./loginfirebase.js",
  "./timeline.js",
  "./post-sharing.js",
  "./social-sharing-policy.mjs",
  "./emoji-picker.js",
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
  "./online-followers.js",
  "./premium-policy.mjs",
  "./premium-theme.mjs",
  "./free-profile-theme.mjs",
  "./experience-preferences.mjs",
  "./page-view-budget.mjs",
  "./experience.js",
  "./profile-style.js",
  "./premium-menu.js",
  "./stripe-client-config.mjs",
  "./payment-preparation-policy.mjs",
  "./premium.js",
  "./customize.js",
  "./premium-profile.js",
  "./premium-playlist.js",
  "./premium-rooms.js",
  "./profile-bootstrap.js",
  "./profile-target.mjs",
  "./profile.js",
  "./profile-bio.js",
  "./profile-badges.js",
  "./profile-pinning.mjs",
  "./profile-share.mjs",
  "./profile-privacy-policy.mjs",
  "./profile-phase-a.js",
  "./profile-phase-a.css",
  "./profile-qr-renderer.mjs",
  "./vendor/qrcode.mjs",
  "./vendor/dijkstrajs.mjs",
  "./badge-policy.mjs",
  "./badge-firestore.mjs",
  "./forgot-password.js",
  "./connections.js",
  "./connections-target.mjs",
  "./community.js",
  "./private-message-accepted-readiness.js",
  "./message-request-policy.mjs",
  "./private-conversation-id.mjs",
  "./private-message-reaction-policy.mjs",
  "./private-message-reply-policy.mjs",
  "./private-message-visibility-policy.mjs",
  "./private-message-request-policy.mjs",
  "./private-message-typing-policy.mjs",
  "./private-message-typing-integration.js",
  "./private-message-request-readiness.js",
  "./private-message-reactions-integration.js",
  "./private-message-replies-integration.js",
  "./private-message-visibility-integration.js",
  "./delete-account.js",
  "./admin.js",
  "./admin-badges.js",
  "./admin-dashboard-policy.mjs",
  "./admin-deletion-policy.mjs",
  "./content-ordering.mjs",
  "./feed-ranking-policy.mjs",
  "./feed-mode-policy.mjs",
  "./topic-policy.mjs",
  "./e2ee-crypto.mjs",
  "./e2ee-pin.mjs",
  "./e2ee-device-store.mjs",
  "./e2ee-device-key-store.mjs",
  "./e2ee-identity.js",
  "./e2ee-bootstrap.js",
  "./e2ee-room-keys.js",
  "./content-writer-policy.mjs",
  "./content-edit-policy.mjs",
  "./threaded-reply-policy.mjs",
  "./post-media-policy.mjs",
  "./saved-history-policy.mjs",
  "./hashtag-discovery-policy.mjs",
  "./suggested-follow-policy.mjs",
  "./recent-search-policy.mjs",
  "./interaction-parent-policy.mjs",
  "./moderation-policy.mjs",
  "./moderation-client.mjs",
  "./profile-render-policy.mjs",
  "./protected-metadata-policy.mjs",
  "./viewer-block-policy.mjs",
  "./session-generation-policy.mjs",
  "./timeline-interaction-policy.mjs",
  "./temporary-room-timer-policy.mjs",
  "./poll-vote-policy.mjs",
  "./upload.js",
  "./pwa.js",
  "./site-announcement.js",
  "./manifest.webmanifest",
  "./anonchat-background-mobile.jpg",
  "./anonchat-anonymous.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
    )).then(() => self.clients.claim()).then(() => self.clients.matchAll({ type: "window" }))
      .then((clients) => Promise.all(clients.map((client) => client.navigate(client.url))))
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  if (new URL(event.request.url).origin !== self.location.origin) return;
  if (event.request.mode === "navigate" || event.request.destination === "document") {
    event.respondWith(fetch(event.request).then(response => {
      const copy = response.clone(); caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy)); return response;
    }).catch(() => caches.match(event.request).then(cached => cached || caches.match("./index.html"))));
    return;
  }
  if (["script", "style"].includes(event.request.destination)) {
    event.respondWith(fetch(event.request).then(response => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
      }
      return response;
    }).catch(() => caches.match(event.request).then(cached => cached || Response.error())));
    return;
  }
  event.respondWith(caches.match(event.request).then(cached => {
    const refresh = fetch(event.request).then(response => {
      if (response.ok) { const copy = response.clone(); caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy)); }
      return response;
    }).catch(() => cached || Response.error());
    return cached || refresh;
  }));
});

const PUSH_PAYLOADS = Object.freeze({
  reaction: Object.freeze({ title: "New reaction", action: "reacted to your post.", url: "/timeline.html" }),
  comment: Object.freeze({ title: "New comment", action: "commented on your post.", url: "/timeline.html" }),
  "private-message": Object.freeze({ title: "New private message", action: "sent you a private message.", url: "/community.html#messages-panel" }),
  "message-request": Object.freeze({ title: "New message request", action: "sent you a private conversation request.", url: "/community.html#messages-panel" }),
  "room-message": Object.freeze({ title: "New room message", action: "sent a message in a temporary room.", url: "/community.html#rooms-panel" }),
  "premium-room-message": Object.freeze({ title: "New invite-only room message", action: "sent a message in an invite-only room.", url: "/premium-rooms.html" }),
  "reveal-request": Object.freeze({ title: "New mutual reveal request", action: "sent you a mutual reveal request.", url: "/community.html#messages-panel" })
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
  if (keys.join("\u0000") !== ["actorLabel", "body", "tag", "title", "type", "url"].sort().join("\u0000")) return null;
  const fixed = PUSH_PAYLOADS[payload.type];
  if (!fixed || payload.title !== fixed.title || payload.body !== fixed.action || payload.url !== fixed.url) return null;
  if (!/^[A-Za-z0-9_]{1,40}$/.test(payload.actorLabel)
    || payload.title.length > 80 || !/^anonchat-[0-9a-f]{64}$/.test(payload.tag)) return null;
  return { ...payload, body: `@${payload.actorLabel} ${fixed.action}` };
};

self.addEventListener("push", (event) => {
  let payload;
  try { payload = exactPushPayload(event.data?.json?.()); } catch {}
  payload ??= FALLBACK_PUSH_PAYLOAD;
  const target = safeNotificationTarget(payload.url);
  event.waitUntil(self.registration.showNotification(payload.title, {
    body: payload.body,
    icon: "./anonchat-anonymous.png",
    badge: "./anonchat-anonymous.png",
    tag: payload.tag,
    data: { url: target }
  }));
});

const NOTIFICATION_ROUTES = new Set([
  "/timeline.html",
  "/community.html",
  "/profile.html",
  "/connections.html",
  "/premium-rooms.html"
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
