# Profiles + Badges Design

## Scope

This first expansion stage adds richer profile identity and a complete badge system without enabling Stripe, Google Play Billing, or Firebase billing. It is intentionally limited to profile bio/about and badges so the larger expansion can be implemented in independent, testable stages.

## Goals

- Add an editable profile bio/about field.
- Add a visible Badges section to every user profile on web.
- Support original AnonChat badge artwork, names, descriptions, earned dates, and featured badges.
- Let admins create, edit, activate/deactivate, assign, remove, and inspect badge assignments.
- Keep membership/premium labeling separate from earned badges.
- Store badge data in a structure that the Android app can consume without a later migration.
- Preserve existing profile privacy, blocking, moderation, premium/free themes, comments, reactions, bookmarks, Spotify content, and follower behavior.

## Non-goals

- No payment processing or billing activation.
- No automated badge-award engine in this stage. Badge assignment is admin-controlled, though the schema allows future automation.
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
- `active: boolean` — inactive badge types remain visible on profiles where previously earned but cannot be newly assigned.
- `createdAt: timestamp`.
- `updatedAt: timestamp`.
- `createdBy: uid`.

### `users/{uid}/badges/{badgeId}`

Fields:

- `badgeId: string` — must match the document ID.
- `earnedAt: timestamp`.
- `assignedAt: timestamp`.
- `assignedBy: uid`.
- `featured: boolean`.

The assignment document does not duplicate badge name, description, or artwork. Profiles resolve assignments against `badgeTypes`, so administrators can update presentation metadata globally while preserving each user’s earned date.

### `users/{uid}` profile additions

- `bio: string` — optional, maximum 300 characters after trimming.

No billing-related field is introduced by this stage.

## Security and permissions

- Signed-in users may read active badge definitions.
- Signed-in users may read badge assignments for profiles they are otherwise allowed to view.
- Regular users cannot create, edit, assign, feature, or remove badges.
- Only designated admins may manage `badgeTypes` and user badge assignments.
- A user may edit only their own `bio`, subject to length/type validation and the repository’s existing user-document protections.
- Blocking/privacy behavior continues to suppress protected profile details. If a profile is unavailable because of block state, its bio and badges are not displayed.
- Admin-only fields (`assignedBy`, assignment state, inactive badge management) are not editable from profile UI.

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
- Inactive badge types remain visible to users who already earned them, marked only by their existing name/artwork; they are not newly assignable.

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
- edit name/description/category/artwork URL,
- activate/deactivate a badge type,
- inspect creation/update metadata.

Badge artwork is referenced by URL in this stage. Existing project image-hosting/upload mechanisms may be reused if present, but the badge system itself does not introduce a new binary-storage subsystem.

### Assignment management

Admins can:

- search/select a user,
- view that user’s badge assignments,
- assign an active badge,
- remove a badge,
- mark/unmark an assignment as featured,
- see the earned date and assigning admin.

Assigning an already-earned badge is idempotent: the existing assignment is preserved instead of creating a duplicate.

## Rendering and compatibility

Badge rendering logic should be isolated in a focused module rather than expanding `profile.js` with all badge-specific formatting and sorting logic. The module should expose pure helpers for sorting, limiting, and formatting badge models, plus a small Firestore-facing adapter used by profile/admin surfaces.

The Firestore document shapes use only primitives and timestamps so the same collections can be consumed by the Android app later without data migration.

## Error handling

- Profile badge load failure shows a non-destructive profile status message and leaves the rest of the profile usable.
- Missing/deleted badge definitions are ignored rather than breaking profile rendering.
- Invalid artwork URLs fall back to a local AnonChat badge placeholder.
- Admin writes surface clear success/failure messages and never silently fail.
- Permission failures are treated as authorization errors, not retried indefinitely.

## Testing

Add focused regression tests under `scripts/` for:

- badge schema/policy validation,
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

1. Add policy/data helpers and failing tests.
2. Add Firestore rules and rule tests.
3. Add profile bio support.
4. Add public profile badge rendering and badge details.
5. Add admin badge type management.
6. Add admin badge assignment/featured management.
7. Run the full relevant regression suite.
8. Deploy web only after tests pass.

Android UI work remains a later parity stage, but it will consume the same `badgeTypes` and `users/{uid}/badges` structures defined here.

## Acceptance criteria

- A profile owner can save/clear a bio of up to 300 characters.
- Visitors can see earned badge artwork and details on an accessible profile.
- The first profile view shows no more than four badges and exposes `View all badges` when needed.
- Up to three badges can be featured and featured badges sort first.
- Admins can manage badge types and user assignments from the admin dashboard.
- Non-admin users cannot mutate badge definitions or assignments.
- Blocked/unavailable profiles do not leak bio or badge data through the UI.
- Existing membership/Premium status remains separate from achievement badges.
- No billing provider is connected or activated.
- Existing relevant regression tests continue to pass.
