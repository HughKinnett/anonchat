# Phase C Settings, Notifications, Mentions, and Accessibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an account-synced Settings destination in the hamburger menu with privacy, notification, quiet-hours, appearance, accessibility, and mention controls that work consistently on web and Android/TWA.

**Architecture:** Add one owner-private settings model with safe defaults, one shared settings policy module, one shared appearance/accessibility applicator, and a notification-delivery policy consumed by the existing notification pipeline. Keep in-app notification creation canonical; settings only decide whether push delivery occurs. Mentions are parsed in approved contexts and routed through the existing notification infrastructure.

**Tech Stack:** Firebase Auth, Cloud Firestore, Firebase Security Rules, vanilla JavaScript ES modules, existing notification adapters/processors, shared CSS, service worker/PWA shell, Android TWA.

**Spec:** `docs/superpowers/specs/2026-09-05-phase-c-messaging-settings-badges-design.md`

## Global Constraints

- Settings is a shared hamburger-menu destination.
- Sections: Privacy & Messaging, Notifications, Appearance, Accessibility.
- Account settings sync across web and Android/TWA.
- System theme follows each local device/browser preference.
- Notification categories: Reactions, Comments, Private Messages, Message Requests, Community Chatrooms, Mentions, Mutual Reveal Requests.
- Master `Pause all notifications` suppresses push only.
- Quiet hours suppress push only and do not queue a delayed burst.
- Mentions use `@username` in comments, private messages, and community chatrooms only.
- Invalid, blocked, or context-inaccessible mention targets receive no notification.
- Appearance: System / Light / Dark + Reduce motion.
- Accessibility: Small / Default / Large / Extra Large + High contrast.
- Existing accounts without Phase C settings retain current production behavior through defaults.

---

### Task 1: Settings policy and owner-private data model

**Files:**
- Create: `user-settings-policy.mjs`
- Create: `user-settings-storage.mjs`
- Modify: `firestore.rules`
- Test: `scripts/test-user-settings-policy.mjs`
- Test: `scripts/test-user-settings-rules.mjs`

**Interfaces:**
- Produces: `DEFAULT_USER_SETTINGS`
- Produces: `normalizeUserSettings(value) -> normalized settings object`
- Produces: `loadUserSettings(db, uid) -> Promise<object>`
- Produces: `saveUserSettings(db, uid, partial) -> Promise<object>`
- Firestore path: `users/{uid}/private/settings/preferences`

- [ ] **Step 1: Write failing normalization tests**

```js
import assert from "node:assert/strict";
import { normalizeUserSettings } from "../user-settings-policy.mjs";

const value = normalizeUserSettings({ theme: "dark", textSize: "large" });
assert.equal(value.theme, "dark");
assert.equal(value.textSize, "large");
assert.equal(value.pauseAllNotifications, false);
assert.equal(value.messageRequestMode, "everyone");
```

Also test rejection/defaulting for unsupported theme, text size, notification keys, malformed quiet-hours values, and unknown fields.

- [ ] **Step 2: Run tests and verify RED**

```bash
node scripts/test-user-settings-policy.mjs
node scripts/test-user-settings-rules.mjs
```
Expected: FAIL.

- [ ] **Step 3: Implement the normalized schema**

Use exact keys:
```js
{
  messageRequestMode: "everyone" | "following" | "none",
  notifications: {
    reactions: true,
    comments: true,
    privateMessages: true,
    messageRequests: true,
    communityChatrooms: true,
    mentions: true,
    mutualRevealRequests: true
  },
  pauseAllNotifications: false,
  quietHours: { enabled: false, start: "22:00", end: "07:00" },
  theme: "system" | "light" | "dark",
  reduceMotion: false,
  textSize: "small" | "default" | "large" | "extra-large",
  highContrast: false
}
```

- [ ] **Step 4: Implement storage with safe fallback**

`loadUserSettings` returns normalized defaults on missing document or recoverable read failure; `saveUserSettings` merges through normalization before write.

- [ ] **Step 5: Add owner-private Firestore rules**

Allow reads/writes only to the owning user, except narrowly scoped server/admin reads already required by notification processing. Reject unsupported schema keys.

- [ ] **Step 6: Run tests and verify GREEN**

```bash
node scripts/test-user-settings-policy.mjs
node scripts/test-user-settings-rules.mjs
npm run test:firestore-ci
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add user-settings-policy.mjs user-settings-storage.mjs firestore.rules scripts/test-user-settings-*.mjs
git commit -m "feat: add account synced user settings model"
```

### Task 2: Settings page and hamburger navigation

