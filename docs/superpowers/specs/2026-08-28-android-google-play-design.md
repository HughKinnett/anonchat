# AnonChat Android and Google Play Design

**Date:** 2026-08-28
**Status:** Approved for implementation through the user's prior Android specification approval
**Dependency:** The web safety and lifecycle release must be merged and deployed first.

## Goal

Package the reviewed Firebase-hosted AnonChat PWA as a professional Android app for Google Play testing, while keeping one shared product implementation across web and Android.

## Packaging decision

Use a Trusted Web Activity generated with Bubblewrap rather than a custom WebView.

- Production origin: `https://anonchatlogin.web.app/`
- Proposed immutable application ID: `com.hughkinnett.anonchat`
- Display name: `AnonChat`
- Pricing: free
- Distribution: United States only
- Target audience: 18 and over only
- Target SDK: Android 16 / API 36
- Release format: Android App Bundle (`.aab`)
- Test format: locally installable signed APK

A TWA preserves the deployed Firebase Authentication, Firestore, service worker, offline shell, image upload, Spotify embed, and Web Push implementation. A custom WebView would duplicate authentication/notification behavior and create a larger security surface.

## Web prerequisites

- Replace the single `sizes:any` JPEG manifest entry with proper 192px, 512px, and maskable PNG icons derived from the existing AnonChat artwork.
- Use absolute root scope/start URLs and consistent PWA metadata on every page.
- Add legal/support pages to the app shell and make install controls aware of the TWA environment.
- Host `/.well-known/assetlinks.json` as JSON without redirect. Firebase Hosting ignore rules must explicitly exclude repository internals while allowing `.well-known`.
- Add safe baseline response headers. Content Security Policy is introduced only after it is proven compatible with Firebase ESM imports, Web Push, data-image uploads, and Spotify frames.

## Android project

The repository contains an `android/` Bubblewrap project with:

- manifest URL and launch origin locked to `anonchatlogin.web.app`;
- API 36 target and minimum SDK 23;
- portrait and responsive behavior without a fixed 16:9 maximum;
- adaptive launcher/splash assets generated from the approved AnonChat artwork;
- no unnecessary Android permissions;
- version code/name documented and incremented for every Play upload;
- build scripts that do not commit keystores, passwords, generated SDKs, or signing credentials.

The locally signed testing certificate fingerprint is included in `assetlinks.json` for direct APK verification. The Google Play App Signing certificate fingerprint is added after Play creates it, before closed-test publication.

## Signing and secrets

- Use Play App Signing.
- Generate a dedicated upload key only after action-time user authorization because it is a persistent credential.
- Store the keystore outside version control and store any automation copy only as encrypted repository secrets.
- Never print or commit keystore passwords, private keys, service-account JSON, or signing material.
- Keep a recovery record telling the owner where the upload key is stored and how to rotate it through Play support.

## Store readiness

Prepare repository-backed release materials:

- app name, short description, full description, and US-English listing copy;
- 512px Play icon, feature graphic, and phone screenshots from the real tested app;
- Privacy Policy, Terms, Support, and account-deletion URLs;
- Data safety inventory for email/auth, UGC, photos, push subscriptions, analytics/activity, local storage, and Spotify embeds;
- ads declaration, content-rating notes, 18+ target-audience declaration, and reviewer-access instructions;
- a reserved reviewer account/slot that can exercise sign-in, posts, reporting, blocking, temporary rooms, push opt-in, and account deletion.

## Testing and publication gates

Local verification covers:

- Bubblewrap/Gradle build and signing validation;
- Digital Asset Links verification with no Custom Tab fallback;
- real-device or emulator launch, sign-up/sign-in/password reset, posting/images, reporting/blocking, rooms, messages, offline/reconnect, Web Push permission/delivery/tap, and account deletion;
- Play pre-launch report after upload.

The signed AAB is uploaded to Internal testing first. The user's personal developer account, created after November 13, 2023, must then run a closed test with at least 12 continuously opted-in testers for 14 days before applying for production access. Store publication cannot bypass that Google-controlled waiting period.

## Current external-account constraint

The authenticated Google session currently opens Play Console's **Create developer account** page rather than an existing console dashboard. Code, assets, the TWA project, and an unsigned/debug test build can be completed now. Creating the paid developer account, generating persistent signing credentials, transmitting the AAB, and submitting Play forms require the appropriate action-time confirmations and an active Play Console account.

## Release order

1. Deploy and smoke-test the web safety release.
2. Harden manifest/assets/hosting and deploy Digital Asset Links for the local signing certificate.
3. Generate and test the TWA project and debug/local APK.
4. With user authorization, create/store the upload key and build the release AAB.
5. Complete Play Console setup and listing, upload to Internal testing, then closed testing.
6. Add the Play App Signing fingerprint to Digital Asset Links and verify full-screen TWA behavior.
7. After the required closed-test period, apply for production access and publish US-only when Google approves it.
