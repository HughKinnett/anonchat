# Simplified Admin Command Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the existing admin page into a task-first, plain-English command center while preserving all working moderation, analytics, user-management, and deletion behavior.

**Architecture:** Keep the current single-page admin implementation. Add tested pure policy helpers for settings/defaults and attention summaries, then wire new Firestore-backed settings/announcement controls into `admin.js`, with task-first markup and responsive styling in `admin.html`/`admin.css`.

**Tech Stack:** Vanilla HTML/CSS/ES modules, Firebase Auth/Firestore 10.12.5, Node-based policy tests, GitHub Actions/Firebase Hosting.

**Spec:** `docs/superpowers/specs/2026-09-04-simplified-admin-command-center-design.md`

## Global Constraints
- Keep the existing free-Firebase architecture.
- Existing features remain enabled when settings documents or fields are missing.
- Use plain-English labels for nontechnical administrators.
- Do not expose passwords or unnecessary private-message content.
- Require confirmation before disabling registrations, posting, or private messaging.
- Preserve existing moderation, restore, deletion, and analytics workflows.

---

### Task 1: Add testable dashboard settings policy

**Files:**
- Modify: `admin-dashboard-policy.mjs`
- Modify: `scripts/test-admin-dashboard-policy.mjs`

**Interfaces:**
- Produces: `normalizeFeatureSettings(record)`, `featureStatusLabel(enabled)`, `adminAttentionSummary(input)`.

- [ ] Write failing assertions for missing-setting defaults, status labels, and attention counts.
- [ ] Run `npm run test:admin-dashboard` and confirm the new assertions fail.
- [ ] Implement minimal pure helpers in `admin-dashboard-policy.mjs`.
- [ ] Re-run `npm run test:admin-dashboard` and confirm pass.
- [ ] Commit the policy/test change.

### Task 2: Add task-first command-center markup and styling

**Files:**
- Modify: `admin.html`
- Modify: `admin.css`
- Modify: `scripts/test-admin-dashboard-policy.mjs`

**Interfaces:**
- Produces DOM IDs consumed by Task 3: `attention-open-reports`, `attention-service-health`, `site-health-list`, `notification-health`, `feature-switches`, `announcement-text`, `announcement-active`, `save-announcement`, `moderation-history`, `firebase-usage-note`, `emergency-controls`.

- [ ] Add failing source-level assertions for the required command-center sections and IDs.
- [ ] Run `npm run test:admin-dashboard` and confirm failure.
- [ ] Add `Things needing attention`, `Site health`, `Announcements`, `Feature switches`, `Moderation history`, `Firebase usage`, and `Emergency controls` above analytics while keeping existing sections.
- [ ] Add responsive, plain-language card/switch/status styling in `admin.css`.
- [ ] Re-run `npm run test:admin-dashboard` and confirm pass.
- [ ] Commit markup/style changes.

### Task 3: Wire live settings, health, history, and controls

**Files:**
- Modify: `admin.js`
- Modify: `scripts/test-admin-dashboard-policy.mjs`

**Interfaces:**
- Consumes: `normalizeFeatureSettings`, `featureStatusLabel`, `adminAttentionSummary`.
- Reads/writes: `siteSettings/features`, `siteSettings/announcement`.

- [ ] Add failing source-level assertions that `admin.js` listens to both settings documents, renders switches/announcement, writes settings with `updatedAt` and `updatedBy`, renders moderation history, and confirms emergency disables.
- [ ] Run `npm run test:admin-dashboard` and confirm failure.
- [ ] Extend admin state with feature settings and announcement state.
- [ ] Add live listeners after administrator access succeeds.
- [ ] Render attention summary and plain-English site-health rows from existing state plus settings.
- [ ] Render moderation action history from existing moderation action records.
- [ ] Implement feature toggle writes and announcement save/clear behavior.
- [ ] Implement emergency controls by reusing feature-setting writes with explicit confirmation for disabling registrations/posting/private messaging.
- [ ] Re-run `npm run test:admin-dashboard` and confirm pass.
- [ ] Commit wiring changes.

### Task 4: Full verification, review, merge, and production deployment

**Files:**
- Review all changes in the feature branch.

**Interfaces:**
- Produces: merged production-ready admin dashboard.

- [ ] Run `npm run test:admin-dashboard`.
- [ ] Run the repository Firestore CI / required pull-request checks.
- [ ] Review the final diff for accidental unrelated changes and destructive defaults.
- [ ] Open/update PR from `feature/simplified-admin-command-center` to `main`.
- [ ] Merge only when required checks pass.
- [ ] Verify the Firebase production workflow completes successfully, including Firestore rules and Hosting.
