import { auth } from "./firebase-config.js";
import { resolveProfileTarget } from "./profile-target.mjs";

const boot = async () => {
  await auth.authStateReady();
  const targetUserId = resolveProfileTarget({
    search: window.location.search,
    currentUserUid: auth.currentUser?.uid || ""
  });

  if (targetUserId && !new URLSearchParams(window.location.search).get("uid")) {
    const url = new URL(window.location.href);
    url.searchParams.set("uid", targetUserId);
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }

  await Promise.all([
    import("./profile.js"),
    import("./profile-badges.js"),
    import("./profile-phase-a.js")
  ]);
};

boot().catch((error) => {
  console.error("Unable to initialize profile", error);
  const status = document.getElementById("profile-status");
  if (status) {
    status.textContent = "Could not load this profile.";
    status.style.color = "#fca5a5";
  }
});
