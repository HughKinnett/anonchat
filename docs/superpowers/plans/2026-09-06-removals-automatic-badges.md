# Removals and Automatic Badges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove Groups, Interest Communities, and the raw GIF URL composer path while replacing admin-authored badges with an automatic, system-owned AnonChat badge system, including active-only Premium Member status.

**Architecture:** Remove retired social-space subsystems from navigation, runtime, cache, rules, discovery, and stored data without disturbing Temporary Rooms, Premium Rooms, messaging, or canonical timeline posts. Replace mutable badge definitions with a code-owned catalog and trusted award processor; milestone badges are permanent while Premium Member is synchronized to active paid Premium status only.

**Tech Stack:** Vanilla JavaScript ES modules, Firebase Auth, Cloud Firestore, Firebase Security Rules, Firebase Hosting, GitHub Actions, existing Android TWA packaging, static badge image assets.

**Spec:** `docs/superpowers/specs/2026-09-06-removals-automatic-badges-design.md`

## Global Constraints

- Groups are removed completely from the product.
- Interest Communities are removed completely from the product.
- Existing Groups/Interest Communities records, memberships, and feature-specific records are deleted as part of the production cleanup rather than left active or hidden.
- Temporary Rooms remain unchanged.
- Premium encrypted rooms remain unchanged.
- Private messaging remains unchanged.
- The timeline raw `GIF URL` field is removed.
- Normal photo upload remains.
- Badge definitions are fixed by AnonChat code and artwork, not created or edited by admins.
- Normal earned milestone badges are automatic and immutable.
- Premium Member is a system-owned active-status badge: it is shown only while the user has an active paid Premium membership and is automatically removed when paid Premium ends.
- Admins may view badge status but cannot create, edit, assign, remove, disable, replace, or otherwise alter badge definitions or badge records.
- Users cannot self-award or alter badge records.
- Badge writes are server-controlled, deterministic, and idempotent.
- Historical GIF media already stored on posts must continue rendering.
- Android/TWA behavior must remain aligned with the web app.

---

### Task 1: Remove Groups from active product surfaces

**Files:**
- Modify: `nav-menu.js`
- Modify: `sw.js`
- Remove/retire: `groups.html`, `groups.js`, `group-detail.html`, `group-detail.js`, `group-firestore.mjs`, `group-policy.mjs`
- Remove/retire: private-group UI/controller/adapter files including `private-group-detail.js` and `private-group-firestore.mjs`
- Remove/retire: Groups-specific rule patchers including `scripts/apply-groups-rules-patch.mjs` and `scripts/apply-private-group-rules-patch.mjs`
- Modify: discovery/feed code that reads Groups, including `timeline.js` and related feed-policy modules where references remain
- Test: create `scripts/test-groups-removed.mjs`

**Interfaces:**
- Produces: no active route/navigation/cache/discovery dependency on `groups.html` or `groups/*`
- Preserves: `community.html` Temporary Rooms and `premium-rooms.html`

- [ ] **Step 1: Write failing removal contract**

Create `scripts/test-groups-removed.mjs` that reads active navigation, service worker, discovery files, and relevant routing surfaces. Assert no active product file contains links to `groups.html` or `group-detail.html`, while `community.html` and `premium-rooms.html` remain linked.

- [ ] **Step 2: Run contract and verify RED**

Run:
```bash
node scripts/test-groups-removed.mjs
```
Expected: FAIL because Groups links/cache/runtime references still exist.

- [ ] **Step 3: Remove Groups UI/runtime links**

Delete Groups entries from shared navigation and active page-specific menus. Remove Groups pages/controllers/adapters from the product tree or replace them with non-feature tombstones only if hosting compatibility requires it. Remove Groups service-worker cache entries.

- [ ] **Step 4: Remove discovery dependencies on Groups**

Update feed/discovery logic so topic/search discovery no longer queries or ranks Group documents. Keep canonical timeline post discovery intact.

- [ ] **Step 5: Run contract and syntax checks**

Run:
```bash
node scripts/test-groups-removed.mjs
node --check nav-menu.js
node --check timeline.js
node --check sw.js
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: remove groups from AnonChat"
```

