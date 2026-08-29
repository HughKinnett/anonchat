# AnonChat Web Safety and Content Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Play-compliant reporting and blocking, a restorable administrator moderation queue, deterministic ordering, trusted 24-hour room cleanup, complete owner deletion controls, legal/18+ signup surfaces, and the compact Timeline photo bubble.

**Architecture:** Signed-in clients create narrowly validated report intakes and deterministic block records. A leased GitHub Actions processor using the existing Firebase service account snapshots authoritative targets, hides/re-enables or cascade-deletes content, and removes expired rooms; the admin UI queues trusted actions. Focused policy modules carry deterministic behavior shared by browser code, security tests, and processors.

**Tech Stack:** Firebase Authentication, Cloud Firestore rules/indexes, Firebase Admin SDK, browser ES modules, Node.js tests, GitHub Actions, Firebase Hosting.

**Spec:** `docs/superpowers/specs/2026-08-28-web-safety-lifecycle-design.md`

## Global Constraints

- Firebase remains on the Spark plan; trusted background work runs through scheduled GitHub Actions using `FIREBASE_SERVICE_ACCOUNT_ANONCHATLOGIN`.
- Protected administrator usernames remain `i_love_you_h` and `cybercapone` and cannot be banned or deleted.
- Report reasons are exactly `harassment`, `hate-threats`, `sexual-content`, `spam-scam`, `privacy-impersonation`, and `other`.
- Report targets are exactly `post`, `communityPost`, `roomMessage`, and `user`.
- Room expiry must be between 23 hours 55 minutes and 24 hours 5 minutes after the trusted request time; messages inherit the parent room expiry.
- Normal clients cannot write moderation snapshots, actions, leases, or results.
- The service worker remains network-first and must bump from cache `anonchat-v38` after public assets change.
- No private-message body is copied into moderation records; temporary-room messages are in scope, direct messages are not.
- Timeline/profile feeds are newest-first; comments and messages are oldest-first; equal timestamps use canonical Firestore path as tie-breaker.

---

### Task 1: Moderation, block, ordering, and expiry policy contracts

**Files:**
- Create: `moderation-policy.mjs`
- Create: `content-ordering.mjs`
- Test: `scripts/test-moderation-policy.mjs`
- Test: `scripts/test-content-ordering.mjs`
- Modify: `package.json`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `REPORT_REASONS`, `REPORT_TARGETS`, `blockId(blockerUid, blockedUid)`, `reportId(reporterUid, targetKind, targetId)`, `reportIntakePayload(input)`, `roomExpiry(nowMillis)`, `isRoomActive(room, nowMillis)`, `canonicalRecordPath(record)`, `compareNewestFirst(left,right)`, and `compareOldestFirst(left,right)`.
- All later tasks consume these exact names.

- [ ] **Step 1: Write failing policy tests**

Create table-driven tests proving exact enums, self-block/report rejection, deterministic IDs, exact intake fields, the 24-hour expiry value, active/expired boundaries, timestamp normalization, missing-timestamp placement, and path tie-breaks:

```js
assert.equal(blockId("a", "b"), "a_b");
assert.throws(() => blockId("a", "a"), /self/);
assert.deepEqual(reportIntakePayload({
  reporterUid: "u1", targetKind: "post", targetCollection: "posts",
  targetId: "p1", reportedUserId: "u2", reason: "harassment", timestamp: NOW
}), {
  reporterUid: "u1", targetKind: "post", targetCollection: "posts",
  targetId: "p1", targetPath: "posts/p1", reportedUserId: "u2",
  reason: "harassment", createdAt: NOW, status: "queued"
});
assert.equal(roomExpiry(1_000), 86_401_000);
assert.deepEqual([late, early].sort(compareOldestFirst), [early, late]);
assert.deepEqual([pathB, pathA].sort(compareNewestFirst), [pathB, pathA]);
```

- [ ] **Step 2: Run tests and confirm RED**

Run: `node scripts/test-moderation-policy.mjs && node scripts/test-content-ordering.mjs`
Expected: fail because the two modules do not exist.

- [ ] **Step 3: Implement minimal pure policies**

