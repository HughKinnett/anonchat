import fs from "node:fs";

const replaceOnce = (source, needle, replacement, label) => {
  if (!source.includes(needle)) throw new Error(`Could not locate ${label}`);
  return source.replace(needle, replacement);
};
const replaceSection = (source, startNeedle, endNeedle, replacement, label) => {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start);
  if (start < 0 || end < 0) throw new Error(`Could not locate ${label}`);
  return source.slice(0, start) + replacement + source.slice(end);
};

let js = fs.readFileSync("timeline.js", "utf8");

js = replaceOnce(
  js,
  'import { normalizeTopic } from "./topic-policy.mjs";',
  'import { normalizeTopic, postTopics } from "./topic-policy.mjs";',
  "topic policy import"
);

js = replaceSection(
  js,
  'const appendLinkedText = (container, value) => {',
  'const attachMentionAutocomplete = (input) => {',
  `const appendLinkedText = (container, value) => {
  String(value || "").split(/(@[A-Za-z0-9_]{3,30}|#[A-Za-z0-9_]+(?:-[A-Za-z0-9_]+)*)/g).forEach((part) => {
    if (part.startsWith("#")) {
      const topic = normalizeTopic(part.slice(1));
      if (!topic) { container.append(document.createTextNode(part)); return; }
      const link = document.createElement("button");
      link.type = "button";
      link.className = "hashtag-link";
      link.textContent = part;
      link.addEventListener("click", () => {
        selectedTopics = new Set([topic]);
        renderChosenTopics();
        setFeedView("topics");
      });
      container.append(link);
      return;
    }
    if (!part.startsWith("@")) {
      container.append(document.createTextNode(part));
      return;
    }
    const handle = part.slice(1).toLowerCase();
    const profile = visibleUsers().find((entry) => entry.data().username?.toLowerCase() === handle);
    if (!profile) {
      container.append(document.createTextNode(part));
      return;
    }
    const link = document.createElement("a");
    link.className = "mention-link";
    link.href = \`profile.html?uid=\${encodeURIComponent(profile.id)}\`;
    link.textContent = part;
    container.append(link);
  });
};

`,
  "linked text renderer"
);

const searchHelpersAnchor = 'const renderSearchResults = () => {';
js = replaceOnce(
  js,
  searchHelpersAnchor,
  `const renderRecentSearches = () => {
  if (!recentSearchList) return;
  recentSearchList.replaceChildren(...recentSearches.map((value) => {
    const row = document.createElement("div");
    row.className = "recent-search-row";
    const open = document.createElement("button");
    open.type = "button";
    open.textContent = value;
    open.addEventListener("click", () => { searchInput.value = value; renderSearchResults(); searchInput.focus(); });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.setAttribute("aria-label", \`Remove recent search \${value}\`);
    remove.textContent = "×";
    remove.addEventListener("click", async () => {
      if (!currentUser) return;
      recentSearches = removeRecentSearch(recentSearches, value);
      renderRecentSearches();
      const snapshot = await getDocs(collection(db, "users", currentUser.uid, "recentSearches"));
      const match = snapshot.docs.find((entry) => normalizeRecentSearch(entry.data().value) === normalizeRecentSearch(value));
      if (match) await deleteDoc(match.ref);
    });
    row.append(open, remove);
    return row;
  }));
};

const persistRecentSearch = async (value) => {
  if (!currentUser) return;
  const normalized = normalizeRecentSearch(value);
  if (normalized.length < 2) return;
  recentSearches = mergeRecentSearches(recentSearches, normalized, 20);
  renderRecentSearches();
  const entryId = encodeURIComponent(normalized).slice(0, 200);
  await setDoc(doc(db, "users", currentUser.uid, "recentSearches", entryId), {
    uid: currentUser.uid,
    value: normalized,
    searchedAt: serverTimestamp()
  });
};

${searchHelpersAnchor}`,
  "recent search helpers"
);

js = replaceOnce(
  js,
  'searchInput.addEventListener("keydown", (event) => {\n  if (event.key === "Escape") {',
  'searchInput.addEventListener("keydown", (event) => {\n  if (event.key === "Enter") { event.preventDefault(); void persistRecentSearch(searchInput.value); renderSearchResults(); return; }\n  if (event.key === "Escape") {',
  "recent search Enter handler"
);

js = replaceOnce(
  js,
  '  item.dataset.interactionPath = parent.path;',
  '  item.dataset.interactionPath = parent.path;\n  item.dataset.canonicalPostPath = parent.path;',
  "canonical history dataset"
);

