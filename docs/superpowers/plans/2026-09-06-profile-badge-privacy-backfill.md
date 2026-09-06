# Profile Badge Privacy and Existing-User Backfill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the admin member-badge lookup, make earned badges browsable and hideable from profiles using existing AnonChat UI patterns, and reconcile every existing user so they receive all badges they currently qualify for.

**Architecture:** Keep the fixed system-owned badge catalog and existing `users/{uid}.profilePrivacy.showBadges` privacy field. Profile UI reads earned badge records through the existing badge/profile integration, while trusted Firebase Admin processors perform full-user reconciliation and remain the only writers of earned badge records. Admin UI remains catalog-only and read-only.

**Tech Stack:** Vanilla JavaScript ES modules, Firebase Auth, Cloud Firestore, Firebase Admin SDK, Firestore Security Rules, GitHub Actions, Android TWA/web parity.

**Spec:** `docs/superpowers/specs/2026-09-06-profile-badge-privacy-backfill-design.md`

## Global Constraints

- Remove the entire `Member badge status` lookup from the admin dashboard.
- Keep the admin badge catalog read-only.
- Admins must not be able to create, edit, assign, remove, disable, feature, or otherwise alter badges or earned badge records.
- `users/{uid}.profilePrivacy.showBadges` remains authoritative for other-user visibility and defaults to visible when missing.
- Owners can always see their own earned badges, including when hidden from others.
- Hidden badge state must never affect award eligibility or remove earned badges.
- Premium Member remains a live status badge visible only while paid Premium is active.
- All new controls must reuse existing AnonChat button/input/toggle/dialog/mobile/dark-theme styles.
- Browser and admin clients remain unable to mutate earned badge records.
- Backfill and recurring reconciliation must be idempotent and compatible with Firebase Spark-plan constraints.

---

### Task 1: Remove member badge status from the admin dashboard

**Files:**
- Modify: `admin-badges.js`
- Modify: `scripts/test-admin-badges-surface.mjs`

**Interfaces:**
- Consumes: `listBadgeTypes(db)` from `badge-firestore.mjs`.
- Produces: `createBadgeAdminSection()` and `initAdminBadges()` that render only the fixed read-only badge catalog.

- [ ] **Step 1: Write the failing admin-surface contract**

Update `scripts/test-admin-badges-surface.mjs` so it requires the catalog container and explicitly rejects member lookup elements and copy:

```js
for (const id of ["badge-definition-list"]) {
  assert.match(surface, new RegExp(`id=["']${id}["']|id\\s*=\\s*["']${id}["']`));
}
for (const id of ["badge-user-id", "badge-user-refresh", "badge-user-assignments"]) {
  assert.doesNotMatch(surface, new RegExp(`id=["']${id}["']|id\\s*=\\s*["']${id}["']`));
}
assert.doesNotMatch(surface, /Member badge status|View member badges|Enter a user ID/i);
assert.doesNotMatch(badgeAdmin, /listUserBadges|renderUserAssignments|refreshUserBadges/);
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `node scripts/test-admin-badges-surface.mjs`

Expected: FAIL because the current admin panel still contains member lookup controls and code.

- [ ] **Step 3: Remove the member lookup from `admin-badges.js`**

Keep the heading and fixed catalog list, but delete the member heading, helper text, user ID input, refresh button, assignment container, `definitionById`, `renderUserAssignments`, click handler, and `listUserBadges` import. Return only the catalog initialization surface.

Target shape:

```js
import { listBadgeTypes } from "./badge-firestore.mjs";

export const initAdminBadges = ({ db, setStatus = () => {} }) => {
  createBadgeAdminSection();
  void listBadgeTypes(db)
    .then((definitions) => renderDefinitions(definitions))
    .catch(() => setStatus("Could not load badge definitions.", true));
  return {};
};
```

- [ ] **Step 4: Run focused test GREEN**

Run: `node scripts/test-admin-badges-surface.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add admin-badges.js scripts/test-admin-badges-surface.mjs
git commit -m "refactor: remove member badge lookup from admin"
```

---

### Task 2: Make profile badge preview and full collection respect privacy

**Files:**
- Modify: `profile-badges.js`
- Modify: `profile-phase-a.js` and/or the current profile badge integration file used by `profile.js`
- Modify: `profile.html`
- Modify: `profile.css` or the current profile stylesheet used by the badge surface
- Modify: `scripts/test-profile-badge-collection.mjs`
- Modify: `scripts/test-profile-privacy-policy.mjs` if needed for owner/other-viewer cases

