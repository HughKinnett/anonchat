import { readFile, writeFile } from "node:fs/promises";

const updates = [
  {
    path: "customize.js",
    replacements: [
      ["import { auth, db } from \"./firebase-config.js\";", "import { auth, db } from \"./firebase-config.js\";\nimport { exitAfterAuthLoss } from \"./push-exit.js\";"],
      ["if (!current) return location.replace(\"index.html\");", "if (!current) { await exitAfterAuthLoss(); return location.replace(\"index.html\"); }"]
    ]
  },
  {
    path: "experience.js",
    replacements: [
      ["import { auth } from \"./firebase-config.js\";", "import { auth } from \"./firebase-config.js\";\nimport { exitAfterAuthLoss } from \"./push-exit.js\";"],
      ["onAuthStateChanged(auth, user => { if (!user) return location.replace(\"index.html\");", "onAuthStateChanged(auth, async user => { if (!user) { await exitAfterAuthLoss(); return location.replace(\"index.html\"); }"]
    ]
  },
  {
    path: "premium-playlist.js",
    replacements: [
      ["import { auth, db } from \"./firebase-config.js\";", "import { auth, db } from \"./firebase-config.js\";\nimport { exitAfterAuthLoss } from \"./push-exit.js\";"],
      ["if (!user) { location.replace(\"index.html\"); return; }", "if (!user) { await exitAfterAuthLoss(); location.replace(\"index.html\"); return; }"]
    ]
  },
  {
    path: "premium-rooms.js",
    replacements: [
      ["import { auth, db } from \"./firebase-config.js\";", "import { auth, db } from \"./firebase-config.js\";\nimport { exitAfterAuthLoss } from \"./push-exit.js\";"],
      ["onAuthStateChanged(auth, async current => { if(!current)return location.replace(\"index.html\");", "onAuthStateChanged(auth, async current => { if(!current){await exitAfterAuthLoss();return location.replace(\"index.html\");}"]
    ]
  },
  {
    path: "premium.js",
    replacements: [
      ["import { auth, db } from \"./firebase-config.js\";", "import { auth, db } from \"./firebase-config.js\";\nimport { exitAfterAuthLoss } from \"./push-exit.js\";"],
      ["if (!user) { location.replace(\"index.html\"); return; }", "if (!user) { await exitAfterAuthLoss(); location.replace(\"index.html\"); return; }"]
    ]
  },
  {
    path: "profile-style.js",
    replacements: [
      ["import { auth, db } from \"./firebase-config.js\";", "import { auth, db } from \"./firebase-config.js\";\nimport { exitAfterAuthLoss } from \"./push-exit.js\";"],
      ["if (!current) return location.replace(\"index.html\");", "if (!current) { await exitAfterAuthLoss(); return location.replace(\"index.html\"); }"]
    ]
  },
  {
    path: "scripts/test-push-auth-integration.mjs",
    replacements: [[
      "  \"connections.js\": { authenticated: 1, authLoss: 1 },\n  \"delete-account.js\": { authenticated: 2, authLoss: 1 },",
      "  \"connections.js\": { authenticated: 1, authLoss: 1 },\n  \"customize.js\": { authenticated: 0, authLoss: 1 },\n  \"delete-account.js\": { authenticated: 2, authLoss: 1 },\n  \"experience.js\": { authenticated: 0, authLoss: 1 },"
    ], [
      "  \"loginfirebase.js\": { authenticated: 2, authLoss: 1 },\n  \"profile.js\": { authenticated: 1, authLoss: 1 },",
      "  \"loginfirebase.js\": { authenticated: 2, authLoss: 1 },\n  \"online-followers.js\": { authenticated: 0, authLoss: 0 },\n  \"premium-menu.js\": { authenticated: 0, authLoss: 0 },\n  \"premium-playlist.js\": { authenticated: 0, authLoss: 1 },\n  \"premium-profile.js\": { authenticated: 0, authLoss: 0 },\n  \"premium-rooms.js\": { authenticated: 0, authLoss: 1 },\n  \"premium.js\": { authenticated: 0, authLoss: 1 },\n  \"profile-style.js\": { authenticated: 0, authLoss: 1 },\n  \"profile.js\": { authenticated: 1, authLoss: 1 },"
    ]]
  }
];

for (const { path, replacements } of updates) {
  let source = await readFile(path, "utf8");
  for (const [before, after] of replacements) {
    if (!source.includes(before)) throw new Error(`Missing anchor in ${path}: ${before.slice(0, 80)}`);
    source = source.replace(before, after);
  }
  await writeFile(path, source);
}
