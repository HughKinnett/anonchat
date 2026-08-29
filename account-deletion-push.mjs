export function selfDeletionQueuePayloads({ uid, username, timestamp } = {}) {
  if (typeof uid !== "string" || !uid || typeof username !== "string" || !username || timestamp === undefined) {
    throw new TypeError("A valid account deletion request is required");
  }
  return {
    request: { uid, username, createdAt: timestamp },
    job: { targetUid: uid, requesterUid: uid, requestedAt: timestamp, requestType: "self", status: "queued" }
  };
}

export async function preparePushForAccountDeletion({
  uid,
  ensureDeletionRequest,
  listSubscriptionRefs,
  deleteSubscriptionRefs,
  unsubscribeCurrent
}) {
  await ensureDeletionRequest();

  let documentFailure;
  try {
    const refs = await listSubscriptionRefs(uid);
    await deleteSubscriptionRefs(refs);
  } catch (error) {
    documentFailure = error;
  }

  let unsubscribeFailure;
  try {
    await unsubscribeCurrent();
  } catch (error) {
    unsubscribeFailure = error;
  }

  if (documentFailure) throw documentFailure;
  if (unsubscribeFailure) throw unsubscribeFailure;
}