Use a path-safe escaped identifier (`encodeURIComponent` with `%` retained) and exact object-key construction. `timestampMillis` must accept Firestore timestamps, `Date`, or finite numbers and return `null` otherwise. Pending/null timestamps sort after trusted timestamps in newest-first and before trusted timestamps in oldest-first only while the local write is pending; tie-break with `canonicalRecordPath(record)`.

- [ ] **Step 4: Add scripts and ignore the local npm cache**

Add:

```json
"test:moderation-policy": "node scripts/test-moderation-policy.mjs && node scripts/test-content-ordering.mjs"
```

Add `.npm-cache/` to `.gitignore`.

- [ ] **Step 5: Run tests and commit**

Run: `npm run test:moderation-policy && npm test`
Expected: both pass.

```bash
git add .gitignore package.json moderation-policy.mjs content-ordering.mjs scripts/test-moderation-policy.mjs scripts/test-content-ordering.mjs
git commit -m "Add moderation and lifecycle policies"
```

### Task 2: Firestore moderation, block, and room-expiry authorization

**Files:**
- Modify: `firestore.rules`
- Modify: `firestore.indexes.json`
- Create: `scripts/test-moderation-rules.mjs`
- Create: `scripts/test-block-rules.mjs`
- Create: `scripts/test-room-expiry-rules.mjs`
- Modify: `scripts/test-firestore-rules.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: exact collections and field names from Task 1 and the spec.
- Produces: client-safe `reportIntakes` and `blocks` rules; admin/service-only `moderationCases`, nested reports, and `moderationActions`; read hiding and block enforcement; expiry indexes used by Task 3.

- [ ] **Step 1: Write failing emulator tests**

Cover these matrices with separate authenticated clients for reporter, author, blocked user, stranger, protected admin, and unauthenticated access:

```text
ALLOW reporter create/get exact intake for existing non-self target
DENY forged targetPath/reportedUserId/reason/timestamp/status or duplicate update/delete
DENY normal list/read of other reporters, cases, nested reports, and actions
ALLOW blocker create/delete exact own deterministic block
DENY self-block, third-party block, field mutation, and blocked follow/request/message/reveal
DENY normal read of moderationState == hidden; ALLOW protected admin read
ALLOW room only with server createdAt and bounded expiresAt
ALLOW room message only before expiry and expiresAt == parent expiresAt
DENY expired join/send and malformed expiry
```

- [ ] **Step 2: Run tests and confirm RED**

Run: `firebase emulators:exec --only firestore "node scripts/test-moderation-rules.mjs && node scripts/test-block-rules.mjs && node scripts/test-room-expiry-rules.mjs"`
Expected: new allowed operations fail and prohibited operations expose missing collection boundaries.

- [ ] **Step 3: Implement rules with bounded access calls**

Add helpers:

```rules
function blockPath(left, right) {
  return /databases/$(database)/documents/blocks/$(left + '_' + right);
}
function pairIsBlocked(left, right) {
  return exists(blockPath(left, right)) || exists(blockPath(right, left));
}
function visibleOrAdmin() {
  return isAdmin() || resource.data.get('moderationState', 'visible') != 'hidden';
}
```

Validate target collections/kinds with explicit branches, not unconstrained dynamic paths. Intake create must use `request.time`; cases/actions are admin-readable but not client-writable except an admin action document with the exact queued shape. Preserve current message-request reverse-accept behavior while adding the pair block guard.

- [ ] **Step 4: Add indexes and regression scripts**

Add composite indexes for `reportIntakes(status,createdAt)`, `moderationActions(status,requestedAt)`, and `rooms(expiresAt,__name__)`. Add these exact scripts and append all three to `test:firestore-ci`:

```json
"test:moderation-rules": "firebase emulators:exec --only firestore \"node scripts/test-moderation-rules.mjs\"",
"test:block-rules": "firebase emulators:exec --only firestore \"node scripts/test-block-rules.mjs\"",
"test:room-expiry-rules": "firebase emulators:exec --only firestore \"node scripts/test-room-expiry-rules.mjs\""
```

- [ ] **Step 5: Run emulator and existing rule suites, then commit**

Run:

```bash
npm run test:rules
npm run test:moderation-rules
npm run test:block-rules
npm run test:room-expiry-rules
```

Expected: all pass with no permission-denied regressions.

```bash
git add firestore.rules firestore.indexes.json package.json scripts/test-firestore-rules.mjs scripts/test-moderation-rules.mjs scripts/test-block-rules.mjs scripts/test-room-expiry-rules.mjs
git commit -m "Secure reports blocks and room expiry"
```

### Task 3: Trusted moderation and room-cleanup processor

**Files:**
- Create: `moderation-processor-policy.mjs`
- Create: `moderation-firestore-adapter.mjs`
- Create: `moderation-processor.mjs`
- Create: `scripts/moderation-processor.mjs`
- Create: `scripts/test-moderation-processor-policy.mjs`
- Create: `scripts/test-moderation-firestore-adapter.mjs`
- Create: `scripts/test-moderation-processor.mjs`
- Create: `scripts/test-moderation-firestore-integration.mjs`
- Create: `.github/workflows/process-moderation.yml`
- Modify: `workflow-policy.mjs`
- Modify: `scripts/test-workflow-policy.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `reportIntakes`, `moderationCases/{caseId}/reports`, `moderationActions`, `rooms`, `roomMessages`, `roomMembers`, and Task 2 indexes.
- Produces: `processModeration(adapter, options) -> summary`, `FirestoreModerationAdapter`, a five-minute workflow, and `system/moderationProcessor` heartbeat.

