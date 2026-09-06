# Phase C Messaging Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add private-message typing indicators, reactions, replies, delete-for-me, unsend-for-everyone, and message-request privacy without replacing AnonChat's existing private-conversation model.

**Architecture:** Preserve `messageRequests/{pairId}` as the canonical conversation header and the existing messages subcollection as canonical message storage. Add focused policy modules for each new behavior and integrate them into the current private-message controller and Firestore rules. Keep typing state ephemeral and participant-only; keep all destructive actions authorization-safe and backward-compatible.

**Tech Stack:** Firebase Auth, Cloud Firestore, Firebase Security Rules, vanilla JavaScript ES modules, existing AnonChat private-message UI/TWA web runtime, Node-based test scripts.

**Spec:** `docs/superpowers/specs/2026-09-05-phase-c-messaging-settings-badges-design.md`

## Global Constraints

- No persistent group-chat subsystem.
- Existing community chatrooms remain the only group-chat system.
- Existing conversations/messages remain valid without destructive migration.
- Typing indicators apply to private conversations only.
- Message reactions are exactly: 👍 ❤️ 😂 😮 😢 😡 🖕.
- One reaction per user per message; selecting the same reaction removes it; selecting a different reaction replaces it.
- Delete for me is participant-local and may happen anytime.
- Unsend for everyone is sender-owned only and leaves a neutral `Message unsent` placeholder.
- Reply targets that are unavailable render `Original message unavailable.`
- Message-request privacy choices are Everyone, People I follow, No new requests.
- Existing accepted conversations remain usable after privacy is tightened.
- Blocking overrides request permissions.
- Android parity comes from the production web/TWA implementation.

---

### Task 1: Message behavior policy modules

**Files:**
- Create: `private-message-reaction-policy.mjs`
- Create: `private-message-reply-policy.mjs`
- Create: `private-message-visibility-policy.mjs`
- Create: `private-message-request-policy.mjs`
- Test: `scripts/test-private-message-reaction-policy.mjs`
- Test: `scripts/test-private-message-reply-policy.mjs`
- Test: `scripts/test-private-message-visibility-policy.mjs`
- Test: `scripts/test-private-message-request-policy.mjs`

**Interfaces:**
- Produces: `normalizeMessageReaction(value) -> string|null`
- Produces: `nextMessageReaction(current, selected) -> string|null`
- Produces: `resolveReplyPreview(message, original) -> { state, senderLabel, snippet }`
- Produces: `canUnsendMessage({ currentUid, senderId, unsentAt }) -> boolean`
- Produces: `isMessageVisibleToUser({ hiddenFor, uid, unsentAt }) -> boolean`
- Produces: `canCreateMessageRequest({ mode, followsRecipient, blocked, alreadyAccepted }) -> boolean`

- [ ] **Step 1: Write failing policy tests**

```js
import assert from "node:assert/strict";
import { nextMessageReaction } from "../private-message-reaction-policy.mjs";

assert.equal(nextMessageReaction(null, "❤️"), "❤️");
assert.equal(nextMessageReaction("❤️", "❤️"), null);
assert.equal(nextMessageReaction("❤️", "😂"), "😂");
assert.throws(() => nextMessageReaction(null, "🔥"));
```

Add equivalent focused assertions for reply fallback, participant-local visibility, sender-only unsend, and the three request-privacy modes.

- [ ] **Step 2: Run tests to verify RED**

Run:
```bash
node scripts/test-private-message-reaction-policy.mjs
node scripts/test-private-message-reply-policy.mjs
node scripts/test-private-message-visibility-policy.mjs
node scripts/test-private-message-request-policy.mjs
```
Expected: FAIL because the new policy modules do not exist yet.

- [ ] **Step 3: Implement minimal focused policy modules**

```js
export const MESSAGE_REACTIONS = Object.freeze(["👍", "❤️", "😂", "😮", "😢", "😡", "🖕"]);

export function nextMessageReaction(current, selected) {
  if (!MESSAGE_REACTIONS.includes(selected)) throw new TypeError("Unsupported reaction");
  return current === selected ? null : selected;
}
```

Implement the remaining interfaces with no Firestore access inside policy modules.

- [ ] **Step 4: Run policy tests to verify GREEN**

