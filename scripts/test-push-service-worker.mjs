import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../sw.js", import.meta.url), "utf8");
const repositoryRoot = new URL("../", import.meta.url);
const handlers = new Map();
let cachedShell;
const cacheEntries = new Map();
const shownNotifications = [];
const context = vm.createContext({
  URL,
  Response,
  Promise,
  self: {
    addEventListener: (name, handler) => handlers.set(name, handler),
    skipWaiting: () => {},
    location: { origin: "https://anonchatlogin.web.app" },
    registration: {
      showNotification: async (title, options) => { shownNotifications.push({ title, options }); }
    }
  },
  caches: {
    open: async () => ({
      addAll: async (paths) => {
        cachedShell = [...paths];
        for (const path of paths) {
          const pathname = new URL(path, "https://anonchatlogin.web.app/").pathname;
          const extension = pathname.split(".").at(-1);
          const contentType = ["js", "mjs"].includes(extension)
            ? "text/javascript"
            : extension === "css"
              ? "text/css"
              : extension === "html" || pathname === "/"
                ? "text/html"
                : "application/octet-stream";
          cacheEntries.set(pathname, new Response(`cached:${pathname}`, { headers: { "content-type": contentType } }));
        }
      },
      put: async () => {}
    }),
    keys: async () => [],
    delete: async () => {},
    match: async (request) => {
      const pathname = new URL(typeof request === "string" ? request : request.url, "https://anonchatlogin.web.app/").pathname;
      return cacheEntries.get(pathname)?.clone() ?? null;
    }
  },
  fetch: async () => { throw new Error("not used"); },
  clients: {}
});
vm.runInContext(source, context, { filename: "sw.js" });

let installation;
handlers.get("install")({ waitUntil: (promise) => { installation = promise; } });
await installation;