### Task 2: Remove Interest Communities while preserving Temporary Rooms

**Files:**
- Modify: `nav-menu.js`
- Modify: `community.html`
- Modify: `sw.js`
- Remove/retire: `communities.html`, `communities.js`, `community-detail.html`, `community-detail.js`
- Remove/retire: `community-interest-firestore.mjs` and Interest Community policy/badge modules
- Remove/retire: `scripts/apply-communities-rules-patch.mjs`
- Modify: discovery/feed code that reads Interest Communities
- Test: create `scripts/test-interest-communities-removed.mjs`

**Interfaces:**
- Produces: no active route/navigation/cache/discovery dependency on `communities.html`, `community-detail.html`, or `communities/*`
- Preserves: `community.html` as the Temporary Rooms product surface

- [ ] **Step 1: Write failing removal contract**

Create a test that asserts active product surfaces contain no links to `communities.html` or `community-detail.html`, while `community.html` remains present and identified as Temporary Rooms.

- [ ] **Step 2: Run and verify RED**

Run:
```bash
node scripts/test-interest-communities-removed.mjs
```
Expected: FAIL against current navigation/cache/runtime.

- [ ] **Step 3: Remove Interest Community surfaces and adapters**

Remove Interest Communities pages/controllers/adapters, community-specific badge/moderation/poll code, service-worker cache entries, and page-level links. Do not delete `community.html` or Temporary Room lifecycle code.

- [ ] **Step 4: Remove discovery dependencies**

Update discovery to use canonical posts/topics/hashtags without reading Interest Community collections.

- [ ] **Step 5: Verify preserved Temporary Rooms**

