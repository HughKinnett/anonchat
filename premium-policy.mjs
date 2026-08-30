export const PREMIUM_PRICE_USD = 4.99;
export const PREMIUM_TIERS = Object.freeze(["founder", "founding", "subscriber"]);
export const PREMIUM_ACCENTS = Object.freeze(["violet", "rose", "ocean", "emerald"]);
export const PREMIUM_FRAMES = Object.freeze(["glow", "double", "minimal"]);
export const PREMIUM_CARDS = Object.freeze(["glass", "solid", "outline"]);
export const PREMIUM_BANNERS = Object.freeze(["midnight", "aurora", "ember"]);

export const hasPremiumAccess = (record) => Boolean(record
  && record.status === "active"
  && PREMIUM_TIERS.includes(record.tier));

export const premiumLabel = (record) => record?.tier === "founder"
  ? "Founder"
  : record?.tier === "founding"
    ? "Founding Member"
    : "Premium Member";

export const premiumDefaults = (uid) => ({
  uid,
  onlineVisible: true,
  accent: "violet",
  profileFrame: "glow",
  cardStyle: "glass",
  bannerStyle: "midnight"
});

export const validPremiumSettings = (value, uid) => Boolean(value
  && value.uid === uid
  && typeof value.onlineVisible === "boolean"
  && PREMIUM_ACCENTS.includes(value.accent)
  && PREMIUM_FRAMES.includes(value.profileFrame)
  && PREMIUM_CARDS.includes(value.cardStyle)
  && PREMIUM_BANNERS.includes(value.bannerStyle));
