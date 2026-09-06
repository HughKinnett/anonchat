import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { hardenRetiredFeatureRules } from "./retired-feature-rules-hardening.mjs";

const source = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
const rules = hardenRetiredFeatureRules(source);

assert.match(rules, /match \/badgeTypes\/\{badgeId\}/, "badge definitions have an explicit rules block");
assert.match(rules, /match \/users\/\{userId\}\/badges\/\{badgeId\}/, "user badge assignments have an explicit rules block");
assert.match(rules, /match \/badgeTypes\/\{badgeId\}[\s\S]{0,300}allow read: if signedIn\(\);[\s\S]{0,300}allow create, update, delete: if false;/,
  "fixed badge definitions are readable but immutable from every client including admins");
assert.match(rules, /function profileBadgesReadable\(userId\)/, "badge privacy uses a focused read policy");
assert.match(rules, /profilePrivacy[\s\S]{0,500}showBadges/, "badge reads honor the profile showBadges preference");
assert.match(rules, /match \/users\/\{userId\}\/badges\/\{badgeId\}[\s\S]{0,300}allow read: if profileBadgesReadable\(userId\);[\s\S]{0,300}allow create, update, delete: if false;/,
  "earned badges are privacy-aware and immutable from every client including admins");
assert.doesNotMatch(rules.match(/match \/badgeTypes\/\{badgeId\} \{([\s\S]*?)\n    \}/)?.[1] || "", /isAdmin\(\)/,
  "badge definition writes have no admin exception");
assert.doesNotMatch(rules.match(/match \/users\/\{userId\}\/badges\/\{badgeId\} \{([\s\S]*?)\n    \}/)?.[1] || "", /isAdmin\(\)/,
  "earned badge writes have no admin exception");

console.log("badge firestore rules contract tests passed");