Run:
```bash
node scripts/test-interest-communities-removed.mjs
node scripts/test-community-lifecycle.mjs
node --check community.js
```
Expected: removal test PASS and Temporary Room lifecycle PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: remove interest communities"
```

### Task 3: Remove raw GIF URL composer path without breaking historical GIF posts

**Files:**
- Modify: `timeline.html`
- Modify: `timeline.js`
- Modify: `timeline.css` if `.gif-url-control` becomes unused
- Preserve/adjust: `post-media-policy.mjs`
- Modify: `scripts/test-phase-b-ui.mjs`
- Test: create `scripts/test-gif-url-composer-removed.mjs`

**Interfaces:**
- Produces: composer with no `post-gif-url` input and no raw URL submission code
- Preserves: rendering/validation compatibility for existing media items with `{ type: "gif", url }`

- [ ] **Step 1: Write failing composer-removal test**

Assert `timeline.html` has no `post-gif-url` element or `GIF URL` label and `timeline.js` has no composer read/write path for that element. Also assert `post-media-policy.mjs` still accepts historical GIF media records.

- [ ] **Step 2: Run and verify RED**

```bash
node scripts/test-gif-url-composer-removed.mjs
```
Expected: FAIL because the current composer exposes the GIF URL input.

- [ ] **Step 3: Remove the composer control and JS path**

Remove the HTML input/label, related DOM binding, submission branch, and copy telling users to use a GIF URL field. Keep ordinary photo upload unchanged.

- [ ] **Step 4: Preserve historical GIF rendering contract**

Do not remove `gif` from existing post media normalization/validation where it is needed to render already-saved posts.

- [ ] **Step 5: Run UI/media regression tests**

```bash
node scripts/test-gif-url-composer-removed.mjs
node scripts/test-post-media-policy.mjs
node scripts/test-phase-b-ui.mjs
node --check timeline.js
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add timeline.html timeline.js timeline.css post-media-policy.mjs scripts/test-gif-url-composer-removed.mjs scripts/test-phase-b-ui.mjs
git commit -m "refactor: remove raw GIF URL composer"
```

### Task 4: Replace mutable badge definitions with fixed AnonChat catalog and artwork

**Files:**
- Create/replace: `badge-catalog.mjs`
- Create/replace: `badge-milestone-policy.mjs`
- Add: production badge assets under the existing public/static asset directory
- Modify: `badge-firestore.mjs` as needed for catalog-backed reads
- Test: create/update `scripts/test-badge-catalog.mjs`
- Test: create/update `scripts/test-badge-assets.mjs`
- Test: create/update `scripts/test-badge-milestone-policy.mjs`

**Interfaces:**
- Produces: `badgeDefinition(id) -> object|null`
- Produces: `eligibleBadgeIds(metrics) -> string[]`
- Produces: `nextUnearnedBadgeIds({ metrics, earnedIds }) -> string[]`
- Catalog families: Early Member, Early Supporter, Verified Admin, Verified Moderator, Top Contributor, Popular Post Creator, Community Helper, Long-Time Member, Premium Member, Special Achievement
- Tier names for repeatable milestones: Spark, Pulse, Beacon, Legend

- [ ] **Step 1: Write failing fixed-catalog tests**

Assert exactly the approved families exist; normal milestone definitions are code-owned; each definition includes stable id, name, description, asset path, accessible text, rule kind, and tier/status metadata.

- [ ] **Step 2: Write failing artwork coverage test**

Assert every catalog definition points to an existing production asset and that the asset set follows unique stable filenames.

- [ ] **Step 3: Run and verify RED**

```bash
node scripts/test-badge-catalog.mjs
node scripts/test-badge-assets.mjs
node scripts/test-badge-milestone-policy.mjs
```
Expected: FAIL until the fixed catalog/assets/policy are present.

- [ ] **Step 4: Implement fixed catalog**

Use the approved AnonChat visual direction: dark/navy base, neon purple/electric blue accents, selective gold for prestige, original iconography, large readable collectible emblems.

- [ ] **Step 5: Implement pure milestone evaluation**

Keep Firestore access out of `badge-milestone-policy.mjs`; feed it trusted normalized metrics and return eligible/new badge IDs deterministically.

- [ ] **Step 6: Run focused tests**

```bash
node scripts/test-badge-catalog.mjs
node scripts/test-badge-assets.mjs
node scripts/test-badge-milestone-policy.mjs
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add badge-catalog.mjs badge-milestone-policy.mjs badge-firestore.mjs scripts/test-badge-catalog.mjs scripts/test-badge-assets.mjs scripts/test-badge-milestone-policy.mjs <badge-assets>
git commit -m "feat: add fixed AnonChat badge catalog"
```

### Task 5: Make admin badge access read-only and profiles catalog-backed

**Files:**
- Modify: `admin-badges.js`
- Modify: admin HTML/CSS containing badge controls
- Modify: `profile-badges.js`
- Modify: profile integration HTML/CSS/JS as needed
- Modify: `admin-dashboard-policy.mjs` if badge mutation policy exists there
- Test: update `scripts/test-admin-badges-surface.mjs`
- Test: create/update `scripts/test-profile-badge-collection.mjs`
- Test: update `scripts/test-phase-a-profile-surface.mjs`

**Interfaces:**
- Admin produces: read-only earned/status badge viewer only
- Profile produces: visible badge artwork, preview row, `View all badges`, detail view with image/name/meaning/date

- [ ] **Step 1: Rewrite admin surface contract**

Assert create/edit/upload/assign/remove/disable/feature controls are absent and no mutation function is callable from the admin badge controller.

- [ ] **Step 2: Write profile collection/detail contract**

Assert actual badge images render, preview is visible, `View all badges` appears when needed, and click/tap opens a detail view containing badge image, name, meaning, and earned date.

- [ ] **Step 3: Run and verify RED**

```bash
node scripts/test-admin-badges-surface.mjs
node scripts/test-profile-badge-collection.mjs
```
Expected: FAIL against current admin-authoring UI/legacy profile behavior.

- [ ] **Step 4: Remove admin mutation controls and handlers**

Delete badge definition creation/editing, artwork selection/upload, assignment, removal, disable, and feature-management code. Keep only read-only visibility required for support/moderation context.

- [ ] **Step 5: Render profile badges from fixed catalog**

Resolve stored badge IDs through `badgeDefinition(id)` and render the approved artwork. Provide a safe legacy fallback for existing unknown badge IDs without exposing admin editing.

- [ ] **Step 6: Run profile/admin tests and syntax checks**

```bash
node scripts/test-admin-badges-surface.mjs
node scripts/test-profile-badge-collection.mjs
node scripts/test-phase-a-profile-surface.mjs
node --check admin-badges.js
node --check profile-badges.js
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add admin-badges.js admin.html admin.css admin-dashboard-policy.mjs profile-badges.js profile.html profile.css profile.js scripts/test-admin-badges-surface.mjs scripts/test-profile-badge-collection.mjs scripts/test-phase-a-profile-surface.mjs
git commit -m "feat: make badges automatic and admin read-only"
```

### Task 6: Enforce system-only badge writes and active-only Premium Member

**Files:**
- Create/modify: `badge-award-service.mjs`
- Create/modify: `badge-metrics-policy.mjs`
- Create/modify: trusted badge processor script/workflow using the repo's current server/admin execution model
- Modify: `firestore.rules`
- Test: update `scripts/test-badge-firestore-rules.mjs`
- Test: create/update `scripts/test-badge-award-service.mjs`
- Test: create `scripts/test-premium-badge-status.mjs`

**Interfaces:**
- Produces: `awardEligibleBadges(db, uid, metrics) -> Promise<{ awardedIds }>` for permanent milestone badges
- Produces: `syncPremiumMemberBadge(db, uid, { premiumActive }) -> Promise<{ active: boolean }>`
- Premium synchronization: create/activate while `premiumActive === true`; remove/deactivate when false

- [ ] **Step 1: Write failing security tests**

Assert ordinary users and admins cannot create/update/delete badge records or definitions through client Firestore rules.

- [ ] **Step 2: Write failing Premium status tests**

Cover inactive→active, active→active idempotency, active→inactive removal, and inactive→inactive no-op. Verify admin/user callers cannot perform the mutation path.

- [ ] **Step 3: Run and verify RED**

```bash
node scripts/test-badge-firestore-rules.mjs
node scripts/test-badge-award-service.mjs
node scripts/test-premium-badge-status.mjs
```
Expected: FAIL until system-only writes and status synchronization are implemented.

- [ ] **Step 4: Implement trusted permanent milestone writer**

Use idempotent create/merge behavior for normal milestone awards. Never delete normal earned milestones.

- [ ] **Step 5: Implement Premium status synchronizer**

Use verified paid Premium state as the only authority. Ensure ending paid Premium removes/deactivates the Premium Member badge without affecting other badges.

- [ ] **Step 6: Remove admin/client badge mutation permissions from Firestore rules**

Preserve approved read/privacy behavior while rejecting all client-side definition and earned/status badge mutations.

- [ ] **Step 7: Run Firestore and badge suites**

```bash
node scripts/test-badge-firestore-rules.mjs
node scripts/test-badge-award-service.mjs
node scripts/test-premium-badge-status.mjs
npm run test:firestore-ci
```
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add badge-award-service.mjs badge-metrics-policy.mjs firestore.rules scripts/test-badge-firestore-rules.mjs scripts/test-badge-award-service.mjs scripts/test-premium-badge-status.mjs <badge-processor-files>
git commit -m "security: enforce automatic badge ownership"
```

