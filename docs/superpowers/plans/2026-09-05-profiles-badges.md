# Profiles + Badges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add editable profile bios and a secure, admin-managed badge system with visible badge artwork and details on AnonChat profiles.

**Architecture:** Keep badge domain logic isolated from the already-large profile/admin scripts. Store reusable badge definitions in `badgeTypes/{badgeId}` and per-user assignments in `users/{uid}/badges/{badgeId}`, while adding only `bio` to user profiles. Profile and admin surfaces consume focused badge helpers; Firestore rules enforce admin-only badge mutation and owner-only bio mutation.

**Tech Stack:** Vanilla HTML/CSS/JavaScript modules, Firebase Auth, Cloud Firestore, existing AnonChat policy/helper modules, Node `.mjs` regression scripts, GitHub Actions/deployment workflow already present in the repository.

**Spec:** `docs/superpowers/specs/2026-09-05-profiles-badges-design.md`

## Global Constraints

- No Stripe, Google Play Billing, or Firebase billing activation.
- Keep `profile-membership-badge` separate from earned achievement badges.
- Profile bio is optional and limited to 300 trimmed characters.
- A profile may feature at most 3 badges.
- Collapsed profile badge view shows at most 4 badges.
- Only designated admins may mutate badge definitions or assignments.
- Blocked/unavailable profiles must not expose bio or badges in the UI.
- Android UI is out of scope for this plan, but all data shapes must remain Android-compatible.

---

## File structure

**Create**
- `badge-policy.mjs` — pure badge validation, normalization, ordering, feature-limit, and presentation helpers.
- `badge-firestore.mjs` — Firestore read/write adapter for badge definitions and user assignments.
- `profile-badges.js` — DOM rendering and badge detail dialog controller for profile pages.
- `admin-badges.js` — admin dashboard controller for badge type and assignment management.
- `scripts/test-badge-policy.mjs` — unit/regression coverage for badge domain rules.
- `scripts/test-profile-badges-surface.mjs` — structural regression coverage for profile integration.
- `scripts/test-admin-badges-surface.mjs` — structural regression coverage for admin integration.
- `scripts/test-badge-firestore-rules.mjs` — Firestore rules regression coverage.

**Modify**
- `profile.html` — add About/Bio and Badges sections plus badge detail dialog shell.
- `profile.js` — load/render bio safely and hand badge rendering to `profile-badges.js`.
- `profile.css` or the existing profile stylesheet — badge grid, featured treatment, bio, modal styling.
- profile-editing surface files currently used by the app — add bio input/save behavior using existing edit-profile flow.
- `admin.html` — add task-first Badges management section.
- `admin.css` — badge management layout.
- existing admin JavaScript bootstrap file — initialize `admin-badges.js`.
- `firestore.rules` — badge collection and bio update rules.
- `package.json` — include new regression scripts in the existing test command if that project pattern is used.
- `sw.js` — cache new web modules/assets if the service worker uses an explicit asset list.

---

### Task 1: Badge domain policy

**Files:**
- Create: `badge-policy.mjs`
- Create: `scripts/test-badge-policy.mjs`

**Interfaces:**
- Produces: `BADGE_CATEGORIES`, `MAX_FEATURED_BADGES`, `PROFILE_BADGE_PREVIEW_LIMIT`, `normalizeBadgeType(raw)`, `normalizeBadgeAssignment(raw, badgeId)`, `sortEarnedBadges(entries)`, `previewEarnedBadges(entries)`, `canFeatureBadge(assignments, badgeId)`, `validBadgeImageUrl(value)`.
- Consumes: no Firestore or DOM APIs.

- [ ] **Step 1: Write the failing policy test**

