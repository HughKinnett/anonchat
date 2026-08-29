import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc, updateDoc, writeBatch } from "firebase/firestore";
const testEnv = await initializeTestEnvironment({
  projectId: "anonchat-admin-deletion-barrier-rules-test",
  firestore: { rules: await readFile(new URL("../firestore.rules", import.meta.url), "utf8") }
});
const profile = (uid, username = uid) => ({ uid, username, createdAt: new Date(0), lastActiveAt: new Date(0), banned: false });
const queuedProfile = { ...profile("target"), banned: true, adminDeletionRequestedAt: new Date(1), adminDeletionRequestedBy: "admin", adminDeletionStatus: "queued" };
const queuedJob = { targetUid: "target", requesterUid: "admin", requestedAt: new Date(1), status: "queued" };
const completedMarker = { status: "completed", completedAt: new Date(1_000), purgeAfter: new Date(7_201_000) };
const seed = async ({ targetJob = null, targetProfile = profile("target"), principalBarriers = [] } = {}) => testEnv.withSecurityRulesDisabled(async (context) => {
  const firestore = context.firestore();
  const writes = [
    setDoc(doc(firestore, "users", "admin"), profile("admin", "i_love_you_h")),
    setDoc(doc(firestore, "usernames", "i_love_you_h"), { uid: "admin", username: "i_love_you_h", createdAt: new Date(0) }),
    setDoc(doc(firestore, "users", "member"), profile("member")), setDoc(doc(firestore, "users", "other"), profile("other")),
    setDoc(doc(firestore, "users", "post_author"), profile("post_author")), setDoc(doc(firestore, "users", "circle_owner"), profile("circle_owner")),
    setDoc(doc(firestore, "users", "message_author"), profile("message_author")), setDoc(doc(firestore, "users", "room_owner"), profile("room_owner")),
    setDoc(doc(firestore, "usernames", "member"), { uid: "member", username: "member", createdAt: new Date(0) }),
    setDoc(doc(firestore, "usernames", "other"), { uid: "other", username: "other", createdAt: new Date(0) }),
    setDoc(doc(firestore, "system", "accountStats"), { count: 5, limit: 500, updatedAt: new Date(0) }),
    setDoc(doc(firestore, "posts", "target-post"), { type: "original", authorId: "target", username: "target", content: "target post", imageData: "", category: "Post", options: [], createdAt: new Date(0) }),
    setDoc(doc(firestore, "posts", "other-post"), { type: "original", authorId: "other", username: "other", content: "other post", imageData: "", category: "Post", options: [], createdAt: new Date(0) }),
    setDoc(doc(firestore, "posts", "other-repost-target"), { type: "repost", authorId: "other", username: "other", originalPostId: "target-post", originalAuthorId: "target", originalUsername: "target", content: "target post", imageData: "", createdAt: new Date(0) }),
    setDoc(doc(firestore, "posts", "three-original"), { type: "original", authorId: "post_author", username: "post_author", content: "three original", imageData: "", category: "Post", options: [], createdAt: new Date(0) }),
    setDoc(doc(firestore, "communityPosts", "target-community"), { authorId: "target", username: "target", content: "target community", category: "Question", circleId: "target-circle", options: [], createdAt: new Date(0) }),
    setDoc(doc(firestore, "communityPosts", "other-in-target-circle"), { authorId: "other", username: "other", content: "other in target circle", category: "Question", circleId: "target-circle", options: [], createdAt: new Date(0) }),
    setDoc(doc(firestore, "circles", "target-circle"), { name: "Target circle", description: "", ownerId: "target", createdAt: new Date(0) }),
    setDoc(doc(firestore, "circles", "other-circle"), { name: "Other circle", description: "", ownerId: "other", createdAt: new Date(0) }),
    setDoc(doc(firestore, "circles", "three-circle"), { name: "Three circle", description: "", ownerId: "circle_owner", createdAt: new Date(0) }),
    setDoc(doc(firestore, "communityPosts", "three-community"), { authorId: "post_author", username: "post_author", content: "three principals", category: "Question", circleId: "three-circle", options: [], createdAt: new Date(0) }),
    setDoc(doc(firestore, "rooms", "target-room"), { name: "Target room", topic: "topic", ownerId: "target", createdAt: new Date(0) }),
    setDoc(doc(firestore, "rooms", "other-room"), { name: "Other room", topic: "topic", ownerId: "other", createdAt: new Date(0) }),
    setDoc(doc(firestore, "rooms", "three-room"), { name: "Three room", topic: "topic", ownerId: "room_owner", createdAt: new Date(0) }),
    setDoc(doc(firestore, "roomMessages", "three-room-message"), { roomId: "three-room", senderId: "message_author", tempName: "Author", text: "message", createdAt: new Date(0) }),
    setDoc(doc(firestore, "roomMessages", "other-in-target-room"), { roomId: "target-room", senderId: "other", tempName: "Other", text: "message", createdAt: new Date(0) }),
    setDoc(doc(firestore, "messageRequests", "member_target"), { fromId: "member", toId: "target", status: "accepted", createdAt: new Date(0) }),
    setDoc(doc(firestore, "messageRequests", "member_other"), { fromId: "member", toId: "other", status: "accepted", createdAt: new Date(0) })
  ];
  if (targetProfile) writes.push(setDoc(doc(firestore, "users", "target"), targetProfile), setDoc(doc(firestore, "usernames", "target"), { uid: "target", username: "target", createdAt: new Date(0) }));
  if (targetJob) writes.push(setDoc(doc(firestore, "adminDeletionJobs", "target"), targetJob));
  for (const [uid, barrier] of principalBarriers) writes.push(setDoc(doc(firestore, "adminDeletionJobs", uid), barrier));
  await Promise.all(writes);
});
const contentWrites = (firestore, target) => {
  const post = target ? "target-post" : "other-post"; const uid = target ? "target" : "other";
  const suffix = target ? "blocked" : "allowed"; const circle = target ? "target-circle" : "other-circle"; const room = target ? "target-room" : "other-room";
  return [
    () => setDoc(doc(firestore, "follows", `member_${uid}`), { followerId: "member", followingId: uid, createdAt: serverTimestamp() }),
    () => setDoc(doc(firestore, "directMessages", `message_${suffix}`), { participants: ["member", uid], senderId: "member", text: "hello", createdAt: serverTimestamp() }),
    () => setDoc(doc(firestore, "reveals", `member_${uid}`), { fromId: "member", toId: uid, fields: { interests: true }, status: "pending", createdAt: serverTimestamp() }),
    () => setDoc(doc(firestore, "posts", `repost_member_${post}`), { type: "repost", authorId: "member", username: "member", originalPostId: post, originalAuthorId: uid, originalUsername: uid, content: `${uid} post`, imageData: "", moderationStatus: "active", createdAt: serverTimestamp() }),
    () => setDoc(doc(firestore, "posts", post, "comments", `comment_${suffix}`), { uid: "member", username: "member", text: "comment", createdAt: serverTimestamp() }),
    () => setDoc(doc(firestore, "posts", post, "reactions", "member"), { uid: "member", type: "heart", createdAt: serverTimestamp() }),
    () => setDoc(doc(firestore, "communityVotes", `posts_${post}_member`), { postCollection: "posts", postId: post, uid: "member", option: 0, createdAt: serverTimestamp() }),
    () => setDoc(doc(firestore, "circleMembers", `${circle}_member`), { circleId: circle, uid: "member", createdAt: serverTimestamp() }),
    () => setDoc(doc(firestore, "communityPosts", `community_${suffix}`), { authorId: "member", username: "member", content: "community", category: "Question", circleId: circle, options: [], moderationStatus: "active", createdAt: serverTimestamp() }),
    () => setDoc(doc(firestore, "roomMembers", `${room}_member`), { roomId: room, uid: "member", joinedAt: serverTimestamp() }),
    () => setDoc(doc(firestore, "roomMessages", `room_${suffix}`), { roomId: room, senderId: "member", tempName: "Member", text: "hello", createdAt: serverTimestamp() })
  ];
};
const signup = (firestore, uid) => {
  const batch = writeBatch(firestore); batch.set(doc(firestore, "usernames", uid), { uid, username: uid, createdAt: serverTimestamp() });
  batch.set(doc(firestore, "users", uid), { uid, username: uid, createdAt: serverTimestamp(), lastActiveAt: serverTimestamp() });
  batch.update(doc(firestore, "system", "accountStats"), { count: 6, limit: 500, updatedAt: serverTimestamp() }); return batch.commit();
};
const rename = (firestore, uid, from, to) => {
  const batch = writeBatch(firestore);
  batch.set(doc(firestore, "usernames", to), { uid, username: to, createdAt: serverTimestamp() });
  batch.update(doc(firestore, "users", uid), { username: to });
  batch.delete(doc(firestore, "usernames", from));
  return batch.commit();
};
const threePrincipalWrites = (firestore) => [
  ["original-repost", () => setDoc(doc(firestore, "posts", "repost_member_three-original"), { type: "repost", authorId: "member", username: "member", originalPostId: "three-original", originalAuthorId: "post_author", originalUsername: "post_author", content: "three original", imageData: "", moderationStatus: "active", createdAt: serverTimestamp() })],
  ["community-comment", () => setDoc(doc(firestore, "communityPosts", "three-community", "comments", "member"), { uid: "member", username: "member", text: "comment", createdAt: serverTimestamp() })],
  ["community-reaction", () => setDoc(doc(firestore, "communityPosts", "three-community", "reactions", "member"), { uid: "member", type: "heart", createdAt: serverTimestamp() })],
  ["community-vote", () => setDoc(doc(firestore, "communityVotes", "communityPosts_three-community_member"), { postCollection: "communityPosts", postId: "three-community", uid: "member", option: 0, createdAt: serverTimestamp() })],
  ["room-comment", () => setDoc(doc(firestore, "roomMessages", "three-room-message", "comments", "member"), { uid: "member", username: "member", text: "comment", createdAt: serverTimestamp() })],
  ["room-reaction", () => setDoc(doc(firestore, "roomMessages", "three-room-message", "reactions", "member"), { uid: "member", type: "heart", createdAt: serverTimestamp() })]
];
const topLevelOwnerWrites = (firestore) => [
  ["repost", threePrincipalWrites(firestore)[0][1]],
  ["circle-membership", () => setDoc(doc(firestore, "circleMembers", "three-circle_member"), { circleId: "three-circle", uid: "member", createdAt: serverTimestamp() })],
  ["community-post", () => setDoc(doc(firestore, "communityPosts", "missing-circle-owner"), { authorId: "member", username: "member", content: "missing owner", category: "Question", circleId: "three-circle", options: [], moderationStatus: "active", createdAt: serverTimestamp() })],
  ["room-membership", () => setDoc(doc(firestore, "roomMembers", "three-room_member"), { roomId: "three-room", uid: "member", joinedAt: serverTimestamp() })],
  ["room-message", () => setDoc(doc(firestore, "roomMessages", "missing-room-owner"), { roomId: "three-room", senderId: "member", tempName: "Member", text: "missing owner", createdAt: serverTimestamp() })]
];
const assertBarrierDenial = async (operation, label) => {
  try {
    await operation();
    assert.fail(`${label} unexpectedly succeeded`);
  } catch (error) {
    assert.equal(error.code, "permission-denied", `${label} must be denied by the barrier`);
    assert.doesNotMatch(error.message, /(too many|access[- ]call|maximum.*call)/i, `${label} exceeded the access-call budget`);
  }
};
const assertAllDenied = async (operations) => {
  const unexpectedSuccesses = [];
  for (const [label, operation] of operations) {
    try {
      await operation();
      unexpectedSuccesses.push(label);
    } catch (error) {
      assert.equal(error.code, "permission-denied", `${label} must be denied`);
      assert.doesNotMatch(error.message, /(too many|access[- ]call|maximum.*call)/i, `${label} exceeded the access-call budget`);
    }
  }
  assert.deepEqual(unexpectedSuccesses, [], "missing owner profiles must deny every top-level family");
};
const barrierStates = (uid) => [
  ["queued", { targetUid: uid, requesterUid: "admin", requestedAt: new Date(1), status: "queued" }],
  ["processing", { status: "processing", phase: "second-sweep" }],
  ["completed", completedMarker],
  ["malformed", { status: "malformed" }]
];
try {
  await seed(); let member = testEnv.authenticatedContext("member").firestore();
  for (const operation of contentWrites(member, false)) await assertSucceeds(operation());
  for (const [, operation] of threePrincipalWrites(member)) await assertSucceeds(operation());
  await assertSucceeds(deleteDoc(doc(member, "messageRequests", "member_other")));
  await assertSucceeds(setDoc(doc(member, "messageRequests", "member_other"), { fromId: "member", toId: "other", status: "pending", createdAt: serverTimestamp() }));
  await assertSucceeds(rename(member, "member", "member", "member_new"));
  await assertFails(setDoc(doc(member, "usernames", "extra_member"), { uid: "member", username: "extra_member", createdAt: serverTimestamp() }));

  const other = testEnv.authenticatedContext("other").firestore();
  const postOrphanRace = writeBatch(other);
  postOrphanRace.delete(doc(other, "posts", "other-post"));
  postOrphanRace.set(doc(other, "posts", "other-post", "comments", "orphan"), { uid: "other", username: "other", text: "orphan", createdAt: serverTimestamp() });
  await assertFails(postOrphanRace.commit());
  assert.equal((await getDoc(doc(other, "posts", "other-post"))).exists(), true);
  assert.equal((await getDoc(doc(other, "posts", "other-post", "comments", "orphan"))).exists(), false);

  const circleOrphanRace = writeBatch(other);
  circleOrphanRace.delete(doc(other, "circles", "other-circle"));
  circleOrphanRace.set(doc(other, "communityPosts", "orphan-circle-post"), { authorId: "other", username: "other", content: "orphan", category: "Question", circleId: "other-circle", options: [], moderationStatus: "active", createdAt: serverTimestamp() });
  await assertFails(circleOrphanRace.commit());
  const circleMemberOrphanRace = writeBatch(other);
  circleMemberOrphanRace.delete(doc(other, "circles", "other-circle"));
  circleMemberOrphanRace.set(doc(other, "circleMembers", "other-circle_other"), { circleId: "other-circle", uid: "other", createdAt: serverTimestamp() });
  await assertFails(circleMemberOrphanRace.commit());
  assert.equal((await getDoc(doc(other, "circles", "other-circle"))).exists(), true);
  assert.equal((await getDoc(doc(other, "circleMembers", "other-circle_other"))).exists(), false);
  const roomOrphanRace = writeBatch(other);
  roomOrphanRace.delete(doc(other, "rooms", "other-room"));
  roomOrphanRace.set(doc(other, "roomMessages", "orphan-room-message"), { roomId: "other-room", senderId: "other", tempName: "Other", text: "orphan", createdAt: serverTimestamp() });
  await assertFails(roomOrphanRace.commit());
  const roomMemberOrphanRace = writeBatch(other);
  roomMemberOrphanRace.delete(doc(other, "rooms", "other-room"));
  roomMemberOrphanRace.set(doc(other, "roomMembers", "other-room_other"), { roomId: "other-room", uid: "other", joinedAt: serverTimestamp() });
  await assertFails(roomMemberOrphanRace.commit());
  assert.equal((await getDoc(doc(other, "rooms", "other-room"))).exists(), true);
  await testEnv.withSecurityRulesDisabled(async (context) => {
    assert.equal((await getDoc(doc(context.firestore(), "roomMembers", "other-room_other"))).exists(), false);
  });
  await testEnv.clearFirestore(); await seed({ targetJob: queuedJob, targetProfile: queuedProfile });
  member = testEnv.authenticatedContext("member").firestore(); const target = testEnv.authenticatedContext("target").firestore(); const admin = testEnv.authenticatedContext("admin").firestore();
  for (const operation of contentWrites(member, true)) await assertFails(operation());
  for (const parentPath of [
    ["posts", "other-repost-target"],
    ["communityPosts", "other-in-target-circle"],
    ["roomMessages", "other-in-target-room"]
  ]) {
    await assertFails(setDoc(doc(member, ...parentPath, "comments", `blocked_${parentPath[1]}`), { uid: "member", username: "member", text: "blocked", createdAt: serverTimestamp() }));
    await assertFails(setDoc(doc(member, ...parentPath, "reactions", "member"), { uid: "member", type: "heart", createdAt: serverTimestamp() }));
  }
  await assertFails(setDoc(doc(member, "communityVotes", "posts_other-repost-target_member"), { postCollection: "posts", postId: "other-repost-target", uid: "member", option: 0, createdAt: serverTimestamp() }));
  await assertSucceeds(deleteDoc(doc(member, "messageRequests", "member_target")));
  await assertFails(setDoc(doc(member, "messageRequests", "member_target"), { fromId: "member", toId: "target", status: "pending", createdAt: serverTimestamp() }));
  await assertFails(setDoc(doc(target, "posts", "target-new"), { type: "original", authorId: "target", username: "target", content: "new", imageData: "", category: "Post", options: [], createdAt: serverTimestamp() }));
  await assertFails(setDoc(doc(target, "userPreferences", "target"), { uid: "target", mutedKeywords: [], contextCheck: false, updatedAt: serverTimestamp() }));
  await assertFails(setDoc(doc(target, "userPrivate", "target"), { uid: "target", interests: "", region: "", ageRange: "", updatedAt: serverTimestamp() }));
  await assertFails(setDoc(doc(target, "notificationReads", "target_notice"), { uid: "target", reactionId: "notice", readAt: serverTimestamp() }));
  await assertFails(getDoc(doc(target, "adminDeletionJobs", "target"))); await assertFails(getDoc(doc(member, "adminDeletionJobs", "target")));
  assert.equal((await assertSucceeds(getDoc(doc(admin, "adminDeletionJobs", "target")))).exists(), true);
  await assertFails(updateDoc(doc(target, "adminDeletionJobs", "target"), { status: "failed" })); await assertFails(deleteDoc(doc(target, "adminDeletionJobs", "target")));
  await assertSucceeds(updateDoc(doc(admin, "users", "target"), { banned: true })); await assertFails(updateDoc(doc(admin, "users", "target"), { banned: false }));
  await testEnv.clearFirestore(); await seed(); await assertSucceeds(signup(testEnv.authenticatedContext("available_signup").firestore(), "available_signup"));
  for (const barrier of [
    { value: { ...queuedJob, status: "processing", phase: "profile-barrier" } },
    { value: { ...queuedJob, status: "processing", phase: "auth-deleting" } },
    { value: { ...queuedJob, status: "failed", phase: "second-sweep", errorCode: "AUTH_ERROR" } },
    { value: completedMarker },
    { value: { status: "malformed" } }
  ]) {
    await testEnv.clearFirestore(); await seed({ targetJob: barrier.value, targetProfile: null });
    await assertFails(signup(testEnv.authenticatedContext("target").firestore(), "target"));
  }
  await testEnv.clearFirestore(); await seed({ targetJob: queuedJob, targetProfile: queuedProfile });
  await testEnv.withSecurityRulesDisabled(async (context) => deleteDoc(doc(context.firestore(), "usernames", "target")));
  await assertFails(setDoc(doc(testEnv.authenticatedContext("target").firestore(), "usernames", "target"), { uid: "target", username: "target", createdAt: serverTimestamp() }));

  await testEnv.clearFirestore(); await seed();
  await testEnv.withSecurityRulesDisabled(async (context) => Promise.all([
    deleteDoc(doc(context.firestore(), "users", "post_author")),
    deleteDoc(doc(context.firestore(), "users", "circle_owner")),
    deleteDoc(doc(context.firestore(), "users", "room_owner"))
  ]));
  await assertAllDenied(topLevelOwnerWrites(testEnv.authenticatedContext("member").firestore()));

  for (const principal of ["post_author", "circle_owner", "message_author", "room_owner"]) {
    for (const [state, barrier] of barrierStates(principal)) {
      await testEnv.clearFirestore();
      await seed({ principalBarriers: [[principal, barrier]] });
      const actor = testEnv.authenticatedContext("member").firestore();
      const relevant = threePrincipalWrites(actor).filter(([name]) => {
        if (principal === "post_author") return name === "original-repost" || name.startsWith("community-");
        if (principal === "circle_owner") return name.startsWith("community-");
        return name.startsWith("room-");
      });
      for (const [name, operation] of relevant) await assertBarrierDenial(operation, `${principal}-${state}-${name}`);
    }
  }
  console.log("Firestore administrator deletion availability barrier passed");
} finally { await testEnv.cleanup(); }
