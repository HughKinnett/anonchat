# Phase B Content and Discovery Design

Date: 2026-09-05
Status: Approved in chat; awaiting written-spec review
Repository: HughKinnett/anonchat

## Purpose

Phase B expands AnonChat's existing canonical post and comment system with editing, threaded replies, richer media, saved content, viewing history, hashtags/topics, discovery feeds, suggested follows, and recent searches. The design preserves the current web application as the source of truth and keeps Android parity through the existing Trusted Web Activity wrapper.

The core constraint is consistency: the same post, comment, reply, interaction count, edit state, media, moderation state, and visibility result must be shown everywhere that content appears. Phase B therefore extends the canonical content model rather than creating timeline-specific copies.

## Approved Scope

Phase B includes:

- Edit posts and comments with a public `Edited` indicator.
- Moderator/admin-only access to prior versions.
- One-level threaded replies.
- Up to four uploaded images per post, or one GIF per post.
- Copy post text.
- Private Saved posts screen.
- Private viewed-post history, capped at the most recent 100 posts.
- Hashtags and topic feeds.
- Trending feed based on a rolling 24-hour score.
- Popular Today feed for posts created during the current calendar day.
- Suggested follows using AnonChat public/social signals only.
- Private recent searches, capped at 20 entries.

Phase B does not include Phase C messaging/notification/preferences work or Phase D moderation/dashboard expansion.

## Architectural Approach

### Recommended approach: focused modules around the canonical content model

Keep existing canonical post/comment documents and current rendering flows as the source of truth. Add focused modules for:

1. editing and version history;
2. threaded replies;
3. post media sets;
4. saved posts and view history;
5. hashtag/topic indexing;
6. Trending and Popular Today ranking;
7. suggested follows;
8. recent searches.

This approach minimizes regression risk and prevents duplicate state across timelines, profiles, topic feeds, Saved, History, Trending, and Popular Today.

### Rejected alternatives

A full feed-layer rewrite would create a cleaner architecture in isolation but carries unnecessary regression risk across reactions, comments, profiles, moderation, and timeline behavior.

Adding all Phase B behavior directly into large existing timeline/profile files would be faster initially but would worsen coupling and make cross-feed consistency harder to guarantee and test.

## Canonical Content Rules

A post has one canonical document. Every feed or screen references and renders that canonical post rather than storing a separate editable copy.

A comment has one canonical document under the existing comment structure. Replies are canonical comment/reply documents associated with their top-level thread.

Any change to content must be visible consistently in all surfaces where the user is authorized to see it.

The existing post renderer should remain the shared rendering path wherever practical. Phase B may extract smaller renderer/helper modules when needed to keep code isolated and testable, but it should not create competing post-render implementations.

## Editing Model

### Permissions

- Users may edit only their own posts and comments.
- There is no edit time limit.
- Existing moderation and blocking rules continue to override ordinary ownership visibility.

### Public state

Edited content displays an `Edited` label to ordinary viewers.

Canonical content documents gain edit metadata such as:

- `editedAt`
- `editVersion`

The exact field naming may follow existing repository conventions during implementation, but the semantics above are required.

### Version history

Before replacing editable text or other tracked editable fields, the previous version is written to a history subcollection tied to the canonical content document.

History is readable only by authorized admins/moderators. Ordinary users cannot browse prior versions.

History entries must preserve enough information for moderation review, including the previous content value, timestamp, editor UID, and version number.

Editing a post must also update any derived hashtag/topic membership that depends on post text.

## Threaded Replies

Phase B supports one visible nesting level.

- Top-level comments can receive replies.
- Replies appear visually beneath the top-level comment.
- If a user replies to an existing reply, the new reply remains in the same top-level thread rather than creating deeper visual nesting.
- Reply counts and moderation actions refer to canonical reply documents.

This keeps mobile and TWA layouts readable and avoids arbitrarily deep reply trees.

## Post Media

A post may contain:

- up to four uploaded images; or
- one GIF.

Text may accompany either media type.

A GIF is treated as media content rather than a separate external embed surface.

Existing single-image posts must remain compatible without destructive migration.

The canonical post document stores media metadata used by every renderer so media order and type remain identical across timelines, profiles, topic feeds, Saved, History, Trending, Popular Today, and pinned-post views.

Invalid media combinations, including more than four images or an image set plus a GIF, must be rejected before write and by server-side/security validation where applicable.

## Copy Post Text

Visible posts provide a copy-text action when the post contains text.

Copying must operate only on text the current user is authorized to view. It must not expose hidden, blocked, deleted, or moderated-away content.

