# Profile, Messaging, Badge, QR, and Android Architecture Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make My Profile use one canonical target, keep badges only behind a themed Badges button, render profile QR locally, make legacy accepted conversations writable through canonical pair IDs, enforce Founder/Founding Member/Premium badge rules, and ship the same verified behavior through Android.

**Architecture:** Introduce small shared policy modules instead of letting `profile.js`, `profile-badges.js`, `profile-phase-a.js`, and the migration scripts infer identity/conversation state independently. Canonicalize legacy accepted conversations server-side during the existing production migration, make the browser always resolve a deterministic pair ID for new writes, and centralize founder/founding/Premium entitlement logic so backfill and verification use the same rules.

**Tech Stack:** Vanilla HTML/CSS/JavaScript ES modules, Firebase Auth, Cloud Firestore, Firebase Admin SDK, Node `.mjs` regression scripts, service worker/PWA assets, Android Trusted Web Activity, Gradle, GitHub Actions/Firebase Hosting.

**Spec:** `docs/superpowers/specs/2026-09-06-profile-messaging-badge-architecture-fix-design.md`

## Global Constraints

- Android remains a thin TWA loading `https://anonchatlogin.web.app/`; do not duplicate web profile/messaging UI natively.
- Direct messages remain end-to-end encrypted; no plaintext direct-message writes may be introduced.
- Founder and Founding Member are mutually exclusive.
- Founder entitlement is `founder` + `premium-member`, never `founding-member`.
- Eligible non-founder Founding Member entitlement is `founding-member` + `premium-member`.
- Paid Premium behavior remains valid for ordinary subscribers.
- Badge privacy remains authoritative for visitors; owners can always inspect their own collection.
- Earned badges must not render as an inline preview card above Spotify; badge collection/detail stays behind the themed `Badges` button.
- Any added or changed button/input/dialog/card must reuse existing AnonChat classes/tokens.
- Advance the service-worker cache version for every hosted asset change in this release.
- Do not merge until focused tests, full Phase C, Firestore rules, profile/bugfix, badge/removal, Android parity, and real Android APK/AAB build are green on the exact final head.

---

### Task 1: Canonical profile target resolver

**Files:**
- Create: `profile-target.mjs`
- Modify: `profile.js`
- Modify: `profile-badges.js`
- Modify: `profile-phase-a.js`
- Test: `scripts/test-profile-target-resolution.mjs`
- Test: `scripts/test-profile-badge-target-resolution.mjs`

**Interfaces:**
- Produces: `resolveProfileTarget({ search, currentUserUid }) -> string | null`
- Consumed by: all profile controllers before reading profile/posts/privacy/badges/share/QR state.

- [ ] **Step 1: Write the failing target-resolution test**

Create `scripts/test-profile-target-resolution.mjs` to assert:

```js
import assert from "node:assert/strict";
import { resolveProfileTarget } from "../profile-target.mjs";

assert.equal(resolveProfileTarget({ search: "?uid=other", currentUserUid: "me" }), "other");
assert.equal(resolveProfileTarget({ search: "", currentUserUid: "me" }), "me");
assert.equal(resolveProfileTarget({ search: "?uid=", currentUserUid: "me" }), "me");
assert.equal(resolveProfileTarget({ search: "", currentUserUid: "" }), null);
```

Also read `profile.js`, `profile-badges.js`, and `profile-phase-a.js` and assert each imports and calls `resolveProfileTarget` rather than defining its own query-only target fallback.

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `node scripts/test-profile-target-resolution.mjs`

Expected: FAIL because `profile-target.mjs` does not exist and `profile.js` still uses query-only `targetUserId`.

- [ ] **Step 3: Implement the resolver and wire all profile controllers**

Create:

```js
export const resolveProfileTarget = ({ search = "", currentUserUid = "" } = {}) => {
  const queryUid = new URLSearchParams(String(search || "")).get("uid")?.trim() || "";
  const ownerUid = String(currentUserUid || "").trim();
  return queryUid || ownerUid || null;
};
```

