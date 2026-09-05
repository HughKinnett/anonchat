# Discovery and Feed Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add user-controlled feeds, topic/hashtag discovery, trending/search, and saved feed filters while preserving canonical posts/interactions and all existing moderation/privacy behavior.

**Architecture:** Extend the existing timeline controller with a pure feed-policy layer instead of creating a second feed system. Topic discovery reads normalized metadata from canonical posts and existing public Communities/Groups, while viewer-owned saved filters use a scoped Firestore collection with owner-only rules. All new modes continue through the existing canonical post rendering, interaction, block, moderation, expiry, and auth paths.

**Tech Stack:** Vanilla JavaScript/ES modules, Firebase Auth, Cloud Firestore, Firebase Emulator rules tests, existing GitHub Actions CI, existing service worker/offline shell.

**Spec:** `docs/superpowers/specs/2026-09-05-discovery-feed-controls-design.md`

## Global Constraints

- Preserve every current working AnonChat feature; no unrelated rewrites.
- Do not add video upload on web or Android.
- Keep core safety controls free: reporting, blocking, essential privacy, and normal posting/replying must never require Premium.
- Do not make Premium pay-to-win or automatically rank Premium users above free users in feeds.
- Complete and test the entire approved web feature set before deployment.
- Keep this work on `growth-web-release`; do not merge or deploy this subsystem independently.
- Reuse canonical posts/comments/reactions and existing moderation/block/expiry behavior across every feed mode.

---

### Task 1: Feed-mode policy contract

**Files:**
- Create: `feed-mode-policy.mjs`
- Create: `scripts/test-feed-mode-policy.mjs`
- Create/Modify: `.github/workflows/discovery-feed-ci.yml`

**Interfaces:**
- Consumes: normalized post records `{ authorId, createdAt, expiresAt, topics, score }`, viewer follows/topics, current time.
- Produces: `FEED_MODES`, `normalizeFeedMode(value)`, `filterFeedPosts(posts, context)`, `sortFeedPosts(posts, mode, context)`.

- [ ] **Step 1: Write the failing policy test** covering `for-you`, `latest`, `following`, `topics`, `temporary`, saved-filter normalization, strict chronological Latest, following-only membership, expiry filtering, and Premium-neutral ranking.
- [ ] **Step 2: Run focused CI and verify RED** because `feed-mode-policy.mjs` does not exist.
- [ ] **Step 3: Implement minimal pure policy module** using existing `feed-ranking-policy.mjs` where appropriate, explicitly excluding Premium entitlement from ranking inputs.
- [ ] **Step 4: Run focused policy test and existing feed-ranking regression**; verify GREEN.
- [ ] **Step 5: Commit.**

### Task 2: Timeline feed controls surface

**Files:**
- Modify: `timeline.html`
- Modify: `timeline.js`
- Create: `scripts/test-feed-controls-surface.mjs`
- Modify: `.github/workflows/discovery-feed-ci.yml`

**Interfaces:**
- Consumes: Task 1 `FEED_MODES`, `filterFeedPosts`, `sortFeedPosts`.
- Produces: accessible controls for For You, Latest, Following, Chosen Topics, Temporary Only, and Saved Filters while retaining the existing canonical renderer.

- [ ] **Step 1: Write failing surface tests** for six modes, accessible pressed/selected state, no duplicate post renderer, and no alternate interaction collections.
- [ ] **Step 2: Verify RED.**
- [ ] **Step 3: Add minimal feed-mode UI and controller wiring** in `timeline.html`/`timeline.js`; keep existing moderation, block, expiry, and interaction pipeline unchanged.
- [ ] **Step 4: Run discovery/feed focused CI plus timeline interaction consistency regressions.**
- [ ] **Step 5: Commit.**

### Task 3: Topic and hashtag normalization

**Files:**
- Create: `topic-policy.mjs`
- Create: `scripts/test-topic-policy.mjs`
- Modify: `content-writer-policy.mjs` only if canonical topic metadata is not already normalized at write time.
- Modify: `.github/workflows/discovery-feed-ci.yml`

**Interfaces:**
- Consumes: post text/category/topic metadata.
- Produces: `normalizeTopic(value)`, `extractHashtags(text)`, `postTopics(post)` with bounded, deduplicated normalized topics.

- [ ] **Step 1: Write failing normalization tests** for case folding, hashtag parsing, duplicates, invalid/oversized tokens, and bounded topic count.
- [ ] **Step 2: Verify RED.**
- [ ] **Step 3: Implement pure topic policy** and minimal writer integration if needed.
- [ ] **Step 4: Run topic tests plus content-writer/posting regressions.**
- [ ] **Step 5: Commit.**

### Task 4: Chosen Topics feed

**Files:**
- Modify: `timeline.html`
- Modify: `timeline.js`
- Create: `scripts/test-chosen-topics-feed.mjs`
- Modify: `.github/workflows/discovery-feed-ci.yml`

**Interfaces:**
- Consumes: Task 3 topic normalization and Task 1 feed filtering.
- Produces: viewer-selected topic chips/input and a canonical `topics` feed mode.

- [ ] **Step 1: Write failing tests** proving selected topics filter canonical posts only, preserve canonical interaction IDs, and respect blocks/moderation/expiry.
- [ ] **Step 2: Verify RED.**
- [ ] **Step 3: Implement selected-topic state and timeline wiring.**
- [ ] **Step 4: Run focused + interaction consistency regressions.**
- [ ] **Step 5: Commit.**

### Task 5: Topic discovery/search surface

