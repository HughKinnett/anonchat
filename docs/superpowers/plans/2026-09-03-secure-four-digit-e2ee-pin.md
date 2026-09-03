# Secure Four-Digit E2EE PIN Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace routine 12-character E2EE unlock prompts on trusted devices with an exactly four-digit PIN while keeping the actual E2EE private identity protected by strong random cryptographic key material.

**Architecture:** Keep the current Firebase passphrase-protected private identity bundle as the stronger recovery path. Add a device-local trusted-device record that stores the existing private JWK encrypted with a random 256-bit device wrapping key, and store that wrapping key encrypted by a PIN-derived AES-GCM key only in local device storage. Because this PIN-wrapped material never goes to Firebase, a Firebase/database compromise cannot be brute-forced with only 10,000 PIN guesses to recover the E2EE identity; a new or cleared device must recover with the existing stronger passphrase path before creating a fresh local PIN record.

**Tech Stack:** Browser Web Crypto API (ECDH P-256, PBKDF2-SHA256, AES-256-GCM), ES modules, browser localStorage, Firebase Firestore 10.12.5, Node 22 tests, Firebase emulator rules tests.

**Spec:** `docs/superpowers/specs/2026-09-03-secure-four-digit-e2ee-pin-design.md`

## Global Constraints

- The PIN must be exactly four ASCII digits (`0000` through `9999`).
- The PIN must never be stored in plaintext, logged, sent to Firebase, or included in analytics.
- The PIN must never directly protect the Firebase-hosted E2EE private identity bundle.
- The Firebase passphrase-protected bundle remains the stronger recovery path for untrusted/new devices in this first implementation.
- Existing E2EE public identities, fingerprints, direct-message ciphertext, room-key envelopes, encrypted photos, and temporary-room ciphertext must remain compatible.
- Successful migration must not rotate the user's P-256 identity.
- Failed migration must preserve the existing passphrase unlock path.
- Clearing browser/site storage makes the device untrusted; the app must require recovery and must not silently create a new E2EE identity.
- Signing out clears decrypted identity key material from memory.
- Android/PWA behavior must follow the same shared client code path as web.
- The current `test:e2ee` and Firestore CI suites must continue to pass.

---

### Task 1: Trusted-device PIN cryptography module

**Files:**
- Create: `e2ee-pin.mjs`
- Create: `scripts/test-e2ee-pin.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `validateChatPin(pin): string`
- Produces: `createTrustedDeviceRecord(privateJwk, pin, { now? }): Promise<object>`
- Produces: `unlockTrustedDeviceRecord(record, pin): Promise<JsonWebKey>`
- Produces: `trustedDeviceStorageKey(uid): string`
- Produces: `pinDelayMs(failureCount): number`

- [ ] **Step 1: Write failing PIN validation and crypto tests**

Add `scripts/test-e2ee-pin.mjs` with assertions that `validateChatPin("0000")` and `validateChatPin("9876")` pass; values such as `"123"`, `"12345"`, `"12a4"`, `" 1234"`, and `1234` are rejected unless explicitly converted by the caller. Generate a sample extractable P-256 private JWK, call `createTrustedDeviceRecord(privateJwk, "0420")`, verify the serialized record contains neither `"0420"` nor the private JWK `d` value, verify `unlockTrustedDeviceRecord(record, "0420")` returns the same JWK, and verify `"0421"` plus modified ciphertext/IV values fail authentication.

```js
assert.equal(validateChatPin("0000"), "0000");
assert.throws(() => validateChatPin("123"), /four digits/i);
const record = await createTrustedDeviceRecord(privateJwk, "0420");
const serialized = JSON.stringify(record);
assert.equal(serialized.includes("0420"), false);
assert.equal(serialized.includes(privateJwk.d), false);
assert.deepEqual(await unlockTrustedDeviceRecord(record, "0420"), privateJwk);
await assert.rejects(() => unlockTrustedDeviceRecord(record, "0421"), /incorrect/i);
```

- [ ] **Step 2: Run the new test and verify it fails**

Run: `node scripts/test-e2ee-pin.mjs`

Expected: failure because `e2ee-pin.mjs` does not exist yet.

- [ ] **Step 3: Implement the local trusted-device cryptography**

Create `e2ee-pin.mjs`. Generate a random 32-byte device wrapping key, encrypt the private JWK with AES-GCM under that random key, then derive a PIN key with PBKDF2-SHA256 using a fresh 16-byte salt and a high iteration count and AES-GCM-wrap the random device key. Bind both encrypted objects to AnonChat-specific `additionalData` strings and version the record.

The record shape must be device-local and contain only base64 ciphertext, salts, IVs, version/algorithm metadata, and timestamps, for example:

```js
{
  version: 1,
  algorithm: "A256GCM+PBKDF2-SHA256",
  pinIterations: 600000,
  pinSalt: "...",
  pinIv: "...",
  wrappedDeviceKey: "...",
  identityIv: "...",
  wrappedPrivateJwk: "...",
  createdAt: 1710000000000
}
```

Use `validateChatPin` before derivation. Map AES-GCM authentication failures to `new Error("That chat PIN is incorrect.")`. Implement `pinDelayMs` as escalating local delays with a bounded curve such as `0, 1000, 2000, 5000, 10000, 30000` milliseconds for consecutive failures.

- [ ] **Step 4: Run the PIN tests and verify they pass**

Run: `node scripts/test-e2ee-pin.mjs`

Expected: PASS with correct PIN unlock, wrong PIN rejection, tamper rejection, and no plaintext PIN/private-key serialization.

- [ ] **Step 5: Add the PIN test to the E2EE test script**

Update `package.json` so `test:e2ee` begins with `node scripts/test-e2ee-pin.mjs &&` before the existing crypto/integration/rules tests.

- [ ] **Step 6: Commit**

Commit message: `feat: add trusted-device E2EE PIN cryptography`

---

### Task 2: Trusted-device storage and in-memory lifecycle

**Files:**
- Create: `e2ee-device-store.mjs`
- Create: `scripts/test-e2ee-device-store.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `trustedDeviceStorageKey(uid)` from `e2ee-pin.mjs`
- Produces: `loadTrustedDeviceRecord(storage, uid): object|null`
- Produces: `saveTrustedDeviceRecord(storage, uid, record): void`
- Produces: `removeTrustedDeviceRecord(storage, uid): void`
- Produces: `createPinAttemptTracker({ now? }): { remainingDelay(uid), recordFailure(uid), recordSuccess(uid), clear(uid) }`

