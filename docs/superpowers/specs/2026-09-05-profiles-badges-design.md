# Profiles + Badges Design

## Scope

This first expansion stage adds richer profile identity and a complete badge system, including automatic milestone awards, without enabling Stripe, Google Play Billing, or Firebase billing. It is intentionally centered on profile bio/about, visible badges, admin badge management, and a milestone-award engine so the larger expansion can remain independently testable.

## Goals

- Add an editable profile bio/about field.
- Add a visible Badges section to every user profile on web.
- Support original AnonChat badge artwork, names, descriptions, earned dates, and featured badges.
- Automatically award objective achievement badges when users cross configured milestones.
- Preserve manual/admin-only badges for staff, events, special recognition, and corrections.
- Let admins create, edit, activate/deactivate, assign, remove, inspect, and configure badge definitions.
- Keep membership/premium labeling separate from earned badges.
- Store badge data in a structure that the Android app can consume without a later migration.
- Preserve existing profile privacy, blocking, moderation, premium/free themes, comments, reactions, bookmarks, Spotify content, and follower behavior.

## Non-goals

- No payment processing or billing activation.
- No machine-learning or subjective reputation scoring for automatic awards.
- No redesign of unrelated timeline, messaging, notification, or discovery systems.
- No Android UI implementation in this stage; only Android-compatible data contracts.

## Existing integration points

The current profile surface is implemented through `profile.html`, `profile.js`, and shared profile/theme helpers. The current admin surface uses `admin.html`, `admin.css`, and its associated JavaScript/policy modules. Firestore security is governed by `firestore.rules`, and regression coverage lives under `scripts/`.

The existing `profile-membership-badge` remains the subscription/membership indicator. Achievement badges are rendered in a separate profile section so users do not confuse Premium/Member state with earned recognition.

## Data model

### `badgeTypes/{badgeId}`

Fields:

- `name: string` — 1 to 60 characters.
- `description: string` — 1 to 280 characters.
- `imageUrl: string` — HTTPS asset URL for the badge artwork.
- `category: string` — one of `early_supporter`, `staff`, `contributor`, `popular_post`, `community_helper`, `long_time_member`, `premium`, `event`, `milestone`, `special`.
- `awardMode: string` — `automatic` or `manual`.
- `milestoneMetric: string|null` — metric key used by automatic awards.
- `milestoneThreshold: number|null` — numeric threshold for automatic awards.
- `active: boolean` — inactive badge types remain visible on profiles where previously earned but cannot be newly assigned or automatically awarded.
- `createdAt: timestamp`.
- `updatedAt: timestamp`.
- `createdBy: uid`.

Manual badges must have `milestoneMetric = null` and `milestoneThreshold = null`. Automatic badges must use one supported metric and a positive threshold, except fixed-condition metrics such as `premium_active` and `early_member`, whose qualifying condition is defined by policy.

### `users/{uid}/badges/{badgeId}`

Fields:

- `badgeId: string` — must match the document ID.
- `earnedAt: timestamp`.
- `assignedAt: timestamp`.
- `assignedBy: uid|string` — admin UID for manual assignments, or `system` for automatic awards.
- `awardSource: string` — `automatic` or `manual`.
- `featured: boolean`.

The assignment document does not duplicate badge name, description, or artwork. Profiles resolve assignments against `badgeTypes`, so administrators can update presentation metadata globally while preserving each user’s earned date.

### `users/{uid}` profile additions

- `bio: string` — optional, maximum 300 characters after trimming.

No billing-related field is introduced by this stage.

## Supported automatic milestone metrics

The initial automatic badge engine supports these objective metrics:

- `posts_created`
- `single_post_interactions`
- `total_interactions_received`
- `comments_received`
- `comments_or_replies_created`
- `followers_count`
- `account_age_days`
- `early_member`
- `premium_active`

The initial badge catalog is:

- **First Post** — `posts_created >= 1`.
- **Contributor** — `posts_created >= 10`.
- **Top Contributor** — `posts_created >= 100`.
- **Community Favorite** — any one post reaches `25` interactions.
- **Popular Creator** — `total_interactions_received >= 100`.
- **Conversation Starter** — `comments_received >= 25`.
- **Community Helper** — `comments_or_replies_created >= 50`.
- **Connected** — `followers_count >= 25`.
- **Well Known** — `followers_count >= 100`.
- **Long-Time Member** — `account_age_days >= 365`.
- **Early Member** — account creation date is at or before the fixed AnonChat launch cutoff configured in the badge policy.
- **Premium Member** — current premium-access record is active.

