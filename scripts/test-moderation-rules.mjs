import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment
} from "@firebase/rules-unit-testing";
import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocsFromServer,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch
} from "firebase/firestore";

const DAY_MS = 86_400_000;
const testEnv = await initializeTestEnvironment({
  projectId: "anonchat-moderation-rules-test",
  firestore: { rules: await readFile(new URL("../firestore.rules", import.meta.url), "utf8") }
});

const profile = (uid, username = uid) => ({
  uid,
  username,
  banned: false,
  createdAt: new Date(0),
  lastActiveAt: new Date(0)
});

const originalPost = (id = "post-1", overrides = {}) => ({
  type: "original",
  authorId: "target",
  username: "target",
  content: `evidence-${id}`,
  imageData: "",
  category: "Post",
  options: [],
  createdAt: new Date(0),
  expiresAt: new Date(Date.now() + DAY_MS),
  ...overrides
});

const communityPost = (id = "community-1", overrides = {}) => ({
  authorId: "target",
  username: "target",
  content: `community-evidence-${id}`,
  category: "Question",
  circleId: "target-circle",
  options: [],
  expiresAt: new Date(Date.now() + DAY_MS),
  createdAt: new Date(0),
  ...overrides
});

const room = (overrides = {}) => ({
  name: "Evidence room",
  topic: "Moderation",
  ownerId: "target",
  createdAt: new Date(0),
  expiresAt: new Date(Date.now() + DAY_MS),
  ...overrides
});

const report = ({
  targetType = "post",
  targetId = "post-1",
  reportedUserId = "target",
  reason = "Spam",
  createdAt = serverTimestamp(),
  reportExtra = {}
} = {}) => ({
  targetType,
  targetId,
  reporterId: "member",
  reportedUserId,
  reason,
  status: "pending",
  createdAt,
  ...reportExtra
});

const seed = async () => testEnv.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore();
  await Promise.all([
    setDoc(doc(db, "users", "member"), profile("member")),
    setDoc(doc(db, "users", "target"), profile("target")),
    setDoc(doc(db, "users", "outsider"), profile("outsider")),
    setDoc(doc(db, "users", "admin"), profile("admin", "i_love_you_h")),
    setDoc(doc(db, "usernames", "i_love_you_h"), {
      uid: "admin", username: "i_love_you_h", createdAt: new Date(0)
    }),
    setDoc(doc(db, "users", "forged-admin"), profile("forged-admin", "CyberCapone")),
    setDoc(doc(db, "circles", "target-circle"), {
      name: "Target circle", description: "Moderation fixture", ownerId: "target", createdAt: new Date(0)
    }),
    setDoc(doc(db, "posts", "post-1"), originalPost("post-1", {
      moderationStatus: "active"
    })),
    setDoc(doc(db, "posts", "post-reported"), originalPost("post-reported", {
      moderationStatus: "reported", reportedAt: new Date(0)
    })),
    setDoc(doc(db, "posts", "repost-1"), {
      type: "repost",
      authorId: "target",
      username: "target",
      originalPostId: "post-1",
      originalAuthorId: "target",
      originalUsername: "target",
      content: "evidence-post-1",
      imageData: "",
      moderationStatus: "active",
      createdAt: new Date(0)
    }),
    setDoc(doc(db, "communityPosts", "community-1"), communityPost("community-1", {
      moderationStatus: "active"
    })),
    setDoc(doc(db, "communityPosts", "community-reported"), communityPost("community-reported", {
      moderationStatus: "reported", reportedAt: new Date(0)
    })),
    setDoc(doc(db, "communityVotes", "community-reported_outsider"), {
      postId: "community-reported", uid: "outsider", option: 0, createdAt: new Date(0)
    }),
    setDoc(doc(db, "rooms", "room-1"), room({ moderationStatus: "active" })),
    setDoc(doc(db, "rooms", "room-reported"), room({
      moderationStatus: "reported", reportedAt: new Date(0), expiresAt: new Date(0)
    })),
    setDoc(doc(db, "roomMembers", "room-reported_member"), {
      roomId: "room-reported", uid: "member", joinedAt: new Date(0)
    }),
    setDoc(doc(db, "roomMembers", "room-1_member"), {
      roomId: "room-1", uid: "member", joinedAt: new Date(0)
    }),
    setDoc(doc(db, "roomMessages", "message-existing"), {
      roomId: "room-reported",
      senderId: "member",
      tempName: "member",
      text: "retained evidence",
      expiresAt: new Date(0),
      createdAt: new Date(0)
    }),
    setDoc(doc(db, "roomMessages", "message-active"), {
      roomId: "room-1",
      senderId: "member",
      tempName: "member",
      text: "active room message",
      expiresAt: new Date(Date.now() + DAY_MS),
      createdAt: new Date(0)
    })
  ]);
});

