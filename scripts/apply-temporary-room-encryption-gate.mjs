import fs from "node:fs";

const replaceExact = (path, before, after) => {
  const source = fs.readFileSync(path, "utf8");
  if (!source.includes(before)) throw new Error(`Expected source not found in ${path}`);
  fs.writeFileSync(path, source.replace(before, after));
};

replaceExact(
  "nav-menu.js",
  `  import("./e2ee-bootstrap.js").catch(error => {\n    console.warn("Unable to initialize encrypted messaging", error);\n  });\n\n`,
  ""
);

replaceExact("upload.js", `import "./e2ee-bootstrap.js";\n`, "");

fs.writeFileSync("e2ee-bootstrap.js", `import { auth } from "./firebase-config.js";\nimport { exitAfterAuthLoss } from "./push-exit.js";\nimport { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";\n\nonAuthStateChanged(auth, async (user) => {\n  if (!user) await exitAfterAuthLoss({ redirect: () => {} });\n});\n`);

replaceExact(
  "private-message-request-readiness.js",
  `import { ensureE2eeIdentity, getE2eePublicIdentity } from "./e2ee-identity.js";`,
  `import { getE2eePublicIdentity } from "./e2ee-identity.js";`
);
replaceExact(
  "private-message-request-readiness.js",
  `  try {\n    await ensureE2eeIdentity(db, user);\n    if (await needsOtherIdentity(user, otherUid)) {`,
  `  try {\n    const ownIdentity = await getE2eePublicIdentity(db, user.uid);\n    if (!ownIdentity?.publicJwk) {\n      setStatus("Set up encryption in Temporary Rooms before starting private messages.", true);\n      return;\n    }\n    if (await needsOtherIdentity(user, otherUid)) {`
);

replaceExact(
  "community.js",
  `const now = () => Date.now();\nconst directKeyFor = async otherUid => {\n  if (directKeyCache.has(otherUid)) return directKeyCache.get(otherUid);\n  const identity = state.e2eeIdentity || await ensureE2eeIdentity(db, state.user);`,
  `const now = () => Date.now();\nconst ensureTemporaryRoomEncryptionReady = async () => {\n  if (!state.user) throw new Error("Sign in before entering a temporary room.");\n  const identity = state.e2eeIdentity || await ensureE2eeIdentity(db, state.user);\n  state.e2eeIdentity = identity;\n  return identity;\n};\nconst directKeyFor = async otherUid => {\n  if (directKeyCache.has(otherUid)) return directKeyCache.get(otherUid);\n  const ownPublicIdentity = await getE2eePublicIdentity(db, state.user.uid);\n  if (!ownPublicIdentity?.publicJwk) throw new Error("Set up encryption in Temporary Rooms before using private messages.");\n  const identity = state.e2eeIdentity || await ensureE2eeIdentity(db, state.user);`
);

replaceExact(
  "community.js",
  `const openRoom = async (id, name) => {\n  let roomOwnerId = "";\n  try {\n    const currentRoom = await getDoc(doc(db, "rooms", id));`,
  `const openRoom = async (id, name) => {\n  let roomOwnerId = "";\n  try {\n    await ensureTemporaryRoomEncryptionReady();\n    const currentRoom = await getDoc(doc(db, "rooms", id));`
);

replaceExact(
  "community.js",
  `  } catch {\n    setStatus("Could not join that room.", true);\n    return;\n  }\n  state.activeRoom = id;`,
  `  } catch (error) {\n    setStatus(error?.message === "Encrypted chats remain locked."\n      ? "Encryption setup is required before entering temporary rooms."\n      : "Could not join that room.", true);\n    return;\n  }\n  state.activeRoom = id;`
);

replaceExact(
  "community.js",
  `$("room-form").addEventListener("submit", async (event) => {\n  event.preventDefault();\n  try {\n    const made = doc(collection(db, "rooms"));`,
  `$("room-form").addEventListener("submit", async (event) => {\n  event.preventDefault();\n  try {\n    await ensureTemporaryRoomEncryptionReady();\n    const made = doc(collection(db, "rooms"));`
);

replaceExact(
  "community.js",
  `  } catch {\n    setStatus("Could not start room.", true);\n  }\n});\n\n$("room-message-form")`,
  `  } catch (error) {\n    setStatus(error?.message === "Encrypted chats remain locked."\n      ? "Encryption setup is required before starting a temporary room."\n      : "Could not start room.", true);\n  }\n});\n\n$("room-message-form")`
);

replaceExact(
  "community.js",
  `  state.profile = profile.data();\n  try {\n    state.e2eeIdentity = await ensureE2eeIdentity(db, user);\n  } catch (error) {\n    setStatus(error?.message || "Encrypted chats remain locked.", true);\n  }\n  void recordPageActivity({`,
  `  state.profile = profile.data();\n  void recordPageActivity({`
);

replaceExact("sw.js", `const CACHE_NAME = "anonchat-v145";`, `const CACHE_NAME = "anonchat-v146";`);

console.log("Applied temporary-room encryption gate changes.");
