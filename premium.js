import { auth, db } from "./firebase-config.js";
import { exitAfterAuthLoss } from "./push-exit.js";
import { hasPremiumAccess, premiumLabel } from "./premium-policy.mjs";
import { paymentPreparationStatus } from "./payment-preparation-policy.mjs";
import { emptyStripeBillingFields, stripeClientConfig, stripeSetupReady } from "./stripe-client-config.mjs";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const status = document.getElementById("premium-status");
const checkout = document.getElementById("premium-checkout");
const paymentConnectionStatus = document.getElementById("payment-connection-status");
const billingFrequency = document.getElementById("billing-frequency");
const billingName = document.getElementById("billing-name");
const billingEmail = document.getElementById("billing-email");
const stripeFields = emptyStripeBillingFields();

const showPaymentPreparationState = (user) => {
  const prepared = paymentPreparationStatus();
  paymentConnectionStatus.textContent = prepared.message;
  billingFrequency.disabled = true;
  billingName.disabled = true;
  billingEmail.disabled = true;
  checkout.disabled = true;
  checkout.textContent = "Subscribe — payments not connected";
  if (user?.email) billingEmail.placeholder = user.email;
};

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
    ? "Stripe client preparation exists, but checkout is not connected."
    : "Stripe client preparation is incomplete.";
};

onAuthStateChanged(auth, async user => {
  if (!user) {
    await exitAfterAuthLoss();
    location.replace("index.html");
    return;
  }

  showPaymentPreparationState(user);
  showStripePreparationState();

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

  status.textContent = "AnonChat Premium payment setup is prepared, but billing is not connected yet.";
  checkout.hidden = false;
});
