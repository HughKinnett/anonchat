# Profiles and Content Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add profile bio/status/interests, badges, pinned posts, post/comment editing, threaded replies, multi-image/GIF support, saved posts, copy-text, and local viewed history.

**Architecture:** Extend existing user/post/comment documents with optional backward-compatible fields, add badgeDefinition/userBadge collections and savedPosts, and keep recent views local. Add small focused modules loaded by timeline/profile instead of growing the main files further.

**Tech Stack:** Firebase Auth/Firestore 10.12.5 browser modules, vanilla JS/CSS, existing moderation and writer policies.

**Spec:** `docs/superpowers/specs/2026-09-05-user-experience-expansion-design.md`

## Global Constraints
- No billing integration.
- Existing data remains readable.
- All new writes must be owner/admin constrained in Firestore rules.
- Up to three pinned posts and four images per post.

---

### Task 1: Profile details and badges
**Files:** Create `profile-extras.js`, `badge-policy.mjs`; modify `profile.html`, `profile.js`, `timeline.html`, `timeline.js`, `timeline.css`, `firestore.rules`; test `scripts/test-user-experience-expansion.mjs`.
**Interfaces:** `badgeCatalog()`, `renderProfileExtras({profile, viewerUid, targetUid})`.
- [ ] Add failing assertions for profile bio/status/interests, badge artwork, and max-three pins.
- [ ] Run `node scripts/test-user-experience-expansion.mjs` and confirm red.
- [ ] Add optional profile fields and badge collections/rules, then render/edit controls for self and read-only views for others.
- [ ] Re-run the focused test and confirm green.
- [ ] Commit.

### Task 2: Editing, replies, media and saves
**Files:** Create `content-extras.js`, `content-extras-policy.mjs`, `saved.html`, `saved.js`; modify `timeline.html`, `timeline.js`, `profile.js`, `timeline.css`, `firestore.rules`, `content-writer-policy.mjs`, `sw.js`; test `scripts/test-user-experience-expansion.mjs`.
**Interfaces:** `extractHashtags(text)`, `canEditOwnedContent`, `normalizePostImages`, savedPosts key `${uid}_${collection}_${postId}`.
- [ ] Add failing assertions for edit controls, Edited label, parentCommentId replies, four-image cap, copy text, saved screen and local viewed history.
- [ ] Run focused test and confirm red.
- [ ] Implement owner-only edits and saves with backward-compatible imageData plus images[] rendering.
- [ ] Re-run focused test and confirm green.
- [ ] Commit.

### Task 3: Rules regression
**Files:** Create `scripts/test-user-experience-rules.mjs`; modify `package.json`.
- [ ] Write emulator tests proving users can edit only their own content, save only to their own saved-post namespace, update only their own public profile extras, and cannot award badges.
- [ ] Run emulator tests and confirm expected red/green cycle.
- [ ] Add test scripts to `test:firestore-ci`.
- [ ] Commit.