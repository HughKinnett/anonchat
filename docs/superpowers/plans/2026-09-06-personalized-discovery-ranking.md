# Personalized Discovery and Ranking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Personalize Suggested Follows and the For You timeline using follow/comment/reaction behavior, make Trending reflect recent conversation and interaction intensity, and remove Recent Searches, Popular Today, and History from the timeline UI.

**Architecture:** Keep recommendation logic in pure policy modules and keep Firestore reads/context assembly in `timeline.js`. Extend the existing Suggested Follows and feed-ranking policies, simplify discovery scoring so Trending is the single engagement discovery mode, and use deterministic feed blending to inject about one eligible non-followed post every five to six normal posts. Do not create a persistent per-user interest-profile document.

**Tech Stack:** Vanilla JavaScript ES modules, Firebase Auth/Firestore, Node.js `node:assert/strict` policy/regression tests, GitHub Actions, Firebase Hosting, Android TWA consuming the hosted web app.

**Spec:** `docs/superpowers/specs/2026-09-06-personalized-discovery-ranking-design.md`

## Global Constraints

- Use only aggregate behavior already available to AnonChat: follows, reactions/interactions, comments, mutual-social proximity, post engagement, and signal recency.
- Do not add machine learning, external recommendation services, or a new persistent `interestProfile`-style document.
- Exclude self, blocked users, unavailable users, hidden/moderated content, and already-followed users where the surface requires it.
- For You should blend approximately one eligible non-followed recommendation per five to six normal posts when inventory permits.
- Diversity must prevent the same unfamiliar author from being repeatedly injected in a short span.
- Trending must weight comments strongest, then unique interactions/reactions, replies where available, and apply time decay.
- Remove the visible Recent Searches surface above the timeline, the Popular Today tab/mode, and the History tab/mode.
- Stored recent-search/history records may remain; this feature removes their visible timeline surfaces only.
- Existing Saved posts and unrelated feed modes remain unchanged.
- Follow TDD: each behavior must fail first, then pass after the minimal implementation.
- Bump the service-worker cache only after code/tests are green; deploy through the existing Firebase Hosting workflow; do not claim live until the final hosting run succeeds.

---

### Task 1: Behavioral Suggested Follows scoring

**Files:**
- Modify: `suggested-follow-policy.mjs`
- Modify: `scripts/test-suggested-follow-policy.mjs`

**Interfaces:**
- Consumes candidate objects with `uid`, `mutuals`, `viewerComments`, `viewerReactions`, `sharedInteractions`, and `lastAffinityAtMs` plus context `{ viewerUid, followedUids, blockedUids, now }`.
- Produces `scoreFollowCandidate(candidate, context)` and `suggestFollowCandidates(candidates, context, limit)` with deterministic descending ranking.

- [ ] **Step 1: Write failing scoring tests**

Add assertions covering: more mutuals ranks higher; viewer comments materially increase rank; viewer reactions increase rank; recent affinity outranks equally strong stale affinity; high raw counts are capped; self/followed/blocked remain excluded.

```js
const now = Date.UTC(2026, 8, 6, 20, 0, 0);
const context = {
  viewerUid: "viewer",
  followedUids: new Set(["followed"]),
  blockedUids: new Set(["blocked"]),
  now
};

assert.ok(
  scoreFollowCandidate({ uid: "commented", viewerComments: 3, lastAffinityAtMs: now }, context)
  > scoreFollowCandidate({ uid: "reacted", viewerReactions: 3, lastAffinityAtMs: now }, context),
  "comments should carry more follow-affinity weight than reactions"
);

assert.ok(
  scoreFollowCandidate({ uid: "recent", viewerComments: 1, lastAffinityAtMs: now - 60_000 }, context)
  > scoreFollowCandidate({ uid: "old", viewerComments: 1, lastAffinityAtMs: now - 90 * 24 * 60 * 60 * 1000 }, context),
  "recent affinity should beat stale affinity"
);

const ranked = suggestFollowCandidates([
  { uid: "viewer", mutuals: 99 },
  { uid: "followed", mutuals: 99 },
  { uid: "blocked", mutuals: 99 },
  { uid: "eligible", mutuals: 1, viewerComments: 1, lastAffinityAtMs: now }
], context, 10);
assert.deepEqual(ranked.map((entry) => entry.uid), ["eligible"]);
```

- [ ] **Step 2: Run the policy test and verify RED**

Run: `node scripts/test-suggested-follow-policy.mjs`

Expected: FAIL because the current policy does not accept/use the new behavioral fields and recency context.

