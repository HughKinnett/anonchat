import { readFile, writeFile } from "node:fs/promises";

const path = "community.js";
let source = await readFile(path, "utf8");

const roomStart = source.indexOf("const renderRoomMessages = () => {");
const roomEnd = source.indexOf("const reportRoomControl =", roomStart);
if (roomStart < 0 || roomEnd < 0) throw new Error("temporary room renderer not found");
let room = source.slice(roomStart, roomEnd);
room = room.replace(
  '    text.textContent = data.unsentAt ? "Message unsent" : (decrypted?.error || decrypted?.text || (data.encrypted ? "Unlocking encrypted message…" : ""));',
  '    text.textContent = decrypted?.error || decrypted?.text || (data.encrypted ? "Unlocking encrypted message…" : "");'
);
room = room.replace(
  '    if (data.unsentAt || data.text || data.bodyCipher) item.append(text);',
  '    if (data.text || data.bodyCipher) item.append(text);'
);
source = source.slice(0, roomStart) + room + source.slice(roomEnd);

const directStart = source.indexOf("const renderDirectMessages = () => {");
const directEnd = source.indexOf('$("direct-message-form").addEventListener("submit"', directStart);
if (directStart < 0 || directEnd < 0) throw new Error("private message renderer not found");
let direct = source.slice(directStart, directEnd);
direct = direct.replace(
  '    text.textContent = decrypted?.error || decrypted?.text || (data.encrypted ? "Unlocking encrypted message…" : "");',
  '    text.textContent = data.unsentAt ? "Message unsent" : (decrypted?.error || decrypted?.text || (data.encrypted ? "Unlocking encrypted message…" : ""));'
);
direct = direct.replace(
  '    if (data.text || data.bodyCipher) item.append(text);',
  '    if (data.unsentAt || data.text || data.bodyCipher) item.append(text);'
);
if (!direct.includes('text.textContent = data.unsentAt ? "Message unsent"')) throw new Error("private unsent placeholder was not applied");
if (!direct.includes('if (data.unsentAt || data.text || data.bodyCipher) item.append(text);')) throw new Error("private unsent placeholder visibility was not applied");
source = source.slice(0, directStart) + direct + source.slice(directEnd);

await writeFile(path, source);
