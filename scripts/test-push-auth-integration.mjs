import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const timeline = await readFile(new URL("../timeline.js", import.meta.url), "utf8");
const login = await readFile(new URL("../loginfirebase.js", import.meta.url), "utf8");

assert.match(timeline, /cleanupAfterAuthLoss\s*\(/, "timeline automatic auth loss uses privacy-first browser cleanup");
assert.ok((timeline.match(/signOutWithPushCleanup\s*\(/g) || []).length >= 2, "timeline banned and explicit sign-out paths both clean push state before sign-out");
assert.doesNotMatch(timeline, /await signOut\(auth\)/, "timeline has no direct sign-out that bypasses push cleanup");

assert.match(login, /signOutForPrivacy\s*=.*signOutWithPushCleanup\s*\(/s, "login forced sign-out helper removes push state before auth");
assert.ok((login.match(/await signOutForPrivacy\s*\(/g) || []).length >= 2, "both login-page forced sign-outs use privacy cleanup");
assert.doesNotMatch(login, /await signOut\(auth\)/, "login page has no direct sign-out that bypasses push cleanup");

assert.doesNotMatch(timeline, /storage:\s*(?:window\.)?localStorage/, "timeline never eagerly evaluates localStorage before calling a safe helper");
assert.ok((timeline.match(/getStorage:\s*\(\)\s*=>\s*window\.localStorage/g) || []).length >= 2, "startup and bell storage getters are lazy");

console.log("Push auth-path source integration passed");
