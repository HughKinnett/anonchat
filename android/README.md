# AnonChat Android

AnonChat is packaged as a Trusted Web App using package ID `com.anonchat.app`. It opens `https://anonchatlogin.web.app/`, so the Android app uses the same accounts, posts, messages, moderation, admin dashboard, Premium screens, and current hosted web features.

Release `1.0.3` (`versionCode 4`) refreshes the Android package against the current AnonChat web release. Because the wrapper loads the hosted site, web feature updates remain shared with Android while native permissions and packaging stay in this project.

Payment preparation is presentation-only in this release. The Android package does not include Google Play Billing or Stripe SDK dependencies, and it cannot start or complete a payment. Stripe, Firestore billing records, and Google Play Billing remain intentionally disconnected until a later billing integration release.

The build workflow creates an installable APK and a release Android App Bundle. Sign the bundle with a private upload key and publish its SHA-256 fingerprint in `/.well-known/assetlinks.json` before the first Google Play upload. Never commit that key or its passwords.

For later Play releases, increase `versionCode` in `app/build.gradle`, use the same upload key, and upload the new `.aab`.
