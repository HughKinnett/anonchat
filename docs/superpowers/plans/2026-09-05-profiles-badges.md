# Profiles + Badges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add editable profile bios, visible earned badges, admin badge management, and automatic milestone awarding for the approved AnonChat achievements.

**Architecture:** Keep badge definition/presentation logic in `badge-policy.mjs`, Firestore access in `badge-firestore.mjs`, and automatic milestone qualification in a new pure `badge-milestones.mjs` evaluator. Canonical app actions call a small award service after successful writes; awards are unique by `users/{uid}/badges/{badgeId}` and never overwrite the first `earnedAt`. Profile/admin UI consumes the same badge documents, while direct client self-awards remain forbidden.

**Tech Stack:** Vanilla HTML/CSS/JavaScript modules, Firebase Auth, Cloud Firestore, existing AnonChat policy/helper modules, Node `.mjs` regression scripts, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-05-profiles-badges-design.md`

## Global Constraints

- No Stripe, Google Play Billing, or Firebase billing activation.
- Keep `profile-membership-badge` separate from earned achievement badges.
- Profile bio is optional and limited to 300 trimmed characters.
- A profile may feature at most 3 badges.
- Collapsed profile badge view shows at most 4 badges.
- Automatic awards must be idempotent and preserve first `earnedAt`.
- Automatic achievement badges remain earned if later counts decrease.
- Only trusted award paths or designated admins may create badge assignments.
- Blocked/unavailable profiles must not expose bio or badges in the UI.
- Android UI is out of scope for this plan, but all data shapes must remain Android-compatible.

---

## File structure

**Create**
- `badge-milestones.mjs` — supported metrics, initial badge catalog, qualification helpers.
- `badge-awards.mjs` — Firestore-facing evaluator/award service.
- `profile-badges.js` — profile badge rendering and detail-dialog controller.
- `admin-badges.js` — admin badge definition/assignment controller.
- `scripts/test-badge-milestones.mjs` — pure qualification tests for all automatic badges.
- `scripts/test-badge-awards-contract.mjs` — event routing/idempotency source-contract coverage.
- `scripts/test-profile-badges-surface.mjs` — profile bio/badge UI coverage.
- `scripts/test-admin-badges-surface.mjs` — admin controls coverage.

**Modify**
- `badge-policy.mjs` — normalize `awardMode`, metric, threshold, assignment source.
- `badge-firestore.mjs` — system/manual assignment metadata and idempotent award support.
- `firestore.rules` — trusted/admin badge mutation and bio protection.
- canonical post/comment/reaction/follow/premium/profile initialization modules — call award evaluation after successful state changes.
- `timeline.html`, `upload.js` — owner bio editing.
- `profile.html`, `profile.js`, profile stylesheet — public About + Badges rendering.
- `admin.html`, `admin.css`, existing admin bootstrap — milestone configuration and assignment management.
- focused CI workflow during branch development; remove branch-only helper workflows before merge.

---

### Task 1: Extend badge policy for automatic/manual definitions

**Files:**
- Modify: `badge-policy.mjs`
- Modify: `scripts/test-badge-policy.mjs`

**Interfaces:**
- Produces: `BADGE_AWARD_MODES`, `BADGE_MILESTONE_METRICS`, normalized `awardMode`, `milestoneMetric`, `milestoneThreshold`, and assignment `awardSource`.

- [ ] **Step 1: Write failing assertions**

```js
assert.deepEqual(BADGE_AWARD_MODES, ["automatic", "manual"]);
assert.equal(normalizeBadgeType({ name:"X", description:"Y", awardMode:"automatic", milestoneMetric:"posts_created", milestoneThreshold:10 }).awardMode, "automatic");
assert.equal(normalizeBadgeType({ name:"X", description:"Y", awardMode:"manual" }).milestoneMetric, null);
assert.equal(normalizeBadgeAssignment({ awardSource:"automatic" }, "x").awardSource, "automatic");
```

- [ ] **Step 2: Run** `node scripts/test-badge-policy.mjs` and verify FAIL for missing award-mode support.
- [ ] **Step 3: Implement constants/normalization** with supported metrics exactly matching the spec. Automatic numeric metrics require a finite positive threshold; `early_member` and `premium_active` may use `null` threshold.
- [ ] **Step 4: Re-run** `node scripts/test-badge-policy.mjs`; expect PASS.
- [ ] **Step 5: Commit** `feat: add automatic badge definition policy`.

---

### Task 2: Pure milestone qualification engine

**Files:**
- Create: `badge-milestones.mjs`
- Create: `scripts/test-badge-milestones.mjs`

**Interfaces:**
- Produces: `INITIAL_AUTOMATIC_BADGES`, `EARLY_MEMBER_CUTOFF`, `qualifiesForBadge(definition, metrics)`, `matchingAutomaticBadges(definitions, metrics, changedMetrics)`.

- [ ] **Step 1: Write failing tests for all approved badges**

```js
assert.equal(qualifiesForBadge({ awardMode:"automatic", milestoneMetric:"posts_created", milestoneThreshold:1 }, { posts_created:1 }), true);
assert.equal(qualifiesForBadge({ awardMode:"automatic", milestoneMetric:"posts_created", milestoneThreshold:10 }, { posts_created:9 }), false);
assert.equal(qualifiesForBadge({ awardMode:"automatic", milestoneMetric:"single_post_interactions", milestoneThreshold:25 }, { single_post_interactions:25 }), true);
assert.equal(qualifiesForBadge({ awardMode:"automatic", milestoneMetric:"followers_count", milestoneThreshold:100 }, { followers_count:100 }), true);
assert.equal(qualifiesForBadge({ awardMode:"automatic", milestoneMetric:"account_age_days", milestoneThreshold:365 }, { account_age_days:365 }), true);
assert.equal(qualifiesForBadge({ awardMode:"automatic", milestoneMetric:"premium_active" }, { premium_active:true }), true);
```

Also assert `INITIAL_AUTOMATIC_BADGES` contains: First Post 1; Contributor 10; Top Contributor 100; Community Favorite 25; Popular Creator 100; Conversation Starter 25; Community Helper 50; Connected 25; Well Known 100; Long-Time Member 365; Early Member; Premium Member.

- [ ] **Step 2: Run** `node scripts/test-badge-milestones.mjs`; expect module-not-found.
- [ ] **Step 3: Implement pure evaluator**. Numeric metrics use `>=`; `premium_active` checks boolean true; `early_member` compares account creation milliseconds to a single exported cutoff constant. Ignore inactive/manual definitions.
- [ ] **Step 4: Re-run** test; expect PASS.
- [ ] **Step 5: Commit** `feat: add badge milestone evaluator`.

---

### Task 3: Idempotent award service

**Files:**
- Create: `badge-awards.mjs`
- Modify: `badge-firestore.mjs`
- Create: `scripts/test-badge-awards-contract.mjs`

**Interfaces:**
- Produces: `evaluateBadgeMilestones({ db, uid, changedMetrics, metrics })` and `awardBadgeIfMissing(db, uid, badgeId, source="system")`.

- [ ] **Step 1: Write failing source/contract tests** requiring `getDoc` before award creation, unique `users/{uid}/badges/{badgeId}` writes, `assignedBy: "system"`, `awardSource: "automatic"`, and preservation of existing assignments.
- [ ] **Step 2: Run** `node scripts/test-badge-awards-contract.mjs`; expect FAIL.
- [ ] **Step 3: Implement minimal service**: load active automatic definitions, filter by `changedMetrics`, qualify through `badge-milestones.mjs`, and use an idempotent transaction/check-before-create. Existing assignment returns `{ awarded:false, reason:"already-earned" }` without update.
- [ ] **Step 4: Re-run** award + policy tests; expect PASS.
- [ ] **Step 5: Commit** `feat: add automatic badge award service`.

---

### Task 4: Secure automatic awards and badge definitions

**Files:**
- Modify: `firestore.rules`
- Modify: `scripts/test-badge-firestore-rules.mjs`

**Interfaces:**
- Badge definitions: admin writes only.
- Assignments: no arbitrary regular-user writes.

- [ ] **Step 1: Extend failing rules contract** to require `awardMode`, milestone validation references, and rejection of plain authenticated self-award writes.
- [ ] **Step 2: Run** `node scripts/test-badge-firestore-rules.mjs`; expect FAIL.
- [ ] **Step 3: Implement narrow validation** following the repo’s existing trusted/admin patterns. Do not broaden generic user write permission to badge subcollections. If automatic awarding cannot be securely performed directly from browser credentials under existing architecture, route it through the repository’s existing trusted processor/action pattern instead of weakening rules.
- [ ] **Step 4: Run** badge rules plus the repository’s existing Firestore rules suite; expect PASS.
- [ ] **Step 5: Commit** `feat: secure automatic badge awards`.

---

### Task 5: Wire canonical activity events to milestone evaluation

**Files:**
- Modify: exact canonical modules located by repository search for successful post creation, comment/reply creation, reactions/interactions, follow creation/removal, premium reconciliation, and profile/account initialization.
- Modify: `scripts/test-badge-awards-contract.mjs`

**Interfaces:**
- Calls `evaluateBadgeMilestones` only after the originating write succeeds.

- [ ] **Step 1: Add failing assertions** requiring metric routing:
  - post create → `posts_created`
  - interaction/reaction/comment on post → `single_post_interactions`, `total_interactions_received`, and `comments_received` as applicable
  - comment/reply create → `comments_or_replies_created`
  - follow change → `followers_count`
  - premium reconciliation → `premium_active`
  - account/profile init → `early_member`, `account_age_days`
- [ ] **Step 2: Run** contract test; expect FAIL.
- [ ] **Step 3: Implement hooks** using canonical stored data/count helpers already present. Award failures are caught/logged and must not roll back the user’s original post/comment/follow action.
- [ ] **Step 4: Run** award contract plus existing comment, interaction-consistency, follow, premium, and auth/profile tests; expect PASS.
- [ ] **Step 5: Commit** `feat: award badges from canonical activity`.

---

### Task 6: Account-age reconciliation

**Files:**
- Modify/create: existing scheduled maintenance/reconciliation module and workflow found in repo.
- Modify: `scripts/test-badge-awards-contract.mjs`

**Interfaces:**
- Evaluates only `account_age_days` for bounded batches of eligible users.

- [ ] **Step 1: Write failing contract assertions** for bounded pagination/batch size and `account_age_days`-only evaluation.
- [ ] **Step 2: Run** contract test; expect FAIL.
- [ ] **Step 3: Add reconciliation** using existing scheduled-processing conventions. Do not scan unbounded user collections per page load or client session.
- [ ] **Step 4: Run** runtime-cost/budget and award tests; expect PASS.
- [ ] **Step 5: Commit** `feat: reconcile account age badges`.

---

### Task 7: Profile bio editing and public display

**Files:**
- Modify: `timeline.html`, `upload.js`, `profile.html`, `profile.js`, existing profile stylesheet.
- Create/modify: `scripts/test-profile-badges-surface.mjs`.

- [ ] **Step 1: Use current RED profile-bio surface test** requiring owner textarea `maxlength="300"`, Firestore `bio` save, public `#profile-bio-section`, safe `.textContent`, and blocked-profile suppression.
- [ ] **Step 2: Implement owner About editor** in the existing timeline profile area; trim on save and write empty string to clear.
- [ ] **Step 3: Implement public About section** beneath identity/membership and hide it when blank or blocked.
- [ ] **Step 4: Run** profile-badges and profile-render/protected-metadata tests; expect PASS.
- [ ] **Step 5: Commit** `feat: add profile bios`.

