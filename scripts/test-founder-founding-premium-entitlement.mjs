import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const [reconciliation, processor, adapter] = await Promise.all([
  readFile(new URL("badge-account-age-reconciliation.mjs", root), "utf8"),
  readFile(new URL("badge-award-processor.mjs", root), "utf8"),
  readFile(new URL("badge-award-firestore-adapter.mjs", root), "utf8")
]);

assert.match(reconciliation, /const\s+founder\s*=\s*isAnonChatFounder\(profile\.username\)/,
  "reconciliation resolves founder once from the trusted identity source");
assert.match(reconciliation, /foundingMember\s*=\s*!founder\s*&&\s*createdAt\s*<=\s*FOUNDING_MEMBER_CUTOFF/,
  "founders are excluded from Founding Member eligibility");
assert.match(reconciliation, /premiumEntitled\s*=\s*isPaidSubscriber\(premium\)\s*\|\|\s*founder\s*\|\|\s*foundingMember/,
  "founders and Founding Members receive Premium entitlement in addition to paid subscribers");
assert.match(reconciliation, /premium_active:\s*premiumEntitled/,
  "Premium badge matching uses the complete trusted entitlement");
assert.match(adapter, /trustedPremiumEntitlement\s*\(uid\)/,
  "Firestore badge adapter can independently verify trusted founding Premium entitlement");
assert.match(processor, /trustedPremiumEntitlement/,
  "Premium removal checks trusted founding entitlement before deleting the badge");

console.log("founder/founding Premium entitlement contract passed");
