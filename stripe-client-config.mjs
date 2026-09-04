export const stripeClientConfig = Object.freeze({
  publishableKey: "pk_live_51UAyXEAMBTVkQSHXJyun33VbqTRxtuXiqmMnUyJGWp6y7J1BcUML8yCeBWvcDsu02ailRtiN1kVRnPIeVy35oWjH00QrRRwGBj",
  productId: "",
  priceId: "",
  checkoutEnabled: false,
  checkoutMode: "disabled",
  successUrl: "https://anonchatlogin.web.app/premium.html?checkout=success",
  cancelUrl: "https://anonchatlogin.web.app/premium.html?checkout=cancelled"
});

export const emptyStripeBillingFields = () => ({
  customerId: "",
  subscriptionId: "",
  subscriptionStatus: "",
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  latestInvoiceId: "",
  paymentIntentId: "",
  checkoutSessionId: "",
  webhookEventId: ""
});

export const stripeSetupReady = () => (
  stripeClientConfig.publishableKey.startsWith("pk_") &&
  stripeClientConfig.checkoutEnabled === false &&
  stripeClientConfig.checkoutMode === "disabled"
);
