import fs from "node:fs";

const replaceOnce = (source, needle, replacement, label) => {
  if (!source.includes(needle)) throw new Error(`Could not locate ${label}`);
  return source.replace(needle, replacement);
};

let html = fs.readFileSync("timeline.html", "utf8");
let js = fs.readFileSync("timeline.js", "utf8");

html = replaceOnce(
  html,
  '<input id="post-image-upload" type="file" accept="image/*" hidden>',
  '<input id="post-image-upload" type="file" accept="image/*" multiple hidden>\n            <label class="gif-url-control" for="post-gif-url">GIF URL\n              <input id="post-gif-url" type="url" inputmode="url" placeholder="https://…/image.gif" autocomplete="off">\n            </label>',
  "Phase B media composer"
);
html = replaceOnce(
  html,
  '<button id="show-profile-posts" class="feed-tab" type="button" aria-pressed="false">My profile</button>',
  '<button id="show-trending-posts" class="feed-tab" type="button" aria-pressed="false">Trending</button>\n            <button id="show-popular-today-posts" class="feed-tab" type="button" aria-pressed="false">Popular Today</button>\n            <button id="show-saved-posts" class="feed-tab" type="button" aria-pressed="false">Saved</button>\n            <button id="show-history-posts" class="feed-tab" type="button" aria-pressed="false">History</button>\n            <button id="show-profile-posts" class="feed-tab" type="button" aria-pressed="false">My profile</button>',
  "Phase B feed tabs"
);
html = replaceOnce(
  html,
  '        <ul class="feed" id="feed"></ul>',
  '        <section id="suggested-follows" class="phase-b-panel" aria-labelledby="suggested-follows-title"><h3 id="suggested-follows-title">Suggested follows</h3><div id="suggested-follows-list"></div></section>\n        <section id="recent-searches" class="phase-b-panel" aria-labelledby="recent-searches-title"><div class="phase-b-panel-heading"><h3 id="recent-searches-title">Recent searches</h3><button id="clear-recent-searches" class="secondary-button" type="button">Clear all</button></div><div id="recent-search-list"></div></section>\n        <ul class="feed" id="feed"></ul>',
  "Phase B discovery panels"
);

js = replaceOnce(
  js,
  'import { buildOriginalPost, buildRepost } from "./content-writer-policy.mjs";',
  'import { buildOriginalPost, buildRepost } from "./content-writer-policy.mjs";\nimport { buildEditHistorySnapshot, canEditOwnedContent, nextEditMetadata } from "./content-edit-policy.mjs";\nimport { groupCommentThreads, threadRootId } from "./threaded-reply-policy.mjs";\nimport { normalizePostMedia, validatePostMedia } from "./post-media-policy.mjs";\nimport { historyEntryId, savedPostEntryId } from "./saved-history-policy.mjs";\nimport { applicationDayBounds, popularTodayScore, trendingScore } from "./hashtag-discovery-policy.mjs";\nimport { suggestFollowCandidates } from "./suggested-follow-policy.mjs";\nimport { mergeRecentSearches, normalizeRecentSearch, removeRecentSearch } from "./recent-search-policy.mjs";',
  "Phase B imports"
);
js = replaceOnce(
  js,
  'const profilePostsButton = document.getElementById("show-profile-posts");',
  'const profilePostsButton = document.getElementById("show-profile-posts");\nconst trendingPostsButton = document.getElementById("show-trending-posts");\nconst popularTodayPostsButton = document.getElementById("show-popular-today-posts");\nconst savedPostsButton = document.getElementById("show-saved-posts");\nconst historyPostsButton = document.getElementById("show-history-posts");\nconst postGifUrl = document.getElementById("post-gif-url");\nconst suggestedFollowsList = document.getElementById("suggested-follows-list");\nconst recentSearchList = document.getElementById("recent-search-list");\nconst clearRecentSearchesButton = document.getElementById("clear-recent-searches");\nlet pendingPostMedia = [];\nlet activeReplyTarget = null;\nlet recentSearches = [];\nlet savedPostPaths = new Set();\nlet viewedPostPaths = [];',
  "Phase B DOM state"
);

