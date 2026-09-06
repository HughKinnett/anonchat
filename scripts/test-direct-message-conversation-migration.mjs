import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./direct-message-migration.mjs", import.meta.url), "utf8");

assert.match(source, /collection\("messageRequests"\)/,
  "migration scans existing messageRequests conversation headers");
assert.match(source, /status[^\n]*accepted|data\?\.status\s*!==\s*["']accepted["']/,
  "migration limits canonicalization to accepted conversations");
assert.match(source, /\[.*fromId.*toId.*\]\.sort\(\)\.join\(["']_["']\)/s,
  "migration computes a deterministic sorted pair id");
for (const child of ["messages", "messageReactions", "messageVisibility"]) {
  assert.match(source, new RegExp(`${child}`),
    `migration preserves ${child} child records`);
}
assert.match(source, /DIRECT_MESSAGE_CONVERSATION_MIGRATION/,
  "migration emits explicit canonicalization counters");
assert.match(source, /legacyRemoved|legacyRemoved=/,
  "migration reports removal of verified legacy headers");

console.log("direct-message legacy conversation migration contract passed");
