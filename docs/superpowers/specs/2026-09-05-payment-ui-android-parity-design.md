# Payment UI and Android Parity Design

## Goal
Prepare AnonChat's user and admin payment interfaces and rebuild Android with all current web updates, while keeping billing disconnected from Stripe APIs, Firestore billing data, and Google Play Billing.

## User experience
- Premium page shows plan price, billing frequency selector, name/email/card-style payment placeholders, current plan/status, and a Subscribe button.
- All payment controls are visibly preparation-only and cannot submit or charge.
- Existing Premium entitlement reads remain unchanged.
- No card number, CVV, payment method, or secret is persisted.

## Admin experience
- Add a Payments / Premium billing section to the admin dashboard.
- Show inert fields for Stripe publishable key placeholder, product/price IDs, monthly/annual display prices, provider mode, Google Play billing state, test/live indicator, subscription/failed-payment placeholders, and disabled checkout controls.
- Admin controls do not write to Firestore or external services in this phase.

## Android
- Preserve the Trusted Web Activity architecture so the Android app loads the current hosted AnonChat experience.
- Rebuild the Android package after the web changes are merged/deployed so the packaged release reflects the current production site and current native wrapper.
- Do not add Google Play Billing SDK or Stripe SDK in this phase.

## Security
- Never embed Stripe secret keys, webhook secrets, Google service credentials, or card data in browser/Android code.
- The existing Stripe client config remains checkout-disabled.

## Testing
- Add static regression tests confirming payment UI exists, remains disabled/inert, contains no Firestore writes or billing SDK hooks, and Android has no billing dependency.
- Run the existing full CI and Android build workflow before merge/release.