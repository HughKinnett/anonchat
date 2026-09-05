export const paymentPreparationDefaults = Object.freeze({
  monthlyDisplayPrice: "$4.99",
  annualDisplayPrice: "Not configured",
  providerStatus: "Not connected",
  googlePlayStatus: "Not connected",
  billingMode: "Preparation only",
  checkoutEnabled: false,
  subscriptionCount: "Not connected",
  failedPaymentCount: "Not connected"
});

export const paymentPreparationStatus = () => ({
  ...paymentPreparationDefaults,
  message: "Payments are not connected yet. No payment information will be submitted or saved."
});

export const paymentPreparationIsInert = () => paymentPreparationDefaults.checkoutEnabled === false;
