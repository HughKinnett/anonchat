import { compareOldestFirst } from "./content-ordering.mjs";
import { interactionParentForPost } from "./interaction-parent-policy.mjs";

const parentPath = (comment) => comment?.ref?.parent?.parent?.path || "";

export const commentsForPost = (comments, postDoc) => comments
  .filter((comment) => parentPath(comment) === interactionParentForPost(postDoc).path)
  .sort(compareOldestFirst);

export { interactionParentForPost };

export const blockedProfileStatus = () =>
  "You blocked this user. Follow and private contact are unavailable, and their posts are hidden.";
