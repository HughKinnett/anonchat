# Profile, Messaging, Badge, QR, and Android Architecture Correction

Date: 2026-09-06

## Context

Several production fixes have deployed successfully but live behavior is still inconsistent in four related areas:

1. The authenticated owner opening `profile.html` without `?uid=` does not reliably get the same profile target as someone viewing `profile.html?uid=<uid>`.
2. Older accepted private-message conversations can appear selectable but fail to accept new encrypted messages because current Firestore rules require deterministic pair conversation IDs.
3. Profile QR rendering depends on a CDN-provided global renderer and can open without producing a QR code when that dependency is unavailable or delayed.
4. Founder, Founding Member, and Premium badge eligibility/display rules need to be mutually consistent and production-backfilled.

This correction replaces patch-on-patch behavior with explicit shared boundaries.

## Goals

- Make all profile controllers resolve the same target user.
- Make My profile fully equivalent to viewing the signed-in user's canonical public profile.
- Keep earned badges behind a single themed Badges button rather than showing a badge preview card above Spotify.
- Preserve badge privacy while ensuring owners can always open their own badge collection.
- Make profile QR generation self-contained and reliable on desktop, PWA, and Android TWA.
- Make all accepted private conversations writable through one canonical deterministic conversation record, including legacy accepted conversations.
- Preserve existing private-message history and acceptance state during migration.
- Make Founder and Founding Member mutually exclusive.
- Give Founder and Founding Member cohorts Premium Member badge entitlement while retaining paid-Premium eligibility for ordinary subscribers.
- Ship and verify the same shared changes through Android and produce a fresh APK/AAB.

## Non-goals

- Do not replace the TWA with a native duplicate UI.
- Do not weaken end-to-end encryption or permit plaintext direct-message writes.
- Do not expose hidden badges to visitors.
- Do not reintroduce manual admin badge assignment.
- Do not remove the existing paid-Premium badge entitlement for normal subscribers.
- Do not redesign unrelated profile, Spotify, moderation, or messaging UI.

## 1. Canonical profile target resolver

Create one reusable resolver for profile target identity.

Resolution rules:

1. If the URL contains a non-empty `uid` query parameter, that UID is the profile target.
2. Otherwise, after Firebase Auth is ready, the authenticated user's UID is the profile target.
3. If neither is available, the profile page remains unavailable and no protected profile data is loaded.

`profile.js`, `profile-badges.js`, and `profile-phase-a.js` must consume the same resolver rather than reimplementing target resolution independently.

All owner-only comparisons, privacy controls, Share data, QR payloads, profile posts, follows, premium visuals, badge reads, and social actions must use this resolved target.

This makes `profile.html` and `profile.html?uid=<signed-in-uid>` behaviorally equivalent for the owner.

## 2. Badge entry and display model

The profile action row retains a themed `Badges` button using the existing `secondary-button` class.

Visibility rules:

- Owner: the Badges button is visible whenever the owner profile is available, including when `showBadges` is false. The owner may always inspect their own badges.
- Visitor: the Badges button is visible only when the badge collection is readable under the existing profile badge privacy policy.
- Blocked/unavailable profile: the button is hidden.

Badge content remains inside the existing themed badge collection/detail dialogs.

The inline badge preview section currently displayed above the Spotify card is removed from normal profile layout. It must not render earned badge cards, an empty-state card, or a separate `View all badges` button above Spotify. The badge collection is accessed only through the Badges action button.

The badge collection dialog continues to use the existing AnonChat theme tokens and standard button classes.

## 3. Self-contained profile QR rendering

Remove runtime dependency on the external CDN `QRCode` global for profile rendering.

Use a repository-local/browser-importable QR implementation so the profile page can render a QR code without network access to a third-party CDN after AnonChat assets load.

The QR payload remains the canonical public profile URL and must not contain private/session data.

The Profile QR button and dialog continue to use the existing AnonChat button, surface, border, text, and spacing styles.

If local QR rendering fails, show the existing profile status error and leave the canonical URL visible for copy/share fallback.

## 4. Canonical accepted-conversation model

Current Firestore rules accept direct-message writes only under deterministic pair IDs derived from `fromId` and `toId`. The UI, however, can still select older accepted request documents with arbitrary legacy IDs.

Define a single canonical pair-ID helper shared by UI/migration logic:

- canonical ID is deterministic for the two participant UIDs and independent of direction;
- existing current records that already use either allowed deterministic direction remain compatible;
- migration selects one canonical orientation consistently for future client writes.

### Legacy conversation migration

Extend the authenticated production migration to scan accepted `messageRequests` records whose document ID is noncanonical.

For each legacy accepted record:

1. Compute the canonical pair document ID.
2. Create or merge the canonical header preserving participants, accepted state, timestamps, request metadata, and any compatible summary fields.
3. Copy/move the existing `messages` subcollection to the canonical conversation without changing encrypted payloads, sender IDs, timestamps, disappear expiries, reply metadata, reactions, visibility state, or moderation metadata.
4. Preserve per-user visibility/index state associated with the conversation.
5. Mark or remove the legacy header only after canonical data has been verified so no message history is lost.
6. Make the migration idempotent and safe to rerun during deploy/catch-up.

