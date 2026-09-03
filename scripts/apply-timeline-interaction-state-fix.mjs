import { readFile, writeFile } from "node:fs/promises";

const path = new URL("../timeline.js", import.meta.url);
let source = await readFile(path, "utf8");

const replaceOnce = (before, after, label) => {
  if (source.includes(after)) return;
  const occurrences = source.split(before).length - 1;
  if (occurrences !== 1) throw new Error(`${label}: expected exactly one source match, found ${occurrences}`);
  source = source.replace(before, after);
};

replaceOnce(
`  boundedInteractionCount,\n  interactionParentLoadState,\n  MAX_INTERACTION_ITEMS_PER_PARENT,`,
`  boundedInteractionCount,\n  interactionParentLoadState,\n  interactionParentStateMessage,\n  MAX_INTERACTION_ITEMS_PER_PARENT,`,
"interaction state message import"
);

replaceOnce(
`  const reactionDocs = postReactions(postDoc);\n  const reactionsTruncated = interactionIsTruncated(parent.path, "reactions");`,
`  const interactionEntry = interactionSubscriptions.get(parent.path);\n  const reactionDocs = postReactions(postDoc);\n  const interactionState = interactionParentLoadState(interactionSubscriptions.get(parent.path));\n  const reactionsReady = Boolean(interactionEntry?.ready?.reactions && interactionEntry?.ready?.viewerReaction);\n  const commentsReady = Boolean(interactionEntry?.ready?.comments);\n  const reactionsTruncated = interactionIsTruncated(parent.path, "reactions");`,
"explicit per-parent interaction state"
);

replaceOnce(
`  const reactionTotal = boundedInteractionCount(count, reactionsTruncated);\n  interactionSummaryLabel.textContent = \`${'${activeReactionIcons ? `${activeReactionIcons} · ` : ""}'}${'${reactionTotal}'}\`;\n  interactionSummaryLabel.setAttribute("aria-label",\n    \`${'${reactionTotal}'} interaction${'${count === 1 ? "" : "s"}'}. Show who interacted.\`);`,
`  const reactionTotal = boundedInteractionCount(count, reactionsTruncated);\n  if (reactionsReady) {\n    interactionSummaryLabel.textContent = \`${'${activeReactionIcons ? `${activeReactionIcons} · ` : ""}'}${'${reactionTotal}'}\`;\n    interactionSummaryLabel.setAttribute("aria-label",\n      \`${'${reactionTotal}'} interaction${'${count === 1 ? "" : "s"}'}. Show who interacted.\`);\n  } else {\n    interactionSummaryLabel.textContent = interactionParentStateMessage(interactionState);\n    interactionSummaryLabel.setAttribute("aria-label", interactionParentStateMessage(interactionState));\n  }`,
"truthful reaction summary while loading"
);

replaceOnce(
`  let commentsSection;\n  {\n    const commentDocs = postComments(postDoc);`,
`  let commentsSection;\n  if (commentsReady) {\n    const commentDocs = postComments(postDoc);`,
"comment readiness guard"
);

replaceOnce(
`  commentsSection.append(commentsSummary, commentsList, commentForm);\n  }\n\n  const actions = document.createElement("div");`,
`  commentsSection.append(commentsSummary, commentsList, commentForm);\n  } else if (interactionState === "unavailable") {\n    commentsSection = document.createElement("div");\n    commentsSection.hidden = true;\n  } else {\n    commentsSection = document.createElement("p");\n    commentsSection.className = "interaction-load-state muted";\n    commentsSection.textContent = interactionParentStateMessage(interactionState);\n  }\n\n  const actions = document.createElement("div");`,
"comment loading state UI"
);

await writeFile(path, source);
console.log("Timeline interaction state fix applied");