### Task 7: Remove retired Firestore rules and prepare controlled data cleanup

**Files:**
- Modify: `firestore.rules`
- Create: `scripts/cleanup-retired-social-spaces.mjs`
- Test: create `scripts/test-retired-social-space-rules.mjs`
- Test: create `scripts/test-retired-social-space-cleanup-policy.mjs`

**Interfaces:**
- Cleanup scope: top-level `groups` and `communities` collections plus their nested records only
- Must not touch: Temporary Rooms, private messages, Premium rooms, profiles, canonical timeline posts, unrelated user data

- [ ] **Step 1: Write failing rule-removal test**

Assert active Firestore rules contain no allow blocks for `groups/{...}` or Interest `communities/{...}` operations.

- [ ] **Step 2: Write cleanup-scope policy test**

Test the cleanup script's collection allowlist is exactly `groups` and `communities` and that protected collection names cannot be passed through generic input.

- [ ] **Step 3: Run and verify RED**

```bash
node scripts/test-retired-social-space-rules.mjs
node scripts/test-retired-social-space-cleanup-policy.mjs
```
Expected: FAIL before rules cleanup/script creation.

- [ ] **Step 4: Remove retired rule blocks and patcher dependencies**

Delete Groups/Interest Communities-specific rule functions/matches that no longer serve another feature.

