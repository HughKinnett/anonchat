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
const seed = async ({ targetJob = null, targetProfile = profile("target") } = {}) => testEnv.withSecurityRulesDisabled(async (context) => {
  const firestore = context.firestore();
  const writes = [
    setDoc(doc(firestore, "users", "admin"), profile("admin", "i_love_you_h")),
    setDoc(doc(firestore, "usernames", "i_love_you_h"), { uid: "admin", username: "i_love_you_h", createdAt: new Date(0) }),
    setDoc(doc(firestore, "users", "member"), profile("member")), setDoc(doc(firestore, "users", "other"), profile("other")),
    setDoc(doc(firestore, "usernames", "member"), { uid: "member", username: "member", createdAt: new Date(0) }),
    setDoc(doc(firestore, "usernames", "other"), { uid: "other", username: "other", createdAt: new Date(0) }),
    setDoc(doc(firestore, "system", "accountStats"), { count: 5, limit: 500, updatedAt: new Date(0) }),
    setDoc(doc(firestore, "posts", "target-post"), { type: "original", authorId: "target", username: "target", content: "target post", imageData: "", category: "Post", options: [], createdAt: new Date(0) }),
    setDoc(doc(firestore, "posts", "other-post"), { type: "original", authorId: "other", username: "other", content: "other post", imageData: "", category: "Post", options: [], createdAt: new Date(0) }),
    setDoc(doc(firestore, "communityPosts", "target-community"), { authorId: "target", username: "target", content: "target community", category: "Question", circleId: "target-circle", options: [], createdAt: new Date(0) }),
    setDoc(doc(firestore, "circles", "target-circle"), { name: "Target circle", description: "", ownerId: "target", createdAt: new Date(0) }),
    setDoc(doc(firestore, "circles", "other-circle"), { name: "Other circle", description: "", ownerId: "other", createdAt: new Date(0) }),
    setDoc(doc(firestore, "rooms", "target-room"), { name: "Target room", topic: "topic", ownerId: "target", createdAt: new Date(0) }),
    setDoc(doc(firestore, "rooms", "other-room"), { name: "Other room", topic: "topic", ownerId: "other", createdAt: new Date(0) }),
    setDoc(doc(firestore, "messageRequests", "member_target"), { fromId: "member", toId: "target", status: "accepted", createdAt: new Date(0) }),
    setDoc(doc(firestore, "messageRequests", "member_other"), { fromId: "member", toId: "other", status: "accepted", createdAt: new Date(0) })
  ];
  if (targetProfile) writes.push(setDoc(doc(firestore, "users", "target"), targetProfile), setDoc(doc(firestore, "usernames", "target"), { uid: "target", username: "target", createdAt: new Date(0) }));
  if (targetJob) writes.push(setDoc(doc(firestore, "adminDeletionJobs", "target"), targetJob));
  await Promise.all(writes);
});
const contentWrites = (firestore, target) => {
  const post = target ? "target-post" : "other-post"; const uid = target ? "target" : "other";
  const suffix = target ? "blocked" : "allowed"; const circle = target ? "target-circle" : "other-circle"; const room = target ? "target-room" : "other-room";
  return [
    () => setDoc(doc(firestore, "follows", `member_${uid}`), { followerId: "member", followingId: uid, createdAt: serverTimestamp() }),
    () => setDoc(doc(firestore, "directMessages", `message_${suffix}`), { participants: ["member", uid], senderId: "member", text: "hello", createdAt: serverTimestamp() }),
    () => setDoc(doc(firestore, "reveals", `member_${uid}`), { fromId: "member", toId: uid, fields: { interests: true }, status: "pending", createdAt: serverTimestamp() }),
    () => setDoc(doc(firestore, "posts", `repost_member_${post}`), { type: "repost", authorId: "member", username: "member", originalPostId: post, originalAuthorId: uid, originalUsername: uid, content: `${uid} post`, imageData: "", createdAt: serverTimestamp() }),
    () => setDoc(doc(firestore, "posts", post, "comments", `comment_${suffix}`), { uid: "member", username: "member", text: "comment", createdAt: serverTimestamp() }),
    () => setDoc(doc(firestore, "posts", post, "reactions", "member"), { uid: "member", type: "heart", createdAt: serverTimestamp() }),
    () => setDoc(doc(firestore, "communityVotes", `${post}_member`), { postId: post, uid: "member", option: 0, createdAt: serverTimestamp() }),
    () => setDoc(doc(firestore, "circleMembers", `${circle}_member`), { circleId: circle, uid: "member", createdAt: serverTimestamp() }),
    () => setDoc(doc(firestore, "communityPosts", `community_${suffix}`), { authorId: "member", username: "member", content: "community", category: "Question", circleId: circle, options: [], createdAt: serverTimestamp() }),
    () => setDoc(doc(firestore, "roomMembers", `${room}_member`), { roomId: room, uid: "member", joinedAt: serverTimestamp() }),
    () => setDoc(doc(firestore, "roomMessages", `room_${suffix}`), { roomId: room, senderId: "member", tempName: "Member", text: "hello", createdAt: serverTimestamp() })
  ];
};
const signup = (firestore, uid) => {
  const batch = writeBatch(firestore); batch.set(doc(firestore, "usernames", uid), { uid, username: uid, createdAt: serverTimestamp() });
  batch.set(doc(firestore, "users", uid), { uid, username: uid, createdAt: serverTimestamp(), lastActiveAt: serverTimestamp() });
  batch.update(doc(firestore, "system", "accountStats"), { count: 6, limit: 500, updatedAt: serverTimestamp() }); return batch.commit();
};
try {
  await seed(); let member = testEnv.authenticatedContext("member").firestore();
  for (const operation of contentWrites(member, false)) await assertSucceeds(operation());
  await assertSucceeds(deleteDoc(doc(member, "messageRequests", "member_other")));
  await assertSucceeds(setDoc(doc(member, "messageRequests", "member_other"), { fromId: "member", toId: "other", status: "pending", createdAt: serverTimestamp() }));
  await testEnv.clearFirestore(); await seed({ targetJob: queuedJob, targetProfile: queuedProfile });
  member = testEnv.authenticatedContext("member").firestore(); const target = testEnv.authenticatedContext("target").firestore(); const admin = testEnv.authenticatedContext("admin").firestore();
  for (const operation of contentWrites(member, true)) await assertFails(operation());
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
  for (const barrier of [{ value: { ...queuedJob, status: "processing", phase: "profile-barrier" } }, { value: completedMarker }]) {
    await testEnv.clearFirestore(); await seed({ targetJob: barrier.value, targetProfile: null });
    await assertFails(signup(testEnv.authenticatedContext("target").firestore(), "target"));
  }
  await testEnv.clearFirestore(); await seed({ targetJob: queuedJob, targetProfile: queuedProfile });
  await testEnv.withSecurityRulesDisabled(async (context) => deleteDoc(doc(context.firestore(), "usernames", "target")));
  await assertFails(setDoc(doc(testEnv.authenticatedContext("target").firestore(), "usernames", "target"), { uid: "target", username: "target", createdAt: serverTimestamp() }));
  console.log("Firestore administrator deletion availability barrier passed");
} finally { await testEnv.cleanup(); }
