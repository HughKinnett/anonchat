# Phase C Automatic Badges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace admin-created/manual normal milestone badges with a built-in automatic milestone system using the approved AnonChat collectible-emblem visual direction and Spark → Pulse → Beacon → Legend progression.

**Architecture:** Preserve existing earned badge records and `profilePrivacy.showBadges`, but make the catalog code/config-owned rather than admin-authored. Add pure milestone evaluation and idempotent award helpers, integrate them with existing canonical activity data, simplify the admin dashboard to oversight-only controls, and render public/private badge collections through the existing profile badge surface.

**Tech Stack:** Firebase Auth, Cloud Firestore, Firebase Security Rules, vanilla JavaScript ES modules, existing profile/admin badge controllers, scheduled/triggered badge processing compatible with Firebase Spark-plan constraints, static optimized badge assets, Android TWA.

**Spec:** `docs/superpowers/specs/2026-09-05-phase-c-messaging-settings-badges-design.md`

**Visual Spec:** `docs/superpowers/specs/2026-09-05-phase-c-badge-visual-direction.md`

## Global Constraints

- Admins do not create/edit normal milestone badge definitions.
- Admins do not manually assign normal milestone badges.
- Admin retains only: view earned badges, corrective removal, emergency disable of future automatic awards.
- Existing earned badge records remain compatible.
- Automatic awards are idempotent.
- `users/{uid}.profilePrivacy.showBadges` remains authoritative for badge visibility.
- Owners may always view their own earned badges.
- Public profile badge preview is clickable and opens the full earned-badge collection.
- Initial badge families: Early Member, Account Age, Posts Created, Comments Made, Reactions Received, Followers Reached, Community Participation, Top Contributor.
- Progressive tier names: Spark, Pulse, Beacon, Legend.
- Visual hierarchy: Spark < Pulse < Beacon < Legend.
- Artwork must be original to AnonChat and recognizable without relying on color alone.
- Badge processing must respect Firebase Spark-plan cost constraints and avoid unnecessary high-volume reads.

---

### Task 1: Built-in badge catalog and milestone policy

**Files:**
- Create: `badge-catalog.mjs`
- Create: `badge-milestone-policy.mjs`
- Test: `scripts/test-badge-catalog.mjs`
- Test: `scripts/test-badge-milestone-policy.mjs`

**Interfaces:**
- Produces: `BADGE_FAMILIES`
- Produces: `BADGE_TIERS`
- Produces: `badgeDefinition(id) -> object|null`
- Produces: `eligibleBadgeIds(metrics) -> string[]`
- Produces: `nextUnearnedBadgeIds({ metrics, earnedIds }) -> string[]`

- [ ] **Step 1: Write failing catalog tests**

Assert all eight approved families exist and every progressive family uses only `spark`, `pulse`, `beacon`, `legend` tier ids in ascending order.

- [ ] **Step 2: Write failing milestone tests**

Use explicit fixture metrics and verify crossing a threshold returns the correct new badge ids while already-earned ids are excluded.

- [ ] **Step 3: Run tests and verify RED**

```bash
node scripts/test-badge-catalog.mjs
node scripts/test-badge-milestone-policy.mjs
```
Expected: FAIL.

- [ ] **Step 4: Implement code-owned catalog**

Each definition must include at minimum:
```js
{
  id,
  family,
  tier,
  name,
  description,
  metric,
  threshold,
  asset,
  active: true
}
```

Use exact approved families. Set deterministic initial thresholds in code so the system is deployable without admin configuration. Keep threshold values easy to revise later through code review, not dashboard editing.

- [ ] **Step 5: Implement pure eligibility functions**

No Firestore calls inside `badge-milestone-policy.mjs`. The evaluator receives canonical user metrics and earned ids and returns only newly eligible ids.

- [ ] **Step 6: Run tests and verify GREEN**

```bash
node scripts/test-badge-catalog.mjs
node scripts/test-badge-milestone-policy.mjs
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add badge-catalog.mjs badge-milestone-policy.mjs scripts/test-badge-*.mjs
git commit -m "feat: define automatic milestone badge catalog"
```

