# AnonChat Communities Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build free public interest-based Communities with discovery, membership, moderator roles, rules, pinned canonical posts, basic polls, and Community-specific badges without regressing existing AnonChat rooms, messaging, timelines, moderation, or profile badges.

**Architecture:** Add a focused Community policy and Firestore adapter, dedicated discovery/detail controllers, and narrowly scoped Firestore rules. Reuse the existing `communityPosts` and canonical comment/reaction model instead of creating a parallel post system. Keep the existing temporary-room/direct-message `community.js` intact except for optional navigation links.

**Tech Stack:** Vanilla JavaScript ES modules, Firebase Auth, Firestore, existing AnonChat moderation/session/blocking helpers, GitHub Actions CI.

**Spec:** `docs/superpowers/specs/2026-09-05-communities-design.md`

## Global Constraints

- Preserve every current working AnonChat feature; no unrelated rewrites.
- Public Communities remain free.
- Safety controls remain free.
- Canonical post/comment/reaction IDs must be shared across every rendering surface.
- Do not add video upload.
- Keep Community logic in focused modules instead of expanding `community.js`.
- Do not deploy Communities independently; deployment waits for the full approved web-release bundle.

---

### Task 1: Community policy contract

**Files:**
- Create: `community-interest-policy.mjs`
- Create: `scripts/test-community-interest-policy.mjs`
- Create/Modify: `.github/workflows/communities-ci.yml`

**Interfaces:**
- Produces: `normalizeCommunity(input)`, `normalizeCommunityRules(rules)`, `canManageCommunity(member)`, `canModerateCommunity(member)`, `sortCommunityPosts(posts)`.

- [ ] **Step 1: Write the failing policy tests** for field limits, public-only visibility, finite roles, rule limits, and pinned-first/newest-first ordering.
- [ ] **Step 2: Run the focused test and verify RED.**
- [ ] **Step 3: Implement the minimal policy module.**
- [ ] **Step 4: Run the focused test and verify GREEN.**
- [ ] **Step 5: Commit.**

### Task 2: Firestore Community adapter

**Files:**
- Create: `community-interest-firestore.mjs`
- Create: `scripts/test-community-interest-firestore-contract.mjs`
- Modify: `.github/workflows/communities-ci.yml`

**Interfaces:**
- Consumes: Task 1 normalization/permission helpers.
- Produces: `listCommunities`, `getCommunity`, `createPublicCommunity`, `joinCommunity`, `leaveCommunity`, `listCommunityMembers`, `setCommunityModerator`, `listCommunityPosts`, `setCommunityPostPinned`.

- [ ] **Step 1: Write contract tests** requiring canonical `communityPosts`, atomic owner membership creation, idempotent membership operations, and no global-admin mutation path.
- [ ] **Step 2: Verify RED.**
- [ ] **Step 3: Implement the adapter using existing Firebase module patterns.**
- [ ] **Step 4: Verify GREEN.**
- [ ] **Step 5: Commit.**

### Task 3: Firestore security rules

**Files:**
- Modify: `firestore.rules`
- Create: `scripts/test-community-interest-rules.mjs`
- Modify: `.github/workflows/communities-ci.yml`

**Interfaces:**
- Protects: `communities/{communityId}` and `communities/{communityId}/members/{uid}` plus pin-field updates on `communityPosts`.

- [ ] **Step 1: Write failing source-contract tests** for schema keys, public visibility, owner identity, role enum, self join/leave, moderator role changes, owner preservation, and moderator-only pin changes.
- [ ] **Step 2: Verify RED.**
- [ ] **Step 3: Add minimal rules/helpers without weakening existing post/moderation rules.**
- [ ] **Step 4: Run Communities-focused rules tests and full Firestore CI.**
- [ ] **Step 5: Commit.**

### Task 4: Community discovery surface

**Files:**
- Create: `communities.html`
- Create: `communities.js`
- Create: `scripts/test-communities-surface.mjs`
- Modify: `sw.js`
- Modify: `.github/workflows/communities-ci.yml`

**Interfaces:**
- Consumes: `listCommunities`, `joinCommunity`, `leaveCommunity`.
- Produces: searchable/filterable discovery with membership-aware cards.

