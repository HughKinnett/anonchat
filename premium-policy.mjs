export const PREMIUM_PRICE_USD = 4.99;
export const PREMIUM_TIERS = Object.freeze(["founder", "founding", "subscriber"]);
export const PREMIUM_ACCENTS = Object.freeze(["violet", "rose", "ocean", "emerald"]);
export const PREMIUM_FRAMES = Object.freeze(["glow", "double", "minimal"]);
export const PREMIUM_CARDS = Object.freeze(["glass", "solid", "outline"]);
export const PREMIUM_BANNERS = Object.freeze(["midnight", "aurora", "ember"]);

const swatch = (label, group, background, text = "#ffffff") => Object.freeze({ label, group, background, text });
export const PREMIUM_SWATCHES = Object.freeze({
  black: swatch("Black", "Basic", "#111318"), white: swatch("White", "Basic", "#f4f4f5", "#111318"),
  gray: swatch("Gray", "Basic", "#4b5563"), silver: swatch("Silver", "Basic", "#9ca3af", "#111318"),
  red: swatch("Red", "Basic", "#b91c1c"), orange: swatch("Orange", "Basic", "#c2410c"),
  yellow: swatch("Yellow", "Basic", "#facc15", "#111318"), green: swatch("Green", "Basic", "#15803d"),
  blue: swatch("Blue", "Basic", "#1d4ed8"), purple: swatch("Purple", "Basic", "#7e22ce"),
  pink: swatch("Pink", "Basic", "#be185d"), brown: swatch("Brown", "Basic", "#78350f"),
  teal: swatch("Teal", "Basic", "#0f766e"), navy: swatch("Navy", "Basic", "#172554"),
  neonPink: swatch("Neon Pink", "Neon", "#ff1493"), neonPurple: swatch("Neon Purple", "Neon", "#9d00ff"),
  neonBlue: swatch("Neon Blue", "Neon", "#006cff"), neonCyan: swatch("Neon Cyan", "Neon", "#00d9ff", "#07131b"),
  neonGreen: swatch("Neon Green", "Neon", "#39ff14", "#07130a"), neonYellow: swatch("Neon Yellow", "Neon", "#efff00", "#111318"),
  neonOrange: swatch("Neon Orange", "Neon", "#ff5f1f"), neonRed: swatch("Neon Red", "Neon", "#ff3131"),
  sunset: swatch("Sunset", "Dual Color", "linear-gradient(135deg,#ff512f,#dd2476)"),
  oceanGlow: swatch("Ocean Glow", "Dual Color", "linear-gradient(135deg,#0061ff,#60efff)", "#07131b"),
  purpleRain: swatch("Purple Rain", "Dual Color", "linear-gradient(135deg,#7f00ff,#e100ff)"),
  fireIce: swatch("Fire & Ice", "Dual Color", "linear-gradient(135deg,#ff3d00,#00b8ff)"),
  limeSky: swatch("Lime Sky", "Dual Color", "linear-gradient(135deg,#32ff7e,#18dcff)", "#07131b"),
  candy: swatch("Candy", "Dual Color", "linear-gradient(135deg,#ff6ec4,#7873f5)"),
  midnightTeal: swatch("Midnight Teal", "Dual Color", "linear-gradient(135deg,#0f2027,#2c5364)"),
  goldPurple: swatch("Gold Purple", "Dual Color", "linear-gradient(135deg,#f7971e,#7f00ff)"),
  redBlack: swatch("Red Black", "Dual Color", "linear-gradient(135deg,#e52d27,#111318)"),
  galaxy: swatch("Galaxy", "Dual Color", "linear-gradient(135deg,#141e30,#8e2de2)"),
  watermelon: swatch("Watermelon", "Dual Color", "linear-gradient(135deg,#00b09b,#ff416c)"),
  royal: swatch("Royal", "Dual Color", "linear-gradient(135deg,#1d2b64,#f8cdda)", "#111318")
});
export const PREMIUM_COLOR_NAMES = Object.freeze(Object.keys(PREMIUM_SWATCHES));
export const PREMIUM_COLORS = PREMIUM_SWATCHES;
export const PREMIUM_AVATARS = Object.freeze(["none", ...Array.from({ length: 12 }, (_, index) => `avatar-${index + 1}`), ...Array.from({ length: 12 }, (_, index) => `female-${index + 1}`)]);
export const PREMIUM_COVERS = Object.freeze(["none", ...Array.from({ length: 12 }, (_, index) => `cover-${index + 1}`)]);
export const PREMIUM_SURFACE_FIELDS = Object.freeze({
  pageColor: "Page background", headerColor: "Header", menuColor: "Hamburger menu",
  profileColor: "Profile area", composerColor: "Post composer", timelineColor: "Timeline area",
  postColor: "Post cards", buttonColor: "Buttons", inputColor: "Text boxes",
  textColor: "Main text", commentColor: "Comments and replies", privateBoxColor: "Private-message box",
  privateChatBubbleColor: "Private-chat bubbles", temporaryBoxColor: "Temporary-room box",
  temporaryChatBubbleColor: "Temporary-room bubbles"
});

export const hasPremiumAccess = record => Boolean(record && record.status === "active" && PREMIUM_TIERS.includes(record.tier));
export const premiumLabel = record => record?.tier === "founder" ? "Founder" : record?.tier === "founding" ? "Founding Member" : "Premium Member";

export const premiumDefaults = uid => ({
  uid, onlineVisible: true, spotifyPlaylistUrl: "", avatarId: "none", coverId: "none", accent: "violet", profileFrame: "glow", cardStyle: "glass", bannerStyle: "midnight",
  pageColor: "black", headerColor: "black", menuColor: "purple", profileColor: "navy", composerColor: "gray",
  timelineColor: "black", postColor: "navy", buttonColor: "purple", inputColor: "black", textColor: "white",
  commentColor: "purple", privateBoxColor: "black", privateChatBubbleColor: "purple", temporaryBoxColor: "black",
  temporaryChatBubbleColor: "teal", chatBubbleColor: "purple", timelineFeedColor: "black", communityBackgroundColor: "black"
});

export const validPremiumSettings = (value, uid) => Boolean(value && value.uid === uid
  && typeof value.spotifyPlaylistUrl === "string" && value.spotifyPlaylistUrl.length <= 220
  && (value.spotifyPlaylistUrl === "" || /^https:\/\/open[.]spotify[.]com\/playlist\/[A-Za-z0-9]+$/.test(value.spotifyPlaylistUrl))
  && typeof value.onlineVisible === "boolean" && PREMIUM_AVATARS.includes(value.avatarId) && PREMIUM_COVERS.includes(value.coverId)
  && PREMIUM_ACCENTS.includes(value.accent) && PREMIUM_FRAMES.includes(value.profileFrame)
  && PREMIUM_CARDS.includes(value.cardStyle) && PREMIUM_BANNERS.includes(value.bannerStyle)
  && Object.keys(PREMIUM_SURFACE_FIELDS).every(field => PREMIUM_COLOR_NAMES.includes(value[field])));