js = replaceOnce(
  js,
  'postImageInput.addEventListener("change", async (event) => {\n  const file = event.target.files?.[0];\n  if (!file) return;\n  setStatus("Preparing your post photo…");\n  try {\n    pendingPostImage = await compressPostImage(file);\n    postImagePreview.src = pendingPostImage;\n    postImagePreviewWrap.hidden = false;\n    setPhotoSelected(true);\n    setStatus("Photo ready.");\n  } catch (error) {\n    pendingPostImage = "";\n    setPhotoSelected(false);\n    setStatus(error.message || "Could not prepare that photo.", true);\n  }\n});',
  'postImageInput.addEventListener("change", async (event) => {\n  const files = [...(event.target.files || [])].slice(0, 4);\n  if (!files.length) return;\n  setStatus("Preparing your post photos…");\n  try {\n    if (files.some((file) => file.type === "image/gif")) throw new Error("Use the GIF URL field for GIFs so animation is preserved.");\n    const urls = await Promise.all(files.map(compressPostImage));\n    pendingPostMedia = urls.map((url) => ({ type: "image", url }));\n    const validation = validatePostMedia(pendingPostMedia);\n    if (!validation.ok) throw new Error("Choose up to four photos, or one GIF.");\n    pendingPostImage = pendingPostMedia[0]?.url || "";\n    postImagePreview.src = pendingPostImage;\n    postImagePreviewWrap.hidden = false;\n    setPhotoSelected(true);\n    setStatus(`${pendingPostMedia.length} photo${pendingPostMedia.length === 1 ? "" : "s"} ready.`);\n  } catch (error) {\n    pendingPostImage = "";\n    pendingPostMedia = [];\n    setPhotoSelected(false);\n    setStatus(error.message || "Could not prepare those photos.", true);\n  }\n});',
  "multi-photo input"
);
js = replaceOnce(
  js,
  '  pendingPostImage = "";\n  postImageInput.value = "";',
  '  pendingPostImage = "";\n  pendingPostMedia = [];\n  if (postGifUrl) postGifUrl.value = "";\n  postImageInput.value = "";',
  "media clear state"
);

js = replaceOnce(
  js,
  '  const text = document.createElement("p");\n  appendLinkedText(text, post.content);\n  const postImage = post.imageData ? document.createElement("img") : null;\n  if (postImage) {\n    postImage.className = "post-image";\n    postImage.loading = "lazy";\n    postImage.decoding = "async";\n    postImage.src = post.imageData;\n    postImage.alt = "Photo attached to this post";\n    postImage.tabIndex = 0;\n    postImage.title = "Tap to reveal this photograph in Data Saver mode";\n    postImage.addEventListener("click", () => postImage.classList.add("data-saver-revealed"));\n    postImage.addEventListener("keydown", (event) => {\n      if (event.key === "Enter" || event.key === " ") postImage.classList.add("data-saver-revealed");\n    });\n  }',
  '  const text = document.createElement("p");\n  appendLinkedText(text, post.content);\n  if (post.editedAt || Number(post.editVersion) > 0) { const edited = document.createElement("small"); edited.className = "edited-label"; edited.textContent = "Edited"; text.append(document.createTextNode(" "), edited); }\n  const mediaItems = normalizePostMedia(Array.isArray(post.media) && post.media.length ? post.media : (post.imageData ? [{ type: "image", url: post.imageData }] : []));\n  const mediaGrid = document.createElement("div");\n  mediaGrid.className = `post-media-grid media-count-${mediaItems.length}`;\n  mediaItems.forEach((media) => {\n    const image = document.createElement("img");\n    image.className = media.type === "gif" ? "post-image post-gif" : "post-image";\n    image.loading = "lazy"; image.decoding = "async"; image.src = media.url; image.alt = media.type === "gif" ? "GIF attached to this post" : "Photo attached to this post";\n    image.tabIndex = 0; image.title = "Tap to reveal this media in Data Saver mode";\n    image.addEventListener("click", () => image.classList.add("data-saver-revealed"));\n    image.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") image.classList.add("data-saver-revealed"); });\n    mediaGrid.append(image);\n  });',
  "canonical media renderer"
);

