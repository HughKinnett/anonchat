# AnonChat Web Safety and Content Lifecycle Design

**Date:** 2026-08-28
**Status:** Approved for implementation through the user's prior confirmations and request to continue
**Project:** `HughKinnett/anonchat`

## Goal

Make AnonChat's web app and future Android Trusted Web Activity safe, understandable, and reviewable by adding complete reporting and blocking flows, an actionable administrator moderation queue, deterministic ordering, real 24-hour temporary-room cleanup, complete owner delete controls, and the approved compact Timeline photo control.

The Firebase project remains on the Spark plan. Trusted background work therefore runs through scheduled GitHub Actions with the existing encrypted Firebase service-account secret; no Cloud Functions or paid backend is introduced.

## User-facing behavior

### Reports

- Every Timeline post, Community post, and temporary-room message has a **Report** action.
- Every other user's profile has **Report user** and **Block/Unblock** actions. Self-reporting and self-blocking are not offered or accepted.
- Reporting opens a short reason selector: harassment, hate or threats, sexual content, spam or scam, privacy or impersonation, and other.
- A successful submission immediately confirms **Report submitted for admin review** and disables duplicate reporting by that account for the same target.
- The reporter cannot see another reporter's identity or submissions. The reported user cannot read report records.

### Blocking

- A block uses the deterministic document ID `<blockerUid>_<blockedUid>`.
- Blocking hides the blocked person's public posts, Community posts, room messages, search results, and profile interaction controls from the blocker.
- Either direction of a block prevents new follows, message requests, direct messages, reveal requests, and new temporary-room interaction between that pair.
- Existing private content is not exposed or copied by the block flow.

### Post deletion and ordering

- Authors can delete their own original posts and reposts from Timeline and profile views.
- Deletion is confirmed in the interface and removes the item immediately from the visible feed. Administrator permanent deletion performs trusted cascade cleanup.
- Timeline and profile feeds are newest-first by trusted `createdAt`, with the canonical Firestore path as a deterministic tie-breaker.
- Comments, temporary-room messages, and direct messages are oldest-first by trusted `createdAt`, then canonical path. Rooms are newest-first with a document-ID tie-breaker.
- Missing pending server timestamps sort consistently without causing visible reordering loops.

### Temporary rooms

- A room receives trusted `createdAt` and `expiresAt` values. Rules accept only an expiry between 23 hours 55 minutes and 24 hours 5 minutes after the server request time, absorbing client clock skew while enforcing the 24-hour product limit.
- Every room message uses the parent room's `expiresAt`; no message can outlive the room.
- The client immediately hides expired rooms/messages and prevents joining or sending after expiry.
- A scheduled trusted processor runs every five minutes and physically deletes expired room messages, membership records, and the room. The processor is leased, paginated, retry-safe, and idempotent.
- A moderation snapshot of a reported room message is retained even when its room expires. Restore does not recreate an already-expired room.

### Timeline photo control

- The existing upload/compression/preview behavior remains unchanged.
- The visible **Add photo** control becomes a compact circular photo bubble beside the **Disappear** selector.
- It remains a keyboard-accessible label for the hidden file input, has an accessible name, and clearly shows the selected-photo state.

## Moderation architecture

### Collections

`reportIntakes/{reportId}` is the only report collection a normal signed-in user can create.

- `reporterUid`
- `targetKind`: `post`, `communityPost`, `roomMessage`, or `user`
- `targetCollection`
- `targetId`
- `targetPath`
- `reportedUserId`
- `reason`
- `createdAt`: server timestamp
- `status`: always `queued`

The document ID is deterministically derived from reporter UID, target kind, and target ID. Rules validate that the target exists, the reported author matches the target, the target kind and path are allowlisted, the reporter is not reporting themself, and all fields are exact. The client cannot attach or forge evidence.

`moderationCases/{caseId}` represents one canonical target and is written and read only by the trusted processor and protected administrators.

- immutable target and author metadata
- immutable authoritative snapshot copied from the referenced source
- aggregate report count and bounded reason totals
- `status`: `open`, `restored`, `deleteQueued`, or `expiredEvidence`
- `createdAt`, `updatedAt`, and processor audit timestamps
- when an action exists: exact `action`, `actionRequestedAt`, `actionRequestedBy`, `actionResult`, and `actionCompletedAt` fields

