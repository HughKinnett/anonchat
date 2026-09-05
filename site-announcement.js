import { db } from "./firebase-config.js";
import { doc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const BANNER_ID = "anonchat-site-announcement";

function banner() {
  let node = document.getElementById(BANNER_ID);
  if (node) return node;
  node = document.createElement("aside");
  node.id = BANNER_ID;
  node.className = "anonchat-site-announcement";
  node.hidden = true;
  node.setAttribute("role", "status");
  node.setAttribute("aria-live", "polite");
  Object.assign(node.style, {
    boxSizing: "border-box",
    width: "100%",
    padding: "10px 16px",
    textAlign: "center",
    fontWeight: "700",
    lineHeight: "1.4",
    background: "#f5c542",
    color: "#171717",
    borderBottom: "1px solid rgba(0,0,0,.18)",
    position: "relative",
    zIndex: "1000"
  });
  document.body.prepend(node);
  return node;
}

function renderAnnouncement(data = {}) {
  const node = banner();
  const text = String(data.text || "").trim().slice(0, 500);
  const active = data.active === true && Boolean(text);
  node.textContent = active ? text : "";
  node.hidden = !active;
}

onSnapshot(
  doc(db, "siteSettings", "announcement"),
  snapshot => renderAnnouncement(snapshot.exists() ? snapshot.data() : {}),
  () => renderAnnouncement({})
);