js = replaceOnce(
  js,
  '          transaction.update(postDoc.ref, { content: nextContent, topics: normalizeTopic(nextContent) ? snapshot.data().topics : snapshot.data().topics, editedAt: serverTimestamp(), editVersion: meta.editVersion });',
  '          transaction.update(postDoc.ref, { content: nextContent, topics: postTopics({ ...snapshot.data(), content: nextContent }), editedAt: serverTimestamp(), editVersion: meta.editVersion });',
  "edited hashtag membership"
);

const bookmarkStart = '  const bookmark = document.createElement("button");';
const bookmarkEnd = '  const repostId = `repost_${currentUser.uid}_${sourceId}`;';
js = replaceSection(
  js,
  bookmarkStart,
  bookmarkEnd,
  `  const bookmark = document.createElement("button");
  bookmark.type = "button";
  bookmark.className = "bookmark-button";
  const updateBookmarkLabel = () => { bookmark.textContent = savedPostPaths.has(parent.path) ? "🔖 Saved" : "🔖 Save"; };
  updateBookmarkLabel();
  bookmark.addEventListener("click", async () => {
    const savedRef = doc(db, "users", currentUser.uid, "saved", savedPostEntryId(parent.path));
    bookmark.disabled = true;
    try {
      if (savedPostPaths.has(parent.path)) await deleteDoc(savedRef);
      else await setDoc(savedRef, { uid: currentUser.uid, postPath: parent.path, savedAt: serverTimestamp() });
    } catch { setStatus("Could not update Saved posts.", true); }
    finally { bookmark.disabled = false; }
  });
  actions.append(bookmark);
  if (post.content) {
    const copyText = document.createElement("button"); copyText.type = "button"; copyText.textContent = "Copy text";
    copyText.addEventListener("click", async () => { try { await navigator.clipboard.writeText(post.content); setStatus("Post text copied."); } catch { setStatus("Could not copy post text.", true); } });
    actions.append(copyText);
  }
  if (post.authorId === currentUser.uid && post.type !== "repost") {
    const editPost = document.createElement("button"); editPost.type = "button"; editPost.textContent = "Edit post";
    editPost.addEventListener("click", async () => {
      const nextContent = window.prompt("Edit post", post.content)?.trim();
      if (!nextContent || nextContent === post.content) return;
      try {
        await runTransaction(db, async (transaction) => {
          const snapshot = await transaction.get(postDoc.ref);
          if (!snapshot.exists() || !canEditOwnedContent(snapshot.data(), currentUser.uid)) throw new Error("not-authorized");
          const meta = nextEditMetadata(snapshot.data(), Date.now());
          transaction.set(doc(postDoc.ref, "editHistory", \`v\${meta.editVersion}\`), { ...buildEditHistorySnapshot(snapshot.data(), currentUser.uid, Date.now()), archivedAt: serverTimestamp() });
          transaction.update(postDoc.ref, { content: nextContent, topics: postTopics({ ...snapshot.data(), content: nextContent }), editedAt: serverTimestamp(), editVersion: meta.editVersion });
        });
      } catch { setStatus("Could not edit that post.", true); }
    });
    actions.append(editPost);
  }
`,
  "Firestore Saved action"
);

const observerAnchor = 'const interactionVisibilityObserver = typeof IntersectionObserver === "function"';
js = replaceOnce(
  js,
  observerAnchor,
  `const recordedHistoryPaths = new Set();
const recordViewedPost = async (postPath) => {
  if (!currentUser || !postPath || recordedHistoryPaths.has(postPath)) return;
  recordedHistoryPaths.add(postPath);
  try {
    await setDoc(doc(db, "users", currentUser.uid, "viewHistory", historyEntryId(postPath)), {
      uid: currentUser.uid,
      postPath,
      viewedAt: serverTimestamp()
    });
    const snapshot = await getDocs(query(collection(db, "users", currentUser.uid, "viewHistory"), orderBy("viewedAt", "desc"), limit(101)));
    await Promise.all(snapshot.docs.slice(100).map((entry) => deleteDoc(entry.ref)));
  } catch { recordedHistoryPaths.delete(postPath); }
};

${observerAnchor}`,
  "view history recorder"
);
js = replaceOnce(
  js,
  '        if (entry.isIntersecting && !visibleInteractionPaths.has(path)) {\n          visibleInteractionPaths.add(path);\n          changed = true;',
  '        if (entry.isIntersecting && !visibleInteractionPaths.has(path)) {\n          visibleInteractionPaths.add(path);\n          void recordViewedPost(entry.target.dataset.canonicalPostPath);\n          changed = true;',
  "history intersection recording"
);
js = replaceOnce(
  js,
  '  visiblePosts.forEach((post) => { const path = interactionParentForPost(post).path; viewedPostPaths = [path, ...viewedPostPaths.filter((item) => item !== path)].slice(0, 100); });\n',
  '',
  "remove render-as-view history"
);