---

### Task 8: Public badge gallery and detail dialog

**Files:**
- Create: `profile-badges.js`
- Modify: `profile.html`, `profile.js`, profile stylesheet, `scripts/test-profile-badges-surface.mjs`.

- [ ] **Step 1: Add failing tests** for `Badges`, four-item preview, featured-first ordering, `View all badges`, badge artwork, name/description/earned date detail dialog, fallback artwork, and blocked suppression.
- [ ] **Step 2: Run** profile surface test; expect FAIL.
- [ ] **Step 3: Implement renderer** using `previewEarnedBadges`/`sortEarnedBadges`; use DOM text APIs for names/descriptions; ignore missing definitions; fallback invalid images to local AnonChat artwork.
- [ ] **Step 4: Run** profile surface + render-policy + protected-metadata tests; expect PASS.
- [ ] **Step 5: Commit** `feat: show earned profile badges`.

---

### Task 9: Admin badge definitions and milestone configuration

**Files:**
- Create: `admin-badges.js`
- Modify: `admin.html`, `admin.css`, existing admin bootstrap, `scripts/test-admin-badges-surface.mjs`.

- [ ] **Step 1: Add failing tests** for badge type name, description, artwork URL, category, active state, `automatic/manual`, supported metric selector, threshold input, edit/deactivate controls.
- [ ] **Step 2: Run** admin surface test; expect FAIL.
- [ ] **Step 3: Implement task-first admin section**. Manual mode disables/clears metric and threshold. Automatic mode requires a supported metric and threshold when numeric. Surface clear validation/success errors.
- [ ] **Step 4: Run** admin surface + existing admin policy tests; expect PASS.
- [ ] **Step 5: Commit** `feat: manage automatic badge definitions`.

