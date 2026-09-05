# Payment UI and Android Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build complete but inert Premium payment interfaces for users/admins and rebuild Android with the current web experience, without connecting Stripe APIs, Firestore billing writes, or Google Play Billing.

**Architecture:** Keep payment preparation as presentation-only browser code layered over existing Premium entitlement reads. Add one focused payment-preparation policy module for shared constants/status, render user/admin controls from static config, and preserve the Trusted Web Activity Android wrapper with no billing SDK dependency. Existing web/Firebase behavior remains unchanged outside presentation.

**Tech Stack:** HTML, CSS, ES modules, Firebase Auth/Firestore reads already present, Android Trusted Web Activity/Gradle, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-05-payment-ui-android-parity-design.md`

## Global Constraints

- No Stripe API calls or checkout completion.
- No Firestore writes for billing configuration or subscriptions.
- No Google Play Billing SDK or Google billing connection.
- No Stripe secret key, webhook secret, card number, CVV, or server credential in web/Android code.
- Existing Premium entitlement reads remain unchanged.
- Android remains a Trusted Web Activity that loads the hosted AnonChat site.

---

### Task 1: Payment preparation contract and regression tests

**Files:**
- Create: `payment-preparation-policy.mjs`
- Create: `scripts/test-payment-preparation-ui.mjs`
- Modify: `scripts/test-regressions.mjs`

**Interfaces:**
- Consumes: existing `stripe-client-config.mjs` checkout-disabled state.
- Produces: `paymentPreparationDefaults`, `paymentPreparationStatus()`, `paymentPreparationIsInert()` for user/admin UI.

- [ ] **Step 1: Write the failing test**

Create assertions that require user/admin payment UI hooks, disabled checkout, no billing SDK imports, no Firestore write functions in payment-preparation code, and no Android billing dependency.

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/test-payment-preparation-ui.mjs`
Expected: FAIL because the new policy/UI hooks do not exist yet.

- [ ] **Step 3: Write minimal implementation**

Create a frozen static preparation config with monthly display price `$4.99`, annual display placeholder `Not configured`, provider state `Not connected`, checkout enabled `false`, and helper functions that always report inert/preparation-only state.

- [ ] **Step 4: Run test to verify policy portion passes while UI assertions still fail**

Run: `node scripts/test-payment-preparation-ui.mjs`
Expected: FAIL only on missing UI hooks.

- [ ] **Step 5: Commit**

Commit policy/test scaffolding.

### Task 2: User Premium payment-preparation UI

**Files:**
- Modify: `premium.html`
- Modify: `premium.css`
- Modify: `premium.js`
- Test: `scripts/test-payment-preparation-ui.mjs`

**Interfaces:**
- Consumes: `paymentPreparationDefaults`, `paymentPreparationStatus()`.
- Produces: DOM ids `billing-frequency`, `billing-name`, `billing-email`, `payment-method-preview`, `premium-checkout`, `payment-connection-status`.

- [ ] **Step 1: Extend failing test for exact user fields and disabled state**
- [ ] **Step 2: Run and confirm failure**
- [ ] **Step 3: Add plan summary, monthly/annual selector, billing name/email fields, inert card/payment preview, status panel, disabled Subscribe button, and explicit preparation-only copy**
- [ ] **Step 4: Ensure `premium.js` never submits payment data and existing entitlement read logic stays intact**
- [ ] **Step 5: Run `node scripts/test-payment-preparation-ui.mjs` and relevant Premium tests**
- [ ] **Step 6: Commit**

### Task 3: Admin Payments / Premium billing preparation section

**Files:**
- Modify: `admin.html`
- Modify: `admin.css`
- Modify: `admin.js`
- Test: `scripts/test-payment-preparation-ui.mjs`

**Interfaces:**
- Consumes: `paymentPreparationDefaults`, `paymentPreparationStatus()`.
- Produces: admin DOM ids for provider status, publishable-key placeholder, product/price ids, monthly/annual display prices, Google Play state, mode, subscription placeholders, failed-payment placeholder, disabled checkout toggle.

- [ ] **Step 1: Extend failing test for admin payment-preparation controls**
- [ ] **Step 2: Run and confirm failure**
- [ ] **Step 3: Add task-first billing section with plain-English labels and disabled/inert controls**
- [ ] **Step 4: Render static status only; do not call Firestore writes or external services**
- [ ] **Step 5: Run payment-preparation and admin dashboard tests**
- [ ] **Step 6: Commit**

### Task 4: Android parity and billing-exclusion verification

**Files:**
- Modify: `android/README.md`
- Modify only if needed: `android/app/build.gradle`, `android/app/src/main/java/com/anonchat/app/MainActivity.java`
- Test: `scripts/test-payment-preparation-ui.mjs`

**Interfaces:**
- Consumes: hosted production site via TWA.
- Produces: Android package with current wrapper and explicit no-billing-SDK state.

- [ ] **Step 1: Add tests asserting Android Gradle has no Play Billing/Stripe dependencies and wrapper remains TWA**
- [ ] **Step 2: Run and confirm current status**
- [ ] **Step 3: Update Android README to document current parity model and deferred billing integration**
- [ ] **Step 4: Run Android build workflow on branch**
- [ ] **Step 5: Commit if Android source/docs changed**

### Task 5: Full verification, review, merge, deploy, and rebuild artifacts

**Files:**
- No new production files unless verification reveals a defect.

**Interfaces:**
- Consumes: all earlier tasks.
- Produces: merged/deployed web and Android APK/AAB artifacts from current main.

- [ ] **Step 1: Run `node scripts/test-payment-preparation-ui.mjs`**
- [ ] **Step 2: Run full repository CI**
- [ ] **Step 3: Review final PR diff for secrets, Firestore billing writes, billing SDK dependencies, and unrelated changes**
- [ ] **Step 4: Merge only after clean CI/review**
- [ ] **Step 5: Verify Firebase production deployment succeeds including Hosting**
- [ ] **Step 6: Run/verify Android build on merged main and retain generated APK/AAB artifacts**
- [ ] **Step 7: Report exact merge SHA, deploy run, and Android artifact status**
