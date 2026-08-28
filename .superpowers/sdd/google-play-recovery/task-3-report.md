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

- The UI and pure policy normalize protected names with trim/lowercase. Firestore rules use an equivalent case-insensitive whitespace-boundary match, including both protected usernames.
- Both sides of the atomic write validate the other side with `existsAfter`/`getAfter`, including exact target, requester, trusted timestamp, and `queued` status.
- Normal clients, targets, and administrators after creation cannot mutate or delete jobs.
- Standalone Ban/Unban is restricted to exactly the `banned` field and requires a boolean; mixed-field and unpaired queue writes are denied.