- [ ] **Step 5: Implement narrowly scoped admin cleanup script**

The script recursively deletes only `groups/*` and `communities/*` data, supports a dry-run/report mode, and refuses arbitrary collection names.

- [ ] **Step 6: Run rule/cleanup/full Firestore tests**

```bash
node scripts/test-retired-social-space-rules.mjs
node scripts/test-retired-social-space-cleanup-policy.mjs
npm run test:firestore-ci
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add firestore.rules scripts/cleanup-retired-social-spaces.mjs scripts/test-retired-social-space-rules.mjs scripts/test-retired-social-space-cleanup-policy.mjs
git commit -m "security: retire groups and communities data paths"
```

### Task 8: Full regression, PR, deployment, cleanup, and production verification

**Files:**
- Modify: CI workflow(s) only as necessary to include new removal/badge contracts
- Modify: Android/TWA package/navigation/cache metadata if it contains Groups/Interest Communities references
- Verify: `.github/workflows/deploy-firebase.yml`

**Interfaces:**
- Produces: merged and deployed web release with retired features inaccessible and automatic badges live
- Produces: post-deploy Groups/Communities data cleanup

- [ ] **Step 1: Run all focused contracts**

```bash
node scripts/test-groups-removed.mjs
node scripts/test-interest-communities-removed.mjs
node scripts/test-gif-url-composer-removed.mjs
node scripts/test-badge-catalog.mjs
node scripts/test-badge-assets.mjs
node scripts/test-badge-milestone-policy.mjs
node scripts/test-admin-badges-surface.mjs
node scripts/test-profile-badge-collection.mjs
node scripts/test-badge-firestore-rules.mjs
node scripts/test-badge-award-service.mjs
node scripts/test-premium-badge-status.mjs
node scripts/test-retired-social-space-rules.mjs
node scripts/test-retired-social-space-cleanup-policy.mjs
```
Expected: PASS.

- [ ] **Step 2: Run preserved-feature and full regression suites**

```bash
node scripts/test-community-lifecycle.mjs
node scripts/test-post-media-policy.mjs
node scripts/test-phase-b-ui.mjs
node scripts/test-phase-a-profile-surface.mjs
npm run test:firestore-ci
```
Expected: PASS.

- [ ] **Step 3: Verify Android/TWA parity references**

Search Android/package/static cache metadata for `groups.html`, `communities.html`, and related routes. Remove any remaining product navigation/cache references while preserving Temporary Rooms and Premium Rooms.

- [ ] **Step 4: Open PR and wait for CI evidence**

Create a PR from `remove-groups-communities-auto-badges` to `main`. Do not merge until all required checks pass on the exact head commit.

- [ ] **Step 5: Merge exact verified head**

Use expected-head-SHA protection when merging so concurrent branch movement cannot bypass verification.

- [ ] **Step 6: Verify Firebase deployment for the merge commit**

Confirm the production deploy workflow succeeds for the exact merged `main` SHA, including Hosting and Firestore rules.

- [ ] **Step 7: Run dry-run cleanup report against production**

Execute `scripts/cleanup-retired-social-spaces.mjs --dry-run` using the trusted admin execution path. Confirm only Groups/Interest Communities documents are targeted.

- [ ] **Step 8: Execute permanent retired-data cleanup**

Run the same cleanup without dry-run only after the deployed app/rules no longer depend on those collections.

- [ ] **Step 9: Verify production state**

Confirm no Groups/Interest Communities navigation or active routes remain, Temporary Rooms/Premium Rooms still work, GIF URL is absent, badges render with production artwork, admin badge controls are read-only, and Premium Member appears/disappears with paid status.

- [ ] **Step 10: Record final production SHA and deployment evidence**

Report the exact merge SHA, CI results, deployment run result, and cleanup result to the user.
