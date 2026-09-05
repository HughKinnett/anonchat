import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");

assert.match(rules, /match \/badgeTypes\/\{badgeId\}/, "badge definitions have an explicit rules block");
assert.match(rules, /match \/users\/\{userId\}\/badges\/\{badgeId\}/, "user badge assignments have an explicit rules block");
assert.match(rules, /match \/badgeTypes\/\{badgeId\}[\s\S]{0,500}allow read: if signedIn\(\);[\s\S]{0,500}allow (create|write)[^;]*isAdmin\(\)/, "badge definitions are readable to signed-in users and mutable only by admins");
assert.match(rules, /match \/users\/\{userId\}\/badges\/\{badgeId\}[\s\S]{0,500}allow read: if signedIn\(\);[\s\S]{0,500}allow (create|write)[^;]*isAdmin\(\)/, "badge assignments are readable to signed-in users and mutable only by admins");
assert.match(rules, /bio/, "user profile rules account for bio");
assert.match(rules, /bio[^\n]{0,240}300|300[^\n]{0,240}bio/, "bio is limited to 300 characters");
assert.match(rules, /affectedKeys\(\)[\s\S]{0,300}bio/, "bio changes are constrained by the existing affected-keys profile update protections");
assert.match(rules, /hasOnly\(\['bio'\]\)[\s\S]{0,240}request\.resource\.data\.get\('bio', ''\) is string/, "bio updates remain owner-scoped and string validated");

console.log("badge firestore rules contract tests passed");