const reportPost = (db, options = {}) => {
  const batch = writeBatch(db);
  batch.set(doc(db, "reports", "post_post-1_member"), report(options));
  batch.update(doc(db, "posts", "post-1"), {
    moderationStatus: "reported",
    reportedAt: serverTimestamp(),
    ...(options.targetUpdate ?? {})
  });
  return batch.commit();
};

const reportRepost = (db) => {
  const batch = writeBatch(db);
  batch.set(doc(db, "reports", "post_repost-1_member"), report({ targetId: "repost-1" }));
  batch.update(doc(db, "posts", "repost-1"), {
    moderationStatus: "reported",
    reportedAt: serverTimestamp()
  });
  return batch.commit();
};

const reportCommunityPost = (db, options = {}) => {
  const batch = writeBatch(db);
  batch.set(doc(db, "reports", "communityPost_community-1_member"), report({
    targetType: "communityPost",
    targetId: "community-1",
    ...options
  }));
  batch.update(doc(db, "communityPosts", "community-1"), {
    moderationStatus: "reported",
    reportedAt: serverTimestamp(),
    ...(options.targetUpdate ?? {})
  });
  return batch.commit();
};

const reportRoom = (db, options = {}) => {
  const batch = writeBatch(db);
  batch.set(doc(db, "reports", "room_room-1_member"), report({
    targetType: "room",
    targetId: "room-1",
    reason: "Harassment",
    ...options
  }));
  batch.update(doc(db, "rooms", "room-1"), {
    moderationStatus: "reported",
    reportedAt: serverTimestamp(),
    ...(options.targetUpdate ?? {})
  });
  return batch.commit();
};

const seedPendingReport = async (targetType = "post") => testEnv.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore();
  const targetId = targetType === "post"
    ? "post-reported"
    : targetType === "communityPost"
      ? "community-reported"
      : "room-reported";
  await setDoc(doc(db, "reports", `${targetType}_${targetId}_member`), {
    targetType,
    targetId,
    reporterId: "member",
    reportedUserId: "target",
    reason: "Spam",
    status: "pending",
    createdAt: new Date(0)
  });
});

const resolution = (action) => ({
  status: "resolved",
  resolvedBy: "admin",
  resolutionAction: action,
  resolvedAt: serverTimestamp()
});

const moderationAction = (targetType, targetId, reportIds, action) => ({
  targetType,
  targetId,
  reportIds: Array.isArray(reportIds) ? reportIds : [reportIds],
  reportCount: Array.isArray(reportIds) ? reportIds.length : 1,
  action,
  adminId: "admin",
  actedAt: serverTimestamp()
});

const queueModerationDeletion = (db, targetType, targetId, reportId, overrides = {}) => setDoc(
  doc(db, "moderationDeletionJobs", overrides.jobId ?? `${targetType}_${targetId}`),
  {
    targetType,
    targetId,
    reportId,
    requesterUid: overrides.requesterUid ?? "admin",
    requestedAt: overrides.requestedAt ?? serverTimestamp(),
    status: overrides.status ?? "queued",
    ...(overrides.extra ? { injected: true } : {})
  }
);

const resolvePost = (db, options = {}) => {
  const reportId = "post_post-reported_member";
  const reportIds = options.reportIds ?? [reportId];
  const reportAction = options.reportAction ?? "restore-post";
  const targetAction = options.targetAction ?? "restore";
  const batch = writeBatch(db);
  batch.set(doc(db, "moderationActions", "post_post-reported"), moderationAction(
    "post",
    "post-reported",
    reportIds,
    options.markerAction ?? reportAction
  ));
  reportIds.forEach(id => batch.update(doc(db, "reports", id), resolution(reportAction)));
  if (targetAction === "delete") {
    batch.delete(doc(db, "posts", "post-reported"));
  } else {
    batch.update(doc(db, "posts", "post-reported"), {
      moderationStatus: "active", reportedAt: null
    });
  }
  return batch.commit();
};

const resolveCommunityPost = (db, options = {}) => {
  const reportId = "communityPost_community-reported_member";
  const reportAction = options.reportAction ?? "restore-post";
  const batch = writeBatch(db);
  batch.set(doc(db, "moderationActions", "communityPost_community-reported"), moderationAction(
    "communityPost",
    "community-reported",
    reportId,
    options.markerAction ?? reportAction
  ));
  batch.update(doc(db, "reports", reportId), resolution(reportAction));
  if (options.targetAction === "delete") {
    batch.delete(doc(db, "communityPosts", "community-reported"));
  } else {
    batch.update(doc(db, "communityPosts", "community-reported"), {
      moderationStatus: "active", reportedAt: null
    });
  }
  return batch.commit();
};

