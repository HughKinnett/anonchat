import fs from "node:fs";

const path = "profile.js";
let source = fs.readFileSync(path, "utf8");

const replaceOnce = (needle, replacement, label) => {
  if (!source.includes(needle)) throw new Error(`Could not locate ${label}`);
  source = source.replace(needle, () => replacement);
};

replaceOnce(
  'import { isBookmarked, toggleBookmark } from "./experience-preferences.mjs";',
  `import { buildEditHistorySnapshot, canEditOwnedContent, nextEditMetadata } from "./content-edit-policy.mjs";
import { groupCommentThreads, threadRootId } from "./threaded-reply-policy.mjs";
import { normalizePostMedia } from "./post-media-policy.mjs";
import { savedPostEntryId } from "./saved-history-policy.mjs";
import { postTopics } from "./topic-policy.mjs";`,
  "legacy profile bookmark import"
);

replaceOnce(
  "let currentUser;\nlet currentProfileUsername;",
  "let currentUser;\nlet currentProfileUsername;\nlet savedPostPaths = new Set();",
  "profile saved state declaration"
);

replaceOnce(
  `const schedulePostsRender = () => {
  if (postsRenderQueued) return;
  postsRenderQueued = true;
  queueMicrotask(() => { postsRenderQueued = false; renderPosts(); });
};`,
  `const schedulePostsRender = () => {
  if (postsRenderQueued) return;
  postsRenderQueued = true;
  queueMicrotask(() => { postsRenderQueued = false; renderPosts(); });
};

const mediaForPost = (post = {}) => normalizePostMedia(
  Array.isArray(post.media) && post.media.length
    ? post.media
    : (post.imageData ? [{ type: "image", url: post.imageData }] : [])
);

const renderPostMedia = (post = {}) => {
  const mediaItems = mediaForPost(post);
  if (!mediaItems.length) return null;
  const grid = document.createElement("div");
  grid.className = \`post-media-grid media-count-\${mediaItems.length}\`;
  mediaItems.forEach((media) => {
    const image = document.createElement("img");
    image.className = media.type === "gif" ? "post-image post-gif" : "post-image";
    image.loading = "lazy";
    image.decoding = "async";
    image.src = media.url;
    image.alt = media.type === "gif" ? "GIF attached to this post" : "Photo attached to this post";
    grid.append(image);
  });
  return grid;
};`,
  "profile render scheduling helper"
);

replaceOnce(
  `    const text = document.createElement("p");
    appendLinkedText(text, post.content);
    const postImage = post.imageData ? document.createElement("img") : null;
    if (postImage) {
      postImage.className = "post-image";
      postImage.loading = "lazy";
      postImage.decoding = "async";
      postImage.src = post.imageData;
      postImage.alt = "Photo attached to this post";
    }`,
  `    const text = document.createElement("p");
    appendLinkedText(text, post.content);
    if (post.editedAt || Number(post.editVersion) > 0) {
      const edited = document.createElement("small");
      edited.className = "edited-label";
      edited.textContent = "Edited";
      text.append(document.createTextNode(" "), edited);
    }
    const postMediaGrid = renderPostMedia(post);`,
  "legacy profile single-image renderer"
);

replaceOnce(
  `    const list = document.createElement("ul");
    list.className = "comments-list";
    commentDocs.forEach((commentDoc) => {
      const comment = commentDoc.data();`,
  `    const list = document.createElement("ul");
    list.className = "comments-list";
    let profileReplyTarget = null;
    const threadedCommentDocs = groupCommentThreads(commentDocs.map((commentDoc) => ({
      id: commentDoc.id,
      ...commentDoc.data(),
      __doc: commentDoc
    }))).flatMap(({ root, replies }) => [root, ...replies]);
    threadedCommentDocs.forEach((threadedComment) => {
      const commentDoc = threadedComment.__doc;
      const comment = commentDoc.data();`,
  "profile comment iteration"
);

