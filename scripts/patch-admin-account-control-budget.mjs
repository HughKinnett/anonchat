import { readFile, writeFile } from "node:fs/promises";

const path = "firestore.rules";
const before = await readFile(path, "utf8");
const oldFunctions = `    function validStandaloneAdminBan(userId) {
      return isAdmin()
        && !isProtectedAdministrator(resource.data.username)
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['banned'])
        && request.resource.data.banned is bool
        && (request.resource.data.banned == true
          || (hasNoDeletionQueueState(resource.data)
            && !exists(/databases/$(database)/documents/adminDeletionJobs/$(userId))));
    }

    function validStandaloneAdminSuspension(userId) {
      return isAdmin()
        && !isProtectedAdministrator(resource.data.username)
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['suspendedUntil'])
        && request.resource.data.suspendedUntil is timestamp;
    }`;
const newFunction = `    function validStandaloneAdminAccountControl(userId) {
      let changed = request.resource.data.diff(resource.data).affectedKeys();
      return isAdmin()
        && !isProtectedAdministrator(resource.data.username)
        && (
          (changed.hasOnly(['banned'])
            && request.resource.data.banned is bool
            && (request.resource.data.banned == true
              || (hasNoDeletionQueueState(resource.data)
                && !exists(/databases/$(database)/documents/adminDeletionJobs/$(userId)))))
          ||
          (changed.hasOnly(['suspendedUntil'])
            && request.resource.data.suspendedUntil is timestamp)
        );
    }`;
if (!before.includes(oldFunctions)) throw new Error("admin account-control function block not found");
let after = before.replace(oldFunctions, newFunction);
after = after.replace(
`      allow update: if validStandaloneAdminBan(userId)
        || validStandaloneAdminSuspension(userId)
        || validDeletionQueueProfile(userId)`,
`      allow update: if validStandaloneAdminAccountControl(userId)
        || validDeletionQueueProfile(userId)`
);
if (after === before) throw new Error("rule budget patch made no changes");
await writeFile(path, after);
console.log("combined admin account-control rule applied");