### Task 2: Badge artwork assets and accessible metadata

**Files:**
- Create: optimized individual badge assets under existing public asset directory, one per catalog badge definition
- Modify: `badge-catalog.mjs`
- Test: `scripts/test-badge-assets.mjs`

**Interfaces:**
- Consumes: approved visual direction document
- Produces: stable asset path for every catalog badge
- Produces: text alternative/description for every badge

- [ ] **Step 1: Write failing asset coverage test**

Test that every `badge-catalog.mjs` definition points to an existing production asset path and includes non-empty accessible text.

- [ ] **Step 2: Run and verify RED**

```bash
node scripts/test-badge-assets.mjs
```
Expected: FAIL until assets exist.

- [ ] **Step 3: Create/export production badge assets**

Create individual optimized assets that follow the approved visual language:
- Spark: restrained bronze/copper framing.
- Pulse: silver/steel framing.
- Beacon: gold framing with stronger radiance/laurel detail.
- Legend: premium purple-and-gold framing with crown/laurel/gem-like prestige where appropriate.

Each family keeps distinct iconography: founding star, hourglass, post/writing, speech bubbles, reaction heart, people/followers, connected community, trophy/star contributor.

- [ ] **Step 4: Wire stable asset paths and accessible text into the catalog**

Ensure profile preview can identify family/tier from iconography and text without depending on color alone.

- [ ] **Step 5: Run asset test**

```bash
node scripts/test-badge-assets.mjs
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add <badge-asset-directory> badge-catalog.mjs scripts/test-badge-assets.mjs
git commit -m "feat: add AnonChat milestone badge artwork"
```

### Task 3: Canonical user metric collection and idempotent award writer

**Files:**
- Create: `badge-metrics-policy.mjs`
- Create: `badge-award-service.mjs`
- Modify: existing badge automatic-award processor/helper if present, otherwise replace only the normal milestone path
- Test: `scripts/test-badge-metrics-policy.mjs`
- Test: `scripts/test-badge-award-service.mjs`

**Interfaces:**
- Produces: `normalizeBadgeMetrics(value) -> metrics object`
- Produces: `collectBadgeMetrics(db, uid) -> Promise<metrics>`
- Produces: `awardEligibleBadges(db, uid, { awardsEnabled }) -> Promise<{ awardedIds }>`
- Reads earned badges at: existing `users/{uid}/badges/{badgeId}` path

- [ ] **Step 1: Write failing metric normalization tests**

Cover metrics needed for all eight approved families, including zero/default behavior.

- [ ] **Step 2: Write failing idempotency test**

Use a stub/fake persistence layer or existing Firestore emulator pattern to run `awardEligibleBadges` twice with identical metrics and assert the second pass creates no duplicate award.

- [ ] **Step 3: Run and verify RED**

```bash
node scripts/test-badge-metrics-policy.mjs
node scripts/test-badge-award-service.mjs
```
Expected: FAIL.

- [ ] **Step 4: Implement bounded canonical metric collection**

Prefer existing counters/indexes where available. Do not scan entire historical collections when a maintained counter or bounded aggregate already exists. For any metric that lacks an efficient source, add the smallest supporting counter/index necessary and document it in the test fixture.

- [ ] **Step 5: Implement idempotent award writes**

For each newly eligible badge id, create or merge the existing earned-badge record with fields such as `{ badgeId, earnedAt, source: "milestone" }`. Existing records remain untouched.

- [ ] **Step 6: Honor emergency award switch**

When `awardsEnabled` is false, eligibility may be calculated but no new earned-badge document is written.

- [ ] **Step 7: Run tests**

