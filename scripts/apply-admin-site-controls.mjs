import { readFile, writeFile } from "node:fs/promises";

async function patch(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after === before) return false;
  await writeFile(path, after);
  return true;
}

await patch("firestore.rules", rules => {
  let out = rules;
  out = out.replace(
`    function featureEnabled(featureName) {
      return !exists(/databases/$(database)/documents/siteSettings/features)
        || get(/databases/$(database)/documents/siteSettings/features).data.get(featureName, true) == true;
    }`,
`    function featureEnabled(featureName) {
      let settingsPath = /databases/$(database)/documents/siteSettings/features;
      return (featureName == 'registrationsEnabled'
          && exists(settingsPath)
          && get(settingsPath).data.get(featureName, false) == true)
        || (featureName != 'registrationsEnabled'
          && (!exists(settingsPath)
            || get(settingsPath).data.get(featureName, true) == true));
    }`);

  out = out.replace(
`    match /siteSettings/{settingId} {
      allow read: if isAdmin();
      allow write: if isAdmin();
    }`,
`    match /siteSettings/{settingId} {
      allow read: if settingId in ['features', 'announcement'] || isAdmin();
      allow write: if isAdmin();
    }`);

  out = out.replace(
"      allow create: if activeUserAfter() && featureEnabled('postingEnabled') && (validOriginalPost() || validRepost(postId));",
"      allow create: if activeUserAfter() && featureEnabled('postingEnabled')\n        && (featureEnabled('uploadsEnabled') || request.resource.data.get('imageData', '') == '')\n        && (validOriginalPost() || validRepost(postId));");

  out = out.replace(
`            (request.resource.data.diff(resource.data).affectedKeys()
                .hasOnly(['profileImage', 'coverImage'])
              && (!request.resource.data.diff(resource.data).affectedKeys().hasAny(['profileImage'])`,
`            (request.resource.data.diff(resource.data).affectedKeys()
                .hasOnly(['profileImage', 'coverImage'])
              && featureEnabled('uploadsEnabled')
              && (!request.resource.data.diff(resource.data).affectedKeys().hasAny(['profileImage'])`);

  out = out.replace(
`            (request.resource.data.diff(resource.data).affectedKeys().hasOnly(['spotifyTrackUrl'])
              && request.resource.data.get('spotifyTrackUrl', '') is string`,
`            (request.resource.data.diff(resource.data).affectedKeys().hasOnly(['spotifyTrackUrl'])
              && featureEnabled('spotifyEmbedsEnabled')
              && request.resource.data.get('spotifyTrackUrl', '') is string`);

  out = out.replace(
`            (request.resource.data.diff(resource.data).affectedKeys().hasOnly(['spotifyPlaylistUrl'])
              && isPremiumUidAfter(userId)`,
`            (request.resource.data.diff(resource.data).affectedKeys().hasOnly(['spotifyPlaylistUrl'])
              && featureEnabled('spotifyEmbedsEnabled')
              && isPremiumUidAfter(userId)`);
  return out;
});

await patch("admin.js", source => source
  .replace("const DEFAULT_FEATURES = Object.freeze({ registrationsEnabled: true,", "const DEFAULT_FEATURES = Object.freeze({ registrationsEnabled: false,")
  .replace("features: { registrationsEnabled: true,", "features: { registrationsEnabled: false,"));