**Files:**
- Create: `discover.html`
- Create: `discover.js`
- Create: `topic-discovery.mjs`
- Create: `scripts/test-topic-discovery-surface.mjs`
- Modify: `nav-menu.js`
- Modify: `sw.js`
- Modify: `.github/workflows/discovery-feed-ci.yml`

**Interfaces:**
- Consumes: public canonical posts, public Communities, public Groups, Task 3 topic normalization.
- Produces: searchable topics/hashtags plus links into timeline topic filters, Community details, and Group details.

- [ ] **Step 1: Write failing discovery-surface contract** for search, topic results, public Community/Group inclusion, private-content exclusion, navigation, auth loss, and offline asset coverage.
- [ ] **Step 2: Verify RED.**
- [ ] **Step 3: Implement bounded discovery aggregation and accessible surface.**
- [ ] **Step 4: Run focused CI plus Communities/Groups regressions.**
- [ ] **Step 5: Commit.**

### Task 6: Trending topics policy

**Files:**
- Create: `trending-topic-policy.mjs`
- Create: `scripts/test-trending-topic-policy.mjs`
- Modify: `discover.js`
- Modify: `.github/workflows/discovery-feed-ci.yml`

**Interfaces:**
- Consumes: bounded recent public topic activity `{ topic, createdAt, interactionCount }` after visibility filtering.
- Produces: `rankTrendingTopics(records, now)` deterministic ranking with recency/activity weighting and no Premium signal.

- [ ] **Step 1: Write failing tests** for recency weighting, bounded input, deterministic ties, hidden/private exclusion, and Premium neutrality.
- [ ] **Step 2: Verify RED.**
- [ ] **Step 3: Implement minimal deterministic trending policy and connect it to discovery.**
- [ ] **Step 4: Run focused tests and Communities/Groups/public visibility regressions.**
- [ ] **Step 5: Commit.**

### Task 7: Saved feed-filter policy and Firestore adapter

**Files:**
- Create: `saved-feed-filter-policy.mjs`
- Create: `saved-feed-filter-firestore.mjs`
- Create: `scripts/test-saved-feed-filter-policy.mjs`
- Create: `scripts/test-saved-feed-filter-firestore-contract.mjs`
- Modify: `.github/workflows/discovery-feed-ci.yml`

**Interfaces:**
- Consumes: viewer uid and normalized filter definition `{ name, mode, topics, temporaryOnly, sort }`.
- Produces: `normalizeSavedFeedFilter`, `listSavedFeedFilters`, `saveFeedFilter`, `deleteSavedFeedFilter`.

- [ ] **Step 1: Write failing policy/adapter contract tests** for bounded names/topics, allowed modes/sorts, viewer-scoped storage, no global query path, and no Premium rank fields.
- [ ] **Step 2: Verify RED.**
- [ ] **Step 3: Implement minimal policy and Firestore adapter.**
- [ ] **Step 4: Run focused tests.**
- [ ] **Step 5: Commit.**

### Task 8: Saved feed-filter Firestore security rules

**Files:**
- Modify: `firestore.rules`
- Create: `scripts/test-saved-feed-filter-rules.mjs`
- Modify: `.github/workflows/discovery-feed-ci.yml`

**Interfaces:**
- Consumes: Task 7 saved-filter schema.
- Produces: owner-only CRUD on saved filter documents; no cross-user read/write.

- [ ] **Step 1: Write failing emulator rule tests** for owner CRUD, cross-user denial, malformed schema denial, and inactive/deleted account denial where existing account gates apply.
- [ ] **Step 2: Verify RED.**
- [ ] **Step 3: Add minimal scoped Firestore rules.**
- [ ] **Step 4: Run emulator rules tests plus full Firestore rule regression subset.**
- [ ] **Step 5: Commit.**

### Task 9: Saved Filters timeline surface

**Files:**
- Modify: `timeline.html`
- Modify: `timeline.js`
- Create: `scripts/test-saved-feed-filter-surface.mjs`
- Modify: `.github/workflows/discovery-feed-ci.yml`

**Interfaces:**
- Consumes: Task 7 adapter and Task 1 feed policy.
- Produces: save/apply/delete UI for viewer-owned feed presets.

- [ ] **Step 1: Write failing surface tests** for save/apply/delete, empty state, duplicate-name handling, auth cleanup, and canonical renderer reuse.
- [ ] **Step 2: Verify RED.**
- [ ] **Step 3: Implement minimal saved-filter UI.**
- [ ] **Step 4: Run focused CI plus push/auth and interaction regressions.**
- [ ] **Step 5: Commit.**

### Task 10: Discovery/feed final checkpoint

**Files:**
- Modify: `docs/superpowers/plans/2026-09-05-growth-release-job-list.md`
- Modify tests/workflows only if checkpoint gaps are found.

**Interfaces:**
- Consumes: Tasks 1–9.
- Produces: independently verified Discovery/feed subsystem ready to remain on `growth-web-release` for the larger web release.

- [ ] **Step 1: Run Discovery/feed focused CI.**
- [ ] **Step 2: Run Communities, Groups, Profiles/Badges focused regressions.**
- [ ] **Step 3: Run timeline interaction, block/moderation, notification/push, offline/service-worker, Temporary Rooms, Premium, and full Firestore/application regressions.**
- [ ] **Step 4: If any failure appears, use systematic debugging and fix root cause before continuing.**
- [ ] **Step 5: Mark only completed Discovery/feed backlog items in the growth-release checklist.**
- [ ] **Step 6: Re-run same-SHA focused and full regression gates after checklist commit.**
- [ ] **Step 7: Keep `growth-web-release` unmerged and undeployed; proceed to the next approved subsystem only after all gates are green.**