`moderationCases/{caseId}/reports/{reportId}` retains each immutable reporter/reason record. The case ID is derived from target kind and target ID, so repeated reports aggregate under one evidentiary snapshot rather than duplicating images or text.

`moderationActions/{caseId}` contains one administrator-requested action (`restore` or `deleteMaterial`) plus its lease/retry state. Normal users cannot read or write it.

### Processing

Every five minutes, the moderation processor:

1. leases queued intakes;
2. validates the current authoritative target;
3. copies a bounded immutable snapshot into a moderation case;
4. marks supported live material hidden and marks the intake `processed`, preserving duplicate-report detection;
5. leases administrator actions;
6. restores live material or permanently cascade-deletes it;
7. retains restored snapshots and their child report records for dashboard history until **Delete material permanently** is selected; a restore deletes processed intake receipts so a later recurrence can be reported again;
8. removes the case only after permanent content deletion succeeds;
9. deletes expired rooms and their child data;
10. updates a dashboard heartbeat and records only coded, non-identifying failures.

If a source was already deleted before intake processing, the intake is closed as unavailable without inventing evidence. If a reported temporary message expires after snapshotting, the case becomes `expiredEvidence` and remains reviewable.

### Administrator dashboard

The simplified single-page dashboard adds **Reported material** above general Content Moderation. Each case shows the material type, snapshot, reason, author, report time, and current state, without exposing authentication credentials or private direct-message content.

Available actions:

- **Restore material**: make still-live content visible and retain the case as restored history.
- **Delete material permanently**: run trusted cascade deletion, then remove the retained case/snapshot.
- **Ban user**: use the existing protected ban flow.
- **Delete user's profile**: use the existing immediate lock plus five-minute permanent account-deletion queue.

Protected administrator accounts cannot be banned or deleted through a moderation case. Buttons remain disabled while a matching action or account-deletion job is queued.

## Google Play policy surfaces

- Add public **Terms of Use**, **Privacy Policy**, and **Support** pages.
- Require new users to affirm they are at least 18 and accept the Terms and Privacy Policy before account creation.
- The Terms define prohibited content and behavior, moderation/reporting, blocking, temporary-room expiry, permanent deletion, and enforcement.
- The Privacy Policy describes Firebase Authentication email use, public and private UGC, images, push subscriptions, activity analytics, Spotify embeds, retention, reports, blocks, and account deletion.
- The delete-account page remains the public web account-deletion route used by the Play Data safety form.

## Security rules and indexes

- Only the reporter can read their own intake; only protected admins can list intakes/cases/actions.
- Normal clients cannot write snapshots, moderation results, processor leases, or privileged action fields.
- Block documents are owner-created/owner-deleted, exact-field, immutable records; self-blocking is denied.
- Cross-user follows, message requests, direct messages, reveals, and room messages are denied when either directional block exists.
- Hidden content is unreadable to normal users; administrators retain review access.
- Room creation and message creation must carry trusted timestamps and a bounded 24-hour expiry; expired writes are denied.
- Composite indexes cover report status/time and expiry scans. Deterministic block IDs avoid list queries for authorization checks.

## Testing

- Pure policy tests cover target normalization, report IDs/reasons, state transitions, block decisions, tie-break sorting, and 24-hour calculations.
- Firestore emulator tests prove allowed report/block operations and reject forged evidence, duplicate/self actions, non-admin resolutions, blocked interaction, expired-room activity, and hidden-content reads.
- Processor tests cover leases, pagination, retries, target deletion races, snapshot retention, restore, cascade deletion, room cleanup, and heartbeat behavior.
- UI tests cover all independent post renderers, every room-message report action, profile report/block actions, owner deletion, inline success/error feedback, and the compact photo bubble.
- Existing admin deletion, authentication, notifications, messaging, profile, cache, and deployment-policy tests remain green.

## Release order

1. Contracts, rules, indexes, processors, and workflow.
2. Admin moderation queue and actions.
3. Timeline/Profile/Community report, block, delete, ordering, expiry, and photo UI.
4. Terms, Privacy, Support, signup acknowledgement, service-worker cache update.
5. Full CI, independent review, merge, Firebase deployment, and production smoke test.
