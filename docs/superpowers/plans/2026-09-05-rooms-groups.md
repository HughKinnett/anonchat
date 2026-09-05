# Rooms and Groups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add persistent public groups for free users and persistent private/invite-only groups for Premium users without replacing AnonChat's existing Temporary Rooms, Communities, or encrypted Premium Rooms.

**Architecture:** Add focused group policy, Firestore adapter, public group discovery/detail surfaces, and a private-group path that reuses existing Premium entitlement and E2EE room-key primitives. Reuse canonical content/comment/reaction/poll/moderation infrastructure wherever the same content may render across surfaces. Avoid restructuring `community.js` or `premium-rooms.js` beyond narrow compatibility/navigation integration.

**Tech Stack:** Vanilla JavaScript ES modules, Firebase Auth, Firestore, existing AnonChat moderation/session/blocking helpers, existing Premium policy and E2EE room-key modules, GitHub Actions CI.

**Spec:** `docs/superpowers/specs/2026-09-05-rooms-groups-design.md`

## Global Constraints

- Preserve all current working AnonChat features.
- Temporary Rooms remain 24-hour temporary spaces.
- Existing Premium encrypted rooms remain intact.
- Public persistent groups are free.
- Private/invite-only persistent groups are Premium-owner features.
- Safety controls remain free.
- Reuse canonical interactions; do not duplicate comment/reaction state.
- Group moderators never gain global admin rights.
- No video upload.
- Do not deploy this subsystem independently; hold for the complete approved web release.

---

### Task 1: Group policy contract

**Files:**
- Create: `group-policy.mjs`
- Create: `scripts/test-group-policy.mjs`
- Create: `.github/workflows/groups-ci.yml`

**Interfaces:**
- Produces: `normalizeGroup(input)`, `canManageGroup(member)`, `canModerateGroup(member)`, `canSelfJoinGroup(group)`, `sortGroupPosts(posts)`.

- [ ] **Step 1: Write failing tests** for group field limits, public/private visibility, Premium requirement normalization, finite roles, self-join rules, and pinned-first/newest-first post ordering.
- [ ] **Step 2: Run the focused test and verify RED.**
- [ ] **Step 3: Implement the minimal policy module.**
- [ ] **Step 4: Run the focused test and verify GREEN.**
- [ ] **Step 5: Commit.**

### Task 2: Public group Firestore adapter

**Files:**
- Create: `group-firestore.mjs`
- Create: `scripts/test-group-firestore-contract.mjs`
- Modify: `.github/workflows/groups-ci.yml`

**Interfaces:**
- Consumes: Task 1 policy helpers.
- Produces: `listPublicGroups`, `getGroup`, `createPublicGroup`, `joinPublicGroup`, `leaveGroup`, `listGroupMembers`, `setGroupModerator`, `removeGroupMember`, `listGroupPosts`, `setGroupPostPinned`.

- [ ] **Step 1: Write failing adapter contract tests** requiring atomic owner membership creation, idempotent public join/leave, owner-role protection, canonical post reuse, and no global-admin mutation path.
- [ ] **Step 2: Verify RED.**
- [ ] **Step 3: Implement minimal public-group adapter.**
- [ ] **Step 4: Verify GREEN.**
- [ ] **Step 5: Commit.**

### Task 3: Group Firestore security rules

**Files:**
- Modify: `firestore.rules`
- Create: `scripts/test-group-rules.mjs`
- Modify: `.github/workflows/groups-ci.yml`

**Interfaces:**
- Protects: `groups/{groupId}`, `groups/{groupId}/members/{uid}`, and group-scoped canonical post pin/membership constraints.

- [ ] **Step 1: Write failing source/rules contract tests** for group schema, public/free creation, private/Premium creation markers, owner identity, role enum, public self join/leave, private invitation-only membership, moderator-role changes, owner protection, and member-only private reads.
- [ ] **Step 2: Verify RED.**
- [ ] **Step 3: Add minimal rules/helpers without weakening existing Communities, Premium Rooms, moderation, or post rules.**
- [ ] **Step 4: Run Groups-focused rules tests and full Firestore CI.**
- [ ] **Step 5: Commit.**

### Task 4: Public group discovery and creation surface

**Files:**
- Create: `groups.html`
- Create: `groups.js`
- Create: `scripts/test-groups-surface.mjs`
- Modify: `sw.js`
- Modify: `.github/workflows/groups-ci.yml`

**Interfaces:**
- Consumes: `listPublicGroups`, `createPublicGroup`, `joinPublicGroup`, `leaveGroup`.
- Produces: searchable public-group discovery, free public-group creation, membership-aware cards, direct navigation.

- [ ] **Step 1: Write failing surface tests** for search, topic filtering, create/join/leave, member count, navigation, auth-loss cleanup, and offline graph inclusion.
- [ ] **Step 2: Verify RED.**
- [ ] **Step 3: Implement accessible discovery/creation UI using existing AnonChat visual patterns.**
- [ ] **Step 4: Verify focused and push/offline regression tests.**
- [ ] **Step 5: Commit.**