Run the four commands from Step 2.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add private-message-*-policy.mjs scripts/test-private-message-*-policy.mjs
git commit -m "feat: add private message behavior policies"
```

### Task 2: Ephemeral typing indicators

**Files:**
- Create: `private-message-typing-policy.mjs`
- Modify: current private-message controller file discovered from repo search before editing
- Modify: `firestore.rules`
- Test: `scripts/test-private-message-typing-policy.mjs`
- Test: existing Firestore rule test file covering private messages

**Interfaces:**
- Produces: `typingExpiresAt(nowMs, ttlMs = 7000) -> number`
- Produces: `isTypingActive({ expiresAt }, nowMs) -> boolean`
- Firestore shape: `messageRequests/{pairId}/typing/{uid}` with `{ uid, expiresAt, updatedAt }`

- [ ] **Step 1: Write failing expiry tests**

```js
import assert from "node:assert/strict";
import { typingExpiresAt, isTypingActive } from "../private-message-typing-policy.mjs";

assert.equal(typingExpiresAt(1000), 8000);
assert.equal(isTypingActive({ expiresAt: 8000 }, 7999), true);
assert.equal(isTypingActive({ expiresAt: 8000 }, 8000), false);
```

- [ ] **Step 2: Run test and verify RED**

```bash
node scripts/test-private-message-typing-policy.mjs
```
Expected: FAIL because module is missing.

- [ ] **Step 3: Implement typing policy and controller integration**

Implement debounced writes while the user types, clear on stop/navigation when practical, and treat expiration as the authoritative stale-state cleanup. Render the indicator only for the other accepted conversation participant.

- [ ] **Step 4: Add Firestore rules**

Allow typing reads/writes only to accepted conversation participants; require `uid == request.auth.uid` for writes and bounded expiry timestamps.

- [ ] **Step 5: Run focused tests**

```bash
node scripts/test-private-message-typing-policy.mjs
npm run test:firestore-ci
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add private-message-typing-policy.mjs firestore.rules scripts/test-private-message-typing-policy.mjs
git add <private-message-controller>
git commit -m "feat: add private message typing indicators"
```

### Task 3: Reactions on canonical private messages

**Files:**
- Modify: current private-message controller/rendering file
- Modify: `firestore.rules`
- Test: `scripts/test-private-message-reactions-ui.mjs`
- Test: existing Firestore rule test file covering private messages

**Interfaces:**
- Consumes: `MESSAGE_REACTIONS`, `nextMessageReaction`
- Firestore shape: `messageRequests/{pairId}/messages/{messageId}/reactions/{uid}` with `{ uid, type, updatedAt }`

- [ ] **Step 1: Write failing UI/static integration test**

Assert that the private-message renderer imports the reaction policy, renders the approved seven choices, and writes reactions beneath the canonical message path.

- [ ] **Step 2: Run test and verify RED**

```bash
node scripts/test-private-message-reactions-ui.mjs
```
Expected: FAIL.

- [ ] **Step 3: Implement reaction UI and persistence**

Render a compact reaction picker per message, aggregate counts for participants, toggle/remove the current user's reaction, and replace a previous reaction when another is chosen.

- [ ] **Step 4: Add rules**

Allow only accepted participants to read/write reactions; require reaction document id and `uid` to equal the authenticated user and `type` to be in the approved set.

- [ ] **Step 5: Run tests**

```bash
node scripts/test-private-message-reactions-ui.mjs
npm run test:firestore-ci
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add <private-message-controller> firestore.rules scripts/test-private-message-reactions-ui.mjs
git commit -m "feat: add private message reactions"
```

### Task 4: Reply-to-message behavior

**Files:**
- Modify: current private-message composer/controller file
- Modify: current private-message renderer file if separate
- Modify: `firestore.rules`
- Test: `scripts/test-private-message-replies-ui.mjs`

**Interfaces:**
- Consumes: `resolveReplyPreview`
- Message fields: `replyToMessageId`, `replyToSenderId`, `replyToSnippet`

- [ ] **Step 1: Write failing reply integration test**

Assert reply controls exist, reply metadata is stored with a sent message, preview renders sender/snippet, tapping preview targets the original message id, and unavailable target copy equals `Original message unavailable.`

- [ ] **Step 2: Run test and verify RED**

```bash
node scripts/test-private-message-replies-ui.mjs
```
Expected: FAIL.

- [ ] **Step 3: Implement reply composer state and rendering**

Limit `replyToSnippet` to a short safe preview; never use it to bypass current authorization. If original is unsent or missing, render the approved fallback.

- [ ] **Step 4: Harden rules**

Permit optional reply metadata only on participant-authored messages in accepted conversations; enforce string/id type constraints and bounded snippet length.

- [ ] **Step 5: Run focused + Firestore tests**

```bash
node scripts/test-private-message-replies-ui.mjs
npm run test:firestore-ci
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add <private-message-files> firestore.rules scripts/test-private-message-replies-ui.mjs
git commit -m "feat: add private message replies"
```

### Task 5: Delete for me and unsend for everyone

**Files:**
- Modify: current private-message controller/renderer
- Modify: `firestore.rules`
- Test: `scripts/test-private-message-delete-unsend-ui.mjs`
- Test: existing Firestore rules tests

**Interfaces:**
- Consumes: `canUnsendMessage`, `isMessageVisibleToUser`
- Participant-local hide state: `hiddenFor: string[]` or a focused per-user visibility subdocument if the existing message schema makes array mutation unsafe
- Unsend fields: `unsentAt`, `unsentBy`

- [ ] **Step 1: Write failing behavior tests**

Test that delete-for-me hides only for the acting participant, non-senders cannot unsend, senders can unsend once, unsent messages display `Message unsent`, and reply previews to unsent messages become unavailable.

- [ ] **Step 2: Run and verify RED**

```bash
node scripts/test-private-message-delete-unsend-ui.mjs
```
Expected: FAIL.

- [ ] **Step 3: Implement UI and persistence**

Use a message action menu. Delete-for-me must never erase canonical content for the other participant. Unsend must clear or stop rendering sensitive body/media fields and leave the neutral placeholder.

- [ ] **Step 4: Add rules for sender-only unsend and participant-local hide**

Reject unsend attempts from non-senders and reject writes that alter sender/conversation identity fields.

- [ ] **Step 5: Run tests**

```bash
node scripts/test-private-message-delete-unsend-ui.mjs
npm run test:firestore-ci
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add <private-message-files> firestore.rules scripts/test-private-message-delete-unsend-ui.mjs
git commit -m "feat: add private message delete and unsend"
```

### Task 6: Message-request privacy enforcement

**Files:**
- Modify: current request-sending flow(s), including any shared helper used by `timeline.js` or `community.js`
- Modify: `firestore.rules`
- Test: `scripts/test-message-request-privacy-ui.mjs`
- Test: existing Firestore rule tests

**Interfaces:**
- Consumes: `canCreateMessageRequest`
- Reads recipient setting produced by the Settings plan: `messageRequestMode`

- [ ] **Step 1: Write failing tests for the three privacy modes**

Test Everyone, People I follow, No new requests, existing accepted conversation bypass, and blocked-user rejection.

- [ ] **Step 2: Run and verify RED**

```bash
node scripts/test-message-request-privacy-ui.mjs
```
Expected: FAIL.

- [ ] **Step 3: Integrate policy into every request entry point**

Show a clear user-facing rejection message when recipient privacy blocks the request. Preserve accepted conversations.

- [ ] **Step 4: Enforce in Firestore rules**

At `messageRequests/{pairId}` create time, evaluate recipient preference and follow relation before allowing pending request creation. Keep existing accepted-record behavior compatible.

- [ ] **Step 5: Run focused and Firestore suites**

```bash
node scripts/test-message-request-privacy-ui.mjs
npm run test:firestore-ci
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add <request-flow-files> firestore.rules scripts/test-message-request-privacy-ui.mjs
git commit -m "feat: enforce message request privacy"
```

### Task 7: Messaging regression, offline shell, and release readiness

**Files:**
- Modify: `sw.js` only if new runtime modules are loaded by production pages
- Modify: focused CI workflow if one exists for Phase C; otherwise add one following existing workflow conventions
- Test: `scripts/test-push-service-worker.mjs`
- Test: all focused messaging scripts from Tasks 1-6

**Interfaces:**
- Produces: a green, reviewable messaging-core branch state ready for PR integration

- [ ] **Step 1: Add any new browser-loaded modules to the service-worker app shell**

Only add modules that must be available offline; bump the cache version if required by the existing service-worker pattern.

- [ ] **Step 2: Run all focused messaging tests**

```bash
node scripts/test-private-message-reaction-policy.mjs
node scripts/test-private-message-reply-policy.mjs
node scripts/test-private-message-visibility-policy.mjs
node scripts/test-private-message-request-policy.mjs
node scripts/test-private-message-typing-policy.mjs
node scripts/test-private-message-reactions-ui.mjs
node scripts/test-private-message-replies-ui.mjs
node scripts/test-private-message-delete-unsend-ui.mjs
node scripts/test-message-request-privacy-ui.mjs
```
Expected: PASS.

- [ ] **Step 3: Run full regression and offline tests**

```bash
npm run test:firestore-ci
node scripts/test-push-service-worker.mjs
```
Expected: PASS.

- [ ] **Step 4: Run syntax checks on every modified `.js`/`.mjs` file**

```bash
node --check <each-modified-js-or-mjs-file>
```
Expected: no syntax errors.

- [ ] **Step 5: Commit release-readiness changes**

```bash
git add sw.js .github/workflows scripts
git commit -m "test: verify Phase C messaging core"
```
