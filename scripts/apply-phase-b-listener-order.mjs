import fs from "node:fs";

const path = "timeline.js";
let source = fs.readFileSync(path, "utf8");

const declaration = `  const listenForSession = (reference, next, failed) => onSnapshot(
    reference,
    (snapshot) => { if (sessionIsCurrent()) next(snapshot); },
    (error) => { if (sessionIsCurrent()) failed?.(error); }
  );

`;
const anchor = `  listeners.push(clearPollVoteListeners);
  listeners.push(clearInteractionListeners);
`;

if (!source.includes(declaration)) throw new Error("Could not locate listenForSession declaration");
if (!source.includes(anchor)) throw new Error("Could not locate timeline listener anchor");

source = source.replace(declaration, "");
source = source.replace(anchor, `${declaration}${anchor}`);

fs.writeFileSync(path, source);
console.log("Moved listenForSession before its first use");