**Interfaces:**
- Consumes: existing earned badge list, fixed badge catalog, and profile visibility result containing `badges`/`ownerView`.
- Produces: clickable badge preview, `View all badges` action, full collection dialog, and hidden-owner indicator.

- [ ] **Step 1: Write failing profile badge collection tests**

Require these behaviors:

```js
assert.match(profileSource, /View all badges/i);
assert.match(profileSource, /showModal\(|openBadgeCollection/);
assert.match(profileSource, /Hidden from others/i);
assert.match(profileSource, /earnedAt|Earned/);
assert.match(profileSource, /imageUrl/);
```

Add policy assertions that another viewer gets no badge preview/count when `showBadges === false`, while owner view remains enabled.

- [ ] **Step 2: Run focused profile tests and confirm RED**

Run:

```bash
node scripts/test-profile-badge-collection.mjs
node scripts/test-profile-privacy-policy.mjs
```

Expected: at least one FAIL for the missing/partial collection or hidden-owner behavior.

- [ ] **Step 3: Implement one badge collection renderer**

Add or refine a focused function in `profile-badges.js`:

```js
export const renderBadgeCollection = ({ container, badges, definitions, ownerHidden = false }) => {
  const byId = new Map(definitions.map((badge) => [badge.id, badge]));
  const rows = badges.map((earned) => {
    const badge = byId.get(earned.badgeId);
    return createBadgeCollectionRow({ badge, earned });
  });
  container.replaceChildren(...rows);
  container.closest("dialog")?.querySelector("[data-badge-hidden-note]")?.toggleAttribute("hidden", !ownerHidden);
};
```

The badge row must show artwork, name, tier, description, requirement, and earned date for permanent badges. Premium Member copy must say it is shown while paid Premium is active.

- [ ] **Step 4: Make preview and `View all badges` use existing AnonChat controls**

Use existing button classes already present on profile/settings surfaces instead of browser-default styling. Keep preview badge artwork as the clickable target and add a text action only when there are more badges than the preview capacity.

Example markup shape:

```html
<button type="button" class="secondary-button profile-badges-view-all" data-open-badge-collection>
  View all badges
</button>
```

Use the existing dialog/modal styling classes already used elsewhere in AnonChat rather than creating a new visual system.

- [ ] **Step 5: Enforce privacy at render time**

If the viewer is not the owner and resolved profile visibility says `badges === false`, do not render preview, count, collection action, or hidden-count placeholder. If owner view is true and `showBadges === false`, render their badges with `Hidden from others`.

- [ ] **Step 6: Run focused profile tests GREEN**

Run:

```bash
node scripts/test-profile-badge-collection.mjs
node scripts/test-profile-privacy-policy.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add profile-badges.js profile-phase-a.js profile.html profile.css scripts/test-profile-badge-collection.mjs scripts/test-profile-privacy-policy.mjs
git commit -m "feat: add private-aware profile badge collection"
```

---

### Task 3: Add owner badge privacy control using existing profile settings styling

**Files:**
- Modify: the existing profile privacy/settings UI file(s) that currently edit `profilePrivacy`
- Modify: `profile.html` or settings/profile privacy markup as appropriate
- Modify: existing profile/settings stylesheet only if no matching toggle class already exists
- Modify: `profile-privacy-policy.mjs` only if normalization does not already preserve `showBadges`
- Test: `scripts/test-profile-privacy-policy.mjs`
- Test: add/update a UI contract test for privacy control wiring

**Interfaces:**
- Consumes: normalized `profilePrivacy` with `showBadges`.
- Produces: a styled `Show badges on my profile` toggle that writes only `profilePrivacy.showBadges` through the existing privacy update path.

- [ ] **Step 1: Write failing UI/wiring contract**

Require a control with accessible copy and reuse of the existing toggle class. Require update code to merge only the badge privacy field into the existing privacy map, e.g.:

```js
await updateProfilePrivacy({
  ...currentPrivacy,
  showBadges: badgeVisibilityToggle.checked
});
```

The test must reject a direct write that overwrites unrelated privacy keys.

- [ ] **Step 2: Run privacy tests RED**

Run the privacy policy and UI contract tests.

