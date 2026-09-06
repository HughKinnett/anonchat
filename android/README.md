# AnonChat Android

AnonChat is packaged as a Trusted Web App using package ID `com.anonchat.app`. It opens `https://anonchatlogin.web.app/`, so Android uses the same hosted accounts, profiles, badges, posts, messaging, moderation, admin dashboard, settings, Premium screens, and other current web features rather than maintaining duplicate native product code.

Release `1.0.4` (`versionCode 5`) refreshes the Android package against the current AnonChat web release. This parity release includes the same-device trusted E2EE auto-unlock flow, profile badge discovery and privacy, desktop/mobile appearance fixes, private-message readiness, sign-in fallback, current automatic badges, Temporary/Premium Rooms, and the rest of the hosted feature set.

The same-device encryption convenience remains browser/TWA-owned and does not store the raw encryption PIN or recovery password. Persistent trust uses encrypted device-local browser state; a genuinely new/reset device or unavailable/corrupt trust state falls back to the existing secure PIN/recovery flow.

All Android-visible hosted inputs, checkboxes, buttons, dialogs, and actions use the same AnonChat web control/theme styles. Android native code should not introduce a second visual/control system for hosted product features.

Payment preparation is presentation-only in this release. The Android package does not include Google Play Billing or Stripe SDK dependencies, and it cannot start or complete a payment. Stripe, Firestore billing records, and Google Play Billing remain intentionally disconnected until a later billing integration release.

The build workflow creates an installable APK and a release Android App Bundle. Sign the bundle with the existing private upload key and keep its SHA-256 fingerprint published in `/.well-known/assetlinks.json`. Never commit that key or its passwords.

For later Play releases, increase `versionCode` in `app/build.gradle`, use the same upload key, and upload the new `.aab`.