In all three controllers, wait for `auth.authStateReady()` before owner fallback, then set the resolved target once and use it for profile fetches, owner comparisons, posts, badges, privacy, Share, QR, follows, Premium visuals, report/block targets, and canonical URLs.

- [ ] **Step 4: Run focused profile tests**

Run:

```bash
node scripts/test-profile-target-resolution.mjs
node scripts/test-profile-badge-target-resolution.mjs
node --check profile.js
node --check profile-badges.js
node --check profile-phase-a.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add profile-target.mjs profile.js profile-badges.js profile-phase-a.js scripts/test-profile-target-resolution.mjs scripts/test-profile-badge-target-resolution.mjs
git commit -m "fix: unify profile target resolution"
```

---

### Task 2: Badge button-only display model

**Files:**
- Modify: `profile.html`
- Modify: `profile-badges.js`
- Modify: `profile-phase-a.css`
- Test: `scripts/test-profile-badge-target-resolution.mjs`
- Test: `scripts/test-profile-badge-theme.mjs`

**Interfaces:**
- Consumes: resolved target from Task 1.
- Produces: one `#profile-badges-open` action that opens the collection dialog; no inline preview section above Spotify.

- [ ] **Step 1: Extend the badge UI tests to require button-only access**

Assert that `profile.html` contains a themed action:

```html
<button id="profile-badges-open" class="secondary-button" type="button">Badges</button>
```

and does **not** contain the old visible preview controls `profile-badges-list` or `profile-badges-view-all` in the page flow. Keep `profile-badges-collection-dialog` and `profile-badge-dialog`.

Assert `profile-badges.js`:
- shows the action for owner whenever the profile is available;
- shows the action for visitors only after a successful badge read;
- never hides the owner action merely because `showBadges` is false;
- renders empty collection text inside the dialog when the user has no badges.

- [ ] **Step 2: Run badge UI tests and confirm RED**

Run:

```bash
node scripts/test-profile-badge-target-resolution.mjs
node scripts/test-profile-badge-theme.mjs
```

Expected: FAIL because the inline preview section still exists and the action starts hidden behind data-load success.

- [ ] **Step 3: Remove the inline preview and make action visibility explicit**

Delete the inline `#profile-badges-section` preview from normal profile layout. Keep privacy text inside owner controls and keep both dialogs. Simplify `profile-badges.js` so it loads assignments directly into `allBadges`, controls only `entryButton` and dialogs, and uses owner identity to keep the button available even when privacy is off.

Reuse existing classes/tokens; do not add one-off button colors or shapes.

- [ ] **Step 4: Run badge UI tests**

Run:

```bash
node scripts/test-profile-badge-target-resolution.mjs
node scripts/test-profile-badge-theme.mjs
node --check profile-badges.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add profile.html profile-badges.js profile-phase-a.css scripts/test-profile-badge-target-resolution.mjs scripts/test-profile-badge-theme.mjs
git commit -m "fix: keep badges behind profile action"
```

---

### Task 3: Local profile QR rendering

**Files:**
- Create: `profile-qr-renderer.mjs`
- Create: `vendor/qrcode.min.js`
- Modify: `profile.html`
- Modify: `profile-phase-a.js`
- Modify: `sw.js`
- Test: `scripts/test-profile-share-contract.mjs`
- Create: `scripts/test-profile-qr-rendering.mjs`

**Interfaces:**
- Produces: `renderProfileQr(canvas, payload) -> Promise<void>` from a repository-local renderer.
- Consumes: canonical profile URL from `safeProfileQrPayload` and resolved target from Task 1.

- [ ] **Step 1: Write RED QR tests**

