import { readFile, writeFile } from "node:fs/promises";

const path = "admin.html";
let html = await readFile(path, "utf8");

if (!html.includes('payment-preparation.css')) {
  html = html.replace(
    '<link rel="manifest" href="manifest.webmanifest"><link rel="stylesheet" href="timeline.css"><link rel="stylesheet" href="admin.css">',
    '<link rel="manifest" href="manifest.webmanifest"><link rel="stylesheet" href="timeline.css"><link rel="stylesheet" href="admin.css"><link rel="stylesheet" href="payment-preparation.css">'
  );
}

if (!html.includes('id="billing-provider-status"')) {
  const anchor = '      <section class="admin-panel command-panel" aria-labelledby="firebase-usage-heading"><div class="admin-panel-heading"><div><h2 id="firebase-usage-heading">Firebase usage</h2><p class="admin-note">A simple view for keeping AnonChat on the free Firebase plan.</p></div></div><p id="firebase-usage-note" class="usage-note">Loading usage summary…</p></section>\n';
  const billing = `      <section class="admin-panel command-panel command-panel-wide" aria-labelledby="billing-preparation-heading">
        <div class="admin-panel-heading"><div><h2 id="billing-preparation-heading">Payments / Premium billing</h2><p class="admin-note">Prepare the user and admin billing screens now. Payments are not connected to Stripe, Firestore billing records, or Google Play yet.</p></div><span id="billing-provider-status" class="status-chip status-neutral">Not connected</span></div>
        <div class="admin-billing-grid">
          <div class="admin-billing-field"><label for="stripe-publishable-key-placeholder">Stripe publishable key</label><input id="stripe-publishable-key-placeholder" value="Configured separately — not editable here" disabled></div>
          <div class="admin-billing-field"><label for="stripe-product-id-placeholder">Stripe product ID</label><input id="stripe-product-id-placeholder" placeholder="Not connected" disabled></div>
          <div class="admin-billing-field"><label for="stripe-price-id-placeholder">Stripe price ID</label><input id="stripe-price-id-placeholder" placeholder="Not connected" disabled></div>
          <div class="admin-billing-field"><label for="billing-mode-status">Billing mode</label><input id="billing-mode-status" value="Preparation only" disabled></div>
          <div class="admin-billing-field"><label for="billing-monthly-price">Monthly display price</label><input id="billing-monthly-price" value="$4.99" disabled></div>
          <div class="admin-billing-field"><label for="billing-annual-price">Annual display price</label><input id="billing-annual-price" value="Not configured" disabled></div>
          <div class="admin-billing-field"><label for="google-play-billing-status">Google Play billing</label><input id="google-play-billing-status" value="Not connected" disabled></div>
          <div class="admin-billing-field"><label>Environment</label><input value="No live/test payment connection" disabled></div>
        </div>
        <div class="billing-stat-grid">
          <div class="billing-stat"><span>Subscriptions</span><strong id="billing-subscription-count">Not connected</strong></div>
          <div class="billing-stat"><span>Failed payments</span><strong id="billing-failed-payment-count">Not connected</strong></div>
        </div>
        <label class="billing-switch-row" for="billing-checkout-toggle"><span><strong>Enable checkout</strong><small class="admin-note">This stays locked until a payment provider is intentionally connected.</small></span><input id="billing-checkout-toggle" type="checkbox" disabled></label>
        <p class="billing-warning">No secret keys, webhook secrets, card details, or Google billing credentials belong in this dashboard. Those connections will be added later through secure server-side configuration.</p>
      </section>
`;
  if (!html.includes(anchor)) throw new Error("Firebase usage anchor not found");
  html = html.replace(anchor, anchor + billing);
}

await writeFile(path, html);