- [ ] **Step 1: Write failing policy and adapter tests**

Specify exact constants:

```js
export const LEASE_MS = 4 * 60 * 1000;
export const PAGE_SIZE = 100;
export const MAX_ATTEMPTS = 8;
export const SNAPSHOT_TEXT_LIMIT = 500;
```

Test eligible queued/expired leases, coded retry delay, canonical case ID, bounded snapshot shapes for each target kind, no direct-message target, and redacted result summaries with no UID or content text.

- [ ] **Step 2: Run tests and confirm RED**

Run: `node scripts/test-moderation-processor-policy.mjs && node scripts/test-moderation-firestore-adapter.mjs && node scripts/test-moderation-processor.mjs`
Expected: missing-module failures.

- [ ] **Step 3: Implement leased, paginated, idempotent processing**

Follow the existing `admin-deletion-firestore-adapter.mjs` transaction/lease style. The adapter must:

- validate the target again from an authoritative snapshot;
- transactionally create/update one case, one nested report, mark the target hidden when supported, and mark intake processed;
- queue/execute restore and permanent-delete actions;
- cascade post comments/reactions and community votes before deleting a post;
- cascade room messages/members before deleting a room;
- preserve case/report snapshots until permanent material deletion succeeds;
- keep failed actions retryable and refresh the heartbeat each run.

- [ ] **Step 4: Write and pass Firestore integration tests**

Use the emulator with the Admin SDK and rules clients to prove the end-to-end intake → case → hide → restore → delete transitions, source-deleted race, expired evidence retention, room cleanup, lease recovery, and repeated-run idempotency.

Run: `firebase emulators:exec --only firestore "node scripts/test-moderation-firestore-integration.mjs"`
Expected: pass.

- [ ] **Step 5: Add the scheduled workflow and validate it semantically**

The workflow must use:

```yaml
on:
  schedule:
    - cron: "*/5 * * * *"
  workflow_dispatch:
permissions:
  contents: read
concurrency:
  group: anonchat-moderation
  cancel-in-progress: false
```

Its steps are checkout v4, setup-node v4 with Node 20, `npm ci`, Google auth v3 using `FIREBASE_SERVICE_ACCOUNT_ANONCHATLOGIN`, and `npm run moderation:process` with the emitted credentials path.

Add:

```json
"test:moderation-processor": "node scripts/test-moderation-processor-policy.mjs && node scripts/test-moderation-firestore-adapter.mjs && node scripts/test-moderation-processor.mjs",
"test:moderation-firestore-integration": "firebase emulators:exec --only firestore \"node scripts/test-moderation-firestore-integration.mjs\"",
"moderation:process": "node scripts/moderation-processor.mjs"
```

- [ ] **Step 6: Run tests and commit**

Run:

```bash
npm run test:moderation-processor
npm run test:moderation-firestore-integration
npm run test:workflow-policy
```

Expected: all pass.

```bash
git add moderation-processor-policy.mjs moderation-firestore-adapter.mjs moderation-processor.mjs scripts/moderation-processor.mjs scripts/test-moderation-processor-policy.mjs scripts/test-moderation-firestore-adapter.mjs scripts/test-moderation-processor.mjs scripts/test-moderation-firestore-integration.mjs .github/workflows/process-moderation.yml workflow-policy.mjs scripts/test-workflow-policy.mjs package.json
git commit -m "Add trusted moderation and expiry processing"
```

