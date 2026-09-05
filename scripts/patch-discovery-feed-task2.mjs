import { readFile, writeFile } from "node:fs/promises";

const replaceOnce = (source, before, after, label) => {
  if (!source.includes(before)) throw new Error(`Missing ${label}`);
  return source.replace(before, after);
};

let html = await readFile("timeline.html", "utf8");
html = replaceOnce(html,
`            <button id="show-all-posts" class="feed-tab" type="button" aria-pressed="true">For You</button>
            <button id="show-latest-posts" class="feed-tab" type="button" aria-pressed="false">Latest</button>
            <button id="show-profile-posts" class="feed-tab" type="button" aria-pressed="false">My profile</button>`,
`            <button id="show-all-posts" class="feed-tab" type="button" aria-pressed="true">For You</button>
            <button id="show-latest-posts" class="feed-tab" type="button" aria-pressed="false">Latest</button>
            <button id="show-following-posts" class="feed-tab" type="button" aria-pressed="false">Following</button>
            <button id="show-topic-posts" class="feed-tab" type="button" aria-pressed="false">Chosen Topics</button>
            <button id="show-temporary-posts" class="feed-tab" type="button" aria-pressed="false">Temporary Only</button>
            <button id="show-saved-filter-posts" class="feed-tab" type="button" aria-pressed="false">Saved Filters</button>
            <button id="show-profile-posts" class="feed-tab" type="button" aria-pressed="false">My profile</button>`,
"timeline feed tabs");
await writeFile("timeline.html", html);

let js = await readFile("timeline.js", "utf8");
js = replaceOnce(js,
`import { rankFeedPosts } from "./feed-ranking-policy.mjs";`,
`import { filterFeedPosts, sortFeedPosts } from "./feed-mode-policy.mjs";`,
"feed policy import");
js = replaceOnce(js,
`const allPostsButton = document.getElementById("show-all-posts");
const latestPostsButton = document.getElementById("show-latest-posts");
const profilePostsButton = document.getElementById("show-profile-posts");`,
`const allPostsButton = document.getElementById("show-all-posts");
const latestPostsButton = document.getElementById("show-latest-posts");
const followingPostsButton = document.getElementById("show-following-posts");
const topicPostsButton = document.getElementById("show-topic-posts");
const temporaryPostsButton = document.getElementById("show-temporary-posts");
const savedFilterPostsButton = document.getElementById("show-saved-filter-posts");
const profilePostsButton = document.getElementById("show-profile-posts");`,
"feed button bindings");
js = replaceOnce(js,
`  const orderedPosts = feedMode === "for-you"
    ? rankFeedPosts(unexpiredPosts, {
        viewerUid: currentUser?.uid,
        followedUids: new Set(visibleFollows().filter(follow => follow.data().followerId === currentUser?.uid).map(follow => follow.data().followingId)),
        reactionCounts,
        commentCounts
      })
    : unexpiredPosts;`,
`  const followedUids = new Set(visibleFollows().filter(follow => follow.data().followerId === currentUser?.uid).map(follow => follow.data().followingId));
  const filteredPosts = showingProfile
    ? unexpiredPosts
    : filterFeedPosts(unexpiredPosts, {
        mode: feedMode,
        viewerUid: currentUser?.uid,
        followedUids,
        selectedTopics: new Set(),
        savedFilter: null,
        now: Date.now()
      });
  const orderedPosts = showingProfile
    ? filteredPosts
    : sortFeedPosts(filteredPosts, feedMode, {
        viewerUid: currentUser?.uid,
        followedUids,
        reactionCounts,
        commentCounts,
        now: Date.now()
      });`,
"feed ordering block");
js = replaceOnce(js,
`  allPostsButton.setAttribute("aria-pressed", String(mode === "for-you"));
  latestPostsButton.setAttribute("aria-pressed", String(mode === "latest"));
  profilePostsButton.setAttribute("aria-pressed", String(mode === "profile"));
  document.getElementById("feed-title").textContent = mode === "profile" ? "My profile posts" : mode === "latest" ? "Latest posts" : "For You";`,
`  allPostsButton.setAttribute("aria-pressed", String(mode === "for-you"));
  latestPostsButton.setAttribute("aria-pressed", String(mode === "latest"));
  followingPostsButton.setAttribute("aria-pressed", String(mode === "following"));
  topicPostsButton.setAttribute("aria-pressed", String(mode === "topics"));
  temporaryPostsButton.setAttribute("aria-pressed", String(mode === "temporary"));
  savedFilterPostsButton.setAttribute("aria-pressed", String(mode === "saved"));
  profilePostsButton.setAttribute("aria-pressed", String(mode === "profile"));
  const feedTitles = { "for-you": "For You", latest: "Latest posts", following: "Following", topics: "Chosen Topics", temporary: "Temporary Only", saved: "Saved Filters", profile: "My profile posts" };
  document.getElementById("feed-title").textContent = feedTitles[mode] || "For You";`,
"feed selected state");
js = replaceOnce(js,
`allPostsButton.addEventListener("click", () => setFeedView("for-you"));
latestPostsButton.addEventListener("click", () => setFeedView("latest"));
profilePostsButton.addEventListener("click", () => setFeedView("profile"));`,
`allPostsButton.addEventListener("click", () => setFeedView("for-you"));
latestPostsButton.addEventListener("click", () => setFeedView("latest"));
followingPostsButton.addEventListener("click", () => { feedMode = "following"; setFeedView(feedMode); });
topicPostsButton.addEventListener("click", () => { feedMode = "topics"; setFeedView(feedMode); });
temporaryPostsButton.addEventListener("click", () => { feedMode = "temporary"; setFeedView(feedMode); });
savedFilterPostsButton.addEventListener("click", () => { feedMode = "saved"; setFeedView(feedMode); });
profilePostsButton.addEventListener("click", () => setFeedView("profile"));`,
"feed click handlers");
await writeFile("timeline.js", js);

// Trigger the Task 2 patch workflow after the workflow file exists.
console.log("Discovery/feed Task 2 patch applied");
