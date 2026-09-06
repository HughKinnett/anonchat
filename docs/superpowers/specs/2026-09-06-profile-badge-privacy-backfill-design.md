# Profile Badge Privacy and Existing-User Backfill Design

## Goal

Finish the automatic badge rollout by removing the admin member-badge lookup, making earned badges easy to browse from profiles, giving profile owners a privacy control for badge visibility, and immediately reconciling existing users so they receive every badge they currently qualify for.

## Product decisions

- Remove the entire `Member badge status` lookup from the admin dashboard.
- Keep the admin badge catalog read-only.
- Admins must not be able to create, edit, assign, remove, disable, feature, or otherwise alter badges or earned badge records.
- Every current user is evaluated by trusted server-side badge reconciliation after rollout.
- A user earns every permanent badge they currently qualify for, even if badges are hidden from other users.
- Premium Member remains a live status badge and is shown only while the user is an active paid Premium subscriber.
- Existing profile privacy remains authoritative through `users/{uid}.profilePrivacy.showBadges`.
- Badge visibility defaults to on when the field is missing.
- The profile owner can always see their own earned badges, even when hidden from others.
- Other users can open a member's badge collection only when `showBadges` is enabled and blocking/privacy policy allows it.
- All new controls must reuse AnonChat's existing button, input, toggle, dialog, spacing, typography, focus, hover, mobile, and dark-theme styles. No one-off browser-default controls.

## Admin dashboard

The `Achievement badges` panel remains available as a read-only catalog of AnonChat badge definitions and artwork.

Remove:

- `Member badge status` heading and helper text;
- User ID input;
- `View member badges` button;
- member badge assignment/status results container;
- related event handlers and user-badge lookup code.

The admin surface should contain no member-specific badge lookup and no badge mutation controls.

## Profile badge experience

### Badge preview

Profiles show a visible `Badges` section when:

- the viewer is the profile owner; or
- the viewer is allowed by profile privacy and `showBadges !== false`.

The preview uses actual AnonChat badge artwork rather than text-only labels. It shows a compact set of earned badges and a clearly styled `View all badges` action when more badges are available.

### Full badge collection

Clicking a badge preview or `View all badges` opens the full earned-badge collection for that profile.

For each badge, show:

- badge artwork;
- badge name;
- tier;
- description / meaning;
- milestone or qualification requirement;
- earned date when the badge is permanent and has an earned timestamp.

Premium Member is a status badge; its detail view may state that it is shown while paid Premium is active rather than implying permanent ownership.

If another viewer does not have permission to see badges, the collection is not available and the profile does not reveal a hidden badge count.

### Owner privacy control

The profile owner gets a `Show badges on my profile` control in the existing profile/privacy settings area.

Behavior:

- On: other eligible viewers can see the badge preview and open the collection.
- Off: other viewers see no badge preview, badge collection, or badge count.
- The owner still sees their own badge collection with a clear `Hidden from others` indicator.
- Changing visibility never creates, removes, revokes, or modifies earned badges.

The control writes only `profilePrivacy.showBadges` through the existing profile privacy update path.

## Existing-user badge reconciliation

### One-time rollout backfill

Add a trusted, authenticated backfill path that processes all existing users until the full user collection has been traversed.

The backfill runs both reconciliation categories:

1. Identity/status/account-age badges:
   - Founder
   - Founding Member
   - Early Member
   - Early Supporter
   - Verified Admin
   - Verified Moderator when a trusted global moderator source exists
   - Long-Time Member
   - Premium Member status

2. Activity badges:
   - Top Contributor
   - Popular Post Creator
   - Community Helper

The backfill is idempotent. Re-running it cannot duplicate permanent badge records and must remove Premium Member when paid Premium is no longer active.

### Pagination correctness

Current scheduled reconcilers must not permanently skip users after reaching their per-run batch cap.

The rollout design must ensure one of these equivalent guarantees:

- persist and resume a cursor between scheduled runs; or
- a dedicated full backfill loop walks every page during the rollout; and recurring jobs are also changed so all users are eventually revisited.

The implementation should prefer a deterministic persisted cursor or full-pass mechanism that is testable and compatible with Firebase Spark-plan cost constraints.

## Security and privacy

- Browser clients remain unable to create/update/delete earned badge records.
- Admin clients remain unable to create/update/delete earned badge records.
- Badge definitions remain fixed in product code.
- Server-side service-account processing is the only authority for automatic badge writes/removal of status badges.
- `profilePrivacy.showBadges` controls read visibility to other users; it does not control award eligibility.
- Blocking continues to override public profile visibility.

## Visual consistency

Any new or changed interface must use existing AnonChat UI patterns already present in profile/settings/admin surfaces.

Required consistency includes:

- existing primary/secondary button classes rather than raw default buttons;
- existing form/input classes and border/radius treatment;
- existing toggle/switch treatment for privacy preferences;
- existing dialog/modal treatment for full badge collections and badge details;
- existing dark-mode palette, typography scale, spacing, hover/focus states, and touch targets;
- responsive behavior consistent with the rest of the profile on web and Android/TWA.

No new control should look visually separate from the rest of AnonChat.

## Testing

Required coverage:

- admin badge panel no longer contains member badge lookup heading, User ID input, refresh button, or assignment/status container;
- admin badge catalog remains read-only;
- profile badge preview is visible when allowed and clickable;
- `View all badges` opens the full collection;
- collection shows artwork, name, meaning/description, tier, requirement, and earned date where applicable;
- another user cannot see badges or badge count when `showBadges` is false;
- owner can still see their hidden badges with a hidden/private indicator;
- badge visibility toggle writes only `profilePrivacy.showBadges`;
- controls use the existing AnonChat UI classes/patterns;
- full existing-user backfill walks every user page rather than stopping permanently after the first bounded batch set;
- permanent badge awards remain idempotent;
- Premium Member is present only for active paid subscribers and is removed by trusted reconciliation when inactive;
- browser/admin attempts to mutate earned badges remain denied by Firestore rules;
- existing Phase A/Phase C profile, settings, badge, push, messaging, and Firestore regression suites remain green.

## Deployment

1. Add failing contracts for admin cleanup, profile badge browsing/privacy, and full-user reconciliation.
2. Implement profile/admin/backfill changes on an isolated branch.
3. Run focused badge/profile tests and full Firestore/Phase C regression suites.
4. Merge only a fully verified head into `main`.
5. Deploy Firebase Hosting/rules through the existing production workflow.
6. Run the trusted full-user badge backfill against production after successful deployment.
7. Verify backfill completion and resulting badge-award counts/logs without exposing private profile badge visibility data.

## Non-goals

- Do not add any admin badge mutation capability.
- Do not expose hidden badge counts to other users.
- Do not make badge visibility affect whether a user earns a badge.
- Do not make Premium Member permanent.
- Do not redesign unrelated profile sections, settings, or admin controls.