replaceOnce(
  `      const commentItem = document.createElement("li");
      commentItem.className = "comment-item";`,
  `      const commentItem = document.createElement("li");
      commentItem.className = comment.parentCommentId ? "comment-item comment-reply" : "comment-item";`,
  "profile comment item class"
);

replaceOnce(
  `      const commentTime = document.createElement("time");
      commentTime.textContent = comment.createdAt?.toDate
        ? comment.createdAt.toDate().toLocaleString()
        : "Posting…";`,
  `      const commentTime = document.createElement("time");
      commentTime.textContent = (comment.createdAt?.toDate
        ? comment.createdAt.toDate().toLocaleString()
        : "Posting…") + (comment.editedAt || Number(comment.editVersion) > 0 ? " · Edited" : "");`,
  "profile comment edited state"
);

replaceOnce(
  `      reply.addEventListener("click", () => {
        input.value = \`@\${comment.username || "anonymous"} \`;
        commentsSection.open = true;
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      });
      actions.append(reply);`,
  `      reply.addEventListener("click", () => {
        profileReplyTarget = {
          id: commentDoc.id,
          threadRootId: threadRootId({ id: commentDoc.id, ...comment })
        };
        input.value = \`@\${comment.username || "anonymous"} \`;
        commentsSection.open = true;
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      });
      actions.append(reply);
      if (comment.uid === currentUser.uid) {
        const editComment = document.createElement("button");
        editComment.type = "button";
        editComment.textContent = "Edit comment";
        editComment.addEventListener("click", async () => {
          const nextText = window.prompt("Edit comment", comment.text)?.trim();
          if (!nextText || nextText === comment.text) return;
          try {
            await runTransaction(db, async (transaction) => {
              const snapshot = await transaction.get(commentDoc.ref);
              if (!snapshot.exists() || !canEditOwnedContent(snapshot.data(), currentUser.uid)) throw new Error("not-authorized");
              const now = Date.now();
              const meta = nextEditMetadata(snapshot.data(), now);
              transaction.set(doc(commentDoc.ref, "editHistory", \`v\${meta.editVersion}\`), {
                ...buildEditHistorySnapshot(snapshot.data(), currentUser.uid, now),
                archivedAt: serverTimestamp()
              });
              transaction.update(commentDoc.ref, { text: nextText, editedAt: serverTimestamp(), editVersion: meta.editVersion });
            });
          } catch {
            setStatus("Could not edit that comment.", true);
          }
        });
        actions.append(editComment);
      }`,
  "profile reply action"
);

replaceOnce(
  `        const commentRef = await addDoc(collection(db, parent.collection, parent.id, "comments"), {
          uid: currentUser.uid,
          username: currentProfileUsername,
          text: commentText,
          createdAt: serverTimestamp()
        });
        const pendingComment = { ref: commentRef, data: () => ({ uid: currentUser.uid, username: currentProfileUsername, text: commentText, createdAt: new Date() }) };`,
  `        const commentRef = await addDoc(collection(db, parent.collection, parent.id, "comments"), {
          uid: currentUser.uid,
          username: currentProfileUsername,
          text: commentText,
          ...(profileReplyTarget ? { parentCommentId: profileReplyTarget.id, threadRootId: profileReplyTarget.threadRootId } : {}),
          createdAt: serverTimestamp()
        });
        const pendingComment = { ref: commentRef, data: () => ({
          uid: currentUser.uid,
          username: currentProfileUsername,
          text: commentText,
          ...(profileReplyTarget ? { parentCommentId: profileReplyTarget.id, threadRootId: profileReplyTarget.threadRootId } : {}),
          createdAt: new Date()
        }) };`,
  "profile comment write"
);

replaceOnce(
  `        input.value = "";
        commentsSection.open = true;`,
  `        input.value = "";
        profileReplyTarget = null;
        commentsSection.open = true;`,
  "profile comment reset"
);

