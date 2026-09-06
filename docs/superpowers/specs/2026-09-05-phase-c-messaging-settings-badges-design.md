# Phase C — Messaging, Settings, Notifications, Accessibility, and Automatic Badges

Date: 2026-09-05
Repository: `HughKinnett/anonchat`
Status: Approved design for implementation planning

## Purpose

Phase C improves private messaging, notification controls, account-synced settings, accessibility, and the badge system while preserving the existing AnonChat data model and the current community chatroom experience.

This phase intentionally does **not** add persistent group chats. Existing community chatrooms remain the only group-chat system.

## Goals

1. Add modern private-message interactions without replacing the current conversation model.
2. Give users account-synced controls for privacy, notifications, appearance, and accessibility from one Settings page in the hamburger menu.
3. Add safe, context-aware mentions in comments, private messages, and community chatrooms.
4. Replace admin-created/manual milestone badges with an automatic, built-in milestone badge catalog.
5. Preserve badge privacy and make public badge collections easy to browse from profiles.
6. Keep web and Android behavior aligned through the existing production web/TWA architecture.
7. Remain compatible with existing users, conversations, messages, notifications, and badges.

## Non-goals

- No persistent group-chat subsystem.
- No replacement of existing community chatrooms.
- No external GIF or messaging provider.
- No destructive migration of existing private messages or badge assignments.
- No delayed notification flood after quiet hours end.
- No admin UI for creating/editing normal milestone badge definitions.

## Architecture

Phase C extends the existing systems instead of creating parallel ones.

### Existing systems to preserve

- `messageRequests/{pairId}` remains the canonical private-conversation header and authorization record.
- Private messages remain in the existing conversation message subcollection.
- Existing notification adapters/processors remain the canonical notification pipeline.
- Existing community chatrooms remain the canonical multi-user chat experience.
- Existing `users/{uid}.profilePrivacy.showBadges` remains the badge-visibility source of truth.
- The Android app continues to use the production web UI through the current TWA wrapper.

### New high-level components

1. **Settings surface**
   - One new Settings destination linked from the shared hamburger menu.
   - Sections: Privacy & Messaging, Notifications, Appearance, Accessibility.
   - Preferences stored with the signed-in account and reused by web and Android.

2. **Private-message enhancement layer**
   - Typing indicators.
   - Message reactions.
   - Reply-to-message metadata and navigation.
   - Delete-for-me state.
   - Unsend-for-everyone state.
   - Message-request privacy enforcement.

3. **Notification preference layer**
   - Per-category switches.
   - Master pause.
   - Quiet hours.
   - Mention category.

4. **Appearance/accessibility layer**
   - Theme selection.
   - Reduced motion.
   - Text sizing.
   - High contrast.

5. **Automatic badge milestone layer**
   - Built-in badge catalog maintained in code/config rather than admin-created definitions.
   - Automatic, idempotent milestone evaluation and award.
   - Limited admin oversight only.

## Settings UX

A new **Settings** item appears in the shared hamburger menu used by the main AnonChat surfaces.

### Settings → Privacy & Messaging

- Message requests:
  - **Everyone**
  - **People I follow**
  - **No new requests**
- Existing accepted conversations remain available after privacy is tightened.
- Blocking always overrides message-request permissions.
- Private-message feature behavior is explained in-place where useful.

### Settings → Notifications

Per-category switches:

- Reactions
- Comments
- Private Messages
- Message Requests
- Community Chatrooms
- Mentions
- Mutual Reveal Requests

Additional controls:

- **Pause all notifications** master switch.
- **Quiet hours** with user-selected daily start and end times.

Quiet hours suppress push delivery during the selected window but do not remove or skip the in-app notification record.

### Settings → Appearance

- **System default**
- **Light**
- **Dark**
- **Reduce motion** toggle

`System default` follows the local device/browser preference independently on each device even though the selected mode is account-synced.

### Settings → Accessibility

Text size:

- Small
- Default
- Large
- Extra Large

Additional control:

- **High contrast** toggle

Appearance and accessibility settings must apply consistently across Timeline, Profile, Community, messaging, Settings, and other main surfaces through shared helpers/styles rather than page-specific duplication.

## Account-synced preference model

Settings are saved to the signed-in AnonChat account so the same preferences are available on web and Android.

### Safe defaults for existing users

Existing accounts that do not yet have Phase C settings must continue behaving like the current production experience.

Recommended defaults:

- Message requests: Everyone
- All existing notification categories: enabled
- Pause all notifications: off
- Quiet hours: disabled
- Theme: System default
- Reduce motion: off
- Text size: Default
- High contrast: off

Settings-load failure must not block the app. The UI falls back to safe defaults and may retry loading.

## Private messaging

### Typing indicators

Scope: **private conversations only**.

Typing indicators are not added to community chatrooms, temporary rooms, or public comments.

Requirements:

- Participant-only visibility.
- Ephemeral state, not message history.
- Automatically expires after a short timeout so stale indicators cannot remain indefinitely.
- Repeated typing activity refreshes the expiry.
- Navigating away or stopping input clears state when practical, with timeout as the final safety net.