**Files:**
- Create: `settings.html`
- Create: `settings.js`
- Modify: `nav-menu.js`
- Modify: shared stylesheet used by primary app surfaces
- Test: `scripts/test-settings-surface.mjs`

**Interfaces:**
- Consumes: `loadUserSettings`, `saveUserSettings`, normalized setting keys from Task 1
- Produces: a single Settings destination shared across main navigation surfaces

- [ ] **Step 1: Write failing surface test**

Assert `nav-menu.js` adds exactly one Settings destination and `settings.html` contains sections/controls for Privacy & Messaging, Notifications, Appearance, Accessibility with all approved options.

- [ ] **Step 2: Run and verify RED**

```bash
node scripts/test-settings-surface.mjs
```
Expected: FAIL.

- [ ] **Step 3: Build `settings.html`**

Include accessible labels, descriptive headings, radio/select controls for message-request mode/theme/text size, toggles for notification categories/pause/reduce-motion/high-contrast, and quiet-hours enable/start/end inputs.

- [ ] **Step 4: Implement `settings.js`**

Load settings after auth, populate controls, persist changes with small debounced writes, show inline saved/error status, and fall back to defaults without blocking page use.

- [ ] **Step 5: Add shared hamburger entry**

Update `nav-menu.js` so the Settings link appears consistently on pages already using the shared menu.

- [ ] **Step 6: Run test and syntax checks**

```bash
node scripts/test-settings-surface.mjs
node --check settings.js
node --check nav-menu.js
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add settings.html settings.js nav-menu.js <shared-stylesheet> scripts/test-settings-surface.mjs
git commit -m "feat: add account settings surface"
```

### Task 3: Shared appearance and accessibility application

**Files:**
- Create: `appearance-accessibility-policy.mjs`
- Create: `appearance-accessibility.js`
- Modify: shared stylesheet
- Modify: main HTML surfaces to load shared applicator only where current shared bootstrap cannot do so centrally
- Test: `scripts/test-appearance-accessibility-policy.mjs`
- Test: `scripts/test-appearance-accessibility-integration.mjs`

**Interfaces:**
- Produces: `resolveTheme(theme, prefersDark) -> "light"|"dark"`
- Produces: `appearanceClasses(settings) -> string[]`
- Produces: global root attributes/classes: `data-theme`, `data-text-size`, `.reduce-motion`, `.high-contrast`

- [ ] **Step 1: Write failing policy tests**

Test system-theme resolution, explicit theme precedence, four text sizes, reduced motion, and high contrast.

- [ ] **Step 2: Run and verify RED**

```bash
node scripts/test-appearance-accessibility-policy.mjs
```
Expected: FAIL.

- [ ] **Step 3: Implement policy and DOM applicator**

Apply settings at document root, subscribe to `prefers-color-scheme` changes only when theme is `system`, and expose one reapply function for settings changes.

- [ ] **Step 4: Add shared CSS behavior**

Use CSS custom properties for text scaling and contrast tokens. Under `.reduce-motion`, remove nonessential transitions/animations while preserving functional feedback.

- [ ] **Step 5: Add integration coverage**

Assert Timeline, Profile, Community, private messaging, and Settings load the shared applicator directly or through an existing common bootstrap.

- [ ] **Step 6: Run tests**

```bash
node scripts/test-appearance-accessibility-policy.mjs
node scripts/test-appearance-accessibility-integration.mjs
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add appearance-accessibility-policy.mjs appearance-accessibility.js <shared-stylesheet> <modified-html-files> scripts/test-appearance-accessibility-*.mjs
git commit -m "feat: apply appearance and accessibility settings"
```

### Task 4: Notification delivery preference policy

**Files:**
- Create: `notification-preference-policy.mjs`
- Modify: existing notification processor/delivery module
- Test: `scripts/test-notification-preference-policy.mjs`
- Test: existing notification processor integration tests

**Interfaces:**
- Produces: `notificationCategoryForEvent(type) -> category key`
- Produces: `isQuietHoursActive({ enabled, start, end }, localMinutes) -> boolean`
- Produces: `shouldDeliverPush({ settings, eventType, localMinutes }) -> boolean`

- [ ] **Step 1: Write failing policy tests**

Cover all seven categories, pause-all, disabled category, normal quiet-hours range, overnight range (for example 22:00-07:00), disabled quiet hours, and boundary minutes.

- [ ] **Step 2: Run and verify RED**

```bash
node scripts/test-notification-preference-policy.mjs
```
Expected: FAIL.

- [ ] **Step 3: Implement pure delivery-decision policy**