The UI should provide clear success/failure feedback and use the browser/TWA clipboard path appropriate to the current environment.

## Saved Posts

Saved posts are private per-user data and are not stored on the public post document.

A user's Saved collection is keyed by canonical post ID and stores only the metadata required to retrieve/order the saved item, such as saved timestamp and post reference/ID.

A saved item remains until the user removes it.

If the underlying post becomes deleted, blocked, moderated, or otherwise no longer visible, the Saved screen must omit it gracefully instead of rendering stale content.

Other users cannot see what a user has saved.

## Viewed-Post History

Viewed-post history is private per-user data.

It records the most recent 100 canonical post IDs with timestamps. When the limit is exceeded, older entries are removed or ignored so the effective history remains capped at 100.

Re-viewing a post should refresh its recency instead of creating duplicate visible history rows.

If a historical post is no longer visible because of deletion, moderation, privacy, or blocking, it is omitted from the rendered History screen.

History is not used as an input to suggested follows.

## Hashtags and Topics

Hashtags are parsed from post text on create and on edit.

Each normalized hashtag links to a topic feed that resolves back to canonical posts.

Editing a post must update its hashtag membership. Deleting, moderating, restoring, or changing visibility of a post must cause topic feeds to reflect the canonical post's current availability.

Topic indexing must not duplicate post bodies. Index entries should contain references/IDs and only the minimal metadata required for lookup/ranking.

Normalization rules should be deterministic and case-insensitive so variants such as `#Music` and `#music` resolve to the same topic.

## Trending

Trending represents activity over a rolling 24-hour window.

The ranking score uses only AnonChat activity and combines:

- post recency;
- unique interactions;
- comments;
- replies.

The implementation should use a simple weighted score that can operate within the current Firebase/Spark constraints. It must not require a new paid external trend service or a separate expensive analytics platform.

Repeated actions from one account should not be allowed to dominate ranking through simple duplication. Where existing canonical interaction records permit it, unique-user engagement should be preferred over raw event count.

Trending resolves to canonical posts and applies normal visibility, moderation, privacy, and blocking filters before display.

## Popular Today

Popular Today ranks individual posts created during the current calendar day.

The day boundary should follow the application's established date-handling convention. If no explicit application-wide timezone exists, implementation should define and consistently use one rather than mixing client-local boundaries across users.

Ranking uses current-day engagement signals from AnonChat and resolves to canonical posts.

Normal visibility, moderation, privacy, and blocking filters apply before display.

## Suggested Follows

Suggested follows use privacy-preserving AnonChat signals only:

- mutual follows;
- shared public topics;
- recent public interactions.

Suggested follows must exclude:

- the signed-in user;
- users already followed;
- blocked users in either direction;
- users otherwise hidden by existing safety/privacy rules.

Private messages, Saved posts, and private viewed-post history must not be used as recommendation inputs.

The recommendation logic should be deterministic enough to test and lightweight enough for the current Firebase architecture.

## Recent Searches

Recent searches are private per-user data capped at 20 entries.

Behavior:

- newest entries appear first;
- repeating a search moves that search to the top rather than creating a duplicate;
- users can remove one entry;
- users can clear all recent searches.

Other users cannot read another user's recent searches.

## UI Surfaces

Phase B behavior must remain consistent across:

- main/global timelines;
- profile timelines;
- pinned-post rendering;
- topic feeds;
- Trending;
- Popular Today;
- Saved;
- History;
- search results and relevant discovery surfaces.

The UI should reuse the canonical post renderer so the following do not diverge between surfaces:

- edited state;
- media gallery/GIF rendering;
- comment and reply counts;
- interaction totals;
- saved state;
- moderation/visibility state;
- canonical share/copy behavior.

Android parity is achieved through the production web UI inside the current Trusted Web Activity architecture. Phase B must be responsive and touch-friendly and must avoid desktop-only interaction patterns.

## Moderation and Visibility

Phase B does not create a parallel moderation system.

Existing report, restore, block, delete, and visibility rules continue to target canonical content IDs.

Additional Phase B rules:

- edit history is admin/moderator-only;
- edited/deleted/restored content updates all discovery surfaces through the canonical record/index relationship;
- blocked users are filtered from topic feeds, discovery, and suggested follows;
- deleted or hidden posts must not remain interactable through Saved or History;
- reply moderation applies to the canonical reply document;
- normal ownership and moderation rules remain enforceable in Firestore security rules, not only in the UI.

## Backward Compatibility and Migration

Existing posts and comments without Phase B fields remain valid.

Renderers must interpret missing Phase B metadata as the pre-Phase-B default state, for example:

