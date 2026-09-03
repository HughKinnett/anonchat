import assert from "node:assert/strict";
import {
  buildPostShareUrl,
  parseSharedPostKey,
  spotifyPlaylistIdFromEmbed,
  privacySafeSpotifyUrl,
  stablePostKey
} from "../social-sharing-policy.mjs";

assert.equal(
  buildPostShareUrl({ pageUrl: "https://anonchatlogin.web.app/timeline.html?mode=latest#old", postKey: "abc 123" }),
  "https://anonchatlogin.web.app/timeline.html?mode=latest#shared-post=abc%20123"
);
assert.equal(parseSharedPostKey("https://anonchatlogin.web.app/profile.html?uid=u#shared-post=abc%20123"), "abc 123");
assert.equal(parseSharedPostKey("https://anonchatlogin.web.app/profile.html?uid=u"), "");
assert.equal(
  spotifyPlaylistIdFromEmbed("https://open.spotify.com/embed/playlist/37i9dQZF1DXcBWIGoYBM5M?utm_source=generator&theme=0"),
  "37i9dQZF1DXcBWIGoYBM5M"
);
assert.equal(privacySafeSpotifyUrl("37i9dQZF1DXcBWIGoYBM5M"), "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M");
assert.equal(spotifyPlaylistIdFromEmbed("https://open.spotify.com/embed/track/11dFghVXANMlKmJXsNCbNl"), "");
assert.equal(stablePostKey("  Hello   anonymous world  "), stablePostKey("Hello anonymous world"));
assert.match(stablePostKey("Hello anonymous world"), /^[a-z0-9]+$/);

console.log("social sharing policy tests passed");
