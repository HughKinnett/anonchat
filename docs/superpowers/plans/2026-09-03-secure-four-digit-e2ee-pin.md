# Secure Four-Digit E2EE PIN Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace routine 12-character E2EE unlock prompts on trusted devices with an exactly four-digit PIN while keeping the actual E2EE private identity protected by strong random cryptographic key material.

**Architecture:** Keep existing users' current Firebase passphrase-protected private identity bundle unchanged as their stronger recovery path. Add a device-local trusted-device record: a random 256-bit device wrapping key encrypts the private JWK, while the four-digit PIN derives a local AES-GCM key that wraps only that random device key. New users receive a generated 128-bit recovery code during initial setup; that recovery code, never the four-digit PIN, protects the Firebase recovery bundle and is shown once for the user to save. A new or cleared device must use the stronger recovery credential before creating a fresh local PIN record.

**Tech Stack:** Browser Web Crypto API (ECDH P-256, PBKDF2-SHA256, AES-256-GCM), ES modules, browser localStorage, Firebase Firestore 10.12.5, Node 22 tests, Firebase emulator rules tests.

**Spec:** `docs/superpowers/specs/2026-09-03-secure-four-digit-e2ee-pin-design.md`

## Global Constraints

- The PIN is exactly four ASCII digits (`0000` through `9999`).
- The PIN is never stored in plaintext, logged, sent to Firebase, or included in analytics.
- The PIN never directly protects the Firebase-hosted E2EE private identity bundle.
- Existing users keep their current 12+ character encryption passphrase only as a recovery credential; routine trusted-device unlock uses the PIN.
- New users get a generated high-entropy recovery code; they are not required to invent a new 12-character password for routine use.
- Existing E2EE public identities, fingerprints, direct-message ciphertext, room-key envelopes, encrypted photos, and temporary-room ciphertext remain compatible.
- Successful migration does not rotate the user's P-256 identity.
- Failed migration preserves the existing recovery unlock path.
- Clearing browser/site storage makes the device untrusted and requires recovery; the app never silently creates a new E2EE identity.
- Signing out clears decrypted key material from memory but preserves the encrypted trusted-device record.
- Android/PWA behavior follows the same shared client code path as web.
- `npm run test:e2ee`, workflow-policy tests, and the full Firestore CI suite must pass before merge/deploy.

---

### Task 1: Trusted-device PIN cryptography

**Files:**
- Create: `e2ee-pin.mjs`
- Create: `scripts/test-e2ee-pin.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `validateChatPin(pin): string`
- Produces: `createTrustedDeviceRecord(privateJwk, pin, options?): Promise<object>`
- Produces: `unlockTrustedDeviceRecord(record, pin): Promise<JsonWebKey>`
- Produces: `pinDelayMs(failureCount): number`

- [ ] **Step 1: Write failing tests**

Test exact four-digit validation, correct-PIN unlock, wrong-PIN failure, tamper failure, and absence of plaintext PIN/private JWK material in serialized records.

```js
assert.equal(validateChatPin("0000"), "0000");
for (const bad of ["123", "12345", "12a4", " 1234", "1234 "]) {
  assert.throws(() => validateChatPin(bad), /four digits/i);
}
const record = await createTrustedDeviceRecord(privateJwk, "0420");
const serialized = JSON.stringify(record);
assert.equal(serialized.includes("0420"), false);
assert.equal(serialized.includes(privateJwk.d), false);
assert.deepEqual(await unlockTrustedDeviceRecord(record, "0420"), privateJwk);
await assert.rejects(() => unlockTrustedDeviceRecord(record, "0421"), /incorrect/i);
```

- [ ] **Step 2: Run test and confirm RED**

Run: `node scripts/test-e2ee-pin.mjs`

Expected: module-not-found failure for `e2ee-pin.mjs`.

- [ ] **Step 3: Implement PIN record cryptography**

Generate a random 32-byte device wrapping key. Encrypt the private JWK with AES-256-GCM under that random key. Derive a PIN AES-256-GCM key with PBKDF2-SHA256, a fresh 16-byte salt, and 600,000 iterations; use it only to encrypt the random device key. Use fresh 12-byte IVs and distinct `additionalData` strings for the device-key and identity layers.

Record shape:

```js
{
  version: 1,
  algorithm: "A256GCM+PBKDF2-SHA256",
  pinIterations: 600000,
  pinSalt: "base64",
  pinIv: "base64",
  wrappedDeviceKey: "base64",
  identityIv: "base64",
  wrappedPrivateJwk: "base64",
  createdAt: 1710000000000
}
```

Map authentication failures to `new Error("That chat PIN is incorrect.")`. Implement delays of `0, 1000, 2000, 5000, 10000, 30000` ms for successive failures, capped at 30 seconds.

- [ ] **Step 4: Run test and confirm GREEN**

Run: `node scripts/test-e2ee-pin.mjs`

Expected: PASS.

- [ ] **Step 5: Wire into `test:e2ee` and commit**

Prepend `node scripts/test-e2ee-pin.mjs &&` to the existing `test:e2ee` script.

Commit: `feat: add trusted-device E2EE PIN cryptography`

---

### Task 2: Trusted-device storage and attempt throttling

**Files:**
- Create: `e2ee-device-store.mjs`
- Create: `scripts/test-e2ee-device-store.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `trustedDeviceStorageKey(uid): string`
- Produces: `loadTrustedDeviceRecord(storage, uid): object|null`
- Produces: `saveTrustedDeviceRecord(storage, uid, record): void`
- Produces: `removeTrustedDeviceRecord(storage, uid): void`
- Produces: `createPinAttemptTracker(options?): tracker`
- Produces: `TrustedDeviceStateError`

