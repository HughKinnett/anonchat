# Phase B Content and Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement AnonChat Phase B: editable posts/comments with moderator-only history, one-level threaded replies, multi-photo/GIF posts, copy text, private Saved and History screens, hashtags/topic feeds, Trending, Popular Today, suggested follows, and private recent searches while preserving canonical post state across all surfaces.

**Architecture:** Keep existing canonical post/comment and interaction-parent logic as the source of truth. Add focused pure-policy modules for editing/version history, threaded replies, media validation, Saved/History, hashtag/discovery ranking, suggested follows, and recent searches. Integrate through existing timeline/profile renderers and Firestore rules rather than creating duplicate feed-specific content.

**Tech Stack:** Vanilla ES modules, Firebase Auth/Firestore client SDK, Firestore security rules/indexes, Firebase Emulator Suite, Node.js policy/source tests, existing Android Trusted Web Activity wrapper.

**Spec:** `docs/superpowers/specs/2026-09-05-phase-b-content-discovery-design.md`

## Global Constraints

- Canonical post/comment documents remain authoritative across all surfaces.
- Users may edit only their own posts/comments, with no edit time limit.
- Edited content shows `Edited`; prior versions are admin/moderator-only.
- Replies use one visible nesting level.
- Posts support up to four uploaded images OR one GIF, with optional text.
- Saved is private and persistent until removed.
- History is private, deduplicated, and capped at 100 viewed posts.
- Hashtags are case-insensitive and resolve to canonical posts.
- Trending uses a rolling 24-hour engagement score.
- Popular Today ranks posts created in the application day.
- Suggested follows use mutual follows, shared public topics, and recent public interactions only, excluding self/followed/blocked users.
- Recent searches are private, deduplicated, newest-first, and capped at 20.
- Legacy content remains compatible without destructive migration.
- Firebase Spark/free-plan compatibility is mandatory.
- Android parity comes from the production web UI in the existing TWA.
- Completion requires focused tests, full regressions, exact-commit production deployment verification, and separate Android build verification.

## Tasks

1. Add edit/version policy, owner-only editing, moderator-only history, and Edited labels.
2. Add one-level threaded replies and canonical reply counts/moderation.
3. Add media policy and composer/rendering support for up to four images or one GIF.
4. Upgrade local bookmarks to private Firestore Saved posts and add private 100-item History.
5. Add copy-text action plus hashtag extraction/indexing and clickable topic feeds.
6. Add Trending and Popular Today ranking/feed modes.
7. Add privacy-preserving Suggested follows.
8. Add private 20-item recent searches with remove/clear controls.
9. Consolidate Phase B canonical rendering across timeline/profile/discovery/Saved/History/topic surfaces.
10. Add Firestore indexes, Phase B package scripts, emulator tests, and CI workflow.
11. Run full regression, code review, merge, exact-commit Firebase deployment, exact-commit Android build, and final verification.

## Required New Policy/Test Files

- `content-edit-policy.mjs`
- `threaded-reply-policy.mjs`
- `post-media-policy.mjs`
- `saved-history-policy.mjs`
- `hashtag-discovery-policy.mjs`
- `suggested-follow-policy.mjs`
- `recent-search-policy.mjs`
- `scripts/test-content-edit-policy.mjs`
- `scripts/test-threaded-reply-policy.mjs`
- `scripts/test-post-media-policy.mjs`
- `scripts/test-saved-history-policy.mjs`
- `scripts/test-hashtag-discovery-policy.mjs`
- `scripts/test-suggested-follow-policy.mjs`
- `scripts/test-recent-search-policy.mjs`
- `scripts/test-phase-b-ui.mjs`
- `scripts/test-phase-b-rules.mjs`
- `scripts/test-phase-b-firestore-integration.mjs`

## Test/Commit Rhythm

Each task follows RED -> minimal implementation -> GREEN -> regression tests -> commit. The final branch must pass `npm run test:phase-b`, `npm run test:phase-b-rules`, and the existing `npm run test:firestore-ci` before merge/deploy is claimed complete.
