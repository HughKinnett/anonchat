# Android and Cross-Platform Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the hosted AnonChat UI and Android TWA behave consistently, stop repeated encryption credential prompts on the same trusted device, fix desktop dark/contrast rendering, make profile badges reliably discoverable, and ship a refreshed APK/AAB.

**Architecture:** Keep Android as a Trusted Web Activity that renders `https://anonchatlogin.web.app/`; shared behavior changes live in the hosted web code and are verified in desktop and TWA contexts. Persist E2EE auto-unlock with a device-local Web Crypto/IndexedDB mechanism that never stores raw PINs, recovery passwords, or plaintext private keys. Profile badge visibility continues to use `profilePrivacy.showBadges` and Android receives the same UI through the TWA.

**Tech Stack:** JavaScript ES modules, Web Crypto, IndexedDB, Firebase Auth/Firestore, HTML/CSS/PWA service worker, Android Trusted Web Activity, Gradle, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-06-android-parity-current-web-design.md`

## Global Constraints

- Android remains a TWA/`LauncherActivity`; do not duplicate web feature state or UI natively.
- Production launch origin remains `https://anonchatlogin.web.app/` and package ID remains `com.anonchat.app`.
- Never persist the raw encryption PIN, recovery password, or plaintext private JWK.
- Ordinary sign-out/session teardown must not erase trusted-device auto-unlock state.
- Missing/corrupt persistent device trust falls back to the existing PIN/recovery path.
- Default pre-settings desktop appearance is dark; explicit user Light/System/Dark settings remain authoritative after loading.
- `profilePrivacy.showBadges` remains the source of truth for visitor badge visibility; the owner can always see their own badges.
- Every added or modified input, checkbox, button, dialog action, PIN/password field, badge control, and Android-visible web control must reuse the current AnonChat control/theme patterns. Do not introduce browser-default-looking fields, one-off colors, different border radii, or inconsistent hover/focus/disabled states.
- Reuse existing classes such as `primary-button`, `secondary-button`, existing form/input styling from `controls.css`, and existing dialog/profile card treatments before creating any new class.
- Do not add Google Play Billing or Stripe Android SDK dependencies.
- Do not reintroduce Groups, Interest Communities, or the raw GIF URL composer.

---

### Task 1: Trusted-device E2EE auto-unlock