```js
import assert from "node:assert/strict";
import {
  MAX_FEATURED_BADGES,
  PROFILE_BADGE_PREVIEW_LIMIT,
  normalizeBadgeType,
  sortEarnedBadges,
  previewEarnedBadges,
  canFeatureBadge,
  validBadgeImageUrl
} from "../badge-policy.mjs";

assert.equal(MAX_FEATURED_BADGES, 3);
assert.equal(PROFILE_BADGE_PREVIEW_LIMIT, 4);
assert.equal(validBadgeImageUrl("https://example.com/badge.png"), true);
assert.equal(validBadgeImageUrl("javascript:alert(1)"), false);

const badge = normalizeBadgeType({
  name: " Early Supporter ",
  description: " Joined during launch. ",
  imageUrl: "https://example.com/early.png",
  category: "early_supporter",
  active: true
});
assert.equal(badge.name, "Early Supporter");
assert.equal(badge.description, "Joined during launch.");

const earned = [
  { badgeId: "old", featured: false, earnedAtMs: 100 },
  { badgeId: "featured-new", featured: true, earnedAtMs: 300 },
  { badgeId: "featured-old", featured: true, earnedAtMs: 200 },
  { badgeId: "new", featured: false, earnedAtMs: 400 },
  { badgeId: "extra", featured: false, earnedAtMs: 50 }
];
assert.deepEqual(sortEarnedBadges(earned).map(x => x.badgeId), ["featured-new", "featured-old", "new", "old", "extra"]);
assert.equal(previewEarnedBadges(earned).length, 4);
assert.equal(canFeatureBadge(earned, "old"), true);
assert.equal(canFeatureBadge(earned.map((x, i) => ({ ...x, featured: i < 3 })), "extra"), false);
```

- [ ] **Step 2: Run the test and verify it fails because `badge-policy.mjs` does not exist**

Run:

```bash
node scripts/test-badge-policy.mjs
```

Expected: module-not-found failure.

- [ ] **Step 3: Implement the minimal pure badge policy**

```js
export const BADGE_CATEGORIES = Object.freeze([
  "early_supporter", "staff", "contributor", "popular_post",
  "community_helper", "long_time_member", "premium", "event",
  "milestone", "special"
]);
export const MAX_FEATURED_BADGES = 3;
export const PROFILE_BADGE_PREVIEW_LIMIT = 4;

const text = (value, max) => String(value ?? "").trim().slice(0, max);
export const validBadgeImageUrl = (value) => {
  try { return new URL(String(value)).protocol === "https:"; } catch { return false; }
};

export const normalizeBadgeType = (raw = {}) => ({
  name: text(raw.name, 60),
  description: text(raw.description, 280),
  imageUrl: validBadgeImageUrl(raw.imageUrl) ? String(raw.imageUrl) : "",
  category: BADGE_CATEGORIES.includes(raw.category) ? raw.category : "special",
  active: raw.active !== false
});

export const normalizeBadgeAssignment = (raw = {}, badgeId = "") => ({
  badgeId: String(raw.badgeId || badgeId),
  featured: raw.featured === true,
  earnedAt: raw.earnedAt ?? null,
  assignedAt: raw.assignedAt ?? null,
  assignedBy: String(raw.assignedBy || "")
});

const millis = (entry) => Number(entry.earnedAtMs ?? entry.earnedAt?.toMillis?.() ?? 0);
export const sortEarnedBadges = (entries = []) => [...entries].sort((a, b) =>
  Number(b.featured) - Number(a.featured) || millis(b) - millis(a)
);
export const previewEarnedBadges = (entries = []) => sortEarnedBadges(entries).slice(0, PROFILE_BADGE_PREVIEW_LIMIT);
export const canFeatureBadge = (assignments = [], badgeId) => {
  const target = assignments.find(x => x.badgeId === badgeId);
  if (target?.featured) return true;
  return assignments.filter(x => x.featured).length < MAX_FEATURED_BADGES;
};
```

- [ ] **Step 4: Re-run the policy test**

Run:

```bash
node scripts/test-badge-policy.mjs
```

Expected: PASS with exit code 0.

- [ ] **Step 5: Commit**

```bash
git add badge-policy.mjs scripts/test-badge-policy.mjs
git commit -m "feat: add badge domain policy"
```

---

### Task 2: Firestore adapter for definitions and assignments

**Files:**
- Create: `badge-firestore.mjs`
- Modify: `scripts/test-badge-policy.mjs`

**Interfaces:**
- Consumes: `normalizeBadgeType`, `normalizeBadgeAssignment`, `canFeatureBadge` from `badge-policy.mjs`; Firebase Firestore instance passed in by callers.
- Produces: `listBadgeTypes(db, { includeInactive })`, `listUserBadges(db, uid)`, `saveBadgeType(db, badgeId, input, adminUid)`, `setUserBadge(db, uid, badgeId, adminUid, { featured, earnedAt })`, `removeUserBadge(db, uid, badgeId)`, `setBadgeFeatured(db, uid, badgeId, featured, adminUid)`.

