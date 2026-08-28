import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const DEFAULT_HANDLES = ["cybercapone", "i_love_you_h"];

export const ensureDefaultOwnerFollows = async (userId, db) => {
  const results = await Promise.allSettled(DEFAULT_HANDLES.map(async (handle) => {
    const usernameSnapshot = await getDoc(doc(db, "usernames", handle));
    if (!usernameSnapshot.exists()) return;
    const ownerId = usernameSnapshot.data().uid;
    if (!ownerId || ownerId === userId) return;
    await setDoc(doc(db, "follows", `${userId}_${ownerId}`), {
      followerId: userId,
      followingId: ownerId,
      createdAt: serverTimestamp()
    });
  }));
  return results.every((result) => result.status === "fulfilled");
};
