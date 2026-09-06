import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [awardSource, firestoreSource, processorSource, adapterSource, routingSource, reconciliationSource, reconciliationWorkflow, packageSource, policySource, founderSource] = await Promise.all([
  readFile(new URL("../badge-awards.mjs", import.meta.url), "utf8").catch(() => ""),
  readFile(new URL("../badge-firestore.mjs", import.meta.url), "utf8"),
  readFile(new URL("../badge-award-processor.mjs", import.meta.url), "utf8").catch(() => ""),
  readFile(new URL("../badge-award-firestore-adapter.mjs", import.meta.url), "utf8").catch(() => ""),
  readFile(new URL("../badge-activity-routing.mjs", import.meta.url), "utf8").catch(() => ""),
  readFile(new URL("../badge-account-age-reconciliation.mjs", import.meta.url), "utf8").catch(() => ""),
  readFile(new URL("../.github/workflows/process-badge-account-age.yml", import.meta.url), "utf8").catch(() => ""),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
  readFile(new URL("../badge-policy.mjs", import.meta.url), "utf8"),
  readFile(new URL("../founder-identities.mjs", import.meta.url), "utf8")
]);

assert.match(awardSource, /evaluateBadgeMilestones/, "automatic badge award service exports evaluateBadgeMilestones");
assert.match(awardSource, /matchingAutomaticBadges/, "award service qualifies definitions through the milestone evaluator");
assert.doesNotMatch(awardSource, /setDoc\s*\(/, "browser award helper never writes badge assignments directly");
assert.doesNotMatch(awardSource, /users["']\s*,\s*uid\s*,\s*["']badges["']/, "browser award helper never targets the protected assignment path");

assert.match(processorSource, /processBadgeAwards/, "trusted badge processor exports processBadgeAwards");
assert.match(processorSource, /matchingAutomaticBadges/, "trusted processor uses the milestone evaluator");
assert.match(processorSource, /already-earned/, "trusted processor preserves existing permanent badge assignments");
assert.match(processorSource, /changedMetrics/, "trusted processor evaluates only requested metrics");
assert.match(processorSource, /premium_active[\s\S]*removeStatusBadge|removeStatusBadge[\s\S]*premium-member/, "trusted processor revokes Premium Member when paid Premium becomes inactive");

assert.match(adapterSource, /ANONCHAT_BADGE_CATALOG/, "trusted adapter reads the fixed code-owned badge catalog");
assert.doesNotMatch(adapterSource, /collection\(["']badgeTypes["']|collection\("badgeTypes"\)|\.collection\("badgeTypes"\)/, "trusted adapter does not read mutable badge definitions from Firestore");
assert.match(adapterSource, /runTransaction/, "trusted adapter performs idempotent badge assignment writes transactionally");
assert.match(adapterSource, /awardSource\s*:\s*["']automatic["']/, "trusted adapter records automatic award source");
assert.match(adapterSource, /removeStatusBadge/, "trusted adapter can remove revocable system status badges only through server processing");

assert.match(policySource, /founder/, "fixed catalog includes Founder");
assert.match(policySource, /founding-member/, "fixed catalog includes Founding Member");
assert.match(policySource, /premium-member[\s\S]*persistent:\s*false/, "Premium Member is the revocable paid-status badge");
assert.match(founderSource, /FOUNDER_USERNAMES/, "Founder eligibility is centralized in trusted product-owned code");

assert.match(routingSource, /posts_created/, "post creation routes to posts_created");
assert.match(routingSource, /single_post_interactions/, "post interaction routes to single_post_interactions");
assert.match(routingSource, /comments_or_replies_created/, "comment or reply creation routes to comments_or_replies_created");
assert.match(routingSource, /followers_count/, "follow changes route to followers_count");
assert.match(routingSource, /premium_active/, "premium reconciliation routes to premium_active");
assert.match(routingSource, /early_member/, "profile initialization routes to early_member");
assert.match(routingSource, /account_age_days/, "profile initialization routes to account_age_days");

assert.match(reconciliationSource, /ACCOUNT_AGE_BATCH_SIZE/, "automatic identity/status reconciliation declares a bounded batch size");
assert.match(reconciliationSource, /\.limit\s*\(/, "automatic reconciliation uses a bounded Firestore user query");
assert.match(reconciliationSource, /startAfter/, "automatic reconciliation supports cursor pagination");
for (const metric of [
  "founder",
  "founding_member",
  "early_member",
  "early_supporter",
  "verified_admin",
  "premium_active",
  "account_age_days"
]) assert.match(reconciliationSource, new RegExp(metric), `scheduled reconciliation evaluates ${metric}`);
assert.match(reconciliationSource, /tier\s*===\s*["']subscriber["']/, "Premium Member reconciliation requires the paid subscriber tier");
assert.match(reconciliationSource, /processBadgeAwards/, "scheduled reconciliation uses the trusted award processor");
assert.match(reconciliationWorkflow, /schedule:/, "automatic identity/status reconciliation is scheduled");
assert.match(reconciliationWorkflow, /badge-account-age:process/, "scheduled workflow invokes the bounded trusted processor command");
assert.match(packageSource, /"badge-account-age:process"/, "package exposes the trusted reconciliation command");

assert.doesNotMatch(firestoreSource, /saveBadgeType|setUserBadge|removeUserBadge|setBadgeFeatured/, "browser Firestore helper exposes no badge mutation API");

console.log("badge award contract tests passed");