Admins may create future automatic milestone badges using the supported metrics and configurable thresholds. New metric types require code/policy support rather than arbitrary executable conditions stored in Firestore.

## Automatic award architecture

Automatic awarding is handled by a focused milestone policy/evaluator rather than by profile rendering code.

The evaluator receives a user ID plus the metric(s) affected by the current activity. It loads active automatic badge definitions for those metrics, resolves current counters/state from the canonical AnonChat data model, and writes any newly satisfied assignments.

Awards are idempotent: `users/{uid}/badges/{badgeId}` is the unique award record. If it already exists, evaluation does not overwrite the original `earnedAt` or create a duplicate.

Automatic evaluation is triggered from canonical activity paths:

- successful original post creation → evaluate `posts_created` and, where applicable, creator totals;
- new reaction/comment/interaction on a post → evaluate `single_post_interactions`, `total_interactions_received`, and `comments_received` for the post author;
- new comment/reply creation → evaluate `comments_or_replies_created` for the author;
- successful follow creation/removal → evaluate `followers_count` for the followed user;
- premium access state change or authenticated premium-state reconciliation → evaluate `premium_active`;
- account creation/login/profile initialization → evaluate `early_member` and `account_age_days`;
- a bounded scheduled/periodic reconciliation may evaluate `account_age_days` so users can receive Long-Time Member without needing unrelated activity on the anniversary date.

The implementation must use existing canonical collections/counting conventions and avoid creating divergent per-timeline counters.

## Award timing and earned dates

For event-driven milestones, `earnedAt` is the server timestamp of the first successful evaluation after the threshold is crossed.

For account-age milestones, `earnedAt` should represent the first award evaluation at or after eligibility. It does not need to backdate exactly to the anniversary if the evaluator runs later.

For idempotency, a previously earned badge keeps its original `earnedAt` even if the user later falls below a reversible threshold such as follower count.

## Revocation and threshold reversal

Automatic milestone badges are achievements, not live status indicators. Once earned, they remain earned if a count later drops below the threshold.

Exceptions:

- Admins may manually remove an award for moderation/correction reasons.
- `Premium Member` is treated as an achievement badge in this stage once awarded; the separate existing membership badge remains the live premium/member state indicator.
- Deactivating a badge type stops future awards but does not remove existing assignments.

## Security and permissions

- Signed-in users may read active badge definitions.
- Signed-in users may read badge assignments for profiles they are otherwise allowed to view.
- Regular users cannot directly create, edit, assign, feature, or remove badges.
- Only designated admins may manage `badgeTypes` and manually manage user badge assignments.
- Automatic badge writes must occur through trusted application/server-controlled paths or tightly validated transactional rules; client users must never be able to self-award by writing badge assignments directly.
- A user may edit only their own `bio`, subject to length/type validation and the repository’s existing user-document protections.
- Blocking/privacy behavior continues to suppress protected profile details. If a profile is unavailable because of block state, its bio and badges are not displayed.
- Admin-only fields and automatic award metadata are not editable from profile UI.

## Profile experience

### Bio/About

- The owner’s profile editing experience exposes a multiline About/Bio input.
- Save trims surrounding whitespace.
- Empty content removes/clears the bio.
- Profile view renders the bio beneath identity/membership content and above profile feed content.
- Text is rendered as text, not raw HTML.

### Badge section

- Add a `Badges` section to the user profile.
- Badge artwork is visually prominent enough to identify without opening details.
- Show featured badges first, then remaining badges by newest earned date.
- The collapsed profile view shows up to four badges.
- If more than four exist, show `View all badges`.
- If a user has no badges, do not show an empty public badge gallery; the owner may see a small empty-state message.
- Inactive badge types remain visible to users who already earned them; they are not newly assignable or automatically awarded.

### Badge detail interaction

Clicking/tapping a badge opens a detail dialog containing:

- badge artwork,
- badge name,
- description,
- earned date.

The dialog closes through its close control, Escape, or clicking outside when supported by the existing modal patterns.

## Featured badges

- Admins control the `featured` flag on assignments.
- A profile may feature at most three badges.
- If an admin attempts to feature a fourth badge, the operation is rejected with a clear admin message.
- Featured badges appear first in the profile badge section.

## Admin experience

