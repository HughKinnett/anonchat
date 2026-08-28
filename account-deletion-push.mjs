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
