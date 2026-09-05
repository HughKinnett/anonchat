# AnonChat Growth Release Job List

> This is a queued backlog for the next growth-focused release. It does not replace or interrupt the active Profiles + Badges plan.

## Global constraints

- Preserve every current working AnonChat feature; no regressions or unrelated rewrites.
- Do not add video upload.
- Keep core safety controls free: reporting, blocking, essential privacy, and normal posting/replying must never require Premium.
- Do not make Premium pay-to-win or automatically rank Premium users above free users in feeds.
- Build and verify web behavior first, then bring the same stable behavior to Android.

## Acquisition and discovery

- [ ] Add interest-based Communities with public discovery, membership, moderators, rules, pinned posts, polls, badges, and community-specific discussions.
- [ ] Add topic discovery, hashtags, trending topics, and searchable community/topic surfaces.
- [ ] Add user-controlled feeds: For You, Latest, Following only, chosen topics, temporary-posts-only, and saved custom feed filters.
- [ ] Add stronger low-friction onboarding from shared links so visitors can read the shared discussion before signing up.
- [ ] Make every shareable post/community/room link render an attractive AnonChat-themed social preview for Facebook, X, Reddit, messages, and other share targets.
- [ ] Keep normal external sharing free.

## Temporary and persistent social spaces

- [ ] Expand Temporary Rooms for live events, sports, TV, music, relationships, local topics, and other time-limited discussions.
- [ ] Add persistent public groups and private/invite-only groups without removing the existing temporary-room behavior.
- [ ] Add micro-community/group-chat experiences with member and moderator controls.
- [ ] Add room/community moderation, pinned content, membership controls, and clear expiration indicators where content is temporary.

## Discussion quality

- [ ] Add threaded replies and collapsible reply branches.
- [ ] Add reply sorting such as newest and top.
- [ ] Add helpful-answer marking where appropriate.
- [ ] Expand polls while retaining current posting behavior.
- [ ] Add quote-posting/sharing that preserves canonical interaction counts and comments across timelines.
- [ ] Add conversation summaries only where they can be generated without changing or hiding original user content.

## Identity, reputation, and privacy

- [ ] Strengthen pseudonymous reputation using earned badges, account age, contribution history, and moderation-safe trust signals without exposing real-world identity.
- [ ] Add clear profile visibility controls.
- [ ] Add controls for who can comment, send message requests, or view selected activity.
- [ ] Add configurable disappearing-content controls while preserving existing disappearance behavior.
- [ ] Add clearer data-retention/privacy explanations in the product.

## Free features

- [ ] Joining public Communities.
- [ ] Creating normal posts and comments.
- [ ] Threaded replies and reactions.
- [ ] Following users.
- [ ] Basic Temporary Rooms.
- [ ] Sharing posts externally.
- [ ] For You, Latest, and Following feeds.
- [ ] Basic topic/community discovery.
- [ ] Basic polls.
- [ ] Essential privacy controls.
- [ ] Reporting and blocking.
- [ ] Activity-earned badges.
- [ ] Reading public discussions.

## Premium features

- [ ] Create invite-only Communities.
- [ ] Create persistent private groups.
- [ ] Add advanced room controls for Premium room/community owners.
- [ ] Add custom disappearance timers beyond the free presets.
- [ ] Add advanced profile privacy options while keeping essential privacy free.
- [ ] Allow more featured profile badges than the free allowance.
- [ ] Add enhanced profile customization and Premium community themes.
- [ ] Add larger image limits, with no video upload.
- [ ] Add advanced notification controls.
- [ ] Add saved custom feed filters and advanced discovery filters.
- [ ] Add expanded poll capabilities.
- [ ] Add community analytics for Premium owners/moderators.
- [ ] Add optional priority access to new AnonChat features.

## Growth positioning

- [ ] Optimize Communities as the primary migration hook for Facebook Groups users.
- [ ] Optimize fast public discussion and user-controlled feeds as the primary hook for X users.
- [ ] Optimize topic communities, reputation, threading, and real-time rooms as the primary hook for Reddit users.
- [ ] Keep the core product message centered on participating without putting a real-world identity on display.

## Release order

- [ ] Finish and deploy the current Profiles + Badges release first.
- [ ] Design and implement Communities as its own testable subsystem.
- [ ] Expand Rooms/groups as its own testable subsystem.
- [ ] Implement Discovery/feed controls as its own testable subsystem.
- [ ] Implement discussion upgrades as their own testable subsystem.
- [ ] Implement Premium entitlements only after the corresponding free feature is stable.
- [ ] Run full regression, security, Firestore-cost, moderation, notification, sharing, and interaction-consistency tests before merge/deploy.
- [ ] Bring the stable web release to Android with feature parity.
