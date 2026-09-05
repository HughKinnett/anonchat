# Phase A Profiles + Identity + Privacy + Badges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish and deploy Phase A by extending the existing badge/profile subsystem with pinned posts, canonical profile sharing, QR profile cards, granular profile privacy, admin health/emergency controls, and Android Trusted Web Activity parity.

**Architecture:** Preserve the existing badge engine and canonical post/profile data model. Add focused policy/helper modules for privacy, pinning, and profile sharing, then consume them from `profile.js`/existing post rendering rather than creating duplicate profile-post data. Android remains a Trusted Web Activity over the production web app, so parity is achieved through the same responsive web UI/data contracts plus verified TWA share behavior and Android packaging.

**Tech Stack:** Vanilla HTML/CSS/JavaScript modules, Firebase Auth, Cloud Firestore, existing AnonChat policy/helper modules, Node `.mjs` regression scripts, service worker/PWA assets, Android Trusted Web Activity (`LauncherActivity`), Gradle, GitHub Actions/Firebase hosting workflows.

**Spec:** `docs/superpowers/specs/2026-09-05-profiles-badges-design.md`

## Global Constraints

- No follower-approval/private-account subsystem in Phase A.
- `profilePrivacy` has exactly `showPosts`, `showBadges`, `showFollowersFollowing`, and `showActivity`; all default to `true`.
- Blocking overrides profile privacy visibility.
- Owners may always see their own hidden sections with a hidden/private indicator.
- A user may pin at most one of their own posts through `users/{uid}.pinnedPostId`.
- A hidden post feed also hides the pinned post from other users.
- Share and QR use exactly the same canonical public profile URL and contain no session/private tokens.
- Achievement badges remain separate from the live membership/Premium indicator.
- A profile may feature at most 3 badges; collapsed badge preview shows at most 4.
- Existing automatic badge awards remain idempotent and preserve first `earnedAt`.
- Regular users may not self-award or mutate badge definitions.
- Android must not create a second profile data model; TWA uses the deployed web experience.
- Phase B does not begin until Phase A web deployment and Android build/package verification succeed.

---

## File structure

**Create or extend focused modules**
- `profile-privacy-policy.mjs` — normalize defaults and resolve viewer visibility.
- `profile-pinning.mjs` — validate/normalize pinned post ownership and mutation intent.
- `profile-share.mjs` — canonical profile URL builder and safe share/QR payload helpers.
- `profile-qr.js` — QR-card controller/render integration using a local/browser QR implementation already allowed by the project; no tracking service.
- `scripts/test-profile-privacy-policy.mjs` — privacy/default/block/owner cases.
- `scripts/test-profile-pinning.mjs` — pin/unpin/replacement/ownership/stale-reference cases.
- `scripts/test-profile-share-contract.mjs` — canonical URL, QR equality, token-leak prevention, share fallback contract.
- `scripts/test-phase-a-profile-surface.mjs` — web surface contract for controls/sections/labels.
- `scripts/test-phase-a-android-contract.mjs` — TWA/manifest/production-web parity contract.

**Modify existing implementation**
- `profile.html`, `profile.js`, relevant profile CSS — privacy-aware sections, pinned post area, share/QR controls, badge details/presentation.
- existing owner profile/settings surface (`timeline.html`, `upload.js`, or current profile editor modules found during execution) — privacy toggles and pin controls.
- canonical post renderer/action module(s) — owner-only Pin/Unpin action without duplicated post documents.
- `firestore.rules` — owner-only profile privacy/pin writes and privacy-aware access where direct subcollection reads require it.
- `profile-badges.js`, `badge-policy.mjs`, `badge-firestore.mjs`, `admin-badges.js` — preserve existing badge behavior and close any Phase A presentation/admin gaps.
- `admin.html`, `admin.css`, `admin-dashboard-policy.mjs` and existing admin bootstrap — subsystem health/status and safe Phase A emergency feature switches.
- `sw.js` / cache manifest if new client modules are explicitly cached.
- `.github/workflows/build-android.yml` and/or existing deployment workflow only if tests/build wiring needs permanent Phase A checks.
- `android/app/src/main/java/com/anonchat/app/MainActivity.java` only if TWA/native share verification reveals a required Android-side bridge; otherwise leave it unchanged.

---

### Task 1: Baseline the existing badge/profile subsystem

**Files:**
- Read/verify: `profile-badges.js`, `badge-policy.mjs`, `badge-firestore.mjs`, `badge-awards.mjs`, `badge-award-processor.mjs`, `badge-milestones.mjs`, `admin-badges.js`, current badge/profile tests.
- Modify only if a baseline regression is broken.

**Interfaces:**
- Produces a known-green baseline for existing badges before privacy/pinning changes.

