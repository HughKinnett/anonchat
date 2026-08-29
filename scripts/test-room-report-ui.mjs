import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildInAppNotifications } from "../notification-ui-policy.mjs";
import * as moderationPolicy from "../moderation-policy.mjs";

const time = (milliseconds) => ({ toMillis: () => milliseconds });
const entry = (id, path, data) => ({ id, ref: { path }, data: () => data });

const [html, source, css, timelineSource] = await Promise.all([
  readFile(new URL("../community.html", import.meta.url), "utf8"),
  readFile(new URL("../community.js", import.meta.url), "utf8"),
  readFile(new URL("../community.css", import.meta.url), "utf8"),
  readFile(new URL("../timeline.js", import.meta.url), "utf8")
]);

assert.match(html, /id="room-report-dialog"/);
assert.match(html, /Report Room/);
assert.match(html, /Spam[\s\S]*Harassment[\s\S]*Threats[\s\S]*Sexual content[\s\S]*Other/);
assert.match(html, /Expiration paused for admin review/);

const uiPolicy = await import("../room-report-ui-policy.mjs").catch(() => ({}));
assert.equal(typeof uiPolicy.createRoomReportSubmissionGate, "function", "room report concurrency is policy-controlled");
assert.equal(typeof uiPolicy.roomViewState, "function", "room visibility and interaction state are policy-controlled");
assert.equal(typeof uiPolicy.roomMessageView, "function", "message retention and expiry labels are policy-controlled");
assert.equal(typeof uiPolicy.createAuthoritativeRoomReportTracker, "function",
  "optimistic room holds reconcile against authoritative room snapshots");
assert.equal(typeof uiPolicy.createRoomExpiryController, "function",
  "room expiration is driven by a bounded wall-clock controller");
assert.equal(typeof uiPolicy.createRoomMessageListenerRegistry, "function",
  "timeline room-message listeners have a stateful lifecycle policy");
assert.equal(typeof uiPolicy.openRoomAfterMembershipWrite, "function",
  "room opening revalidates authoritative state after its asynchronous membership write");

const activeRoom = { ownerId: "owner", moderationStatus: "active" };
const reportedRoom = {
  ownerId: "owner",
  moderationStatus: "reported",
  expiresAt: time(1)
};
assert.deepEqual(uiPolicy.roomViewState({
  room: activeRoom,
  currentUid: "member",
  now: 10
}), {
  state: "active",
  visible: true,
  canInteract: true,
  canReport: true,
  retainEvidence: false,
  expirationPaused: false
});
assert.equal(uiPolicy.roomViewState({ room: activeRoom, currentUid: "owner", now: 10 }).canReport, false,
  "a room owner cannot report their own room");
assert.deepEqual(uiPolicy.roomViewState({
  room: reportedRoom,
  currentUid: "member",
  now: 10
}), {
  state: "reported",
  visible: false,
  canInteract: false,
  canReport: false,
  retainEvidence: true,
  expirationPaused: true
});
assert.equal(uiPolicy.roomViewState({
  room: reportedRoom,
  currentUid: "admin",
  now: 10,
  isAdmin: true
}).visible, true, "administrators can review a reported room after its old expiry");

assert.deepEqual(uiPolicy.roomMessageView({
  room: activeRoom,
  message: { expiresAt: time(2_000) },
  now: 1_000,
  formatDate: (milliseconds) => `LOCAL-${milliseconds}`
}), {
  visible: true,
  retainedForReview: false,
  expirationMillis: 2_000,
  expirationText: "Disappears LOCAL-2000"
});
assert.deepEqual(uiPolicy.roomMessageView({
  room: reportedRoom,
  message: { expiresAt: time(1) },
  now: 1_000,
  isAdmin: true,
  formatDate: () => assert.fail("reported evidence must not render its stale expiry")
}), {
  visible: true,
  retainedForReview: true,
  expirationMillis: null,
  expirationText: "Expiration paused for admin review"
});
assert.equal(uiPolicy.roomMessageView({
  room: reportedRoom,
  message: { expiresAt: time(1) },
  now: 1_000
}).visible, false, "ordinary users cannot render retained reported-room evidence");