- no `editedAt` means no Edited label;
- legacy single-image fields remain renderable;
- no reply metadata means a top-level legacy comment;
- no hashtag index entry does not invalidate the post itself.

Any migration needed for derived indexes should be additive and resumable. Phase B must not require destructive rewriting of existing user content.

## Error Handling

User-facing operations must fail safely and preserve canonical content.

Examples:

- if an edit-history write cannot be completed, the edit must not silently replace content without the required audit record;
- failed media uploads must not create a partially valid published post;
- failed bookmark/history/index writes must not corrupt the canonical post;
- stale/deleted post references in Saved, History, topics, or discovery feeds are skipped gracefully;
- clipboard failures show a clear failure message rather than claiming success;
- permission failures return normal access-denied behavior without exposing hidden content.

Where an operation spans canonical content plus derived indexes, implementation should favor idempotent/retry-safe updates and existing Firebase transaction/batch patterns where appropriate.

## Data and Firestore Cost Constraints

The design must remain compatible with the user's Firebase Spark/free-plan constraint.

To reduce unnecessary reads/writes:

- derived collections store IDs/references and minimal ranking metadata rather than duplicate post bodies;
- history and recent searches have explicit caps;
- suggested-follow computation uses bounded candidate sets;
- Trending/Popular calculations should avoid unbounded scans;
- canonical post fetches remain the final source for displayed content and authorization filtering.

Implementation may use precomputed lightweight counters/index documents when necessary, but must not introduce a paid-only dependency as a Phase B requirement.

## Testing Strategy

Phase B requires focused tests plus the existing regression suite.

### Editing

- owner can edit own post/comment;
- non-owner cannot edit;
- Edited indicator appears after edit;
- moderator/admin can read prior versions;
- ordinary users cannot read edit history;
- multiple edits preserve ordered version history;
- hashtag membership updates after text edit.

### Replies

- top-level comment accepts replies;
- reply-to-reply remains in same visible top-level thread;
- reply counts remain consistent across all post surfaces;
- reply permissions/moderation follow canonical rules.

### Media

- 1-4 images accepted;
- fifth image rejected;
- one GIF accepted;
- image-plus-GIF combination rejected;
- existing single-image posts still render correctly;
- media order is consistent across all surfaces.

### Saved and History

- Saved is private to owner;
- save/unsave is idempotent;
- History is private to owner;
- re-viewing moves a post to the top;
- effective History never exceeds 100 entries;
- hidden/deleted/blocked posts are omitted safely.

### Hashtags and Discovery

- hashtag normalization is case-insensitive and deterministic;
- create/edit/delete/restore produces correct topic membership;
- Trending includes only eligible recent posts;
- Popular Today includes only posts in the defined current-day window;
- blocked/hidden/moderated content is excluded;
- ranking inputs cannot be inflated by obvious duplicate interaction records where unique interaction data exists.

### Suggested Follows

- self is excluded;
- existing follows are excluded;
- blocks in either direction are excluded;
- public mutual/topic/interaction signals can generate candidates;
- Saved, History, and private messages are not used.

### Recent Searches

- private to owner;
- capped at 20;
- duplicate search moves to top;
- clear-one and clear-all work.

### Regression and platform coverage

- existing reactions/comments/interactions remain consistent across timelines;
- profile pinning continues to render the canonical post;
- share behavior continues to work;
- existing moderation flows continue to work;
- Firestore rules tests pass;
- browser smoke tests pass;
- responsive/TWA-critical flows are exercised for Android parity.

## Acceptance Criteria

Phase B is complete only when:

1. All approved Phase B features are implemented on the production web UI.
2. The same canonical content state appears consistently across every relevant feed/screen.
3. Android/TWA exposes the same Phase B behavior through the production web app.
4. Firestore rules enforce ownership, privacy, edit-history, Saved, History, and recent-search restrictions.
5. Existing Phase A functionality remains intact.
6. Focused Phase B tests and existing regression suites pass.
7. Production deployment is verified at the exact merged commit before completion is claimed.
8. Android build/package is verified separately from any Google Play Store publication; a successful Android build must not be described as Play Store deployment unless publication is independently verified.

## Out of Scope

The following are intentionally deferred:

- typing indicators;
- message reactions;
- reply-to-message;
- delete/unsend messaging behavior;
- stricter message-request privacy;
- persistent groups;
- notification-category switches;
- mentions;
- quiet hours;
- appearance settings;
- accessibility/text-size controls;
- temporary-chat reporting enhancements;
- stronger mute/block changes beyond Phase B filtering requirements;
- new admin subsystem-health views and emergency controls.

Those belong to later approved phases.
