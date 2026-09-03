import { readFile, writeFile } from "node:fs/promises";

const path = new URL("./test-moderation-rules.mjs", import.meta.url);
let source = await readFile(path, "utf8");

const helperAnchor = "const roomExpiry = new Date(Date.now() + 86_400_000);\n";
const helper = "const roomExpiry = new Date(Date.now() + 86_400_000);\nconst cipher = value => ({ version: 1, algorithm: \"A256GCM\", iv: \"a\".repeat(16), ciphertext: Buffer.from(value).toString(\"base64\") });\n";
if (!source.includes("const cipher = value =>")) {
  if (!source.includes(helperAnchor)) throw new Error("roomExpiry helper anchor not found");
  source = source.replace(helperAnchor, helper);
}

const activePlain = `  await assertSucceeds(setDoc(doc(stranger, "roomMessages", "active-room-message"), {\n    roomId: "room-1", senderId: "stranger", tempName: "Stranger", text: "active room", expiresAt: roomExpiry,\n    moderationState: "visible", createdAt: serverTimestamp()\n  }), "active rooms retain messaging controls");`;
const activeEncrypted = `  await assertSucceeds(setDoc(doc(stranger, "roomMessages", "active-room-message"), {\n    roomId: "room-1", senderId: "stranger", tempName: "Stranger", encrypted: true, cipherVersion: 1,\n    bodyCipher: cipher("active room"), expiresAt: roomExpiry, moderationState: "visible", createdAt: serverTimestamp()\n  }), "active rooms retain messaging controls");`;
if (!source.includes(activePlain)) throw new Error("active room plaintext fixture not found");
source = source.replace(activePlain, activeEncrypted);

const hiddenPlain = `  await assertFails(setDoc(doc(stranger, "roomMessages", "after-room-report"), {\n    roomId: "room-1", senderId: "stranger", tempName: "Stranger", text: "hidden room", expiresAt: roomExpiry,\n    moderationState: "visible", createdAt: serverTimestamp()\n  }), "reported rooms deny messaging immediately");`;
const hiddenEncrypted = `  await assertFails(setDoc(doc(stranger, "roomMessages", "after-room-report"), {\n    roomId: "room-1", senderId: "stranger", tempName: "Stranger", encrypted: true, cipherVersion: 1,\n    bodyCipher: cipher("hidden room"), expiresAt: roomExpiry, moderationState: "visible", createdAt: serverTimestamp()\n  }), "reported rooms deny messaging immediately");`;
if (!source.includes(hiddenPlain)) throw new Error("hidden room plaintext fixture not found");
source = source.replace(hiddenPlain, hiddenEncrypted);

await writeFile(path, source);
console.log("Updated moderation room-message fixtures to valid E2EE payloads.");