const listenerAnchor = '  listeners.push(clearInteractionListeners);';
js = replaceOnce(
  js,
  listenerAnchor,
  `${listenerAnchor}
  listeners.push(listenForSession(
    query(collection(db, "users", user.uid, "saved"), orderBy("savedAt", "desc"), limit(250)),
    (snapshot) => { savedPostPaths = new Set(snapshot.docs.map((entry) => entry.data().postPath).filter(Boolean)); renderFeed(); },
    () => setStatus("Could not load Saved posts.", true)
  ));
  listeners.push(listenForSession(
    query(collection(db, "users", user.uid, "viewHistory"), orderBy("viewedAt", "desc"), limit(100)),
    (snapshot) => { viewedPostPaths = snapshot.docs.map((entry) => entry.data().postPath).filter(Boolean); if (feedMode === "history") renderFeed(); },
    () => setStatus("Could not load viewed history.", true)
  ));
  listeners.push(listenForSession(
    query(collection(db, "users", user.uid, "recentSearches"), orderBy("searchedAt", "desc"), limit(20)),
    (snapshot) => { recentSearches = snapshot.docs.map((entry) => normalizeRecentSearch(entry.data().value)).filter(Boolean); renderRecentSearches(); },
    () => setStatus("Could not load recent searches.", true)
  ));`,
  "private Phase B listeners"
);

js = replaceOnce(
  js,
  'clearRecentSearchesButton?.addEventListener("click", () => { recentSearches = []; if (recentSearchList) recentSearchList.replaceChildren(); });',
  'clearRecentSearchesButton?.addEventListener("click", async () => {\n  if (!currentUser) return;\n  recentSearches = []; renderRecentSearches();\n  const snapshot = await getDocs(collection(db, "users", currentUser.uid, "recentSearches"));\n  const batch = writeBatch(db); snapshot.docs.forEach((entry) => batch.delete(entry.ref)); await batch.commit();\n});',
  "clear recent searches persistence"
);

const submitStart = 'form.addEventListener("submit", async (event) => {\n  event.preventDefault();\n  const postContent = content.value.trim();';
const signoutStart = 'document.getElementById("sign-out").addEventListener("click", async () => {';
js = replaceSection(
  js,
  submitStart,
  signoutStart,
  `form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const postContent = content.value.trim();
  const category = postCategory.value;
  const options = [...document.querySelectorAll(".poll-option")].map((input) => input.value.trim()).filter(Boolean);
  const premiumWordCount = postContent ? postContent.split(/\\s+/).filter(Boolean).length : 0;
  const gifUrl = postGifUrl?.value.trim() || "";
  const composerMedia = gifUrl ? [{ type: "gif", url: gifUrl }] : pendingPostMedia;
  const mediaValidation = validatePostMedia(composerMedia);
  if (!mediaValidation.ok) { setStatus("Choose up to four photos, or one GIF.", true); return; }
  if (!currentUser || (!currentUserIsPremium && postContent.length > 500) || (currentUserIsPremium && premiumWordCount > 1000)) { setStatus(currentUserIsPremium ? "Premium posts can contain up to 1,000 words." : "Posts can contain up to 500 characters.", true); return; }
  if (category === "Poll" && options.length < 2) { setStatus("Add at least two poll choices.", true); return; }
  if (category !== "Poll" && !postContent && !composerMedia.length) return;
  const expiryHours = Number(postExpiry.value);
  const submit = form.querySelector("button[type='submit']");
  submit.disabled = true;
  try {
    await addDoc(collection(db, "posts"), buildOriginalPost({
      authorId: currentUser.uid,
      username: profileUsername,
      content: postContent || "Poll",
      imageData: composerMedia[0]?.url || "",
      media: composerMedia,
      category,
      options: category === "Poll" ? options : [],
      expiresAt: expiryHours ? Timestamp.fromMillis(Date.now() + expiryHours * 3600000) : null,
      createdAt: serverTimestamp()
    }));
    content.value = "";
    localStorage.removeItem(\`anonchat:post-draft:\${currentUser.uid}\`);
    pendingPostImage = "";
    pendingPostMedia = [];
    if (postGifUrl) postGifUrl.value = "";
    postImageInput.value = "";
    postImagePreviewWrap.hidden = true;
    setPhotoSelected(false);
    postCategory.value = "Post";
    postExpiry.value = "0";
    pollOptions.hidden = true;
    recordContribution();
  } catch { setStatus("Could not publish your post.", true); }
  finally { submit.disabled = false; }
});

`,
  "canonical media submit"
);

js = replaceOnce(
  js,
  `    imageData: post.imageData || "",
    createdAt: serverTimestamp()`,
  `    imageData: post.imageData || "",
    media: post.media || [],
    createdAt: serverTimestamp()`,
  "repost media preservation"
);

fs.writeFileSync("timeline.js", js);
console.log("Phase B persistence patch applied");