- [ ] **Step 1: Extend tests with Firestore-independent contract assertions**

Add source-shape assertions ensuring the adapter imports only Firestore functions and the badge policy module, and exports all six named operations. This project already uses source-based regression tests; follow that pattern rather than introducing a new test framework.

```js
import { readFile } from "node:fs/promises";
const source = await readFile(new URL("../badge-firestore.mjs", import.meta.url), "utf8");
for (const name of ["listBadgeTypes", "listUserBadges", "saveBadgeType", "setUserBadge", "removeUserBadge", "setBadgeFeatured"]) {
  assert.match(source, new RegExp(`export const ${name}`));
}
```

- [ ] **Step 2: Run the test and verify failure**

Run:

```bash
node scripts/test-badge-policy.mjs
```

Expected: missing file/export failure.

- [ ] **Step 3: Implement the adapter using repository-standard Firebase v10 modular imports**

Key implementation rules:

```js
const badgeTypeRef = (db, badgeId) => doc(db, "badgeTypes", badgeId);
const userBadgeRef = (db, uid, badgeId) => doc(db, "users", uid, "badges", badgeId);
```

`saveBadgeType` must normalize input, reject empty name/description, use `serverTimestamp()` for `updatedAt`, preserve `createdAt/createdBy` on edits, and create them on first write.

`setUserBadge` must use document ID = badge ID and write:

```js
{
  badgeId,
  earnedAt: earnedAt || serverTimestamp(),
  assignedAt: serverTimestamp(),
  assignedBy: adminUid,
  featured: Boolean(featured)
}
```

`setBadgeFeatured` must read current assignments, call `canFeatureBadge`, throw `new Error("A profile can feature at most 3 badges.")` when necessary, and update only the target assignment.

- [ ] **Step 4: Re-run tests**

Run:

```bash
node scripts/test-badge-policy.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add badge-firestore.mjs scripts/test-badge-policy.mjs
git commit -m "feat: add badge firestore adapter"
```

---

### Task 3: Firestore security rules for bio and badges

**Files:**
- Modify: `firestore.rules`
- Create: `scripts/test-badge-firestore-rules.mjs`

**Interfaces:**
- Consumes: existing designated-admin rule helper/pattern in `firestore.rules`.
- Produces: read/write protection for `badgeTypes`, `users/{uid}/badges`, and owner-only validated `bio` mutation.

- [ ] **Step 1: Write a failing rules regression script**

Following the repository’s existing rules-test style, assert textual/rule-contract presence for:

```js
assert.match(rules, /match \/badgeTypes\/\{badgeId\}/);
assert.match(rules, /match \/users\/\{userId\}\/badges\/\{badgeId\}/);
assert.match(rules, /bio/);
assert.match(rules, /300/);
```

Also assert badge mutations are guarded by the existing designated-admin predicate rather than `request.auth != null` alone.

- [ ] **Step 2: Run the new rules test and verify failure**

```bash
node scripts/test-badge-firestore-rules.mjs
```

Expected: FAIL because badge rule blocks are absent.

- [ ] **Step 3: Add rule blocks**

Implement these semantics using the exact helper naming already present in `firestore.rules`:

```text
badgeTypes:
  read: signed-in users
  create/update/delete: designated admins only

users/{userId}/badges/{badgeId}:
  read: signed-in users subject to existing user visibility conventions
  create/update/delete: designated admins only

users/{userId}.bio:
  owner only
  string when present
  size <= 300 after client trimming
  existing protected fields remain protected
```

Do not loosen any current user-document update rule; extend its allowed-key/validation logic narrowly for `bio`.

- [ ] **Step 4: Run badge rules and existing rules regressions**

Run:

```bash
node scripts/test-badge-firestore-rules.mjs
node scripts/test-firestore-rules.mjs
```

If the repository has additional moderation/block rules tests in `package.json`, run those too.

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add firestore.rules scripts/test-badge-firestore-rules.mjs
git commit -m "feat: secure profile bios and badges"
```

---

### Task 4: Profile bio editing and safe display

**Files:**
- Modify: existing profile edit HTML/JS files found by searching for profile image/cover/profile settings save behavior.
- Modify: `profile.html`
- Modify: `profile.js`
- Modify: existing profile stylesheet.
- Create or extend: `scripts/test-profile-badges-surface.mjs`

**Interfaces:**
- Consumes: existing authenticated profile-edit save flow and `targetProfile` in `profile.js`.
- Produces: `bio` editing, `#profile-bio` public rendering element, `#profile-bio-section` visibility behavior.

