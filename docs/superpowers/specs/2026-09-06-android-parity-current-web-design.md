# Android Parity with Current Web Design

## Goal
Bring the Android package to parity with the currently deployed AnonChat web application without duplicating web features as native Android implementations.

## Architecture
AnonChat Android remains a Trusted Web Activity (TWA) that opens the production origin `https://anonchatlogin.web.app/`. The hosted web application remains the single source of truth for product UI and behavior. Native Android changes are limited to wrapper-level responsibilities such as permissions, Digital Asset Links/TWA verification, navigation/deep-link behavior, packaging/versioning, and Android-specific compatibility gaps revealed by tests.

## Product decisions
- Keep the existing TWA architecture.
- Do not create native Android duplicates of profiles, badges, messaging, settings, moderation, discovery, or timeline functionality.
- Treat the current production web build on `main` as the canonical Android product surface.
- Verify all recently deployed web features work in Android standalone/TWA mode.
- Patch only genuine Android-specific gaps.
- Produce a new installable APK and Google Play AAB after parity verification.

## Web features that must be present in Android through the TWA
The Android package must expose the current production web behavior, including:
- fixed automatic AnonChat badge catalog and artwork;
- Founder and Founding Member badges;
- profile badge preview, View all collection, badge details, and earned date/status;
- badge privacy using `profilePrivacy.showBadges`, including owner-only hidden-state indication;
- removal of the admin Member badge status lookup;
- system-owned immutable milestone badges and read-only admin badge catalog;
- Premium Member badge visible only while active paid Premium is present;
- current-user badge reconciliation/backfill behavior;
- private-message Send/E2EE readiness fix;
- returning-user sign-in persistence fallback;
- Groups and Interest Communities removed;
- Temporary Rooms and Premium Rooms retained;
- raw GIF URL composer input removed while historical GIF rendering remains supported;
- current settings, notification preferences, accessibility/appearance, moderation, reporting, blocking, timeline, discovery, and messaging behavior already delivered by the hosted site.

## Android-specific parity checks
### Trusted Web Activity origin
- `MainActivity` remains a TWA/LauncherActivity implementation.
- The launch URL remains the production AnonChat origin.
- No alternate stale test/staging origin may be used in release packaging.
- `.well-known/assetlinks.json` and Android package/signing identity remain compatible with the TWA relationship.

### Standalone/responsive UI
Verify that standalone/TWA media queries do not hide or break:
- profile Badges section and View all control;
- badge privacy checkbox/control;
- badge collection/detail dialogs;
- private-message composer and Send button;
- sign-in form/button;
- Settings and appearance/accessibility controls;
- photo upload controls;
- notification permission/enable surfaces;
- navigation after Groups/Communities removal.

All controls must retain the same AnonChat button/input styling as the web application; Android-specific CSS must not introduce mismatched controls.

### Authentication and storage
- Returning-user sign-in must preserve the web fallback order: local persistence, session persistence, then in-memory persistence only when browser-backed persistence is unavailable.
- Signup must continue to require browser-backed persistence.
- TWA/Chrome storage behavior must not block the sign-in submit flow.

### Messaging and E2EE
- Timeline/session bootstrap must publish the signed-in user E2EE identity through the hosted web code.
- Private-message Send readiness must run inside TWA without native duplication.
- A missing recipient E2EE public identity must produce the hosted web readiness message instead of a non-responsive Send button.
- Existing accepted private-message conversations, reactions, replies, typing, delete/unsend, request privacy, and lifecycle behavior remain web-owned.

### Uploads and permissions
- Photo/file upload must continue through the web/TWA file picker.
- Do not add a native GIF URL flow.
- Do not add unnecessary Android permissions solely to mirror web features.
- Only add or adjust native permissions if parity tests prove a real Android requirement.

### Notifications and deep links
- Verify existing notification/deep-link behavior in the Android/TWA shell.
- Do not introduce a second native notification data model if the current hosted push/TWA path works.
- If a genuine wrapper-level deep-link or notification routing defect is reproduced, fix it at the narrowest Android boundary.

## Release/versioning
- Advance Android `versionCode` and `versionName` for the parity release.
- Keep package ID `com.anonchat.app`.
- Build both an installable APK and Play Store AAB from the verified commit.
- Update Android documentation to state the parity model and the new release version.

## Testing
Add or update Android contract tests to verify:
- TWA architecture and production launch URL;
- no native duplicate implementation of current web feature surfaces;
- current Android version is advanced;
- package ID and Digital Asset Links contract remain valid;
- relevant standalone/TWA CSS does not hide profile badges, badge privacy, login, private-message Send, Settings, or upload controls;
- retired Groups/Interest Communities are not exposed through Android-visible navigation;
- Temporary Rooms and Premium Rooms remain reachable through hosted navigation;
- Android release still contains no unapproved Play Billing or Stripe SDK dependency;
- APK and AAB build successfully.

Run current web regressions that protect shared behavior where useful, plus the Android build workflow on the feature branch before merge.

## Deployment and packaging
1. Implement Android-specific parity tests first.
2. Patch only reproduced Android wrapper/standalone gaps.
3. Advance Android package version and update docs.
4. Run Android parity tests and relevant shared regressions.
5. Build APK and AAB on the feature branch.
6. Merge only a verified head to `main`.
7. Verify the `Build Android` workflow succeeds on the merged `main` commit.
8. Verify normal Firebase/web deployment remains unaffected by Android-only wrapper changes.

## Non-goals
- No native rewrite of AnonChat web features.
- No duplicate native badge/profile/messaging/settings data layer.
- No Google Play Billing or Stripe Android SDK addition as part of parity.
- No unrelated Android UI redesign.
- No reintroduction of Groups, Interest Communities, or the GIF URL composer.
