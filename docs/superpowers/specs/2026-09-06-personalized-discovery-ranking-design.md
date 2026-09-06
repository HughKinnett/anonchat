# Personalized Discovery and Ranking Design

## Goal

Upgrade AnonChat discovery so Suggested Follows, the For You timeline, and Trending use behavioral signals from follows, reactions/interactions, and comments, while removing the Recent Searches surface above the timeline plus the Popular Today and History tabs.

## Scope

This design covers four coordinated changes:

1. Personalized Suggested Follows.
2. Periodic recommended posts from non-followed users in the For You timeline.
3. Engagement-driven Trending ranking.
4. Timeline discovery UI cleanup.

It does not add machine learning, external recommendation services, a separate per-user interest-profile document, or new paid/native Android-only ranking behavior.

## Recommendation Architecture

AnonChat will use deterministic weighted scoring built from social and content interaction signals already available to the application. Ranking policies remain isolated in focused modules and are consumed by `timeline.js`.

The system will use aggregate interaction signals only. It will not persist a new detailed user-interest profile. Ranking inputs may include who the viewer follows, which authors/posts the viewer reacts to, which posts the viewer comments on, mutual follows, aggregate post engagement, and signal recency.

Blocked users, unavailable users, moderated/hidden content, and the current viewer are excluded from recommendation candidates. Suggested Follows also excludes users already followed by the viewer.

## Suggested Follows

The existing `suggested-follow-policy.mjs` will be expanded from its current mutual/shared-topic/public-interaction model into a stronger behavioral score.

Candidate signals, in descending importance:

1. Mutual follows / social proximity.
2. Viewer comments on the candidate's posts.
3. Viewer reactions or other public interactions with the candidate's posts.
4. Shared interaction patterns, such as both users frequently engaging with the same authors or content clusters when those signals can be derived without new sensitive profiling storage.
5. Recency of the viewer's signals involving the candidate.

Counts will be capped or transformed so one highly active candidate cannot dominate indefinitely. Recent signals should carry more weight than old signals.

The output remains a ranked list of users the viewer does not already follow.

## For You Timeline Discovery

The For You feed will continue to prioritize the viewer's normal feed while deliberately mixing in posts from people the viewer does not follow.

Recommended non-followed posts will be ranked using:

1. Viewer interaction affinity with the author.
2. Similarity to authors/content the viewer follows or interacts with.
3. Viewer comment/reaction history relevant to that author or content pattern.
4. Current post engagement, especially comments and unique interactions.
5. Recency of the post.

The feed will blend approximately one recommended non-followed post for every five to six normal posts when enough eligible recommendations exist.

Diversity controls will prevent the same unfamiliar author from being injected repeatedly in a short span. The viewer's own posts, blocked users, hidden/moderated content, and unavailable authors remain filtered according to existing rules.

The system should degrade gracefully when the viewer has little or no behavioral history. In that case, recommendations may rely more heavily on recency, public engagement, mutual-social proximity, and the existing exploration behavior.

## Trending

Trending will become the single engagement-driven discovery surface, replacing the separate Popular Today concept.

Trending will use a rolling recent window with time decay. Its score will prioritize:

1. Comments — strongest weight.
2. Unique interactions/reactions.
3. Other conversation activity already represented by the current discovery data model, such as replies where available.
4. Recency/time decay so older posts naturally fall even if their total engagement remains high.

A post with active recent conversation should outrank a similarly aged post with only passive reactions. Old posts must not remain Trending indefinitely solely because of historical totals.

## UI Cleanup

Remove the visible Recent Searches surface above the timeline.

Remove the Popular Today timeline tab, its feed mode, title mapping, event handling, and rendering branch.

Remove the History timeline tab, its feed mode, title mapping, event handling, and rendering branch.

The underlying historical/search data does not need to be purged as part of this feature. Existing stored records may remain for compatibility unless a later cleanup explicitly removes them.

Saved posts and other existing feed modes remain unchanged unless implementation reveals a direct dependency that must be adjusted to remove the retired modes safely.

## Data Flow

`timeline.js` will gather the bounded interaction data needed for ranking from the existing Firestore collections already used by timeline/social features. It will construct lightweight maps/sets for ranking context and pass those into pure policy functions.

Pure ranking modules will not perform Firestore reads themselves. They receive normalized candidate/post data plus ranking context and return deterministic scores or ordered lists. This keeps ranking logic testable and prevents database coupling inside policy code.

No new separate `interestProfile` or equivalent per-user profiling document will be introduced.

## Files and Responsibilities

- `suggested-follow-policy.mjs`: candidate scoring and follow recommendation ordering.
- `feed-ranking-policy.mjs`: For You post scoring, recommendation eligibility, and feed blending/diversity behavior.
- `hashtag-discovery-policy.mjs`: Trending score and rolling recency behavior; retire Popular Today scoring.
- `timeline.js`: assemble behavioral ranking context from existing data, call ranking policies, remove retired modes and recent-search UI behavior.
- `timeline.html`: remove Recent Searches, Popular Today, and History controls/surfaces.
- Existing policy/UI regression tests: updated to enforce the new behavior and removed surfaces.

If implementation shows `timeline.js` needs a small focused helper module for behavioral-context aggregation to stay understandable, that helper may be introduced, but no unrelated refactor is in scope.

## Testing

Tests must verify:

1. Suggested Follows ranking increases appropriately for mutual follows, comments, reactions/interactions, and recent affinity.
2. Suggested Follows never recommends self, already-followed users, or blocked users.
3. For You recommendations include eligible non-followed authors and are blended at approximately one recommended post per five to six normal posts when inventory allows.
4. For You diversity prevents repeated insertion of the same unfamiliar author in a short span.
5. Viewers with sparse behavioral history still receive deterministic, safe fallback recommendations.
6. Trending ranks recent high-comment/high-interaction posts above weaker posts and applies time decay.
7. Popular Today scoring and UI mode are removed.
8. History UI mode is removed.
9. The Recent Searches surface above the timeline is removed.
10. Existing blocked/moderated content exclusions continue to hold.

Implementation follows TDD: each behavior is first expressed as a failing regression/policy test, then minimally implemented until green.

## Rollout

After tests and relevant CI pass, commit changes to `main`, bump the service-worker cache version so web and Android TWA clients fetch the new timeline behavior, and deploy through the existing Firebase Hosting workflow.

Do not call the feature live until the final Firebase Hosting deployment for the cache-bumped commit completes successfully.

## Success Criteria

- Suggested Follows visibly adapts to who a user follows, reacts to, and comments on.
- For You periodically surfaces relevant posts from users the viewer does not follow at roughly the approved 1:5–1:6 cadence.
- Trending reflects recent conversation and interaction intensity rather than a separate calendar-day popularity mode.
- Recent Searches no longer appears above the timeline.
- Popular Today and History tabs are gone.
- The same behavior reaches both web and Android TWA through the hosted web deployment.
