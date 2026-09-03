export const buildPostShareUrl = ({ pageUrl, postKey }) => {
  const url = new URL(pageUrl);
  url.hash = `shared-post=${encodeURIComponent(String(postKey || ""))}`;
  return url.toString();
};

export const parseSharedPostKey = (pageUrl) => {
  const hash = new URL(pageUrl).hash.replace(/^#/, "");
  if (!hash.startsWith("shared-post=")) return "";
  try { return decodeURIComponent(hash.slice("shared-post=".length)); } catch { return ""; }
};

export const spotifyPlaylistIdFromEmbed = (value) => {
  try {
    const url = new URL(String(value || ""));
    if (!/(^|\.)spotify\.com$/i.test(url.hostname)) return "";
    return url.pathname.match(/^\/embed\/playlist\/([A-Za-z0-9]+)(?:\/|$)/)?.[1] || "";
  } catch {
    return "";
  }
};

export const privacySafeSpotifyUrl = (playlistId) =>
  playlistId ? `https://open.spotify.com/playlist/${playlistId}` : "";

export const stablePostKey = (value) => {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  let hash = 2166136261;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};
