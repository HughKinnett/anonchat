import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html, source, workflow, serviceWorker] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../loginfirebase.js", import.meta.url), "utf8"),
  readFile(new URL("../.github/workflows/deploy-firebase.yml", import.meta.url), "utf8"),
  readFile(new URL("../sw.js", import.meta.url), "utf8")
]);

assert.match(html, /<form id="sign-in-form">[\s\S]*?<button[^>]+id="submit"[^>]+type="submit">Sign In<\/button>/);
assert.match(source, /signInForm\.addEventListener\("submit"/);
assert.match(source, /signInForm\.querySelectorAll\("input, button"\)[\s\S]*?control\.disabled = false/,
  "returning-user controls are explicitly interactive");
assert.match(source, /signInWithEmailAndPassword\(auth, normalizedEmail, password\)/);
assert.doesNotMatch(source, /auth-security-policy|failureState|recordInvalidCredential|requirePasswordReset|multiFactor|Totp/i);
assert.doesNotMatch(workflow, /authenticator|totp|multi.?factor/i);
assert.doesNotMatch(serviceWorker, /auth-security-policy/);
assert.match(html, /<input id="email"[^>]*>/);
assert.match(html, /<input id="password"[^>]*>/);
assert.match(source, /signUpForm\.querySelectorAll\("input, button"\)/,
  "signup locking stays scoped to the signup form");

console.log("Login button and authenticator rollback checks passed.");