- [ ] **Step 1: Run existing badge/profile tests** including badge policy, milestone, award, Firestore-rules, profile-badge, and admin-badge suites.
- [ ] **Step 2: Record any current failure as pre-existing** and fix only if it blocks Phase A or violates the approved spec.
- [ ] **Step 3: Verify existing automatic awards are idempotent and profile badge preview/detail behavior still matches the current implementation.**
- [ ] **Step 4: Commit only if baseline repair was necessary** with `fix: restore phase A badge baseline`.

---

### Task 2: Add granular profile privacy policy

**Files:**
- Create: `profile-privacy-policy.mjs`
- Create: `scripts/test-profile-privacy-policy.mjs`
- Modify: `firestore.rules`
- Modify: existing user/profile normalization helper if one is canonical.

**Interfaces:**
- Produces: `DEFAULT_PROFILE_PRIVACY`, `normalizeProfilePrivacy(value)`, `resolveProfileVisibility({ ownerUid, viewerUid, blocked, privacy })`.
- Returns booleans for `posts`, `badges`, `followersFollowing`, `activity`, plus `ownerView`.

- [ ] **Step 1: Write failing tests** asserting missing/partial maps normalize to all `true`, explicit `false` is preserved, owner sees all four sections, and `blocked=true` hides protected sections for non-owner viewers.
- [ ] **Step 2: Run** `node scripts/test-profile-privacy-policy.mjs`; expect FAIL/module missing.
- [ ] **Step 3: Implement pure normalization/visibility policy** with no DOM or Firestore dependency.
- [ ] **Step 4: Extend Firestore rules tests** so only the document owner can mutate `profilePrivacy` and unsupported keys/types are rejected.
- [ ] **Step 5: Run policy + Firestore rules tests; expect PASS.**
- [ ] **Step 6: Commit** `feat: add granular profile privacy policy`.

---

### Task 3: Add owner privacy controls and enforce profile visibility

**Files:**
- Modify: `profile.html`, `profile.js`, relevant profile/settings HTML/CSS/JS.
- Modify: `profile-badges.js` and follower/activity rendering entry points as needed.
- Create/modify: `scripts/test-phase-a-profile-surface.mjs`.

**Interfaces:**
- Consumes: `normalizeProfilePrivacy`, `resolveProfileVisibility`.

- [ ] **Step 1: Add failing surface assertions** for four labeled owner toggles, hidden/private owner indicators, and privacy gates around posts, badges, followers/following, and activity.
- [ ] **Step 2: Implement privacy settings UI** with optimistic switch update only after successful write; on write failure restore the previous switch state and show a concise error.
- [ ] **Step 3: Gate every affected profile section** through the shared visibility result rather than ad hoc booleans.
- [ ] **Step 4: Ensure blocked/unavailable profile path short-circuits before private sections load/render.**
- [ ] **Step 5: Run surface, privacy, protected-metadata, follower, profile, and badge tests; expect PASS.**
- [ ] **Step 6: Commit** `feat: add profile privacy controls`.

---

### Task 4: Add single pinned-post policy and persistence

**Files:**
- Create: `profile-pinning.mjs`
- Create: `scripts/test-profile-pinning.mjs`
- Modify: `firestore.rules`
- Modify: canonical post ownership/action helpers if needed.

**Interfaces:**
- Produces: `normalizePinnedPostId(value)`, `canPinPost({ userUid, postAuthorUid, postExists })`, and a canonical pin/unpin mutation helper.

- [ ] **Step 1: Write failing tests** for owner-only pin, rejection of another user's post, null/unpin, replacement, and stale/missing post behavior.
- [ ] **Step 2: Run** `node scripts/test-profile-pinning.mjs`; expect FAIL/module missing.
- [ ] **Step 3: Implement pure pin policy and persistence helper** writing only `users/{uid}.pinnedPostId`.
- [ ] **Step 4: Extend rules tests** so only the owner can change the field and the client cannot mutate unrelated protected user fields in the same update.
- [ ] **Step 5: Run pin + rules tests; expect PASS.**
- [ ] **Step 6: Commit** `feat: add profile pinning policy`.

---

### Task 5: Add pin/unpin post UI and canonical pinned rendering

**Files:**
- Modify: canonical post action menu/renderer module(s).
- Modify: `profile.html`, `profile.js`, relevant CSS.
- Modify: `scripts/test-phase-a-profile-surface.mjs` and cross-timeline interaction tests.

**Interfaces:**
- Consumes: pin helper and existing canonical post renderer.