Add a `Badges` management area to the existing task-first admin dashboard.

### Badge type management

Admins can:

- create a badge type,
- choose `automatic` or `manual` award mode,
- for automatic badges, select a supported milestone metric and threshold,
- edit name/description/category/artwork URL,
- activate/deactivate a badge type,
- inspect creation/update metadata.

Badge artwork is referenced by URL in this stage. Existing project image-hosting/upload mechanisms may be reused if present, but the badge system itself does not introduce a new binary-storage subsystem.

### Assignment management

Admins can:

- search/select a user,
- view that user’s badge assignments,
- see whether each badge was earned automatically or assigned manually,
- manually assign an active badge,
- remove a badge,
- mark/unmark an assignment as featured,
- see the earned date and assigning admin/system source.

Assigning an already-earned badge is idempotent: the existing assignment is preserved instead of creating a duplicate.

## Rendering and compatibility

Badge rendering logic should be isolated in a focused module rather than expanding `profile.js` with all badge-specific formatting and sorting logic. Automatic milestone evaluation should likewise live in a dedicated policy/evaluator module rather than in timeline/profile DOM code.

The Firestore document shapes use only primitives and timestamps so the same collections can be consumed by the Android app later without data migration.

## Error handling

- Profile badge load failure shows a non-destructive profile status message and leaves the rest of the profile usable.
- Missing/deleted badge definitions are ignored rather than breaking profile rendering.
- Invalid artwork URLs fall back to a local AnonChat badge placeholder.
- Admin writes surface clear success/failure messages and never silently fail.
- Permission failures are treated as authorization errors, not retried indefinitely.
- Automatic award evaluation failures must not block the originating post/comment/follow interaction from succeeding; failed evaluations are retryable through the next qualifying evaluation or reconciliation pass.
- Duplicate/concurrent evaluators must resolve safely to one assignment document without resetting `earnedAt`.

## Testing

Add focused regression tests under `scripts/` for:

- badge schema/policy validation,
- `automatic` vs `manual` award modes,
- supported metric validation and threshold validation,
- automatic evaluator qualification for every initial milestone,
- idempotent awarding and preserved `earnedAt`,
- no self-award capability for regular users,
- event-to-metric routing for posts, interactions, comments/replies, follows, premium status, and account age,
- threshold reversal not removing previously earned achievement badges,
- inactive automatic badges not receiving new awards,
- Firestore rules for badge definitions and assignments,
- profile bio validation and safe rendering contract,
- badge ordering (featured first, then newest earned),
- four-badge collapsed limit and `View all badges` behavior,
- badge detail content,
- featured badge maximum of three,
- admin-only mutation protection,
- inactive badge visibility vs assignment restrictions,
- blocked/unavailable profile hiding bio and badges,
- existing profile, comment, reaction, interaction-consistency, and runtime-budget regression suites remaining green.

## Rollout

1. Add/extend badge policy and data helpers with automatic-award metadata and failing tests.
2. Add milestone evaluator and failing tests for all initial milestone rules.
3. Add Firestore/trusted-write protections and rules tests.
4. Add event hooks/reconciliation triggers for automatic evaluation.
5. Add profile bio support.
6. Add public profile badge rendering and badge details.
7. Add admin badge type management, including automatic/manual configuration.
8. Add admin assignment/featured management.
9. Run the full relevant regression suite.
10. Deploy web only after tests pass.

Android UI work remains a later parity stage, but it will consume the same `badgeTypes` and `users/{uid}/badges` structures defined here.

## Acceptance criteria

- A profile owner can save/clear a bio of up to 300 characters.
- Visitors can see earned badge artwork and details on an accessible profile.
- The first profile view shows no more than four badges and exposes `View all badges` when needed.
- Up to three badges can be featured and featured badges sort first.
- The twelve approved initial milestone badges are automatically awarded when their criteria are met.
- Automatic awards are idempotent and preserve the first `earnedAt`.
- Falling below a reversible count threshold does not remove an already-earned achievement badge.
- Admins can create automatic or manual badge types and configure supported milestone thresholds.
- Admins can manually manage user assignments and featured badges.
- Non-admin users cannot directly award themselves badges or mutate definitions/assignments.
- Blocked/unavailable profiles do not leak bio or badge data through the UI.
- Existing membership/Premium status remains separate from achievement badges.
- No billing provider is connected or activated.
- Existing relevant regression tests continue to pass.