`test-profile-qr-rendering.mjs` must assert:
- `profile.html` no longer loads `https://cdn.jsdelivr.net/...qrcode...`;
- `profile-phase-a.js` imports `renderProfileQr`;
- `profile-qr-renderer.mjs` imports or wraps only repository-local `vendor/qrcode.min.js`;
- `sw.js` caches both local QR assets;
- QR payload still equals the canonical `profile.html?uid=<uid>` URL and contains no session/token data.

- [ ] **Step 2: Run QR tests and confirm RED**

Run:

```bash
node scripts/test-profile-qr-rendering.mjs
node scripts/test-profile-share-contract.mjs
```

Expected: FAIL because profile rendering still relies on global `QRCode` from CDN.

- [ ] **Step 3: Vendor the QR renderer and add the wrapper**

Commit a browser-compatible minified QR library under `vendor/qrcode.min.js` with its license header preserved. Create `profile-qr-renderer.mjs` that exposes a stable wrapper and writes to the supplied canvas. Remove the external QR `<script>` from `profile.html`.

Update `profile-phase-a.js`:

```js
import { renderProfileQr } from "./profile-qr-renderer.mjs";
```

and replace the global check/call with:

```js
const canvas = document.createElement("canvas");
qrCanvas.append(canvas);
await renderProfileQr(canvas, payload);
```

Keep existing status/error fallback and canonical URL text.

- [ ] **Step 4: Run QR tests and syntax checks**

Run:

```bash
node scripts/test-profile-qr-rendering.mjs
node scripts/test-profile-share-contract.mjs
node --check profile-phase-a.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add vendor/qrcode.min.js profile-qr-renderer.mjs profile.html profile-phase-a.js sw.js scripts/test-profile-qr-rendering.mjs scripts/test-profile-share-contract.mjs
git commit -m "fix: render profile qr from local assets"
```

---

### Task 4: Canonical conversation pair policy and client send path

**Files:**
- Create: `private-conversation-id.mjs`
- Modify: `community.js`
- Modify: `private-message-visibility-integration.js`
- Test: `scripts/test-private-message-send-readiness.mjs`
- Test: `scripts/test-community-lifecycle.mjs`
- Create: `scripts/test-private-conversation-id.mjs`

**Interfaces:**
- Produces: `canonicalConversationId(leftUid, rightUid) -> string` and `isCanonicalConversationId(id, leftUid, rightUid) -> boolean`.
- Consumed by: conversation resolution, Send, visibility/deletion records, migration Task 5.

- [ ] **Step 1: Write RED pair-ID tests**

Create tests:

```js
assert.equal(canonicalConversationId("b", "a"), "a_b");
assert.equal(canonicalConversationId("a", "b"), "a_b");
assert.equal(isCanonicalConversationId("a_b", "a", "b"), true);
assert.equal(isCanonicalConversationId("legacy123", "a", "b"), false);
```

Extend send-readiness/lifecycle tests to assert the send handler computes the canonical ID from the selected participant pair and creates the message reference under `messageRequests/{canonicalId}/messages/{messageId}`, never `acceptedRequest.id` when that ID is legacy.

- [ ] **Step 2: Run focused messaging tests and confirm RED**

Run:

```bash
node scripts/test-private-conversation-id.mjs
node scripts/test-private-message-send-readiness.mjs
node scripts/test-community-lifecycle.mjs
```

Expected: FAIL because Send still writes under `acceptedRequest.id`.

- [ ] **Step 3: Implement pair policy and update client resolution**

Use sorted UID order as the single canonical orientation. `requestFor(other)` may still detect a legacy relationship for display, but Send must resolve/fetch `messageRequests/{canonicalId}` and require its status to be accepted before writing. If only a legacy accepted relationship exists, surface a clear status such as `This older conversation is being upgraded. Reopen Messages after the migration completes.` rather than silently writing beneath the legacy ID.

Update participant-local visibility/index code to use the same `canonicalConversationId` helper instead of a separate pair function.

- [ ] **Step 4: Run messaging tests and syntax checks**

Run:

```bash
node scripts/test-private-conversation-id.mjs
node scripts/test-private-message-send-readiness.mjs
node scripts/test-community-lifecycle.mjs
node --check community.js
node --check private-message-visibility-integration.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add private-conversation-id.mjs community.js private-message-visibility-integration.js scripts/test-private-conversation-id.mjs scripts/test-private-message-send-readiness.mjs scripts/test-community-lifecycle.mjs
git commit -m "fix: send private messages through canonical conversations"
```

---

### Task 5: Migrate legacy accepted conversation headers and messages

**Files:**
- Modify: `scripts/direct-message-migration.mjs`
- Modify: `scripts/test-community-lifecycle.mjs`
- Create: `scripts/test-direct-message-conversation-migration.mjs`
- Modify: `.github/workflows/deploy-firebase.yml` only if the existing migration invocation does not already run the extended script in both pre-rule and catch-up phases.

**Interfaces:**
- Consumes: `canonicalConversationId` semantics from Task 4.
- Produces: idempotent production migration from arbitrary legacy accepted request IDs to sorted pair IDs while preserving messages and conversation metadata.

- [ ] **Step 1: Write an emulator-backed RED migration test**

Seed:
- `messageRequests/legacy-abc` with `{ fromId: "u2", toId: "u1", status: "accepted" }`;
- at least two child messages, including encrypted fields/reply metadata/expiry;
- visibility/index metadata used by the current app.

Run migration logic and assert:
- canonical `messageRequests/u1_u2` exists and is accepted;
- child messages exist under the canonical path with unchanged encrypted payload fields and IDs;
- rerunning migration produces no duplicate messages;
- legacy header is removed or marked migrated only after canonical verification;
- no direct message is left writable only under a noncanonical ID.

- [ ] **Step 2: Run migration test and confirm RED**

Run: `firebase emulators:exec --only firestore "node scripts/test-direct-message-conversation-migration.mjs"`

Expected: FAIL because the current migration only moves the retired top-level `directMessages` collection and never canonicalizes `messageRequests` headers.

- [ ] **Step 3: Extend the production migration**

Refactor `scripts/direct-message-migration.mjs` into two idempotent passes:
1. existing retired `directMessages` move;
2. accepted `messageRequests` canonicalization.

For the second pass, page by document ID, skip already canonical IDs, compute sorted pair ID, merge safe header fields, copy child collections needed by current chat behavior in bounded batches, verify destination counts/IDs, then delete or mark the legacy source. Never decrypt/re-encrypt payloads.

Print separate counters such as:

```text
DIRECT_MESSAGE_CONVERSATION_MIGRATION inspected=... canonicalized=... messagesMoved=... legacyRemoved=...
```

- [ ] **Step 4: Run migration and lifecycle tests**

Run:

```bash
firebase emulators:exec --only firestore "node scripts/test-direct-message-conversation-migration.mjs"
node scripts/test-community-lifecycle.mjs
node scripts/test-production-rollout.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/direct-message-migration.mjs scripts/test-direct-message-conversation-migration.mjs scripts/test-community-lifecycle.mjs .github/workflows/deploy-firebase.yml
git commit -m "fix: canonicalize legacy accepted conversations"
```

---

### Task 6: Founder, Founding Member, and Premium entitlement policy

**Files:**
- Modify: `badge-policy.mjs`
- Modify: `badge-account-age-reconciliation.mjs`
- Modify: `badge-award-processor.mjs` if current removal logic cannot consume founding entitlement context.
- Test: `scripts/test-badge-policy.mjs`
- Test: `scripts/test-badge-awards-contract.mjs`
- Test: `scripts/test-badge-milestones.mjs`

**Interfaces:**
- Produces: mutually exclusive founder/founding metrics and Premium retention based on `{ premiumActive, founder, foundingMember }`.
- Consumed by: existing-user reconciliation and production verification Task 7.

- [ ] **Step 1: Write RED entitlement tests**

Add assertions that:

```js
eligibleAutomaticBadgeIds({ founder: true, foundingMember: true, premiumActive: false })
```