- [ ] **Step 1: Add failing tests** requiring `Pin to profile`/`Unpin from profile` only for the owner, a visible `Pinned` label, and use of the same post ID/source as every other timeline.
- [ ] **Step 2: Implement owner action** that replaces the old pin atomically at the user-document level.
- [ ] **Step 3: Load the pinned post before the ordinary profile feed** and render it with the existing canonical post renderer/interactions.
- [ ] **Step 4: Suppress the pinned post for visitors when `showPosts=false`; owner still sees it with hidden/private indication.**
- [ ] **Step 5: Ignore stale/deleted pinned references without blocking profile load.**
- [ ] **Step 6: Run pin, profile surface, comments, reactions, and cross-timeline interaction-consistency tests; expect PASS.**
- [ ] **Step 7: Commit** `feat: add pinned profile posts`.

---

### Task 6: Add canonical profile sharing

**Files:**
- Create: `profile-share.mjs`
- Create: `scripts/test-profile-share-contract.mjs`
- Modify: `profile.html`, `profile.js`.

**Interfaces:**
- Produces: `buildCanonicalProfileUrl(profileId, baseUrl)`, `buildProfileShareData(...)`, `shareProfile(...)`.

- [ ] **Step 1: Write failing contract tests** that share URL equals the canonical profile route, contains no auth/session query data, and falls back to clipboard when `navigator.share` is unavailable/rejected.
- [ ] **Step 2: Run** share test; expect FAIL/module missing.
- [ ] **Step 3: Implement canonical URL/share-data helper** using the existing public profile route format discovered in `profile.js`/routing.
- [ ] **Step 4: Add a visible Share profile action** and concise success/error feedback.
- [ ] **Step 5: Verify Web Share API path is compatible with Chrome/TWA so Android opens the native share sheet without a second Android-only share implementation.**
- [ ] **Step 6: Run share + profile surface tests; expect PASS.**
- [ ] **Step 7: Commit** `feat: add profile sharing`.

---

### Task 7: Add AnonChat QR profile card

**Files:**
- Create: `profile-qr.js`
- Modify: `profile.html`, profile CSS, `profile.js`.
- Modify: `scripts/test-profile-share-contract.mjs`, `scripts/test-phase-a-profile-surface.mjs`.
- Modify: `sw.js` if the QR module/library is explicitly cached.

**Interfaces:**
- Consumes: `buildCanonicalProfileUrl`.
- QR payload must equal the share URL byte-for-byte.

- [ ] **Step 1: Add failing tests** for QR action/modal, payload equality, no tracking URL, close behavior, and fallback error that leaves normal sharing usable.
- [ ] **Step 2: Select/use a local client-side QR renderer** already present or add a small vendored/permitted dependency in-repo; do not call a third-party tracking service.
- [ ] **Step 3: Render an AnonChat-branded QR card** with profile identity allowed by the current model and `Scan to view profile` copy.
- [ ] **Step 4: Ensure modal works responsively on desktop/mobile/TWA and supports close control plus existing modal keyboard/outside-click behavior where applicable.**
- [ ] **Step 5: Run share/QR, service-worker, and mobile-layout tests; expect PASS.**
- [ ] **Step 6: Commit** `feat: add profile QR cards`.

---

### Task 8: Finish badge presentation under privacy controls

**Files:**
- Modify: `profile-badges.js`, `profile.html`, profile CSS, `scripts/test-profile-badges-surface.mjs` / equivalent existing test.

**Interfaces:**
- Consumes current badge definitions/assignments and `showBadges` visibility.

- [ ] **Step 1: Add/confirm failing assertions** for featured-first ordering, maximum four preview badges, `View all badges`, artwork prominence, detail image/name/description/earned date, and privacy hiding.
- [ ] **Step 2: Preserve existing automatic/manual award logic**; modify only presentation and visibility gaps.
- [ ] **Step 3: Ensure invalid/missing artwork uses local AnonChat fallback and missing definitions do not break the profile.**
- [ ] **Step 4: Confirm no empty public badge section is shown when zero badges or `showBadges=false`; owner gets a useful private/empty state.**
- [ ] **Step 5: Run badge/profile/privacy tests; expect PASS.**
- [ ] **Step 6: Commit** `feat: finish private-aware badge profiles`.

---

### Task 9: Add Phase A admin health and emergency controls

**Files:**
- Modify: `admin.html`, `admin.css`, `admin-dashboard-policy.mjs`, existing admin bootstrap/controller, `admin-badges.js`.
- Modify/create: relevant admin policy/surface tests.

**Interfaces:**
- Feature switches: badge-awarding enabled, profile-pin mutations enabled, profile-QR enabled.
- Health views expose counts/status, not hidden user content.

- [ ] **Step 1: Add failing admin tests** for Phase A subsystem status cards and safe feature-switch controls.
- [ ] **Step 2: Reuse existing admin feature-flag/health conventions** rather than inventing a second config store.
- [ ] **Step 3: Wire badge-award switch into award processing; pin switch into pin mutation; QR switch into QR UI only.**
- [ ] **Step 4: Ensure disabling a switch is reversible and does not delete existing badge/pin/profile data.**
- [ ] **Step 5: Verify normal admin badge create/edit/assign/remove/feature controls remain intact.**
- [ ] **Step 6: Run admin dashboard, badge, rules, and authorization tests; expect PASS.**
- [ ] **Step 7: Commit** `feat: add phase A admin controls`.

