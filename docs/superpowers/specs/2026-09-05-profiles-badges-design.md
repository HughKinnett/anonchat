# Phase A — Profiles, Identity, Privacy, Sharing, Pins, and Badges Design

## Scope

Phase A expands the existing profile and badge work into a complete cross-platform identity subsystem for AnonChat. It preserves the existing badge engine and admin badge tooling while adding pinned posts, profile sharing, QR profile cards, granular profile privacy controls, polished badge presentation, and Android UI parity.

This phase must be independently testable and deployable before Phase B begins.

## Goals

- Let users pin and unpin their own posts on their profile.
- Add a profile share action using the canonical public profile URL.
- Add a QR profile card that encodes only the canonical public profile URL.
- Add granular privacy controls for profile posts, badges, followers/following, and activity.
- Preserve existing blocking behavior as a stronger access restriction than privacy preferences.
- Keep the existing achievement badge system and improve its profile presentation.
- Preserve automatic and manual badge awards, earned dates, featured badges, and admin badge management.
- Add the same profile, privacy, sharing, pinned-post, and badge experience to the Android app using the same Firestore contracts.
- Keep the existing membership/Premium indicator separate from achievement badges.
- Add admin visibility for profile/privacy/pinning/badge subsystem status without exposing private user data unnecessarily.

## Non-goals

- No follow-approval/private-account request system in Phase A.
- No payment processing or billing activation.
- No redesign of unrelated messaging, notification, discovery, timeline ranking, or comment systems.
- No arbitrary executable badge rules stored in Firestore.

## Existing integration points

The current web profile surface uses `profile.html`, `profile.js`, shared profile/theme helpers, Firestore-backed user data, and existing privacy/blocking behavior. The admin surface uses the task-first admin dashboard and badge modules including `admin-badges.js`, `badge-policy.mjs`, `badge-firestore.mjs`, `badge-awards.mjs`, `badge-award-processor.mjs`, `badge-milestones.mjs`, and related tests.

The current badge implementation already supports badge definitions, user assignments, automatic milestone evaluation, featured badges, and public profile rendering. Phase A extends rather than duplicates that system.

The Android app must consume the same canonical Firestore fields and collections so web and Android display the same profile state.

## Profile privacy model

Phase A uses granular visibility controls rather than a follower-approval system.

### `users/{uid}.profilePrivacy`

Store a map with these boolean fields:

- `showPosts`
- `showBadges`
- `showFollowersFollowing`
- `showActivity`

Defaults for existing and new users are `true` for all four fields.

Rules:

- The profile identity header remains viewable when the profile itself is otherwise accessible.
- `showPosts = false` hides the profile post feed from other users.
- `showBadges = false` hides achievement badges from other users.
- `showFollowersFollowing = false` hides follower/following counts and lists from other users.
- `showActivity = false` hides profile-level recent activity surfaces from other users.
- The profile owner can always see their own hidden sections and sees a clear private/hidden indicator.
- Admin moderation tooling may access data through existing admin-authorized paths when required for safety/moderation.
- Blocking overrides these settings. A blocked/unavailable profile must not leak sections merely because a privacy flag is true.
- Privacy settings must be enforced in UI queries/rendering and in Firestore access rules wherever direct collection access would otherwise expose hidden data.

## Pinned posts

### Data model

Use a single pinned post reference on the user document:

- `pinnedPostId: string|null`

Constraints:

- Only the profile owner may change their `pinnedPostId`.
- The referenced post must be authored by that user and must still exist.
- A user may have at most one pinned post in Phase A.
- Pinning a new post replaces the previous pin.
- Deleting the pinned post clears or safely ignores the stale reference.
- A hidden profile post feed also hides the pinned post from other users.

### User experience

- The owner sees `Pin to profile` / `Unpin from profile` on eligible own posts.
- A visible pinned post is labeled `Pinned` and appears above the normal profile feed.
- The pinned post uses the same canonical post renderer and interaction counts as every other timeline; it must not create a duplicate post data model.
- If a referenced post is missing or unavailable, the profile renders normally without an error-blocking state.