- [ ] **Step 1: Write failing storage and throttling tests**

Test that records are scoped by UID, malformed JSON is treated as corrupted/untrusted rather than accepted, removing one user's record does not remove another user's record, and attempt delays increase after failures and reset after success.

```js
const storage = new MapStorage();
saveTrustedDeviceRecord(storage, "user-a", { version: 1 });
assert.deepEqual(loadTrustedDeviceRecord(storage, "user-a"), { version: 1 });
assert.equal(loadTrustedDeviceRecord(storage, "user-b"), null);
removeTrustedDeviceRecord(storage, "user-a");
assert.equal(loadTrustedDeviceRecord(storage, "user-a"), null);
```

- [ ] **Step 2: Run the storage test and verify it fails**

Run: `node scripts/test-e2ee-device-store.mjs`

Expected: failure because `e2ee-device-store.mjs` does not exist.

- [ ] **Step 3: Implement storage helpers and local rate limiting**

Use an injected Storage-compatible object so tests do not require a browser. Parse only object-shaped JSON records. Throw a distinct `TrustedDeviceStateError` for malformed/corrupt records so the identity layer can route to recovery instead of silently creating keys. Keep PIN-attempt counters in memory/session scope rather than Firebase.

- [ ] **Step 4: Run storage tests and verify they pass**

Run: `node scripts/test-e2ee-device-store.mjs`

Expected: PASS.

- [ ] **Step 5: Add the storage test to `test:e2ee`**

Place `node scripts/test-e2ee-device-store.mjs` immediately after the PIN crypto test.

- [ ] **Step 6: Commit**

Commit message: `feat: add trusted-device E2EE storage lifecycle`

---

### Task 3: PIN setup, unlock, migration, and recovery flow