### Task 5: Public group detail and canonical discussions

**Files:**
- Create: `group-detail.html`
- Create: `group-detail.js`
- Create: `scripts/test-group-detail-surface.mjs`
- Modify: `sw.js`
- Modify: `.github/workflows/groups-ci.yml`

**Interfaces:**
- Consumes: Group adapter plus canonical posts/comments/reactions, moderation, block policy, polls.
- Produces: group header, membership state, member composer, canonical posts, comments, reactions, polls, reporting, deletion, and pin controls.

- [ ] **Step 1: Write failing tests** for canonical post IDs, comment/reaction reuse, poll reuse, report/delete behavior, blocked/deleted-author handling, and pin display/order.
- [ ] **Step 2: Verify RED.**
- [ ] **Step 3: Implement the minimal detail controller without duplicating interaction storage.**
- [ ] **Step 4: Verify GREEN plus interaction-consistency regressions.**
- [ ] **Step 5: Commit.**

### Task 6: Public group owner/moderator controls

**Files:**
- Modify: `group-detail.js`
- Create: `scripts/test-group-moderator-controls.mjs`
- Modify: `.github/workflows/groups-ci.yml`

**Interfaces:**
- Consumes: membership and moderator APIs.
- Produces: owner-only moderator appointment/removal, owner/moderator member removal, pin/unpin, visible role labels.

- [ ] **Step 1: Write failing tests** for role boundaries, owner protection, moderator scope, and no global privilege mutation.
- [ ] **Step 2: Verify RED.**
- [ ] **Step 3: Implement minimal controls.**
- [ ] **Step 4: Verify GREEN.**
- [ ] **Step 5: Commit.**

### Task 7: Premium private-group policy and adapter

**Files:**
- Create: `private-group-firestore.mjs`
- Create: `scripts/test-private-group-contract.mjs`
- Modify: `.github/workflows/groups-ci.yml`

**Interfaces:**
- Consumes: `premium-policy.mjs`, existing E2EE identity/key-envelope helpers, group policy.
- Produces: `createPrivateGroup`, `listPrivateGroupsForMember`, `invitePrivateGroupMember`, `removePrivateGroupMember`, `loadPrivateGroupKey`, `grantPrivateGroupKey`.

- [ ] **Step 1: Write failing contract tests** requiring active Premium for private-group creation, invitation-only membership, no public discovery path, and reuse of existing E2EE key primitives.
- [ ] **Step 2: Verify RED.**
- [ ] **Step 3: Implement the smallest adapter that reuses Premium/E2EE foundations.**
- [ ] **Step 4: Verify GREEN.**
- [ ] **Step 5: Commit.**

### Task 8: Private-group encrypted discussion surface

**Files:**
- Extend: `group-detail.html`
- Extend: `group-detail.js` or create focused `private-group-detail.js` if separation is clearer.
- Create: `scripts/test-private-group-surface.mjs`
- Modify: `sw.js`
- Modify: `.github/workflows/groups-ci.yml`

**Interfaces:**
- Consumes: Task 7 adapter and existing E2EE encrypt/decrypt helpers.
- Produces: member-only encrypted private-group discussions and invitations.

- [ ] **Step 1: Write failing surface tests** for member-only rendering, invitation controls, E2EE reuse, auth-loss cleanup, reporting/blocking controls, and no plaintext private payload fallback.
- [ ] **Step 2: Verify RED.**
- [ ] **Step 3: Implement encrypted private-group surface using existing E2EE patterns.**
- [ ] **Step 4: Verify GREEN plus E2EE and moderation regression suites.**
- [ ] **Step 5: Commit.**

### Task 9: Navigation and product separation

**Files:**
- Modify only existing navigation surfaces that should expose Groups.
- Modify: `sw.js` if required.
- Create: `scripts/test-groups-navigation.mjs`

**Interfaces:**
- Produces: clear separate entry points for Temporary Rooms, Communities, Groups, and Premium Rooms.

- [ ] **Step 1: Write failing navigation tests** proving existing Temporary Rooms and Communities links remain while Groups is added separately.
- [ ] **Step 2: Verify RED.**
- [ ] **Step 3: Add minimal navigation/offline integration.**
- [ ] **Step 4: Verify Groups focused CI, Communities focused CI, Profiles + Badges tests, push/offline coverage, and full Firestore/application regression.**
- [ ] **Step 5: Commit.**

### Task 10: Final Rooms/groups checkpoint

- [ ] Confirm Groups focused CI is green on the final Rooms/groups commit.
- [ ] Confirm Communities + Profiles/Badges focused checks remain green on the same commit.
- [ ] Confirm full Firestore/application regression is green on the same commit.
- [ ] Confirm existing Temporary Rooms and Premium Rooms regression coverage remains green.
- [ ] Mark Rooms/groups complete in the growth-release checklist.
- [ ] Do not merge or deploy; continue with Discovery/feed controls per the approved release order.
