export const normalizePostMedia = (input = []) =>
  (Array.isArray(input) ? input : [])
    .map((item) => ({
      type: String(item?.type || "").trim().toLowerCase(),
      url: String(item?.url || "").trim()
    }));

export const validatePostMedia = (input = []) => {
  const media = normalizePostMedia(input);
  if (media.some((item) => !item.url || !["image", "gif"].includes(item.type))) {
    return { ok: false, reason: "invalid-media" };
  }
  const images = media.filter((item) => item.type === "image");
  const gifs = media.filter((item) => item.type === "gif");
  if (gifs.length > 1) return { ok: false, reason: "one-gif-maximum" };
  if (images.length > 4) return { ok: false, reason: "four-images-maximum" };
  if (gifs.length && images.length) return { ok: false, reason: "gif-or-images" };
  return { ok: true, reason: "" };
};