- [ ] **Step 1: Write failing surface contract tests** for search, topic filter, join/leave, member count, navigation, auth-loss cleanup, and offline graph inclusion.
- [ ] **Step 2: Verify RED.**
- [ ] **Step 3: Implement minimal accessible discovery UI using existing visual patterns.**
- [ ] **Step 4: Verify focused and push/offline regression tests.**
- [ ] **Step 5: Commit.**

### Task 5: Community detail and canonical posts

**Files:**
- Create: `community-detail.html`
- Create: `community-detail.js`
- Create: `scripts/test-community-detail-surface.mjs`
- Modify: `sw.js`
- Modify: `.github/workflows/communities-ci.yml`

**Interfaces:**
- Consumes: Community adapter plus existing `communityPosts`, moderation client, block policy, session generation, comments/reactions rendering patterns.
- Produces: Community header/rules, membership state, member-only composer, pinned-first canonical posts, canonical comments/reactions, report controls.

- [ ] **Step 1: Write failing surface tests** for canonical `communityPosts` IDs, pinned ordering, comment/reaction reuse, report controls, and blocked/deleted-author visibility.
- [ ] **Step 2: Verify RED.**
- [ ] **Step 3: Implement the detail controller without duplicating post interaction storage.**
- [ ] **Step 4: Verify GREEN plus interaction-consistency regressions.**
- [ ] **Step 5: Commit.**

### Task 6: Owner/moderator controls

**Files:**
- Modify: `community-detail.js`
- Create: `scripts/test-community-moderator-controls.mjs`
- Modify: `.github/workflows/communities-ci.yml`

**Interfaces:**
- Consumes: membership/role APIs and pin API.
- Produces: role management, pin/unpin controls, visible owner/mod badges.

- [ ] **Step 1: Write failing tests** for owner-only moderator appointment/removal, moderator pin controls, and owner-role protection.
- [ ] **Step 2: Verify RED.**
- [ ] **Step 3: Implement minimal controls.**
- [ ] **Step 4: Verify GREEN.**
- [ ] **Step 5: Commit.**

### Task 7: Basic polls in Communities

**Files:**
- Inspect/reuse existing poll policy/storage if available.
- Create or modify only the smallest required Community poll adapter/UI files.
- Create: `scripts/test-community-polls.mjs`

**Interfaces:**
- Produces: bounded free polls attached to canonical Community posts.

- [ ] **Step 1: Inspect existing poll implementation and select reuse path.**
- [ ] **Step 2: Write failing tests for the selected integration.**
- [ ] **Step 3: Verify RED.**
- [ ] **Step 4: Implement minimal reuse/integration.**
- [ ] **Step 5: Verify GREEN and commit.**

### Task 8: Community-specific badges

**Files:**
- Create: `community-badge-policy.mjs`
- Extend Community adapter/detail UI with scoped badge assignments.
- Create: `scripts/test-community-badges.mjs`

**Interfaces:**
- Community badges are scoped labels only; they never modify global profile achievement badge rights or global admin rights.

- [ ] **Step 1: Write failing scope/permission tests.**
- [ ] **Step 2: Verify RED.**
- [ ] **Step 3: Implement scoped badge definitions/assignments and UI.**
- [ ] **Step 4: Verify GREEN.**
- [ ] **Step 5: Commit.**

### Task 9: Navigation and regression integration

**Files:**
- Modify only the existing navigation surfaces that should expose Communities.
- Modify: `sw.js` if required.
- Create/modify Communities regression tests.

**Interfaces:**
- Produces: entry points from the current app without replacing temporary-room navigation.

- [ ] **Step 1: Write failing navigation/offline tests.**
- [ ] **Step 2: Verify RED.**
- [ ] **Step 3: Add minimal navigation links and service-worker entries.**
- [ ] **Step 4: Run Communities focused CI, full Firestore CI, push/offline CI, moderation, interaction-consistency, and existing Profiles + Badges CI.**
- [ ] **Step 5: Commit the verified Communities checkpoint.**

### Task 10: Hold for combined web release

- [ ] Confirm Communities focused CI is green on the final Community commit.
- [ ] Confirm full Firestore/application regression is green on the same commit.
- [ ] Record Communities as complete in the growth release checklist.
- [ ] Do not merge/deploy yet; continue with Rooms/groups per the approved release order.