js = replaceOnce(
  js,
  '  commentDocs.forEach((commentDoc) => {\n    const comment = commentDoc.data();',
  '  const threadedCommentDocs = groupCommentThreads(commentDocs.map((commentDoc) => ({ id: commentDoc.id, ...commentDoc.data(), __doc: commentDoc })))\n    .flatMap(({ root, replies }) => [root, ...replies]);\n  threadedCommentDocs.forEach((threadedComment) => {\n    const commentDoc = threadedComment.__doc;\n    const comment = commentDoc.data();',
  "one-level threaded renderer"
);
js = replaceOnce(
  js,
  '    commentItem.className = "comment-item";',
  '    commentItem.className = comment.parentCommentId ? "comment-item comment-reply" : "comment-item";',
  "reply class"
);
js = replaceOnce(
  js,
  '    commentTime.textContent = comment.createdAt?.toDate\n      ? comment.createdAt.toDate().toLocaleString()\n      : "Posting…";',
  '    commentTime.textContent = (comment.createdAt?.toDate ? comment.createdAt.toDate().toLocaleString() : "Posting…") + (comment.editedAt || Number(comment.editVersion) > 0 ? " · Edited" : "");',
  "comment Edited label"
);
js = replaceOnce(
  js,
  '    reply.addEventListener("click", () => {\n      commentInput.value = `@${comment.username || "anonymous"} `;',
  '    reply.addEventListener("click", () => {\n      activeReplyTarget = { id: commentDoc.id, threadRootId: threadRootId({ id: commentDoc.id, ...comment }) };\n      commentInput.value = `@${comment.username || "anonymous"} `;',
  "reply target"
);
js = replaceOnce(
  js,
  '    commentActions.append(reply);\n    if (comment.uid === currentUser.uid || displayedAuthorId === currentUser.uid) {',
  '    commentActions.append(reply);\n    if (comment.uid === currentUser.uid) {\n      const editComment = document.createElement("button");\n      editComment.type = "button"; editComment.textContent = "Edit comment";\n      editComment.addEventListener("click", async () => {\n        const nextText = window.prompt("Edit comment", comment.text)?.trim();\n        if (!nextText || nextText === comment.text) return;\n        try {\n          await runTransaction(db, async (transaction) => {\n            const snapshot = await transaction.get(commentDoc.ref);\n            if (!snapshot.exists() || !canEditOwnedContent(snapshot.data(), currentUser.uid)) throw new Error("not-authorized");\n            const meta = nextEditMetadata(snapshot.data(), Date.now());\n            transaction.set(doc(commentDoc.ref, "editHistory", `v${meta.editVersion}`), { ...buildEditHistorySnapshot(snapshot.data(), currentUser.uid, Date.now()), archivedAt: serverTimestamp() });\n            transaction.update(commentDoc.ref, { text: nextText, editedAt: serverTimestamp(), editVersion: meta.editVersion });\n          });\n        } catch { setStatus("Could not edit that comment.", true); }\n      });\n      commentActions.append(editComment);\n    }\n    if (comment.uid === currentUser.uid || displayedAuthorId === currentUser.uid) {',
  "comment edit action"
);
js = replaceOnce(
  js,
  '        text,\n        createdAt: serverTimestamp()\n      });',
  '        text,\n        ...(activeReplyTarget ? { parentCommentId: activeReplyTarget.id, threadRootId: activeReplyTarget.threadRootId } : {}),\n        createdAt: serverTimestamp()\n      });',
  "reply write metadata"
);
js = replaceOnce(
  js,
  '      commentInput.value = "";\n      commentsSection.open = true;',
  '      commentInput.value = "";\n      activeReplyTarget = null;\n      commentsSection.open = true;',
  "reply state reset"
);

