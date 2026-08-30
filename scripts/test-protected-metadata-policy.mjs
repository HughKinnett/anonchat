import assert from "node:assert/strict";
import {
  clearConnectionsProtectedMetadata,
  clearProfileProtectedMetadata
} from "../protected-metadata-policy.mjs";

const elements = new Map();
const element = (id) => {
  const value = {
    id, textContent: `A:${id}`, hidden: false, src: `A:${id}`, children: ["A"],
    attributes: new Map([["href", `A:${id}`]]),
    removeAttribute(name) { this.attributes.delete(name); },
    replaceChildren(...children) { this.children = children; }
  };
  elements.set(id, value);
  return value;
};
[
  "profile-name", "profile-handle", "view-profile-avatar", "view-profile-cover",
  "profile-followers", "profile-following", "profile-admin-link", "connections-title",
  "followers-count", "following-count", "followers-list", "following-list"
].forEach(element);
const document = { title: "@admin-a — AnonChat", getElementById: (id) => elements.get(id) };
let renderedSpotify = "A-song";

clearProfileProtectedMetadata({ document, renderSpotify: (value) => { renderedSpotify = value; } }, "Loading B…");
assert.equal(document.title, "Loading profile — AnonChat");
assert.equal(elements.get("profile-name").textContent, "Loading B…");
assert.equal(elements.get("profile-handle").textContent, "");
assert.equal(elements.get("view-profile-avatar").src, "anonchat-anonymous.png");
assert.equal(elements.get("view-profile-avatar").hidden, false);
assert.equal(elements.get("view-profile-cover").src, "anonchat-anonymous.png");
assert.equal(elements.get("view-profile-cover").hidden, false);
assert.equal(elements.get("profile-followers").textContent, "— followers");
assert.equal(elements.get("profile-followers").attributes.has("href"), false);
assert.equal(elements.get("profile-following").textContent, "— following");
assert.equal(elements.get("profile-following").attributes.has("href"), false);
assert.equal(elements.get("profile-admin-link").hidden, true, "A-admin controls cannot leak into B loading/error UI");
assert.equal(renderedSpotify, "");

clearConnectionsProtectedMetadata({
  document,
  followersList: elements.get("followers-list"),
  followingList: elements.get("following-list")
}, "Loading B connections…");
assert.equal(elements.get("connections-title").textContent, "Loading B connections…");
assert.equal(elements.get("followers-count").textContent, "—");
assert.equal(elements.get("following-count").textContent, "—");
assert.deepEqual(elements.get("followers-list").children, []);
assert.deepEqual(elements.get("following-list").children, []);

console.log("Protected metadata reset policy passed");