- [ ] **Step 1: Write failing storage tests**

Use an in-memory Storage-compatible fake. Verify UID scoping, malformed JSON rejection, per-user deletion, escalating delays, and reset-after-success.

```js
saveTrustedDeviceRecord(storage, "user-a", { version: 1 });
assert.deepEqual(loadTrustedDeviceRecord(storage, "user-a"), { version: 1 });
assert.equal(loadTrustedDeviceRecord(storage, "user-b"), null);
removeTrustedDeviceRecord(storage, "user-a");
assert.equal(loadTrustedDeviceRecord(storage, "user-a"), null);
```

- [ ] **Step 2: Run test and confirm RED**

Run: `node scripts/test-e2ee-device-store.mjs`

Expected: module-not-found failure.

- [ ] **Step 3: Implement storage lifecycle**

Store one JSON record per AnonChat UID in `localStorage`. Treat malformed or structurally invalid data as `TrustedDeviceStateError`; never reinterpret corruption as “no identity.” Keep PIN failure counters in memory/session scope only.

- [ ] **Step 4: Run test and confirm GREEN**

Run: `node scripts/test-e2ee-device-store.mjs`

Expected: PASS.

- [ ] **Step 5: Add to `test:e2ee` and commit**

Commit: `feat: add trusted-device E2EE storage lifecycle`

---

### Task 3: Recovery credential support without changing existing Firebase bundle compatibility

**Files:**
- Modify: `e2ee-crypto.mjs`
- Create: `scripts/test-e2ee-recovery.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `generateRecoveryCode(): string`
- Produces: `exportPrivateJwk(privateKey): Promise<JsonWebKey>`
- Produces: `importPrivateJwk(privateJwk): Promise<CryptoKey>`
- Keeps: `createIdentityBundle(passphrase)` and `unlockIdentityBundle(privateBundle, passphrase)` backward compatible.

- [ ] **Step 1: Write failing recovery tests**

Assert generated recovery codes have at least 128 bits of random entropy represented as a fixed-format printable code, two generated codes differ, and existing passphrase-protected bundles still unlock unchanged.

```js
const recovery = generateRecoveryCode();
assert.match(recovery, /^[A-Z2-7]{4}(?:-[A-Z2-7]{4}){7}$/);
assert.notEqual(recovery, generateRecoveryCode());
```

- [ ] **Step 2: Run test and confirm RED**

Run: `node scripts/test-e2ee-recovery.mjs`

Expected: missing exports.

- [ ] **Step 3: Implement recovery helpers**

Generate 20 random bytes and encode as 32 Base32 characters grouped `XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX`. The generated recovery code may be used as the passphrase input to the existing PBKDF2/AES-GCM private-bundle format, so no Firestore schema/version change is required. Export/import private JWK helpers must preserve P-256 ECDH usage.

- [ ] **Step 4: Run recovery plus existing crypto tests**

Run: `node scripts/test-e2ee-recovery.mjs && node scripts/test-e2ee-crypto.mjs`

Expected: PASS.

- [ ] **Step 5: Add to `test:e2ee` and commit**

Commit: `feat: add E2EE recovery credential helpers`

---

### Task 4: PIN setup, migration, unlock, and recovery UI/state flow

**Files:**
- Modify: `e2ee-identity.js`
- Create: `scripts/test-e2ee-pin-integration.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes Tasks 1-3.
- Keeps public return shape of `ensureE2eeIdentity(db, user)` unchanged.
- Produces `clearE2eeSession(uid?)` for in-memory cleanup.

- [ ] **Step 1: Write failing integration tests**

Cover all state paths:

1. Existing Firebase identity + valid local trusted-device record -> prompt only for PIN.
2. Existing Firebase identity + no local record -> ask old encryption passphrase once, unlock same identity, create/confirm PIN, verify local record, persist local record; public JWK/fingerprint remain byte-for-byte unchanged.
3. New identity -> generate recovery code, create Firebase private bundle using that recovery code, show recovery code once with explicit save confirmation, create/confirm PIN, verify local record, then complete setup.
4. Existing Firebase identity + corrupted local record -> route to recovery; never generate replacement identity.
5. Failed local-record verification -> old Firebase recovery path remains intact and identity is not rotated.
6. Correct recovery credential on a new/cleared device -> unlock existing identity and establish a new local PIN record.

