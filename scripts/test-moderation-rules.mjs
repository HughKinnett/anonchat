import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, onSnapshot, query, serverTimestamp, setDoc, updateDoc, where, writeBatch } from "firebase/firestore";
import { createModerationClient } from "../moderation-client.mjs";

const testEnv = await initializeTestEnvironment({
  projectId: "anonchat-moderation-rules-test",
  firestore: { rules: await readFile(new URL("../firestore.rules", import.meta.url), "utf8") }
});

const profile = (uid, username = uid) => ({ uid, username, banned: false, createdAt: new Date(0), lastActiveAt: new Date(0) });
const intake = (overrides = {}) => ({
  reporterUid: "reporter", targetKind: "post", targetCollection: "posts", targetId: "post-1",
  targetPath: "posts/post-1", reportedUserId: "author", reason: "harassment",
  createdAt: serverTimestamp(), status: "queued", ...overrides
});
const writeReport = async (db, payload) => {
  const batch = writeBatch(db);
  batch.set(doc(db, "reportIntakes", `${payload.reporterUid}_${payload.targetKind}_${payload.targetId}`), payload);
  batch.set(doc(db, "reportReceipts", payload.reporterUid, payload.targetKind, payload.targetId), {
    reporterUid: payload.reporterUid, targetKind: payload.targetKind, targetId: payload.targetId, createdAt: payload.createdAt
  });
  await batch.commit();
};
const originalPost = (overrides = {}) => ({
  type: "original", authorId: "reporter", username: "reporter", content: "visible", imageData: "", category: "Post", options: [], expiresAt: null, moderationState: "visible", createdAt: serverTimestamp(), ...overrides
});
const communityPost = (overrides = {}) => ({
  authorId: "reporter", username: "reporter", content: "visible", category: "Question", circleId: "circle-1", options: [], moderationState: "visible", createdAt: serverTimestamp(), ...overrides
});
const repost = (originalPostId = "post-1", overrides = {}) => ({
  type: "repost", authorId: "reporter", username: "reporter", sourceCollection: "posts", originalPostId, originalAuthorId: "author", originalUsername: "author", content: "reportable", imageData: "", moderationState: "visible", createdAt: serverTimestamp(), ...overrides
});
const withoutModerationState = ({ moderationState, ...record }) => record;
const roomExpiry = new Date(Date.now() + 86_400_000);
const seed = () => testEnv.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore();
  await Promise.all([
    setDoc(doc(db, "users", "reporter"), profile("reporter")),
    setDoc(doc(db, "users", "author"), profile("author")),
    setDoc(doc(db, "users", "stranger"), profile("stranger")),
    setDoc(doc(db, "users", "admin"), profile("admin", "i_love_you_h")),
    setDoc(doc(db, "users", "admin-two"), profile("admin-two", "CyberCapone")),
    setDoc(doc(db, "circles", "circle-1"), { ownerId: "reporter" }),
    setDoc(doc(db, "usernames", "i_love_you_h"), { uid: "admin", username: "i_love_you_h" }),
    setDoc(doc(db, "usernames", "cybercapone"), { uid: "admin-two", username: "CyberCapone" }),
    setDoc(doc(db, "posts", "post-1"), { type: "original", authorId: "author", username: "author", content: "reportable", imageData: "", category: "Post", options: [], createdAt: new Date(0) }),
    setDoc(doc(db, "posts", "post-2"), { type: "original", authorId: "author", username: "author", content: "reportable", imageData: "", category: "Post", options: [], createdAt: new Date(0) }),
    setDoc(doc(db, "posts", "post-3"), { type: "original", authorId: "author", username: "author", content: "reportable", imageData: "", category: "Post", options: [], createdAt: new Date(0) }),
    setDoc(doc(db, "communityPosts", "community-1"), { authorId: "author", username: "author", content: "reportable", category: "Question", circleId: "circle-1", options: [], createdAt: new Date(0) }),
    setDoc(doc(db, "rooms", "room-1"), { ownerId: "author", name: "Visible room", topic: "visible", expiresAt: roomExpiry, moderationState: "visible", createdAt: new Date(0) }),
    setDoc(doc(db, "rooms", "hidden-room"), { ownerId: "author", name: "Hidden room", topic: "hidden", expiresAt: roomExpiry, moderationState: "hidden", createdAt: new Date(0) }),
    setDoc(doc(db, "roomMessages", "visible-message-hidden-room"), { roomId: "hidden-room", senderId: "author", tempName: "Author", text: "visible child", expiresAt: roomExpiry, moderationState: "visible", createdAt: new Date(0) }),
    setDoc(doc(db, "roomMembers", "hidden-room_stranger"), { roomId: "hidden-room", uid: "stranger", joinedAt: new Date(0) }),
    setDoc(doc(db, "roomMembers", "room-1_stranger"), { roomId: "room-1", uid: "stranger", joinedAt: new Date(0) }),
    setDoc(doc(db, "roomMessages", "message-1"), { roomId: "room-1", senderId: "author", tempName: "Author", text: "reportable", expiresAt: roomExpiry, moderationState: "visible", createdAt: new Date(0) }),
    setDoc(doc(db, "moderationCases", "case-post-1"), { targetKind: "post", targetId: "post-1", status: "open", createdAt: new Date(0) }),
    setDoc(doc(db, "moderationCases", "case-post-1", "reports", "reporter_post_post-1"), { reporterUid: "reporter", reason: "harassment", createdAt: new Date(0) }),
    setDoc(doc(db, "moderationCases", "case-post-1", "evidence", "media"), { items: [{ kind: "postImage", dataUrl: "data:image/jpeg;base64,AAAA" }] }),
    setDoc(doc(db, "legacyRoomQuarantine", "legacy-room"), { roomId: "legacy-room", status: "quarantined", policy: "cleanup-after-grace" }),
    setDoc(doc(db, "legacyRoomQuarantine", "legacy-manual"), { roomId: "legacy-manual", status: "manualReview", policy: "cleanup-after-grace" })
  ]);
});

