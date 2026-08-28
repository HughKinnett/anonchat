export async function preparePushForAccountDeletion({
  uid,
  listSubscriptionRefs,
  deleteSubscriptionRefs,
  unsubscribeCurrent,
  createDeletionRequest
}) {
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
  await createDeletionRequest();
}
