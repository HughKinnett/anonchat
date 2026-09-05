import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html, js, rules] = await Promise.all([
  readFile(new URL("../admin.html", import.meta.url), "utf8"),
  readFile(new URL("../admin.js", import.meta.url), "utf8"),
  readFile(new URL("../firestore.rules", import.meta.url), "utf8")
]);

assert.match(html, /Search by username or user ID/i, "user search tells admins it supports username or user ID");
assert.match(js, /user\.id[^\n]{0,160}needle|needle[^\n]{0,160}user\.id/s, "user filtering includes the Firebase user ID");
assert.match(js, /Account created:/, "user rows show account creation date");
assert.match(js, /Posts:/, "user rows show a post count");
assert.match(js, /Followers:/, "user rows show follower count");
assert.match(js, /Following:/, "user rows show following count");
assert.match(js, /Reports:/, "user rows show report count");

assert.match(js, /Warn user/i, "dashboard offers a plain-language warning action");
assert.match(js, /Suspend 24 hours/i, "dashboard offers a simple temporary suspension action");
assert.match(js, /accountModeration/, "warnings and suspensions are stored in account moderation records");
assert.match(js, /warningCount/, "warnings maintain an auditable count");
assert.match(js, /suspendedUntil/, "temporary suspension records have an expiry time");
assert.match(js, /requestedBy|updatedBy/, "account moderation records identify the administrator");

assert.match(rules, /function accountNotSuspended\(profile\)/, "Firestore rules define a suspension gate without another document lookup");
assert.match(rules, /function activeUser\(\)[\s\S]{0,350}get\(\/databases\/\$\(database\)\/documents\/users\/\$\(request\.auth\.uid\)\)[\s\S]{0,250}accountNotSuspended\(profile\)/,
  "suspended users are gated from the already-loaded user profile");
assert.doesNotMatch(rules, /accountNotSuspended\([^)]*\)[\s\S]{0,150}accountModeration\/\$\(/,
  "the normal active-user suspension check does not consume another Firestore document lookup");
assert.match(rules, /match \/accountModeration\/\{uid\}[\s\S]{0,500}allow read:[\s\S]{0,300}allow write: if isAdmin\(\)/, "account moderation records are admin-controlled and visible only where intended");

assert.match(rules, /function featureEnabled\(featureName\)/, "Firestore rules define a feature-switch helper");
assert.match(rules, /allow create: if[^;]*featureEnabled\('registrationsEnabled'\)/s, "new registrations obey the registration switch");
assert.match(rules, /match \/posts\/\{postId\}[\s\S]{0,350}allow create: if[^;]*featureEnabled\('postingEnabled'\)/, "timeline posting obeys the posting switch");
assert.match(rules, /comments\/\{commentId\}[\s\S]{0,350}allow create: if[^;]*featureEnabled\('commentsEnabled'\)/, "new comments obey the comments switch");

console.log("expanded admin control tests passed");
