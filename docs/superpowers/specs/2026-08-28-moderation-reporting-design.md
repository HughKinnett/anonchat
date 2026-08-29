# Moderation Reporting Design

## Goal

Add user blocking, post reporting, and temporary-room reporting with a secure administrator review queue. Reported evidence remains stored until an administrator restores or permanently deletes it.

## User blocking

- Every profile other than the signed-in user's own profile shows a Block User control.
- A block record uses the deterministic ID `<blockerUid>_<blockedUid>` and records `blockerId`, `blockedId`, and a trusted creation timestamp.
- Blocking is one-directional but separates both accounts throughout the product: neither account sees the other's profile content, timeline posts, comments, reactions, message requests, direct messages, or temporary-room messages.
- The blocker can unblock the account from that profile. Only the blocker may create or delete their block record.
- Existing accepted message relationships are not deleted, but their conversation remains inaccessible while either directional block exists.

## Timeline post reporting

- Every timeline post shows a Report control to signed-in users other than the author. Authors retain their existing Delete control.
- A user can report a post only once. The report stores the reporter, target post, post author, reason, status, and trusted timestamp.
- The first valid report atomically marks the post `moderationStatus: "reported"`. Reported posts disappear immediately from public timeline/profile queries and cannot receive new comments, reactions, or reposts.
- The original post remains in Firestore with its existing content and expiration timestamp. An expired reported post remains preserved for administrator review.
- Administrators may restore a reported post, which clears the moderation hold and returns it to normal visibility only if it has not otherwise expired. Administrators may permanently delete the post and dependent comments, reactions, and report records.

## Temporary-room reporting

- Every temporary room shows Report Room to signed-in members other than the room owner.
- A user can report a room only once. The report records the reporter, room, room owner, reason, status, and trusted timestamp.
- The first valid report atomically changes the room to `moderationStatus: "reported"` and records `reportedAt`. The room immediately becomes suspended: members can no longer join, reopen it, or send messages.
- The room and every existing message remain readable only to administrators while suspended. Message expiration is ignored while the room is reported, preserving the complete moderation record.
- A reported room never disappears automatically. It remains stored until an administrator decides.
- Restore changes the room to `moderationStatus: "active"`, records `resumedAt`, and gives the room and its retained messages a fresh 24-hour expiration window beginning at the administrator's decision.
- Permanent deletion removes the room, its memberships, messages, and report records.

## Administrator dashboard

- Add a Reported Content panel before general Content Moderation.
- The panel has Posts and Temporary Rooms filters, a visible pending count, newest-first ordering, report reason, reporter, content owner, report time, and content preview.
- Reported posts have Restore to Timeline and Permanently Delete actions.
- Reported rooms have Allow Room to Resume and Permanently Delete Room actions.
- Destructive actions require confirmation. Every action shows a live success or failure status and becomes disabled while pending.
- Resolved records leave the pending queue. The underlying report receives a resolution status, administrator UID, resolution action, and trusted resolution timestamp before cleanup where deletion requires an audit trail.

## Firestore authorization

- Ordinary users may create exact report and block payloads only for themselves.
- Users cannot update reports, set moderation fields directly, restore content, or read the administrator report queue.
- Administrator authority uses the repository's existing protected-account verification.
- Creating a report and placing its target on moderation hold occurs in one atomic batch validated with `getAfter`/`existsAfter` rules.
- Reported posts reject interaction writes. Reported rooms reject membership and message writes.
- Administrator restore/delete operations require exact allowed field transitions and trusted timestamps.

## Expiration behavior

- Normal temporary-room messages retain their existing 24-hour lifetime.
- The timeline composer uses a compact photo-upload bubble placed beside the Disappear control. Selecting a disappearance period previews the exact local date and time when the post will disappear.
- Every expiring timeline post and temporary-room message displays its exact local disappearance date and time.
- Reported posts and rooms replace the normal disappearance timestamp with an administrator-review hold message because expiration is paused.
- A reported room and all of its messages are held regardless of their original expiration timestamps.
- Restoring a room resets the room and retained-message expiration to 24 hours from restoration.
- A reported timeline post is held for review even if its normal disappearance time passes. Restoring an already expired post resolves the report but does not republish expired content.

## Testing and release

- Add pure policy tests for block visibility, report payloads, moderation transitions, and expiration decisions.
- Add Firestore emulator tests proving ordinary users cannot forge moderation state and administrators can perform only approved transitions.
- Add UI policy tests for report-button visibility and dashboard action states.
- Run the complete existing regression and Firestore suites, deploy Hosting, Firestore rules, and indexes, and verify the production workflow succeeds.
- The Android Trusted Web Activity uses the deployed web application, so these controls and moderation states automatically apply to the Android package.
