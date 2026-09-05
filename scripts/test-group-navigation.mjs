import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const pages = new Map(await Promise.all([
  "timeline.html",
  "community.html",
  "communities.html",
  "groups.html",
  "premium-rooms.html"
].map(async (name) => [name, await readFile(new URL(`../${name}`, import.meta.url), "utf8")])));
const nav = await readFile(new URL("../nav-menu.js", import.meta.url), "utf8");

const productLinks = [
  { href: "community.html", label: "Temporary Rooms" },
  { href: "communities.html", label: "Communities" },
  { href: "groups.html", label: "Groups" },
  { href: "premium-rooms.html", label: "Premium Rooms" }
];

for (const { href, label } of productLinks) {
  assert.match(nav, new RegExp(`["']${href.replace(".", "\\.")}["']\\s*,\\s*["']${label}["']`), `shared navigation owns the ${label} destination`);
}
for (const [name, html] of pages) {
  assert.match(html, /id=["']main-menu-panel["']/, `${name} exposes the shared product menu panel`);
  assert.match(html, /src=["']nav-menu\.js["']/, `${name} loads the shared product navigation`);
}

assert.match(pages.get("community.html"), /id=["']rooms-panel["']/, "Temporary Rooms remain on the existing community.html surface");
assert.match(pages.get("community.html"), /temporary room/i, "community.html still identifies the temporary-room product");
assert.match(pages.get("premium-rooms.html"), /Invite-only rooms/i, "Premium Rooms remain the existing invite-only room product");
assert.match(pages.get("communities.html"), /Interest Communities/i, "Communities remain the interest-based product");
assert.match(pages.get("groups.html"), /Persistent Groups/i, "Groups remain the persistent-group product");

console.log("Group navigation and product separation passed");
