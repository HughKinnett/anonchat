import { auth, db } from "./firebase-config.js";
import { exitAfterAuthLoss } from "./push-exit.js";
import { hasPremiumAccess, premiumLabel } from "./premium-policy.mjs";
import { emptyStripeBillingFields, stripeClientConfig, stripeSetupReady } from "./stripe-client-config.mjs";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const status = document.getElementById("premium-status");
const checkout = document.getElementById("premium-checkout");
const stripeFields = emptyStripeBillingFields();

const showStripePreparationState = () => {
  const ready = stripeSetupReady();
  checkout.disabled = true;
  checkout.dataset.stripeReady = ready ? "true" : "false";
  checkout.dataset.productId = stripeClientConfig.productId;
  checkout.dataset.priceId = stripeClientConfig.priceId;
  checkout.dataset.customerId = stripeFields.customerId;
  checkout.dataset.subscriptionId = stripeFields.subscriptionId;
  checkout.dataset.subscriptionStatus = stripeFields.subscriptionStatus;
  checkout.title = ready
    ? "Stripe is prepared, but checkout is not enabled yet."
    : "Stripe setup is incomplete.";
};

onAuthStateChanged(auth, async user => {
  if (!user) {
    await exitAfterAuthLoss();
    location.replace("index.html");
    return;
  }

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
    return;
  }

  status.textContent = "AnonChat Premium billing is being prepared. Stripe checkout is not enabled yet.";
  checkout.hidden = false;
  showStripePreparationState();
});
