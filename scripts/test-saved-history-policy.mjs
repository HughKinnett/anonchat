import assert from "node:assert/strict";
import { historyEntryId, mergeHistoryEntries, savedPostEntryId } from "../saved-history-policy.mjs";

const base = Array.from({ length: 100 }, (_, index) => ({ postPath: `posts/${index}`, viewedAt: index }));
const merged = mergeHistoryEntries(base, { postPath: "posts/50", viewedAt: 999 });
assert.equal(merged.length, 100, "history stays capped at 100");
assert.equal(merged[0].postPath, "posts/50", "re-viewed post moves to the top");
assert.equal(merged.filter((entry) => entry.postPath === "posts/50").length, 1, "history does not duplicate posts");

const withNew = mergeHistoryEntries(base, { postPath: "posts/new", viewedAt: 1000 });
assert.equal(withNew.length, 100);
assert.equal(withNew[0].postPath, "posts/new");
assert.equal(withNew.some((entry) => entry.postPath === "posts/0"), false, "oldest item is trimmed");

assert.equal(savedPostEntryId("posts/abc"), savedPostEntryId("posts/abc"), "saved entry IDs are stable");
assert.notEqual(savedPostEntryId("posts/abc"), savedPostEntryId("communityPosts/abc"), "collection path is part of the stable ID");
assert.equal(historyEntryId("posts/abc"), savedPostEntryId("posts/abc"), "Saved and History can use the same stable canonical-path encoding");

console.log("saved/history policy contract passed");
