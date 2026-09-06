import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chooseDurablePersistence } from "../auth-persistence-policy.mjs";

const source = await readFile(new URL("../loginfirebase.js", import.meta.url), "utf8");

const calls = [];
const local = { name: "local" };
const session = { name: "session" };
const memory = { name: "memory" };
const selected = await chooseDurablePersistence(async (_auth, candidate) => {
  calls.push(candidate.name);
  if (candidate !== memory) throw new Error("blocked storage");
}, {}, [local, session, memory]);

assert.equal(selected, memory, "sign-in falls back to in-memory auth when browser-backed persistence is blocked");
assert.deepEqual(calls, ["local", "session", "memory"]);
assert.match(source, /inMemoryPersistence/,
  "login flow supplies Firebase in-memory persistence as the final sign-in fallback");
assert.match(source, /signInWithEmailAndPassword\(auth, normalizedEmail, password\)/,
  "Firebase sign-in still runs after selecting the available persistence mode");

console.log("Desktop sign-in storage fallback contract passed.");