### Task 4: Reported-material administrator queue

**Files:**
- Modify: `admin.html`
- Modify: `admin.css`
- Modify: `admin.js`
- Modify: `admin-dashboard-policy.mjs`
- Modify: `scripts/test-admin-dashboard-policy.mjs`

**Interfaces:**
- Consumes: moderation case/action schemas from Task 3 and existing admin ban/deletion policies.
- Produces: `moderationCaseRecord`, `filterModerationCases`, `moderationActionState`, and the live **Reported material** section.

- [ ] **Step 1: Write failing dashboard policy tests**

Test newest-first open cases, explicit restored/expired filters, bounded preview rendering, protected-admin action disablement, queued/failed action labels, restore prohibition for expired evidence, and delete-profile delegation to `adminDeletionQueuePayloads`.

- [ ] **Step 2: Run test and confirm RED**

Run: `npm run test:admin-dashboard`
Expected: failures for the new exports and policies.

- [ ] **Step 3: Add the task-first moderation section**

Insert above current Content Moderation:

```html
<section class="admin-panel" aria-labelledby="reported-material-heading">
  <div class="admin-panel-heading">
    <div><h2 id="reported-material-heading">Reported material</h2>
    <p class="admin-note">Review reports and choose what happens next.</p></div>
    <select id="admin-report-status" aria-label="Reported material status">
      <option value="open">Needs review</option>
      <option value="restored">Restored history</option>
      <option value="expiredEvidence">Expired evidence</option>
      <option value="all">All reports</option>
    </select>
  </div>
  <div id="admin-reports" class="admin-list" aria-live="polite"></div>
</section>
```

Each row must use text nodes (never `innerHTML`) and show **Restore material**, **Delete material permanently**, **Ban user**, and **Delete user's profile** with plain-language queued/error feedback.

- [ ] **Step 4: Wire snapshots and actions**

Listen to `moderationCases` and `moderationActions`. Queue an exact action with server timestamp; reuse the existing ban and deletion queue functions. Keep controls disabled while matching jobs exist and preserve focus across snapshots.

- [ ] **Step 5: Run tests and commit**

Run: `npm run test:admin-dashboard && npm test`
Expected: pass.

```bash
git add admin.html admin.css admin.js admin-dashboard-policy.mjs scripts/test-admin-dashboard-policy.mjs
git commit -m "Add reported material admin controls"
```

### Task 5: Shared report/block client and profile controls

**Files:**
- Create: `moderation-client.mjs`
- Create: `scripts/test-moderation-client.mjs`
- Modify: `profile.html`
- Modify: `profile.js`
- Modify: `timeline.css`
- Modify: `package.json`

**Interfaces:**
- Consumes: Task 1 IDs/payloads and Task 2 rules.
- Produces: `createModerationClient({db, firestore, currentUid, timestamp})` with `report(target, reason)`, `hasReported(target)`, `block(uid)`, `unblock(uid)`, and `isPairBlocked(uid)`.

- [ ] **Step 1: Write failing client behavior tests**

Use injected fake Firestore functions to verify exact document paths/payloads, duplicate detection, transactional button-state errors, self-action rejection, and block/unblock document ownership.

- [ ] **Step 2: Run test and confirm RED**

Run: `node scripts/test-moderation-client.mjs`
Expected: module missing.

- [ ] **Step 3: Implement the client and profile controls**

Add **Block user / Unblock user** and **Report user** beside Follow for non-self profiles. Add Report and owner Delete to every post in the profile renderer. Blocked profiles show a plain-language status and suppress Follow/Message links and post contents for that viewer.

Add `"test:moderation-client": "node scripts/test-moderation-client.mjs"` to `package.json`.

- [ ] **Step 4: Apply deterministic profile ordering**

Use `compareNewestFirst` and full `doc.ref.path`; update comment matching to include parent collection/path so identical IDs cannot cross-associate.

- [ ] **Step 5: Run tests and commit**

Run: `npm run test:moderation-client && npm test`
Expected: pass.