## Profile share and QR card

### Canonical URL

All share and QR actions use the same canonical public profile URL already supported by AnonChat routing. No private tokens, internal Firestore IDs beyond the existing public route identifier, session data, or analytics secrets are encoded in the QR payload.

### Share action

- Web uses the Web Share API where available and falls back to copying the canonical profile link.
- Android uses the native Android share sheet.
- Share text identifies the profile as an AnonChat profile without exposing hidden profile sections.

### QR profile card

- Provide a `QR` or `Profile QR` action on the profile.
- Show a clean AnonChat-branded card containing the QR code, display name/username allowed by the existing identity model, and a short `Scan to view profile` message.
- The QR code resolves to the same canonical profile URL as the share action.
- QR rendering must work offline once the profile URL is known; it must not depend on a third-party QR tracking service.
- Users can close the QR card using the existing modal/sheet interaction conventions.

## Badge system

### Existing data model

Keep the current structures:

#### `badgeTypes/{badgeId}`

Fields include:

- `name`
- `description`
- `imageUrl`
- `category`
- `awardMode`
- `milestoneMetric`
- `milestoneThreshold`
- `active`
- creation/update metadata

#### `users/{uid}/badges/{badgeId}`

Fields include:

- `badgeId`
- `earnedAt`
- `assignedAt`
- `assignedBy`
- `awardSource`
- `featured`

Do not duplicate badge name, description, or artwork into assignment documents.

### Badge presentation

- Add/retain a clearly labeled `Badges` section on every accessible profile when badges are visible under privacy settings.
- Show badge artwork as a primary visual element, not text-only labels.
- Featured badges appear first.
- Up to three assignments may be featured.
- The collapsed profile view shows up to four badges.
- If more exist, show `View all badges`.
- Tapping/clicking a badge opens a detail view with image, name, description, earned date, and award category/source where appropriate.
- Inactive badge definitions remain visible to users who already earned them but are not newly assignable/awarded.
- Missing or invalid artwork uses a local AnonChat fallback badge image.
- Original AnonChat artwork must be used; no copied Facebook/Reddit badge artwork.

### Initial badge categories

Retain support for:

- Early supporter / early member
- Verified admin / moderator
- Top contributor
- Popular post creator
- Community helper
- Long-time member
- Premium member
- Event / milestone / special achievement

### Automatic badge engine

Retain the current objective milestone system and idempotent award behavior. Supported metrics include the existing post, interaction, comment/reply, follower, account-age, early-member, and premium-active metrics.

Automatic awards remain achievements: falling below a reversible threshold does not remove an already-earned badge. Admins may remove awards for moderation/correction purposes.

## Admin dashboard

Extend the existing badge management and task-first admin dashboard with Phase A status and controls.

Admins can:

- create/edit/activate/deactivate badge types;
- choose automatic or manual award mode;
- configure supported milestone thresholds;
- assign/remove badges;
- feature/unfeature user badges;
- see which users have which badges;
- inspect pinning/privacy subsystem health counts without exposing hidden content in aggregate views;
- inspect failed badge-award/reconciliation operations where supported by the existing health framework;
- disable new badge awarding through a safe feature switch if a production issue occurs;
- disable profile QR rendering or profile pin mutations through safe emergency feature switches if a production issue occurs.

Admins must not be able to silently change a regular user's privacy preferences from ordinary badge/profile management controls. Any moderation-specific override must use existing explicit moderation workflows.

## Android parity

Phase A is not complete until Android exposes the same user-facing capabilities:

- pinned post display and owner pin/unpin controls;
- profile share through Android share sheet;
- profile QR card;
- privacy switches for posts, badges, followers/following, and activity;
- badge preview, `View all badges`, featured ordering, and badge details;
- correct hiding of sections according to privacy/block state;
- admin badge/profile controls available to admin accounts through the existing Android admin-dashboard access pattern where that control is already exposed cross-platform.

Android must use the same Firestore fields and badge collections as web and must not create an Android-only copy of profile state.

## Security and permissions