**Files:**
- Modify: `e2ee-identity.js`
- Modify: `e2ee-crypto.mjs`
- Create: `scripts/test-e2ee-pin-integration.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: PIN crypto/storage interfaces from Tasks 1-2.
- Produces: trusted-device-first `ensureE2eeIdentity(db, user)` behavior without changing its public return shape.
- Produces: recovery/migration helper functions that are testable independently from DOM rendering.

- [ ] **Step 1: Write failing integration-policy tests**

Cover four paths:

1. Existing identity + trusted-device record: prompt only for 4-digit PIN and never request the old passphrase.
2. Existing identity + no local trusted-device record: request the existing encryption passphrase once, unlock the existing Firebase private bundle, create/confirm a new PIN, write only the local trusted-device record, and preserve public JWK/fingerprint.
3. New identity: create the existing strong Firebase private bundle with a generated high-entropy recovery secret retained only long enough to complete setup, create the local PIN record, verify it, and then expose the identity. If the first-release product decision is to retain the existing user-chosen passphrase as recovery for newly created identities, keep that one-time recovery setup explicit and separate from routine PIN unlock; do not derive the Firebase bundle from four digits.
4. Corrupted local record: do not create a new identity; route to recovery.

The test must explicitly compare the public identity before and after migration and assert equality.

- [ ] **Step 2: Run the new integration test and verify it fails**

Run: `node scripts/test-e2ee-pin-integration.mjs`

Expected: failure because the current identity flow always prompts for the 12-character passphrase.

- [ ] **Step 3: Export private-JWK wrapping helpers from `e2ee-crypto.mjs` without changing existing bundle compatibility**

Add a helper to export an unlocked `CryptoKey` private key to JWK for local trusted-device wrapping, and a helper to import that JWK back to an ECDH private `CryptoKey`. Do not alter `createIdentityBundle` or `unlockIdentityBundle` serialization/version semantics used by existing Firebase records.

- [ ] **Step 4: Refactor `e2ee-identity.js` into explicit dialogs and state paths**

Replace the single `passwordDialog` with:

- `chatPinDialog({ setup })` using `type="password"`, `inputMode="numeric"`, `pattern="[0-9]{4}"`, `maxLength=4`, clear copy (`Create chat PIN`, `Confirm chat PIN`, `Enter chat PIN`).
- `recoveryPassphraseDialog()` for the old 12-character recovery password only.

`ensureE2eeIdentity` must first check the in-memory cache, then Firebase identity consistency, then trusted-device local state. On a valid local record, use only the PIN flow. On an existing Firebase identity with no local record, use recovery passphrase -> existing private key -> PIN setup -> local verification. Only when neither Firebase identity exists should identity creation run.

Do not write PIN material to Firestore. Keep the existing Firestore `e2eePublicKeys/{uid}` and `e2eePrivateKeys/{uid}` document shapes unchanged unless a versioned migration is strictly required.

- [ ] **Step 5: Add local wrong-PIN delay behavior**

Before accepting another PIN attempt, consult the attempt tracker. After a failed unlock, record the failure and show a neutral message such as `That chat PIN is incorrect. Try again in 5 seconds.` without exposing cryptographic details. On success, reset failures.

- [ ] **Step 6: Verify migration rollback behavior**

Create the new local record in memory first, verify it can unlock the same private JWK, and only then persist it. If verification fails, do not remove or modify the Firebase passphrase-protected bundle and do not populate the identity cache with a new identity.

- [ ] **Step 7: Run integration tests**

Run: `node scripts/test-e2ee-pin-integration.mjs && node scripts/test-e2ee-crypto.mjs && node scripts/test-e2ee-integration-policy.mjs`

Expected: all PASS and existing crypto bundle compatibility remains intact.

- [ ] **Step 8: Add the integration test to `test:e2ee` and commit**

Commit message: `feat: add secure four-digit E2EE PIN unlock flow`

---

### Task 4: Sign-out clearing and no-silent-reset guarantees

**Files:**
- Modify: `e2ee-identity.js`
- Modify: authentication/logout integration files that already call `clearE2eeIdentity`
- Create: `scripts/test-e2ee-pin-session.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `clearE2eeIdentity(uid)` and device-store interfaces.
- Produces: explicit `clearE2eeSession(uid)` that clears only decrypted/in-memory key material and PIN attempt state, not the persisted trusted-device record.

- [ ] **Step 1: Write failing session tests**

Verify sign-out removes cached decrypted identities and attempt state but leaves the encrypted trusted-device record intact. Verify simulated local-storage clearing followed by `ensureE2eeIdentity` enters recovery instead of creating a replacement identity.

- [ ] **Step 2: Run the session test and verify it fails**

Run: `node scripts/test-e2ee-pin-session.mjs`

Expected: failure until session clearing is explicit.

- [ ] **Step 3: Implement `clearE2eeSession` and wire existing sign-out paths**

Keep `clearE2eeIdentity` backward compatible if existing callers depend on it, or make it delegate to `clearE2eeSession`. Never call `removeTrustedDeviceRecord` during ordinary sign-out.

- [ ] **Step 4: Run session and existing auth tests**

Run: `node scripts/test-e2ee-pin-session.mjs && npm run test:auth-activity && npm run test:login`

Expected: PASS.

- [ ] **Step 5: Add session test to `test:e2ee` and commit**

Commit message: `test: protect E2EE PIN session and recovery behavior`

---

### Task 5: Full E2EE, Firebase, and deployment verification

**Files:**
- Modify if required by failures only: `firestore.rules`, `scripts/test-e2ee-rules.mjs`, `scripts/test-e2ee-integration-policy.mjs`, `package.json`, workflow policy files.

**Interfaces:**
- Consumes: all previous tasks.
- Produces: release-ready four-digit PIN feature with no change to server-readable data boundaries.

- [ ] **Step 1: Run the complete E2EE suite**

Run: `npm run test:e2ee`

Expected: PASS for PIN crypto, device storage, PIN integration, session behavior, existing E2EE crypto, integration policy, and Firestore rules.

- [ ] **Step 2: Inspect failures for any Firebase serialization leak**

If a test reveals PIN/private-key material in a Firestore payload, fix the client write boundary and add an exact regression assertion before proceeding. Do not relax the security assertion.

- [ ] **Step 3: Run workflow policy and full Firestore CI**

Run: `npm run test:workflow-policy`

Then run: `npm run test:firestore-ci`

Expected: PASS.

- [ ] **Step 4: Verify PR diff preserves existing identity formats**

Review the diff and confirm the existing Firebase `privateBundle` algorithm/version remains readable by `unlockIdentityBundle`, and that PIN/local trusted-device fields do not appear in Firestore rules or server migration code.

- [ ] **Step 5: Commit any verification-only fixes**

Commit message: `test: verify secure E2EE PIN rollout`

- [ ] **Step 6: Request code review, merge only after green CI, and deploy through the existing main-branch Firebase workflow**

After CI passes, merge the PR into `main`. Confirm the Firebase production deployment completes successfully before calling the feature deployed.
