import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = async path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [premiumHtml, premiumJs, adminHtml, adminJs, androidGradle, androidMain, stripeConfig] = await Promise.all([
  "premium.html",
  "premium.js",
  "admin.html",
  "admin.js",
  "android/app/build.gradle",
  "android/app/src/main/java/com/anonchat/app/MainActivity.java",
  "stripe-client-config.mjs"
].map(source));

for (const id of [
  "billing-frequency",
  "billing-name",
  "billing-email",
  "payment-method-preview",
  "premium-checkout",
  "payment-connection-status"
]) {
  assert.match(premiumHtml, new RegExp(`id=["']${id}["']`), `Premium UI includes ${id}`);
}
assert.match(premiumHtml, /Payments are not connected yet/i, "Premium UI clearly says payments are not connected");
assert.match(premiumHtml, /id=["']premium-checkout["'][^>]*disabled|disabled[^>]*id=["']premium-checkout["']/, "Subscribe button is disabled");
assert.doesNotMatch(premiumJs, /addDoc|setDoc|updateDoc|writeBatch|runTransaction|fetch\s*\(|Stripe\s*\(/, "Premium payment-preparation code does not submit billing data");

for (const id of [
  "billing-provider-status",
  "stripe-publishable-key-placeholder",
  "stripe-product-id-placeholder",
  "stripe-price-id-placeholder",
  "billing-monthly-price",
  "billing-annual-price",
  "google-play-billing-status",
  "billing-mode-status",
  "billing-subscription-count",
  "billing-failed-payment-count",
  "billing-checkout-toggle"
]) {
  assert.match(adminHtml, new RegExp(`id=["']${id}["']`), `Admin UI includes ${id}`);
}
assert.doesNotMatch(adminJs, /stripe.*(?:setDoc|updateDoc|addDoc)|(?:setDoc|updateDoc|addDoc).*stripe/i, "Admin payment preparation does not write Stripe billing config to Firestore");

assert.match(stripeConfig, /checkoutEnabled:\s*false/, "Stripe checkout remains disabled");
assert.match(stripeConfig, /checkoutMode:\s*["']disabled["']/, "Stripe checkout mode remains disabled");
assert.doesNotMatch(androidGradle, /com\.android\.billingclient|stripe-android|com\.stripe/i, "Android has no Play Billing or Stripe SDK dependency");
assert.match(androidGradle, /versionCode\s+4\b/, "Android package version is advanced for the refreshed release");
assert.match(androidGradle, /versionName\s+["']1\.0\.3["']/, "Android package version name is refreshed");
assert.match(androidMain, /extends\s+LauncherActivity/, "Android remains a Trusted Web Activity wrapper");

console.log("Payment preparation UI contract passed");