```js
export function shouldDeliverPush({ settings, eventType, localMinutes }) {
  if (settings.pauseAllNotifications) return false;
  const category = notificationCategoryForEvent(eventType);
  if (category && settings.notifications[category] === false) return false;
  if (isQuietHoursActive(settings.quietHours, localMinutes)) return false;
  return true;
}
```

- [ ] **Step 4: Integrate into canonical notification processor**

Keep valid in-app notification creation unchanged. Apply preference filtering immediately before push send. Do not enqueue suppressed pushes for later delivery.

- [ ] **Step 5: Run focused and existing notification tests**

```bash
node scripts/test-notification-preference-policy.mjs
node scripts/test-notification-processor.mjs
node scripts/test-notification-firestore-integration.mjs
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add notification-preference-policy.mjs <notification-processor-files> scripts/test-notification-preference-policy.mjs
git commit -m "feat: honor notification preferences and quiet hours"
```

### Task 5: Safe `@username` mention parsing and notification events

**Files:**
- Create: `mention-policy.mjs`
- Modify: comment creation flow
- Modify: private-message send flow
- Modify: `community.js` or the canonical community-chatroom message writer
- Modify: notification adapter/processor mapping if needed for `mention`
- Test: `scripts/test-mention-policy.mjs`
- Test: `scripts/test-mention-integration.mjs`

**Interfaces:**
- Produces: `extractMentionUsernames(text) -> string[]`
- Produces: `dedupeMentionUsernames(values) -> string[]`
- Consumes: existing username lookup and block/context authorization helpers
- Produces notification event type: `mention`

- [ ] **Step 1: Write failing mention parser tests**

Test `@alice`, multiple mentions, duplicate mentions, punctuation boundaries, malformed `@`, case normalization according to existing username rules, and no false positives in email-like text if current username rules make that possible.

- [ ] **Step 2: Run and verify RED**

```bash
node scripts/test-mention-policy.mjs
```
Expected: FAIL.

- [ ] **Step 3: Implement parser/deduper**

Keep parsing pure. Do not emit notification decisions from the parser.

- [ ] **Step 4: Integrate mention resolution into the three approved content writers**

After successful content write, resolve each username once, verify target exists, verify target may access the context, apply blocking rules, and emit at most one mention event per target/content item.

- [ ] **Step 5: Map `mention` into notification preferences**

Ensure the existing notification UI/adapter displays mention notifications and the notification-preference policy maps them to `settings.notifications.mentions`.

- [ ] **Step 6: Run integration tests**

```bash
node scripts/test-mention-policy.mjs
node scripts/test-mention-integration.mjs
node scripts/test-notification-ui.mjs
node scripts/test-notification-processor.mjs
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add mention-policy.mjs <comment-writer> <private-message-writer> community.js <notification-files> scripts/test-mention-*.mjs
git commit -m "feat: add safe username mentions"
```

### Task 6: Settings regression, service worker, and TWA parity

**Files:**
- Modify: `sw.js` for any new browser-loaded assets
- Modify: focused Phase C CI workflow or add one following existing conventions
- Test: `scripts/test-push-service-worker.mjs`
- Test: all focused scripts from Tasks 1-5

**Interfaces:**
- Produces: green Settings/Notifications/Accessibility subsystem ready for PR review

- [ ] **Step 1: Add runtime settings assets to offline shell where required**

Include `settings.html`, browser-loaded settings/applicator modules, and any required CSS according to the existing service-worker pattern. Advance cache version if the current implementation requires it.

- [ ] **Step 2: Run all focused tests**

```bash
node scripts/test-user-settings-policy.mjs
node scripts/test-user-settings-rules.mjs
node scripts/test-settings-surface.mjs
node scripts/test-appearance-accessibility-policy.mjs
node scripts/test-appearance-accessibility-integration.mjs
node scripts/test-notification-preference-policy.mjs
node scripts/test-mention-policy.mjs
node scripts/test-mention-integration.mjs
```
Expected: PASS.

- [ ] **Step 3: Run notification, Firestore, and offline regressions**

```bash
node scripts/test-notification-ui.mjs
node scripts/test-notification-processor.mjs
node scripts/test-notification-firestore-integration.mjs
npm run test:firestore-ci
node scripts/test-push-service-worker.mjs
```
Expected: PASS.

- [ ] **Step 4: Run syntax checks**

```bash
node --check settings.js
node --check appearance-accessibility.js
node --check mention-policy.mjs
node --check notification-preference-policy.mjs
```
Expected: no syntax errors.

- [ ] **Step 5: Commit release-readiness changes**

```bash
git add sw.js .github/workflows scripts
git commit -m "test: verify Phase C settings and notifications"
```