const shellPages = [
  "index.html",
  "timeline.html",
  "profile.html",
  "forgot-password.html",
  "connections.html",
  "community.html",
  "delete-account.html",
  "admin.html",
  "terms.html",
  "privacy.html",
  "support.html"
];
const localDependencies = new Set(shellPages);
const pendingDependencies = [...shellPages];
while (pendingDependencies.length) {
  const path = pendingDependencies.shift();
  const text = await readFile(new URL(path, repositoryRoot), "utf8");
  const candidates = path.endsWith(".html")
    ? [...text.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1])
    : [...text.matchAll(/(?:from\s+|import\s*)["'](\.\/[^"']+)["']/g)].map((match) => match[1]);
  for (const candidate of candidates) {
    if (/^(?:https?:|data:|#)/.test(candidate)) continue;
    const localPath = candidate.replace(/^\.\//, "").split(/[?#]/)[0];
    if (!localPath || localDependencies.has(localPath)) continue;
    localDependencies.add(localPath);
    if (/\.(?:html|js|mjs)$/.test(localPath)) pendingDependencies.push(localPath);
  }
}
for (const dependency of localDependencies) {
  assert.equal(cachedShell.includes(`./${dependency}`), true, `${dependency} is available in the exact offline app graph`);
}

const offlineFetch = async (path, { destination = "", mode = "same-origin" } = {}) => {
  let responsePromise;
  handlers.get("fetch")({
    request: {
      method: "GET",
      url: `https://anonchatlogin.web.app${path}`,
      destination,
      mode
    },
    respondWith: (promise) => { responsePromise = promise; }
  });
  return responsePromise;
};
for (const dependency of localDependencies) {
  const extension = dependency.split(".").at(-1);
  const destination = ["js", "mjs"].includes(extension) ? "script" : extension === "css" ? "style" : "";
  const response = await offlineFetch(`/${dependency}`, {
    destination,
    mode: extension === "html" ? "navigate" : "same-origin"
  });
  assert.equal(response?.ok, true, `${dependency} resolves from the installed shell while offline`);
}
const missingScript = await offlineFetch("/missing-module.js", { destination: "script" });
assert.notEqual(missingScript?.headers.get("content-type"), "text/html",
  "an offline module miss never receives the HTML navigation fallback");
const missingStyle = await offlineFetch("/missing-style.css", { destination: "style" });
assert.notEqual(missingStyle?.headers.get("content-type"), "text/html",
  "an offline stylesheet miss never receives the HTML navigation fallback");
const missingNavigation = await offlineFetch("/offline-route", { mode: "navigate" });
assert.equal(missingNavigation?.headers.get("content-type"), "text/html",
  "an offline navigation still receives the app entry page");

const push = async ({ json, text = "" }) => {
  let completion;
  handlers.get("push")({
    data: {
      json: () => {
        if (json instanceof Error) throw json;
        return json;
      },
      text: () => text
    },
    waitUntil: (promise) => { completion = promise; }
  });
  await completion;
  return shownNotifications.at(-1);
};

const validEventId = "a".repeat(64);
const shown = await push({ json: {
  type: "comment",
  title: "New comment",
  actorLabel: "HiddenFox", body: "commented on your post.",
  url: "/timeline.html",
  tag: `anonchat-${validEventId}`
} });
assert.equal(shown.title, "New comment");
assert.equal(shown.options.body, "@HiddenFox commented on your post.");
assert.equal(shown.options.tag, `anonchat-${validEventId}`);
assert.equal(shown.options.data.url, "https://anonchatlogin.web.app/timeline.html");

for (const malicious of [
  { type: "arbitrary", title: "Private title", body: "private message body", url: "https://evil.example", tag: "attacker" },
  { type: "reaction", title: "Forged title", body: "private post body", url: "/timeline.html", tag: `anonchat-${validEventId}` },
  { type: "room-message", actorLabel: "QuietOwl12", title: "New room message", body: "sent a message in a temporary room.", url: "https://evil.example", tag: `anonchat-${validEventId}` },
  { type: "comment", title: "New comment", actorLabel: "HiddenFox", body: "commented on your post.", url: "/admin.html", tag: `anonchat-${validEventId}` },
  { type: "comment", title: "New comment", actorLabel: "HiddenFox", body: "commented on your post.", url: "/timeline.html", tag: "unstable" },
  { type: "comment", title: "New comment", actorLabel: "HiddenFox", body: "commented on your post.", url: "/timeline.html", tag: `anonchat-${validEventId}`, extra: "private" }
]) {
  const fallback = await push({ json: malicious });
  assert.equal(fallback.title, "AnonChat");
  assert.equal(fallback.options.body, "You have a new notification.");
  assert.equal(fallback.options.data.url, "https://anonchatlogin.web.app/timeline.html");
  assert.equal(JSON.stringify(fallback).includes("private"), false);
  assert.equal(JSON.stringify(fallback).includes("evil.example"), false);
}

const nonJson = await push({ json: new Error("not json"), text: "private arbitrary body" });
assert.equal(nonJson.options.body, "You have a new notification.");
assert.equal(JSON.stringify(nonJson).includes("private arbitrary body"), false);

const clickTarget = async (payloadUrl, { existingWindow = true } = {}) => {
  let navigated;
  let opened;
  let closed = false;
  context.clients.matchAll = async () => existingWindow ? [{
    url: "https://anonchatlogin.web.app/timeline.html",
    navigate: async (target) => { navigated = target; },
    focus: async () => {}
  }] : [];
  context.clients.openWindow = async (target) => { opened = target; };
  let completion;
  handlers.get("notificationclick")({
    notification: {
      data: { url: payloadUrl },
      close: () => { closed = true; }
    },
    waitUntil: (promise) => { completion = promise; }
  });
  await completion;
  assert.equal(closed, true);
  return navigated || opened;
};

assert.equal(
  await clickTarget("./community.html#messages-panel"),
  "https://anonchatlogin.web.app/community.html#messages-panel",
  "an approved same-origin app route is preserved"
);

for (const unsafe of [
  "https://evil.example/steal",
  "javascript:alert(1)",
  "data:text/html,stolen",
  "https://user:password@anonchatlogin.web.app/timeline.html",
  "//evil.example/timeline.html",
  "./admin.html"
]) {
  assert.equal(
    await clickTarget(unsafe),
    "https://anonchatlogin.web.app/timeline.html",
    `unsafe notification target falls back: ${unsafe}`
  );
}

assert.equal(
  await clickTarget("https://evil.example/open", { existingWindow: false }),
  "https://anonchatlogin.web.app/timeline.html",
  "openWindow also receives only the safe fallback"
);

console.log("Push service-worker shell passed");
