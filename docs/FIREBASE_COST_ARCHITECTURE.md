# AnonChat Firebase cost architecture

## Objectives

- Preserve the current feed, reactions, polls, comments, profiles, following, notifications, private conversations, temporary rooms, moderation, and administration behavior.
- Make cost grow with a user's visible activity, not with the total size of the database.
- Never require a client to download an entire growing collection.
- Keep security enforcement in Firebase Security Rules and trusted processors.
- Make every migration additive and reversible until production verification finishes.

## Non-negotiable budgets

| Surface | Initial documents | Live listeners | Page size |
| --- | ---: | ---: | ---: |
| Timeline | 25 mobile / 60 desktop | Two bounded feed queries | 25 |
| Post interactions | 100 per visible post, opened on demand after the summary | Only visible posts | 100 |
| Profile posts | 60 | Two author-scoped queries | 30 |
| Followers/following | 50 | Target-user scoped only | 50 |
| User search/tag suggestions | 20 results | None while input is empty | 20 |
| Private conversation list | 50 recent conversations | Current user only | 25 |
| Open private conversation | 100 recent messages | One selected conversation | 50 |
| Temporary rooms | 50 recent active rooms | One bounded room list | 25 |
| Open temporary room | 100 recent messages | One selected room | 50 |
| Notification inbox | 50 recent unread/recent events | Current user only | 25 |
| Admin tables | 100 recent rows | Only active moderation queues | 100 |

Older records remain accessible through explicit **Load more** pagination. A page must never silently increase its query limit based on database size.

## Target collections

### Public content

- `posts/{postId}` and `communityPosts/{postId}` contain text, ownership, moderation state, timestamps, compact counters, and media references.
- `posts/{postId}/comments/{commentId}` and `reactions/{uid}` remain the source of truth.
- Parent documents contain write-time summaries: `commentCount`, `reactionCounts`, `pollVoteCount`, and `lastInteractionAt`.
- Summary counters are updated transactionally. The UI reads summaries in the feed and opens bounded detail queries only when requested.

### Profiles and connections

- `users/{uid}` contains small public profile metadata only.
- `follows/{followerUid_followingUid}` remains the source of truth.
- Each user document contains `followerCount` and `followingCount`, maintained transactionally.
- Followers/following pages query only the selected user's edges and page with `startAfter`; they never listen to all follows.
- Username/tag search uses normalized prefix fields and a limit of 20. It starts only after two typed characters and is debounced.

### Notifications

- `notificationEvents/{eventId}` is the single notification source for reactions, comments, tags, follows, room messages, and private messages.
- Each event has one recipient and a compact display payload. The client queries `recipientUid == currentUid`, ordered by `createdAt`, limited to 50.
- Read state is stored on the event or in a bounded per-user inbox. Do not scan posts, reactions, all room messages, and memberships to reconstruct the bell.
- Duplicate events use deterministic IDs so retries do not create duplicate writes or notifications.

### Private conversations

- `messageRequests/{pairId}` is the conversation header and authorization record.
- Messages stay in its `messages` subcollection.
- The conversation list uses a per-user membership/index record with `lastMessageAt`, unread count, and a safe preview; it does not listen to every message in every conversation.
- Only the selected conversation receives a live message listener.
- Deleting a chat updates visibility tombstones instead of repeatedly copying or rediscovering the full history.

### Temporary rooms

- Room membership is the authorization source.
- A compact per-member notification event replaces the global `roomMessages` listener.
- Only the open room listens to messages.
- `expiresAt` is the retention boundary. Firestore TTL should remove expired room messages, rooms, old notification deliveries, processor leases, and terminal queue receipts.

### Media

- Firestore documents must not contain new base64 photo payloads.
- New images go to Cloud Storage as compressed WebP/JPEG objects with a small thumbnail and a media metadata document.
- Feed/profile documents store only the object path, dimensions, moderation state, and thumbnail URL/path.
- Existing base64 images remain readable during migration. A background migration copies them to Storage, verifies hashes, writes references, and removes the old field only after verification.
- Profile and cover uploads replace the old object and delete the superseded object after the new reference commits.
- Storage Rules enforce owner paths, content types, and strict byte limits. App Check protects Storage and Firestore from scripted abuse.

## Read strategy

1. Use bounded queries with `limit` on every growing collection.
2. Use cursors, never offsets.
3. Keep live listeners only for currently visible, genuinely real-time data.
4. Unsubscribe on page hide, logout, profile change, room change, and conversation change.
5. Prefer one compact recipient notification query over reconstructing notifications from multiple global collections.
6. Fetch interaction identities only after the user clicks the count.
7. Do not use persistent web caching for private conversations on shared devices. Public-feed caching may be added separately after sensitive data is isolated.

## Write strategy

- Debounce presence and activity writes. `lastActiveAt` remains at most once per 24 hours; online presence remains once per app session.
- Count a page view once per browser session/day unless a true raw page-view metric is explicitly required.
- Use deterministic IDs for follows, votes, reactions, notification events, and processor jobs.
- Use transactions for one-reaction-per-user, one-vote-per-user, follow counters, and unread counters.
- Avoid fan-out writes proportional to total users. Fan-out is allowed only to actual recipients/members and must be capped/batched.

## Index policy

- Keep composite indexes only for production queries.
- Disable single-field indexing for large unqueried text and media fields.
- Never index base64 image data, message bodies, comment bodies, or poll option arrays.
- Add an index only with a matching bounded query and regression test.

## Admin analytics

- Replace full-collection admin listeners with daily summary documents under `analyticsDaily/{yyyy-mm-dd}` and a compact `system/currentStats` document.
- Store counts for users, posts, comments, reactions by type, follows, rooms, messages, reports, moderation outcomes, and page views.
- Keep paginated admin tables for inspecting individual users/content; summaries power charts and totals.
- Only moderation queues stay live, each filtered by actionable status and limited to 100.

## Retention

- Temporary room content: delete at `expiresAt`.
- View-once private images: delete immediately after the acknowledged reveal workflow or at a short fail-safe TTL.
- Delivered notification attempts and obsolete push endpoints: short TTL after terminal status.
- Completed processor leases/jobs: retain a compact audit record, remove bulky evidence according to the moderation retention policy.
- Public posts, comments, reactions, follows, and accepted private conversations: retain until user/admin deletion or the existing disappearing-content choice applies.

## Abuse and billing protection

- Enable App Check enforcement after monitoring valid traffic.
- Set Google Cloud budget alerts at 50%, 80%, and 100% of the owner-selected monthly budget. Budget alerts do not hard-stop Firebase.
- Add per-user rate-limit documents for post, comment, reaction, follow, report, upload, room, and message bursts.
- Reject oversized documents and uploads in Security Rules.
- Cap membership/fan-out sizes and processor batch sizes.
- Record daily operational counts, not a log entry for every page render.

## Rollout order

1. Deploy index exemptions and cost-regression tests.
2. Add summary fields alongside current source-of-truth records and backfill them idempotently.
3. Change feed/profile interaction displays to summaries; retain on-demand identity lists.
4. Replace global follows/users reads with scoped pagination and prefix search.
5. Switch the notification bell to recipient events and remove the global room-message listener.
6. Move new media to Storage, then migrate legacy base64 media in verified batches.
7. Switch admin totals to daily/current summaries and paginate all inspection tables.
8. Enable TTL policies and App Check after observing production compatibility.
9. Remove compatibility fields/listeners only after metrics and functional checks pass.

Every stage must pass existing security and behavior tests, include a rollback path, and be deployed separately so a billing optimization cannot take several features down at once.
