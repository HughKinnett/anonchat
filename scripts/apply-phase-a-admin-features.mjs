import { readFile, writeFile } from "node:fs/promises";

const path = new URL("../admin.js", import.meta.url);
let source = await readFile(path, "utf8");

const replaceOnce = (before, after, label) => {
  if (source.includes(after)) return;
  if (!source.includes(before)) throw new Error(`Could not find ${label}`);
  source = source.replace(before, after);
};

replaceOnce(
`features: { registrationsEnabled: false, postingEnabled: true, commentsEnabled: true, privateMessagingEnabled: true, temporaryChatsEnabled: true, uploadsEnabled: true, spotifyEmbedsEnabled: true }`,
`features: { registrationsEnabled: false, postingEnabled: true, commentsEnabled: true, privateMessagingEnabled: true, temporaryChatsEnabled: true, uploadsEnabled: true, spotifyEmbedsEnabled: true, badgeAwardsEnabled: true, profilePinsEnabled: true, profileQrEnabled: true }`,
"initial feature state"
);

replaceOnce(
`const DEFAULT_FEATURES = Object.freeze({ registrationsEnabled: false, postingEnabled: true, commentsEnabled: true, privateMessagingEnabled: true, temporaryChatsEnabled: true, uploadsEnabled: true, spotifyEmbedsEnabled: true });`,
`const DEFAULT_FEATURES = Object.freeze({ registrationsEnabled: false, postingEnabled: true, commentsEnabled: true, privateMessagingEnabled: true, temporaryChatsEnabled: true, uploadsEnabled: true, spotifyEmbedsEnabled: true, badgeAwardsEnabled: true, profilePinsEnabled: true, profileQrEnabled: true });`,
"default feature flags"
);

replaceOnce(
`["spotifyEmbedsEnabled","Spotify embeds","Allow new Spotify playlist embeds."]]`,
`["spotifyEmbedsEnabled","Spotify embeds","Allow new Spotify playlist embeds."],["badgeAwardsEnabled","Badge awarding","Allow automatic achievement badges to be awarded."],["profilePinsEnabled","Profile pinning","Allow users to pin or unpin a post on their profile."],["profileQrEnabled","Profile QR","Allow profile QR cards to be generated."]]`,
"feature info"
);

replaceOnce(
`const EMERGENCY_FEATURES = new Set(["registrationsEnabled", "postingEnabled", "privateMessagingEnabled"]);`,
`const EMERGENCY_FEATURES = new Set(["registrationsEnabled", "postingEnabled", "privateMessagingEnabled", "badgeAwardsEnabled", "profilePinsEnabled", "profileQrEnabled"]);`,
"emergency feature set"
);

replaceOnce(
`...["registrationsEnabled","postingEnabled","privateMessagingEnabled"].map`,
`...["registrationsEnabled","postingEnabled","privateMessagingEnabled","badgeAwardsEnabled","profilePinsEnabled","profileQrEnabled"].map`,
"emergency controls"
);

replaceOnce(
`["Spotify embeds",state.features.spotifyEmbedsEnabled,state.features.spotifyEmbedsEnabled?"Available":"Paused"],["Moderation service"`,
`["Spotify embeds",state.features.spotifyEmbedsEnabled,state.features.spotifyEmbedsEnabled?"Available":"Paused"],["Badge awarding",state.features.badgeAwardsEnabled,state.features.badgeAwardsEnabled?"Available":"Paused"],["Profile pinning",state.features.profilePinsEnabled,state.features.profilePinsEnabled?"Available":"Paused"],["Profile QR",state.features.profileQrEnabled,state.features.profileQrEnabled?"Available":"Paused"],["Moderation service"`,
"site health rows"
);

await writeFile(path, source);
console.log("Phase A admin features patch applied");