replaceOnce(
  `    const bookmark = document.createElement("button");
    bookmark.type = "button";
    const updateBookmark = () => { bookmark.textContent = isBookmarked(parent.path) ? "🔖 Saved" : "🔖 Bookmark"; };
    updateBookmark();
    bookmark.addEventListener("click", () => {
      toggleBookmark({ path: parent.path, author: targetProfile.username, excerpt: post.content });
      updateBookmark();
    });
    postActions.append(bookmark);`,
  `    const bookmark = document.createElement("button");
    bookmark.type = "button";
    bookmark.className = "bookmark-button";
    const updateBookmark = () => { bookmark.textContent = savedPostPaths.has(parent.path) ? "🔖 Saved" : "🔖 Save"; };
    updateBookmark();
    bookmark.addEventListener("click", async () => {
      const savedRef = doc(db, "users", currentUser.uid, "saved", savedPostEntryId(parent.path));
      bookmark.disabled = true;
      try {
        if (savedPostPaths.has(parent.path)) {
          await deleteDoc(savedRef);
          savedPostPaths.delete(parent.path);
        } else {
          await setDoc(savedRef, { uid: currentUser.uid, postPath: parent.path, savedAt: serverTimestamp() });
          savedPostPaths.add(parent.path);
        }
        updateBookmark();
      } catch {
        setStatus("Could not update Saved posts.", true);
      } finally {
        bookmark.disabled = false;
      }
    });
    postActions.append(bookmark);`,
  "legacy profile bookmark action"
);

replaceOnce(
  `    if (post.authorId === currentUser.uid && phaseAFeatures.profilePinsEnabled !== false) {`,
  `    if (post.authorId === currentUser.uid && post.type !== "repost") {
      const editPost = document.createElement("button");
      editPost.type = "button";
      editPost.textContent = "Edit post";
      editPost.addEventListener("click", async () => {
        const nextContent = window.prompt("Edit post", post.content)?.trim();
        if (!nextContent || nextContent === post.content) return;
        try {
          await runTransaction(db, async (transaction) => {
            const snapshot = await transaction.get(postDoc.ref);
            if (!snapshot.exists() || !canEditOwnedContent(snapshot.data(), currentUser.uid)) throw new Error("not-authorized");
            const now = Date.now();
            const meta = nextEditMetadata(snapshot.data(), now);
            transaction.set(doc(postDoc.ref, "editHistory", \`v\${meta.editVersion}\`), {
              ...buildEditHistorySnapshot(snapshot.data(), currentUser.uid, now),
              archivedAt: serverTimestamp()
            });
            transaction.update(postDoc.ref, {
              content: nextContent,
              topics: postTopics({ ...snapshot.data(), content: nextContent }),
              editedAt: serverTimestamp(),
              editVersion: meta.editVersion
            });
          });
        } catch {
          setStatus("Could not edit that post.", true);
        }
      });
      postActions.append(editPost);
    }
    if (post.authorId === currentUser.uid && phaseAFeatures.profilePinsEnabled !== false) {`,
  "profile pin action anchor"
);

replaceOnce(
  `    item.append(text);
    if (postImage) item.append(postImage);`,
  `    item.append(text);
    if (postMediaGrid) item.append(postMediaGrid);`,
  "profile final media append"
);

replaceOnce(
  `  currentUser = user;
  sessionListeners.push(onSnapshot(doc(db, "siteSettings", "features"), (snapshot) => {`,
  `  currentUser = user;
  try {
    const savedSnapshot = await getDocs(collection(db, "users", user.uid, "saved"));
    if (!sessionIsCurrent()) return;
    savedPostPaths = new Set(savedSnapshot.docs.map((entry) => entry.data().postPath).filter(Boolean));
  } catch {
    savedPostPaths = new Set();
  }
  sessionListeners.push(onSnapshot(doc(db, "siteSettings", "features"), (snapshot) => {`,
  "profile auth saved-state load"
);

fs.writeFileSync(path, source);
console.log("Applied Phase B profile and pinned-post parity");
