# AnonChat User Experience Expansion Design

## Goal
Add the remaining high-value consumer social features to the web app and Android-hosted experience while preserving existing behavior and leaving Stripe, Google Play Billing, and Firebase billing integration disconnected.

## Global requirements
- New and existing features must work end-to-end and be regression tested.
- Android remains a Trusted Web Activity over the production web app, so web features must be mobile-responsive and available inside Android.
- Do not connect Stripe, Google Play Billing, or any billing entitlement backend in this release.
- Do not store payment secrets or card data.
- Preserve existing posting, comments/reactions, follows, message requests, E2EE chats, temporary rooms, disappearing content, moderation, blocking, notifications, Spotify privacy, admin deletion, and Premium behavior.

## Profiles and recognition
- Public profile bio/About Me, interests/topics, and optional status.
- Users may pin up to three of their own posts to the top of their profile.
- Profiles expose an earned-badges section with original AnonChat visual badge artwork, badge name, description, and earned date.
- Default badge catalog includes Founding Member, Community Helper, Top Contributor, Popular Post, Long-Time Member, Premium, Moderator, and Administrator.
- Administrators can create/update badge definitions and award/revoke badges.
- Profile share card and QR-code-style share action are available without exposing real identity information.

## Posts and comments
- Authors can edit their own posts and comments; edited content carries editedAt and displays an Edited label.
- Comments support one-level reply threading through parentCommentId.
- Posts support up to four images represented as an images array while preserving legacy imageData reads.
- GIFs are accepted through image uploads when browser-decoded; no third-party GIF API is required.
- Users can copy post text.
- Saved posts have a visible Saved screen.
- Recent viewed-post history is local/private by default and has a clear-history action.

## Discovery
- Hashtags are parsed from post text and rendered as clickable topic links.
- A Discovery screen contains Trending, Popular Today, Topics, suggested people, and recent searches.
- Ranking uses existing bounded post/follow data; no unbounded new global listeners.

## Messaging
- Direct messages support reply-to-message metadata and emoji reactions.
- Users can delete a message for themselves and, for their own recent message, unsend it for both sides.
- Typing indicators are ephemeral Firestore records with short expirations.
- Message request privacy supports Everyone, People I Follow, Mutual Follows, and Nobody.
- Persistent private group conversations are available to invited members and remain separate from temporary anonymous rooms.

## Notifications and accessibility
- Users can enable/disable notification categories: comments, reactions, follows, direct messages, message requests, room messages, mentions, reveals, and group messages.
- Quiet hours suppress push delivery while retaining in-app notification history.
- Mention events are recognized for @username references.
- Appearance supports system/light/dark and text-size controls stored locally; user-level notification preferences are stored in Firestore.

## Safety and moderation
- Temporary-room messages have an explicit visible Report button in addition to press-and-hold.
- Mute/block controls remain available and are extended to profile/user menus where appropriate.
- Admin moderation exposes edited posts/comments, group conversations that are reported, badges, and topic trends without exposing private message plaintext.

## Admin dashboard
- Add user-experience controls for badges, discovery, group chats, notification categories, and media limits.
- Add summary counts for badges awarded, saved-post usage, topic activity, group chats, and reported new-content types.
- Keep emergency feature switches and existing moderation/admin behavior intact.

## Data and cost controls
- Keep feed/query limits bounded.
- No autoplay video or video upload in this release.
- Multi-image posts are limited to four compressed images to avoid runaway Firestore document size; image-size validation remains enforced client-side and in writer policy where possible.
- Recent viewed history is local-only to avoid read/write cost.

## Verification
- New static policy tests plus Firestore rules integration coverage.
- Existing full `npm run test:firestore-ci` remains mandatory.
- Android APK/AAB build must succeed from merged main.
- Firebase Hosting deployment must complete successfully before declaring the web release live.