- [ ] **Step 3: Implement bounded weighted scoring**

Use capped counts and deterministic recency decay. Suggested starting weights:

```js
const DAY_MS = 86_400_000;
const cap = (value, max = 12) => Math.min(max, Math.max(0, Number(value) || 0));
const recencyMultiplier = (lastAffinityAtMs, now) => {
  const ageDays = Math.max(0, Number(now) - Number(lastAffinityAtMs || 0)) / DAY_MS;
  return lastAffinityAtMs ? Math.max(0.25, Math.pow(0.5, ageDays / 30)) : 0.5;
};

export const scoreFollowCandidate = (candidate = {}, context = {}) => {
  const now = Number(context.now) || Date.now();
  const social = cap(candidate.mutuals) * 5;
  const comments = cap(candidate.viewerComments) * 4;
  const reactions = cap(candidate.viewerReactions) * 2;
  const shared = cap(candidate.sharedInteractions) * 1.5;
  const behavioral = comments + reactions + shared;
  return social + behavioral * recencyMultiplier(candidate.lastAffinityAtMs, now);
};
```

Keep the existing exclusion/filter/sort behavior in `suggestFollowCandidates`.

- [ ] **Step 4: Run the policy test and verify GREEN**

Run: `node scripts/test-suggested-follow-policy.mjs`

Expected: PASS with all old exclusions and new behavioral ranking assertions green.

- [ ] **Step 5: Commit Task 1**

```bash
git add suggested-follow-policy.mjs scripts/test-suggested-follow-policy.mjs
git commit -m "feat: personalize suggested follows"
```

---

### Task 2: Assemble Suggested Follows behavioral context from existing timeline data

**Files:**
- Modify: `timeline.js`
- Modify: `scripts/test-phase-b-ui.mjs`
- Create: `scripts/test-timeline-recommendation-context.mjs`

**Interfaces:**
- Consumes existing timeline-loaded users, follows, post reactions/interactions, and comments.
- Produces normalized candidate fields expected by Task 1: `mutuals`, `viewerComments`, `viewerReactions`, `sharedInteractions`, `lastAffinityAtMs`.

- [ ] **Step 1: Write failing integration-structure tests**

Create `scripts/test-timeline-recommendation-context.mjs` to assert `timeline.js` constructs behavioral maps for comments/reactions and passes those values into `suggestFollowCandidates` rather than only mutual/shared-topic counts.

```js
import assert from "node:assert/strict";
import fs from "node:fs";

const timeline = fs.readFileSync(new URL("../timeline.js", import.meta.url), "utf8");

assert.match(timeline, /viewerComments|commentAffinity/, "timeline builds comment affinity for suggested follows");
assert.match(timeline, /viewerReactions|reactionAffinity/, "timeline builds reaction affinity for suggested follows");
assert.match(timeline, /lastAffinityAtMs/, "timeline forwards recency for suggested follows");
assert.match(timeline, /suggestFollowCandidates\s*\(/, "timeline invokes suggested follow policy");
```

- [ ] **Step 2: Run the new test and verify RED**

Run: `node scripts/test-timeline-recommendation-context.mjs`

Expected: FAIL because the current timeline candidate assembly does not provide the new behavioral fields.

- [ ] **Step 3: Implement context aggregation in `timeline.js`**

Reuse collections/listeners already loaded by the timeline. Build per-author aggregates from the viewer's own comments and reactions/interactions. Track the newest relevant timestamp as `lastAffinityAtMs`. Compute mutual follows from existing follow edges. Do not add a new Firestore document or persistent profile.

The candidate object passed to the policy must have this shape:

```js
{
  uid,
  mutuals,
  viewerComments,
  viewerReactions,
  sharedInteractions,
  lastAffinityAtMs
}
```

If exact timestamps are absent for a signal, omit that signal from recency rather than inventing a timestamp.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
node scripts/test-timeline-recommendation-context.mjs
node scripts/test-suggested-follow-policy.mjs
node scripts/test-phase-b-ui.mjs
```

Expected: all PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add timeline.js scripts/test-timeline-recommendation-context.mjs scripts/test-phase-b-ui.mjs
git commit -m "feat: feed behavior into follow suggestions"
```

---

### Task 3: Personalized non-followed post scoring and deterministic blend

**Files:**
- Modify: `feed-ranking-policy.mjs`
- Modify: `scripts/test-feed-ranking-policy.mjs` if present; otherwise create it

