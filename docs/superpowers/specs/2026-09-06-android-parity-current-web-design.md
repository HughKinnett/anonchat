# Android and Cross-Platform Parity with Current Web Design

## Goal
Bring the Android package to full parity with the currently deployed AnonChat web application while fixing the cross-platform gaps reported on desktop and mobile: repeated encryption credential prompts, desktop light-background/hamburger contrast, and badge discoverability/rendering.

## Architecture
AnonChat Android remains a Trusted Web Activity (TWA) that opens the production origin `https://anonchatlogin.web.app/`. The hosted web application remains the single source of truth for product UI and behavior. Native Android changes are limited to wrapper-level responsibilities such as permissions, Digital Asset Links/TWA verification, navigation/deep-link behavior, packaging/versioning, and Android-specific compatibility gaps revealed by tests.

Cross-platform fixes that affect both browser and Android/TWA are implemented in the shared hosted web code once, then verified in desktop browser and Android standalone/TWA contexts. Do not create native Android duplicates of web features.

## Product decisions
- Keep the existing TWA architecture.
- Do not create native Android duplicates of profiles, badges, messaging, settings, moderation, discovery, timeline, or E2EE product UI.
- Treat the current production web build on `main` as the canonical Android product surface.
- Verify all currently deployed web features work in Android standalone/TWA mode.
- Patch only genuine Android-specific wrapper gaps natively.
- Fix shared desktop/mobile defects in the hosted web implementation.
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

## Trusted-device encryption experience
### User experience
- After a user successfully enters or creates the encryption recovery password and chat PIN on a device, that same trusted device must not ask for either credential again during normal future app/browser launches.
- The no-repeat behavior applies independently per physical/browser device.
- A genuinely new device, reset browser profile, cleared site data, or corrupt trusted-device record may require recovery again.
- Signing out and later signing back into the same account on the same trusted device must not by itself destroy the trusted-device unlock state.
- The trusted-device state is scoped by user ID so one account cannot unlock another account’s encrypted identity.

### Security model
- Never store the raw chat PIN or recovery password in localStorage, IndexedDB, Firestore, Android SharedPreferences, logs, analytics, or source code.
- Preserve the existing Firestore encrypted private-key bundle as the account recovery source of truth.
- Add a device-local persistent auto-unlock mechanism using Web Crypto plus IndexedDB (or the narrowest standards-based browser storage capable of persisting a non-exportable `CryptoKey`).
- The device-local key may wrap/encrypt the private identity material needed for future automatic unlocks; the raw private JWK must not be persisted unencrypted.
- The persisted auto-unlock key must be non-exportable where the platform supports it.
- If persistent device-key storage is unavailable or fails integrity checks, fall back to the existing trusted-device PIN/recovery flow rather than weakening encryption.
- Existing PIN rate limiting remains relevant only when a PIN prompt is actually required.
- `clearE2eeSession` may clear in-memory caches but must not erase trusted-device auto-unlock state. A distinct explicit device-reset/recovery action is required to erase persisted trust.

## Desktop dark background and hamburger contrast
- Desktop/PC default surfaces must use the same dark visual baseline as mobile instead of rendering a white page background behind the app.
- The hamburger menu panel must always maintain readable foreground/background contrast on desktop and mobile.
- Default dark styling applies before asynchronous user appearance settings load, preventing a white flash or white-on-white menu state.
- Existing Appearance settings remain authoritative after they load: System/Light/Dark must still work, and an explicit user-selected Light appearance is allowed to be light.
- Premium customization fields such as `pageColor`, `menuColor`, and text colors continue to override the default only where the existing premium customization policy allows them.
- Do not solve the bug with Android-only CSS; shared desktop web must be fixed too.

## Badge discoverability and rendering
### Profile owner
- Every signed-in user profile must contain a clearly labeled `Badges` section even when the user currently has zero earned badges.
- The owner sees their currently earned badge artwork and a clear `View all badges` action when badges exist.
- The owner can always open their own badge collection regardless of `profilePrivacy.showBadges`.
- If the owner has hidden badges from others, show the owner-only `Hidden from others` indicator.
- The existing `Show badges on my profile` privacy control remains the source of truth and must match standard AnonChat input/control styling.

