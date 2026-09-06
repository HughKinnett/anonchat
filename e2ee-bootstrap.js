import { auth } from "./firebase-config.js";
import { exitAfterAuthLoss } from "./push-exit.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

onAuthStateChanged(auth, async (user) => {
  if (!user) await exitAfterAuthLoss({ redirect: () => {} });
});