js = replaceOnce(
  js,
  '  actions.append(bookmark);\n  const repostId = `repost_${currentUser.uid}_${sourceId}`;',
  '  actions.append(bookmark);\n  if (post.content) {\n    const copyText = document.createElement("button"); copyText.type = "button"; copyText.textContent = "Copy text";\n    copyText.addEventListener("click", async () => { try { await navigator.clipboard.writeText(post.content); setStatus("Post text copied."); } catch { setStatus("Could not copy post text.", true); } });\n    actions.append(copyText);\n  }\n  if (post.authorId === currentUser.uid && post.type !== "repost") {\n    const editPost = document.createElement("button"); editPost.type = "button"; editPost.textContent = "Edit post";\n    editPost.addEventListener("click", async () => {\n      const nextContent = window.prompt("Edit post", post.content)?.trim();\n      if (!nextContent || nextContent === post.content) return;\n      try {\n        await runTransaction(db, async (transaction) => {\n          const snapshot = await transaction.get(postDoc.ref);\n          if (!snapshot.exists() || !canEditOwnedContent(snapshot.data(), currentUser.uid)) throw new Error("not-authorized");\n          const meta = nextEditMetadata(snapshot.data(), Date.now());\n          transaction.set(doc(postDoc.ref, "editHistory", `v${meta.editVersion}`), { ...buildEditHistorySnapshot(snapshot.data(), currentUser.uid, Date.now()), archivedAt: serverTimestamp() });\n          transaction.update(postDoc.ref, { content: nextContent, topics: normalizeTopic(nextContent) ? snapshot.data().topics : snapshot.data().topics, editedAt: serverTimestamp(), editVersion: meta.editVersion });\n        });\n      } catch { setStatus("Could not edit that post.", true); }\n    });\n    actions.append(editPost);\n  }\n  const repostId = `repost_${currentUser.uid}_${sourceId}`;',
  "copy and post edit actions"
);
js = replaceOnce(
  js,
  '  item.append(authorRow, text);\n  if (postImage) item.append(postImage);',
  '  item.append(authorRow, text);\n  if (mediaGrid.childElementCount) item.append(mediaGrid);',
  "media grid append"
);

js = replaceOnce(
  js,
  '  profilePostsButton.setAttribute("aria-pressed", String(mode === "profile"));\n  const feedTitles = { "for-you": "For You", latest: "Latest posts", following: "Following", topics: "Chosen Topics", temporary: "Temporary Only", saved: "Saved Filters", profile: "My profile posts" };',
  '  profilePostsButton.setAttribute("aria-pressed", String(mode === "profile"));\n  trendingPostsButton?.setAttribute("aria-pressed", String(mode === "trending"));\n  popularTodayPostsButton?.setAttribute("aria-pressed", String(mode === "popular-today"));\n  savedPostsButton?.setAttribute("aria-pressed", String(mode === "saved-posts"));\n  historyPostsButton?.setAttribute("aria-pressed", String(mode === "history"));\n  const feedTitles = { "for-you": "For You", latest: "Latest posts", following: "Following", topics: "Chosen Topics", temporary: "Temporary Only", saved: "Saved Filters", trending: "Trending", "popular-today": "Popular Today", "saved-posts": "Saved posts", history: "Viewed history", profile: "My profile posts" };',
  "Phase B feed titles"
);
js = replaceOnce(
  js,
  'profilePostsButton.addEventListener("click", () => setFeedView("profile"));',
  'profilePostsButton.addEventListener("click", () => setFeedView("profile"));\ntrendingPostsButton?.addEventListener("click", () => setFeedView("trending"));\npopularTodayPostsButton?.addEventListener("click", () => setFeedView("popular-today"));\nsavedPostsButton?.addEventListener("click", () => setFeedView("saved-posts"));\nhistoryPostsButton?.addEventListener("click", () => setFeedView("history"));\nclearRecentSearchesButton?.addEventListener("click", () => { recentSearches = []; if (recentSearchList) recentSearchList.replaceChildren(); });',
  "Phase B feed handlers"
);

