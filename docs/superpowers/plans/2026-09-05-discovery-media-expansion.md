# Discovery and Media Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add hashtags/topics, Trending, Popular Today, suggested people, recent searches, and a dedicated discovery experience without unbounded Firestore reads.

**Architecture:** Build discovery from the existing bounded feed/follow/user data already loaded by the client, plus optional topic metadata on posts. Persist only lightweight search history locally; do not create a background indexing service in this release.

**Tech Stack:** Vanilla JS/CSS, existing feed-ranking/content-ordering helpers, Firebase Firestore bounded queries.

**Spec:** `docs/superpowers/specs/2026-09-05-user-experience-expansion-design.md`

## Global Constraints
- No new unbounded listeners.
- No video upload/autoplay.
- Recent searches remain local-only.

---

### Task 1: Hashtags and topic links
**Files:** Create `discovery-policy.mjs`; modify `timeline.js`, `profile.js`, `timeline.css`; test `scripts/test-discovery-experience.mjs`.
- [ ] Write failing tests for hashtag extraction, normalization, clickable topic rendering and topic filtering.
- [ ] Run focused test and confirm red.
- [ ] Implement hashtag parsing and post topic metadata/rendering.
- [ ] Run focused test and confirm green.
- [ ] Commit.

### Task 2: Discovery page
**Files:** Create `discover.html`, `discover.js`, `discover.css`; modify `nav-menu.js`, `sw.js`; test `scripts/test-discovery-experience.mjs`.
- [ ] Add failing assertions for Trending, Popular Today, Topics, suggested people and recent searches.
- [ ] Run focused test and confirm red.
- [ ] Implement bounded ranking from recent posts/users/follows and local search history.
- [ ] Run focused test and confirm green.
- [ ] Commit.

### Task 3: Cost and offline regression
**Files:** Modify `scripts/test-runtime-cost-budgets.mjs`, `scripts/test-push-service-worker.mjs`, `package.json`.
- [ ] Add tests that discovery queries use limits and new assets are in the offline graph.
- [ ] Run tests and confirm green.
- [ ] Commit.