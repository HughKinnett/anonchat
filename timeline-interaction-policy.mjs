import { interactionParentForPost } from "./interaction-parent-policy.mjs";

export const MAX_INTERACTION_PARENTS = 40;
export const MAX_INTERACTION_ITEMS_PER_PARENT = 50;
export const MAX_INTERACTION_LISTENERS = MAX_INTERACTION_PARENTS * 4;
export const MAX_INTERACTION_DOCUMENTS = MAX_INTERACTION_PARENTS
  * ((MAX_INTERACTION_ITEMS_PER_PARENT * 2) + 2);

export const boundedInteractionCount = (count, truncated) =>
  `${Math.max(0, Number(count) || 0)}${truncated ? " shown" : ""}`;

export const interactionParentLoadState = (entry) => {
  if (!entry) return "planned";
  if (entry.unavailable) return "unavailable";
  if (!entry.childrenStarted) return "planned";
  if (!entry.ready?.reactions || !entry.ready?.comments || !entry.ready?.viewerReaction) return "loading";
  return "bounded";
};

export const interactionParentStateMessage = (state) => ({
  unavailable: "Interactions could not load. Retry.",
  planned: "Loading interactions…",
  loading: "Loading interactions…"
}[state] || "");

export const timelineInteractionPlan = (posts) => {
  const parents = new Map();
  for (const post of posts) {
    const parent = interactionParentForPost(post);
    if (!parents.has(parent.path)) parents.set(parent.path, parent);
  }
  return [...parents.values()];
};