import assert from "node:assert/strict";
import fs from "node:fs";
import { hasPremiumAccess, premiumDefaults, premiumLabel, PREMIUM_COLOR_NAMES, sanitizedPremiumSettings, validPremiumSettings } from "../premium-policy.mjs";

for (const tier of ["founder", "founding", "subscriber"]) assert.equal(hasPremiumAccess({ tier, status: "active" }), true);
assert.equal(hasPremiumAccess({ tier: "subscriber", status: "canceled" }), false);
assert.equal(hasPremiumAccess({ tier: "founding", status: "past_due" }), false);
assert.equal(premiumLabel({ tier: "founder" }), "Founder");
assert.equal(premiumLabel({ tier: "founding" }), "Founding Member");
assert.equal(premiumLabel({ tier: "subscriber" }), "Premium Member");
assert.equal(validPremiumSettings(premiumDefaults("member"), "member"), true);
assert.equal(validPremiumSettings({ ...premiumDefaults("member"), spotifyPlaylistUrl: "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M" }, "member"), true);
assert.equal(validPremiumSettings({ ...premiumDefaults("member"), spotifyPlaylistUrl: "https://example.com/playlist/not-spotify" }, "member"), false);
assert.equal(validPremiumSettings(sanitizedPremiumSettings("member", { unknownLegacyField: true, pageColor: "retired-color" }), "member"), true);
assert.equal(validPremiumSettings({ ...premiumDefaults("member"), onlineVisible: "yes" }, "member"), false);
assert.equal(PREMIUM_COLOR_NAMES.length >= 30, true);
assert.equal(PREMIUM_COLOR_NAMES.includes("neonPink"), true);
assert.equal(PREMIUM_COLOR_NAMES.includes("purpleRain"), true);
assert.equal(validPremiumSettings({ ...premiumDefaults("member"), pageColor: "invisible" }, "member"), false);

const rules = fs.readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
assert.match(rules, /match \/premiumAccess\/\{userId\}[\s\S]*?allow write: if false;/);
assert.match(rules, /request\.resource\.data\.moderatorIds\.size\(\) <= 2/);
assert.match(rules, /premiumRoomModerator\(roomId\)/);
assert.match(rules, /isPremiumUidAfter\(request\.resource\.data\.uid\)/);
assert.match(rules, /match \/premiumRooms\/\{roomId\}\/messages\/\{messageId\}/);
assert.match(rules, /request\.resource\.data\.roomColor in \['black','white','gray'/);
assert.match(rules, /request\.resource\.data\.temporaryChatBubbleColor in \['black','white','gray'/);
assert.match(rules, /request\.resource\.data\.avatarId in \['none', 'avatar-1'/);
assert.match(rules, /isPremiumUidAfter\(request\.auth\.uid\).*content\.size\(\) <= 20000/s);

const menu = fs.readFileSync(new URL("../premium-menu.js", import.meta.url), "utf8");
assert.match(menu, /deleteDoc\(doc\(db, "appPresence", user\.uid\)\)/);
assert.match(menu, /hasPremiumAccess\(access\)/);
assert.match(menu, /Ghost Mode:/);
assert.match(menu, /premium-playlist[.]html/);
assert.equal(fs.existsSync(new URL("../premium-playlist.html", import.meta.url)), true);
assert.equal(fs.existsSync(new URL("../premium-playlist.js", import.meta.url)), true);
const rooms = fs.readFileSync(new URL("../premium-rooms.js", import.meta.url), "utf8");
assert.doesNotMatch(rooms, /premium-room-color|roomColorSelect|new Option\(color[.]label/);
assert.match(rooms, /roomColor:"purple"/);

const stripeConfigPath = new URL("../stripe-client-config.mjs", import.meta.url);
assert.equal(fs.existsSync(stripeConfigPath), true, "Stripe client config exists without requiring Firestore");
if (fs.existsSync(stripeConfigPath)) {
  const stripeConfig = fs.readFileSync(stripeConfigPath, "utf8");
  assert.match(stripeConfig, /publishableKey:\s*["']pk_live_/, "Stripe client config contains a live publishable key");
  assert.match(stripeConfig, /productId:\s*["']["']/, "Stripe product ID placeholder exists");
  assert.match(stripeConfig, /priceId:\s*["']["']/, "Stripe price ID placeholder exists");
  assert.match(stripeConfig, /customerId:\s*["']["']/, "Stripe customer ID placeholder exists");
  assert.match(stripeConfig, /subscriptionId:\s*["']["']/, "Stripe subscription ID placeholder exists");
  assert.match(stripeConfig, /subscriptionStatus:\s*["']["']/, "Stripe subscription status placeholder exists");
  assert.doesNotMatch(stripeConfig, /sk_(live|test)_/, "Stripe secret keys must never be stored in client config");
}

const premiumClient = fs.readFileSync(new URL("../premium.js", import.meta.url), "utf8");
assert.doesNotMatch(premiumClient, /collection\(db,\s*["']customers["']/, "Premium client must not create Stripe checkout sessions in Firestore");
assert.doesNotMatch(premiumClient, /checkout_sessions/, "Premium client must remain disconnected from Firestore-backed Stripe checkout");
assert.doesNotMatch(premiumClient, /addDoc\(/, "Premium client must not write billing data to Firestore");
assert.match(premiumClient, /stripe-client-config[.]mjs/, "Premium client consumes the Stripe-ready client config");

console.log("Premium policy tests passed.");