**Interfaces:**
- Consumes posts plus context `{ viewerUid, followedUids, blockedUids, reactionCounts, commentCounts, authorAffinity, similarAuthorAffinity, now }`.
- Produces `scoreFeedPost(record, context)`, `rankFeedPosts(posts, context)`, and a new `blendRecommendedPosts(normalPosts, recommendedPosts, options)`.

- [ ] **Step 1: Write failing recommendation and blend tests**

Cover: author affinity increases a non-followed post's score; comments/reactions help; stale posts decay; blocked/self candidates are not eligible for injection; deterministic fallback works with no affinity; one recommendation appears after every 5–6 normal items; repeated unfamiliar author is avoided when alternatives exist.

```js
const normal = Array.from({ length: 12 }, (_, i) => ({ id: `n${i}`, authorId: `f${i}` }));
const recommended = [
  { id: "r1", authorId: "u1" },
  { id: "r2", authorId: "u1" },
  { id: "r3", authorId: "u2" }
];
const blended = blendRecommendedPosts(normal, recommended, { interval: 5 });
assert.equal(blended[5].id, "r1");
assert.equal(blended[11].id, "r3", "diversity should prefer another unfamiliar author");
```

- [ ] **Step 2: Run feed-ranking test and verify RED**

Run: `node scripts/test-feed-ranking-policy.mjs`

Expected: FAIL because `blendRecommendedPosts` and behavioral author-affinity inputs do not yet exist.

- [ ] **Step 3: Extend `scoreFeedPost` for behavioral discovery**

Preserve existing recency/followed/engagement behavior. Add bounded non-followed bonuses from `authorAffinity` and `similarAuthorAffinity`. Do not remove the deterministic exploration fallback; use it when affinity is sparse.

Example shape:

```js
const authorAffinity = Math.min(6, Number(context.authorAffinity?.get(authorId)) || 0);
const similarAffinity = Math.min(3, Number(context.similarAuthorAffinity?.get(authorId)) || 0);
const discoveryAffinity = !context.followedUids?.has(authorId) && authorId !== context.viewerUid
  ? authorAffinity * 0.9 + similarAffinity * 0.6
  : 0;
```

- [ ] **Step 4: Add deterministic blend/diversity helper**

Implement `blendRecommendedPosts(normalPosts, recommendedPosts, { interval = 5 } = {})` so recommendations are inserted after roughly every five normal posts while inventory exists. Before selecting the next recommendation, avoid an author used by the previous injected recommendation when an alternative candidate exists. Preserve stable order within both input lists.

- [ ] **Step 5: Run feed-ranking test and verify GREEN**

Run: `node scripts/test-feed-ranking-policy.mjs`

Expected: PASS.

- [ ] **Step 6: Commit Task 3**

```bash
git add feed-ranking-policy.mjs scripts/test-feed-ranking-policy.mjs
git commit -m "feat: blend personalized discovery posts"
```

---

### Task 4: Wire behavioral For You recommendations into `timeline.js`

**Files:**
- Modify: `timeline.js`
- Modify: `scripts/test-timeline-recommendation-context.mjs`
- Modify: `scripts/test-phase-b-ui.mjs`

**Interfaces:**
- Consumes Task 3's `rankFeedPosts` and `blendRecommendedPosts`.
- Produces the final For You rendered list with followed/normal content dominant and eligible non-followed content periodically injected.

- [ ] **Step 1: Write failing timeline wiring tests**

Assert `timeline.js` imports/calls `blendRecommendedPosts`, creates `authorAffinity`, separates normal and eligible non-followed candidate lists, and only applies this blend in the For You mode.

```js
assert.match(timeline, /blendRecommendedPosts/);
assert.match(timeline, /authorAffinity/);
assert.match(timeline, /mode\s*===\s*["']for-you["']/);
```

Also assert Following mode is not passed through the recommendation blend.

- [ ] **Step 2: Run focused test and verify RED**

Run: `node scripts/test-timeline-recommendation-context.mjs`

Expected: FAIL because the timeline does not yet perform the explicit cadence blend.

- [ ] **Step 3: Implement For You separation and blending**

Build behavioral author affinity from the viewer's own comments/reactions and follow graph. Rank normal and non-followed eligible posts using the policy context. Blend only into For You. Keep blocked/moderated/unavailable filtering before ranking so disallowed records never reach the blend helper.

