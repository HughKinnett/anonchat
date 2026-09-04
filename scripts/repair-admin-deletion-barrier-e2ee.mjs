import { readFile, writeFile } from "node:fs/promises";

const path = new URL("./test-admin-deletion-barrier-rules.mjs", import.meta.url);
let source = await readFile(path, "utf8");

const replacements = [
  [
    'const roomExpiry = new Date(Date.now() + 86_400_000);',
    'const roomExpiry = new Date(Date.now() + 86_400_000);\nconst cipher = value => ({ version: 1, algorithm: "A256GCM", iv: "a".repeat(16), ciphertext: Buffer.from(value).toString("base64") });'
  ],
  [
    '    () => setDoc(doc(firestore, "directMessages", `message_${suffix}`), { participants: ["member", uid], senderId: "member", text: "hello", createdAt: serverTimestamp() }),',
    '    () => setDoc(doc(firestore, "messageRequests", `member_${uid}`, "messages", `message_${suffix}`), { participants: ["member", uid], senderId: "member", encrypted: true, cipherVersion: 1, bodyCipher: cipher("hello"), createdAt: serverTimestamp() }),' 
  ],
  [
    '    () => setDoc(doc(firestore, "roomMessages", `room_${suffix}`), { roomId: room, senderId: "member", tempName: "Member", text: "hello", expiresAt: roomExpiry, moderationState: "visible", createdAt: serverTimestamp() })',
    '    () => setDoc(doc(firestore, "roomMessages", `room_${suffix}`), { roomId: room, senderId: "member", tempName: "Member", encrypted: true, cipherVersion: 1, bodyCipher: cipher("hello"), expiresAt: roomExpiry, moderationState: "visible", createdAt: serverTimestamp() })'
  ],
  [
    '  roomOrphanRace.set(doc(other, "roomMessages", "orphan-room-message"), { roomId: "other-room", senderId: "other", tempName: "Other", text: "orphan", expiresAt: roomExpiry, moderationState: "visible", createdAt: serverTimestamp() });',
    '  roomOrphanRace.set(doc(other, "roomMessages", "orphan-room-message"), { roomId: "other-room", senderId: "other", tempName: "Other", encrypted: true, cipherVersion: 1, bodyCipher: cipher("orphan"), expiresAt: roomExpiry, moderationState: "visible", createdAt: serverTimestamp() });'
  ],
  [
    '  ["room-message", () => setDoc(doc(firestore, "roomMessages", "missing-room-owner"), { roomId: "three-room", senderId: "member", tempName: "Member", text: "missing owner", expiresAt: roomExpiry, moderationState: "visible", createdAt: serverTimestamp() })]',
    '  ["room-message", () => setDoc(doc(firestore, "roomMessages", "missing-room-owner"), { roomId: "three-room", senderId: "member", tempName: "Member", encrypted: true, cipherVersion: 1, bodyCipher: cipher("missing owner"), expiresAt: roomExpiry, moderationState: "visible", createdAt: serverTimestamp() })]'
  ]
];

for (const [before, after] of replacements) {
  if (!source.includes(before)) throw new Error(`Repair anchor not found: ${before.slice(0, 90)}`);
  source = source.replace(before, after);
}

if (source.includes('doc(firestore, "directMessages", `message_${suffix}`)')) throw new Error("Legacy directMessages write remains.");
await writeFile(path, source);
console.log("Aligned admin deletion barrier fixtures with current E2EE message paths.");
