# Cross-Timeline Interactions, Spotify Privacy, and Notification Reliability

## Scope

This design extends the existing `fix/post-deploy-regressions` branch and PR #42. It does not create a competing implementation path.

The fixes cover five connected areas:

1. restore comments on every post surface;
2. make comments and reactions canonical to the original post so every timeline displays the same interaction state;
3. show a total interaction count and an interaction-details view with actor + action;
4. move the Spotify privacy cover to the actual playlist-title row inside the visible embed;
5. repair notification delivery in browser and packaged app, while also fixing the unrelated follower/following privacy assertion currently breaking CI.

## Canonical post interaction model

Every visible copy of a post must resolve to one canonical interaction parent identified by the original Firestore collection and post ID. Timeline variants such as For You, Latest, profile feeds, repost surfaces, and community-derived displays must not create separate comment or reaction state for the same underlying post.

The existing interaction-parent abstraction in `timeline.js` remains the source of truth. All comment writes, reaction writes, listeners, counts, and detail lookups must use the resolved original parent path.

### Required behavior

- A comment created from one timeline appears on that same post everywhere else without a manual refresh.
- A reaction created, changed, or removed from one timeline updates all other visible copies of that post.
- Reposts or alternate feed projections display the original thread unless the product explicitly treats them as independent posts.
- The client must not duplicate listeners for the same parent path unnecessarily.
- Temporary loading failures must not permanently hide the comments surface.

## Comments surface

Every post card must expose a comments section even while interaction data is loading or after a recoverable load failure.

The comments UI must support:

- visible comment count;
- expandable comment list;
- comment author identity as currently allowed by product privacy rules;
- chronological comment ordering within the thread;
- comment submission against the canonical parent;
- retry behavior after Firestore/listener failure;
- live re-render when the canonical thread changes.

A failed interaction load should show a recoverable status rather than remove the comments section.

## Interaction total and detail view

Each post must display a single clickable total representing all user interactions associated with that canonical post.

Initial interaction types included in the total:

- reactions;
- comments.

The detail view must show who interacted and how. Example rows:

- `@username — reacted ❤️`
- `@username — reacted 👍`
- `@username — commented`

If a user performs more than one distinct interaction, each distinct interaction may appear separately. The count shown on the post must match the records represented in the interaction detail view according to the same counting policy.

The interaction detail UI should be lightweight and usable on both desktop and mobile. A modal/dialog or expandable sheet is acceptable, provided it is keyboard accessible and closes predictably.

Privacy and moderation filters that already hide blocked, removed, or unavailable actors/content must also apply to the interaction roster.

## Spotify playlist privacy

Spotify playlist embeds are cross-origin, so AnonChat cannot modify Spotify's internal DOM. Privacy protection must therefore use a positioned overlay on top of the iframe.

The overlay must cover the playlist-name row specifically: the visible area between the currently playing/title area and Spotify's `Save on Spotify` control, rather than masking an arbitrary top portion of the card.

Requirements:

- playlist name must not be readable;
- surrounding song/track information should remain visible when possible;
- `Save on Spotify` should remain visible and usable;
- overlay must adapt to the responsive embed width;
- profile and any other playlist embed surfaces must use the same privacy treatment;
- tests should verify the CSS/DOM contract for the intended overlay location.

## Notification reliability

Existing unit and policy tests for notification generation, service-worker support, VAPID handling, and subscription rules are currently passing, so production failure must be investigated as an end-to-end runtime problem rather than assumed to be a unit-test failure.

The notification repair must verify and, where necessary, correct the entire chain:

1. browser/app permission request;
2. service-worker registration and active controller state;
3. VAPID public-key conversion and push subscription creation;
4. subscription persistence for the authenticated user;
5. cleanup/re-registration after auth changes or stale subscriptions;
6. notification event creation for reactions, comments, message requests, temporary-room messages, and mutual reveal requests;
7. backend/processor delivery to active subscriptions;
8. service-worker `push` handling;
9. notification click navigation;
10. Android packaged-app/PWA behavior and service-worker cache versioning.

Runtime failures must surface a useful user-visible state where appropriate instead of silently failing.

The implementation should preserve the existing security rule that notification records intended to be server-owned cannot be arbitrarily forged by clients.

## CI failure repair

The current failing PR run reaches the end of the suite after notification and Spotify tests pass, then fails on the follower/following privacy surface assertion.

That failure must be repaired without weakening privacy requirements. The implementation and the test must agree on the intended rule: follower/following detail visibility is gated to the appropriate profile owner/private context, while public counters or summary behavior remain consistent with the approved product behavior.

The full CI suite must pass before merge.

## Data flow

For a rendered post:

1. resolve canonical parent path;
2. subscribe once per canonical parent;
3. hydrate comments + reactions into shared in-memory state keyed by parent path;
4. render all visible post copies from that same shared state;
5. derive interaction total and detail rows from the same state;
6. on write, target the canonical parent and let listeners propagate the update to every visible copy.

This avoids timeline-specific interaction divergence.

## Error handling

- Comment/reaction listener failures preserve the post UI and expose retry.
- Duplicate listener creation is prevented by parent-path keyed subscription maps.
- Notification registration failures distinguish permission denial, service-worker failure, subscription failure, and backend persistence/delivery failure where practical.
- Spotify overlay failure should fail closed for privacy: if the playlist-title region cannot be protected reliably, the playlist embed should be hidden rather than expose a personal playlist name.

## Testing

Add or update regression coverage for:

- comments remain visible in loading/error states;
- one canonical post interaction state is reused across For You, Latest, profile, and other post projections;
- a comment or reaction added from one surface appears in another surface representation;
- interaction total equals the displayed detail records under the chosen counting policy;
- interaction detail rows include actor + interaction type;
- blocked/moderated actors are omitted as required;
- Spotify privacy overlay targets the playlist-name band and preserves the Save control area;
- notification runtime registration and auth-session repair paths;
- service-worker cache/version update as required;
- follower/following privacy contract that is currently failing CI;
- full `npm run test:firestore-ci` and repository regression suite.

## Completion criteria

The work is complete only when:

- comments are restored on all relevant post surfaces;
- the same underlying post shows the same comments/reactions across timelines in real time;
- interaction totals are visible and clickable;
- the interaction detail view shows who interacted and how;
- playlist names are visually protected at the correct location;
- browser and packaged-app notification delivery works end to end for the required event types;
- the previously failing CI assertion is repaired without weakening privacy;
- all required tests and CI checks pass;
- PR #42 is ready to merge.
