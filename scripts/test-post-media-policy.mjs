import assert from "node:assert/strict";
import { normalizePostMedia, validatePostMedia } from "../post-media-policy.mjs";

const fourImages = ["a","b","c","d"].map((url) => ({ type: "image", url }));
assert.deepEqual(validatePostMedia(fourImages), { ok: true, reason: "" });
assert.equal(validatePostMedia([...fourImages, { type: "image", url: "e" }]).ok, false, "fifth image is rejected");
assert.deepEqual(validatePostMedia([{ type: "gif", url: "g" }]), { ok: true, reason: "" });
assert.equal(validatePostMedia([{ type: "gif", url: "g" }, { type: "image", url: "a" }]).ok, false, "GIF cannot be mixed with images");
assert.equal(validatePostMedia([{ type: "gif", url: "g1" }, { type: "gif", url: "g2" }]).ok, false, "only one GIF is allowed");
assert.equal(validatePostMedia([{ type: "image", url: "" }]).ok, false, "empty media URL is rejected");

assert.deepEqual(
  normalizePostMedia([{ type: "IMAGE", url: " a " }, { type: "gif", url: " g " }]),
  [{ type: "image", url: "a" }, { type: "gif", url: "g" }],
  "normalizer trims URLs and lowercases media types"
);

console.log("post media policy contract passed");