await patch("loginfirebase.js", source => {
  if (source.includes("refreshSignupAvailability")) return source;
  const old = `const SIGNUPS_OPEN = false;
const signUpForm = document.getElementById("sign-up-form");
signUpForm.hidden = false;
signUpForm.setAttribute("aria-hidden", "false");
signUpForm.setAttribute("aria-disabled", String(!SIGNUPS_OPEN));
if (!SIGNUPS_OPEN) {
  signUpForm.querySelectorAll("input, button").forEach((control) => { control.disabled = true; });
}`;
  const replacement = `let signupsOpen = false;
const signUpForm = document.getElementById("sign-up-form");
const signupControls = [...signUpForm.querySelectorAll("input, button")];
const setSignupAvailability = (enabled) => {
  signupsOpen = enabled === true;
  signUpForm.hidden = false;
  signUpForm.setAttribute("aria-hidden", "false");
  signUpForm.setAttribute("aria-disabled", String(!signupsOpen));
  signupControls.forEach((control) => { control.disabled = !signupsOpen; });
};
const refreshSignupAvailability = async () => {
  try {
    const snapshot = await getDoc(doc(db, "siteSettings", "features"));
    signupsOpen = snapshot.exists() ? snapshot.data().registrationsEnabled === true : false; // registration stays closed until an admin opens it
  } catch {
    signupsOpen = false;
  }
  setSignupAvailability(signupsOpen);
  return signupsOpen;
};
setSignupAvailability(false);
void refreshSignupAvailability();`;
  if (!source.includes(old)) throw new Error("signup availability block not found");
  let out = source.replace(old, replacement);
  out = out.replace(`  if (!SIGNUPS_OPEN) {
    setStatus("New account registration is temporarily closed.", true);
    return;
  }`, `  if (!(await refreshSignupAvailability())) {
    setStatus("New account registration is temporarily closed by AnonChat administration.", true);
    return;
  }`);
  return out;
});

await patch("premium-playlist.js", source => {
  if (source.includes("spotifyEmbedsEnabled")) return source;
  let out = source.replace(
`let currentUser, settings;`,
`let currentUser, settings, spotifyEmbedsEnabled = true;
const refreshSpotifyAvailability = async () => {
  try {
    const snapshot = await getDoc(doc(db, "siteSettings", "features"));
    spotifyEmbedsEnabled = !snapshot.exists() || snapshot.data().spotifyEmbedsEnabled !== false;
  } catch { spotifyEmbedsEnabled = true; }
  form.querySelector("button[type=submit]").disabled = !spotifyEmbedsEnabled;
  input.disabled = !spotifyEmbedsEnabled;
  if (!spotifyEmbedsEnabled) status.textContent = "Spotify playlist embeds are temporarily paused by AnonChat administration.";
  return spotifyEmbedsEnabled;
};`);
  out = out.replace(
`  const [accessSnapshot, settingsSnapshot, profileSnapshot] = await Promise.all([getDoc(doc(db, "premiumAccess", user.uid)), getDoc(doc(db, "premiumSettings", user.uid)), getDoc(doc(db, "users", user.uid))]);`,
`  const [accessSnapshot, settingsSnapshot, profileSnapshot] = await Promise.all([getDoc(doc(db, "premiumAccess", user.uid)), getDoc(doc(db, "premiumSettings", user.uid)), getDoc(doc(db, "users", user.uid))]);
  await refreshSpotifyAvailability();`);
  out = out.replace(
`form.addEventListener("submit", async (event) => { event.preventDefault(); const id = playlistId(input.value);`,
`form.addEventListener("submit", async (event) => { event.preventDefault(); if (!(await refreshSpotifyAvailability())) { status.textContent = "Spotify playlist embeds are temporarily paused by AnonChat administration."; return; } const id = playlistId(input.value);`);
  return out;
});

for (const path of ["index.html", "timeline.html", "profile.html", "community.html", "premium.html", "premium-playlist.html", "delete-account.html"]) {
  await patch(path, html => {
    if (html.includes("site-announcement.js")) return html;
    const tag = '<script type="module" src="site-announcement.js"></script>';
    if (!html.includes("</body>")) throw new Error(path + " has no body close tag");
    return html.replace("</body>", tag + "\n</body>");
  });
}

await patch("sw.js", source => source.includes('"./site-announcement.js"') ? source : source.replace('  "./pwa.js",', '  "./pwa.js",\n  "./site-announcement.js",'));

await patch("docs/superpowers/specs/2026-09-04-simplified-admin-command-center-design.md", source => source.replace(
"Missing fields default to `true` so existing production behavior remains unchanged until an administrator deliberately changes a switch.",
"Missing feature fields default to `true` so existing production behavior remains unchanged, except registrations. Registrations default to `false` when no settings document exists, preserving AnonChat's current closed-registration launch state until an administrator deliberately opens registration."));

console.log("user-facing admin controls applied");