- [ ] **Step 1: Locate the existing profile edit surface before editing**

Run repository search for the current profile image/cover settings save code. Use that same surface; do not create a second profile settings page.

- [ ] **Step 2: Write failing surface assertions**

```js
assert.match(profileHtml, /id="profile-bio-section"/);
assert.match(profileHtml, /id="profile-bio"/);
assert.match(profileJs, /targetProfile\.bio/);
assert.doesNotMatch(profileJs, /profile-bio[^\n]*innerHTML/);
```

Add edit-surface assertions for a textarea/input with `maxlength="300"` and Firestore save of `bio`.

- [ ] **Step 3: Run the surface test and verify failure**

```bash
node scripts/test-profile-badges-surface.mjs
```

Expected: FAIL.

- [ ] **Step 4: Add the profile bio UI**

`profile.html`:

```html
<section id="profile-bio-section" class="profile-about" hidden>
  <h2>About</h2>
  <p id="profile-bio"></p>
</section>
```

`profile.js` logic:

```js
const bioSection = document.getElementById("profile-bio-section");
const bio = document.getElementById("profile-bio");
const value = targetBlocked ? "" : String(targetProfile?.bio || "").trim();
bio.textContent = value;
bioSection.hidden = !value;
```

In the owner editing surface, add a multiline input limited to 300 characters. On save, trim and use the existing profile update mechanism to write `bio` as a string; use an empty string to clear it if that matches current profile update conventions.

- [ ] **Step 5: Run profile and existing profile-render tests**

```bash
node scripts/test-profile-badges-surface.mjs
node scripts/test-profile-render-policy.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add profile.html profile.js scripts/test-profile-badges-surface.mjs <profile-edit-files> <profile-stylesheet>
git commit -m "feat: add profile bio"
```

---

### Task 5: Public badge rendering and detail dialog

**Files:**
- Create: `profile-badges.js`
- Modify: `profile.html`
- Modify: `profile.js`
- Modify: existing profile stylesheet.
- Modify: `scripts/test-profile-badges-surface.mjs`
- Modify: `sw.js` if explicit cache list is used.

**Interfaces:**
- Consumes: `listBadgeTypes`, `listUserBadges` from `badge-firestore.mjs`; `sortEarnedBadges`, `previewEarnedBadges` from `badge-policy.mjs`.
- Produces: `createProfileBadgeController({ db, document, onError })` with `load(uid, { blocked, isOwner })` and `destroy()`.

- [ ] **Step 1: Add failing profile badge surface assertions**

Assert the presence of:

```html
<section id="profile-badges-section">
<div id="profile-badges-list">
<button id="profile-view-all-badges">
<dialog id="profile-badge-dialog">
```

Also assert `profile.js` delegates badge loading rather than duplicating `badgeTypes` rendering logic inline.

- [ ] **Step 2: Run the test and verify failure**

```bash
node scripts/test-profile-badges-surface.mjs
```

Expected: FAIL.

- [ ] **Step 3: Add the badge markup and controller**

`profile-badges.js` must:

1. Load active definitions plus earned assignment IDs.
2. Resolve earned assignments to definitions.
3. Ignore assignments whose definitions are missing.
4. Keep inactive definitions visible when already earned by fetching the exact assigned definition if the initial active list does not contain it.
5. Sort featured first and then newest earned.
6. Render only four initially.
7. Show `View all badges` only when count > 4.
8. Use a local placeholder image (prefer an existing AnonChat logo/avatar asset already in the repo) when `imageUrl` is missing or fails.
9. Open the dialog with artwork, name, description, and a formatted earned date.
10. Render all text with `textContent`.
11. Hide the entire public badge section when blocked or when a non-owner has zero earned badges.
12. Show a concise owner-only empty state when the owner has zero badges.

Use semantic buttons for clickable badges so keyboard users can open details.

- [ ] **Step 4: Wire it into `profile.js`**

Initialize once after auth/Firestore are ready:

```js
const badgeController = createProfileBadgeController({
  db,
  document,
  onError: (message) => setStatus(message, true)
});
```

Call:

```js
await badgeController.load(targetUserId, {
  blocked: targetBlocked,
  isOwner: currentUser.uid === targetUserId
});
```

