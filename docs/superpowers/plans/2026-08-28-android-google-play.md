# AnonChat Android and Google Play Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a verified AnonChat Trusted Web Activity test package and repository-backed Google Play listing materials after the web safety release is deployed.

**Architecture:** Bubblewrap generates an Android TWA for the fixed Firebase Hosting origin. Firebase serves Digital Asset Links that associate the origin with local testing and Play signing certificates; signing secrets remain outside git. The Android artifact always renders the same deployed web app, so web and Android features stay synchronized.

**Tech Stack:** Bubblewrap CLI, Gradle, JDK 17, Android SDK 36, Firebase Hosting, Trusted Web Activity, Digital Asset Links, Google Play App Bundles.

**Spec:** `docs/superpowers/specs/2026-08-28-android-google-play-design.md`

## Global Constraints

- The web safety release must be merged, deployed, and smoke-tested before the release AAB is built.
- Origin is exactly `https://anonchatlogin.web.app/`.
- Application ID is `com.hughkinnett.anonchat` unless the existing Play Console app proves another immutable ID already exists.
- Target SDK is API 36; minimum SDK is 23.
- Listing is free, United States only, and 18 and over only.
- Use a Trusted Web Activity, not a custom WebView.
- No keystore, signing password, service-account JSON, generated SDK, or private key may enter git or tool output.
- Persistent upload-key generation and Play Console submission require action-time user authorization.
- A personal account created after November 13, 2023 requires 12 continuously opted-in closed testers for at least 14 days before production access.

---

### Task 1: PWA icons, metadata, and Firebase Digital Asset Links hosting

**Files:**
- Create: `assets/icons/icon-192.png`
- Create: `assets/icons/icon-512.png`
- Create: `assets/icons/icon-maskable-512.png`
- Create: `assets/icons/play-icon-512.png`
- Create: `android-release-policy.mjs`
- Create: `scripts/write-assetlinks.mjs`
- Create: `scripts/test-android-release-policy.mjs`
- Modify: `manifest.webmanifest`
- Modify: `firebase.json`
- Modify: `sw.js`
- Modify: `package.json`

**Interfaces:**
- Produces: valid PWA/Play icons and `assetLinksDocument(packageName, fingerprints)` consumed by Task 2.

- [ ] **Step 1: Write failing metadata/policy tests**

Assert exact manifest name/short name, absolute `/` start URL and scope, standalone display, 192/512/maskable PNG purposes, app ID `/`, valid SHA-256 fingerprint normalization, exact asset-links relation, the CLI's JSON stdout, and Firebase visibility for `.well-known`.

- [ ] **Step 2: Run tests and confirm RED**

Run: `node scripts/test-android-release-policy.mjs && node scripts/test-push-service-worker.mjs`
Expected: failures for missing module/assets/manifest entries.

- [ ] **Step 3: Derive production icons from existing artwork**

Crop the existing square AnonChat artwork without inventing new branding, export true PNGs at the exact sizes, add safe maskable padding, and verify dimensions/alpha with an image metadata tool. Do not upscale a non-square crop or retain JPEG extensions.

- [ ] **Step 4: Complete hosting and cache configuration**

Allow `.well-known/**` through Firebase Hosting while explicitly excluding repository internals. Add new icons to the app shell, bump the service-worker cache from `anonchat-v39` to `anonchat-v40`, and make `/.well-known/assetlinks.json` a network-only path rather than an offline cache entry.

- [ ] **Step 5: Run tests and commit**

Run: `npm run test:android-release-policy && node scripts/test-push-service-worker.mjs && npm test`
Expected: pass.

```bash
git add assets/icons android-release-policy.mjs scripts/write-assetlinks.mjs scripts/test-android-release-policy.mjs manifest.webmanifest firebase.json sw.js package.json
git commit -m "Prepare PWA assets for Android verification"
```

### Task 2: Bubblewrap Trusted Web Activity project and debug package

**Files:**
- Create: `android/` generated Bubblewrap/Gradle project
- Create: `.well-known/assetlinks.json`
- Create: `scripts/test-android-project.mjs`
- Modify: `.gitignore`
- Modify: `package.json`

**Interfaces:**
- Consumes: deployed manifest and local debug fingerprint from Task 1.
- Produces: API-36 `com.hughkinnett.anonchat` Android project and locally installable debug APK.

- [ ] **Step 1: Write failing project-policy test**

Assert application ID, launch URL, host, version code `1`, version name `1.0.0`, min SDK 23, target SDK 36, no cleartext traffic, no location/camera/microphone/contact/storage permissions, and no committed keystore/password.

- [ ] **Step 2: Run test and confirm RED**

Run: `node scripts/test-android-project.mjs`
Expected: `android/` missing.

- [ ] **Step 3: Initialize Bubblewrap deterministically**

Run Bubblewrap against `https://anonchatlogin.web.app/manifest.webmanifest` with:

```text
applicationId=com.hughkinnett.anonchat
name=AnonChat
launcherName=AnonChat
host=anonchatlogin.web.app
startUrl=/
display=standalone
themeColor=#0b0d12
backgroundColor=#0b0d12
minSdkVersion=23
targetSdkVersion=36
versionCode=1
versionName=1.0.0
```

Accept only Bubblewrap/JDK/Android SDK downloads from the official toolchain. Keep SDK caches and generated build outputs ignored.

- [ ] **Step 4: Build and validate the debug APK**

Run the Gradle/Bubblewrap debug build, then inspect `aapt dump badging` and signing certificate output. Verify the package ID, target SDK, version, launch activity, and absence of unexpected dangerous permissions. Extract only the debug certificate's public SHA-256 fingerprint and generate `.well-known/assetlinks.json` with:

```bash
DEBUG_SHA256="$(keytool -list -v -keystore android/app/debug.keystore -storepass android -alias androiddebugkey | sed -n 's/^.*SHA256: //p' | head -n 1)"
test -n "$DEBUG_SHA256"
mkdir -p .well-known
node scripts/write-assetlinks.mjs "$DEBUG_SHA256" > .well-known/assetlinks.json
```

The generated JSON contains only the public certificate fingerprint and exact package/relation fields. Add `"test:android-project": "node scripts/test-android-project.mjs"` to `package.json`.

- [ ] **Step 5: Run tests and commit source project only**

Run: `npm run test:android-project && ./android/gradlew -p android test assembleDebug`
Expected: pass and produce an ignored debug APK.

```bash
git add android .well-known/assetlinks.json .gitignore package.json scripts/test-android-project.mjs
git commit -m "Add AnonChat Android Trusted Web Activity"
```

### Task 3: Store listing and Play policy package

**Files:**
- Create: `play/listing/en-US/title.txt`
- Create: `play/listing/en-US/short-description.txt`
- Create: `play/listing/en-US/full-description.txt`
- Create: `play/data-safety.md`
- Create: `play/content-rating.md`
- Create: `play/reviewer-access.md`
- Create: `play/release-checklist.md`
- Create: `play/graphics/feature-graphic.png`
- Create: `play/graphics/phone-screenshots/`
- Create: `scripts/test-play-listing.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: legal URLs and real deployed app from the web plan.
- Produces: exact user-reviewed copy and assets ready for Play Console entry/upload.

- [ ] **Step 1: Write failing listing tests**

Enforce title <= 30 characters, short description <= 80, full description <= 4,000, no claims of end-to-end encryption, exact legal/deletion URLs, feature graphic 1024x500, Play icon 512x512, at least two valid phone screenshots, and presence of every Data safety category named by the spec.

- [ ] **Step 2: Run test and confirm RED**

Run: `node scripts/test-play-listing.mjs`
Expected: missing listing/assets.

- [ ] **Step 3: Write accurate listing and declarations**

Describe pseudonymous social posting, private requests, temporary rooms, reporting/blocking, push notifications, and account deletion without implying guaranteed anonymity. Record free/US-only/18+, the current no-ads declaration, UGC/content-rating answers, reviewer path, and the 12-testers/14-days gate. Add `"test:play-listing": "node scripts/test-play-listing.mjs"` to `package.json`.

- [ ] **Step 4: Capture real screenshots and feature graphic**

Use the deployed app at supported phone dimensions after seeding only non-private test content. Screenshots must show sign-in, Timeline, profile/report-block controls, temporary rooms, and admin moderation only if it contains no production identities. Do not use production private messages or real user data.

- [ ] **Step 5: Run tests and commit**

Run: `npm run test:play-listing`
Expected: pass.

```bash
git add play scripts/test-play-listing.mjs package.json
git commit -m "Add Google Play listing materials"
```

### Task 4: Release signing and AAB build (authorization gate)

**Files:**
- Create outside git: dedicated upload keystore and recovery record
- Create ignored artifact: release `.aab`
- Modify: `.well-known/assetlinks.json` after Play certificate is available

**Interfaces:**
- Consumes: reviewed Android project and active Play Console account.
- Produces: signed AAB and upload certificate fingerprint; Task 5 adds the Play App Signing association.

- [ ] **Step 1: Stop for action-time authorization**

Before generating the persistent upload key, state exactly where it will be stored, that loss may block future uploads, and whether an encrypted GitHub secret will be created. Do not proceed on blanket prior approval alone.

- [ ] **Step 2: Generate the upload key without exposing secrets**

Use `keytool` with a generated strong password held outside command output. Confirm only alias, validity, and public SHA-256 certificate fingerprint. Add the keystore path and password-file pattern to `.gitignore` before creation.

- [ ] **Step 3: Build and inspect the release AAB**

Run Bubblewrap/Gradle release bundle, verify its signature and manifest, and record a SHA-256 checksum. Ensure version code is unique and target SDK is 36.

- [ ] **Step 4: Stop before browser upload/transmission**

Uploading the AAB transmits a signed artifact and changes the Play Console app. Request action-time confirmation immediately before upload if it is not already narrow and current.

### Task 5: Internal/closed testing and production handoff

**Files:**
- Modify: `.well-known/assetlinks.json`
- Modify: `play/release-checklist.md`

**Interfaces:**
- Consumes: signed AAB, active paid Play Console account, Play App Signing fingerprint, listing materials, reviewer account, and tester list.
- Produces: Internal test release, then compliant closed test and production-access application.

- [ ] **Step 1: Complete Play Console app setup**

Create/select the app with exact free/US-only/18+ settings, Restrict Minor Access, no-ads declaration, content rating, Data safety, privacy/deletion URLs, reviewer instructions, and store listing.

- [ ] **Step 2: Upload to Internal testing and run pre-launch checks**

Upload the signed AAB, resolve automated errors, install from Play, and verify TWA full-screen behavior plus all core flows.

- [ ] **Step 3: Add Play App Signing fingerprint to Digital Asset Links**

Append the public Play certificate SHA-256 fingerprint, deploy Firebase Hosting, and verify `https://anonchatlogin.web.app/.well-known/assetlinks.json` returns exact JSON without redirect. Reinstall the Play build and verify no Custom Tab bar appears.

- [ ] **Step 4: Start the required closed test**

Enroll at least 12 testers and keep them continuously opted in for at least 14 days. Collect feedback and record fixes/engagement for the production-access questionnaire.

- [ ] **Step 5: Apply for production access and publish**

After Google reports the testing requirement satisfied, submit accurate test feedback, app value, and readiness answers. Publish only to the United States after Google grants production access. Record Play's review result and live listing URL.
