import assert from "node:assert/strict";
import { cleanupAfterAuthLoss, signOutWithPushCleanup } from "../push-session.mjs";

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

{
  const events = [];
  await cleanupAfterAuthLoss({
    cleanupPush: async (options) => events.push(`push-cleaned:${options.removeDocument}`),
    redirect: () => events.push("redirected")
  });
  assert.deepEqual(events, ["push-cleaned:false", "redirected"], "automatic auth loss unsubscribes without attempting an owner document delete");
}

{
  const events = [];
  await assert.doesNotReject(cleanupAfterAuthLoss({
    cleanupPush: async () => { events.push("push-cleanup-failed"); throw new Error("cleanup failed"); },
    redirect: () => events.push("redirected")
  }));
  assert.deepEqual(events, ["push-cleanup-failed", "redirected"], "automatic auth-loss redirect completes when browser cleanup fails");
}

console.log("Push sign-out handoff passed");