### Message reactions

Approved reaction set:

- 👍
- ❤️
- 😂
- 😮
- 😢
- 😡
- 🖕

Behavior:

- One reaction per user per message.
- Selecting another reaction replaces the user's existing reaction.
- Tapping the currently selected reaction removes it.
- Counts are visible to conversation participants.
- Reaction data belongs to the canonical message rather than a copied timeline/list representation.

### Reply to message

A reply stores a compact reference to the original message.

UI behavior:

- Show a compact preview containing the original sender and a short message snippet.
- Tapping the preview scrolls to the original message if it is still available in the loaded conversation.
- If the original is no longer available because it was unsent or otherwise inaccessible, show **“Original message unavailable.”**

Reply metadata must not expose content that the viewer is no longer authorized to see.

### Delete for me

- Available to a conversation participant for messages visible to that participant.
- Hides the message only for that user.
- Does not delete or alter the other participant's copy.
- Must be represented as participant-specific visibility state, not a destructive canonical-message delete.

### Unsend for everyone

- Only the original sender may unsend their own message.
- Unsend affects both participants.
- The message is not silently removed from conversational history.
- It becomes a neutral **“Message unsent”** placeholder.
- Reply previews that point to the unsent message resolve to **“Original message unavailable.”**
- Sensitive original body/media data should no longer be rendered after unsend.

### Message-request privacy

Approved choices:

- Everyone
- People I follow
- No new requests

Rules:

- Existing accepted conversations remain usable regardless of later privacy changes.
- Blocked users cannot send requests.
- Enforcement occurs in both the UI and Firestore security rules so a direct client write cannot bypass the preference.
- Existing mutual-follow/accepted-conversation behavior should remain compatible unless explicitly superseded by the selected preference.

## Mentions

Supported contexts:

- Comments
- Private messages
- Community chatrooms

Syntax:

- `@username`

Notification requirements:

- A mention only triggers when the username resolves to an existing account.
- The mentioned user must be allowed to access the context.
- Blocking and context visibility rules override mention delivery.
- Duplicate mention notifications from repeated parsing of the same content must be avoided.
- Mention notifications use the dedicated Mentions preference category.

## Notification behavior

The existing notification pipeline remains canonical.

Before push delivery, Phase C applies the recipient's current notification settings.

### Delivery decision order

1. In-app notification record is created when the event itself is valid.
2. If **Pause all notifications** is enabled, suppress push.
3. If the event's category switch is disabled, suppress push.
4. If quiet hours are active, suppress push.
5. Otherwise deliver push through the existing pipeline.

Suppressed push notifications are not queued for a later burst. In-app notification history remains available.

## Badge system redesign

### Product direction

Badges become automatic AnonChat achievement milestones, similar in concept to platform achievement systems such as Reddit trophies/achievements, while using original AnonChat names, thresholds, artwork, and logic.

Admins do **not** create normal milestone badges.

### Built-in milestone families

Initial approved families:

1. Early Member
2. Account Age
3. Posts Created
4. Comments Made
5. Reactions Received
6. Followers Reached
7. Community Participation
8. Top Contributor

Each family may have progressively higher tiers.

Examples of tier structure include Bronze/Silver/Gold-style progression or original AnonChat-specific tier names. Final names, icons, threshold values, and artwork are implementation content but must remain original to AnonChat.

### Automatic awards

- Awards are evaluated from canonical AnonChat activity data.
- Awards are idempotent: rerunning evaluation must not duplicate an already-earned badge.
- Once earned, a badge remains earned unless an admin removes it for error/abuse or product policy explicitly defines revocation.
- Badge-award processing must respect the Firebase Spark-plan architecture and avoid unnecessary high-volume reads.
- Existing earned badge records remain compatible.

### Admin dashboard changes

Remove:

- Create badge
- Edit badge definition
- Manual assignment of normal milestone badges
- Manual selection of automatic/manual award mode for normal milestone badges

Retain only:

- View which badges a user has earned.
- Remove a badge that was awarded incorrectly or is being abused.
- Emergency **Disable automatic badge awards** switch.

The emergency switch pauses future automatic awards without deleting existing earned badges.

### Badge visibility and profile browsing

The existing `profilePrivacy.showBadges` preference remains authoritative.

When badges are public:

- Show a badge preview on the profile.
- The preview is clickable.
- Clicking opens the user's full earned-badge collection.
- Badge detail can show the badge name, artwork, description, milestone/tier, and earned date where available.

When badges are private:

- Other users cannot read or open the badge collection.
- The profile owner can still view their own badges.
- The owner should see a private/hidden indicator so the setting is understandable.
- Admin access continues only where current moderation/admin policy allows it.

## Data-flow and compatibility rules

1. Existing conversations/messages remain valid without migration.
2. New message fields/subcollections are optional and only appear when features are used.
3. Existing notification records continue working if no Phase C settings exist.
4. Existing profile privacy defaults remain backward-compatible.
5. Existing badge assignments remain readable and compatible.
6. No copied canonical message content should be introduced solely for reaction/reply/list rendering.
7. Community chatrooms are not converted into or duplicated by a persistent-group model.
8. Android parity comes from the shared production web/TWA model; no separate native feature implementation should diverge from web behavior.