js = replaceOnce(
  js,
  '  const orderedPosts = showingProfile\n    ? filteredPosts\n    : sortFeedPosts(filteredPosts, feedMode, {',
  '  let phaseBPosts = filteredPosts;\n  if (feedMode === "trending") {\n    phaseBPosts = [...filteredPosts].filter((post) => trendingScore({ createdAtMs: post.data().createdAt?.toMillis?.() || 0, uniqueInteractions: postReactions(post).length, commentCount: postComments(post).filter((c) => !c.data().parentCommentId).length, replyCount: postComments(post).filter((c) => c.data().parentCommentId).length }, Date.now()) > -Infinity)\n      .sort((a, b) => trendingScore({ createdAtMs: b.data().createdAt?.toMillis?.() || 0, uniqueInteractions: postReactions(b).length, commentCount: postComments(b).length, replyCount: postComments(b).filter((c) => c.data().parentCommentId).length }, Date.now()) - trendingScore({ createdAtMs: a.data().createdAt?.toMillis?.() || 0, uniqueInteractions: postReactions(a).length, commentCount: postComments(a).length, replyCount: postComments(a).filter((c) => c.data().parentCommentId).length }, Date.now()));\n  } else if (feedMode === "popular-today") {\n    phaseBPosts = [...filteredPosts].filter((post) => { const data = post.data(); const score = popularTodayScore({ createdAtMs: data.createdAt?.toMillis?.() || 0, uniqueInteractions: postReactions(post).length, commentCount: postComments(post).length, replyCount: postComments(post).filter((c) => c.data().parentCommentId).length }, Date.now()); return score > -Infinity; })\n      .sort((a, b) => popularTodayScore({ createdAtMs: b.data().createdAt?.toMillis?.() || 0, uniqueInteractions: postReactions(b).length, commentCount: postComments(b).length, replyCount: postComments(b).filter((c) => c.data().parentCommentId).length }, Date.now()) - popularTodayScore({ createdAtMs: a.data().createdAt?.toMillis?.() || 0, uniqueInteractions: postReactions(a).length, commentCount: postComments(a).length, replyCount: postComments(a).filter((c) => c.data().parentCommentId).length }, Date.now()));\n  } else if (feedMode === "saved-posts") phaseBPosts = filteredPosts.filter((post) => savedPostPaths.has(interactionParentForPost(post).path));\n  else if (feedMode === "history") phaseBPosts = viewedPostPaths.map((path) => filteredPosts.find((post) => interactionParentForPost(post).path === path)).filter(Boolean);\n  const orderedPosts = showingProfile\n    ? phaseBPosts\n    : ["trending", "popular-today", "saved-posts", "history"].includes(feedMode) ? phaseBPosts : sortFeedPosts(phaseBPosts, feedMode, {',
  "Phase B feed ordering"
);

js = replaceOnce(
  js,
  '  feed.replaceChildren(...visiblePosts.map(renderPost));',
  '  feed.replaceChildren(...visiblePosts.map(renderPost));\n  visiblePosts.forEach((post) => { const path = interactionParentForPost(post).path; viewedPostPaths = [path, ...viewedPostPaths.filter((item) => item !== path)].slice(0, 100); });\n  if (suggestedFollowsList) {\n    const followedUidsForSuggestions = new Set(visibleFollows().filter((follow) => follow.data().followerId === currentUser?.uid).map((follow) => follow.data().followingId));\n    const candidates = visibleUsers().map((profile) => ({ uid: profile.id, mutuals: visibleFollows().filter((f) => f.data().followingId === profile.id).length, sharedTopics: 0, publicInteractions: 0, username: profile.data().username }));\n    const suggestions = suggestFollowCandidates(candidates, { viewerUid: currentUser?.uid, followedUids: followedUidsForSuggestions, blockedUids: new Set(viewerBlocks.blockedUids) }, 5);\n    suggestedFollowsList.replaceChildren(...suggestions.map((suggestion) => { const row = document.createElement("div"); const link = document.createElement("a"); link.href = `profile.html?uid=${encodeURIComponent(suggestion.uid)}`; link.textContent = `@${suggestion.username || "anonymous"}`; row.append(link, createFollowControl(suggestion.uid)); return row; }));\n  }',
  "Phase B canonical feed rendering"
);

fs.writeFileSync("timeline.html", html);
fs.writeFileSync("timeline.js", js);
console.log("Phase B surface patch applied");
