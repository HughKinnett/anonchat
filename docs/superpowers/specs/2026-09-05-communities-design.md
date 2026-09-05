# AnonChat Communities Design

## Goal

Add interest-based Communities as a free public discussion surface that helps people discover and participate in topic-centered conversations without exposing real-world identity.

## Product principles

- Preserve every existing working AnonChat feature and the current temporary-room, direct-message, moderation, profile, badge, timeline, and Premium flows.
- Public Communities are free to discover, join, read, post in, comment in, react in, and share.
- Invite-only Community creation is not part of this phase; it remains a later Premium feature.
- Safety controls remain free: blocking, reporting, moderation, and essential privacy are never paywalled.
- Communities must use canonical post/comment/reaction records so the same post keeps one interaction state wherever it is rendered.
- No video upload.
- Communities must be implemented in focused modules rather than expanding the existing `community.js` temporary-room/messaging controller.

## Community model

### `communities/{communityId}`

Fields:
- `name`: 3-60 characters.
- `slug`: lowercase URL-safe identifier, 3-60 characters.
- `description`: up to 500 characters.
- `topic`: one normalized topic value.
- `rules`: list of up to 10 short rule strings, each up to 180 characters.
- `ownerId`: creator uid.
- `visibility`: `public` in this phase.
- `status`: `active` or `archived`.
- `memberCount`: server/trusted-maintained display count where available.
- `createdAt`, `updatedAt`.

### `communities/{communityId}/members/{uid}`

Fields:
- `uid`.
- `role`: `owner`, `moderator`, or `member`.
- `joinedAt`.

Owners can appoint/remove moderators. Owners cannot remove their own owner role without a future ownership-transfer flow. Moderators can pin/unpin content and moderate within their Community using existing moderation primitives where applicable.

### Community posts

Use the existing `communityPosts` collection rather than introducing a second post system. Each post must include `communityId` and continue to use the existing canonical comment/reaction collections and moderation state. Community views, timeline views, quote/share views, and future discovery feeds must resolve back to the same post ID.

### Pins

A community post can be pinned by storing `pinnedAt` and `pinnedBy` on the canonical community post. Only the owner/moderators can change these fields.

### Polls

Basic polls remain free. Community posts may include a bounded poll payload using the existing poll behavior when available; if existing poll storage is not reusable, add a focused poll policy/adapter rather than embedding poll logic into the Community UI controller.

### Community badges

Community-specific badges are display labels controlled by owners/moderators and scoped to one Community. They do not replace profile achievement badges and do not grant application-wide privileges.

## Discovery and membership

Create a dedicated public Community discovery surface with:
- search by name/topic,
- topic filters,
- joined/not-joined state,
- member count,
- join/leave action,
- direct navigation to a Community detail page.

Joining/leaving must be idempotent. The owner is always a member. Blocked/deletion-barrier users must not become available through Community features in ways that bypass existing visibility protections.

## Community detail surface

The Community page shows:
- name, description, topic, rules,
- membership state and join/leave control,
- owner/moderator indicators,
- pinned posts first,
- remaining posts newest-first,
- composer for members,
- comments/reactions using canonical interaction data,
- report controls using the existing moderation client,
- moderator tools only for authorized owner/moderator accounts.

## Creation

Any active free user may create a public Community in this phase, subject to validation and a conservative per-account creation limit enforced by policy/rules. Community creation writes the Community and owner membership atomically.

## Moderation and safety

- Existing account blocks and deletion barriers apply.
- Existing report intake and moderation-case infrastructure is reused.
- Community owners/moderators may pin/unpin and manage Community membership roles.
- Application admins retain their existing global moderation powers.
- A Community-specific moderator cannot gain global admin capabilities.

## Firestore/security requirements

Rules must validate Community schema, owner identity, public visibility for this phase, membership roles, join/leave ownership, and moderator-only pin/role changes. Clients must not be able to spoof member counts or global admin status.

## Architecture

Add focused modules:
- `community-policy.mjs`: normalization, validation, permissions, sort rules.
- `community-firestore.mjs`: Firestore reads/writes for Communities and memberships.
- `communities.html` / `communities.js`: discovery UI/controller.
- `community-detail.html` / `community-detail.js`: one Community and its canonical posts.
- targeted test files and a Communities-focused CI workflow.

Do not move temporary-room/direct-message code out of `community.js` during this phase; avoiding unrelated restructuring lowers regression risk.

## Release constraint

Communities are not deployed alone. They join the approved web-release bundle and are deployed only after Communities, Rooms/groups, Discovery/feed controls, discussion upgrades, Premium entitlements, profile/privacy controls, notifications, moderation, sharing, and remaining approved fixes all pass the final combined regression suite.