---

### Task 10: Verify Android/TWA parity

**Files:**
- Create: `scripts/test-phase-a-android-contract.mjs`
- Verify/modify only if needed: `android/app/src/main/AndroidManifest.xml`, `android/app/src/main/java/com/anonchat/app/MainActivity.java`, `android/app/build.gradle`, `.well-known/assetlinks.json`, `.github/workflows/build-android.yml`.

**Interfaces:**
- Production TWA opens the same deployed profile routes and inherits responsive Phase A UI.

- [ ] **Step 1: Write Android contract assertions** that the app remains a TWA/LauncherActivity wrapper, opens the production AnonChat origin, and does not contain a duplicate profile data/UI implementation.
- [ ] **Step 2: Verify responsive web Phase A controls are not hidden by standalone/TWA media queries.**
- [ ] **Step 3: Verify `navigator.share` from TWA resolves to Android native sharing on supported Chrome/TWA; keep clipboard fallback for unsupported cases.**
- [ ] **Step 4: Verify QR/profile/privacy/pinned/badge surfaces fit mobile widths using existing mobile layout tests.**
- [ ] **Step 5: Modify native Android code only if a concrete TWA integration gap is proven; otherwise retain `MainActivity` notification/secure-window behavior unchanged.**
- [ ] **Step 6: Run Android contract tests and Gradle build checks; expect PASS.**
- [ ] **Step 7: Commit** `test: verify phase A android parity` or `feat: complete phase A android parity` if native changes were required.

---

### Task 11: Full verification and code review

**Files:**
- Modify: permanent test/workflow wiring only as needed.
- Remove: any branch-only patch helpers not intended for production.

- [ ] **Step 1: Run all focused Phase A tests**: privacy, pinning, share/QR, badges, admin, Android contract.
- [ ] **Step 2: Run full relevant regressions**: profile, auth, followers, comments, reactions, cross-timeline interactions, messaging smoke tests, notifications, admin, Firestore rules, service worker/offline shell, mobile layout, runtime/cost budgets.
- [ ] **Step 3: Inspect diff for forbidden changes**: no billing activation, no weakened badge/self-write rules, no duplicate post copies/counters, no privacy leakage through alternate profile surfaces, no Android-only profile database.
- [ ] **Step 4: Invoke `verification-before-completion` and run its required evidence checks.**
- [ ] **Step 5: Invoke `requesting-code-review`; address all material findings and re-run affected tests.**
- [ ] **Step 6: Commit final review fixes** if any.

---

### Task 12: Merge, deploy web, build/package Android, verify, then unlock Phase B

**Files/Systems:**
- Git branch/PR, GitHub Actions, Firebase hosting deployment workflow, Android build workflow/artifacts.

- [ ] **Step 1: Invoke `finishing-a-development-branch`** and merge only after required checks are green.
- [ ] **Step 2: Verify merged `main` commit SHA** and start/use the repository's existing web deployment path.
- [ ] **Step 3: Verify Firebase/web deployment succeeded for that exact merged commit** before declaring web Phase A live.
- [ ] **Step 4: Run the existing Android build workflow for the same merged commit.**
- [ ] **Step 5: Verify workflow success and Android package artifact availability; inspect failed job logs and fix/re-run if needed.**
- [ ] **Step 6: Confirm the deployed production profile route provides all Phase A features in responsive/TWA mode.**
- [ ] **Step 7: Record Phase A as complete only after both deployment and Android build/package verification succeed.**
- [ ] **Step 8: Begin Phase B only after Step 7.**

## Acceptance checklist

- Privacy controls independently hide posts, badges, followers/following, and activity from other users.
- Owners retain visibility of their own hidden sections; blocking remains stronger than privacy flags.
- Users can pin exactly one of their own posts, unpin it, or replace it.
- Pinned rendering uses the canonical post object/interactions and disappears safely when stale/deleted.
- Profile Share and QR use exactly the same canonical public URL with no private tokens.
- Web Share works with clipboard fallback; TWA invokes Android sharing where supported.
- Badge preview/details/featured ordering are polished and privacy-aware without breaking automatic awards.
- Admins retain badge management and gain Phase A health/emergency toggles.
- No user can self-award badges or mutate another user's profile privacy/pin state.
- Android/TWA exposes the same production web Phase A UI with no duplicated profile backend.
- Full relevant regressions are green.
- Phase A web deployment succeeds.
- Phase A Android build/package succeeds.
- Phase B remains blocked until both succeed.