---

### Task 10: Admin assignment, removal, and featured controls

**Files:**
- Modify: `admin-badges.js`, `admin.html`, `scripts/test-admin-badges-surface.mjs`.

- [ ] **Step 1: Add failing tests** for user lookup, assignment source display, assign/remove, feature/unfeature, earned date, and max-three featured guard.
- [ ] **Step 2: Run** admin surface test; expect FAIL.
- [ ] **Step 3: Implement controls** using `badge-firestore.mjs`; preserve existing assignment on duplicate assign; show `automatic` versus admin UID/manual source.
- [ ] **Step 4: Run** admin + badge policy tests; expect PASS.
- [ ] **Step 5: Commit** `feat: manage user badge assignments`.

---

### Task 11: Full regression, cleanup, merge, and web deployment

**Files:**
- Modify/remove: temporary branch-only helper workflows/scripts as needed.
- Modify: service worker explicit cache list if new modules require it.

- [ ] **Step 1: Remove temporary patch-only workflows/helpers** that were used only to mutate the feature branch; keep permanent focused tests integrated into normal CI.
- [ ] **Step 2: Run full relevant CI** including badge policy/milestones/awards, Firestore rules, profile render/protected metadata, comments, cross-timeline interactions, follow/privacy, premium/auth, admin controls, and runtime-cost budgets.
- [ ] **Step 3: Verify PR diff** contains no billing activation, no weakened badge self-write rule, no duplicate timeline interaction counters, and no temporary workflow artifacts.
- [ ] **Step 4: Use `verification-before-completion` and `requesting-code-review`; resolve findings.**
- [ ] **Step 5: Use `finishing-a-development-branch`; merge only when required checks are green.**
- [ ] **Step 6: Deploy web using the repository’s existing deployment workflow and verify the deployed commit matches merged `main`.**

## Acceptance checklist

- Bio editing/display works with 300-character limit and safe text rendering.
- Public profiles show earned badges with four-item preview, details, featured ordering, and privacy suppression.
- All twelve approved initial badges automatically award on qualification.
- Automatic awards never duplicate or reset first `earnedAt`.
- Reversible count decreases do not remove earned achievement badges.
- Admin can configure future supported-metric milestone badges and manual badges.
- Regular users cannot self-award badges.
- Existing comments/interactions/profile/admin behavior remains green.
- Billing stays disconnected.
- Web deployment occurs only after verification passes.
