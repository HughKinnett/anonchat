import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const pages = new Map(await Promise.all([
  "timeline.html",
  "community.html",
  "communities.html",
  "groups.html",
  "premium-rooms.html"
].map(async (name) => [name, await readFile(new URL(`../${name}`, import.meta.url), "utf8")])));

const productLinks = [
  { href: "community.html", label: "Temporary Rooms" },
  { href: "communities.html", label: "Communities" },
  { href: "groups.html", label: "Groups" },
  { href: "premium-rooms.html", label: "Premium Rooms" }
];

for (const [name, html] of pages) {
  for (const { href, label } of productLinks) {
    const pattern = new RegExp(`<a[^>]+href=["']${href.replace(".", "\\.")}["'][^>]*>\\s*${label}\\s*</a>`, "i");
    assert.match(html, pattern, `${name} keeps ${label} as a distinct product destination`);
  }
}

assert.match(pages.get("community.html"), /id=["']rooms-panel["']/, "Temporary Rooms remain on the existing community.html surface");
assert.match(pages.get("community.html"), /temporary room/i, "community.html still identifies the temporary-room product");
assert.match(pages.get("premium-rooms.html"), /Invite-only rooms/i, "Premium Rooms remain the existing invite-only room product");
assert.match(pages.get("communities.html"), /Interest Communities/i, "Communities remain the interest-based product");
assert.match(pages.get("groups.html"), /Persistent Groups/i, "Groups remain the persistent-group product");

console.log("Group navigation and product separation passed");
