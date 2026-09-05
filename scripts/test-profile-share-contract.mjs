import assert from "node:assert/strict";
import {
  buildCanonicalProfileUrl,
  buildProfileShareData,
  safeProfileQrPayload
} from "../profile-share.mjs";

const url = buildCanonicalProfileUrl("user 123", "https://anonchatlogin.web.app/timeline.html?session=secret#x");
assert.equal(url, "https://anonchatlogin.web.app/profile.html?uid=user%20123");
assert.doesNotMatch(url, /session=|token=|auth=/i);

const share = buildProfileShareData({
  profileId: "user 123",
  username: "anon_user",
  baseUrl: "https://anonchatlogin.web.app/timeline.html?session=secret"
});
assert.equal(share.url, url);
assert.match(share.title, /AnonChat/i);
assert.match(share.text, /@anon_user/);
assert.equal(safeProfileQrPayload({ profileId: "user 123", baseUrl: "https://anonchatlogin.web.app/anything" }), url);

assert.throws(() => buildCanonicalProfileUrl("", "https://anonchatlogin.web.app/"), /profile/i);
assert.throws(() => buildCanonicalProfileUrl("u1", "javascript:alert(1)"), /https/i);

console.log("profile share contract tests passed");
