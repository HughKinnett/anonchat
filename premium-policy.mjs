export const PREMIUM_PRICE_USD = 4.99;
export const PREMIUM_TIERS = Object.freeze(["founder", "founding", "subscriber"]);
export const PREMIUM_ACCENTS = Object.freeze(["violet", "rose", "ocean", "emerald"]);
export const PREMIUM_FRAMES = Object.freeze(["glow", "double", "minimal"]);
export const PREMIUM_CARDS = Object.freeze(["glass", "solid", "outline"]);
export const PREMIUM_BANNERS = Object.freeze(["midnight", "aurora", "ember"]);
export const PREMIUM_COLORS = Object.freeze({
  black: Object.freeze({ label: "Black", background: "#111318", text: "#ffffff" }),
  white: Object.freeze({ label: "White", background: "#f4f4f5", text: "#111318" }),
  gray: Object.freeze({ label: "Gray", background: "#4b5563", text: "#ffffff" }),
  red: Object.freeze({ label: "Red", background: "#b91c1c", text: "#ffffff" }),
  orange: Object.freeze({ label: "Orange", background: "#c2410c", text: "#ffffff" }),
  yellow: Object.freeze({ label: "Yellow", background: "#facc15", text: "#111318" }),
  green: Object.freeze({ label: "Green", background: "#15803d", text: "#ffffff" }),
  blue: Object.freeze({ label: "Blue", background: "#1d4ed8", text: "#ffffff" }),
  purple: Object.freeze({ label: "Purple", background: "#7e22ce", text: "#ffffff" }),
  pink: Object.freeze({ label: "Pink", background: "#be185d", text: "#ffffff" }),
  brown: Object.freeze({ label: "Brown", background: "#78350f", text: "#ffffff" }),
  teal: Object.freeze({ label: "Teal", background: "#0f766e", text: "#ffffff" })
});
export const PREMIUM_COLOR_NAMES = Object.freeze(Object.keys(PREMIUM_COLORS));

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
  bannerStyle: "midnight",
  chatBubbleColor: "purple",
  timelineFeedColor: "black",
  communityBackgroundColor: "black",
  privateBoxColor: "gray",
  privateChatBubbleColor: "purple",
  temporaryChatBubbleColor: "teal"
});

export const validPremiumSettings = (value, uid) => Boolean(value
  && value.uid === uid
  && typeof value.onlineVisible === "boolean"
  && PREMIUM_ACCENTS.includes(value.accent)
  && PREMIUM_FRAMES.includes(value.profileFrame)
  && PREMIUM_CARDS.includes(value.cardStyle)
  && PREMIUM_BANNERS.includes(value.bannerStyle)
  && PREMIUM_COLOR_NAMES.includes(value.chatBubbleColor)
  && PREMIUM_COLOR_NAMES.includes(value.timelineFeedColor)
  && PREMIUM_COLOR_NAMES.includes(value.communityBackgroundColor)
  && PREMIUM_COLOR_NAMES.includes(value.privateBoxColor)
  && PREMIUM_COLOR_NAMES.includes(value.privateChatBubbleColor)
  && PREMIUM_COLOR_NAMES.includes(value.temporaryChatBubbleColor));
