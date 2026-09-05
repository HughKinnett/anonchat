const httpsOrigin = (baseUrl) => {
  let parsed;
  try {
    parsed = new URL(String(baseUrl || ""));
  } catch {
    throw new Error("Profile sharing requires a valid HTTPS URL.");
  }
  if (parsed.protocol !== "https:") throw new Error("Profile sharing requires HTTPS.");
  return parsed.origin;
};

export function buildCanonicalProfileUrl(profileId, baseUrl) {
  const id = String(profileId || "").trim();
  if (!id) throw new Error("A profile id is required.");
  return `${httpsOrigin(baseUrl)}/profile.html?uid=${encodeURIComponent(id)}`;
}

export function buildProfileShareData({ profileId, username, baseUrl } = {}) {
  const url = buildCanonicalProfileUrl(profileId, baseUrl);
  const handle = String(username || "").trim();
  return {
    title: "AnonChat profile",
    text: handle ? `View @${handle} on AnonChat.` : "View this profile on AnonChat.",
    url
  };
}

export function safeProfileQrPayload({ profileId, baseUrl } = {}) {
  return buildCanonicalProfileUrl(profileId, baseUrl);
}
