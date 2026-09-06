import { db } from "./firebase-config.js";
import { getE2eePublicIdentity } from "./e2ee-identity.js";

const form = document.getElementById("direct-message-form");
const conversation = document.getElementById("conversation-user");
const status = document.getElementById("status");

const setReadinessStatus = (message) => {
  if (!status) return;
  status.textContent = message;
  status.classList.add("danger");
};

form?.addEventListener("submit", async (event) => {
  if (form.dataset.e2eeReady === "1") {
    delete form.dataset.e2eeReady;
    return;
  }

  const otherUid = conversation?.value || "";
  if (!otherUid) return;

  event.preventDefault();
  event.stopImmediatePropagation();

  try {
    const identity = await getE2eePublicIdentity(db, otherUid);
    if (!identity?.publicJwk) {
      setReadinessStatus("Encrypted messages are not ready for this conversation yet. Ask this user to open AnonChat once so encryption setup can finish, then try Send again.");
      return;
    }
    form.dataset.e2eeReady = "1";
    form.requestSubmit();
  } catch {
    setReadinessStatus("Could not check encryption setup for this conversation. Please try Send again.");
  }
}, true);
