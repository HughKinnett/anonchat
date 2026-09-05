# Admin, Safety, and Accessibility Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add admin controls for badges/discovery/groups/media, visible temp-room reporting, accessibility preferences, and final regression coverage for existing product behavior.

**Architecture:** Extend the existing single-page command-center pattern with new sections and feature switches, preserve existing moderation/deletion architecture, and keep appearance/text-size preferences client-side. Add only bounded admin summaries that can be computed from existing or explicitly limited collections.

**Tech Stack:** Firebase Auth/Firestore, existing admin command-center modules, vanilla JS/CSS, service worker/PWA, Android TWA wrapper.

**Spec:** `docs/superpowers/specs/2026-09-05-user-experience-expansion-design.md`

## Global Constraints
- No billing hookup.
- Admin never reads E2EE private-message plaintext.
- Existing emergency controls remain intact.
- Every new user feature has an admin visibility/control path where appropriate.

---

### Task 1: Visible room report controls and accessibility
**Files:** Create `accessibility.js`; modify `community.js`, `community.css`, `timeline.html`, `profile.html`, `community.html`, `nav-menu.js`, `sw.js`; test `scripts/test-user-experience-expansion.mjs`.
- [ ] Add failing assertions for visible Report buttons, appearance mode and text-size controls.
- [ ] Confirm red.
- [ ] Implement controls with local storage and existing moderation client.
- [ ] Confirm green.
- [ ] Commit.

### Task 2: Admin feature management
**Files:** Modify `admin.html`, `admin.js`, `admin.css`, `admin-dashboard-policy.mjs`, `firestore.rules`; create `admin-experience-policy.mjs`; test `scripts/test-admin-user-experience.mjs` and existing admin tests.
- [ ] Add failing tests for badge management, discovery/group/media switches and summary/status areas.
- [ ] Confirm red.
- [ ] Implement admin controls and safe bounded listeners/writes.
- [ ] Run focused and existing admin tests green.
- [ ] Commit.

### Task 3: Full regression and release
**Files:** Modify `package.json`, `sw.js`, Android version metadata if required.
- [ ] Add all permanent focused tests to `test:firestore-ci`.
- [ ] Run `npm run test:workflow-policy` and full `npm run test:firestore-ci` in CI.
- [ ] Build Android APK/AAB from the exact release head.
- [ ] Review complete diff and merge only if green.
- [ ] Verify Firebase production rollout through Hosting.
- [ ] Verify Android main build artifacts exist.