import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [timelineHtml, profileHtml, timelineCss, topicPolicy] = await Promise.all([
  readFile(new URL("../timeline.html", import.meta.url), "utf8"),
  readFile(new URL("../profile.html", import.meta.url), "utf8"),
  readFile(new URL("../timeline.css", import.meta.url), "utf8"),
  readFile(new URL("../topic-policy.mjs", import.meta.url), "utf8"),
]);

assert.equal(timelineHtml.includes('id="show-topic-posts"'), false, "manual Chosen Topics feed control is removed");
assert.equal(timelineHtml.includes('id="show-temporary-posts"'), false, "Temporary Only feed control is removed");
assert.equal(timelineHtml.includes('id="chosen-topic-input"'), false, "manual topic entry is removed");
assert.equal(timelineHtml.includes('id="chosen-topic-list"'), false, "manual chosen-topic list is removed");
assert.equal(timelineHtml.includes('id="profile-bio-input"'), false, "timeline profile bio editor is removed");
assert.equal(timelineHtml.includes('id="save-profile-bio"'), false, "timeline save-bio control is removed");
assert.equal(profileHtml.includes('id="profile-bio-section"'), false, "public profile bio section is removed");
assert.equal(profileHtml.includes('src="profile-bio.js"'), false, "public profile no longer loads bio renderer");

assert.match(topicPolicy, /extractHashtags/i, "topic policy keeps hashtag extraction as the source for topic metadata");
assert.match(timelineCss, /\.feed-tabs\s*\{[^}]*flex-wrap:\s*wrap/s, "feed tabs wrap instead of overflowing on narrow screens");
assert.match(timelineCss, /html\s*,\s*body\s*\{[^}]*overflow-x:\s*hidden/s, "page clips accidental horizontal overflow on mobile");
assert.match(timelineCss, /\.content-grid\s*>\s*\*\s*\{[^}]*min-width:\s*0/s, "grid children can shrink inside the mobile viewport");

console.log("mobile hashtag-topic surface contract passed");
