import { readFile, writeFile } from "node:fs/promises";

const path = new URL("./test-moderation-rules.mjs", import.meta.url);
const source = await readFile(path, "utf8");
const early = '  await assertSucceeds(deleteDoc(doc(admin, "posts", "post-2")), "authorized admins retain direct post deletion controls");\n';
const anchor = '  assert.equal((await getDoc(doc(admin, "moderationCases", "post_post-2"))).data().status, "deleteQueued");\n';
const moved = `${anchor}  await assertSucceeds(deleteDoc(doc(admin, "posts", "post-2")), "authorized admins retain direct post deletion controls");\n`;

if (!source.includes(early)) throw new Error("Expected early admin delete assertion not found.");
if (!source.includes(anchor)) throw new Error("Expected moderation case assertion anchor not found.");

const updated = source.replace(early, "").replace(anchor, moved);
if (updated === source) throw new Error("No moderation deletion-order change was made.");
await writeFile(path, updated);
console.log("Moved direct admin deletion after moderation queue creation.");