## Firestore and authorization requirements

Security rules must enforce, at minimum:

- Participant-only private conversation/message reads.
- Sender-only unsend of sender-owned messages.
- Participant-specific delete-for-me state access.
- Participant-only reaction writes on messages in accepted conversations.
- Message-request privacy at request creation time.
- Owner-only settings writes.
- Settings reads restricted to the owning user except for narrowly required server/admin processing.
- Existing `showBadges` privacy protection for user badge reads.
- Admin badge-removal rights without restoring admin badge-creation rights.

Any processor that requires reading user settings must use the narrowest access pattern available.

## Failure handling

- Settings load failure: use safe defaults and do not block the app.
- Typing state becomes stale: expiry removes it automatically.
- Reply target unavailable: show **“Original message unavailable.”**
- Unsend request by non-sender: reject.
- Message request violates recipient privacy: reject and show a clear user-facing error.
- Mention target invalid/inaccessible: no notification is generated.
- Badge evaluator runs twice: no duplicate badge is created.
- Automatic badge awards disabled: evaluation may calculate eligibility but must not create new awards until re-enabled.

## Testing strategy

Implementation must follow test-driven development and retain the existing regression suite.

### Policy/unit coverage

- Settings normalization and defaulting.
- Message-request privacy decisions.
- Typing expiry logic.
- Reaction replacement/removal behavior.
- Reply target resolution/unavailable fallback.
- Delete-for-me visibility.
- Sender-only unsend behavior.
- Notification-category filtering.
- Pause-all behavior.
- Quiet-hours calculations, including overnight windows.
- Mention parsing/resolution/deduplication.
- Theme/text-size/reduced-motion/high-contrast normalization.
- Badge milestone threshold evaluation.
- Badge award idempotency.
- Badge emergency-switch behavior.

### Firestore rule coverage

- Unauthorized conversation access denied.
- Unauthorized reaction/reply/unsend writes denied.
- Message-request privacy cannot be bypassed.
- User settings are owner-private.
- Badge privacy follows `showBadges`.
- Admin can remove earned badges but cannot create/edit normal milestone definitions through the retired admin path.

### UI/integration coverage

- Settings link appears in the shared hamburger menu.
- Settings screen exposes all approved controls.
- Settings changes persist and reload.
- Theme/accessibility settings apply across main surfaces.
- Private-message reactions/replies/unsend/delete-for-me render correctly.
- Public badge preview opens the full badge collection.
- Private badge collection is hidden from other users and visible to owner.
- Admin dashboard no longer exposes badge creation/manual milestone assignment.

### Regression and release verification

Before completion:

- Run focused Phase C tests.
- Run full existing Firestore/regression suites.
- Run syntax checks.
- Run service-worker/offline tests and add new Phase C assets to the app shell if required.
- Verify Firebase rules/index requirements.
- Merge only after review and green tests.
- Deploy Firebase web from the merged SHA.
- Build Android APK/AAB from the same merged SHA.
- Report exact commit/run/artifact evidence.
- Do not claim Google Play publication unless store-release evidence exists.

## Implementation boundaries

Prefer small focused policy/helper modules over expanding already-large integration files. Existing integration points such as timeline/profile/community/private-message controllers should consume the new policies rather than duplicate decision logic.

Do not introduce unrelated refactors. Any cleanup must directly support Phase C reliability, testability, or consistency.

## Approved decisions summary

- Settings lives inside the hamburger menu.
- Typing indicators: private conversations only.
- Message reactions: 👍 ❤️ 😂 😮 😢 😡 🖕.
- One reaction per user per message; same reaction toggles off; new reaction replaces old.
- Reply-to-message includes compact original preview and jump-to-original behavior.
- Missing/unsent reply target shows **“Original message unavailable.”**
- Delete for me: anytime, participant-local.
- Unsend for everyone: sender-owned messages only; leaves **“Message unsent”** placeholder.
- Message-request privacy: Everyone / People I follow / No new requests.
- No persistent groups; community chatrooms remain the group-chat system.
- Notification categories: Reactions, Comments, Private Messages, Message Requests, Community Chatrooms, Mentions, Mutual Reveal Requests.
- Master Pause all notifications switch.
- Quiet hours suppress push but retain in-app history.
- Mentions in comments, private messages, and community chatrooms.
- Appearance: System / Light / Dark + Reduce motion.
- Accessibility: Small / Default / Large / Extra Large + High contrast.
- Settings sync across web and Android; System theme follows each device.
- Admin badge creation/manual normal milestone assignment removed.
- Automatic milestone badge families: Early Member, Account Age, Posts Created, Comments Made, Reactions Received, Followers Reached, Community Participation, Top Contributor.
- Admin retains badge view, corrective removal, and emergency automatic-award disable switch.
- Public profile badge area opens the full badge collection.
- `showBadges` controls whether other users can see/open badges; owner can always see their own.