```bash
git add moderation-client.mjs scripts/test-moderation-client.mjs profile.html profile.js timeline.css package.json
git commit -m "Add profile reporting blocking and deletion"
```

### Task 6: Timeline reporting, ordering, deletion, and photo bubble

**Files:**
- Modify: `timeline.html`
- Modify: `timeline.css`
- Modify: `timeline.js`
- Create: `scripts/test-timeline-moderation-ui.mjs`
- Modify: `scripts/test-regressions.mjs`

**Interfaces:**
- Consumes: `moderation-client.mjs` and ordering comparators.
- Produces: report actions on all Timeline/Community cards, consistent owner deletion confirmation, and the compact photo bubble.

- [ ] **Step 1: Add failing behavioral DOM/source-policy tests**

Assert both `posts` and `communityPosts` render Report, owner items render Delete, report success/error is inline, comparators receive `ref.path`, and `label[for=post-image-upload]` is inside the composer option row beside `#post-expiry` with the accessible name **Add photo**.

- [ ] **Step 2: Run tests and confirm RED**

Run: `node scripts/test-timeline-moderation-ui.mjs && npm test`
Expected: new assertions fail.

- [ ] **Step 3: Implement report and owner-delete controls**

Use one reason dialog shared by cards; prevent double submission; do not report the current user's own content; confirm permanent owner deletion; keep the UI disabled until the matching snapshot disappears.

- [ ] **Step 4: Replace ad-hoc sorting and move the photo trigger**

Remove timestamp-only sort callbacks and use shared comparators. Replace `.modern-photo-button` text block with a 44px circular `.photo-bubble` containing a camera/plus glyph, selected state, tooltip, focus ring, and existing preview/remove flow.

- [ ] **Step 5: Run tests and commit**

Run: `node scripts/test-timeline-moderation-ui.mjs && npm run test:moderation-policy && npm test`
Expected: pass.

```bash
git add timeline.html timeline.css timeline.js scripts/test-timeline-moderation-ui.mjs scripts/test-regressions.mjs
git commit -m "Add Timeline moderation and photo bubble"
```

### Task 7: Temporary-room reports, blocks, ordering, and 24-hour lifecycle

**Files:**
- Modify: `community.html`
- Modify: `community.css`
- Modify: `community.js`
- Create: `scripts/test-community-lifecycle.mjs`
- Modify: `notification-ui-policy.mjs`
- Modify: `scripts/test-notification-ui.mjs`

**Interfaces:**
- Consumes: moderation client, block lookup, ordering policies, Task 2 room schema.
- Produces: every room message report action, room-level expiry, blocked interaction filtering, deterministic rooms/messages/direct messages, and expiry-aware notifications.

- [ ] **Step 1: Write failing lifecycle tests**

Test create-room payload expiry, message expiry equality, expired join/send refusal, ascending equal-time message tie-break, report button target shape, blocked sender filtering, and no notification for expired/blocked room content.

- [ ] **Step 2: Run tests and confirm RED**

Run: `node scripts/test-community-lifecycle.mjs && npm run test:notification-ui`
Expected: failures on missing expiry/report/block behavior.

- [ ] **Step 3: Implement room and message lifecycle**

Write `expiresAt: Timestamp.fromMillis(roomExpiry(Date.now()))` when creating a room. On message creation use the selected room document's exact `expiresAt`. Filter active rooms/messages before rendering and show **Room expired** while disabling join/send if the clock crosses the boundary.

- [ ] **Step 4: Add reports, block enforcement, and deterministic ordering**

Render Report beside every non-self room message, use full target path, filter blocked UIDs, and apply the shared comparators to rooms, room messages, and direct messages. Re-check block state immediately before write; rely on rules as final authority.

- [ ] **Step 5: Run tests and commit**

Run: `node scripts/test-community-lifecycle.mjs && npm run test:notification-ui && npm test`
Expected: pass.

```bash
git add community.html community.css community.js scripts/test-community-lifecycle.mjs notification-ui-policy.mjs scripts/test-notification-ui.mjs
git commit -m "Enforce temporary room safety and expiry"
```

### Task 8: Terms, privacy, support, 18+ signup, and cache/deployment contract

