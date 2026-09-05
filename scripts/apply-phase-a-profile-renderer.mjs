import { readFile, writeFile } from "node:fs/promises";

const path = new URL("../profile.js", import.meta.url);
let source = await readFile(path, "utf8");

const replaceOnce = (before, after, label) => {
  if (source.includes(after)) return;
  if (!source.includes(before)) throw new Error(`Could not find ${label}`);
  source = source.replace(before, after);
};

replaceOnce(
`const ownConnectionsVisible = targetUserId === currentUser.uid;
followersLink.textContent = ownConnectionsVisible
  ? \`${'${count}'} ${'${count === 1 ? "follower" : "followers"}'}\`
  : "Followers private";
followingLink.textContent = ownConnectionsVisible
  ? \`${'${following}'} following\`
  : "Following private";
if (ownConnectionsVisible) {
  followersLink.href = \`connections.html?uid=${'${encodeURIComponent(targetUserId)}'}#followers\`;
  followingLink.href = \`connections.html?uid=${'${encodeURIComponent(targetUserId)}'}#following\`;
} else {
  followersLink.removeAttribute("href");
  followingLink.removeAttribute("href");
}`,
`const connectionsVisible = targetUserId === currentUser.uid
  || targetProfile?.profilePrivacy?.showFollowersFollowing !== false;
followersLink.textContent = connectionsVisible
  ? \`${'${count}'} ${'${count === 1 ? "follower" : "followers"}'}\`
  : "Followers private";
followingLink.textContent = connectionsVisible
  ? \`${'${following}'} following\`
  : "Following private";
if (connectionsVisible) {
  followersLink.href = \`connections.html?uid=${'${encodeURIComponent(targetUserId)}'}#followers\`;
  followingLink.href = \`connections.html?uid=${'${encodeURIComponent(targetUserId)}'}#following\`;
} else {
  followersLink.removeAttribute("href");
  followingLink.removeAttribute("href");
}`,
"connection privacy block"
);

replaceOnce(
`    .filter((post) => isBlockedPost(post, viewerBlocks))
    .sort(compareNewestFirst);`,
`    .filter((post) => isBlockedPost(post, viewerBlocks))
    .sort((left, right) => {
      const pinnedPostId = targetProfile?.pinnedPostId || "";
      if (left.id === pinnedPostId && right.id !== pinnedPostId) return -1;
      if (right.id === pinnedPostId && left.id !== pinnedPostId) return 1;
      return compareNewestFirst(left, right);
    });`,
"pinned sorting"
);

replaceOnce(
`    const item = document.createElement("li");
    item.className = "feed-item";
    if (targetPremiumSettings) applyPremiumTheme(item, targetPremiumSettings);`,
`    const item = document.createElement("li");
    item.className = "feed-item";
    item.dataset.postId = postDoc.id;
    item.dataset.postCollection = postDoc.ref.parent.id;
    const isPinned = postDoc.id === targetProfile?.pinnedPostId;
    if (targetPremiumSettings) applyPremiumTheme(item, targetPremiumSettings);`,
"canonical post metadata"
);

replaceOnce(
`    postActions.append(bookmark);
    if (post.authorId !== currentUser.uid) {`,
`    postActions.append(bookmark);
    if (post.authorId === currentUser.uid) {
      const pinPost = document.createElement("button");
      pinPost.type = "button";
      pinPost.textContent = isPinned ? "Unpin from profile" : "Pin to profile";
      pinPost.addEventListener("click", async () => {
        pinPost.disabled = true;
        try {
          const pinnedPostId = isPinned ? null : postDoc.id;
          await updateDoc(doc(db, "users", currentUser.uid), { pinnedPostId });
          targetProfile = { ...targetProfile, pinnedPostId };
          schedulePostsRender();
        } catch {
          setStatus("Could not update your pinned post.", true);
          pinPost.disabled = false;
        }
      });
      postActions.append(pinPost);
    }
    if (post.authorId !== currentUser.uid) {`,
"pin action"
);

replaceOnce(
`  }));

  document.getElementById("profile-post-count").textContent =`,
`  }));

  const pinnedRegion = document.getElementById("profile-pinned-post");
  if (pinnedRegion) {
    pinnedRegion.replaceChildren();
    const pinnedItem = [...feed.children].find((item) => item.dataset.postId === targetProfile?.pinnedPostId);
    if (pinnedItem) {
      const label = document.createElement("p");
      label.className = "profile-pinned-label";
      label.textContent = "📌 Pinned";
      pinnedRegion.append(label, pinnedItem);
      pinnedRegion.hidden = false;
    } else {
      pinnedRegion.hidden = true;
    }
  }

  document.getElementById("profile-post-count").textContent =`,
"pinned region"
);

await writeFile(path, source);
console.log("Phase A profile renderer patch applied");
