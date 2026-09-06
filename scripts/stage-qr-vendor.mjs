import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";

const sources = [
  {
    name: "qrcode",
    url: "https://cdn.jsdelivr.net/npm/qrcode@1.5.4/+esm",
    output: new URL("../vendor/qrcode.mjs", import.meta.url),
    sha256: "f712a06862e06fdbb45fc846f9ad273624835025d8c4657c139a0d678d2d3733"
  },
  {
    name: "dijkstrajs",
    url: "https://cdn.jsdelivr.net/npm/dijkstrajs@1.0.3/+esm",
    output: new URL("../vendor/dijkstrajs.mjs", import.meta.url),
    sha256: "62dc939c7c6d5b83a148931d0852d636a15f9d414023c1032647adcac06a4123"
  }
];

const fetchPinned = async ({ name, url, output, sha256 }) => {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`${name} download failed with HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== sha256) throw new Error(`${name} checksum mismatch: expected ${sha256}, got ${actual}`);
  let source = bytes.toString("utf8");
  if (name === "qrcode") {
    source = source.replaceAll('"/npm/dijkstrajs@1.0.3/+esm"', '"./dijkstrajs.mjs"');
    source = source.replaceAll("'/npm/dijkstrajs@1.0.3/+esm'", "'./dijkstrajs.mjs'");
  }
  if (/from\s+["']\/npm\//.test(source) || /import\(["']\/npm\//.test(source)) {
    throw new Error(`${name} still contains unresolved jsDelivr package imports`);
  }
  await mkdir(new URL("../vendor/", import.meta.url), { recursive: true });
  await writeFile(output, source, "utf8");
};

for (const source of sources) await fetchPinned(source);
console.log("Pinned QR vendor bundles staged for Firebase Hosting.");