**Files:**
- Create: `terms.html`
- Create: `privacy.html`
- Create: `support.html`
- Create: `legal.css`
- Modify: `index.html`
- Modify: `loginfirebase.js`
- Modify: `login.css`
- Modify: `manifest.webmanifest`
- Modify: `sw.js`
- Modify: `firebase.json`
- Modify: `workflow-policy.mjs`
- Modify: `scripts/test-workflow-policy.mjs`
- Modify: `scripts/test-push-service-worker.mjs`
- Create: `scripts/test-legal-signup.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: all public pages/modules created by Tasks 1–7.
- Produces: public legal/support URLs, explicit signup acknowledgement, complete PWA shell, and deployment coverage.

- [ ] **Step 1: Write failing legal/signup/cache tests**

Assert that signup cannot execute unless both `#age-confirmation` and `#terms-confirmation` are checked; all three legal pages name AnonChat and link to account deletion/support; every public page is in `APP_SHELL`; cache is exactly `anonchat-v39`; Firebase Hosting ignores repository internals but does not ignore `.well-known`.

- [ ] **Step 2: Run tests and confirm RED**

Run: `node scripts/test-legal-signup.mjs && node scripts/test-push-service-worker.mjs && npm run test:workflow-policy`
Expected: failures for missing pages/controls/cache entries.

- [ ] **Step 3: Add accurate public legal/support copy**

Terms must define 18+ access, prohibited content, reporting/blocking, moderation, temporary-room expiry, no guarantee of anonymity against legal process, account/content deletion, and enforcement. Privacy must describe the exact data categories in the spec without claiming end-to-end encryption. Support must provide a non-secret contact path and direct links to reporting and account deletion.

- [ ] **Step 4: Gate signup and complete cache/hosting configuration**

Add required checkboxes with links and check them before calling `createUserWithEmailAndPassword`. Add legal assets and new policy/client modules to `APP_SHELL`; bump to v39. Replace broad dotfile hosting ignore with explicit `.git/**`, `.github/**`, `.worktrees/**`, `.superpowers/**`, `.npm-cache/**`, `docs/**`, and other non-public paths while allowing `.well-known/**`.

Add `"test:legal-signup": "node scripts/test-legal-signup.mjs"` to `package.json`.

- [ ] **Step 5: Run all non-emulator suites and commit**

Run:

```bash
npm run test:legal-signup
npm run test:moderation-policy
npm run test:moderation-client
npm run test:moderation-processor
npm run test:admin-dashboard
npm run test:notification
npm run test:push
npm run test:workflow-policy
npm test
```

Expected: all pass.

```bash
git add terms.html privacy.html support.html legal.css index.html loginfirebase.js login.css manifest.webmanifest sw.js firebase.json workflow-policy.mjs scripts/test-workflow-policy.mjs scripts/test-push-service-worker.mjs scripts/test-legal-signup.mjs package.json
git commit -m "Add Play-ready legal and signup safeguards"
```

### Task 9: Full web verification and release readiness

**Files:**
- Modify only files required by verified failures.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: one fully reviewed web release ready for PR and Firebase deployment.

- [ ] **Step 1: Run complete CI locally where supported**

Run: `npm run test:firestore-ci`
Expected: all pure and emulator suites pass. If the emulator binary cannot run locally, preserve the exact failure output and require the GitHub rules workflow to pass before merge.

- [ ] **Step 2: Run static and secret checks**

Run:

```bash
git diff --check origin/main...HEAD
git grep -nE '(BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|AIza[0-9A-Za-z_-]{30,}|FIREBASE_SERVICE_ACCOUNT.*\{)' -- ':!package-lock.json'
```

Expected: no whitespace errors and no committed private credentials.

- [ ] **Step 3: Perform responsive browser smoke tests**

Verify desktop and narrow mobile layouts for signup, Timeline reporting/photo bubble, profile block/report/delete, temporary-room report/expiry, and the admin moderation queue. Verify keyboard focus and inline error/status messages.

- [ ] **Step 4: Run final independent branch review**

Review spec compliance, Firestore authorization, processor retry/cascade behavior, Play UGC requirements, and all deferred findings. Fix one reviewed wave, then re-run only impacted tests plus the full regression suite.

- [ ] **Step 5: Mark web release ready**

Record exact test commands/results, unresolved external constraints, cache version, and expected Firebase workflow names in the SDD ledger. Do not merge or deploy until the branch-finishing workflow and the user's standing publish authorization are applied.