Use interval `5` as the default target, producing approximately 1 discovery post per 5–6 normal posts depending on inventory and end-of-feed boundaries.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
node scripts/test-feed-ranking-policy.mjs
node scripts/test-timeline-recommendation-context.mjs
node scripts/test-phase-b-ui.mjs
```

Expected: all PASS.

- [ ] **Step 5: Commit Task 4**

```bash
git add timeline.js scripts/test-timeline-recommendation-context.mjs scripts/test-phase-b-ui.mjs
git commit -m "feat: personalize For You discovery"
```

---

### Task 5: Make Trending the single engagement discovery score

**Files:**
- Modify: `hashtag-discovery-policy.mjs`
- Modify: `scripts/test-hashtag-discovery-policy.mjs`

**Interfaces:**
- Consumes normalized post discovery data `{ createdAtMs, uniqueInteractions, commentCount, replyCount }`.
- Produces `trendingScore(post, now)` only; `popularTodayScore` is retired.

- [ ] **Step 1: Write failing Trending tests**

Assert comments have the strongest contribution, reactions still help, replies help, equally engaged newer posts beat older posts, and posts outside the rolling window return `-Infinity`. Remove test expectations for `popularTodayScore`.

```js
const now = Date.UTC(2026, 8, 6, 20, 0, 0);
assert.ok(
  trendingScore({ createdAtMs: now - 60_000, commentCount: 4, uniqueInteractions: 1 }, now)
  > trendingScore({ createdAtMs: now - 60_000, commentCount: 1, uniqueInteractions: 4 }, now),
  "conversation should outweigh passive reaction volume"
);
assert.equal(
  trendingScore({ createdAtMs: now - 48 * 60 * 60 * 1000, commentCount: 100 }, now),
  -Infinity
);
```

- [ ] **Step 2: Run discovery policy test and verify RED**

Run: `node scripts/test-hashtag-discovery-policy.mjs`

Expected: FAIL after tests remove/replace Popular Today assumptions and tighten conversation weighting.

- [ ] **Step 3: Simplify Trending scoring and remove Popular Today export**

Keep a rolling 24-hour window unless existing data/query constraints require a shorter window. Use capped counts and age decay. Suggested weights:

```js
const engagementScore = (post = {}) =>
  Math.min(50, Math.max(0, Number(post.commentCount) || 0)) * 5
  + Math.min(50, Math.max(0, Number(post.uniqueInteractions) || 0)) * 3
  + Math.min(50, Math.max(0, Number(post.replyCount) || 0)) * 2;

