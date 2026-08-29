# Moderation Reporting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add secure account blocking, post reporting, temporary-room suspension and preservation, and administrator restore/delete controls.

**Architecture:** Pure policy modules define deterministic IDs, visibility, moderation transitions, and retention decisions. Browser integrations use atomic Firestore batches, while Firestore rules independently enforce exact payloads and allowed state transitions. The administrator dashboard observes pending reports and performs auditable restore or permanent-delete actions.

**Tech Stack:** Static HTML/CSS, browser ES modules, Firebase Authentication, Cloud Firestore, Firebase Emulator Suite, Node.js policy tests.

**Spec:** `docs/superpowers/specs/2026-08-28-moderation-reporting-design.md`

## Global Constraints

- A report must preserve its target until an administrator resolves it.
- A reported post is hidden immediately and rejects new interaction writes.
- A reported room is suspended immediately and never expires automatically.
- Restoring a room starts a fresh 24-hour lifetime for the room and retained messages.
- Only the blocker may create or remove their block record.
- Only verified protected administrators may restore or permanently delete reported content.
- All client timestamps used for authorization are trusted Firestore server timestamps.
- Existing unreported post and temporary-room behavior must remain unchanged.

---

### Task 1: Pure moderation and blocking policy

**Files:**
- Create: `moderation-policy.mjs`
- Create: `scripts/test-moderation-policy.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `blockId(blockerId, blockedId)`, `reportId(kind, targetId, reporterId)`, `canShowActorContent(actorId, blockedPairs)`, `postIsVisible(post, now)`, `roomState(room, now)`, `postReportPayloads(input)`, `roomReportPayloads(input)`, `restorePostPayload(input)`, and `restoreRoomPayload(input)`.

- [ ] **Step 1: Write the failing policy test**

```js
import assert from "node:assert/strict";
import { blockId, reportId, postIsVisible, roomState, restoreRoomPayload } from "../moderation-policy.mjs";

assert.equal(blockId("a", "b"), "a_b");
assert.equal(reportId("post", "p1", "u1"), "post_p1_u1");
assert.equal(postIsVisible({ moderationStatus: "reported" }, Date.now()), false);
assert.equal(roomState({ moderationStatus: "reported", expiresAt: { toMillis: () => 1 } }, 2), "reported");
assert.deepEqual(restoreRoomPayload({ resolvedAt: "STAMP", expiresAt: "PLUS_24H" }), {
  moderationStatus: "active", reportedAt: null, resumedAt: "STAMP", expiresAt: "PLUS_24H"
});
```

- [ ] **Step 2: Verify RED**

Run: `node scripts/test-moderation-policy.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `moderation-policy.mjs`.

- [ ] **Step 3: Implement the pure functions**

```js
export const DAY_MS = 86_400_000;
export const blockId = (blockerId, blockedId) => `${blockerId}_${blockedId}`;
export const reportId = (kind, targetId, reporterId) => `${kind}_${targetId}_${reporterId}`;
export const postIsVisible = (post, now) => post.moderationStatus !== "reported"
  && (!post.expiresAt?.toMillis || post.expiresAt.toMillis() > now);
export const roomState = (room, now) => room.moderationStatus === "reported"
  ? "reported" : room.expiresAt?.toMillis?.() <= now ? "expired" : "active";
export const restoreRoomPayload = ({ resolvedAt, expiresAt }) => ({
  moderationStatus: "active", reportedAt: null, resumedAt: resolvedAt, expiresAt
});
```

Implement the remaining named exports with exact-key payloads from the spec and add `test:moderation-policy` to `package.json`.

- [ ] **Step 4: Verify GREEN**

Run: `npm run test:moderation-policy && npm test`
Expected: both commands exit 0.

- [ ] **Step 5: Commit**

```bash
git add moderation-policy.mjs scripts/test-moderation-policy.mjs package.json
git commit -m "feat: add moderation state policy"
```

### Task 2: Firestore report, block, and moderation authorization

**Files:**
- Modify: `firestore.rules`
- Modify: `firestore.indexes.json`
- Create: `scripts/test-moderation-rules.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: the exact field names produced by `moderation-policy.mjs`.
- Produces: collections `blocks`, `reports`, and authorized moderation fields on `posts` and `rooms`.

- [ ] **Step 1: Write failing emulator cases**

```js
await assertSucceeds(setDoc(doc(member, "blocks/member_target"), {
  blockerId: "member", blockedId: "target", createdAt: serverTimestamp()
}));
await assertFails(setDoc(doc(target, "blocks/member_target"), {
  blockerId: "member", blockedId: "target", createdAt: serverTimestamp()
}));
await assertFails(updateDoc(doc(member, "posts/post-1"), { moderationStatus: "reported" }));
await assertSucceeds(writeBatch(member)
  .set(doc(member, "reports/post_post-1_member"), validPostReport)
  .update(doc(member, "posts/post-1"), { moderationStatus: "reported", reportedAt: serverTimestamp() })
  .commit());
