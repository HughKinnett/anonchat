# AnonChat Rooms and Groups Design

## Goal

Expand AnonChat's social spaces without replacing existing Temporary Rooms or Premium encrypted rooms. Add persistent public groups for free users and persistent private/invite-only groups for Premium users, while reusing existing E2EE, moderation, canonical interactions, membership roles, and notification infrastructure wherever possible.

## Product principles

- Preserve all existing Temporary Rooms, private messages, Communities, Profiles + Badges, Premium rooms, moderation, blocking, reporting, notifications, and timeline behavior.
- Temporary Rooms remain temporary and continue expiring after 24 hours.
- Existing encrypted Premium invite-only rooms remain available and continue using the current E2EE room-key system.
- Public persistent groups are free to discover, join, read, post in, comment in, react in, report in, and leave.
- Private/invite-only persistent groups are Premium-owner features; essential safety controls remain free for every participant.
- Do not add video upload.
- Reuse canonical content and interaction records wherever the same content may appear in more than one surface.
- Group moderators never gain application-wide admin rights.

## Existing systems to preserve and reuse

### Temporary Rooms

The current `community.html` / `community.js` Temporary Rooms flow remains intact. This phase may add navigation into new group surfaces, but it must not rewrite or migrate temporary-room behavior.

### Premium encrypted rooms

The current `premium-rooms.js` E2EE identity, key-envelope, membership, owner/moderator, reporting, invite, and encrypted-message foundations remain intact. New private persistent groups should reuse the same E2EE primitives rather than inventing a second encryption system.

### Communities

Public Interest Communities continue using canonical `communityPosts` and their existing comments/reactions/polls/moderation behavior. Persistent groups should reuse canonical post/comment/reaction policies where practical while retaining a distinct group membership/access model.

## Group model

### `groups/{groupId}`

Fields:
- `name`: 3-60 characters.
- `slug`: lowercase URL-safe identifier, 3-60 characters.
- `description`: up to 500 characters.
- `topic`: up to 60 characters.
- `visibility`: `public` or `private`.
- `ownerId`: creator uid.
- `status`: `active` or `archived`.
- `premiumRequired`: boolean; must be false for public groups and true for private groups in this phase.
- `memberCount`: trusted display count where available.
- `createdAt`, `updatedAt`.

### `groups/{groupId}/members/{uid}`

Fields:
- `uid`.
- `role`: `owner`, `moderator`, or `member`.
- `joinedAt`.
- `invitedBy`: optional uid for private groups.

Rules:
- Owner is always a member.
- Owner can appoint/remove moderators.
- Owner role cannot be removed without a future ownership-transfer flow.
- Moderators may pin/unpin and moderate group content but cannot grant Premium, global badges, or admin rights.
- Public groups allow self-join/self-leave for active users.
- Private groups require an owner/moderator invitation plus active Premium access where the product policy requires it.

## Group content

Persistent group discussions use canonical post/comment/reaction semantics so a post keeps one interaction state wherever it is rendered. Prefer a focused group discriminator on the canonical post system rather than creating separate duplicate reaction/comment stores.

Group posts support:
- normal text posts,
- existing image behavior where already supported,
- comments and reactions,
- polls using the existing poll vote infrastructure,
- report controls,
- pinning,
- deletion by the post author and authorized moderation paths,
- canonical interaction counts/details.

No video upload.

## Public groups

Create a discovery surface for public persistent groups with:
- search by name/topic,
- joined/not-joined state,
- member count,
- join/leave action,
- direct navigation to a group detail page.

Any active free user may create a public group, subject to validation and conservative creation limits. Public group creation must create the owner membership atomically.

## Private / invite-only groups

Private persistent groups are a Premium-owner feature. Creation requires active Premium access. Membership is invitation-based. Reuse existing Premium entitlement checks and E2EE room-key infrastructure.

Private groups must:
- not appear in public discovery,
- only be readable by members,
- use encrypted group-message/content paths wherever content is private,
- support owner/moderator invitations and removals,
- preserve reporting/blocking protections,
- retain essential safety controls for all members regardless of who pays.

## Moderation and safety

- Existing block and deletion-barrier behavior applies.
- Existing moderation/reporting infrastructure is reused.
- Owners/moderators can remove non-owner members from their group.
- Owners/moderators can pin/unpin group content.
- Application admins retain global moderation authority.
- Group roles never grant app-wide admin capabilities.
- Safety controls remain free.

## Navigation

Add a clear Groups entry without replacing:
- Timeline,
- current Community / Temporary Rooms,
- Interest Communities,
- Premium Rooms.

Users should be able to distinguish:
- Temporary Rooms — expiring live rooms,
- Communities — public topic communities,
- Groups — persistent public/private group spaces,
- Premium Rooms — existing encrypted invite-only room experience.

## Firestore/security requirements

Rules must validate:
- group schema and allowed visibility values,
- public/free versus private/Premium creation policy,
- owner identity,
- finite membership roles,
- self join/leave only for public groups,
- invitation-only membership for private groups,
- owner-only moderator assignment/removal,
- owner-role protection,
- member-only private reads,
- moderator-only pin changes,
- no client spoofing of Premium access, global admin state, or member counts.

## Architecture

Add focused modules rather than expanding existing large room controllers:
- `group-policy.mjs`: normalization, role/access checks, sorting.
- `group-firestore.mjs`: group/membership/post adapter.
- `groups.html` / `groups.js`: group discovery and creation.
- `group-detail.html` / `group-detail.js`: group detail, canonical public content, member/moderator controls.
- focused private-group adapter/module that reuses `premium-policy.mjs` and existing E2EE room-key helpers.
- targeted tests and a Groups-focused CI workflow.

Do not rewrite `community.js` or `premium-rooms.js` during this phase unless a narrow compatibility/navigation change is required.

## Release constraint

Rooms/groups are not deployed independently. They join the approved combined web-release bundle and are deployed only after the remaining Discovery/feed controls, discussion upgrades, Premium entitlements, profile/privacy controls, notification/moderation/sharing/interactions fixes, and the final combined regression suite are complete and green.
