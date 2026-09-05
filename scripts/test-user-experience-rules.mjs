import { readFile } from "node:fs/promises";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";

const testEnv = await initializeTestEnvironment({
  projectId: "anonchat-user-experience-rules-test",
  firestore: { rules: await readFile(new URL("../firestore.rules", import.meta.url), "utf8") }
});

const profile = (uid, username = uid.replaceAll("-", "_")) => ({
  uid, username, createdAt: new Date(0), lastActiveAt: new Date(0), banned: false
});

const seed = async () => testEnv.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore();
  await Promise.all([
    setDoc(doc(db, "users", "user-a"), profile("user-a", "alpha_user")),
    setDoc(doc(db, "users", "user-b"), profile("user-b", "beta_user")),
    setDoc(doc(db, "users", "user-c"), profile("user-c", "gamma_user")),
    setDoc(doc(db, "users", "admin-user"), profile("admin-user", "i_love_you_h")),
    setDoc(doc(db, "posts", "post-a"), { type: "original", authorId: "user-a", username: "alpha_user", content: "hello #testing", imageData: "", category: "Post", options: [], moderationState: "visible", createdAt: new Date(0) }),
    setDoc(doc(db, "posts", "post-a", "comments", "comment-b"), { uid: "user-b", username: "beta_user", text: "comment", createdAt: new Date(0) }),
    setDoc(doc(db, "messageRequests", "user-a_user-b"), { fromId: "user-a", toId: "user-b", status: "accepted", createdAt: new Date(0), respondedAt: new Date(0) }),
    setDoc(doc(db, "messageRequests", "user-a_user-b", "messages", "message-a"), { participants: ["user-a", "user-b"], senderId: "user-a", encrypted: true, cipherVersion: 1, bodyCipher: { iv: "AA==", ciphertext: "AA==" }, createdAt: new Date(Date.now() - 60_000) }),
    setDoc(doc(db, "siteSettings", "userExperience"), { badgesEnabled: true, editingEnabled: true, galleriesEnabled: true, discoveryEnabled: true, groupChatsEnabled: true, notificationControlsEnabled: true })
  ]);
});

