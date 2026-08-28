import { open, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import webPush from "web-push";

const repositoryRoot = await realpath(fileURLToPath(new URL("..", import.meta.url)));
const requestedPath = process.argv[2];

if (!requestedPath || process.argv.length !== 3) {
  console.error("Usage: node scripts/generate-vapid-keys.mjs /absolute/path/outside/repository/keys.json");
  process.exitCode = 1;
} else {
  try {
    const resolved = path.resolve(requestedPath);
    const resolvedParent = await realpath(path.dirname(resolved));
    const target = path.join(resolvedParent, path.basename(resolved));
    const relative = path.relative(repositoryRoot, target);
    if (relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..")) {
      throw new Error("Refusing to write VAPID key material inside the repository.");
    }

    const handle = await open(target, "wx", 0o600);
    try {
      const { publicKey, privateKey } = webPush.generateVAPIDKeys();
      await handle.writeFile(`${JSON.stringify({
        publicKey,
        privateKey,
        createdAt: new Date().toISOString()
      }, null, 2)}\n`, { encoding: "utf8" });
      console.log(`VAPID public key: ${publicKey}`);
      console.log("VAPID key file created successfully.");
    } finally {
      await handle.close();
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : "VAPID key generation failed.");
    process.exitCode = 1;
  }
}
