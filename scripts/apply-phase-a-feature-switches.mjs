import { readFile, writeFile } from "node:fs/promises";

const replaceRequired = (source, before, after, label) => {
  if (source.includes(after)) return source;
  if (!source.includes(before)) throw new Error(`Could not find ${label}`);
  return source.replace(before, after);
};

const replacePattern = (source, pattern, replacement, label) => {
  if (source.includes(replacement)) return source;
  if (!pattern.test(source)) throw new Error(`Could not find ${label}`);
  return source.replace(pattern, replacement);
};

const adminPath = new URL("../admin.js", import.meta.url);
let admin = await readFile(adminPath, "utf8");

admin = replacePattern(
  admin,
  /features: \{ registrationsEnabled: false,[^}]*spotifyEmbedsEnabled: true[^}]*\}, announcement:/,
  'features: { registrationsEnabled: false, postingEnabled: true, commentsEnabled: true, privateMessagingEnabled: true, temporaryChatsEnabled: true, uploadsEnabled: true, spotifyEmbedsEnabled: true, badgeAwardsEnabled: true, profilePinsEnabled: true, profileQrEnabled: true }, announcement:',
  "admin feature state"
);

admin = replacePattern(
  admin,
  /const DEFAULT_FEATURES = Object\.freeze\(\{[^\n]*\}\);/,
  'const DEFAULT_FEATURES = Object.freeze({ registrationsEnabled: false, postingEnabled: true, commentsEnabled: true, privateMessagingEnabled: true, temporaryChatsEnabled: true, uploadsEnabled: true, spotifyEmbedsEnabled: true, badgeAwardsEnabled: true, profilePinsEnabled: true, profileQrEnabled: true });',
  "default feature list"
);

admin = replacePattern(
  admin,
  /const FEATURE_INFO = \[[^\n]*\];/,
  'const FEATURE_INFO = [["registrationsEnabled","New registrations","Allow new people to create AnonChat accounts."],["postingEnabled","Posting","Allow users to create new timeline and community posts."],["commentsEnabled","Comments","Allow users to add new comments."],["privateMessagingEnabled","Private messaging","Allow private message requests and messages."],["temporaryChatsEnabled","Temporary chats","Allow temporary rooms and room messages."],["uploadsEnabled","Photo uploads","Allow users to attach new photos."],["spotifyEmbedsEnabled","Spotify embeds","Allow new Spotify playlist embeds."],["badgeAwardsEnabled","Badge awarding","Allow automatic achievement badges to be awarded."],["profilePinsEnabled","Profile pinning","Allow users to pin and unpin profile posts."],["profileQrEnabled","Profile QR","Allow users to open profile QR cards."]];',
  "feature descriptions"
);

admin = replacePattern(
  admin,
  /const EMERGENCY_FEATURES = new Set\(\[[^\n]*\]\);/,
  'const EMERGENCY_FEATURES = new Set(["registrationsEnabled", "postingEnabled", "privateMessagingEnabled", "badgeAwardsEnabled", "profilePinsEnabled", "profileQrEnabled"]);',
  "emergency feature list"
);

admin = replacePattern(
  admin,
  /if \(!enabled && EMERGENCY_FEATURES\.has\(key\) && !window\.confirm\("[^"]*"\)\)/,
  'if (!enabled && EMERGENCY_FEATURES.has(key) && !window.confirm("This emergency control pauses a user-facing AnonChat feature. Continue?"))',
  "emergency confirmation"
);

admin = replacePattern(
  admin,
  /host\.replaceChildren\(\.\.\.\["registrationsEnabled","postingEnabled","privateMessagingEnabled"[^\]]*\]\.map\(key=>/,
  'host.replaceChildren(...["registrationsEnabled","postingEnabled","privateMessagingEnabled","badgeAwardsEnabled","profilePinsEnabled","profileQrEnabled"].map(key=>',
  "emergency control rendering"
);

if (!admin.includes('["Badge awarding",state.features.badgeAwardsEnabled')) {
  admin = replaceRequired(
    admin,
    '["Spotify embeds",state.features.spotifyEmbedsEnabled,state.features.spotifyEmbedsEnabled?"Available":"Paused"],["Moderation service"',
    '["Spotify embeds",state.features.spotifyEmbedsEnabled,state.features.spotifyEmbedsEnabled?"Available":"Paused"],["Badge awarding",state.features.badgeAwardsEnabled,state.features.badgeAwardsEnabled?"Available":"Paused"],["Profile pinning",state.features.profilePinsEnabled,state.features.profilePinsEnabled?"Available":"Paused"],["Profile QR",state.features.profileQrEnabled,state.features.profileQrEnabled?"Available":"Paused"],["Moderation service"',
    "site health rows"
  );
}

await writeFile(adminPath, admin);

const profilePath = new URL("../profile.js", import.meta.url);
let profile = await readFile(profilePath, "utf8");

profile = replaceRequired(
  profile,
  'let targetCommunityPosts = [];\nlet users = [];',
  'let targetCommunityPosts = [];\nlet phaseAFeatures = { profilePinsEnabled: true };\nlet users = [];',
  "profile feature state"
);

profile = replaceRequired(
  profile,
  '    if (post.authorId === currentUser.uid) {\n      const pinPost = document.createElement("button");',
  '    if (post.authorId === currentUser.uid && phaseAFeatures.profilePinsEnabled !== false) {\n      const pinPost = document.createElement("button");',
  "pin button feature gate"
);

profile = replaceRequired(
  profile,
  '      pinPost.addEventListener("click", async () => {\n        pinPost.disabled = true;',
  '      pinPost.addEventListener("click", async () => {\n        if (phaseAFeatures.profilePinsEnabled === false) {\n          setStatus("Profile pinning is temporarily paused.");\n          return;\n        }\n        pinPost.disabled = true;',
  "pin mutation feature gate"
);

profile = replaceRequired(
  profile,
  '  currentUser = user;\n  blockTracker = createViewerBlockTracker(user.uid);',
  '  currentUser = user;\n  sessionListeners.push(onSnapshot(doc(db, "siteSettings", "features"), (snapshot) => {\n    const features = snapshot.exists() ? snapshot.data() : {};\n    phaseAFeatures = { profilePinsEnabled: features.profilePinsEnabled !== false };\n    schedulePostsRender();\n  }, () => { phaseAFeatures = { profilePinsEnabled: true }; }));\n  blockTracker = createViewerBlockTracker(user.uid);',
  "profile feature listener"
);

await writeFile(profilePath, profile);
console.log("Phase A feature switches applied");