```bash
node scripts/test-badge-metrics-policy.mjs
node scripts/test-badge-award-service.mjs
```
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add badge-metrics-policy.mjs badge-award-service.mjs <existing-badge-processor> scripts/test-badge-metrics-policy.mjs scripts/test-badge-award-service.mjs
git commit -m "feat: automate milestone badge awards"
```

### Task 4: Firestore rules for built-in catalog and oversight-only admin behavior

**Files:**
- Modify: `firestore.rules`
- Test: `scripts/test-badge-firestore-rules.mjs`
- Test: `scripts/test-phase-a-firestore-rules.mjs`

**Interfaces:**
- Consumes: existing `profileBadgesReadable(userId)` privacy policy
- Produces: no client/admin path for normal milestone definition creation/editing
- Produces: admin corrective delete permission for earned badges only

- [ ] **Step 1: Update failing rule expectations first**

Change tests so they reject admin creation/editing of normal `badgeTypes` milestone definitions and reject manual normal milestone assignment while preserving privacy-aware badge reads and corrective admin removal.

- [ ] **Step 2: Run rule tests and verify RED**

```bash
node scripts/test-badge-firestore-rules.mjs
node scripts/test-phase-a-firestore-rules.mjs
```
Expected: FAIL against the old admin-authoring rules.

- [ ] **Step 3: Remove retired admin-authoring permissions**

Keep built-in definitions in code/config, not client-writable Firestore definitions. Preserve only rights required for existing compatibility and corrective deletion according to the deployed schema.

- [ ] **Step 4: Preserve `showBadges` privacy enforcement**

Verify other users cannot read `users/{uid}/badges/*` when `showBadges == false`, while the owner and allowed admin moderation path retain access.

- [ ] **Step 5: Run rule suites**

```bash
node scripts/test-badge-firestore-rules.mjs
node scripts/test-phase-a-firestore-rules.mjs
npm run test:firestore-ci
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add firestore.rules scripts/test-badge-firestore-rules.mjs scripts/test-phase-a-firestore-rules.mjs
git commit -m "security: restrict badge management to automatic awards"
```

### Task 5: Simplify admin dashboard badge controls

**Files:**
- Modify: `admin-badges.js`
- Modify: admin HTML surface containing badge controls
- Test: `scripts/test-admin-badges-surface.mjs`

**Interfaces:**
- Retains: earned-badge viewer
- Retains: corrective badge removal action
- Retains: emergency automatic-awards switch
- Removes: create badge, edit definition, manual normal milestone assignment, award-mode selector

- [ ] **Step 1: Rewrite admin surface test to the approved model**

Assert retired controls/ids/text are absent and retained oversight controls are present.

- [ ] **Step 2: Run and verify RED**

```bash
node scripts/test-admin-badges-surface.mjs
```
Expected: FAIL against current dashboard.

- [ ] **Step 3: Remove create/edit/manual-award UI and controller branches**

Delete only retired badge-authoring functionality. Keep corrective removal and viewing logic focused and understandable for a nontechnical admin.

- [ ] **Step 4: Keep emergency switch explicit**

Label it clearly as `Disable automatic badge awards`; toggling it must not remove existing earned badges.

- [ ] **Step 5: Run surface and syntax tests**

```bash
node scripts/test-admin-badges-surface.mjs
node --check admin-badges.js
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add admin-badges.js <admin-html> scripts/test-admin-badges-surface.mjs
git commit -m "feat: simplify admin badge oversight"
```

### Task 6: Public/private profile badge collection experience

**Files:**
- Modify: `profile-badges.js`
- Modify: `profile-phase-a.js` or current profile badge integration file as needed
- Modify: profile HTML/CSS
- Test: `scripts/test-profile-badge-collection.mjs`
- Test: `scripts/test-phase-a-profile-surface.mjs`

**Interfaces:**
- Consumes: `badgeDefinition(id)` and catalog asset metadata
- Consumes: existing `profilePrivacy.showBadges`
- Produces: clickable public preview and full collection/detail view

- [ ] **Step 1: Write failing profile tests**

Assert actual badge artwork is rendered, public preview is clickable, collection shows name/family/tier/description/requirement/earned date when available, private collection is unavailable to other users, and owner still sees private badges with a private/hidden indicator.

- [ ] **Step 2: Run and verify RED**

```bash
node scripts/test-profile-badge-collection.mjs
node scripts/test-phase-a-profile-surface.mjs
```
Expected: FAIL.

- [ ] **Step 3: Implement catalog-backed badge rendering**

Render earned badge documents against code-owned definitions; if an old earned badge id lacks a built-in definition, render a safe legacy fallback instead of breaking the profile.

- [ ] **Step 4: Implement full collection view**

Use a modal/panel or dedicated profile section consistent with the existing UI. Keep the public preview compact and allow `View all badges` when necessary.

- [ ] **Step 5: Preserve privacy as source of truth**

Do not merely hide the button client-side; rely on existing Firestore read protection as well. Owner view remains available.

- [ ] **Step 6: Run profile tests**

```bash
node scripts/test-profile-badge-collection.mjs
node scripts/test-phase-a-profile-surface.mjs
node scripts/test-badge-firestore-rules.mjs
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add profile-badges.js profile-phase-a.js <profile-html-css> scripts/test-profile-badge-collection.mjs scripts/test-phase-a-profile-surface.mjs
git commit -m "feat: add browsable profile badge collections"
```

### Task 7: Automatic badge processing trigger and cost safeguards

**Files:**
- Modify: existing badge-award workflow/script if present
- Create or modify: focused scheduled/triggered badge processor compatible with current Firebase/GitHub Actions architecture
- Test: `scripts/test-badge-processor.mjs`
- Modify: relevant workflow YAML only if processing is workflow-driven

**Interfaces:**
- Consumes: `awardEligibleBadges`
- Reads emergency award switch
- Produces bounded processing batches with deterministic resume behavior if existing architecture uses batch cursors

- [ ] **Step 1: Write failing processor tests**

Cover awards-enabled, awards-disabled, duplicate rerun, bounded batch size, and one user failure not corrupting unrelated users.

- [ ] **Step 2: Run and verify RED**

```bash
node scripts/test-badge-processor.mjs
```
Expected: FAIL.

- [ ] **Step 3: Integrate with existing processing architecture**

Reuse the repo's current scheduled/workflow processing model rather than introducing a paid Firebase server dependency. Bound users per run and reuse canonical counters/metrics.

- [ ] **Step 4: Add error isolation and reporting**

Return/report per-user award results without exposing private user content in logs.

- [ ] **Step 5: Run processor test**

```bash
node scripts/test-badge-processor.mjs
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add <badge-processor-files> .github/workflows scripts/test-badge-processor.mjs
git commit -m "feat: process automatic badge milestones"
```

### Task 8: Badge regression, offline assets, and release readiness

**Files:**
- Modify: `sw.js` if production badge assets/modules must be cached
- Modify: focused CI workflow if needed
- Test: all badge tests above plus service-worker and full regression suites

**Interfaces:**
- Produces: a green automatic-badges subsystem ready for PR review and release

- [ ] **Step 1: Add production badge assets/modules to offline shell if required by existing PWA behavior**

Advance cache version according to the current service-worker convention.

- [ ] **Step 2: Run all badge-focused tests**

```bash
node scripts/test-badge-catalog.mjs
node scripts/test-badge-milestone-policy.mjs
node scripts/test-badge-assets.mjs
node scripts/test-badge-metrics-policy.mjs
node scripts/test-badge-award-service.mjs
node scripts/test-badge-firestore-rules.mjs
node scripts/test-admin-badges-surface.mjs
node scripts/test-profile-badge-collection.mjs
node scripts/test-badge-processor.mjs
```
Expected: PASS.

- [ ] **Step 3: Run full regressions and offline tests**

```bash
npm run test:firestore-ci
node scripts/test-push-service-worker.mjs
```
Expected: PASS.

- [ ] **Step 4: Run syntax checks on modified badge/profile/admin modules**

```bash
node --check badge-catalog.mjs
node --check badge-milestone-policy.mjs
node --check badge-award-service.mjs
node --check admin-badges.js
node --check profile-badges.js
```
Expected: no syntax errors.

- [ ] **Step 5: Commit release-readiness changes**

```bash
git add sw.js .github/workflows scripts
git commit -m "test: verify automatic badge system"
```