Expected: FAIL because the owner-facing badge visibility control is missing or incomplete.

- [ ] **Step 3: Implement the control using existing classes**

Add copy exactly as designed:

```html
<label class="<existing-privacy-toggle-class>" for="profile-show-badges">
  <span>
    <strong>Show badges on my profile</strong>
    <small>Other people can see badges you earn.</small>
  </span>
  <input id="profile-show-badges" type="checkbox">
</label>
```

Do not add a new custom input/button visual language. Reuse the existing privacy switch/toggle, button, focus, spacing, and responsive rules.

- [ ] **Step 4: Persist only `showBadges` through the existing privacy writer**

Initialize missing `showBadges` as checked/true. On save/change, merge the field with the current normalized privacy object; do not touch badge records.

- [ ] **Step 5: Run privacy tests GREEN**

Run focused profile/settings privacy tests plus `node --check` for modified JS files.

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add <modified-profile-or-settings-files> scripts/test-profile-privacy-policy.mjs <ui-contract-test>
git commit -m "feat: add profile badge visibility control"
```

---

### Task 4: Guarantee full-user reconciliation and add a one-time production backfill

**Files:**
- Modify: `badge-account-age-reconciliation.mjs`
- Modify: `badge-activity-reconciliation.mjs`
- Create: `badge-full-reconciliation.mjs`
- Create: `scripts/badge-full-backfill.mjs`
- Create: `scripts/test-badge-full-reconciliation.mjs`
- Modify: existing badge reconciliation tests as needed
- Modify: `package.json`

**Interfaces:**
- Consumes: `FirestoreBadgeAwardAdapter`, `reconcileAccountAgeBadges`, `reconcileActivityBadges`.
- Produces: `reconcileAllExistingUsers({ adapter, identityBatchSize, activityBatchSize })` and CLI script `npm run badge:backfill-all`.

- [ ] **Step 1: Write a RED full-pass reconciliation test**

Use a fake adapter with more users than one bounded scheduled run can cover. Require the coordinator to continue through all returned cursors and to run both identity/status and activity evaluation across the full population.

Example expectation:

```js
const result = await reconcileAllExistingUsers({ adapter, identityBatchSize: 2, activityBatchSize: 2 });
assert.equal(result.completed, true);
assert.equal(result.identityUsers, 7);
assert.equal(result.activityUsers, 7);
assert.equal(result.nextIdentityCursor, null);
assert.equal(result.nextActivityCursor, null);
```

Also assert rerunning does not duplicate permanent awards and Premium reconciliation can remove `premium-member` when inactive.

- [ ] **Step 2: Run the test RED**

Run: `node scripts/test-badge-full-reconciliation.mjs`

Expected: FAIL because full-pass coordinator does not exist.

- [ ] **Step 3: Implement `reconcileAllExistingUsers`**

Create `badge-full-reconciliation.mjs` that repeatedly invokes the bounded reconcilers with their returned cursors until both return `null`:

```js
export const reconcileAllExistingUsers = async ({ adapter }) => {
  let identityCursor = null;
  let activityCursor = null;
  let identityUsers = 0;
  let activityUsers = 0;

  do {
    const result = await reconcileAccountAgeBadges({ adapter, startCursor: identityCursor });
    identityUsers += result.evaluated;
    identityCursor = result.nextCursor;
  } while (identityCursor);

  do {
    const result = await reconcileActivityBadges({ adapter, startCursor: activityCursor });
    activityUsers += result.evaluated;
    activityCursor = result.nextCursor;
  } while (activityCursor);

  return { completed: true, identityUsers, activityUsers, nextIdentityCursor: null, nextActivityCursor: null };
};
```

- [ ] **Step 4: Add authenticated CLI wrapper**

Create `scripts/badge-full-backfill.mjs` using Firebase Admin application-default credentials and the same project resolution pattern as existing badge processors. Log only aggregate counts, not users' hidden badge visibility data.

- [ ] **Step 5: Add package command**

Add:

```json
"badge:backfill-all": "node scripts/badge-full-backfill.mjs"
```

- [ ] **Step 6: Make recurring jobs eventually revisit all users**

Persist/resume cursor state in a small server-owned Firestore document such as `systemState/badgeReconciliation`, or make each scheduled processor use a deterministic full-pass loop with safe caps. Prefer persisted cursor state so hourly/daily jobs stay bounded. Add tests proving a capped run stores the returned cursor and the next run resumes from it rather than restarting at the first user forever.

- [ ] **Step 7: Run reconciliation tests GREEN**

Run:

```bash
node scripts/test-badge-full-reconciliation.mjs
node scripts/test-badge-account-age-reconciliation.mjs
node scripts/test-badge-activity-reconciliation.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add badge-full-reconciliation.mjs badge-account-age-reconciliation.mjs badge-activity-reconciliation.mjs scripts/badge-full-backfill.mjs scripts/test-badge-full-reconciliation.mjs package.json
git commit -m "feat: reconcile badges for every existing user"
```

---

### Task 5: Production backfill workflow, regression verification, and rollout

**Files:**
- Create: `.github/workflows/backfill-existing-user-badges.yml`
- Modify: focused badge/profile CI workflow if needed to include new tests
- Test: workflow-policy/contract test for backfill ordering

**Interfaces:**
- Consumes: `npm run badge:backfill-all` and `FIREBASE_SERVICE_ACCOUNT_ANONCHATLOGIN`.
- Produces: one trusted workflow that can run after a successful Firebase deployment and can also be manually dispatched for an idempotent re-run.

- [ ] **Step 1: Write workflow contract RED**

Require that the backfill workflow authenticates with the Firebase service account and runs `npm run badge:backfill-all`. If chaining from deployment, require a successful `Deploy Firebase` conclusion before the backfill job executes.

- [ ] **Step 2: Run workflow contract RED**

Expected: FAIL because the new workflow does not yet exist.

- [ ] **Step 3: Create the production backfill workflow**

Use this safety shape:

```yaml
name: Backfill existing user badges
on:
  workflow_run:
    workflows: ["Deploy Firebase"]
    types: [completed]
  workflow_dispatch:

permissions:
  contents: read

jobs:
  backfill:
    if: github.event_name == 'workflow_dispatch' || github.event.workflow_run.conclusion == 'success'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event_name == 'workflow_dispatch' && 'main' || github.event.workflow_run.head_sha }}
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
      - run: npm ci
      - id: auth
        uses: google-github-actions/auth@v3
        with:
          credentials_json: ${{ secrets.FIREBASE_SERVICE_ACCOUNT_ANONCHATLOGIN }}
      - run: npm run badge:backfill-all
        env:
          GCLOUD_PROJECT: anonchatlogin
          GOOGLE_APPLICATION_CREDENTIALS: ${{ steps.auth.outputs.credentials_file_path }}
```

- [ ] **Step 4: Run focused and full regressions**

Run all focused badge/profile/admin tests, then full existing gates:

```bash
node scripts/test-admin-badges-surface.mjs
node scripts/test-profile-badge-collection.mjs
node scripts/test-profile-privacy-policy.mjs
node scripts/test-badge-full-reconciliation.mjs
npm run test:phase-b
npm run test:firestore-ci
```

Also run the existing Phase C CI workflow on the PR head.

Expected: all PASS.

- [ ] **Step 5: Commit workflow/tests**

```bash
git add .github/workflows/backfill-existing-user-badges.yml <workflow-contract-test> <ci-workflow-if-modified>
git commit -m "deploy: backfill badges for existing users after rollout"
```

- [ ] **Step 6: Open PR and verify exact head**

Open a PR from `profile-badge-privacy-backfill` to `main`. Require focused badge/profile checks, Phase C, Settings, and full Firestore rules/regression suites to pass on the exact PR head before merge.

- [ ] **Step 7: Merge and deploy**

Merge only the verified head. Verify the normal `Deploy Firebase` workflow completes successfully for the merge commit, including Hosting and any rules deployment triggered by the release.

- [ ] **Step 8: Verify production backfill completion**

Verify the chained `Backfill existing user badges` workflow succeeds. Inspect logs for aggregate completion counts and `next...Cursor=null`. Do not log badge privacy settings or hidden badge counts per user.

- [ ] **Step 9: Final production verification**

Confirm:

```text
Admin: badge catalog only; no Member badge status lookup.
Profile owner: can see badges and toggle Show badges on my profile.
Other viewer, visible: can click preview/View all and see collection.
Other viewer, hidden: sees no badge preview/count/collection.
Existing users: full backfill completed across every page.
Premium Member: only active paid subscribers retain the status badge.
```