const restoredRoom = {
  ownerId: "owner",
  ...moderationPolicy.restoreRoomPayload({ resolvedAt: time(1_000), expiresAt: time(5_000) })
};
assert.deepEqual(uiPolicy.roomMessageView({
  room: restoredRoom,
  message: { expiresAt: time(1) },
  now: 2_000,
  formatDate: (milliseconds) => `LOCAL-${milliseconds}`
}), {
  visible: true,
  retainedForReview: false,
  expirationMillis: 5_000,
  expirationText: "Disappears LOCAL-5000"
}, "restored evidence uses the room's fresh expiration instead of its stale message timestamp");

const gate = uiPolicy.createRoomReportSubmissionGate();
const reportA = gate.tryStart({ roomId: "room-a" });
assert.ok(reportA);
assert.equal(gate.tryStart({ roomId: "room-b" }), null, "a second report cannot replace an in-flight report");
assert.equal(gate.finish({ roomId: "room-a" }), false, "stale completion cannot clear the active report");
assert.equal(gate.isBusy(), true);
assert.equal(gate.finish(reportA), true);

{
  let currentRoom = { moderationStatus: "active", expiresAt: time(5_000) };
  let finishMembershipWrite;
  let openedRoom = null;
  let unavailable = 0;
  const membershipWrite = new Promise((resolve) => { finishMembershipWrite = resolve; });
  const opening = uiPolicy.openRoomAfterMembershipWrite({
    getRoom: () => currentRoom,
    canOpen: (room) => moderationPolicy.roomState(room, 1_000) === "active",
    writeMembership: () => membershipWrite,
    onOpen: (room) => { openedRoom = room; },
    onUnavailable: () => { unavailable += 1; }
  });
  currentRoom = { moderationStatus: "active", expiresAt: time(999) };
  finishMembershipWrite();
  assert.equal(await opening, false);
  assert.equal(openedRoom, null, "a room that expired during the write never activates or opens");
  assert.equal(unavailable, 1, "the expired-after-write path reports that the room is unavailable");

  currentRoom = { moderationStatus: "active", expiresAt: time(5_000) };
  const reportedMembershipWrite = new Promise((resolve) => { finishMembershipWrite = resolve; });
  const reportedOpening = uiPolicy.openRoomAfterMembershipWrite({
    getRoom: () => currentRoom,
    canOpen: (room) => moderationPolicy.roomState(room, 1_000) === "active",
    writeMembership: () => reportedMembershipWrite,
    onOpen: (room) => { openedRoom = room; },
    onUnavailable: () => { unavailable += 1; }
  });
  currentRoom = { moderationStatus: "reported", expiresAt: time(5_000) };
  finishMembershipWrite();
  assert.equal(await reportedOpening, false);
  assert.equal(openedRoom, null, "a room reported during the write never activates or opens");
  assert.equal(unavailable, 2, "the reported-after-write path reports that the room is unavailable");

  let locallyHeld = false;
  currentRoom = { moderationStatus: "active", expiresAt: time(5_000) };
  const heldMembershipWrite = new Promise((resolve) => { finishMembershipWrite = resolve; });
  const heldOpening = uiPolicy.openRoomAfterMembershipWrite({
    getRoom: () => currentRoom,
    canOpen: (room) => !locallyHeld && moderationPolicy.roomState(room, 1_000) === "active",
    writeMembership: () => heldMembershipWrite,
    onOpen: (room) => { openedRoom = room; },
    onUnavailable: () => { unavailable += 1; }
  });
  locallyHeld = true;
  finishMembershipWrite();
  assert.equal(await heldOpening, false);
  assert.equal(openedRoom, null, "an optimistic report hold during the write never activates or opens");
  assert.equal(unavailable, 3, "the locally-held-after-write path reports that the room is unavailable");

  currentRoom = { moderationStatus: "active", expiresAt: time(5_000) };
  assert.equal(await uiPolicy.openRoomAfterMembershipWrite({
    getRoom: () => currentRoom,
    canOpen: (room) => moderationPolicy.roomState(room, 1_000) === "active",
    writeMembership: async () => {},
    onOpen: (room) => { openedRoom = room; }
  }), true);
  assert.equal(openedRoom, currentRoom, "a room still active after the write opens from re-resolved state");
}

