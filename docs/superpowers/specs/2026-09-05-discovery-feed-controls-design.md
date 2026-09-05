# Discovery and Feed Controls Design

## Goal
Add topic discovery, hashtags, trending/searchable topic surfaces, and user-controlled feed modes without duplicating post storage or breaking existing moderation, privacy, Temporary Rooms, Communities, Groups, notifications, or canonical interaction behavior.

## Approved Product Behavior

- Feed choices: **For You**, **Latest**, **Following**, **Chosen Topics**, **Temporary Only**, and **Saved Filters**.
- `Latest` is strictly chronological.
- `Following` contains posts from followed users only.
- `For You` may rank content but Premium status must never improve rank.
- `Chosen Topics` filters canonical posts by selected topic/hashtag interests.
- `Temporary Only` shows only currently active disappearing posts.
- Saved filters persist user-selected feed criteria and are user-controlled.
- Topic/hashtag discovery supports searchable topics and a trending view.
- Discovery must reuse public Communities/Groups rather than create duplicate community/group data models.
- All feeds render the same canonical posts and interaction parents so comments, reactions, totals, reports, blocks, and moderation remain consistent everywhere.
- Normal discovery, public feeds, and basic topic controls remain free.
- Existing working features must be preserved; no video upload is introduced.

## Architecture

### Feed policy layer
Create a small pure policy module that takes normalized post metadata plus viewer context and returns filter/sort decisions for each feed mode. Keep ranking logic separated from entitlement logic so Premium cannot become a ranking signal.

### Timeline integration
Extend the existing `timeline.js` controller rather than creating a second feed implementation. Existing canonical posts, block filtering, moderation holds, interaction loading, expiry checks, and author hydration remain the source of truth. Feed mode changes only affect which already-authorized posts are selected and how they are ordered.

### Topic model
Use normalized topic/hashtag strings derived from post metadata. Topics are not new post collections. Search/trending reads aggregate topic metadata from canonical posts and existing Communities/Groups. Topic discovery links back into the existing timeline, Community, or Group detail surfaces.

### Saved filters
Persist viewer-owned saved filter definitions in a scoped Firestore collection under the viewer identity. Filters may include feed mode, selected topics, temporary-only state, and sort mode. Security rules permit only the owner to create/read/update/delete their saved filters.

### Trending
Trending uses bounded recent activity signals from canonical posts and public Communities/Groups. It must exclude blocked/hidden content and must not use Premium status as a boost. Initial implementation should favor deterministic, bounded scoring over complex recommendation infrastructure.

## Security and Privacy

- No feed mode may bypass existing Firestore visibility, block, moderation, expiration, or membership rules.
- Saved filters are private to the owning user.
- Public topic discovery must not expose private Groups or invite-only content.
- Temporary posts disappear from all feed modes when expired.
- Premium entitlements may unlock advanced saved-filter quantity later, but the base feed modes stay free and ranking-neutral.

## Testing

- Pure policy tests for each feed mode and ranking neutrality.
- Surface tests for feed controls and accessibility.
- Firestore rule tests for saved filters and topic discovery boundaries.
- Regression tests proving canonical interaction consistency across feed modes.
- Offline/service-worker coverage for new discovery assets.
- Full application regression at major checkpoints.

## Release Constraint
This work stays on `growth-web-release`. Do not merge or deploy until the complete approved web bundle passes the final release checkpoint.