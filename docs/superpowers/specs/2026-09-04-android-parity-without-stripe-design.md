# Android Parity Without Stripe Design

## Status
Approved in chat on September 4, 2026.

## Goal
Bring the current AnonChat web regression fixes into the Android app while preserving a single shared product implementation through the existing Trusted Web Activity (TWA). Stripe payment and card-entry UI must remain web-only and must not be exposed inside the Android app.

## Existing Android Architecture
AnonChat Android is currently a Trusted Web Activity that launches the production web app through `MainActivity`. Native Android code is responsible for platform capabilities such as notification permission, secure-screen behavior, app-link/TWA packaging, and Play build output. Product UI and data flows are supplied by the web application.

## Parity Scope
The Android app must receive the same user-facing behavior as the web release for:

- Push-notification enablement and subscription flow, including Android 13+ native notification permission handling.
- Notification deep links and in-app routing.
- Spotify playlist-name privacy masking so the playlist title itself is not readable.
- Canonical interaction counts and interaction lists across For You, Latest, and My Profile.
- No false zero or permanent "interactions not loaded in this view" state when the interaction data is available.
- Follower/following privacy so ordinary users cannot browse another user's follower graph.
- E2EE setup warning that clearly states AnonChat cannot retrieve or recover the encryption password or PIN, with red visual emphasis and required acknowledgement before continuing.
- Admin dashboard access and controls for authorized admin accounts.
- Existing report, block, delete, chronological ordering, temporary-room, and other production behaviors already shared through the web surface.

## Stripe Exclusion
Stripe preparation remains a web-only concern for this release.

The Android app must not present credit-card, debit-card, payment-method, checkout, or Stripe billing-entry fields. Android users must not be able to start or complete a Stripe checkout flow from the app in this release.

The Stripe publishable-key/config scaffolding may remain in the shared web code only when it is inert inside Android. No Stripe secret key, webhook secret, card data, or server credential may be bundled into the Android app.

If the shared Premium page contains Stripe-ready UI, Android must detect the TWA/app context and suppress that payment-entry UI while preserving non-billing Premium information that is safe to display.

## Data and Security Boundaries

- No new Stripe billing data is written to Firestore from Android.
- No card data is collected or stored by AnonChat.
- Existing Firestore security rules remain the authority for follower privacy and interaction access.
- E2EE passwords and PINs remain unrecoverable by AnonChat; the warning changes disclosure and acknowledgement, not the cryptographic design.
- Android retains `FLAG_SECURE` behavior already present in `MainActivity`.

## Android Notification Responsibilities

Native Android continues to request `POST_NOTIFICATIONS` on Android 13+ when permission has not been granted. Web/TWA notification subscription logic remains responsible for service-worker/push subscription creation after the native permission layer is satisfied.

The release is not considered verified until both layers work together on an installed Android build: native permission can be granted, the web subscription flow completes, and a representative notification can route back into the app correctly.

## Interaction Consistency Requirement

For a given canonical post or repost, For You, Latest, and My Profile must resolve to the same interaction parent and therefore display the same reaction count, comment count, and interaction list. Android must inherit this exact behavior from the shared web implementation.

Loading states may show a temporary loading indicator, but they must not permanently replace known interaction counts or collapse to an incorrect zero.

## Follower Privacy Requirement

Ordinary users may view their own follower/following information. They must not be able to browse another user's follower or following lists through the Android UI, direct navigation, or Firestore reads. Admin access needed for moderation/analytics remains governed by existing admin authorization.

## E2EE Disclosure Requirement

Before creating an encryption password or 4-digit PIN, Android users must see the same prominent red warning as web users. The warning must state that AnonChat does not store the encryption password or PIN in a recoverable form, cannot retrieve or reset them, and losing the required recovery secret can permanently prevent access to encrypted conversations.

The user must acknowledge that warning before the setup flow can continue.

## Implementation Direction

Use the existing TWA rather than creating duplicate native screens. Shared product fixes should remain in the web codebase, with Android-specific guards only where platform behavior differs.

Android-specific code should be limited to:

- Native notification permission handling.
- Reliable TWA/app-context detection when Android-only behavior differs, especially Stripe suppression.
- App-link/deep-link behavior.
- Packaging/build verification.
- Any minimal native glue required for installed-app notification behavior.

## Testing and Release Gates

The Android portion of the release must not be marked complete until all applicable checks pass:

1. Web regression CI is green on the exact PR head.
2. Android build workflow succeeds on the same release commit.
3. Installed Android package launches successfully.
4. Android 13+ notification permission can be granted and does not dead-end the web subscription flow.
5. Notification subscription succeeds in the installed app and deep links return to the expected AnonChat surface.
6. Spotify playlist title is not visible in the Android app.
7. Interaction counts/lists match across For You, Latest, and My Profile for representative canonical posts/reposts.
8. Other users' follower/following lists cannot be opened or read by an ordinary account.
9. The red E2EE recovery warning appears and acknowledgement is required.
10. Admin accounts can still reach the admin dashboard.
11. Stripe credit/debit-card/payment-entry fields are absent from Android.
12. No Android regression weakens production security or removes existing user/admin functionality.

## Out of Scope

- A full native Android rewrite.
- Native duplicate implementations of timelines, profiles, comments, reactions, E2EE, or admin pages.
- Live Stripe checkout or payment collection inside Android.
- Adding Stripe secret/server credentials to client or Android code.