- [ ] **Step 2: Run integration test and confirm RED**

Run: `node scripts/test-e2ee-pin-integration.mjs`

Expected: current implementation always uses the password dialog and lacks trusted-device state.

- [ ] **Step 3: Replace routine password dialog with explicit PIN and recovery dialogs**

Implement:

- `chatPinDialog({ setup })`: masked input, `inputMode="numeric"`, `pattern="[0-9]{4}"`, `maxLength=4`; copy is `Create chat PIN`, `Confirm chat PIN`, or `Enter chat PIN`.
- `recoveryPassphraseDialog()`: only for existing users' old 12+ character recovery password.
- `recoveryCodeDisplayDialog(code)`: shown once to new users, requiring an explicit `I saved my recovery code` acknowledgement before setup proceeds.
- `recoveryCodeEntryDialog()`: accepts the fixed Base32 recovery-code format on a new/cleared device.

- [ ] **Step 4: Implement trusted-device-first identity state machine**

Order inside `ensureE2eeIdentity`:

1. Return in-memory identity cache if present.
2. Read public/private Firebase identity documents and reject incomplete pairs.
3. If Firebase identity exists and a valid local trusted-device record exists, unlock locally with PIN.
4. If Firebase identity exists but local record is absent/corrupt, require stronger recovery credential, unlock existing Firebase bundle, verify fingerprint, then establish a new PIN record.
5. Only if no Firebase identity exists, create a new identity with generated recovery code plus local PIN record.

Never write PIN, local trusted-device fields, or plaintext private JWK to Firestore.

- [ ] **Step 5: Implement PIN throttling and neutral errors**

Before retry, consult the attempt tracker. After failure show `That chat PIN is incorrect. Try again in N seconds.`; after success reset failures. Do not reveal partial correctness.

- [ ] **Step 6: Implement migration rollback rule**

For existing-user migration, build and decrypt-test the new local record before saving it. If verification fails, leave Firebase documents untouched and do not cache a replacement identity.

- [ ] **Step 7: Implement session clearing**

`clearE2eeSession(uid?)` clears `identityCache` and in-memory PIN-attempt state only. Ordinary sign-out must not delete the persisted trusted-device record.

- [ ] **Step 8: Run integration and compatibility tests**

Run: `node scripts/test-e2ee-pin-integration.mjs && node scripts/test-e2ee-crypto.mjs && node scripts/test-e2ee-integration-policy.mjs`

Expected: PASS.

- [ ] **Step 9: Add integration test to `test:e2ee` and commit**

Commit: `feat: add secure four-digit E2EE PIN unlock flow`

---

### Task 5: Session, Firebase-boundary, and full release verification

**Files:**
- Create: `scripts/test-e2ee-pin-session.mjs`
- Modify only if a failing regression requires it: `firestore.rules`, `scripts/test-e2ee-rules.mjs`, `scripts/test-e2ee-integration-policy.mjs`, `package.json`, workflow policy files.

**Interfaces:**
- Consumes Tasks 1-4.
- Produces release-ready PIN behavior with unchanged server-readable security boundaries.

- [ ] **Step 1: Write session/boundary regression tests**

Verify sign-out clears decrypted keys but leaves local encrypted trusted-device state. Verify clearing local storage forces recovery. Verify Firestore payload builders contain no `pin`, `wrappedDeviceKey`, `wrappedPrivateJwk`, or plaintext private JWK fields.

- [ ] **Step 2: Run session regression test**

Run: `node scripts/test-e2ee-pin-session.mjs`

Expected: PASS after Task 4 session wiring.

- [ ] **Step 3: Run complete E2EE suite**

Run: `npm run test:e2ee`

Expected: PASS for new PIN/recovery tests plus existing crypto, integration-policy, and Firestore-rule tests.

- [ ] **Step 4: Run workflow and full Firestore CI gates**

Run: `npm run test:workflow-policy`

Then: `npm run test:firestore-ci`

Expected: PASS.

- [ ] **Step 5: Review diff for cryptographic compatibility and leakage**

Confirm existing Firebase `privateBundle` version/algorithm remains readable by `unlockIdentityBundle`; existing users' public identity/fingerprint does not change during PIN migration; local PIN record fields never enter Firestore/server migration code.

- [ ] **Step 6: Request code review and address findings**

Use the repository's normal review flow; rerun the affected focused test after each fix, then rerun `npm run test:e2ee`.

- [ ] **Step 7: Merge only with green CI and deploy**

Merge into `main` only after CI passes. Confirm the existing Firebase production workflow completes successfully before calling the PIN feature deployed.
