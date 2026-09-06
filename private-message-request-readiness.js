import { auth, db } from "./firebase-config.js";
import { getE2eePublicIdentity } from "./e2ee-identity.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const requestButton = document.getElementById("request-chat");
const userSelect = document.getElementById("message-user");
const status = document.getElementById("request-status");
let checking = false;

const setStatus = (message, error = false) => {
  if (!status) return;
  status.textContent = message;
  status.classList.toggle("danger", error);
};

const pairIdFor = (left, right) => [left, right].sort().join("_");

const needsOtherIdentity = async (user, otherUid) => {
  const request = await getDoc(doc(db, "messageRequests", pairIdFor(user.uid, otherUid)));
  if (request.exists()) {
    const data = request.data();
    return data.status === "pending" && data.toId === user.uid;
  }

  const [outgoingFollow, incomingFollow] = await Promise.all([
    getDoc(doc(db, "follows", `${user.uid}_${otherUid}`)),
    getDoc(doc(db, "follows", `${otherUid}_${user.uid}`))
  ]);
  return outgoingFollow.exists() && incomingFollow.exists();
};

requestButton?.addEventListener("click", async (event) => {
  if (requestButton.dataset.e2eeReady === "1") {
    delete requestButton.dataset.e2eeReady;
    return;
  }

  if (checking) {
    event.preventDefault();
    event.stopImmediatePropagation();
    return;
  }

  const user = auth.currentUser;
  const otherUid = userSelect?.value || "";
  if (!user || !otherUid) return;

  event.preventDefault();
  event.stopImmediatePropagation();
  checking = true;

  try {
    const ownIdentity = await getE2eePublicIdentity(db, user.uid);
    if (!ownIdentity?.publicJwk) {
      setStatus("Set up encryption in Temporary Rooms before starting private messages.", true);
      return;
    }
    if (await needsOtherIdentity(user, otherUid)) {
      const otherIdentity = await getE2eePublicIdentity(db, otherUid);
      if (!otherIdentity?.publicJwk) {
        setStatus("Encrypted messaging is not ready for this user yet. Ask them to open AnonChat once, then try again.", true);
        return;
      }
    }

    requestButton.dataset.e2eeReady = "1";
    requestButton.click();
  } catch (error) {
    setStatus(error?.message || "Could not verify encryption readiness. Please try again.", true);
  } finally {
    checking = false;
  }
}, true);
