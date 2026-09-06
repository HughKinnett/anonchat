import { db } from "./firebase-config.js";
import { getE2eePublicIdentity } from "./e2ee-identity.js";

const conversation = document.getElementById("conversation-user");
const form = document.getElementById("direct-message-form");
const messageInput = document.getElementById("direct-message");
const status = document.getElementById("status");
const sendButton = form?.querySelector('button[type="submit"], button:not([type])');

let refreshGeneration = 0;

const setComposerReady = (ready, message = "") => {
  if (sendButton) sendButton.disabled = !ready;
  if (messageInput) messageInput.disabled = !ready;
  if (!status || !message) return;
  status.textContent = message;
  status.classList.toggle("danger", !ready);
};

const refresh = async () => {
  const generation = ++refreshGeneration;
  const otherUid = conversation?.value || "";
  if (!otherUid) {
    setComposerReady(false);
    return;
  }

  setComposerReady(false);
  try {
    const identity = await getE2eePublicIdentity(db, otherUid);
    if (generation !== refreshGeneration) return;
    if (!identity?.publicJwk) {
      setComposerReady(false,
        "This accepted conversation is ready, but the other user must open AnonChat once to finish encrypted-chat setup before you can send.");
      return;
    }
    setComposerReady(true);
  } catch {
    if (generation !== refreshGeneration) return;
    setComposerReady(false, "Could not check encrypted-chat readiness. Try again after reconnecting.");
  }
};

conversation?.addEventListener("change", refresh);
window.addEventListener("focus", refresh);

const observeConversationOptions = () => {
  if (!conversation) return;
  new MutationObserver(refresh).observe(conversation, { childList: true });
  void refresh();
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", observeConversationOptions, { once: true });
} else {
  observeConversationOptions();
}
