import { readFile, writeFile } from "node:fs/promises";

const path = "firestore.rules";
let source = await readFile(path, "utf8");

const sameDirectionOld = `          (request.resource.data.diff(resource.data).affectedKeys().hasOnly(['status', 'respondedAt'])
            && resource.data.fromId == request.auth.uid
            && resource.data.status == 'declined'
            && request.resource.data.status == 'pending')`;
const sameDirectionNew = `          (request.resource.data.diff(resource.data).affectedKeys().hasOnly(['status', 'respondedAt'])
            && resource.data.fromId == request.auth.uid
            && resource.data.status == 'declined'
            && request.resource.data.status == 'pending'
            && recipientAllowsMessageRequest(resource.data.toId, resource.data.fromId))`;

const rewrittenOld = `            && request.resource.data.status == 'pending'
            && request.resource.data.createdAt == request.time)`;
const rewrittenNew = `            && request.resource.data.status == 'pending'
            && request.resource.data.createdAt == request.time
            && recipientAllowsMessageRequest(request.resource.data.toId, request.resource.data.fromId))`;

if (!source.includes(sameDirectionNew)) {
  if (!source.includes(sameDirectionOld)) throw new Error("same-direction retry rule anchor not found");
  source = source.replace(sameDirectionOld, sameDirectionNew);
}
if (!source.includes(rewrittenNew)) {
  if (!source.includes(rewrittenOld)) throw new Error("rewritten retry rule anchor not found");
  source = source.replace(rewrittenOld, rewrittenNew);
}

await writeFile(path, source);
console.log("Phase C review privacy rules patch applied");