try {
  await seed();
  const userA = testEnv.authenticatedContext("user-a", { email_verified: true }).firestore();
  const userB = testEnv.authenticatedContext("user-b", { email_verified: true }).firestore();
  const userC = testEnv.authenticatedContext("user-c", { email_verified: true }).firestore();
  const admin = testEnv.authenticatedContext("admin-user", { email_verified: true }).firestore();

  await assertSucceeds(setDoc(doc(userA, "userExperienceProfiles", "user-a"), {
    uid: "user-a", bio: "Pseudonymous bio", status: "online", interests: ["music"], pinnedPostIds: ["posts__post-a"], updatedAt: serverTimestamp()
  }));
  await assertFails(setDoc(doc(userB, "userExperienceProfiles", "user-a"), {
    uid: "user-a", bio: "tampered", status: "", interests: [], pinnedPostIds: [], updatedAt: serverTimestamp()
  }));

  await assertSucceeds(setDoc(doc(admin, "badgeDefinitions", "kind-member"), {
    id: "kind-member", name: "Kind Member", description: "Helpful community member", image: "badge-community-helper.svg", active: true, updatedBy: "admin-user", updatedAt: serverTimestamp()
  }));
  await assertFails(setDoc(doc(userA, "badgeDefinitions", "fake"), { id: "fake", name: "Fake" }));
  await assertSucceeds(setDoc(doc(admin, "userBadges", "user-a", "awards", "community-helper"), {
    userId: "user-a", badgeId: "community-helper", note: "helpful", awardedBy: "admin-user", awardedAt: serverTimestamp()
  }));
  await assertFails(setDoc(doc(userA, "userBadges", "user-a", "awards", "administrator"), { userId: "user-a", badgeId: "administrator" }));

  await assertSucceeds(setDoc(doc(userA, "savedPosts", "user-a", "items", "posts__post-a"), {
    ownerId: "user-a", targetCollection: "posts", targetId: "post-a", authorId: "user-a", snapshotText: "hello", savedAt: serverTimestamp()
  }));
  await assertFails(setDoc(doc(userB, "savedPosts", "user-a", "items", "bad"), {
    ownerId: "user-a", targetCollection: "posts", targetId: "post-a", savedAt: serverTimestamp()
  }));

  await assertSucceeds(setDoc(doc(userA, "contentEdits", "posts__post-a"), {
    kind: "post", targetCollection: "posts", targetId: "post-a", ownerId: "user-a", content: "edited text", editedAt: serverTimestamp()
  }));
  await assertFails(setDoc(doc(userB, "contentEdits", "bad-edit"), {
    kind: "post", targetCollection: "posts", targetId: "post-a", ownerId: "user-b", content: "stolen edit", editedAt: serverTimestamp()
  }));
  await assertSucceeds(setDoc(doc(userB, "contentEdits", "posts__post-a__comment__comment-b"), {
    kind: "comment", targetCollection: "posts", postId: "post-a", commentId: "comment-b", ownerId: "user-b", content: "edited comment", editedAt: serverTimestamp()
  }));

  await assertSucceeds(setDoc(doc(userA, "postMedia", "posts__post-a"), {
    ownerId: "user-a", targetCollection: "posts", targetId: "post-a", images: ["data:image/jpeg;base64,AA=="], updatedAt: serverTimestamp()
  }));
  await assertFails(setDoc(doc(userB, "postMedia", "bad-media"), {
    ownerId: "user-b", targetCollection: "posts", targetId: "post-a", images: ["data:image/jpeg;base64,AA=="], updatedAt: serverTimestamp()
  }));

  await assertSucceeds(setDoc(doc(userA, "commentReplies", "reply-a"), {
    parentKey: "posts__post-a__comment-b", targetCollection: "posts", postId: "post-a", parentCommentId: "comment-b", uid: "user-a", username: "alpha_user", text: "reply", moderationState: "visible", createdAt: serverTimestamp()
  }));

  await assertSucceeds(setDoc(doc(userA, "messagePrivacy", "user-a"), { uid: "user-a", mode: "nobody", updatedAt: serverTimestamp() }));
  await assertFails(setDoc(doc(userB, "messagePrivacy", "user-a"), { uid: "user-a", mode: "everyone", updatedAt: serverTimestamp() }));
  await assertSucceeds(setDoc(doc(userA, "notificationPreferences", "user-a"), {
    uid: "user-a", categories: { comments: true, reactions: false }, quietHours: { enabled: true, start: "22:00", end: "07:00" }, updatedAt: serverTimestamp()
  }));

  await assertSucceeds(setDoc(doc(userA, "typingIndicators", "user-a_user-b__user-a"), { conversationId: "user-a_user-b", uid: "user-a", active: true, updatedAt: serverTimestamp() }));
  await assertSucceeds(setDoc(doc(userA, "messageReactions", "user-a_user-b__message-a__user-a"), { conversationId: "user-a_user-b", messageId: "message-a", uid: "user-a", reaction: "❤️", createdAt: serverTimestamp() }));
  await assertFails(setDoc(doc(userC, "messageReactions", "outsider"), { conversationId: "user-a_user-b", messageId: "message-a", uid: "user-c", reaction: "❤️", createdAt: serverTimestamp() }));
  await assertSucceeds(setDoc(doc(userA, "messageUnsends", "user-a_user-b__message-a"), { conversationId: "user-a_user-b", messageId: "message-a", senderId: "user-a", unsentAt: serverTimestamp() }));

  await assertSucceeds(setDoc(doc(userA, "groupChats", "group-a"), { ownerId: "user-a", name: "Friends", memberIds: ["user-a", "user-b"], createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  await assertSucceeds(getDoc(doc(userB, "groupChats", "group-a")));
  await assertFails(getDoc(doc(userC, "groupChats", "group-a")));
  await assertSucceeds(setDoc(doc(userB, "groupChats", "group-a", "messages", "g1"), { senderId: "user-b", username: "beta_user", text: "hello group", createdAt: serverTimestamp() }));
  await assertFails(setDoc(doc(userC, "groupChats", "group-a", "messages", "bad"), { senderId: "user-c", username: "gamma_user", text: "intrusion", createdAt: serverTimestamp() }));

  // Message request privacy is enforced in the core request creation rule, not only the UI.
  await assertFails(setDoc(doc(userB, "messageRequests", "user-a_user-b"), { fromId: "user-b", toId: "user-a", status: "pending", createdAt: serverTimestamp() }));

  // Admin feature gates stop writes when a newer subsystem is paused.
  await testEnv.withSecurityRulesDisabled(async (context) => setDoc(doc(context.firestore(), "siteSettings", "userExperience"), {
    badgesEnabled: true, editingEnabled: false, galleriesEnabled: true, discoveryEnabled: true, groupChatsEnabled: true, notificationControlsEnabled: true
  }));
  await assertFails(setDoc(doc(userA, "contentEdits", "disabled-edit"), {
    kind: "post", targetCollection: "posts", targetId: "post-a", ownerId: "user-a", content: "should be blocked", editedAt: serverTimestamp()
  }));

  console.log("User experience Firestore authorization passed");
} finally {
  await testEnv.cleanup();
}
