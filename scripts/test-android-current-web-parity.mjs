import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = path => readFile(new URL(path, root), "utf8");
const [
  gradle,
  activity,
  manifest,
  assetLinks,
  profileHtml,
  profileBootstrap,
  profileTarget,
  profileBadges,
  profilePhaseA,
  communityHtml,
  communityJs,
  loginJs,
  settingsHtml,
  uploadJs,
  nav,
  controls,
  buildWorkflow
] = await Promise.all([
  "android/app/build.gradle",
  "android/app/src/main/java/com/hughkinnett/anonchat/MainActivity.java",
  "android/app/src/main/AndroidManifest.xml",
  ".well-known/assetlinks.json",
  "profile.html",
  "profile-bootstrap.js",
  "profile-target.mjs",
  "profile-badges.js",
  "profile-phase-a.js",
  "community.html",
  "community.js",
  "loginfirebase.js",
  "settings.html",
  "upload.js",
  "nav-menu.js",
  "controls.css",
  ".github/workflows/build-android.yml"
].map(read));

assert.match(activity, /extends\s+LauncherActivity/, "Android remains a Trusted Web Activity wrapper");
assert.match(activity, /FLAG_SECURE/, "secure-window behavior remains enabled");
assert.match(activity, /package\s+com\.hughkinnett\.anonchat;/,
  "MainActivity uses the new Android package");
assert.match(manifest, /android\.support\.customtabs\.trusted\.DEFAULT_URL[^\n]*https:\/\/anonchatlogin\.web\.app\//,
  "Android launches the production AnonChat origin");
assert.match(manifest, /android:host="anonchatlogin\.web\.app"/, "verified app links target production");
assert.match(gradle, /namespace\s+["']com\.hughkinnett\.anonchat["']/,
  "Android namespace uses com.hughkinnett.anonchat");
assert.match(gradle, /applicationId\s+["']com\.hughkinnett\.anonchat["']/,
  "Android package ID uses com.hughkinnett.anonchat");
assert.match(assetLinks, /"package_name"\s*:\s*"com\.hughkinnett\.anonchat"/,
  "Digital Asset Links stay bound to the Android package");
assert.doesNotMatch(gradle + activity + assetLinks, /com\.anonchat\.app/,
  "active Android package configuration no longer uses the retired package ID");
assert.doesNotMatch(gradle, /com\.android\.billingclient|stripe-android|com\.stripe/i,
  "Android parity release adds no Play Billing or Stripe SDK");

assert.match(gradle, /versionCode\s+5\b/, "Android parity release remains versionCode 5");
assert.match(gradle, /versionName\s+["']1\.0\.4["']/, "Android parity release remains versionName 1.0.4");

for (const id of [
  "profile-badges-open",
  "profile-badges-collection-dialog",
  "profile-badge-dialog"
]) {
  assert.match(profileHtml, new RegExp(`id=["']${id}["']`), `TWA profile includes ${id}`);
}
assert.doesNotMatch(profileHtml, /id=["']profile-badges-section["']|id=["']profile-badges-view-all["']/,
  "TWA profile keeps earned badges behind the Badges action instead of an inline preview");
assert.match(profileHtml, /data-profile-privacy="showBadges"/, "TWA profile exposes badge privacy");
assert.match(profileHtml, /src="profile-bootstrap\.js"/, "TWA profile normalizes the owner target before loading profile controllers");
assert.match(profileBootstrap, /resolveProfileTarget\s*\(/, "profile bootstrap uses the shared target resolver");
assert.match(profileTarget, /return queryUid \|\| ownerUid \|\| null/,
  "shared target resolver prefers explicit profile uid then authenticated owner");
assert.match(profileBadges, /auth\.authStateReady\(\)/, "own-profile badges wait for authenticated user state");
assert.match(profilePhaseA, /queryUserId\s*\|\|\s*viewer\.uid/, "profile privacy resolves owner and visitor targets consistently after bootstrap normalization");
assert.match(communityHtml, /id="direct-message-form"/, "TWA includes private-message composer");
assert.match(communityJs, /That user has not enabled encrypted chats yet\./,
  "TWA retains encrypted-message readiness behavior");
assert.match(loginJs, /inMemoryPersistence/, "returning-user sign-in retains final in-memory fallback");
assert.match(settingsHtml, /Appearance|Accessibility/, "TWA exposes account appearance/accessibility settings");
assert.match(uploadJs, /e2ee-bootstrap\.js/, "signed-in TWA timeline retains E2EE bootstrap");
assert.match(nav, /Temporary Rooms/);
assert.match(nav, /Premium Rooms/);
assert.doesNotMatch(nav, /\["groups\.html",\s*"Groups"\]|\["communities\.html",\s*"Communities"\]/,
  "retired Groups/Interest Communities are not reintroduced");
assert.doesNotMatch(profileHtml + communityHtml, /GIF URL|post-gif-url/i,
  "raw GIF URL composer is not reintroduced through Android-visible UI");

assert.match(controls, /--ac-control-bg/);
assert.match(controls, /\.secondary-button/);
for (const controlId of ["profile-badges-open", "profile-badges-collection-close", "profile-badge-dialog-close"]) {
  assert.match(profileHtml, new RegExp(`id=["']${controlId}["'][^>]*class=["'][^"']*secondary-button`),
    `${controlId} reuses current AnonChat button styling`);
}
assert.doesNotMatch(activity, /profilePrivacy|badgeTypes|directMessages|userSettings|Firestore/,
  "native Android shell does not duplicate hosted feature state");

for (const path of [
  "e2ee-device-key-store.mjs",
  "e2ee-identity.js",
  "appearance-accessibility.css",
  "appearance-accessibility.js",
  "profile.html",
  "profile-bootstrap.js",
  "profile-target.mjs",
  "profile-badges.js",
  "profile-phase-a.js",
  "profile-phase-a.css",
  "controls.css",
  "sw.js"
]) {
  assert.match(buildWorkflow, new RegExp(`['\"]${path.replaceAll(".", "\\.")}['\"]`),
    `Android build retriggers when ${path} changes`);
}

console.log("current Android/TWA web parity contract passed");
