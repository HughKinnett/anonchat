# Task 3 report: Restore atomic admin deletion queue rules

## Delivered boundary

- Added the pure `admin-deletion-policy.mjs` policy and focused unit test.
- Added the administrator UI queue action, which uses one Firestore batch to lock the target and create its deletion job with one trusted `serverTimestamp()` value.
- Restricted administrator profile moderation to an exact boolean-only `banned` update, plus the dedicated paired deletion queue update. The activity branch remains separate and continues to exclude `lastActiveAt` from administrator moderation.
- Added `adminDeletionJobs/{targetUid}` rules that require an authorized administrator, a non-protected existing target, no prior queue state/job, exact payloads, and matching paired profile/job writes. Jobs are immutable after creation.

## RED

Command:

```sh
node scripts/test-admin-deletion-policy.mjs
```

Output before implementation:

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../admin-deletion-policy.mjs'
```

Command:

```sh
npm run test:admin-deletion
```

Output during the first rules iteration:

```text
Error compiling rules:
L577:1 Unexpected '}'.
```

## GREEN

Commands run after the final change:

```sh
node scripts/test-admin-deletion-policy.mjs && npm test
npm run test:rules && npm run test:activity-rules
npm run test:auth-activity && npm run test:legacy-migration && npm run test:admin-deletion
git diff --check
```

Result summary:

```text
Administrator deletion policy passed
message request and connections regressions passed
Firestore message request authorization regressions passed
Firestore activity authorization passed
durable auth and activity policies passed
legacy migration policy passed
Firestore administrator deletion queue authorization passed
```

The emulator prints expected `PERMISSION_DENIED` diagnostics for the negative `assertFails` cases; every command exited successfully.

## Self-review

- The UI and pure policy normalize protected names with JavaScript trim/lowercase. Firestore rules use an explicit RE2 class for the JavaScript trim whitespace set, including both protected usernames.
- Both sides of the atomic write validate the other side with `existsAfter`/`getAfter`, including exact target, requester, trusted timestamp, and `queued` status.
- Normal clients, targets, and administrators after creation cannot mutate or delete jobs.
- Standalone Ban/Unban is restricted to exactly the `banned` field and requires a boolean; mixed-field and unpaired queue writes are denied.

## Fix round 1: queued targets and administrator authority

### RED

Command:

```sh
node scripts/test-admin-deletion-policy.mjs
```

Output before the policy hardening:

```text
SyntaxError: The requested module '../admin-deletion-policy.mjs' does not provide an export named 'canAdminSetBanned'
```

This test-first addition covers queued-state Ban/Unban behavior and NBSP/BOM protected-name normalization.

### GREEN

Commands after the fix:

```sh
node scripts/test-admin-deletion-policy.mjs
npm run test:admin-deletion
npm run test:activity-rules
npm test
npm run test:rules
npm run test:auth-activity
node --check admin.js
git diff --check
```

Result summary:

```text
Administrator deletion policy passed
Firestore administrator deletion queue authorization passed
Firestore activity authorization passed
message request and connections regressions passed
Firestore message request authorization regressions passed
durable auth and activity policies passed
```

### Fix review

- A queued target can be re-locked (`banned: true`) for repair, but cannot be unbanned or profile-deleted by a browser administrator. Only the existing secure self-deletion route remains for profiles.
- The UI disables queued-target Unban controls, and its policy exposes the same queued-state decision. There is no browser administrator profile-delete control.
- `isAdmin()` now fails closed unless an unbanned profile exactly matches a protected username reservation owned by the authenticated UID. The browser dashboard applies the same reservation check before rendering. Forged/mismatched/banned profiles are covered by emulator tests.
- New profiles require a paired matching username reservation in the same transaction and reject protected names. The normal signup transaction remains covered by the activity rules suite.
- The earlier generic whitespace-boundary equivalence statement is corrected here: Firestore now uses an explicit RE2 character class for the JavaScript trim whitespace set, including ordinary whitespace, NBSP (`U+00A0`), and BOM (`U+FEFF`). The emulator compiles and exercises the NBSP/BOM protected-target denials.