### Other users
- When `profilePrivacy.showBadges` is true, a visitor to another user’s profile can see the Badges section, badge preview/count, and click/tap `View all badges` to open the full public earned-badge collection.
- When `profilePrivacy.showBadges` is false, visitors must not see badge artwork, badge count, or the full collection action.
- Blocking/privacy rules continue to override public badge visibility.

### Collection/detail view
- Full collection view shows real AnonChat badge artwork, badge name, family/tier, meaning/description, requirement or status rule, and earned date when available.
- Premium Member explains that it is visible only while paid Premium is active.
- Founder, Founding Member, Early Member, Early Supporter, role badges, milestone badges, and activity badges render from the fixed catalog rather than mutable admin definitions.
- Buttons, dialogs, inputs, close actions, and privacy controls reuse existing AnonChat button/input/dialog CSS patterns; no browser-default mismatched controls.

### Existing-user data
- The existing trusted full-user badge reconciliation/backfill remains idempotent and must award all badges each current user objectively qualifies for from canonical data.
- Add verification that current users with qualifying badge records render those badges on their own profile and, when public, on another user’s view.
- If reconciliation discovers a missing earned badge, it may add the system-owned award; it may not let admins/users manually assign it.
- Premium Member remains status-bound and is removed/hidden when active paid Premium ends.

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
- Trusted-device E2EE auto-unlock storage must work in Chrome/TWA where standards-based persistent storage is available.

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
Add or update contracts to verify:
- TWA architecture and production launch URL;
- no native duplicate implementation of current web feature surfaces;
- current Android version is advanced;
- package ID and Digital Asset Links contract remain valid;
- relevant standalone/TWA CSS does not hide profile badges, badge privacy, login, private-message Send, Settings, or upload controls;
- retired Groups/Interest Communities are not exposed through Android-visible navigation;
- Temporary Rooms and Premium Rooms remain reachable through hosted navigation;
- Android release still contains no unapproved Play Billing or Stripe SDK dependency;
- same-device E2EE auto-unlock succeeds without PIN/recovery prompts after initial trust setup;
- clearing only in-memory E2EE session state does not erase device trust;
- corrupt/missing device trust falls back safely to PIN/recovery;
- no raw PIN or recovery password is persisted;
- desktop default background/hamburger menu is dark/readable before appearance settings load;
- explicit Light appearance can still become light after settings apply;
- own-profile badge rendering works for existing earned records;
- public other-user badge rendering works when `showBadges` is true;
- other-user badges/count/action are hidden when `showBadges` is false;
- badge collection/dialog controls use existing AnonChat control classes;
- APK and AAB build successfully.

Run current web regressions protecting shared behavior plus the Android parity/build workflow on the feature branch before merge.

## Deployment and packaging
1. Write failing tests for Android parity plus each cross-platform defect.
2. Implement persistent trusted-device E2EE auto-unlock without storing raw credentials.
3. Fix desktop dark-background/hamburger contrast while preserving Appearance settings.
4. Fix badge discoverability/rendering and verify existing-user award visibility.
5. Patch only reproduced Android wrapper/standalone gaps.
6. Advance Android package version and update docs.
7. Run focused contracts plus Phase C, badge/privacy, Firestore, appearance, E2EE, and Android regressions.
8. Build APK and AAB on the feature branch.
9. Merge only a fully verified head to `main`.
10. Verify Firebase/web deployment succeeds on the merged commit.
11. Verify any required idempotent badge reconciliation/backfill completes successfully.
12. Verify `Build Android` succeeds on the merged `main` commit and produces both artifacts.

## Non-goals
- No native rewrite of AnonChat web features.
- No duplicate native badge/profile/messaging/settings data layer.
- No plaintext persistence of encryption PINs/passwords or private identity material.
- No Google Play Billing or Stripe Android SDK addition as part of parity.
- No unrelated Android UI redesign.
- No reintroduction of Groups, Interest Communities, or the GIF URL composer.