const reportTracker = uiPolicy.createAuthoritativeRoomReportTracker();
reportTracker.start("room-a");
reportTracker.commit("room-a");
reportTracker.reconcile(["room-a"]);
assert.equal(reportTracker.isHeld("room-a"), true,
  "a stale active snapshot cannot flash a room while its report commit is being observed");
reportTracker.reconcile([]);
assert.equal(reportTracker.isHeld("room-a"), false,
  "the authoritative reported snapshot releases the optimistic hold");
reportTracker.reconcile(["room-a"]);
assert.equal(reportTracker.isHeld("room-a"), false,
  "an administrator-restored room reappears without requiring a reload");

const createFakeTimers = (initialNow = 1_000) => {
  let clock = initialNow;
  let sequence = 0;
  const timers = new Map();
  return {
    now: () => clock,
    setTimer(callback, delay) {
      const id = ++sequence;
      timers.set(id, { callback, dueAt: clock + delay });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
    advanceTo(next) {
      clock = next;
      const due = [...timers.entries()].filter(([, timer]) => timer.dueAt <= clock);
      for (const [id, timer] of due) {
        timers.delete(id);
        timer.callback();
      }
    },
    pending: () => [...timers.values()].map((timer) => timer.dueAt).sort((a, b) => a - b)
  };
};

{
  const timers = createFakeTimers();
  let expirations = 0;
  const controller = uiPolicy.createRoomExpiryController({
    now: timers.now,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    onExpire: () => { expirations += 1; }
  });
  controller.schedule([5_000, 8_000]);
  assert.deepEqual(timers.pending(), [5_000]);
  controller.schedule([6_000]);
  assert.deepEqual(timers.pending(), [6_000], "a new snapshot replaces the old expiration alarm");
  timers.advanceTo(5_000);
  assert.equal(expirations, 0);
  timers.advanceTo(6_000);
  assert.equal(expirations, 1, "room UI expires at the scheduled wall-clock instant");
  const farExpiry = timers.now() + uiPolicy.MAX_TIMER_DELAY_MS + 100;
  controller.schedule([farExpiry]);
  assert.deepEqual(timers.pending(), [timers.now() + uiPolicy.MAX_TIMER_DELAY_MS],
    "browser timer delays are capped and re-armed for distant expirations");
  timers.advanceTo(timers.now() + uiPolicy.MAX_TIMER_DELAY_MS);
  assert.equal(expirations, 1);
  assert.deepEqual(timers.pending(), [farExpiry]);
  timers.advanceTo(farExpiry);
  assert.equal(expirations, 2);
  controller.schedule([10_000]);
  controller.cancel();
  assert.deepEqual(timers.pending(), [], "auth exit or dialog close cancels the alarm");
}

{
  const timers = createFakeTimers();
  const subscriptions = [];
  const rendered = [];
  const registry = uiPolicy.createRoomMessageListenerRegistry({
    now: timers.now,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    subscribe(roomId, next, error) {
      const record = { roomId, next, error, closes: 0 };
      subscriptions.push(record);
      return () => { record.closes += 1; };
    },
    onMessages: (messages) => rendered.push(messages)
  });
  const membership = [{ data: () => ({ uid: "member", roomId: "restored" }) }];
  const restored = [entry("restored", "rooms/restored", {
    moderationStatus: "active", resumedAt: time(900), expiresAt: time(5_000)
  })];
  registry.sync({ rooms: restored, memberships: membership, currentUid: "member" });
  assert.equal(subscriptions.length, 1);
  subscriptions[0].next([entry("message", "roomMessages/message", { roomId: "restored" })]);
  assert.equal(rendered.at(-1).length, 1);
  timers.advanceTo(5_000);
  assert.equal(subscriptions[0].closes, 1, "a restored room listener is disposed exactly at expiry");
  assert.deepEqual(rendered.at(-1), [], "expired room notifications are removed immediately");

  registry.sync({ rooms: restored, memberships: membership, currentUid: "member" });
  assert.equal(subscriptions.length, 1, "an already-expired room cannot recreate a listener");
  const active = [entry("active", "rooms/active", { moderationStatus: "active" })];
  const activeMembership = [{ data: () => ({ uid: "member", roomId: "active" }) }];
  registry.sync({ rooms: active, memberships: activeMembership, currentUid: "member" });
  assert.equal(subscriptions.length, 2);
  subscriptions[1].error();
  assert.equal(subscriptions[1].closes, 1);
  registry.sync({ rooms: active, memberships: activeMembership, currentUid: "member" });
  assert.equal(subscriptions.length, 3, "a listener error removes the dead registry entry for recovery");
  subscriptions[2].next([entry("recovered", "roomMessages/recovered", { roomId: "active" })]);
  assert.equal(rendered.at(-1)[0].id, "recovered");
  registry.stop();
  assert.equal(subscriptions[2].closes, 1);
}

const timestamp = { kind: "trusted-server-time" };
assert.equal(moderationPolicy.reportId("room", "room-a", "member"), "room_room-a_member");
assert.equal(moderationPolicy.roomState(reportedRoom, 10), "reported",
  "a moderation hold wins over the room's old expiry");
assert.deepEqual(moderationPolicy.roomReportPayloads({
  roomId: "room-a",
  reporterId: "member",
  ownerId: "owner",
  reason: "Harassment",
  timestamp
}), {
  report: {
    targetType: "room",
    targetId: "room-a",
    reporterId: "member",
    reportedUserId: "owner",
    reason: "Harassment",
    status: "pending",
    createdAt: timestamp
  },
  room: {
    moderationStatus: "reported",
    reportedAt: timestamp
  }
});

const notificationItems = buildInAppNotifications({
  currentUid: "member",
  rooms: [
    entry("active", "rooms/active", activeRoom),
    entry("reported", "rooms/reported", reportedRoom),
    entry("missing-status", "rooms/missing-status", { ownerId: "owner" })
  ],
  roomMemberships: [
    entry("active_member", "roomMembers/active_member", { uid: "member", roomId: "active" }),
    entry("reported_member", "roomMembers/reported_member", { uid: "member", roomId: "reported" }),
    entry("missing-status_member", "roomMembers/missing-status_member", { uid: "member", roomId: "missing-status" })
  ],
  roomMessages: [
    entry("active-message", "roomMessages/active-message", {
      roomId: "active", senderId: "other", expiresAt: time(2_000), createdAt: time(100)
    }),
    entry("reported-message", "roomMessages/reported-message", {
      roomId: "reported", senderId: "other", expiresAt: time(2_000), createdAt: time(200)
    }),
    entry("missing-status-message", "roomMessages/missing-status-message", {
      roomId: "missing-status", senderId: "other", expiresAt: time(2_000), createdAt: time(300)
    })
  ],
  nowMillis: 1_000
});
const roomNotifications = notificationItems.filter((item) => item.type === "room-message");
assert.equal(roomNotifications.length, 1,
  "suspended-room messages cannot render as notifications");
assert.equal(roomNotifications[0].createdAt.toMillis(), 100,
  "the remaining notification belongs to the active room");

assert.match(source, /reportId[\s\S]*roomReportPayloads[\s\S]*roomState/);
assert.match(source, /writeBatch\(db\)/);
assert.match(source, /batch\.set\([\s\S]*batch\.update\([\s\S]*batch\.commit\(\)/);
assert.match(source, /locallyReportedRooms\.start\(roomId\)[\s\S]*closeActiveRoom\([\s\S]*renderRooms\(\)[\s\S]*batch\.commit\(\)/);
assert.match(source, /locallyReportedRooms\.reconcile\(snapshot\.docs\.map\(\(room\) => room\.id\)\)/,
  "active-room snapshots authoritatively reconcile optimistic report holds");
assert.match(source, /await batch\.commit\(\)[\s\S]*locallyReportedRooms\.commit\(roomId\)/,
  "a successful commit transitions the optimistic hold into snapshot reconciliation");
assert.match(source, /createRoomExpiryController\([\s\S]*scheduleRoomExpiryRefresh[\s\S]*roomExpiryController\.cancel\(\)/,
  "community room cards, dialogs, and messages wire the expiry controller");
assert.match(source, /moderationStatus:\s*"active"/);
assert.match(source, /collection\(db, "rooms"\)[\s\S]*where\("moderationStatus",\s*"==",\s*"active"\)/);
assert.match(source, /where\("moderationStatus",\s*"==",\s*"active"\)[\s\S]*?state\.rooms = \[\][\s\S]*?closeActiveRoom\("This room is no longer available\."\)/,
  "active-room query errors clear stale room state and close the room fail-closed");
assert.match(source, /collection\(db, "roomMessages"\)[\s\S]*where\("roomId",\s*"==",\s*roomId\)/);
assert.doesNotMatch(source, /listen\(query\(collection\(db, "roomMessages"\), orderBy/);
assert.match(source, /roomViewState\([\s\S]*canReport/);
assert.match(source, /roomMessageView\(/);
assert.match(source, /roomReportForm\.addEventListener\("submit"/);
assert.match(source, /if \(!view\.canInteract\) return/);
assert.match(source, /if \(!room \|\| !view\.canInteract \|\| !canInteractWith\(room\.data\(\)\.ownerId\)\) return/,
  "opening a stale or reported room is rejected before the membership write");
assert.match(source, /openRoomAfterMembershipWrite\([\s\S]*getRoom:[\s\S]*writeMembership:[\s\S]*onOpen:[\s\S]*onUnavailable:/,
  "the production open-room path uses the post-write revalidation controller");
assert.match(source, /getRoom:\s*async \(\) =>[\s\S]*getDoc\(doc\(db, "rooms", id\)\)[\s\S]*canOpen:\s*\(latest\) =>[\s\S]*roomDocumentView\(latest\)[\s\S]*latestView\.canInteract/,
  "the production post-write check re-reads the room and applies expiry plus optimistic-hold policy");
assert.match(source, /closeActiveRoom\("This room is no longer available\."\)/);
assert.match(source, /catch \{[\s\S]*?submittedRoomReportIds\.delete\(reportKey\)[\s\S]*?locallyReportedRooms\.fail\(roomId\)[\s\S]*?button\.disabled = false[\s\S]*?renderRooms\(\)/,
  "a failed or raced report restores retryable local state");

assert.match(timelineSource, /buildInAppNotifications\(\{[\s\S]*?\n\s*rooms,/);
assert.match(timelineSource, /collection\(db, "rooms"\)[\s\S]*where\("moderationStatus",\s*"==",\s*"active"\)/);
assert.match(timelineSource, /collection\(db, "roomMessages"\)[\s\S]*where\("roomId",\s*"==",\s*roomId\)/);
assert.doesNotMatch(timelineSource, /onSnapshot\(collection\(db, "roomMessages"\)/);
assert.match(timelineSource, /createRoomMessageListenerRegistry\([\s\S]*notificationRoomMessageListeners\.sync/,
  "timeline delegates status, expiry, and listener recovery to the behavioral registry");

assert.match(css, /\.room-actions/);
assert.match(css, /\.report-room-button/);
assert.match(css, /\.message-expiration/);
assert.match(css, /\.room-report-dialog/);

console.log("room report UI tests passed");
