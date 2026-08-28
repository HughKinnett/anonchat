import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../sw.js", import.meta.url), "utf8");
const handlers = new Map();
let cachedShell;
const context = vm.createContext({
  URL,
  Promise,
  self: {
    addEventListener: (name, handler) => handlers.set(name, handler),
    skipWaiting: () => {},
    location: { origin: "https://anonchatlogin.web.app" }
  },
  caches: {
    open: async () => ({ addAll: async (paths) => { cachedShell = [...paths]; } }),
    keys: async () => [],
    delete: async () => {},
    match: async () => null
  },
  fetch: async () => { throw new Error("not used"); },
  clients: {}
});
vm.runInContext(source, context, { filename: "sw.js" });

let installation;
handlers.get("install")({ waitUntil: (promise) => { installation = promise; } });
await installation;

for (const dependency of ["./push-config.mjs", "./push-policy.mjs", "./push-client.mjs", "./push-alert-ui.mjs", "./push-session.mjs", "./notification-storage.mjs", "./account-deletion-push.mjs"]) {
  assert.equal(cachedShell.includes(dependency), true, `${dependency} is available with the offline timeline shell`);
}

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
