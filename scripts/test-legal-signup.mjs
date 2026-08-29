import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

const legalPages = ["terms.html", "privacy.html", "support.html"];
const legalContent = {};
for (const page of legalPages) {
  await access(new URL(page, root));
  const html = await read(page);
  legalContent[page] = html;
  assert.match(html, /AnonChat/i, `${page} identifies AnonChat`);
  assert.match(html, /href="delete-account\.html"/, `${page} links to account deletion`);
  assert.match(html, /href="support\.html"/, `${page} links to support`);
}

for (const phrase of ["at least 18", "report", "block", "moderation", "24 hours", "legal process", "delete"]) {
  assert.match(legalContent["terms.html"], new RegExp(phrase, "i"), `Terms explain ${phrase}`);
}
for (const phrase of ["Firebase Authentication", "email", "public and private user-generated content", "images", "push-subscription", "activity", "Spotify", "reports", "blocks", "Delete account"]) {
  assert.match(legalContent["privacy.html"], new RegExp(phrase, "i"), `Privacy Policy describes ${phrase}`);
}
assert.match(legalContent["privacy.html"], /not end-to-end encrypted/i, "Privacy Policy makes no false encryption claim");
assert.match(legalContent["support.html"], /Report/i, "Support explains reporting");
assert.match(legalContent["support.html"], /Block/i, "Support explains blocking");
assert.match(legalContent["support.html"], /github\.com\/HughKinnett\/anonchat\/issues/i, "Support uses the existing public contact route");

const [indexHtml, loginSource, serviceWorker] = await Promise.all([
  read("index.html"),
  read("loginfirebase.js"),
  read("sw.js")
]);

for (const [id, label] of [["age-confirmation", "18+ confirmation"], ["terms-confirmation", "terms confirmation"]]) {
  assert.match(indexHtml, new RegExp(`<input[^>]+id="${id}"[^>]+type="checkbox"[^>]+required|<input[^>]+type="checkbox"[^>]+id="${id}"[^>]+required`), `${label} is a required checkbox`);
}
assert.match(indexHtml, /href="terms\.html"/, "signup links to Terms of Use");
assert.match(indexHtml, /href="privacy\.html"/, "signup links to Privacy Policy");

const ageGuard = loginSource.indexOf("age-confirmation");
const termsGuard = loginSource.indexOf("terms-confirmation");
const createAccount = loginSource.lastIndexOf("createUserWithEmailAndPassword(");
assert.ok(ageGuard >= 0 && termsGuard >= 0 && Math.max(ageGuard, termsGuard) < createAccount,
  "signup checks both acknowledgements before Firebase account creation");
assert.match(loginSource, /!ageConfirmation\.checked\s*\|\|\s*!termsConfirmation\.checked|!termsConfirmation\.checked\s*\|\|\s*!ageConfirmation\.checked/,
  "signup rejects an unchecked acknowledgement");

assert.match(serviceWorker, /const CACHE_NAME = "anonchat-v44";/, "service worker cache is exactly v44");
assert.doesNotMatch(await readFile(new URL("../privacy.html", import.meta.url), "utf8"), /non-identifying completion marker/i, "UID-keyed completion barriers are described accurately");
assert.doesNotMatch(await readFile(new URL("../terms.html", import.meta.url), "utf8"), /non-identifying completion barrier/i, "UID-keyed completion barriers are described accurately");
for (const asset of [
  "terms.html", "privacy.html", "support.html", "legal.css",
  "moderation-policy.mjs", "moderation-client.mjs", "content-writer-policy.mjs",
  "content-ordering.mjs", "interaction-parent-policy.mjs", "temporary-room-timer-policy.mjs",
  "poll-vote-policy.mjs",
  "viewer-block-policy.mjs", "session-generation-policy.mjs", "timeline-interaction-policy.mjs",
  "protected-metadata-policy.mjs"
]) {
  assert.match(serviceWorker, new RegExp(`"\\./${asset.replace(/[.]/g, "\\.")}"`), `${asset} is in the offline app shell`);
}

console.log("Legal and signup safeguards passed");
