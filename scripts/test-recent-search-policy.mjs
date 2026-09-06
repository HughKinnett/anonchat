import assert from "node:assert/strict";
import { mergeRecentSearches, normalizeRecentSearch, removeRecentSearch } from "../recent-search-policy.mjs";

assert.equal(normalizeRecentSearch("  Hello   World  "), "hello world", "searches are trimmed, collapsed, and normalized");
assert.deepEqual(mergeRecentSearches(["cats", "dogs"], "dogs"), ["dogs", "cats"], "repeated search moves to the top");
assert.equal(mergeRecentSearches(Array.from({ length: 20 }, (_, index) => `q${index}`), "new").length, 20, "recent searches stay capped at 20");
assert.deepEqual(removeRecentSearch(["cats", "dogs", "birds"], "dogs"), ["cats", "birds"], "one search can be removed privately");
assert.deepEqual(mergeRecentSearches(["cats"], "   "), ["cats"], "empty searches are ignored");

console.log("recent search policy contract passed");
