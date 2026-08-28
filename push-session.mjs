export async function signOutWithPushCleanup({
  user,
  stopListeners,
  cleanupPush,
  signOut,
  redirect
}) {
  try {
    try { stopListeners(); } catch { /* Sign-out must continue. */ }
    try { await cleanupPush(user); } catch { /* Sign-out must continue. */ }
  } finally {
    try {
      await signOut();
    } finally {
      redirect();
    }
  }
}