try {
  await seed();
  const reporter = testEnv.authenticatedContext("reporter").firestore();
  const author = testEnv.authenticatedContext("author").firestore();
  const stranger = testEnv.authenticatedContext("stranger").firestore();
  const admin = testEnv.authenticatedContext("admin").firestore();
  const adminTwo = testEnv.authenticatedContext("admin-two").firestore();
  const unauthenticated = testEnv.unauthenticatedContext().firestore();
  const intakeRef = doc(reporter, "reportIntakes", "reporter_post_post-1");
  const missingReceipt = doc(reporter, "reportReceipts", "reporter", "post", "post-3");

  assert.equal((await assertSucceeds(getDoc(missingReceipt))).exists(), false, "an authenticated reporter can safely read a missing canonical receipt");
  const missingListen = await new Promise((resolve, reject) => {
    let unsubscribe = () => {};
    unsubscribe = onSnapshot(missingReceipt, (snapshot) => { unsubscribe(); resolve(snapshot); }, reject);
  });
  assert.equal(missingListen.exists(), false, "a canonical missing-receipt listener receives its initial snapshot");
  await assertFails(getDoc(doc(stranger, "reportReceipts", "reporter", "post", "post-3")));
  await assertFails(getDoc(doc(reporter, "reportReceipts", "reporter", "malformed", "post-3")));
  await assertFails(getDoc(doc(reporter, "reportReceipts", "reporter", "post", "missing-target")), "a noncanonical target path remains denied");
  await assertFails(getDocs(collection(reporter, "reportReceipts", "reporter", "post")), "receipt enumeration remains forbidden");
  const actualClient = createModerationClient({
    db: reporter, firestore: { deleteDoc, doc, getDoc, setDoc, writeBatch }, currentUid: "reporter", timestamp: serverTimestamp
  });
  await assertSucceeds(actualClient.report({ targetKind: "post", targetCollection: "posts", targetId: "post-2", reportedUserId: "author" }, "harassment"));
  assert.equal((await assertSucceeds(getDoc(doc(reporter, "reportReceipts", "reporter", "post", "post-2")))).exists(), true, "the actual client batch creates its private receipt");
  actualClient.destroy();
  await assertFails(setDoc(doc(reporter, "reportReceipts", "reporter", "post", "forged"), {
    reporterUid: "reporter", targetKind: "post", targetId: "forged", createdAt: serverTimestamp()
  }), "a receipt cannot be forged without its exact intake in the same committed state");
  await assertFails(setDoc(intakeRef, intake()), "an intake cannot be created without its exact private receipt in the same batch");
  const mismatchedBatch = writeBatch(reporter), mismatchedIntake = intake({ targetId: "post-3", targetPath: "posts/post-3" });
  mismatchedBatch.set(doc(reporter, "reportIntakes", "reporter_post_post-3"), mismatchedIntake);
  mismatchedBatch.set(doc(reporter, "reportReceipts", "reporter", "post", "post-3"), {
    reporterUid: "reporter", targetKind: "post", targetId: "post-2", createdAt: mismatchedIntake.createdAt
  });
  await assertFails(mismatchedBatch.commit(), "an atomic receipt with forged target metadata cannot authorize its intake");
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "reportIntakes", "reporter_post_post-3"), intake({ targetId: "post-3", targetPath: "posts/post-3" }));
  });
  await assertFails(setDoc(doc(reporter, "reportReceipts", "reporter", "post", "post-3"), {
    reporterUid: "reporter", targetKind: "post", targetId: "post-3", createdAt: serverTimestamp()
  }), "a pre-existing intake cannot authorize a later receipt write");

  for (const [collectionName, payload] of [["posts", originalPost], ["communityPosts", communityPost]]) {
    await assertSucceeds(setDoc(doc(reporter, collectionName, `visible-${collectionName}`), payload()));
    await assertFails(setDoc(doc(reporter, collectionName, `missing-${collectionName}`), withoutModerationState(payload())));
    await assertFails(setDoc(doc(reporter, collectionName, `hidden-${collectionName}`), payload({ moderationState: "hidden" })));
    await assertFails(setDoc(doc(reporter, collectionName, `invalid-${collectionName}`), payload({ moderationState: "invalid" })));
  }
  await assertFails(setDoc(doc(reporter, "posts", "repost_reporter_post-1"), repost("post-1", { sourceCollection: "communityPosts" })));
  await assertFails(setDoc(doc(reporter, "posts", "repost_reporter_post-1"), repost("post-1", { sourceCollection: "roomMessages" })));
  await assertSucceeds(setDoc(doc(reporter, "posts", "repost_reporter_post-1"), repost()));
  await assertFails(setDoc(doc(reporter, "posts", "repost_reporter_post-2"), withoutModerationState(repost("post-2"))));
  await assertFails(setDoc(doc(reporter, "posts", "repost_reporter_post-3"), repost("post-3", { moderationState: "hidden" })));

  await assertSucceeds(writeReport(reporter, intake()));
  assert.equal((await assertSucceeds(getDoc(intakeRef))).data().reporterUid, "reporter");
  await assertSucceeds(writeReport(reporter, intake({
    targetKind: "communityPost", targetCollection: "communityPosts", targetId: "community-1",
    targetPath: "communityPosts/community-1"
  })));
  await assertSucceeds(writeReport(reporter, intake({
    targetKind: "roomMessage", targetCollection: "roomMessages", targetId: "message-1",
    targetPath: "roomMessages/message-1"
  })));
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await updateDoc(doc(context.firestore(), "rooms", "room-1"), { cleanupState: "closing" });
  });
  await assertFails(setDoc(doc(stranger, "reportIntakes", "stranger_roomMessage_message-1"), intake({
    reporterUid: "stranger", targetKind: "roomMessage", targetCollection: "roomMessages", targetId: "message-1",
    targetPath: "roomMessages/message-1"
  })), "room closing fences late report intake creation");
  await assertSucceeds(writeReport(reporter, intake({
    targetKind: "user", targetCollection: "users", targetId: "author", targetPath: "users/author"
  })));
  await assertFails(getDoc(doc(author, "reportIntakes", "reporter_post_post-1")));
  await assertFails(getDoc(doc(unauthenticated, "reportIntakes", "reporter_post_post-1")));
  await assertFails(updateDoc(intakeRef, { reason: "other" }));
  await assertFails(deleteDoc(intakeRef));
  const receiptRef = doc(reporter, "reportReceipts", "reporter", "post", "post-1");
  await assertFails(updateDoc(receiptRef, { targetId: "post-3" }));
  await assertFails(deleteDoc(receiptRef));

  for (const [label, forged] of [
    ["path", intake({ targetPath: "users/author" })],
    ["reported uid", intake({ reportedUserId: "stranger" })],
    ["reason", intake({ reason: "forged" })],
    ["client timestamp", intake({ createdAt: new Date(0) })],
    ["status", intake({ status: "processed" })],
    ["self", intake({ reportedUserId: "reporter" })]
  ]) {
    await assertFails(setDoc(doc(reporter, "reportIntakes", `reporter_post_post-1-${label}`), forged));
  }
  await assertFails(setDoc(doc(reporter, "reportIntakes", "reporter_user_reporter"), intake({
    targetKind: "user", targetCollection: "users", targetId: "reporter", targetPath: "users/reporter", reportedUserId: "reporter"
  })));
  await assertFails(setDoc(doc(reporter, "reportIntakes", "reporter_post_missing"), intake({ targetId: "missing", targetPath: "posts/missing" })));
  await assertFails(setDoc(doc(reporter, "reportIntakes", "reporter_post_post-1"), intake()));

  await assertFails(getDocs(collection(stranger, "reportIntakes")));
  await assertFails(getDoc(doc(stranger, "moderationCases", "case-post-1")));
  await assertFails(getDoc(doc(stranger, "moderationCases", "case-post-1", "reports", "reporter_post_post-1")));
  await assertFails(getDocs(collection(stranger, "moderationActions")));
  await assertSucceeds(getDoc(doc(admin, "reportIntakes", "reporter_post_post-1")));
  await assertSucceeds(getDoc(doc(admin, "moderationCases", "case-post-1")));
  await assertSucceeds(getDoc(doc(admin, "moderationCases", "case-post-1", "reports", "reporter_post_post-1")));
  await assertSucceeds(getDoc(doc(admin, "moderationCases", "case-post-1", "evidence", "media")));
  await assertFails(getDoc(doc(stranger, "moderationCases", "case-post-1", "evidence", "media")));
  await assertSucceeds(getDoc(doc(admin, "legacyRoomQuarantine", "legacy-room")));
  await assertFails(getDoc(doc(stranger, "legacyRoomQuarantine", "legacy-room")));
  await assertFails(setDoc(doc(admin, "legacyRoomQuarantine", "forged"), { status: "cleaned" }));
  for (const action of ["retryCleanup", "approveCleanup", "release"]) await assertSucceeds(setDoc(doc(admin, "legacyRoomActions", action), {
    roomId: "legacy-manual", action, requestedAt: serverTimestamp(), requestedBy: "admin", status: "queued"
  }));
  await assertFails(setDoc(doc(stranger, "legacyRoomActions", "stranger"), { roomId: "legacy-manual", action: "release", requestedAt: serverTimestamp(), requestedBy: "stranger", status: "queued" }));
  await assertFails(setDoc(doc(admin, "legacyRoomActions", "not-terminal"), { roomId: "legacy-room", action: "release", requestedAt: serverTimestamp(), requestedBy: "admin", status: "queued" }));
  await assertFails(setDoc(doc(admin, "legacyRoomActions", "forged"), { roomId: "legacy-manual", action: "release", requestedAt: serverTimestamp(), requestedBy: "admin", status: "queued", leaseToken: "forged" }));
  await assertFails(setDoc(doc(admin, "moderationActions", "case-post-1"), {
    action: "restore", requestedAt: serverTimestamp(), requestedBy: "admin", status: "queued", leaseOwner: "forged"
  }));
  await assertSucceeds(setDoc(doc(admin, "moderationActions", "case-post-1"), {
    action: "restore", requestedAt: serverTimestamp(), requestedBy: "admin", status: "queued"
  }));
  await assertSucceeds(getDocs(collection(admin, "moderationActions")));
  await assertFails(updateDoc(doc(admin, "moderationActions", "case-post-1"), { status: "leased" }));
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await Promise.all([
      setDoc(doc(db, "moderationCases", "terminal-retry"), { targetKind: "post", targetId: "post-1", status: "open" }),
      setDoc(doc(db, "moderationCases", "retryable-failure"), { targetKind: "post", targetId: "post-1", status: "open" }),
      setDoc(doc(db, "moderationCases", "active-action"), { targetKind: "post", targetId: "post-1", status: "open" }),
      setDoc(doc(db, "moderationCases", "successful-action"), { targetKind: "post", targetId: "post-1", status: "open" }),
      setDoc(doc(db, "moderationActions", "terminal-retry"), { action: "restore", requestedAt: new Date(0), requestedBy: "original-admin", status: "failed", attempts: 8, errorCode: "PROCESSOR_FAILURE" }),
      setDoc(doc(db, "moderationActions", "terminal-settled-retry"), { action: "restore", requestedAt: new Date(0), requestedBy: "original-admin", status: "terminal", attempts: 8, errorCode: "PROCESSOR_FAILURE", terminalSettledAt: new Date(0) }),
      setDoc(doc(db, "moderationCases", "terminal-settled-retry"), { targetKind: "post", targetId: "post-1", status: "expiredEvidence" }),
      setDoc(doc(db, "moderationActions", "retryable-failure"), { action: "restore", requestedAt: new Date(0), requestedBy: "original-admin", status: "failed", attempts: 7, errorCode: "PROCESSOR_FAILURE" }),
      setDoc(doc(db, "moderationActions", "active-action"), { action: "restore", requestedAt: new Date(0), requestedBy: "original-admin", status: "processing", attempts: 8 }),
      setDoc(doc(db, "moderationActions", "successful-action"), { action: "restore", requestedAt: new Date(0), requestedBy: "original-admin", status: "completed", attempts: 8 }),
      setDoc(doc(db, "moderationActions", "missing-case-retry"), { action: "restore", requestedAt: new Date(0), requestedBy: "original-admin", status: "terminal", attempts: 8, errorCode: "MISSING_CASE" })
    ]);
  });
  const retry = (overrides = {}) => ({ action: "restore", requestedAt: serverTimestamp(), requestedBy: "original-admin", status: "queued", ...overrides });
  await assertSucceeds(setDoc(doc(admin, "moderationActions", "terminal-retry"), retry()));
  await assertSucceeds(setDoc(doc(adminTwo, "moderationActions", "terminal-settled-retry"), retry()));
  assert.equal((await getDoc(doc(adminTwo, "moderationActions", "terminal-settled-retry"))).data().requestedBy, "original-admin");
  await assertFails(setDoc(doc(admin, "moderationActions", "retryable-failure"), retry()));
  await assertFails(setDoc(doc(admin, "moderationActions", "active-action"), retry()));
  await assertFails(setDoc(doc(admin, "moderationActions", "successful-action"), retry()));
  await assertFails(setDoc(doc(admin, "moderationActions", "missing-case-retry"), retry()));
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "moderationActions", "terminal-retry"), { action: "restore", requestedAt: new Date(0), requestedBy: "original-admin", status: "failed", attempts: 8 });
  });
  await assertFails(setDoc(doc(admin, "moderationActions", "terminal-retry"), retry({ action: "deleteMaterial" })));
  await assertFails(setDoc(doc(admin, "moderationActions", "terminal-retry"), retry({ requestedBy: "admin" })));
  await assertFails(setDoc(doc(admin, "moderationActions", "terminal-retry"), retry({ attempts: 0 })));
  await assertFails(setDoc(doc(stranger, "moderationActions", "case-post-1"), {
    action: "restore", requestedAt: serverTimestamp(), requestedBy: "stranger", status: "queued"
  }));
  await assertFails(setDoc(doc(admin, "moderationCases", "forged"), { status: "open" }));
  await assertFails(setDoc(doc(stranger, "moderationCases", "case-post-1", "reports", "forged"), { reporterUid: "stranger" }));
  await assertFails(deleteDoc(doc(admin, "posts", "post-2")));
  const deletionTime = serverTimestamp(), deletionBatch = writeBatch(admin);
  deletionBatch.set(doc(admin, "moderationCases", "post_post-2"), {
    targetKind: "post", targetCollection: "posts", targetId: "post-2", targetPath: "posts/post-2", reportedUserId: "author",
    snapshot: { kind: "queuedAdminDeletion" }, status: "deleteQueued", reportCount: 0, reasonTotals: {}, createdAt: deletionTime, updatedAt: deletionTime
  });
  deletionBatch.set(doc(admin, "moderationActions", "post_post-2"), { action: "deleteMaterial", requestedAt: deletionTime, requestedBy: "admin", status: "queued" });
  await assertSucceeds(deletionBatch.commit());
  assert.equal((await getDoc(doc(admin, "moderationCases", "post_post-2"))).data().status, "deleteQueued");
  await testEnv.withSecurityRulesDisabled(async (context) => setDoc(doc(context.firestore(), "moderationCases", "post_post-3"), {
    targetKind: "post", targetCollection: "posts", targetId: "post-3", targetPath: "posts/post-3", reportedUserId: "author",
    snapshot: { kind: "post" }, status: "restored", reportCount: 1, reasonTotals: { other: 1 }, createdAt: new Date(0), updatedAt: new Date(0)
  }));
  await assertSucceeds(setDoc(doc(admin, "moderationActions", "post_post-3"), {
    action: "deleteMaterial", requestedAt: serverTimestamp(), requestedBy: "admin", status: "queued"
  }), "an existing canonical case accepts an action-only general deletion queue");

  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "posts", "hidden-post"), { type: "original", authorId: "author", username: "author", content: "hidden", imageData: "", category: "Post", options: [], moderationState: "hidden", createdAt: new Date(0) });
    await setDoc(doc(context.firestore(), "communityPosts", "hidden-community"), { authorId: "author", username: "author", content: "hidden", category: "Question", circleId: "circle-1", options: [], moderationState: "hidden", createdAt: new Date(0) });
    await setDoc(doc(context.firestore(), "roomMessages", "hidden-message"), { roomId: "room-1", senderId: "author", tempName: "Author", text: "hidden", expiresAt: new Date(Date.now() + 86_400_000), moderationState: "hidden", createdAt: new Date(0) });
    await setDoc(doc(context.firestore(), "communityVotes", "post-1_author"), { postId: "post-1", uid: "author", option: 0, createdAt: new Date(0) });
    await setDoc(doc(context.firestore(), "communityVotes", "hidden-post_author"), { postId: "hidden-post", uid: "author", option: 0, createdAt: new Date(0) });
    await setDoc(doc(context.firestore(), "communityVotes", "community-1_author"), { postId: "community-1", uid: "author", option: 0, createdAt: new Date(0) });
    await setDoc(doc(context.firestore(), "communityVotes", "hidden-community_author"), { postId: "hidden-community", uid: "author", option: 0, createdAt: new Date(0) });
  });
  for (const path of [["posts", "hidden-post"], ["communityPosts", "hidden-community"], ["rooms", "hidden-room"], ["roomMessages", "hidden-message"]]) {
    await assertFails(getDoc(doc(stranger, ...path)));
    await assertSucceeds(getDoc(doc(admin, ...path)));
  }
  await assertSucceeds(getDoc(doc(stranger, "communityVotes", "community-1_author")));
  await assertFails(getDoc(doc(stranger, "communityVotes", "post-1_author")));
  await assertFails(getDoc(doc(stranger, "communityVotes", "hidden-post_author")));
  await assertFails(getDoc(doc(stranger, "communityVotes", "hidden-community_author")));
  await assertSucceeds(getDoc(doc(admin, "communityVotes", "hidden-community_author")));
  await assertFails(getDocs(collection(stranger, "communityVotes")));
  const visibleVotes = await assertSucceeds(getDocs(query(
    collection(stranger, "communityVotes"),
    where("postId", "in", ["community-1"])
  )));
  assert.deepEqual(visibleVotes.docs.map((entry) => entry.id), ["community-1_author"]);
  await assertSucceeds(getDocs(collection(admin, "communityVotes")));

  const comment = { uid: "stranger", username: "stranger", text: "direct api", createdAt: serverTimestamp() };
  const reaction = { uid: "stranger", type: "heart", createdAt: serverTimestamp() };
  await assertSucceeds(setDoc(doc(stranger, "posts", "post-1", "comments", "visible-control"), comment));
  await assertSucceeds(setDoc(doc(stranger, "posts", "post-1", "reactions", "stranger"), reaction));
  await assertSucceeds(setDoc(doc(reporter, "roomMembers", "room-1_reporter"), { roomId: "room-1", uid: "reporter", joinedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(stranger, "roomMembers", "room-1_stranger"), { joinedAt: serverTimestamp() }));
  await assertSucceeds(setDoc(doc(stranger, "roomMessages", "visible-room-direct"), {
    roomId: "room-1", senderId: "stranger", tempName: "Stranger", text: "direct api",
    expiresAt: roomExpiry, moderationState: "visible", createdAt: serverTimestamp()
  }));
  await assertSucceeds(setDoc(doc(stranger, "roomMessages", "message-1", "comments", "visible-control"), comment));
  await assertSucceeds(setDoc(doc(stranger, "roomMessages", "message-1", "reactions", "stranger"), reaction));
  for (const parent of [["posts", "hidden-post"], ["communityPosts", "hidden-community"], ["roomMessages", "hidden-message"]]) {
    await assertFails(setDoc(doc(stranger, ...parent, "comments", "direct-api"), comment));
    await assertFails(setDoc(doc(stranger, ...parent, "reactions", "stranger"), reaction));
  }
  await assertFails(setDoc(doc(stranger, "roomMembers", "hidden-room_new"), { roomId: "hidden-room", uid: "stranger", joinedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(stranger, "roomMembers", "hidden-room_stranger"), { joinedAt: serverTimestamp() }));
  await assertFails(setDoc(doc(stranger, "roomMessages", "hidden-room-direct"), {
    roomId: "hidden-room", senderId: "stranger", tempName: "Stranger", text: "direct api",
    expiresAt: new Date(Date.now() + 86_400_000), moderationState: "visible", createdAt: serverTimestamp()
  }));
  await assertFails(setDoc(doc(stranger, "roomMessages", "visible-message-hidden-room", "comments", "direct-api"), comment));
  await assertFails(setDoc(doc(stranger, "roomMessages", "visible-message-hidden-room", "reactions", "stranger"), reaction));
  await assertSucceeds(setDoc(doc(stranger, "communityVotes", "community-1_stranger"), { postId: "community-1", uid: "stranger", option: 0, createdAt: serverTimestamp() }));
  await assertFails(setDoc(doc(stranger, "communityVotes", "hidden-community_stranger"), { postId: "hidden-community", uid: "stranger", option: 0, createdAt: serverTimestamp() }));
  await assertFails(setDoc(doc(stranger, "communityVotes", "hidden-post_stranger"), { postId: "hidden-post", uid: "stranger", option: 0, createdAt: serverTimestamp() }));
  console.log("Firestore moderation authorization passed");
} finally {
  await testEnv.cleanup();
}