**Files:**
- Create: `e2ee-device-key-store.mjs`
- Modify: `e2ee-device-store.mjs`
- Modify: `e2ee-identity.js`
- Modify: `sw.js`
- Create: `scripts/test-e2ee-auto-unlock.mjs`
- Modify: `scripts/test-e2ee-pin-session.mjs`
- Modify: `scripts/test-e2ee-pin-integration.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: existing encrypted Firebase private bundle, `createTrustedDeviceRecord`, `unlockTrustedDeviceRecord`, `importPrivateKeyJwk`, browser IndexedDB/Web Crypto.
- Produces: `saveAutoUnlockIdentity(uid, privateJwk)`, `loadAutoUnlockIdentity(uid)`, and `removeAutoUnlockIdentity(uid)` that persist only encrypted identity material plus a non-exportable device key.

- [ ] **Step 1: Write the failing auto-unlock contract**

Create `scripts/test-e2ee-auto-unlock.mjs` with assertions that the new device-key store uses IndexedDB and Web Crypto, never contains raw PIN/recovery secrets, and that `e2ee-identity.js` calls `loadAutoUnlockIdentity` before prompting and `saveAutoUnlockIdentity` after successful trust establishment.

Also assert E2EE dialogs continue to use the existing `e2ee-password-dialog` and `e2ee-password-actions` classes and that new buttons/inputs do not introduce browser-default unclassed replacements.

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `node scripts/test-e2ee-auto-unlock.mjs`

Expected: FAIL because `e2ee-device-key-store.mjs` and auto-unlock integration do not exist.

- [ ] **Step 3: Implement persistent device trust**

Create `e2ee-device-key-store.mjs` with one IndexedDB database scoped to AnonChat E2EE trust. Generate a non-exportable AES-GCM `CryptoKey`, store the `CryptoKey` directly in IndexedDB, encrypt serialized private JWK bytes with a random 96-bit IV, and store only `{ version, iv, ciphertext }` per UID. `loadAutoUnlockIdentity(uid)` decrypts and parses the JWK; missing/corrupt state returns `null` or throws a typed trust-state error that `e2ee-identity.js` catches and routes to the existing PIN/recovery flow.

In `e2ee-identity.js`, import the auto-unlock helpers. After initial setup, successful recovery, or successful PIN unlock, save the verified private JWK through `saveAutoUnlockIdentity`. Before showing the PIN dialog for an existing trusted account, attempt `loadAutoUnlockIdentity(user.uid)` and import it when valid. Do not call any removal helper from `clearE2eeSession`.

- [ ] **Step 4: Update service-worker caching and E2EE test chain**

Add `./e2ee-device-key-store.mjs` to `APP_SHELL` and bump `CACHE_NAME` from `anonchat-v135` to the next version. Add `node scripts/test-e2ee-auto-unlock.mjs` to `test:e2ee` before emulator rules.

- [ ] **Step 5: Run E2EE regression suite**

Run: `npm run test:e2ee`

Expected: PASS, including existing migration, PIN, session, crypto and Firestore rule tests.

- [ ] **Step 6: Commit Task 1**

Commit message: `feat: persist trusted-device E2EE auto unlock`

---

### Task 2: Desktop dark baseline and hamburger contrast

**Files:**
- Modify: `appearance-accessibility.css`
- Modify: `appearance-accessibility.js`
- Modify if needed: `timeline.css`
- Create: `scripts/test-desktop-dark-baseline.mjs`
- Modify: `scripts/test-appearance-accessibility-integration.mjs`

**Interfaces:**
- Consumes: `applyUserAppearance`, CSS custom properties, existing `main-menu-panel`/`menu-button` classes.
- Produces: a dark pre-settings baseline with explicit readable menu colors while preserving explicit Light theme behavior.

- [ ] **Step 1: Write the failing desktop-theme contract**

Create `scripts/test-desktop-dark-baseline.mjs` asserting the default CSS variables use the dark baseline, `body` uses `var(--ac-page-bg)`, `.main-menu-panel` explicitly uses AnonChat surface/text tokens, and `html[data-theme="light"]` still overrides the same surfaces.

Also assert menu buttons and menu-panel actions continue to inherit current AnonChat button/link styling rather than adding browser-default button rules.

- [ ] **Step 2: Run and confirm RED**

Run: `node scripts/test-desktop-dark-baseline.mjs`

Expected: FAIL on missing explicit default menu surface/foreground rules.

- [ ] **Step 3: Implement the shared CSS fix**

In `appearance-accessibility.css`, give `.topbar` and `.main-menu-panel` a default `background-color: var(--ac-surface)` and `color: var(--ac-text)` with the existing border token. Keep `html[data-theme="light"]` overrides so explicit Light remains light. Do not add desktop-only white colors or Android-only CSS.

- [ ] **Step 4: Run appearance regressions**

Run:

```bash
node scripts/test-desktop-dark-baseline.mjs
node scripts/test-appearance-accessibility-integration.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

Commit message: `fix: keep desktop shell and hamburger readable`

---

### Task 3: Badge discoverability on own and public profiles

**Files:**
- Create if useful: `profile-badge-target.mjs`
- Modify: `profile-badges.js`
- Modify: `profile-phase-a.js`
- Modify: `profile.html`
- Modify if needed: `profile-phase-a.css`
- Modify: `scripts/test-profile-badge-collection.mjs`
- Create: `scripts/test-profile-badge-target-resolution.mjs`

