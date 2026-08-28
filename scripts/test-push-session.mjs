import assert from "node:assert/strict";
import { signOutWithPushCleanup } from "../push-session.mjs";

{
  const events = [];
  await signOutWithPushCleanup({
    user: { uid: "user-a" },
    stopListeners: () => events.push("listeners-stopped"),
    cleanupPush: async (user) => events.push(`push-cleaned:${user.uid}`),
    signOut: async () => events.push("signed-out"),
    redirect: () => events.push("redirected")
  });
  assert.deepEqual(events, ["listeners-stopped", "push-cleaned:user-a", "signed-out", "redirected"], "push cleanup runs while A is still authenticated");
}

{
  const events = [];
  await assert.doesNotReject(signOutWithPushCleanup({
    user: { uid: "user-a" },
    stopListeners: () => events.push("listeners-stopped"),
    cleanupPush: async () => { events.push("push-cleanup-failed"); throw new Error("cleanup failed"); },
    signOut: async () => events.push("signed-out"),
    redirect: () => events.push("redirected")
  }));
  assert.deepEqual(events, ["listeners-stopped", "push-cleanup-failed", "signed-out", "redirected"], "sign-out and redirect run in finally even if cleanup rejects");
}

console.log("Push sign-out handoff passed");
