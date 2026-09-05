import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [timelineHtml, profileHtml, mobileCss, topicPolicy, serviceWorker] = await Promise.all([
  readFile(new URL("../timeline.html", import.meta.url), "utf8"),
  readFile(new URL("../profile.html", import.meta.url), "utf8"),
  readFile(new URL("../mobile-hotfix.css", import.meta.url), "utf8"),
  readFile(new URL("../topic-policy.mjs", import.meta.url), "utf8"),
  readFile(new URL("../sw.js", import.meta.url), "utf8"),
]);

assert.match(timelineHtml, /id="show-topic-posts"[^>]*hidden/, "Chosen Topics feed control is not visible");
assert.match(timelineHtml, /id="show-temporary-posts"[^>]*hidden/, "Temporary Only feed control is not visible");
assert.match(timelineHtml, /class="chosen-topics"[^>]*hidden/, "manual topic picker is not visible");
assert.equal(timelineHtml.includes('id="profile-bio-input"'), false, "timeline profile bio editor is removed");
assert.equal(timelineHtml.includes('id="save-profile-bio"'), false, "timeline save-bio control is removed");
assert.equal(profileHtml.includes('id="profile-bio-section"'), false, "public profile bio section is removed");
assert.equal(profileHtml.includes('src="profile-bio.js"'), false, "public profile no longer loads bio renderer");
assert.match(timelineHtml, /href="mobile-hotfix\.css"/, "timeline loads mobile overflow fixes");
assert.match(profileHtml, /href="mobile-hotfix\.css"/, "profile loads mobile overflow fixes");

assert.match(topicPolicy, /extractHashtags/i, "topic policy keeps hashtag extraction as the source for topic metadata");
assert.match(mobileCss, /\.feed-tabs\s*\{[^}]*flex-wrap:\s*wrap/s, "feed tabs wrap instead of overflowing on narrow screens");
assert.match(mobileCss, /html\s*,\s*body\s*\{[^}]*overflow-x:\s*hidden/s, "page clips accidental horizontal overflow on mobile");
assert.match(mobileCss, /\.content-grid\s*>\s*\*\s*\{[^}]*min-width:\s*0/s, "grid children can shrink inside the mobile viewport");
assert.match(serviceWorker, /"\.\/mobile-hotfix\.css"/, "mobile hotfix stylesheet is available offline");

console.log("mobile hashtag-topic surface contract passed");
