import { readFile, writeFile } from "node:fs/promises";

const path = new URL("./test-moderation-rules.mjs", import.meta.url);
const source = await readFile(path, "utf8");

const visibleBefore = `  await assertSucceeds(setDoc(doc(stranger, "roomMessages", "visible-room-direct"), {\n    roomId: "active-room", senderId: "stranger", tempName: "Stranger", text: "direct api",\n    expiresAt: roomExpiry, moderationState: "visible", createdAt: serverTimestamp()\n  }));`;
const visibleAfter = `  await assertSucceeds(setDoc(doc(stranger, "roomMessages", "visible-room-direct"), {\n    roomId: "active-room", senderId: "stranger", tempName: "Stranger", encrypted: true, cipherVersion: 1,\n    bodyCipher: cipher("direct api"), expiresAt: roomExpiry, moderationState: "visible", createdAt: serverTimestamp()\n  }));`;

const hiddenBefore = `  await assertFails(setDoc(doc(stranger, "roomMessages", "hidden-room-direct"), {\n    roomId: "hidden-room", senderId: "stranger", tempName: "Stranger", text: "direct api",\n    expiresAt: new Date(Date.now() + 86_400_000), moderationState: "visible", createdAt: serverTimestamp()\n  }));`;
const hiddenAfter = `  await assertFails(setDoc(doc(stranger, "roomMessages", "hidden-room-direct"), {\n    roomId: "hidden-room", senderId: "stranger", tempName: "Stranger", encrypted: true, cipherVersion: 1,\n    bodyCipher: cipher("direct api"), expiresAt: roomExpiry, moderationState: "visible", createdAt: serverTimestamp()\n  }), "a valid encrypted message is still denied while its room is on moderation hold");`;

if (!source.includes(visibleBefore)) throw new Error("Visible direct-room fixture anchor not found.");
if (!source.includes(hiddenBefore)) throw new Error("Hidden direct-room fixture anchor not found.");
const updated = source.replace(visibleBefore, visibleAfter).replace(hiddenBefore, hiddenAfter);
if (updated === source) throw new Error("No moderation E2EE fixture changes were made.");
await writeFile(path, updated);
console.log("Aligned direct room-message moderation fixtures with the E2EE envelope.");