### Client behavior

The conversation picker resolves accepted relationships by participant pair but Send always writes through the canonical conversation record.

If a legacy record is encountered before migration has completed, the client must resolve to the canonical pair record when one exists and must not attempt a new write beneath a noncanonical legacy ID.

End-to-end encryption remains mandatory. The send handler continues to derive the pairwise key and write encrypted `bodyCipher`/`imageCipher` envelopes only.

Errors from encryption readiness or Firestore writes must be surfaced in the existing status area instead of appearing as a dead button.

## 5. Badge entitlement rules

### Founder

A trusted founder is eligible for:

- `founder`
- `premium-member`
- any other independently earned non-founding badges

A founder is explicitly **not** eligible for `founding-member`.

### Founding Member

A non-founder account created within the trusted Founding Member cutoff is eligible for:

- `founding-member`
- `premium-member`
- any other independently earned badges

### Normal Premium subscriber

A non-founder/non-founding user continues to receive `premium-member` only while paid Premium is active under the existing subscriber entitlement.

### Premium badge persistence semantics

The current Premium badge is normally revocable when paid Premium ends. Founder/Founding Member entitlement is a separate trusted reason for Premium visibility.

`badgeShouldRemainVisible` and reconciliation logic must therefore keep `premium-member` when either:

- paid Premium is active; or
- trusted founder/founding-member entitlement is active.

The system must not infer founding status from client-editable profile fields beyond the existing trusted founder identity source and account creation cutoff.

## 6. Backfill and cleanup

The full existing-user badge reconciliation must enforce the new mutually exclusive rules:

- remove `founding-member` from all trusted founders;
- ensure each trusted founder has `founder` and `premium-member`;
- ensure each eligible non-founder Founding Member has `founding-member` and `premium-member`;
- preserve independently earned badges;
- preserve paid Premium behavior for ordinary subscribers.

The production verification script must fail if:

- any founder is missing `founder`;
- any founder has `founding-member`;
- any founder is missing `premium-member`;
- any eligible non-founder Founding Member is missing `founding-member`;
- any eligible non-founder Founding Member is missing `premium-member`.

Verification output should include counts for founders, eligible non-founder Founding Members, and each missing/incorrect category.

## 7. Theme and UI constraints

All added or changed inputs, buttons, dialogs, cards, and status messages must reuse existing AnonChat theme classes/tokens.

No browser-default-looking controls, one-off colors, or inconsistent button shapes may be introduced.

Badge collection/dialog surfaces remain dark by default and follow existing explicit appearance overrides.

## 8. Android/TWA delivery

Android remains a thin Trusted Web Activity that loads `https://anonchatlogin.web.app/`.

The profile, badge, QR, and private-message changes are shared hosted code and must be verified under TWA/standalone behavior.

Advance the service-worker cache version so installed PWA/TWA clients receive the corrected assets.

Only change native Android files if parity tests identify a real Android-specific gap. Otherwise, keep the wrapper unchanged and produce a fresh APK/AAB from the same verified commit.

## 9. Tests

Use test-driven development with focused RED contracts before production changes.

Required coverage:

- `profile.html` owner path and `profile.html?uid=<owner>` resolve the same target.
- All profile controllers use the shared target resolver.
- Owner Badges button is visible even when badge privacy is off.
- Visitor Badges button is hidden when badge privacy denies reads.
- Inline badge preview above Spotify is absent; collection remains available behind the Badges button.
- QR rendering uses a local dependency and does not require CDN `window.QRCode`.
- QR payload is the canonical profile URL.
- Legacy accepted conversation with a noncanonical document ID is migrated to canonical ID without losing messages.
- Send path never writes a new message under a noncanonical legacy ID.
- New direct messages remain encrypted and Firestore-rule compliant.
- Founder and Founding Member are mutually exclusive.
- Founders receive Founder + Premium Member.
- Eligible non-founder Founding Members receive Founding Member + Premium Member.
- Production badge verifier rejects overlap/missing entitlement.
- Service-worker cache version advances.
- Android current-web parity suite passes.
- Full Phase C, Firestore rules, profile/bugfix, badge/removal, and Android Gradle APK/AAB build pass on the exact final head.

## 10. Deployment and verification

After all exact-head PR checks pass:

1. Merge the verified PR to `main`.
2. Verify Firebase production rollout on the merge SHA.
3. Verify legacy direct-message canonicalization migration runs successfully.
4. Verify existing-user badge backfill runs successfully.
5. Verify founder/founding-member production checks pass with no overlap/missing entitlements.
6. Verify Firebase Hosting completes successfully.
7. Verify the post-merge Android build succeeds and uploads fresh APK/AAB artifacts.

Do not call the release complete merely because CI or merge succeeds; production rollout and Android artifact verification are required.