Refresh badge rendering when block state/profile target changes, following the existing session-generation/listener cleanup pattern.

- [ ] **Step 5: Add styling**

Use the current profile visual language. Badge artwork should be clearly visible; target approximately 56–72 CSS pixels for normal cards and larger artwork inside the detail dialog. Do not alter Premium membership badge styling.

- [ ] **Step 6: Cache the new module when needed**

If `sw.js` contains an explicit static asset array, add `./profile-badges.js`, `./badge-policy.mjs`, and `./badge-firestore.mjs`.

- [ ] **Step 7: Run profile regressions**

```bash
node scripts/test-badge-policy.mjs
node scripts/test-profile-badges-surface.mjs
node scripts/test-profile-render-policy.mjs
node scripts/test-comment-surface-regression.mjs
node scripts/test-timeline-interaction-consistency.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add profile-badges.js profile.html profile.js <profile-stylesheet> sw.js scripts/test-profile-badges-surface.mjs
git commit -m "feat: show earned badges on profiles"
```

---

### Task 6: Admin badge type management

**Files:**
- Create: `admin-badges.js`
- Modify: `admin.html`
- Modify: `admin.css`
- Modify: existing admin bootstrap JavaScript file.
- Create: `scripts/test-admin-badges-surface.mjs`
- Modify: `sw.js` if required.

**Interfaces:**
- Consumes: `listBadgeTypes`, `saveBadgeType` from `badge-firestore.mjs`; `BADGE_CATEGORIES` from `badge-policy.mjs`; existing admin authentication/designated-admin gating.
- Produces: badge-type form/list UI and controller initialization.

- [ ] **Step 1: Write failing admin surface assertions**

```js
assert.match(adminHtml, /id="admin-badges"/);
assert.match(adminHtml, /id="badge-type-form"/);
assert.match(adminHtml, /id="badge-type-list"/);
assert.match(adminJs, /admin-badges\.js/);
```

Assert fields exist for name, description, HTTPS image URL, category, active state.

- [ ] **Step 2: Run and verify failure**

```bash
node scripts/test-admin-badges-surface.mjs
```

Expected: FAIL.

- [ ] **Step 3: Add the task-first admin Badges section**

The section must include:

```html
<section id="admin-badges" class="admin-task-section">
  <h2>Badges</h2>
  <form id="badge-type-form">...</form>
  <div id="badge-type-list"></div>
  <p id="badge-admin-status" role="status" aria-live="polite"></p>
</section>
```

Keep controls understandable without technical terminology. Use copy such as `Badge name`, `What this badge means`, `Badge artwork URL`, `Category`, `Active`.

- [ ] **Step 4: Implement definition CRUD behavior**

`admin-badges.js` must:

- refuse initialization unless the existing admin gate has passed,
- list active and inactive definitions,
- allow create/edit through the same form,
- generate a stable badge ID for new badges using the repository’s existing ID convention or a lowercase hyphenated slug plus collision-safe suffix,
- validate artwork as HTTPS before write,
- show explicit success/failure messages,
- deactivate via `active: false` rather than deleting definitions that may already be assigned.

- [ ] **Step 5: Run admin and policy tests**

```bash
node scripts/test-admin-badges-surface.mjs
node scripts/test-badge-policy.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add admin-badges.js admin.html admin.css <admin-bootstrap-file> sw.js scripts/test-admin-badges-surface.mjs
git commit -m "feat: manage badge types in admin"
```

---

### Task 7: Admin badge assignment and featured controls

**Files:**
- Modify: `admin-badges.js`
- Modify: `admin.html`
- Modify: `admin.css`
- Modify: `scripts/test-admin-badges-surface.mjs`

**Interfaces:**
- Consumes: `listUserBadges`, `setUserBadge`, `removeUserBadge`, `setBadgeFeatured`, `listBadgeTypes`.
- Produces: user lookup/selection integration, assignment list, assign/remove/feature actions.

- [ ] **Step 1: Extend failing admin assertions**

Assert controls for user selection, active badge assignment, current badge list, remove action, and feature toggle. Assert user IDs are not manually typed when an existing admin user-search/select component is available; reuse that component/pattern.

- [ ] **Step 2: Run and verify failure**

```bash
node scripts/test-admin-badges-surface.mjs
```

Expected: FAIL.

