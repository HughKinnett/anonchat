import { auth, db } from "./firebase-config.js";
import { ensureE2eeIdentity } from "./e2ee-identity.js";
import { exitAfterAuthLoss } from "./push-exit.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    await exitAfterAuthLoss({ redirect: () => {} });
    return;
  }
  void ensureE2eeIdentity(db, user).catch(() => {
    // Community surfaces report encryption readiness when the user tries to message.
  });
});
