import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [guidelines, childSafety, copyright, subscriptions, index, support, serviceWorker] = await Promise.all([
  "community-guidelines.html", "child-safety.html", "copyright.html", "subscriptions.html",
  "index.html", "support.html", "sw.js"
].map(read));

assert.match(guidelines, /child sexual abuse material/i);
assert.match(guidelines, /Report control/);
assert.match(guidelines, /Block controls/);
assert.match(childSafety, /intended only for people age 18 or older/i);
assert.match(childSafety, /Zero tolerance for CSAE and CSAM/);
assert.match(childSafety, /National Center for Missing &amp; Exploited Children/);
assert.match(copyright, /Copyright notice/);
assert.match(copyright, /Counter-notice/);
assert.match(subscriptions, /US \$4\.99 per month/);
assert.match(subscriptions, /automatically renews/i);
assert.match(subscriptions, /Google Play Billing/);
for (const page of ["community-guidelines.html", "child-safety.html", "copyright.html", "subscriptions.html"]) {
  assert.match(index + support + serviceWorker, new RegExp(page.replace(".", "\\.")), `${page} is linked and cached`);
}
console.log("Google Play policy-page safeguards passed.");