- Users may edit only their own profile privacy map and pinned post reference.
- Users cannot pin another user's post or a post they did not author.
- Regular users cannot create/edit/assign/remove/feature badge definitions or awards.
- Badge writes remain limited to trusted automatic-award paths and admin-authorized operations.
- Hidden profile sections must not be re-exposed through alternate profile components.
- Blocking remains authoritative over all profile section visibility.
- Share and QR payloads contain only the canonical public profile URL.
- Text content is rendered as text rather than raw HTML.

## Error handling

- A failed pinned-post lookup does not break profile rendering.
- A failed QR render leaves the share-link action usable and shows a clear retryable error.
- Clipboard/share API failure surfaces a concise status message rather than silently failing.
- Privacy preference write failure restores the previous visible switch state and reports the failure.
- Badge load failure leaves the rest of the profile usable.
- Missing/deleted badge definitions are ignored safely.
- Permission failures are treated as authorization failures, not endlessly retried.
- Automatic badge evaluation failure never blocks the originating post/comment/follow action.

## Testing

Add or extend focused regression coverage for:

- privacy defaults for existing/new users;
- owner-only privacy mutation;
- posts hidden when `showPosts` is false;
- badges hidden when `showBadges` is false;
- followers/following hidden when `showFollowersFollowing` is false;
- activity hidden when `showActivity` is false;
- owner visibility of their own hidden sections;
- block state overriding privacy settings;
- one-pin maximum;
- owner-only pin/unpin;
- preventing pins to posts authored by another user;
- replacing an existing pinned post;
- stale/deleted pinned post handling;
- pinned post rendered from the canonical post source;
- canonical share URL consistency;
- QR payload equals the canonical share URL;
- QR/share payload contains no private tokens/session data;
- Web Share API fallback to clipboard;
- badge ordering, four-badge preview, and `View all badges`;
- badge detail contents;
- featured badge maximum of three;
- automatic/manual badge policy validation;
- idempotent badge awarding and preserved `earnedAt`;
- admin-only badge mutation protection;
- emergency feature-switch behavior;
- Android contract/UI tests for privacy, pinning, share/QR, and badges;
- existing profile, comments, reactions, interaction consistency, messaging, notification, admin, and mobile-layout regressions remaining green.

## Rollout and deployment

1. Preserve and regression-test the existing badge engine before touching profile behavior.
2. Add privacy data policy and tests.
3. Add pinned-post policy/data helpers and tests.
4. Add web privacy controls and profile section enforcement.
5. Add web pinned-post controls and rendering.
6. Add web share and QR card.
7. Polish web badge rendering/details and admin status controls.
8. Add Android parity using the same contracts.
9. Run focused and full relevant regression suites.
10. Build Android and run Android-specific checks.
11. Deploy Phase A web changes only after tests pass.
12. Produce the Android package/build artifact through the existing workflow only after Android checks pass.
13. Verify deployment/build status before declaring Phase A complete.
14. Begin Phase B only after Phase A is successfully deployed/packaged.

## Acceptance criteria

Phase A is complete only when all of the following are true:

- A user can pin exactly one of their own posts and visitors see it above the profile feed when posts are visible.
- A user can unpin or replace the pinned post.
- Profile sharing uses the canonical AnonChat profile URL on web and Android.
- A profile QR card encodes the same canonical profile URL and no private session data.
- Users can independently control visibility of posts, badges, followers/following, and activity.
- Owners can still see their own hidden sections with a clear hidden/private indicator.
- Blocking overrides granular visibility settings.
- Accessible profiles show earned badge artwork with featured badges first, up to four in preview, and `View all badges` when needed.
- Badge detail views show image, name, meaning/description, and earned date.
- Existing automatic badge awards remain idempotent and preserve the first earned date.
- Admins retain complete badge type/assignment management and gain Phase A health/emergency controls.
- Web and Android use the same profile/privacy/pin/badge data contracts.
- Android exposes the same Phase A user experience.
- Relevant regression suites pass.
- Web deployment succeeds and the Android build/package succeeds before work starts on Phase B.
