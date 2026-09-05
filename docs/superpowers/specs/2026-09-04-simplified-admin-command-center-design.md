# Simplified Admin Command Center Design

## Goal
Turn the existing AnonChat administrator page into a task-first command center that a nontechnical administrator can understand and operate without removing working moderation, user, analytics, or deletion controls.

## Design principles
- Put urgent items first: reports, failed services, moderation backlog, deletion failures, and emergency states.
- Use plain-English labels such as `Working`, `Needs attention`, `Paused`, and `Off` instead of raw technical state.
- Keep destructive or site-wide actions behind explicit confirmation.
- Preserve the existing free-Firebase architecture and existing moderation/deletion processors.
- Keep the current single-page admin dashboard and existing admin authorization checks.
- Do not expose passwords, private-message contents, or other unnecessary private data.

## Information architecture
1. **Things needing attention** — one summary panel with counts/status for open reports, failed deletion jobs, failed moderation processor state, inactive users, and emergency feature switches.
2. **Site health** — plain-English status cards for login/access, posting, comments, private messaging, temporary chats, uploads, Spotify embeds, notifications, moderation processing, and account deletion processing. Where the browser cannot directly prove backend health, label the status as `Not checked here` instead of inventing certainty.
3. **Users and account controls** — retain search, status filters, profile link, ban/unban, delete-account flow, and inactive-user list; add clearer summary details where existing records support them.
4. **Reports inbox** — retain report review, restore, delete, warning/suspension actions that already exist in the moderation workflow; present the section as the main moderation inbox.
5. **Moderation history** — show recent moderation actions from the existing moderation action records, including action, administrator, status, and timestamp.
6. **Announcements** — administrator can create/update/clear one current site announcement stored in `siteSettings/announcement` with text, active flag, and audit timestamps.
7. **Feature switches** — administrator can enable/disable registrations, posting, comments, private messaging, temporary chats, uploads, and Spotify embeds using `siteSettings/features`. Controls are explained in plain language. Emergency switches use the same data model but require confirmation before disabling a core feature.
8. **Notification health** — show the existing moderation/deletion processor state and a separate notification status area backed by the latest available notification processor/status record when present; otherwise clearly show `Not checked here`.
9. **Storage / Firebase usage** — explain that exact quota numbers are not available to the client dashboard; show a plain-English free-plan note and link the section to existing usage proxies such as content/user counts rather than claiming billing data.
10. **Analytics** — retain current 1/7/30-day metrics, charts, active members, engaged posts, content mix, reaction mix, and data-health details, but move them below action-oriented controls.
11. **Emergency controls** — a dedicated panel for disabling registrations, posting, or messaging, each with confirmation. Re-enabling is a single action.

## Data model additions
### `siteSettings/features`
Fields:
- `registrationsEnabled: boolean`
- `postingEnabled: boolean`
- `commentsEnabled: boolean`
- `privateMessagingEnabled: boolean`
- `temporaryChatsEnabled: boolean`
- `uploadsEnabled: boolean`
- `spotifyEmbedsEnabled: boolean`
- `updatedAt: serverTimestamp()`
- `updatedBy: admin uid`

Missing feature fields default to `true` so existing production behavior remains unchanged, except registrations. Registrations default to `false` when no settings document exists, preserving AnonChat's current closed-registration launch state until an administrator deliberately opens registration.

### `siteSettings/announcement`
Fields:
- `text: string` trimmed to 500 characters
- `active: boolean`
- `updatedAt: serverTimestamp()`
- `updatedBy: admin uid`

## Integration approach
The admin page will read both settings documents with live Firestore listeners and write them only after administrator authentication has already passed. New dashboard UI will be implemented in `admin.html`, `admin.css`, and `admin.js`. Small pure helpers for settings normalization and attention/status summaries will live in `admin-dashboard-policy.mjs` so they can be tested without a browser.

The production site will continue to operate normally if the settings documents do not exist. This dashboard phase establishes the command-center controls and settings records; existing public features are not silently disabled.

## Error handling
- Any failed settings write leaves the previous value on screen and shows a plain-English error.
- A missing optional health source displays `Not checked here`, never `Working`.
- Destructive account deletion keeps the existing typed-username confirmation.
- Site-wide emergency disable actions require a browser confirmation explaining what users will lose access to.

## Testing
- Extend `scripts/test-admin-dashboard-policy.mjs` for settings defaults, labels, and attention summary behavior.
- Add source-level assertions that the dashboard contains the new task-first sections and that `admin.js` listens to and writes the expected settings documents.
- Run `npm run test:admin-dashboard` and the repository Firestore CI before merge.
- Merge only after the pull-request checks pass; deployment then uses the existing Firebase production workflow.
