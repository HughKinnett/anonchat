# Phase C Completion Design

Date: 2026-09-06
Status: Approved design

## Scope

Complete the remaining Phase C work after the already-deployed private-messaging core. This release adds unified account settings, notification controls, mentions, appearance/accessibility preferences, automatic milestone badges, and permanently removes Groups and Interest Communities while retaining Community Chatrooms.

## 1. Unified Settings

Add one Settings destination to the shared hamburger/navigation experience used across AnonChat. Organize it into four sections:

### Privacy & Messaging
- Preserve the deployed private-message request privacy choices: Everyone, People I follow, No new requests.
- Existing accepted conversations remain available after a user tightens request privacy.
- Blocking continues to override messaging access.

### Notifications
Per-category account-synced controls:
- Reactions
- Comments
- Private Messages
- Message Requests
- Community Chatrooms
- Mentions
- Mutual Reveal Requests
- Master Pause all notifications

Quiet hours:
- User selects a daily start and end time.
- Push notifications are suppressed during the quiet window.
- In-app notification history is still recorded.
- Notifications automatically resume when quiet hours end.
- Suppressed pushes are not delivered later as a flood.

Mentions:
- Support @username in comments, private messages, and Community Chatrooms.
- Notify only when the username resolves to a real user and that user can access the referenced context.
- Blocking/privacy access rules override mention delivery.

## 2. Appearance

Account-synced choices:
- System default
- Light
- Dark
- Reduce motion

System default follows the local browser/OS theme on each device. Implementation must preserve compatibility with existing premium-theme behavior.

## 3. Accessibility

Account-synced choices:
- Text size: Small, Default, Large, Extra Large
- High contrast

Preferences apply consistently to supported web views and the Android TWA experience without breaking responsive layouts.

## 4. Remove Groups and Interest Communities

Groups and Interest Communities are retired completely. Community Chatrooms remain AnonChat's community/group-conversation experience.

Removal includes:
- Remove navigation entries, buttons, discovery surfaces, creation flows, management flows, pages/routes, and client-side feature code that exists solely for Groups or Interest Communities.
- Remove corresponding Firestore read/write access from active application behavior and security rules where applicable.
- Remove obsolete offline/service-worker references and tests that assume these retired features remain available.
- Update affected UI copy so users are directed to Community Chatrooms where a community conversation destination is appropriate.

### Permanent data deletion

The user explicitly approved permanent deletion because these features have not been used since their recent creation.

Production rollout will include a controlled, one-time destructive migration that permanently deletes existing Group and Interest Community records and their feature-owned nested data. The migration must:
- target only collections/documents proven to belong to these two retired features;
- avoid deleting Community Chatroom data or unrelated user/content records;
- be idempotent so retrying does not damage unrelated data;
- log deletion counts/categories for deployment verification;
- run only after automated tests validate the target paths.

No restoration or archival copy is required by product design; deletion is intentionally irreversible.

## 5. Automatic Milestone Badges

Remove the Achievement Badge create/edit management experience from the Admin Dashboard. Normal badges become a fixed, original AnonChat catalog maintained in code/configuration and awarded automatically when milestones are reached.

### Badge progression

Original collectible AnonChat visual direction:
- Spark
- Pulse
- Beacon
- Legend

Badge artwork must be original to AnonChat and generated/designed for this catalog rather than copied from Reddit, Facebook, or other services.

### Milestone families
- Early Member
- Account Age
- Posts Created
- Comments Made
- Reactions Received
- Followers Reached
- Community Participation
- Top Contributor

Each family may use the Spark/Pulse/Beacon/Legend tiers where meaningful. Thresholds are deterministic and centrally defined so the client, tests, and award processor agree on qualification.

### Award behavior
- Awards are automatic and idempotent.
- Re-running qualification must not duplicate an earned badge.
- Normal administrators cannot create arbitrary badge types or manually award standard milestone badges.
- Existing earned badges remain visible unless explicitly removed by an administrator or hidden by profile privacy.
- Existing `profilePrivacy.showBadges` remains the visibility source of truth.
- Public badge previews remain clickable into the full collection when badges are public.
- When badges are private, other users cannot view/open the collection; the owner can always see their own earned badges.

### Admin controls retained
Only:
1. View badges a user has earned.
2. Remove an incorrectly or abusively awarded badge.
3. Emergency Disable automatic badge awards switch.

The old Create Badge / Edit Badge UI and normal manual assignment controls are removed.

## 6. Architecture and Data Safety

- Extend existing account/user settings rather than introducing parallel preference stores.
- Keep notification preference evaluation centralized so web UI, push delivery, mentions, and quiet hours use the same rules.
- Keep badge definitions centralized and immutable to ordinary admin UI.
- Use existing canonical user/post/comment/chatroom data to calculate milestones; do not duplicate canonical content into badge documents.
- Award documents record earned state/metadata, not copied source content.
- Community Chatrooms and their data model remain untouched by the Groups/Interest Communities destructive migration.
- Maintain backwards compatibility for users without new settings by applying safe defaults matching current behavior.

## 7. Error Handling

- Missing settings documents resolve to defaults.
- Invalid/corrupt preference values fall back safely rather than preventing app load.
- Mention resolution failures do not block posting/messaging.
- Badge award processing is retry-safe.
- Destructive feature cleanup fails closed if target collection/path validation does not match the expected retired-feature schema.

## 8. Testing and Verification

Before merge/deployment, add automated coverage for:
- settings defaults and account persistence;
- notification category filtering;
- Pause all notifications;
- quiet-hour windows including overnight ranges;
- mention resolution/access/blocking behavior;
- appearance, reduced motion, text sizing, and high contrast integration;
- removal of Groups/Interest Communities navigation/routes/references;
- destructive migration target allowlist and idempotence;
- proof that Community Chatrooms are not targeted by deletion;
- badge milestone thresholds, tier progression, idempotent awards, admin removal, emergency disable switch, and profile privacy;
- Admin Dashboard absence of badge creation/edit/manual-award controls;
- service-worker/offline dependency coverage;
- Firestore security rules;
- Android/TWA parity and build.

Production completion requires fresh CI success, reviewed merge to main, successful Firebase rules/hosting rollout, destructive migration verification, and a successful Android APK/AAB build from the exact merged commit.

## Explicit Product Decisions

- The already-deployed Phase C messaging core remains in place.
- Persistent Groups are not being added; existing Community Chatrooms remain the group-chat experience.
- Groups and Interest Communities are permanently removed and their existing feature data permanently deleted.
- Achievement badges are automatic milestone awards, not admin-created content.
- Badge artwork/catalog is original AnonChat work with Spark -> Pulse -> Beacon -> Legend progression.
