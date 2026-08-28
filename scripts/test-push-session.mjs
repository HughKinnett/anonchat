import assert from "node:assert/strict";
import { cleanupAfterAuthLoss, createPushExitCoordinator, signOutWithPushCleanup } from "../push-session.mjs";

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

{
  const events = [];
  const exits = createPushExitCoordinator({
    cleanupAuthenticated: async (user) => { events.push(`cleanup:${user.uid}`); throw new Error("document delete failed"); },
    cleanupUnauthenticated: async () => { throw new Error("not used"); },
    signOut: async () => events.push("signed-out")
  });
  await assert.doesNotReject(exits.authenticated({
    user: { uid: "user-a" },
    stopListeners: () => events.push("listeners-stopped"),
    redirect: () => events.push("redirected")
  }));
  assert.deepEqual(events, ["listeners-stopped", "cleanup:user-a", "signed-out", "redirected"], "shared authenticated exit completes sign-out and redirect after cleanup failure");
}

{
  const events = [];
  const exits = createPushExitCoordinator({
    cleanupAuthenticated: async () => { throw new Error("not used"); },
    cleanupUnauthenticated: async (options) => { events.push(`cleanup:${options.removeDocument}`); throw new Error("unsubscribe failed"); },
    signOut: async () => { throw new Error("auth-loss must not call sign-out"); }
  });
  await assert.doesNotReject(exits.authLoss({ redirect: () => events.push("redirected") }));
  assert.deepEqual(events, ["cleanup:false", "redirected"], "shared auth-loss exit redirects after unsubscribe failure without an owner write or sign-out call");
}

console.log("Push sign-out handoff passed");
