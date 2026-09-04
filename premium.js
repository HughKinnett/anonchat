import { auth, db } from "./firebase-config.js";
import { exitAfterAuthLoss } from "./push-exit.js";
import { hasPremiumAccess, premiumLabel } from "./premium-policy.mjs";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { addDoc, collection, doc, getDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const status = document.getElementById("premium-status"), checkout = document.getElementById("premium-checkout");
onAuthStateChanged(auth, async user => {
  if (!user) { await exitAfterAuthLoss(); location.replace("index.html"); return; }
  const snapshot = await getDoc(doc(db, "premiumAccess", user.uid));
  const access = snapshot.exists() ? snapshot.data() : null;
  const active = hasPremiumAccess(access);
  const lifetime = active && (access.tier === "founder" || access.tier === "founding");
  document.querySelectorAll(".premium-only").forEach(link => { link.hidden = !active; });
  if (active) {
    status.textContent = lifetime
      ? "Your account has lifetime Premium access. No payment required."
      : `${premiumLabel(access)} access is active. Enjoy everything included with AnonChat Premium.`;
    checkout.hidden = true;
  } else {
    status.textContent = "Enjoy more with AnonChat Premium. Purchase securely with a debit or credit card.";
    const config = await getDoc(doc(db, "premiumCheckout", "public"));
    const enabled = config.exists() && config.data().mode === "test" && config.data().enabled === true;
    checkout.disabled = !enabled;
    checkout.title = enabled ? "Open secure Stripe test checkout" : "Connect a Stripe test account to activate Checkout.";
    checkout.onclick = async () => {
      checkout.disabled = true; status.textContent = "Opening secure Stripe test checkout…";
      try {
        const session = await addDoc(collection(db, "customers", user.uid, "checkout_sessions"), {
          price: config.data().priceId,
          success_url: "https://anonchatlogin.web.app/premium.html?checkout=success",
          cancel_url: "https://anonchatlogin.web.app/premium.html?checkout=cancelled"
        });
        const stop = onSnapshot(session, snapshot => {
          const data = snapshot.data();
          if (data?.error) { stop(); checkout.disabled = false; status.textContent = data.error.message || "Stripe test checkout could not start."; }
          if (data?.url) { stop(); location.assign(data.url); }
        });
      } catch { checkout.disabled = false; status.textContent = "Stripe test checkout could not start."; }
    };
  }
});