```

Add equivalent room report, suspended-room join/message denial, administrator restore, forged-admin denial, and duplicate-report denial cases.

- [ ] **Step 2: Verify RED**

Run: `firebase emulators:exec --only firestore "node scripts/test-moderation-rules.mjs"`
Expected: at least the legitimate block/report assertions fail.

- [ ] **Step 3: Implement rules and indexes**

Add exact-key helpers for block/report payloads, paired `getAfter` validation for report plus target updates, interaction guards for reported targets, and exact administrator restore transitions. Add report indexes for `status + createdAt` and `targetType + status + createdAt`.

- [ ] **Step 4: Verify GREEN**

Run: `firebase emulators:exec --only firestore "node scripts/test-moderation-rules.mjs" && npm run test:rules`
Expected: both suites exit 0; negative authorization cases may log expected `PERMISSION_DENIED` lines.

- [ ] **Step 5: Commit**

```bash
git add firestore.rules firestore.indexes.json scripts/test-moderation-rules.mjs package.json
git commit -m "feat: secure reports blocks and moderation states"
```

### Task 3: Profile blocking and cross-surface filtering

**Files:**
- Modify: `profile.html`
- Modify: `profile.js`
- Modify: `timeline.js`
- Modify: `community.js`
- Create: `block-integration.mjs`
- Create: `scripts/test-block-integration.mjs`

**Interfaces:**
- Consumes: `blockId` and `canShowActorContent` from `moderation-policy.mjs`.
- Produces: `loadBlockPairs({ db, uid })`, `isBlockedPair(leftUid, rightUid, pairs)`, and profile Block/Unblock UI.

- [ ] **Step 1: Write the failing integration test**

```js
assert.equal(isBlockedPair("a", "b", new Set(["a_b"])), true);
assert.equal(isBlockedPair("a", "b", new Set(["b_a"])), true);
assert.equal(isBlockedPair("a", "c", new Set(["a_b"])), false);
```

Also inspect source text to require the profile button and filtering calls in timeline and community rendering.

- [ ] **Step 2: Verify RED**

Run: `node scripts/test-block-integration.mjs`
Expected: FAIL because `block-integration.mjs` and Block User wiring do not exist.

- [ ] **Step 3: Implement blocking**

Create/delete the current user's deterministic block document from the profile. Observe both `blockerId == uid` and `blockedId == uid` queries, merge their IDs into a set, and filter profiles, posts, comments, reactions, message requests, direct messages, and room messages before rendering or enabling interaction.

- [ ] **Step 4: Verify GREEN**

Run: `node scripts/test-block-integration.mjs && npm test`
Expected: both commands exit 0.

- [ ] **Step 5: Commit**

```bash
git add profile.html profile.js timeline.js community.js block-integration.mjs scripts/test-block-integration.mjs
git commit -m "feat: add profile blocking across social surfaces"
```

### Task 4: Timeline report controls and hidden reported posts

**Files:**
- Modify: `timeline.html`
- Modify: `timeline.js`
- Modify: `profile.js`
- Modify: `timeline.css`
- Create: `scripts/test-post-report-ui.mjs`

**Interfaces:**
- Consumes: `reportId`, `postReportPayloads`, and `postIsVisible` from `moderation-policy.mjs`.
- Produces: a Report action on every non-owned timeline post and an atomic report submission.

- [ ] **Step 1: Write the failing UI source test**

```js
assert.match(timelineSource, /Report/);
assert.match(timelineSource, /postReportPayloads/);
assert.match(timelineSource, /writeBatch\(db\)/);
assert.match(profileSource, /postIsVisible/);
```

- [ ] **Step 2: Verify RED**

Run: `node scripts/test-post-report-ui.mjs`
Expected: FAIL because the report action and policy integration are absent.

- [ ] **Step 3: Implement post reporting**

Add a reason dialog with fixed choices (`Spam`, `Harassment`, `Threats`, `Sexual content`, `Other`). Submit the report document and post moderation update in one batch. Disable repeat reporting and remove reported posts from timeline/profile views immediately. Replace the photo input label with a compact circular bubble beside the Disappear control; when an expiration option changes, render the exact local disappearance date/time in the composer, and render the same timestamp on each expiring post. Reported posts show `Expiration paused for admin review` instead.

- [ ] **Step 4: Verify GREEN**

Run: `node scripts/test-post-report-ui.mjs && npm test`
Expected: both commands exit 0.

- [ ] **Step 5: Commit**

```bash
git add timeline.html timeline.js profile.js timeline.css scripts/test-post-report-ui.mjs
git commit -m "feat: report and hold timeline posts"
```

### Task 5: Temporary-room reporting, suspension, and retention

**Files:**
- Modify: `community.html`
- Modify: `community.js`
- Modify: `community.css`
- Create: `scripts/test-room-report-ui.mjs`

**Interfaces:**
- Consumes: `reportId`, `roomReportPayloads`, `roomState`, and `restoreRoomPayload` from `moderation-policy.mjs`.
- Produces: Report Room control, suspended-room UI, and reported-room retention behavior.

- [ ] **Step 1: Write failing room behavior tests**

```js
assert.match(source, /Report Room/);
assert.match(source, /roomReportPayloads/);
assert.match(source, /moderationStatus/);
assert.match(source, /roomState/);
```

Add policy assertions that reported messages remain eligible for admin review even after their original `expiresAt`, while ordinary users cannot render or write to the room.

- [ ] **Step 2: Verify RED**

Run: `node scripts/test-room-report-ui.mjs`
Expected: FAIL because room reporting is absent.

- [ ] **Step 3: Implement room reporting and suspension**

Add the same fixed reason choices as post reports. Atomically create the room report and set `moderationStatus: "reported"` plus `reportedAt`. Close the dialog immediately on a reported-room snapshot, reject joining/sending in client policy, and preserve room/message records regardless of their old expiration timestamps. Render every temporary-room message's exact local disappearance date/time; reported rooms/messages show `Expiration paused for admin review` until an administrator resolves the report.

- [ ] **Step 4: Verify GREEN**

Run: `node scripts/test-room-report-ui.mjs && npm test`
Expected: both commands exit 0.

- [ ] **Step 5: Commit**

```bash
git add community.html community.js community.css scripts/test-room-report-ui.mjs
git commit -m "feat: suspend and preserve reported rooms"
```

### Task 6: Administrator reported-content queue

**Files:**
- Modify: `admin.html`
- Modify: `admin.css`
- Modify: `admin.js`
- Modify: `admin-dashboard-policy.mjs`
- Create: `scripts/test-admin-moderation.mjs`

**Interfaces:**
- Consumes: report records, moderation target states, `restorePostPayload`, and `restoreRoomPayload`.
- Produces: `pendingReports`, `reportedPostRows`, `reportedRoomRows`, and administrator restore/delete actions.

- [ ] **Step 1: Write failing administrator policy tests**

```js
assert.deepEqual(filterPendingReports(reports).map(report => report.id), ["newest", "older"]);
assert.equal(moderationActionAllowed({ status: "pending", action: "restore-post" }), true);
assert.equal(moderationActionAllowed({ status: "resolved", action: "restore-post" }), false);
```

Add source assertions for `Reported Content`, `Restore to Timeline`, `Allow Room to Resume`, and both permanent-delete controls.

- [ ] **Step 2: Verify RED**

Run: `node scripts/test-admin-moderation.mjs`
Expected: FAIL because the dashboard queue is absent.

- [ ] **Step 3: Implement the live review queue**

Observe pending reports newest-first and join each report with its post or room. Restore posts with an exact batch that resolves all pending reports for the target and clears the hold. Restore rooms with a fresh `Timestamp.fromMillis(Date.now() + 86_400_000)` on the room; message visibility uses the restored room expiration instead of stale per-message expiration. Permanent deletion pages dependent records in deterministic groups of at most 400 writes and removes the target only after every dependent page succeeds.

- [ ] **Step 4: Verify GREEN**

Run: `node scripts/test-admin-moderation.mjs && npm run test:admin-dashboard && npm test`
Expected: all commands exit 0.

- [ ] **Step 5: Commit**

```bash
git add admin.html admin.css admin.js admin-dashboard-policy.mjs scripts/test-admin-moderation.mjs
git commit -m "feat: add administrator reported content queue"
```

### Task 7: Full verification, merge, and production deployment

**Files:**
- Modify: `package.json` only if the aggregate suite needs the new scripts added.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: verified production web release used by the Android Trusted Web Activity.

- [ ] **Step 1: Run focused suites**

```bash
npm run test:moderation-policy
node scripts/test-block-integration.mjs
node scripts/test-post-report-ui.mjs
node scripts/test-room-report-ui.mjs
node scripts/test-admin-moderation.mjs
firebase emulators:exec --only firestore "node scripts/test-moderation-rules.mjs"
```

Expected: every command exits 0.

- [ ] **Step 2: Run the complete regression suite**

Run: `npm run test:firestore-ci`
Expected: exit 0 with all policy, emulator, workflow, notification, deletion, authentication, and regression suites passing.

- [ ] **Step 3: Run repository checks**

```bash
node --check timeline.js
node --check profile.js
node --check community.js
node --check admin.js
git diff --check origin/main...HEAD
git status --short
```

Expected: syntax commands and diff check exit 0; status contains only intentional tracked changes.

- [ ] **Step 4: Merge and deploy**

Push the reviewed branch, merge it to `main`, and confirm `.github/workflows/deploy-firebase.yml` completes successfully for the merge commit.

- [ ] **Step 5: Verify production**

```bash
curl -fsSIL https://anonchatlogin.web.app/
curl -fsS https://anonchatlogin.web.app/admin.html | grep "Reported Content"
```

Expected: HTTP 200 and the deployed administrator page contains `Reported Content`.
