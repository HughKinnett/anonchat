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
    skipWaiting: () => {}
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

for (const dependency of ["./push-config.mjs", "./push-policy.mjs", "./push-client.mjs"]) {
  assert.equal(cachedShell.includes(dependency), true, `${dependency} is available with the offline timeline shell`);
}

console.log("Push service-worker shell passed");
