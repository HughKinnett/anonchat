import { readFile } from "node:fs/promises";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, collectionGroup, doc, documentId, getDoc, getDocs, limit, orderBy, query, setDoc } from "firebase/firestore";

const testEnv = await initializeTestEnvironment({
  projectId: "anonchat-timeline-query-rules-test",
  firestore: { rules: await readFile(new URL("../firestore.rules", import.meta.url), "utf8") }
});
const profile = (uid) => ({ uid, username: uid, banned: false, createdAt: new Date(0), lastActiveAt: new Date(0) });

try {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const overflowInteractions = [];
    for (let index = 1; index <= 100; index += 1) {
      const suffix = String(index).padStart(3, "0");
      overflowInteractions.push(
        setDoc(doc(db, "posts", "visible", "comments", `comment-${suffix}`), {
          uid: "author", username: "author", text: suffix, createdAt: new Date(10 + index)
        }),
        setDoc(doc(db, "posts", "visible", "reactions", `reaction-${suffix}`), {
          uid: `actor-${suffix}`, type: "heart", createdAt: new Date(10 + index)
        })
      );
    }
    await Promise.all([
      setDoc(doc(db, "users", "viewer"), profile("viewer")),
      setDoc(doc(db, "users", "author"), profile("author")),
      setDoc(doc(db, "posts", "visible"), { authorId: "author", username: "author", content: "visible", imageData: "", moderationState: "visible", createdAt: new Date(1) }),
      setDoc(doc(db, "posts", "hidden"), { authorId: "author", username: "author", content: "hidden", imageData: "", moderationState: "hidden", createdAt: new Date(2) }),
      setDoc(doc(db, "communityPosts", "visible-community"), { authorId: "author", username: "author", content: "visible", imageData: "", moderationState: "visible", createdAt: new Date(1) }),
      setDoc(doc(db, "communityPosts", "hidden-community"), { authorId: "author", username: "author", content: "hidden", imageData: "", moderationState: "hidden", createdAt: new Date(2) }),
      setDoc(doc(db, "posts", "visible", "comments", "visible-comment"), { uid: "author", username: "author", text: "visible", createdAt: new Date(3) }),
      setDoc(doc(db, "posts", "hidden", "comments", "hidden-comment"), { uid: "author", username: "author", text: "hidden", createdAt: new Date(4) }),
      setDoc(doc(db, "posts", "visible", "reactions", "author"), { uid: "author", type: "heart", createdAt: new Date(5) }),
      setDoc(doc(db, "posts", "visible", "reactions", "viewer"), { uid: "viewer", type: "laugh", createdAt: new Date(0) }),
      setDoc(doc(db, "posts", "hidden", "reactions", "author"), { uid: "author", type: "heart", createdAt: new Date(6) }),
      setDoc(doc(db, "communityPosts", "visible-community", "comments", "visible-comment"), { uid: "author", username: "author", text: "visible", createdAt: new Date(3) }),
      setDoc(doc(db, "communityPosts", "hidden-community", "comments", "hidden-comment"), { uid: "author", username: "author", text: "hidden", createdAt: new Date(4) }),
      setDoc(doc(db, "communityPosts", "visible-community", "reactions", "author"), { uid: "author", type: "heart", createdAt: new Date(5) }),
      setDoc(doc(db, "communityPosts", "hidden-community", "reactions", "author"), { uid: "author", type: "heart", createdAt: new Date(6) }),
      ...overflowInteractions
    ]);
  });
  const db = testEnv.authenticatedContext("viewer").firestore();
  await assertSucceeds(getDoc(doc(db, "posts", "visible")),
    "a canonical visible parent can be resolved by exact document path");
  await assertFails(getDoc(doc(db, "posts", "hidden")),
    "a canonical hidden parent cannot be resolved by exact document path");
  for (const kind of ["comments", "reactions"]) {
    await assertFails(getDocs(query(collectionGroup(db, kind))),
      `unconstrained ${kind} collection-group query cannot prove parent visibility`);
    for (const [parentCollection, visibleId, hiddenId] of [
      ["posts", "visible", "hidden"],
      ["communityPosts", "visible-community", "hidden-community"]
    ]) {
      const visible = await assertSucceeds(getDocs(query(
        collection(db, parentCollection, visibleId, kind),
        orderBy("createdAt", "desc"),
        orderBy(documentId(), "desc"),
        limit(100)
      )));
      const expectedSize = parentCollection === "posts" ? 100 : 1;
      if (visible.size !== expectedSize) throw new Error(`${parentCollection} ${kind} query returned the wrong rows`);
      if (parentCollection === "posts") {
        if (!visible.docs.some((entry) => entry.id === `${kind === "comments" ? "comment" : "reaction"}-100`)) {
          throw new Error(`${kind} bounded query omitted the newest activity`);
        }
        const omittedOldest = kind === "comments" ? "visible-comment" : "viewer";
        if (visible.docs.some((entry) => entry.id === omittedOldest)) {
          throw new Error(`${kind} bounded query retained old activity instead of the newest window`);
        }
      }
      await assertFails(getDocs(collection(db, parentCollection, hiddenId, kind)),
        `${kind} beneath a hidden ${parentCollection} parent is denied`);
    }
  }
  await assertSucceeds(getDoc(doc(db, "posts", "visible", "reactions", "viewer")),
    "an exact viewer-reaction read succeeds even when the viewer is outside the newest 100");
  console.log("Timeline parent-scoped query authorization passed");
} finally {
  await testEnv.cleanup();
}
