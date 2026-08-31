import assert from "node:assert/strict";
import fs from "node:fs";
import { hasPremiumAccess, premiumDefaults, premiumLabel, PREMIUM_COLOR_NAMES, validPremiumSettings } from "../premium-policy.mjs";

for (const tier of ["founder", "founding", "subscriber"]) assert.equal(hasPremiumAccess({ tier, status: "active" }), true);
assert.equal(hasPremiumAccess({ tier: "subscriber", status: "canceled" }), false);
assert.equal(hasPremiumAccess({ tier: "founding", status: "past_due" }), false);
assert.equal(premiumLabel({ tier: "founder" }), "Founder");
assert.equal(premiumLabel({ tier: "founding" }), "Founding Member");
assert.equal(premiumLabel({ tier: "subscriber" }), "Premium Member");
assert.equal(validPremiumSettings(premiumDefaults("member"), "member"), true);
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
assert.match(rules, /match \/customers\/\{userId\}[\s\S]*?match \/checkout_sessions\/\{sessionId\}/);
assert.match(rules, /premiumCheckout\/public/);
assert.match(rules, /request\.resource\.data\.roomColor in \['black','white','gray'/);
assert.match(rules, /request\.resource\.data\.temporaryChatBubbleColor in \['black','white','gray'/);
assert.match(rules, /request\.resource\.data\.avatarId in \['none', 'avatar-1'/);
assert.match(rules, /isPremiumUidAfter\(request\.auth\.uid\).*content\.size\(\) <= 20000/s);

const menu = fs.readFileSync(new URL("../premium-menu.js", import.meta.url), "utf8");
assert.match(menu, /deleteDoc\(doc\(db, "appPresence", user\.uid\)\)/);
assert.match(menu, /hasPremiumAccess\(access\)/);
assert.match(menu, /Ghost Mode:/);
console.log("Premium policy tests passed.");