export const trendingScore = (post = {}, now = Date.now()) => {
  const createdAtMs = Number(post.createdAtMs) || 0;
  const ageMs = Number(now) - createdAtMs;
  if (!createdAtMs || ageMs < 0 || ageMs > DAY_MS) return -Infinity;
  const ageHours = ageMs / HOUR_MS;
  const freshnessMultiplier = Math.max(0.2, Math.pow(0.5, ageHours / 12));
  return engagementScore(post) * freshnessMultiplier;
};
```

Delete `applicationDayBounds` and `popularTodayScore` only if no surviving code/tests use them after Task 6; otherwise retire them in Task 6 atomically with consumers.

- [ ] **Step 4: Run the discovery policy test and verify GREEN**

Run: `node scripts/test-hashtag-discovery-policy.mjs`

Expected: PASS.

- [ ] **Step 5: Commit Task 5**

```bash
git add hashtag-discovery-policy.mjs scripts/test-hashtag-discovery-policy.mjs
git commit -m "feat: rank Trending by recent conversation"
```

---

### Task 6: Remove Recent Searches, Popular Today, and History from timeline UI and routing

**Files:**
- Modify: `timeline.html`
- Modify: `timeline.js`
- Modify: `scripts/test-phase-b-ui.mjs`
- Modify: `scripts/test-recent-search-policy.mjs` only if its assertions depend on the removed timeline surface

**Interfaces:**
- Consumes surviving feed modes including For You, Following, Trending, Saved, Topics, and other existing modes not explicitly retired.
- Produces no visible Recent Searches area, no Popular Today mode, and no History mode.

- [ ] **Step 1: Write failing UI-removal regression assertions**

Replace old positive UI assertions with negative ones:

```js
assert.doesNotMatch(html, /id="show-popular-today-posts"/, "Popular Today tab is removed");
assert.doesNotMatch(html, /id="show-history-posts"/, "History tab is removed");
assert.doesNotMatch(html, /id="recent-searches"|Recent Searches/i, "Recent Searches surface above timeline is removed");
assert.doesNotMatch(timeline, /popular-today|popularTodayScore/, "Popular Today mode is removed from timeline logic");
assert.doesNotMatch(timeline, /mode\s*===\s*["']history["']|feedTitles[^\n]*history/, "History mode is removed from timeline logic");
```

Retain a positive assertion that Trending remains visible.

- [ ] **Step 2: Run the UI test and verify RED**

Run: `node scripts/test-phase-b-ui.mjs`

Expected: FAIL because all three retired surfaces/modes currently exist.

- [ ] **Step 3: Remove the three UI surfaces and dead event/mode branches**

In `timeline.html`, remove Recent Searches markup, Popular Today button, and History button.

In `timeline.js`, remove:
- `popularTodayScore`/`applicationDayBounds` imports when no longer needed.
- Popular Today button references, event listener, `aria-pressed` handling, title map entry, mode branch, and render selection.
- History button references, event listener, `aria-pressed` handling, title map entry, mode branch, and viewed-history rendering path from the timeline UI.
- Recent Searches DOM rendering/loading/event code that exists solely for the removed above-timeline surface.

Do not delete stored recent-search/history Firestore records and do not remove unrelated saved-post behavior.

- [ ] **Step 4: Run UI/discovery tests and verify GREEN**

Run:

```bash
node scripts/test-phase-b-ui.mjs
node scripts/test-hashtag-discovery-policy.mjs
node scripts/test-recent-search-policy.mjs
```

Expected: all PASS; the policy test may remain even though the surface is hidden because stored compatibility logic is allowed to remain.

- [ ] **Step 5: Commit Task 6**

```bash
git add timeline.html timeline.js hashtag-discovery-policy.mjs scripts/test-phase-b-ui.mjs scripts/test-hashtag-discovery-policy.mjs scripts/test-recent-search-policy.mjs
git commit -m "feat: simplify timeline discovery tabs"
```

---

### Task 7: Full regression verification and service-worker rollout

**Files:**
- Modify: `sw.js`
- Modify: CI/package test references only if retired tests/imports require cleanup

**Interfaces:**
- Consumes completed Tasks 1–6.
- Produces a cache-bumped, deployable web bundle used by both Firebase Hosting and the Android TWA.

- [ ] **Step 1: Run the complete focused recommendation/discovery suite**

Run:

```bash
node scripts/test-suggested-follow-policy.mjs
node scripts/test-feed-ranking-policy.mjs
node scripts/test-timeline-recommendation-context.mjs
node scripts/test-hashtag-discovery-policy.mjs
node scripts/test-phase-b-ui.mjs
node scripts/test-recent-search-policy.mjs
```

Expected: 0 failures.

- [ ] **Step 2: Run the repository's broader relevant CI command**

Inspect `package.json` for the current aggregate Phase B/discovery test script and run that exact script. If `npm test` is the repository's canonical full suite and is practical in CI, run it as well.

Expected: 0 failures in all recommendation, timeline, moderation/filtering, and UI regressions.

- [ ] **Step 3: Bump the service-worker cache safely**

Fetch the complete current `sw.js`, change only the `CACHE_NAME` version from the current value to the next integer, and verify the full service worker still contains install, activate, fetch, push, and notification-click handlers. Never replace `sw.js` with a partial snippet.

Verification commands:

```bash
grep -q 'self.addEventListener("install"' sw.js
grep -q 'self.addEventListener("activate"' sw.js
grep -q 'self.addEventListener("fetch"' sw.js
grep -q 'self.addEventListener("push"' sw.js
grep -q 'self.addEventListener("notificationclick"' sw.js
```

- [ ] **Step 4: Commit the cache bump**

```bash
git add sw.js
git commit -m "chore: refresh personalized discovery cache"
```

- [ ] **Step 5: Verify GitHub Actions**

Confirm the relevant discovery/Phase B CI jobs finish with `conclusion: success` for the final commit. If any fail, read the failed step/logs and fix the root cause before deployment claims.

- [ ] **Step 6: Verify Firebase Hosting deployment**

Confirm the `Deploy Firebase` workflow run for the final cache-bumped commit completes successfully and that its Hosting step is green.

- [ ] **Step 7: Final acceptance checklist**

Verify against the spec:
- Suggested Follows responds to follows/comments/reactions and recency.
- Self/followed/blocked exclusions hold.
- For You injects eligible non-followed posts near the 1:5–1:6 cadence.
- Discovery-author diversity holds.
- Sparse-history fallback remains deterministic.
- Trending favors recent high-comment/high-interaction posts.
- Popular Today is absent.
- History is absent.
- Recent Searches above the timeline is absent.
- Blocked/moderated/unavailable content exclusions still hold.
- Firebase Hosting rollout is successful, which also updates the Android TWA-hosted experience.
