# Messaging and Notifications Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add richer direct messaging, private group chats, typing indicators, message reactions/replies/unsend, request privacy, mention notifications, category controls and quiet hours.

**Architecture:** Extend existing E2EE direct-message documents with optional reply/reaction metadata and add small ephemeral typing records. Add persistent group conversation/member/message collections separate from temporary anonymous rooms. Notification preferences remain per-user and are consumed by the existing notification pipeline where possible.

**Tech Stack:** Firebase Auth/Firestore, existing E2EE modules, vanilla JS/CSS, existing push/notification processor.

**Spec:** `docs/superpowers/specs/2026-09-05-user-experience-expansion-design.md`

## Global Constraints
- Do not expose private message plaintext to admins.
- Keep existing E2EE direct-message behavior intact.
- Typing indicators expire quickly and must not accumulate.
- No billing integration.

---

### Task 1: Direct message quality-of-life
**Files:** Create `messaging-extras-policy.mjs`; modify `community.html`, `community.js`, `community.css`, `firestore.rules`; test `scripts/test-messaging-extras.mjs` and emulator rules test.
- [ ] Write failing tests for reply-to, reactions, typing, unsend/delete-for-me and request privacy.
- [ ] Confirm focused test red.
- [ ] Implement metadata/actions and rules while preserving E2EE payloads.
- [ ] Confirm focused test green.
- [ ] Commit.

### Task 2: Persistent private groups
**Files:** Create `group-chat-policy.mjs`; modify `community.html`, `community.js`, `community.css`, `firestore.rules`; test `scripts/test-group-chat.mjs`, `scripts/test-group-chat-rules.mjs`.
- [ ] Write failing policy and rules tests for owner/member access and invitations.
- [ ] Confirm red.
- [ ] Implement groups, memberships and bounded messages.
- [ ] Confirm green.
- [ ] Commit.

### Task 3: Notification categories and quiet hours
**Files:** Create `notification-preferences.mjs`; modify `community.html`, `community.js`, `notification-processor.mjs`, `notification-firestore-adapter.mjs`, `notification-ui-policy.mjs`, `firestore.rules`; test existing notification tests plus `scripts/test-notification-preferences.mjs`.
- [ ] Write failing preference/quiet-hours/mention tests.
- [ ] Confirm red.
- [ ] Implement preference reads and delivery suppression without dropping in-app history.
- [ ] Run focused and existing notification tests green.
- [ ] Commit.