- [ ] **Step 3: Implement assignment UI**

Behavior:

- Selecting a user loads their current assignments.
- Assign dropdown contains active badge types not already assigned.
- Assign button writes an assignment with the current admin UID.
- Existing assignments display badge artwork/name, earned date, assigned-by metadata, feature toggle, and remove button.
- Attempting a fourth featured badge surfaces exactly: `A profile can feature at most 3 badges.`
- Removing requires the same confirmation style already used by the admin dashboard for destructive moderation actions.
- Assigning an already-earned badge never resets its earned date.

- [ ] **Step 4: Run admin tests**

```bash
node scripts/test-admin-badges-surface.mjs
node scripts/test-badge-policy.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add admin-badges.js admin.html admin.css scripts/test-admin-badges-surface.mjs
git commit -m "feat: assign and feature profile badges"
```

---

### Task 8: Regression, service-worker parity, and release verification

**Files:**
- Modify: `package.json` if needed to include new tests.
- Modify: `sw.js` if any new static module remains uncached.
- No feature logic should be added in this task unless verification exposes a defect.

**Interfaces:**
- Consumes: all previous tasks.
- Produces: a release candidate proven not to regress current profile/interactions behavior.

- [ ] **Step 1: Add new regression scripts to the project test command if the repository uses a central test script**

Include:

```text
scripts/test-badge-policy.mjs
scripts/test-badge-firestore-rules.mjs
scripts/test-profile-badges-surface.mjs
scripts/test-admin-badges-surface.mjs
```

- [ ] **Step 2: Run the complete relevant regression set**

At minimum:

```bash
node scripts/test-badge-policy.mjs
node scripts/test-badge-firestore-rules.mjs
node scripts/test-profile-badges-surface.mjs
node scripts/test-admin-badges-surface.mjs
node scripts/test-profile-render-policy.mjs
node scripts/test-comment-surface-regression.mjs
node scripts/test-timeline-interaction-consistency.mjs
node scripts/test-interaction-details.mjs
node scripts/test-viewer-block-surfaces.mjs
node scripts/test-runtime-cost-budgets.mjs
```

Also run the repository’s canonical aggregate test command from `package.json`.

Expected: all PASS.

- [ ] **Step 3: Verify service-worker static assets**

Confirm every newly imported local module needed offline is in the explicit cache list if one exists. Run the existing offline/service-worker regression script if present.

- [ ] **Step 4: Verify no billing activation**

Search the diff for newly introduced Stripe checkout, Google Billing launch, Firebase Extension billing, payment webhook, or payment credential code. Expected: none.

- [ ] **Step 5: Verify the diff is scoped to Profiles + Badges**

```bash
git diff <base-sha>...HEAD --stat
git diff <base-sha>...HEAD
```

Expected: no unrelated messaging/discovery/timeline feature expansion.

- [ ] **Step 6: Commit any verification-only manifest/cache updates**

```bash
git add package.json sw.js
git commit -m "test: cover profiles and badges release"
```

Skip this commit if neither file changed.

---

### Task 9: Web deployment and post-deploy smoke checks

**Files:**
- Use the repository’s existing deployment workflow/configuration; do not invent a new hosting path.

**Interfaces:**
- Consumes: verified `main` or reviewed merge commit.
- Produces: deployed web release only. Android packaging remains outside this plan.

- [ ] **Step 1: Inspect the existing deployment workflow before triggering it**

Confirm the current production Firebase/web deployment path and required branch/event from `.github/workflows` and Firebase config files.

- [ ] **Step 2: Trigger deployment through the repository’s established mechanism**

Use the existing workflow or deployment integration. Do not add credentials to the repository.

- [ ] **Step 3: Verify the deployment run result**

Check the workflow run and job steps. Expected: success.

- [ ] **Step 4: Smoke-check production behavior**

Verify:

- normal profile still loads,
- blocked profile still hides protected content,
- bio renders as plain text,
- badge preview shows no more than four,
- `View all badges` appears for five or more,
- badge detail dialog works,
- admin can create/deactivate badge types,
- admin can assign/remove/feature badges,
- fourth featured badge is rejected,
- existing comments/reactions remain visible and consistent,
- no billing UI has become an active payment flow.

- [ ] **Step 5: Record the deployed commit SHA in the release/deployment notes pattern already used by the repository, if one exists**

Do not create a new release documentation system solely for this feature.
