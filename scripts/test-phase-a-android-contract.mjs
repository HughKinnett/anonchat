import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [activity, manifest, profileHtml, phaseAController, phaseAStyles, buildWorkflow] = await Promise.all([
  readFile(new URL("../android/app/src/main/java/com/anonchat/app/MainActivity.java", import.meta.url), "utf8"),
  readFile(new URL("../android/app/src/main/AndroidManifest.xml", import.meta.url), "utf8"),
  readFile(new URL("../profile.html", import.meta.url), "utf8"),
  readFile(new URL("../profile-phase-a.js", import.meta.url), "utf8"),
  readFile(new URL("../profile-phase-a.css", import.meta.url), "utf8"),
  readFile(new URL("../.github/workflows/build-android.yml", import.meta.url), "utf8")
]);

assert.match(activity, /extends LauncherActivity/, "Android remains a Trusted Web Activity wrapper");
assert.match(activity, /FLAG_SECURE/, "existing secure-window behavior remains intact");
assert.match(manifest, /android\.support\.customtabs\.trusted\.DEFAULT_URL[^\n]*https:\/\/anonchatlogin\.web\.app\//, "TWA opens the production AnonChat origin");
assert.match(manifest, /android:host="anonchatlogin\.web\.app"/, "verified links target the production AnonChat host");

for (const id of ["profile-share-button", "profile-qr-button", "profile-privacy-controls", "profile-pinned-post", "profile-badges-section"]) {
  assert.match(profileHtml, new RegExp(`id="${id}"`), `responsive production profile includes ${id}`);
}
assert.match(phaseAController, /navigator\.share/, "TWA can hand profile sharing to Android/Chrome native sharing");
assert.match(phaseAStyles, /@media\(max-width:640px\)/, "Phase A profile controls include mobile/TWA responsive treatment");
assert.doesNotMatch(activity, /profilePrivacy|pinnedPostId|badgeTypes|users\//, "Android native shell does not duplicate profile state or backend logic");

for (const path of [
  "profile.html",
  "profile.js",
  "profile-phase-a.js",
  "profile-phase-a.css",
  "profile-privacy-policy.mjs",
  "profile-pinning.mjs",
  "profile-share.mjs",
  "sw.js"
]) {
  assert.match(buildWorkflow, new RegExp(`['\"]${path.replaceAll(".", "\\.")}['\"]`), `Android build is retriggered when ${path} changes`);
}

console.log("phase A Android/TWA contract tests passed");