const resolveRoom = (db, options = {}) => {
  const reportId = "room_room-reported_member";
  const reportAction = options.reportAction ?? "restore-room";
  const batch = writeBatch(db);
  batch.set(doc(db, "moderationActions", "room_room-reported"), moderationAction(
    "room",
    "room-reported",
    reportId,
    options.markerAction ?? reportAction
  ));
  batch.update(doc(db, "reports", reportId), resolution(reportAction));
  if (options.targetAction === "delete") {
    batch.delete(doc(db, "rooms", "room-reported"));
    if (options.deleteDependents) {
      batch.delete(doc(db, "roomMembers", "room-reported_member"));
      batch.delete(doc(db, "roomMessages", "message-existing"));
    }
  } else {
    batch.update(doc(db, "rooms", "room-reported"), {
      moderationStatus: "active",
      reportedAt: null,
      resumedAt: serverTimestamp(),
      expiresAt: options.expiresAt ?? Timestamp.fromMillis(Date.now() + DAY_MS)
    });
  }
  return batch.commit();
};

const reset = async () => {
  await testEnv.clearFirestore();
  await seed();
};

try {
  await seed();
  let member = testEnv.authenticatedContext("member").firestore();
  let target = testEnv.authenticatedContext("target").firestore();
  let outsider = testEnv.authenticatedContext("outsider").firestore();
  let admin = testEnv.authenticatedContext("admin").firestore();
  let forgedAdmin = testEnv.authenticatedContext("forged-admin").firestore();

  // Removing validBlock must make the first assertion fail.
  await assertSucceeds(setDoc(doc(member, "blocks", "member_target"), {
    blockerId: "member", blockedId: "target", createdAt: serverTimestamp()
  }));
  await assertSucceeds(getDoc(doc(member, "blocks", "member_target")));
  await assertSucceeds(getDoc(doc(target, "blocks", "member_target")));
  await assertFails(getDoc(doc(outsider, "blocks", "member_target")));
  await assertFails(updateDoc(doc(member, "blocks", "member_target"), { blockedId: "outsider" }));
  await assertFails(deleteDoc(doc(target, "blocks", "member_target")));
  await assertSucceeds(deleteDoc(doc(member, "blocks", "member_target")));
  await assertFails(setDoc(doc(target, "blocks", "member_target"), {
    blockerId: "member", blockedId: "target", createdAt: serverTimestamp()
  }));
  await assertFails(setDoc(doc(member, "blocks", "member_target"), {
    blockerId: "member", blockedId: "target", createdAt: serverTimestamp(), injected: true
  }));
  await assertFails(setDoc(doc(member, "blocks", "member_member"), {
    blockerId: "member", blockedId: "member", createdAt: serverTimestamp()
  }));
  await assertFails(setDoc(doc(member, "blocks", "member_missing"), {
    blockerId: "member", blockedId: "missing", createdAt: serverTimestamp()
  }));

  await assertSucceeds(setDoc(doc(member, "posts", "post-active-new"), {
    type: "original",
    authorId: "member",
    username: "member",
    content: "active post",
    imageData: "",
    category: "Post",
    options: [],
    moderationStatus: "active",
    expiresAt: new Date(Date.now() + DAY_MS),
    createdAt: serverTimestamp()
  }));
  await assertSucceeds(setDoc(doc(member, "communityPosts", "community-active-new"), {
    authorId: "member",
    username: "member",
    content: "active community post",
    category: "Question",
    circleId: "target-circle",
    options: [],
    expiresAt: new Date(Date.now() + DAY_MS),
    moderationStatus: "active",
    createdAt: serverTimestamp()
  }));
  await assertSucceeds(setDoc(doc(member, "rooms", "room-active-new"), {
    name: "Active room",
    topic: "Visible",
    ownerId: "member",
    moderationStatus: "active",
    createdAt: serverTimestamp()
  }));
  await assertSucceeds(setDoc(doc(member, "posts", "post-image-safe"), {
    type: "original", authorId: "member", username: "member", content: "",
    imageData: "data:image/jpeg;base64,/9j/AA==", category: "Post", options: [],
    moderationStatus: "active", expiresAt: null, createdAt: serverTimestamp()
  }));
  await assertFails(setDoc(doc(member, "posts", "post-image-tracking"), {
    type: "original", authorId: "member", username: "member", content: "",
    imageData: "https://tracking.example/private.png", category: "Post", options: [],
    moderationStatus: "active", expiresAt: null, createdAt: serverTimestamp()
  }));
  await assertFails(setDoc(doc(member, "posts", "post-image-svg"), {
    type: "original", authorId: "member", username: "member", content: "",
    imageData: "data:image/svg+xml;base64,PHN2Zz4=", category: "Post", options: [],
    moderationStatus: "active", expiresAt: null, createdAt: serverTimestamp()
  }));
  await assertSucceeds(setDoc(doc(member, "communityVotes", "posts_post-1_member"), {
    postCollection: "posts", postId: "post-1", uid: "member", option: 0,
    createdAt: serverTimestamp()
  }));
  await assertFails(setDoc(doc(member, "communityVotes", "post-1_member"), {
    postId: "post-1", uid: "member", option: 0, createdAt: serverTimestamp()
  }));
  await assertFails(setDoc(doc(member, "communityVotes", "posts_community-1_member"), {
    postCollection: "posts", postId: "community-1", uid: "member", option: 0,
    createdAt: serverTimestamp()
  }));
  // Missing the stored status makes the document incompatible with protected collection queries.
  await assertFails(setDoc(doc(member, "posts", "post-status-missing"), {
    type: "original",
    authorId: "member",
    username: "member",
    content: "must store active status",
    imageData: "",
    category: "Post",
    options: [],
    expiresAt: new Date(Date.now() + DAY_MS),
    createdAt: serverTimestamp()
  }));
  await assertFails(setDoc(doc(member, "rooms", "room-status-missing"), {
    name: "Missing status",
    topic: "Must be rejected",
    ownerId: "member",
    createdAt: serverTimestamp()
  }));
  await assertFails(setDoc(doc(member, "communityPosts", "community-status-missing"), {
    authorId: "member",
    username: "member",
    content: "must store active status",
    category: "Question",
    circleId: "target-circle",
    options: [],
    expiresAt: new Date(Date.now() + DAY_MS),
    createdAt: serverTimestamp()
  }));
  await assertFails(setDoc(doc(member, "posts", "repost_member_post-1"), {
    type: "repost",
    authorId: "member",
    username: "member",
    originalPostId: "post-1",
    originalAuthorId: "target",
    originalUsername: "target",
    content: "evidence-post-1",
    imageData: "",
    createdAt: serverTimestamp()
  }));

  await reset();
  member = testEnv.authenticatedContext("member").firestore();
  target = testEnv.authenticatedContext("target").firestore();
  await assertFails(updateDoc(doc(member, "posts", "post-1"), {
    moderationStatus: "reported", reportedAt: serverTimestamp()
  }));
  await assertFails(setDoc(doc(member, "reports", "post_post-1_member"), report()));
  // Removing either half of the getAfter pairing must make this batch fail.
  await assertSucceeds(reportPost(member));
  assert.equal((await getDoc(doc(admin, "posts", "post-1"))).data().moderationStatus, "reported");
  await assertFails(setDoc(doc(member, "reports", "post_post-1_member"), report()));

  await reset();
  member = testEnv.authenticatedContext("member").firestore();
  target = testEnv.authenticatedContext("target").firestore();
  await assertFails(reportPost(member, { reportedUserId: "outsider" }));
  await assertFails(reportPost(member, { targetUpdate: { injected: true } }));
  await assertFails(reportPost(member, { reportExtra: { injected: true } }));
  await assertFails(reportPost(member, { reason: "Not an allowed reason" }));
  await assertFails(reportPost(member, { createdAt: new Date(0) }));
  await assertFails(reportPost(target));

  await reset();
  member = testEnv.authenticatedContext("member").firestore();
  await assertFails(updateDoc(doc(member, "communityPosts", "community-1"), {
    moderationStatus: "reported", reportedAt: serverTimestamp()
  }));
  await assertSucceeds(reportCommunityPost(member));
  assert.equal(
    (await getDoc(doc(admin, "communityPosts", "community-1"))).data().moderationStatus,
    "reported"
  );
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "posts", "community-1"), originalPost("community-1", {
      moderationStatus: "active"
    }));
  });
  await assertFails(setDoc(doc(member, "communityVotes", "community-1_member"), {
    postId: "community-1", uid: "member", option: 0, createdAt: serverTimestamp()
  }));
  await assertFails(reportCommunityPost(member));

  await reset();
  member = testEnv.authenticatedContext("member").firestore();
  await assertFails(reportCommunityPost(member, { reportedUserId: "outsider" }));
  await assertFails(reportCommunityPost(member, { targetUpdate: { injected: true } }));

  await reset();
  member = testEnv.authenticatedContext("member").firestore();
  await assertSucceeds(reportRepost(member));
  await assertFails(setDoc(doc(member, "posts", "repost-1", "comments", "stale-comment"), {
    uid: "member", username: "member", text: "stale comment", createdAt: serverTimestamp()
  }));
  await assertFails(setDoc(doc(member, "posts", "repost-1", "reactions", "member"), {
    uid: "member", type: "heart", createdAt: serverTimestamp()
  }));

  await reset();
  member = testEnv.authenticatedContext("member").firestore();
  await assertSucceeds(reportRoom(member));
  assert.equal((await getDoc(doc(admin, "rooms", "room-1"))).data().moderationStatus, "reported");

  await reset();
  member = testEnv.authenticatedContext("member").firestore();
  await assertFails(reportRoom(member, { reportedUserId: "outsider" }));
  await assertFails(reportRoom(member, { targetUpdate: { injected: true } }));

  // Removing reported-target interaction guards must make these assertions fail.
  await assertFails(setDoc(doc(member, "posts", "post-reported", "comments", "comment-1"), {
    uid: "member", username: "member", text: "new comment", createdAt: serverTimestamp()
  }));
  await assertFails(setDoc(doc(member, "posts", "post-reported", "reactions", "member"), {
    uid: "member", type: "heart", createdAt: serverTimestamp()
  }));
  await assertFails(setDoc(doc(member, "communityPosts", "community-reported", "comments", "comment-1"), {
    uid: "member", username: "member", text: "new comment", createdAt: serverTimestamp()
  }));
  await assertFails(setDoc(doc(member, "communityPosts", "community-reported", "reactions", "member"), {
    uid: "member", type: "heart", createdAt: serverTimestamp()
  }));
  await assertFails(setDoc(doc(member, "communityVotes", "community-reported_member"), {
    postId: "community-reported", uid: "member", option: 0, createdAt: serverTimestamp()
  }));
  await assertSucceeds(deleteDoc(doc(admin, "communityVotes", "community-reported_outsider")));
  await assertFails(setDoc(doc(member, "posts", "repost_member_post-reported"), {
    type: "repost",
    authorId: "member",
    username: "member",
    originalPostId: "post-reported",
    originalAuthorId: "target",
    originalUsername: "target",
    content: "evidence-post-reported",
    imageData: "",
    createdAt: serverTimestamp()
  }));
  await assertFails(setDoc(doc(member, "roomMembers", "room-reported_member"), {
    roomId: "room-reported", uid: "member", joinedAt: serverTimestamp()
  }));
  await assertFails(setDoc(doc(member, "roomMessages", "message-1"), {
    roomId: "room-reported",
    senderId: "member",
    tempName: "member",
    text: "new message",
    expiresAt: new Date(Date.now() + DAY_MS),
    createdAt: serverTimestamp()
  }));
  await assertFails(deleteDoc(doc(member, "roomMembers", "room-reported_member")));
  await assertFails(deleteDoc(doc(member, "roomMessages", "message-existing")));
  await assertFails(deleteDoc(doc(admin, "roomMessages", "message-existing")));
  await assertFails(deleteDoc(doc(target, "rooms", "room-reported")));
  await assertFails(deleteDoc(doc(target, "posts", "post-reported")));

  // Removing the reported-evidence read boundary must make these direct gets succeed.
  await assertFails(getDoc(doc(member, "posts", "post-reported")));
  await assertFails(getDoc(doc(member, "communityPosts", "community-reported")));
  await assertFails(getDoc(doc(member, "rooms", "room-reported")));
  await assertFails(getDoc(doc(member, "roomMessages", "message-existing")));
  await assertSucceeds(getDoc(doc(admin, "posts", "post-reported")));
  await assertSucceeds(getDoc(doc(admin, "communityPosts", "community-reported")));
  await assertSucceeds(getDoc(doc(admin, "rooms", "room-reported")));
  await assertSucceeds(getDoc(doc(admin, "roomMessages", "message-existing")));
  await assertSucceeds(getDocsFromServer(query(
    collection(admin, "roomMembers"),
    where("roomId", "==", "room-reported")
  )));

  const activePosts = query(
    collection(member, "posts"),
    where("moderationStatus", "==", "active")
  );
  const activeRooms = query(
    collection(member, "rooms"),
    where("moderationStatus", "==", "active")
  );
  const activeCommunityPosts = query(
    collection(member, "communityPosts"),
    where("moderationStatus", "==", "active")
  );
  const activeRoomMessages = query(
    collection(member, "roomMessages"),
    where("roomId", "==", "room-1")
  );
  const reportedRoomMessages = query(
    collection(member, "roomMessages"),
    where("roomId", "==", "room-reported")
  );
  assert.equal((await assertSucceeds(getDocsFromServer(activePosts))).size, 2);
  assert.equal((await assertSucceeds(getDocsFromServer(activeCommunityPosts))).size, 1);
  assert.equal((await assertSucceeds(getDocsFromServer(activeRooms))).size, 1);
  assert.equal((await assertSucceeds(getDocsFromServer(activeRoomMessages))).size, 1);
  await assertFails(getDocsFromServer(reportedRoomMessages));
  await assertFails(getDocsFromServer(collection(member, "posts")));
  await assertFails(getDocsFromServer(collection(member, "communityPosts")));
  await assertFails(getDocsFromServer(collection(member, "rooms")));
  await assertFails(getDocsFromServer(collection(member, "roomMessages")));
  await assertSucceeds(getDocsFromServer(collection(admin, "posts")));
  await assertSucceeds(getDocsFromServer(collection(admin, "communityPosts")));
  await assertSucceeds(getDocsFromServer(collection(admin, "rooms")));
  await assertSucceeds(getDocsFromServer(collection(admin, "roomMessages")));

  await reset();
  member = testEnv.authenticatedContext("member").firestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await deleteDoc(doc(context.firestore(), "rooms", "room-1"));
  });
  // Reusing roomAvailableAfter here must make cleanup fail after the parent is gone.
  await assertSucceeds(deleteDoc(doc(member, "roomMembers", "room-1_member")));
  await assertSucceeds(deleteDoc(doc(member, "roomMessages", "message-active")));

  await reset();
  member = testEnv.authenticatedContext("member").firestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "adminDeletionJobs", "target"), {
      targetUid: "target", requesterUid: "admin", status: "queued", requestedAt: new Date(0)
    });
  });
  await assertSucceeds(deleteDoc(doc(member, "roomMembers", "room-1_member")));
  await assertSucceeds(deleteDoc(doc(member, "roomMessages", "message-active")));

  await reset();
  await seedPendingReport("post");
  member = testEnv.authenticatedContext("member").firestore();
  admin = testEnv.authenticatedContext("admin").firestore();
  forgedAdmin = testEnv.authenticatedContext("forged-admin").firestore();
  await assertFails(getDoc(doc(member, "reports", "post_post-reported_member")));
  await assertSucceeds(getDoc(doc(admin, "reports", "post_post-reported_member")));
  await assertFails(deleteDoc(doc(admin, "reports", "post_post-reported_member")));
  await assertFails(updateDoc(doc(member, "reports", "post_post-reported_member"), {
    status: "resolved",
    resolvedBy: "member",
    resolutionAction: "restore-post",
    resolvedAt: serverTimestamp()
  }));
  await assertFails(updateDoc(doc(forgedAdmin, "reports", "post_post-reported_member"), {
    status: "resolved",
    resolvedBy: "forged-admin",
    resolutionAction: "restore-post",
    resolvedAt: serverTimestamp()
  }));
  await assertFails(updateDoc(doc(admin, "reports", "post_post-reported_member"), {
    status: "resolved",
    resolvedBy: "admin",
    resolutionAction: "forged-action",
    resolvedAt: serverTimestamp()
  }));
  // Removing the report/target/action coupling must make these standalone writes succeed.
  await assertFails(updateDoc(doc(admin, "reports", "post_post-reported_member"), {
    status: "resolved",
    resolvedBy: "admin",
    resolutionAction: "restore-post",
    resolvedAt: serverTimestamp()
  }));
  await assertFails(updateDoc(doc(admin, "posts", "post-reported"), {
    moderationStatus: "active", reportedAt: null
  }));
  await assertFails(resolvePost(admin, { reportAction: "delete-post", markerAction: "restore-post" }));
  await assertSucceeds(resolvePost(admin));
  await assertSucceeds(deleteDoc(doc(admin, "reports", "post_post-reported_member")));

  await reset();
  await seedPendingReport("post");
  admin = testEnv.authenticatedContext("admin").firestore();
  const duplicateReportId = "post_post-reported_outsider";
  await testEnv.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), "reports", duplicateReportId), {
      targetType: "post", targetId: "post-reported", reporterId: "outsider",
      reportedUserId: "target", reason: "Harassment", status: "pending", createdAt: new Date(1)
    });
  });
  await assertSucceeds(resolvePost(admin, {
    reportIds: ["post_post-reported_member", duplicateReportId]
  }), "one target-wide restore resolves every pending report in the same batch");
  assert.equal((await getDoc(doc(admin, "reports", duplicateReportId))).data().status, "resolved");
  await assertSucceeds(deleteDoc(doc(admin, "reports", "post_post-reported_member")));
  await assertSucceeds(deleteDoc(doc(admin, "reports", duplicateReportId)));

  await reset();
  await seedPendingReport("post");
  admin = testEnv.authenticatedContext("admin").firestore();
  const bulkReportIds = ["post_post-reported_member", ...Array.from({ length: 400 }, (_, index) => `post_post-reported_bulk-${index}`)];
  await testEnv.withSecurityRulesDisabled(async context => {
    const seedBatch = writeBatch(context.firestore());
    for (let index = 1; index < bulkReportIds.length; index += 1) {
      seedBatch.set(doc(context.firestore(), "reports", bulkReportIds[index]), {
        targetType: "post", targetId: "post-reported", reporterId: `bulk-${index - 1}`,
        reportedUserId: "target", reason: "Spam", status: "pending", createdAt: new Date(1)
      });
    }
    await seedBatch.commit();
  });
  await assertSucceeds(resolvePost(admin, { reportIds: bulkReportIds }),
    "a 401-report target restores atomically within the Firestore 500-write boundary");

  await reset();
  admin = testEnv.authenticatedContext("admin").firestore();
  const adminReportBatch = writeBatch(admin);
  adminReportBatch.set(doc(admin, "reports", "post_post-1_admin"), report({
    targetId: "post-1", reportExtra: { reporterId: "admin" }
  }));
  adminReportBatch.update(doc(admin, "posts", "post-1"), {
    moderationStatus: "reported", reportedAt: serverTimestamp()
  });
  await assertFails(adminReportBatch.commit(),
    "reserved administrators cannot consume the bounded reporter capacity");

  await reset();
  await seedPendingReport("post");
  member = testEnv.authenticatedContext("member").firestore();
  admin = testEnv.authenticatedContext("admin").firestore();
  forgedAdmin = testEnv.authenticatedContext("forged-admin").firestore();
  const postReportId = "post_post-reported_member";
  await assertFails(queueModerationDeletion(member, "post", "post-reported", postReportId, { requesterUid: "member" }));
  await assertFails(queueModerationDeletion(forgedAdmin, "post", "post-reported", postReportId, { requesterUid: "forged-admin" }));
  await assertFails(queueModerationDeletion(admin, "post", "post-reported", "missing-report"));
  await assertFails(queueModerationDeletion(admin, "post", "post-reported", postReportId, { jobId: "wrong-id" }));
  await assertFails(queueModerationDeletion(admin, "post", "post-reported", postReportId, { extra: true }));
  await assertSucceeds(queueModerationDeletion(admin, "post", "post-reported", postReportId));
  await assertSucceeds(getDoc(doc(admin, "moderationDeletionJobs", "post_post-reported")));
  await assertFails(getDoc(doc(member, "moderationDeletionJobs", "post_post-reported")));
  await assertFails(queueModerationDeletion(admin, "post", "post-reported", postReportId));
  await assertFails(updateDoc(doc(admin, "moderationDeletionJobs", "post_post-reported"), { status: "processing" }));
  await assertFails(deleteDoc(doc(admin, "moderationDeletionJobs", "post_post-reported")));
  await assertFails(resolvePost(admin), "a queued deletion atomically locks concurrent restore");
  assert.equal((await getDoc(doc(admin, "posts", "post-reported"))).data().moderationStatus, "reported");
  assert.equal((await getDoc(doc(admin, "reports", postReportId))).data().status, "pending");

  await reset();
  await seedPendingReport("communityPost");
  admin = testEnv.authenticatedContext("admin").firestore();
  await assertFails(updateDoc(doc(admin, "communityPosts", "community-reported"), {
    moderationStatus: "active", reportedAt: null
  }));
  await assertSucceeds(resolveCommunityPost(admin));
  await assertSucceeds(deleteDoc(doc(admin, "reports", "communityPost_community-reported_member")));

  await reset();
  await seedPendingReport("room");
  admin = testEnv.authenticatedContext("admin").firestore();
  await assertFails(updateDoc(doc(admin, "reports", "room_room-reported_member"), {
    status: "resolved",
    resolvedBy: "admin",
    resolutionAction: "restore-post",
    resolvedAt: serverTimestamp()
  }));
  await assertFails(updateDoc(doc(admin, "reports", "room_room-reported_member"), {
    status: "resolved",
    resolvedBy: "admin",
    resolutionAction: "restore-room",
    resolvedAt: serverTimestamp()
  }));
  await assertSucceeds(resolveRoom(admin));

  await reset();
  admin = testEnv.authenticatedContext("admin").firestore();
  forgedAdmin = testEnv.authenticatedContext("forged-admin").firestore();
  await assertFails(updateDoc(doc(forgedAdmin, "posts", "post-reported"), {
    moderationStatus: "active", reportedAt: null
  }));
  await assertFails(updateDoc(doc(admin, "posts", "post-reported"), {
    moderationStatus: "active", reportedAt: null, injected: true
  }));
  await assertFails(deleteDoc(doc(admin, "posts", "post-reported")));

  await reset();
  await seedPendingReport("post");
  admin = testEnv.authenticatedContext("admin").firestore();
  await assertFails(resolvePost(admin, {
    reportAction: "delete-post", markerAction: "delete-post", targetAction: "delete"
  }));

  await reset();
  await seedPendingReport("communityPost");
  admin = testEnv.authenticatedContext("admin").firestore();
  await assertFails(resolveCommunityPost(admin, {
    reportAction: "delete-post", markerAction: "delete-post", targetAction: "delete"
  }));
  await assertSucceeds(queueModerationDeletion(
    admin,
    "communityPost",
    "community-reported",
    "communityPost_community-reported_member"
  ));

  await reset();
  await seedPendingReport("room");
  admin = testEnv.authenticatedContext("admin").firestore();
  await assertFails(deleteDoc(doc(admin, "rooms", "room-reported")));
  await assertFails(resolveRoom(admin, {
    reportAction: "delete-room", markerAction: "delete-room", targetAction: "delete", deleteDependents: true
  }));

  await assertSucceeds(queueModerationDeletion(
    admin,
    "room",
    "room-reported",
    "room_room-reported_member"
  ));
  await assertFails(resolveRoom(admin), "a queued room deletion locks resume");

  await reset();
  await seedPendingReport("room");
  admin = testEnv.authenticatedContext("admin").firestore();
  forgedAdmin = testEnv.authenticatedContext("forged-admin").firestore();
  const restoredExpiry = Timestamp.fromMillis(Date.now() + DAY_MS);
  await assertFails(updateDoc(doc(forgedAdmin, "rooms", "room-reported"), {
    moderationStatus: "active",
    reportedAt: null,
    resumedAt: serverTimestamp(),
    expiresAt: restoredExpiry
  }));
  await assertFails(updateDoc(doc(admin, "rooms", "room-reported"), {
    moderationStatus: "active",
    reportedAt: null,
    resumedAt: serverTimestamp(),
    expiresAt: Timestamp.fromMillis(Date.now() + 3_600_000)
  }));
  await assertFails(updateDoc(doc(admin, "rooms", "room-reported"), {
    moderationStatus: "active",
    reportedAt: null,
    resumedAt: serverTimestamp(),
    expiresAt: restoredExpiry
  }));

  await reset();
  await seedPendingReport("room");
  admin = testEnv.authenticatedContext("admin").firestore();
  await assertFails(resolveRoom(admin, {
    expiresAt: Timestamp.fromMillis(Date.now() + DAY_MS - 61_000)
  }));

  await reset();
  await seedPendingReport("room");
  admin = testEnv.authenticatedContext("admin").firestore();
  await assertFails(resolveRoom(admin, {
    expiresAt: Timestamp.fromMillis(Date.now() + DAY_MS + 61_000)
  }));

  await reset();
  member = testEnv.authenticatedContext("member").firestore();
  await testEnv.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    const completed = (targetType, targetId) => ({
      targetType, targetId, requesterUid: "admin", requestedAt: new Date(0),
      status: "completed", completedAt: new Date(1), actionId: `${targetType}_${targetId}`, reportCount: 1
    });
    await Promise.all([
      setDoc(doc(db, "moderationDeletionJobs", "post_retired-post"), completed("post", "retired-post")),
      setDoc(doc(db, "moderationDeletionJobs", "communityPost_retired-community"), completed("communityPost", "retired-community")),
      setDoc(doc(db, "moderationDeletionJobs", "room_retired-room"), completed("room", "retired-room"))
    ]);
  });
  await assertFails(setDoc(doc(member, "posts", "retired-post"), {
    type: "original", authorId: "member", username: "member", content: "cannot reuse",
    imageData: "", category: "Post", options: [], moderationStatus: "active",
    expiresAt: null, createdAt: serverTimestamp()
  }), "a completed moderation job permanently retires its timeline target ID");
  await assertFails(setDoc(doc(member, "communityPosts", "retired-community"), {
    authorId: "member", username: "member", content: "cannot reuse", category: "Question",
    circleId: "target-circle", options: [], moderationStatus: "active", expiresAt: null,
    createdAt: serverTimestamp()
  }), "a completed moderation job permanently retires its community target ID");
  await assertFails(setDoc(doc(member, "rooms", "retired-room"), {
    name: "Retired room", topic: "Cannot reuse", ownerId: "member",
    moderationStatus: "active", createdAt: serverTimestamp()
  }), "a completed moderation job permanently retires its room target ID");

  console.log("Firestore moderation authorization passed");
} finally {
  await testEnv.cleanup();
}