**Interfaces:**
- Consumes: Firebase Auth current user, optional profile `?uid=`, `listUserBadges`, fixed badge catalog, `resolveProfileVisibility`.
- Produces: deterministic effective profile UID resolution so own-profile badge loading works without requiring a `uid` query parameter.

- [ ] **Step 1: Write a failing target-resolution test**

Create `scripts/test-profile-badge-target-resolution.mjs` asserting:

```js
assert.equal(resolveBadgeProfileUid({ queryUid: "other", currentUserUid: "me" }), "other");
assert.equal(resolveBadgeProfileUid({ queryUid: "", currentUserUid: "me" }), "me");
assert.equal(resolveBadgeProfileUid({ queryUid: null, currentUserUid: null }), null);
```

Add source assertions that `profile-badges.js` waits for Auth readiness before loading an owner profile with no query UID.

- [ ] **Step 2: Run and confirm RED**

Run: `node scripts/test-profile-badge-target-resolution.mjs`

Expected: FAIL because current `profile-badges.js` only reads `?uid=`.

- [ ] **Step 3: Implement badge target resolution**

Use query UID when viewing another user; otherwise use `auth.currentUser.uid`. Keep the Badges section visible for the owner even when there are zero badges, with a themed empty-state message such as `No badges earned yet.` The existing `secondary-button`, profile card, and badge dialog treatments must remain in use.

- [ ] **Step 4: Keep visitor privacy authoritative**

Update `profile-phase-a.js` to use the same effective profile UID when no `?uid=` is supplied. Preserve `resolveProfileVisibility`: owner always sees badges; visitors see them only when `showBadges` is true and the profile is not blocked/unavailable. When private, visitor badge artwork, count/list and View all remain unavailable.

- [ ] **Step 5: Enforce theme consistency in the profile contract**

Extend `scripts/test-profile-badge-collection.mjs` to assert:
- `View all badges` and dialog close actions use `secondary-button`;
- the privacy control stays inside the current `profile-privacy-grid` styling;
- any new empty-state/action control uses existing profile/card/control classes;
- no unstyled new `<button>` or text/password input is introduced for this flow.

- [ ] **Step 6: Run badge/profile regressions**

Run:

```bash
node scripts/test-profile-badge-target-resolution.mjs
node scripts/test-profile-badge-collection.mjs
node scripts/test-profile-privacy-policy.mjs
node scripts/test-automatic-badges.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit Task 3**

Commit message: `fix: make profile badges discoverable for every viewer`

---

### Task 4: Android TWA parity contract and release refresh

**Files:**
- Create: `scripts/test-android-current-web-parity.mjs`
- Modify: `scripts/test-phase-a-android-contract.mjs`
- Modify: `scripts/test-payment-preparation-ui.mjs`
- Modify: `.github/workflows/build-android.yml`
- Modify: `android/app/build.gradle`
- Modify only if a reproduced gap requires it: `android/app/src/main/AndroidManifest.xml`
- Modify only if a reproduced gap requires it: `android/app/src/main/java/com/anonchat/app/MainActivity.java`
- Modify: `android/README.md`

**Interfaces:**
- Consumes: production TWA origin, shared profile/message/settings/login/upload UI, current web files and Digital Asset Links.
- Produces: Android release `versionCode 5`, `versionName '1.0.4'`, APK and AAB from the same shared hosted feature set.

- [ ] **Step 1: Write Android current-web parity test**

Create `scripts/test-android-current-web-parity.mjs` to verify:
- `MainActivity extends LauncherActivity` and retains `FLAG_SECURE`;
- manifest launch URL/verified host is `anonchatlogin.web.app`;
- package ID and Digital Asset Links target `com.anonchat.app`;
- no Play Billing/Stripe Android dependency;
- profile exposes badge section, View all, privacy input and dialogs;
- private-message Send readiness module, returning-user sign-in fallback, Settings, photo upload, Temporary Rooms and Premium Rooms remain in shared web assets;
- Groups/Interest Communities and GIF URL composer remain absent;
- TWA-visible controls continue to use current AnonChat classes/styles;
- Android native code does not duplicate profile/badge/messaging/settings state.

- [ ] **Step 2: Run and confirm current parity status**

Run: `node scripts/test-android-current-web-parity.mjs`

Expected: PASS for the TWA architecture and shared feature presence; any Android-specific failure becomes the only permitted reason to modify Manifest/MainActivity.

- [ ] **Step 3: Advance Android release version and update stale tests**

Change `android/app/build.gradle` to:

```gradle
versionCode 5
versionName '1.0.4'
```

Update `scripts/test-payment-preparation-ui.mjs` so the version assertions expect 5 / 1.0.4 while preserving the no-billing-SDK checks.

- [ ] **Step 4: Expand Android build workflow triggers**

Ensure `.github/workflows/build-android.yml` retriggers for shared parity files changed by this release, including E2EE device-key store/identity, appearance CSS/bootstrap, profile badge files, `controls.css`, `sw.js`, and Android files.

- [ ] **Step 5: Update Android README**

Document release `1.0.4` (`versionCode 5`), shared TWA parity, persistent trusted-device E2EE auto-unlock, profile badge parity, and that all Android-visible inputs/buttons reuse the hosted AnonChat theme.

- [ ] **Step 6: Run Android contract tests**

Run:

```bash
node scripts/test-android-current-web-parity.mjs
node scripts/test-phase-a-android-contract.mjs
node scripts/test-payment-preparation-ui.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit Task 4**

