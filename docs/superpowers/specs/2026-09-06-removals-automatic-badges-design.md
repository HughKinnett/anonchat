# Removals and Automatic Badges Design

## Goal

Remove Groups, Interest Communities, the raw GIF URL composer control, and all admin badge-authoring capabilities while replacing badges with a fixed, automatic, system-owned milestone badge system that matches the approved dark neon AnonChat visual direction.

## Product decisions

- Groups are removed completely from the product.
- Interest Communities are removed completely from the product.
- Existing Groups/Interest Communities records, memberships, and feature-specific records are deleted as part of the production cleanup rather than left active or hidden.
- Temporary Rooms remain unchanged.
- Premium encrypted rooms remain unchanged.
- Private messaging remains unchanged.
- The timeline raw `GIF URL` field is removed.
- Normal photo upload remains.
- Badge definitions are fixed by AnonChat code and artwork, not created or edited by admins.
- Earned badges are automatic and immutable.
- Admins may view badge status for support/moderation context but cannot create, edit, assign, remove, disable, replace, or otherwise alter badge definitions or earned badge records.
- Users cannot self-award or alter badge records.
- Once a badge is earned it stays with the account permanently, including Premium Member after a user has qualified.
- Badge award writes must be server-controlled, deterministic, and idempotent.

## Removal architecture

### Groups

Remove the complete Groups subsystem, including:

- shared navigation entries;
- `groups.html` and group detail/private group surfaces;
- Groups controllers and Firestore adapters;
- public and private group creation, membership, invitations, moderation, posts/messages, and encrypted private-group flows;
- Groups-specific Firestore rules and rule patchers;
- Groups-specific service-worker cache entries;
- Groups-specific tests and CI hooks;
- discovery/feed references that read from Groups;
- stored `groups/*` documents and nested memberships/messages/related records during a controlled production cleanup.

No Groups route should remain reachable after deployment.

### Interest Communities

Remove the complete Interest Communities subsystem, including:

- shared navigation entries;
- `communities.html` and `community-detail.html` interest-community surfaces;
- Communities controllers and Firestore adapter/policy modules;
- interest-community membership, moderators, rules, pinned content, polls, community-specific badges, and community-specific discussions;
- Communities-specific Firestore rules and rule patchers;
- Communities-specific service-worker cache entries;
- Communities-specific tests and CI hooks;
- discovery/feed references that read from Interest Communities;
- stored `communities/*` documents and nested memberships/content/badges during a controlled production cleanup.

The existing `community.html` Temporary Rooms surface is not the same subsystem and must remain.

### GIF URL composer control

Remove the raw `GIF URL` input from the timeline composer and all UI copy that tells users to paste GIF URLs. Normal image upload remains. The post/media policy may continue to understand historical GIF media already stored on existing posts so old content does not break, but the composer must not expose a raw URL-based GIF creation path.

## Automatic badge architecture

### Ownership and permissions

Badge definitions and award rules are product-owned code/configuration. There is no admin authoring path.

Admins are read-only observers of badge status. They cannot:

- create badge types;
- edit badge types;
- upload or select replacement badge artwork;
- manually assign badges;
- remove badges;
- disable badge families;
- disable automatic awards;
- feature/unfeature badges on behalf of a user;
- rewrite earned dates or milestone context.

Users cannot write badge definitions or earned badge records directly.

### Earned badge records

Reuse the existing per-user badge storage path where practical for compatibility. Each automatic award record must contain a stable badge ID, an earned timestamp, and an automatic/system source. Awarding is idempotent: running the evaluator again cannot duplicate an already-earned badge.

Existing valid earned records should be migrated or rendered through a safe legacy compatibility layer rather than silently disappearing.

### Initial badge families

The fixed AnonChat catalog includes:

1. Early Member
2. Early Supporter
3. Verified Admin
4. Verified Moderator
5. Top Contributor
6. Popular Post Creator
7. Community Helper
8. Long-Time Member
9. Premium Member
10. Special Achievement

`Community Helper` refers to constructive participation in the overall AnonChat user community and must not depend on the removed Interest Communities feature.

### Tier progression

Repeatable milestone families may use the approved progression:

- Spark
- Pulse
- Beacon
- Legend

Tier styling communicates progression without relying on color alone.

### Visual direction

Production badge artwork follows the approved AnonChat visuals:

- deep charcoal/navy base;
- neon purple and electric blue accents;
- selective soft gold for high-prestige awards;
- crisp, large, readable icons;
- subtle glow and depth;
- original AnonChat iconography rather than copied Facebook/Reddit badge art;
- cohesive collectible-emblem treatment across all badge families.

Representative icon direction:

- Early Member: shooting star/spark;
- Early Supporter: heart/ribbon;
- Verified Admin: shield/crown;
- Verified Moderator: shield/check;
- Top Contributor: trophy/laurel;
- Popular Post Creator: post/trending spark;
- Community Helper: helping hands/chat bubble;
- Long-Time Member: hourglass/calendar;
- Premium Member: gem/crystal with prestige framing;
- Special Achievement: comet/medal/star.

### Profile experience

Profiles contain a prominent `Badges` section on web and Android/TWA surfaces.

The section must:

- show actual badge artwork, not text-only labels;
- keep icons large enough to recognize;
- show a compact featured/preview row near the top of the profile;
- show `View all badges` when the user has more badges than the preview capacity;
- allow clicking/tapping a badge to open details;
- show badge image, badge name, meaning, and earned date in the detail view;
- respect the existing profile badge visibility preference if that preference remains part of current privacy behavior.

### Awarding model

Awards are evaluated from canonical, trusted account/activity data. Client UI events are never sufficient authority by themselves.

Initial rule categories:

- Early Member: launch-cohort account membership using a fixed code-reviewed cohort rule.
- Early Supporter: fixed launch-support qualification rule.
- Verified Admin: automatically follows the actual verified admin role and, once awarded, remains part of the account history.
- Verified Moderator: automatically follows verified moderator qualification and, once awarded, remains earned.
- Top Contributor: objective sustained activity threshold(s) based on trusted counters.
- Popular Post Creator: objective post interaction threshold(s) based on canonical interaction totals.
- Community Helper: objective constructive platform-wide participation threshold(s), independent of removed Communities.
- Long-Time Member: account-age milestone(s).
- Premium Member: automatically awarded after the account first meets verified Premium qualification and retained permanently afterward.
- Special Achievement: only predefined code-reviewed event/milestone rules; never manual admin assignment.

Exact numeric thresholds belong in the implementation plan/code and must be deterministic, testable, and reviewable.

## Firestore security

Security rules must enforce the new ownership model:

- clients cannot create/update/delete badge definitions;
- users cannot create/update/delete their own earned badge records;
- admins cannot create/update/delete earned badge records;
- read access continues to follow the app's approved profile/privacy model;
- only the trusted automatic award processing path can create new earned badge records;
- retired Groups and Interest Communities rule blocks are removed so those feature paths are no longer client-operable.

## Data cleanup and deployment ordering

Because Groups and Interest Communities are being permanently removed, deployment must avoid leaving writable dead subsystems.

Safe order:

1. Add tests that define the removed-surface and immutable-badge contracts.
2. Remove client navigation/UI and feature write paths.
3. Update Firestore rules so retired feature paths are no longer client-writable and badge writes are system-only.
4. Deploy code/rules that no longer depend on Groups/Interest Communities.
5. Run the controlled administrative cleanup for existing Groups/Interest Communities documents and nested records.
6. Verify no remaining navigation, service-worker, discovery, rules, or runtime references can resurrect the removed features.
7. Verify automatic badge awarding, profile rendering, and admin read-only visibility.

The cleanup script must be narrowly scoped to Groups/Interest Communities collections and must not touch Temporary Rooms, private messages, Premium rooms, profiles, canonical timeline posts, or unrelated user data.

## Testing

Required contract coverage includes:

- Groups links/routes/controllers are absent from active product surfaces.
- Interest Communities links/routes/controllers are absent from active product surfaces.
- Temporary Rooms still work and remain linked.
- Premium Rooms still work and remain linked.
- service-worker cache no longer includes retired pages/assets.
- discovery no longer reads Groups/Interest Communities.
- timeline composer has no `GIF URL` field or raw GIF URL submission path.
- historical GIF media can still render if already present.
- badge catalog is fixed and complete.
- every production badge definition has a valid artwork asset and accessible label/description.
- automatic eligibility is deterministic and idempotent.
- profile preview, `View all badges`, detail view, and earned date work.
- admin badge surface is read-only.
- Firestore rules reject badge writes from ordinary users and admins.
- Firestore rules no longer expose active Groups/Interest Communities operations.
- full Firestore CI and relevant Phase C/profile/admin regressions remain green.

## Android parity

The Android package/TWA inherits the same web profile badge surfaces and removals. Any Android-specific navigation/cache/package metadata that references Groups/Interest Communities must be cleaned so app and web stay aligned.

## Non-goals

- Do not remove Temporary Rooms.
- Do not remove Premium Rooms.
- Do not redesign private messaging.
- Do not remove historical GIF rendering from existing posts solely because the raw GIF URL composer input is removed.
- Do not introduce admin exceptions for badge mutation.
- Do not introduce manual special-achievement assignment.
