import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const exitPolicy = {
  "admin-badges.js": { authenticated: 0, authLoss: 1 },
  "admin.js": { authenticated: 1, authLoss: 1 },
  "communities.js": { authenticated: 1, authLoss: 1 },
  "community-detail.js": { authenticated: 1, authLoss: 1 },
  "community.js": { authenticated: 2, authLoss: 1 },
  "connections.js": { authenticated: 1, authLoss: 1 },
  "customize.js": { authenticated: 0, authLoss: 1 },
  "delete-account.js": { authenticated: 2, authLoss: 1 },
  "experience.js": { authenticated: 0, authLoss: 1 },
  "group-detail.js": { authenticated: 1, authLoss: 1 },
  "groups.js": { authenticated: 1, authLoss: 1 },
  "loginfirebase.js": { authenticated: 2, authLoss: 1 },
  "online-followers.js": { authenticated: 0, authLoss: 0 },
  "premium-menu.js": { authenticated: 0, authLoss: 0 },
  "premium-playlist.js": { authenticated: 0, authLoss: 1 },
  "premium-profile.js": { authenticated: 0, authLoss: 0 },
  "premium-rooms.js": { authenticated: 0, authLoss: 1 },
  "premium.js": { authenticated: 0, authLoss: 1 },
  "profile-style.js": { authenticated: 0, authLoss: 1 },
  "profile.js": { authenticated: 2, authLoss: 1 },
  "timeline.js": { authenticated: 2, authLoss: 1 },
  "upload.js": { authenticated: 0, authLoss: 1 }
};

const runtimeNames = (await readdir(root, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && /\.(?:js|mjs)$/.test(entry.name))
  .map((entry) => entry.name)
  .sort();
const runtimeSources = new Map(await Promise.all(runtimeNames.map(async (name) => [
  name,
  await readFile(new URL(name, root), "utf8")
])));

const actualSignedPages = [...runtimeSources]
  .filter(([, source]) => /\bonAuthStateChanged\s*\(/.test(source))
  .map(([name]) => name)
  .sort();
assert.deepEqual(actualSignedPages, Object.keys(exitPolicy).sort(), "every runtime auth-state page is explicitly covered by the push-exit policy");

for (const [name, expected] of Object.entries(exitPolicy)) {
  const source = runtimeSources.get(name);
  const authenticated = (source.match(/\bexitAuthenticatedSession\s*\(/g) || []).length;
  const authLoss = (source.match(/\bexitAfterAuthLoss\s*\(/g) || []).length;
  assert.equal(authenticated, expected.authenticated, `${name} routes every authenticated exit through push cleanup`);
  assert.equal(authLoss, expected.authLoss, `${name} routes its no-user state through unsubscribe-only cleanup`);
}

const rawSignOuts = [...runtimeSources].flatMap(([name, source]) =>
  [...source.matchAll(/\bsignOut\s*\(/g)].map(() => name)
);
assert.deepEqual(rawSignOuts, ["push-session.mjs"], "no runtime page may call raw signOut outside the reviewed session helper");
for (const [name, source] of runtimeSources) {
  if (name === "push-exit.js") continue;
  assert.doesNotMatch(source, /import\s*\{[^}]*\bsignOut\b[^}]*\}\s*from\s*["'][^"']*firebase-auth\.js["']/s, `${name} cannot bypass the shared exit integration with an aliased Firebase sign-out`);
}

const pushExit = runtimeSources.get("push-exit.js");
assert.doesNotMatch(runtimeSources.get("loginfirebase.js"), /getElementById\(["']login-status["']\)/, "queued deletion feedback uses the real auth status surface");
assert.ok(pushExit, "the shared browser push-exit integration exists");
assert.doesNotMatch(pushExit, /requestPermission|\.subscribe\s*\(|enableFromGesture|reconcileExisting/, "exit integration cannot prompt, subscribe, or reconcile");
assert.match(pushExit, /cleanupForSignOut/, "exit integration delegates only to cleanup behavior");

const timeline = runtimeSources.get("timeline.js");
assert.doesNotMatch(timeline, /storage:\s*(?:window\.)?localStorage/, "timeline never eagerly evaluates localStorage before calling a safe helper");
assert.ok((timeline.match(/getStorage:\s*\(\)\s*=>\s*window\.localStorage/g) || []).length >= 2, "startup and bell storage getters are lazy");

const serviceWorker = runtimeSources.get("sw.js");
assert.match(serviceWorker, /["']\.\/push-exit\.js["']/, "the shared exit integration remains available in the offline app shell");

console.log("Push auth-path source integration passed");