Commit message: `chore: refresh Android parity release`

---

### Task 5: Full regression, APK/AAB build, review and rollout

**Files:**
- Modify only for genuine regressions discovered by the commands below.

**Interfaces:**
- Consumes: Tasks 1-4 exact branch head.
- Produces: merge-ready verified commit, Firebase web rollout, installable APK and Play Store AAB.

- [ ] **Step 1: Run focused shared regressions**

Run:

```bash
npm run test:e2ee
node scripts/test-desktop-dark-baseline.mjs
node scripts/test-appearance-accessibility-integration.mjs
node scripts/test-profile-badge-target-resolution.mjs
node scripts/test-profile-badge-collection.mjs
node scripts/test-private-message-send-readiness.mjs
node scripts/test-login-storage-fallback.mjs
node scripts/test-android-current-web-parity.mjs
node scripts/test-phase-a-android-contract.mjs
node scripts/test-payment-preparation-ui.mjs
```

Expected: PASS.

- [ ] **Step 2: Run broad shared regressions**

Use the existing GitHub PR workflows for Phase C, Firestore rules, Removals/Badges and profile/bugfix contracts on the exact branch head. Do not merge a different SHA than the one all required checks verified.

- [ ] **Step 3: Build Android artifacts on the feature branch**

Run the `Build Android` workflow or equivalent Gradle command:

```bash
gradle assembleDebug assembleRelease bundleRelease --stacktrace
```

Expected artifacts:
- `android/app/build/outputs/apk/debug/app-debug.apk`
- `android/app/build/outputs/apk/release/app-release-unsigned.apk`
- `android/app/build/outputs/bundle/release/app-release.aab`

- [ ] **Step 4: Review the final diff**

Verify there is no native duplication of web features, no raw credential persistence, no admin badge mutation, no Groups/Interest Communities reintroduction, no GIF URL composer, no billing SDK, and no unthemed new inputs/buttons.

- [ ] **Step 5: Merge only after verification**

Move the PR out of draft only after all exact-head checks pass, then squash-merge the verified head to `main`.

- [ ] **Step 6: Verify production rollout**

Verify Firebase deployment succeeds for the merge commit and that current web behavior is live. If the idempotent existing-user badge backfill workflow is triggered or manually required, verify it completes successfully.

- [ ] **Step 7: Verify main Android build and artifacts**

Verify `Build Android` succeeds on the merged `main` commit and publishes both the APK and AAB artifacts.
