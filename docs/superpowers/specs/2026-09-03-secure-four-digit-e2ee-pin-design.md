# Secure Four-Digit E2EE PIN Design

## Goal

Allow AnonChat users to set and enter a 4-digit numeric PIN for unlocking end-to-end encrypted chats without reducing the underlying cryptographic protection to a 10,000-combination secret.

## Current State

AnonChat currently asks users for a chat-encryption passphrase and derives the key used to protect the stored E2EE private-key bundle from that passphrase. Existing users may already have encrypted messages and private-key bundles protected by the current 12-character passphrase flow.

## Security Model

The 4-digit PIN must never be used directly as the sole encryption key for the user's E2EE private identity. Instead, AnonChat will generate a cryptographically random wrapping key using Web Crypto. The E2EE private key remains protected by strong random key material.

The user-facing 4-digit PIN is used only to unlock access to that wrapping key on a trusted device. This preserves a simple four-number experience without reducing the private-key protection to 10,000 possible passwords.

The app must not upload an object to Firebase that can be brute-forced offline using only the 4-digit PIN to recover the E2EE private key.

## Trusted-Device Behavior

A device becomes trusted after the user completes secure setup or migration. The device stores the PIN-protected unlock material using browser/device storage available to the web app. The stored material must remain encrypted at rest and scoped to the signed-in AnonChat account.

The PIN flow will require exactly four ASCII digits (`0000` through `9999`). Setup requires entering the PIN twice. Unlock requires the PIN once.

Repeated incorrect PIN attempts must be rate-limited locally with escalating delays. The UI must not reveal whether a particular PIN prefix or digit is correct.

Signing out clears decrypted private keys and in-memory wrapping material. It does not silently remove the encrypted trusted-device unlock record unless the account/device is explicitly reset.

## New-Device Behavior

A brand-new phone or computer must not be able to unlock the E2EE private key from Firebase using the 4-digit PIN alone. That would permit offline brute-force attacks against the remote key bundle.

New-device setup therefore requires re-establishing trust using a stronger recovery path. For the first implementation, existing users can use their current encryption passphrase during migration or recovery. Once a device is trusted, that device uses the 4-digit PIN for normal unlocks.

The design must preserve room/direct-message compatibility across trusted devices and must not rotate the user's E2EE identity merely because they switch to a PIN.

## Existing-User Migration

Users with the existing passphrase-protected private bundle are migrated in place:

1. The user enters the current encryption password once.
2. AnonChat unlocks the existing private E2EE key.
3. The user chooses and confirms a 4-digit PIN.
4. AnonChat generates a strong random wrapping key and creates the trusted-device PIN unlock record.
5. The existing E2EE identity remains unchanged, so previously encrypted direct messages and temporary-room messages remain decryptable.
6. Migration succeeds only after the new PIN unlock path has been verified on that device.

If migration fails before verification, the existing passphrase flow remains usable and no destructive key rotation occurs.

## New-User Setup

For new E2EE users, AnonChat creates the E2EE identity, generates strong random wrapping material, asks for a 4-digit PIN twice, verifies the PIN-protected trusted-device record, and only then completes setup.

The PIN itself is never stored in plaintext, logged, sent to Firebase, or included in analytics/telemetry.

## Recovery and Reset

If a user forgets the PIN on a trusted device, they must use the stronger recovery path to re-establish trust and choose a new PIN. Resetting only the PIN must not rotate or delete the E2EE identity when recovery succeeds.

If no stronger recovery material is available, AnonChat must clearly warn that resetting the encryption identity would make previously encrypted messages unreadable. Identity reset must be a separate explicit destructive action, not an automatic fallback from a forgotten PIN.

## UI Requirements

Replace the normal 12-character chat-encryption password prompt with a four-digit numeric PIN experience on trusted devices.

Use numeric input optimized for mobile keyboards, mask the digits during entry, enforce exactly four digits, and use clear copy such as "Create chat PIN", "Confirm chat PIN", and "Enter chat PIN".

Migration UI must clearly distinguish the one-time old encryption password from the new 4-digit PIN.

Wrong-PIN errors should say that the PIN is incorrect without exposing cryptographic details.

## Data and Storage Boundaries

Firebase may continue to store the user's public E2EE identity and encrypted private bundle as required by the existing architecture, but it must not receive plaintext private keys, plaintext PINs, or a PIN-only-wrapped copy of the private key.

Trusted-device PIN unlock material stays device-local. Any locally persisted wrapping record must use authenticated encryption and unique random nonces/salts as applicable.

No server-side admin or moderation process receives the local wrapping key or PIN.

## Compatibility

Existing encrypted direct messages, room keys, encrypted photo payloads, and temporary-room messages must continue to decrypt after migration.

The change must preserve the current E2EE public identity and room-key envelopes unless a user explicitly performs an identity reset.

The Android packaged app and installed PWA must use the same PIN behavior as the web app when they share the same client code path.

## Failure Handling

If local trusted-device state is corrupted or unavailable, the app must not silently generate a new identity. It should route the user to secure recovery.

If the browser clears local storage/site data, the device is treated as untrusted and requires recovery again.

If Firebase writes fail during setup or migration, the app must leave the previous usable encryption state intact.

## Testing Requirements

Add tests proving that:

- only exactly four numeric digits are accepted as a PIN;
- setup requires matching PIN confirmation;
- a correct PIN unlocks the trusted-device wrapping record;
- an incorrect PIN fails authentication;
- tampered local wrapping data fails authentication;
- plaintext PINs and private keys are never serialized into Firebase payloads;
- existing passphrase-protected identities migrate without changing the public identity;
- old encrypted direct messages and room messages remain decryptable after migration;
- failed migration preserves the old unlock path;
- clearing trusted-device state forces recovery instead of generating a new E2EE identity;
- sign-out clears decrypted key material from memory;
- current E2EE crypto, integration, and Firestore-rule suites continue to pass.

## Rollout

Ship the 4-digit PIN flow only after the existing E2EE verification work passes. Deployment should follow the normal PR, CI, merge-to-main, Firebase production workflow.

Existing users should be migrated lazily the next time their encryption identity is unlocked rather than bulk-changing stored identities server-side.

## Non-Goals

This change does not claim Signal Protocol equivalence, does not add server-readable recovery keys, and does not allow a 4-digit PIN alone to unlock encrypted history on a never-before-trusted device.
