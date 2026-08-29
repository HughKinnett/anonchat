const requiredDocumentId = (value) => {
  if (typeof value !== "string" || value.length === 0) throw new TypeError("A post document ID is required");
  return value;
};

const MAX_POST_IMAGE_DATA_LENGTH = 800_000;
const TRUSTED_POST_IMAGE = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/;

export const postImagePresentation = (imageData, alt) => {
  if (imageData == null || imageData === "") return { kind: "none" };
  if (typeof imageData === "string"
    && imageData.length <= MAX_POST_IMAGE_DATA_LENGTH
    && TRUSTED_POST_IMAGE.test(imageData)) {
    return { kind: "image", src: imageData, alt, referrerPolicy: "no-referrer" };
  }
  return { kind: "placeholder", text: "Image unavailable" };
};

export const postExpirySelection = (hoursValue, now = Date.now()) => {
  const hours = Number(hoursValue);
  if (!Number.isFinite(hours) || hours <= 0) return null;
  return now + hours * 3_600_000;
};

export const postExpiryTimestamp = (expiresAtMillis, fromMillis) => {
  if (expiresAtMillis == null) return null;
  if (!Number.isFinite(expiresAtMillis) || typeof fromMillis !== "function") {
    throw new TypeError("A valid cached expiry and timestamp factory are required");
  }
  return fromMillis(expiresAtMillis);
};

export const createReportSubmissionGate = () => {
  let activeToken = null;
  let sequence = 0;
  return Object.freeze({
    tryStart(request) {
      if (activeToken) return null;
      activeToken = Object.freeze({ sequence: ++sequence, request });
      return activeToken;
    },
    finish(token) {
      if (token !== activeToken) return false;
      activeToken = null;
      return true;
    },
    isBusy: () => activeToken !== null
  });
};

export const postInteractionTarget = (post) => requiredDocumentId(post?.id);

export const postDocumentKey = ({ id, collectionName }) =>
  `${collectionName}/${requiredDocumentId(id)}`;

export const postChildBelongsTo = (post, child) =>
  requiredDocumentId(post?.id) === child?.postId
  && post?.collectionName === child?.collectionName;

export const postReportTarget = ({ id, collectionName, post }) => {
  const targetType = collectionName === "communityPosts" ? "communityPost" : "post";
  return {
    id: requiredDocumentId(id),
    collectionName: targetType === "communityPost" ? "communityPosts" : "posts",
    targetType,
    targetKey: targetType,
    authorId: post?.authorId
  };
};
