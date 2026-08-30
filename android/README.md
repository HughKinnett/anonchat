# AnonChat Android

AnonChat is packaged as a Trusted Web App using package ID `com.anonchat.app`. It opens `https://anonchatlogin.web.app/`, so the Android app uses the same accounts, posts, messages, moderation, and web features.

The build workflow creates an installable APK and a release Android App Bundle. Sign the bundle with a private upload key and publish its SHA-256 fingerprint in `/.well-known/assetlinks.json` before the first Google Play upload. Never commit that key or its passwords.

For later Play releases, increase `versionCode` in `app/build.gradle`, use the same upload key, and upload the new `.aab`.
