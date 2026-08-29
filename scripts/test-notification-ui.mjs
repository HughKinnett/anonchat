import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildInAppNotifications,
  notificationUiId
} from "../notification-ui-policy.mjs";

const time = (milliseconds) => ({ toMillis: () => milliseconds });
const entry = (id, path, data) => ({ id, ref: { path }, data: () => data });
const currentUid = "current-user-private-uid";
const actorUid = "actor-private-uid";
const items = buildInAppNotifications({
  currentUid,
  posts: [entry("post-a", "posts/post-a", { authorId: currentUid })],
  reactions: [entry(actorUid, `posts/post-a/reactions/${actorUid}`, { uid: actorUid, type: "heart", createdAt: time(10) })],
  comments: [entry("comment-a", "posts/post-a/comments/comment-a", { uid: actorUid, username: "private_name", text: "private comment body", createdAt: time(11) })],
  messageRequests: [entry(`${actorUid}_${currentUid}`, `messageRequests/${actorUid}_${currentUid}`, { fromId: actorUid, toId: currentUid, status: "pending", createdAt: time(12) })],
  rooms: [entry("room-a", "rooms/room-a", { ownerId: actorUid, moderationStatus: "active" })],
  roomMessages: [entry("room-message-a", "roomMessages/room-message-a", { senderId: actorUid, roomId: "room-a", tempName: "private alias", text: "private room body", createdAt: time(13), expiresAt: time(100) })],
  roomMemberships: [entry("membership", "roomMembers/membership", { uid: currentUid, roomId: "room-a" })],
  reveals: [entry(`${actorUid}_${currentUid}`, `reveals/${actorUid}_${currentUid}`, { fromId: actorUid, toId: currentUid, fields: { region: true }, status: "pending", createdAt: time(14) })],
  nowMillis: 50
});
assert.deepEqual(items.map((item) => item.type).sort(), ["comment", "message-request", "reaction", "reveal-request", "room-message"]);
assert.deepEqual(items.map((item) => item.message).sort(), [
  "A temporary room you joined has a new message.",
  "Someone commented on your post.",
  "Someone reacted to your post.",
  "You have a new mutual reveal request.",
  "You have a new private conversation request."
].sort());
assert.equal(items.find((item) => item.type === "reveal-request").url, "community.html#messages-panel");
const visible = JSON.stringify(items.map(({ id, message, url }) => ({ id, message, url })));
for (const forbidden of [currentUid, actorUid, "private_name", "private comment body", "private alias", "private room body"]) {
  assert.equal(visible.includes(forbidden), false, `${forbidden} is absent from visible notifications`);
}
assert.equal(notificationUiId("message-request", `${actorUid}_${currentUid}`, time(12)), notificationUiId("message-request", `${actorUid}_${currentUid}`, time(12)));
assert.notEqual(notificationUiId("message-request", `${actorUid}_${currentUid}`, time(12)), notificationUiId("message-request", `${actorUid}_${currentUid}`, time(13)));

const communitySource = await readFile(new URL("../community.js", import.meta.url), "utf8");
assert.doesNotMatch(communitySource, /\bnew\s+Notification\s*\(/, "page code never creates browser notifications");

console.log("In-app notification policy passed");