contains `founder` and `premium-member` but not `founding-member`.

For a non-founder founding member, assert `founding-member` and `premium-member` are present.

Update `badgeShouldRemainVisible("premium-member", ...)` tests so founder/founding entitlement keeps Premium visible even when paid Premium is false, while an ordinary expired subscriber loses it.

- [ ] **Step 2: Run badge policy tests and confirm RED**

Run:

```bash
node scripts/test-badge-policy.mjs
node scripts/test-badge-awards-contract.mjs
node scripts/test-badge-milestones.mjs
```

Expected: FAIL because `founding_member` currently ignores founder status and `premium_active` only reflects paid subscribers.

- [ ] **Step 3: Implement mutually exclusive metrics and Premium entitlement**

In account reconciliation:

```js
const founder = isAnonChatFounder(profile.username);
const foundingMember = !founder && createdAt <= FOUNDING_MEMBER_CUTOFF;
const premiumEntitled = isPaidSubscriber(premium) || founder || foundingMember;
```

Pass these trusted metrics to award processing. Update policy/retention signatures so Premium remains visible when any trusted entitlement is active, without changing paid-subscriber behavior for ordinary users.

- [ ] **Step 4: Run badge policy tests**

Run the three focused scripts again. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add badge-policy.mjs badge-account-age-reconciliation.mjs badge-award-processor.mjs scripts/test-badge-policy.mjs scripts/test-badge-awards-contract.mjs scripts/test-badge-milestones.mjs
git commit -m "fix: separate founder and founding premium entitlements"
```

---

### Task 7: Production badge cleanup and verification

**Files:**
- Modify: `scripts/verify-founder-founding-badges.mjs`
- Modify: `scripts/test-existing-user-badge-backfill-workflow.mjs`
- Modify: `.github/workflows/backfill-existing-user-badges.yml`

**Interfaces:**
- Consumes: Task 6 trusted entitlement rules.
- Produces: production proof that founders have Founder + Premium and no Founding Member; eligible non-founder Founding Members have Founding Member + Premium.

- [ ] **Step 1: Extend verifier tests and confirm RED**

Require counters for:
- `founders`;
- `foundingMembers` (non-founder only);
- `foundersMissingFounder`;
- `foundersWithFoundingMember`;
- `foundersMissingPremium`;
- `foundingMembersMissingFounding`;
- `foundingMembersMissingPremium`.

The verifier must exit non-zero if any missing/overlap counter is non-zero.

- [ ] **Step 2: Run verifier contract test**

Run: `node scripts/test-existing-user-badge-backfill-workflow.mjs`

Expected: FAIL until overlap and Premium entitlement checks exist.

- [ ] **Step 3: Update production verifier/backfill workflow**

After full reconciliation, read trusted founder identity and creation cutoff, classify founders first, classify Founding Members only when `!founder`, and verify badge documents exactly as specified. Ensure the workflow still runs after successful Firebase deploy and reports the verifier output.

- [ ] **Step 4: Run workflow contract test**

Run: `node scripts/test-existing-user-badge-backfill-workflow.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/verify-founder-founding-badges.mjs scripts/test-existing-user-badge-backfill-workflow.mjs .github/workflows/backfill-existing-user-badges.yml
git commit -m "test: verify founder and founding badge entitlements"
```

---

### Task 8: Cache refresh and Android/TWA parity

**Files:**
- Modify: `sw.js`
- Modify: `scripts/test-android-current-web-parity.mjs`
- Modify: `.github/workflows/build-android.yml` only if new shared asset paths are not already covered.
- Modify: `android/README.md` if release notes need the corrected behavior documented.

**Interfaces:**
- Consumes: hosted assets from Tasks 1-7.
- Produces: updated service-worker shell and Android parity contract; fresh APK/AAB build on PR and `main`.

- [ ] **Step 1: Write/extend RED Android parity assertions**

Assert:
- local QR renderer assets are cached;
- `profile-target.mjs` is present/cached;
- profile badges are action-only, not inline preview;
- private messaging imports canonical conversation ID logic;
- TWA remains pointed at production origin;
- no duplicate native profile/messaging implementation is introduced.

- [ ] **Step 2: Advance cache version and update asset list**

Increment `anonchat-v138` to the next cache version and include every new shared module/vendor asset.

- [ ] **Step 3: Run focused parity tests**

Run:

```bash
node scripts/test-android-current-web-parity.mjs
node scripts/test-push-service-worker.mjs
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add sw.js scripts/test-android-current-web-parity.mjs .github/workflows/build-android.yml android/README.md
git commit -m "chore: refresh android parity assets"
```

---

### Task 9: Exact-head regression verification, review, merge, deploy, and production proof

**Files:**
- No product changes expected; only fix defects discovered by verification before merge.

**Interfaces:**
- Consumes: all previous tasks.
- Produces: one exact verified PR head, merged `main`, successful Firebase rollout, successful legacy-conversation migration, successful badge backfill/verifier, and successful Android APK/AAB build.

- [ ] **Step 1: Run focused local/static contracts**

Run:

```bash
node scripts/test-profile-target-resolution.mjs
node scripts/test-profile-badge-target-resolution.mjs
node scripts/test-profile-badge-theme.mjs
node scripts/test-profile-qr-rendering.mjs
node scripts/test-private-conversation-id.mjs
node scripts/test-private-message-send-readiness.mjs
node scripts/test-community-lifecycle.mjs
node scripts/test-badge-policy.mjs
node scripts/test-badge-awards-contract.mjs
node scripts/test-existing-user-badge-backfill-workflow.mjs
node scripts/test-android-current-web-parity.mjs
```

Expected: all PASS.

- [ ] **Step 2: Run emulator-backed focused tests**

Run:

```bash
firebase emulators:exec --only firestore "node scripts/test-direct-message-conversation-migration.mjs"
npm run test:e2ee
```

Expected: PASS.

- [ ] **Step 3: Open/update the draft PR and freeze the head**

Push all commits to `architectural-profile-messaging-badge-fix`, create a draft PR against `main`, then do not change the head unless a test/review finding requires it.

- [ ] **Step 4: Require exact-head CI**

Verify the final SHA has terminal success for:
- Profile badges/bugfix CI;
- Android Parity CI;
- Removals and Badges CI;
- Phase C CI;
- Firestore rules CI;
- real Build Android workflow with APK/AAB artifact upload.

- [ ] **Step 5: Perform pre-merge diff review**

Check specifically for:
- plaintext/private-key leakage;
- accidental weakening of Firestore message rules;
- legacy migration deleting source before destination verification;
- owner badge privacy regression;
- founder + Founding Member overlap;
- unthemed new controls;
- CDN dependency still present for profile QR;
- native Android feature duplication.

- [ ] **Step 6: Merge only the verified head**

Squash-merge the PR into `main` after all exact-head gates are green.

- [ ] **Step 7: Verify production rollout on merge SHA**

Confirm `Deploy Firebase` completes successfully through:
- production rollout gates;
- legacy direct-message migration/canonicalization;
- Firestore rule deployment;
- Hosting deployment;
- private-message catch-up.

- [ ] **Step 8: Verify badge production backfill**

Confirm the chained badge workflow completes and verifier reports zero for every missing/overlap category. Confirm the two trusted founders have Founder + Premium and no Founding Member, and eligible non-founder Founding Members have Founding Member + Premium.

- [ ] **Step 9: Verify Android main build**

Confirm `Build Android` on the exact merge SHA completes successfully and uploads fresh APK/AAB artifacts.

- [ ] **Step 10: Completion claim**

Only after Steps 7-9 are terminal success, report the merge SHA, Firebase run status, migration/backfill verifier result, Android build status, and cache version. Do not claim Play Store publication unless a separate Play publishing workflow actually confirms it.
