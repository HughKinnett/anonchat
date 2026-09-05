import { readFile, writeFile } from "node:fs/promises";

async function patch(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after === before) return false;
  await writeFile(path, after);
  return true;
}

await patch("firestore.rules", rules => {
  let out = rules;
  out = out.replace(
`    function accountNotSuspended(uid) {
      return !exists(/databases/$(database)/documents/accountModeration/$(uid))
        || !get(/databases/$(database)/documents/accountModeration/$(uid)).data.keys().hasAny(['suspendedUntil'])
        || get(/databases/$(database)/documents/accountModeration/$(uid)).data.suspendedUntil <= request.time;
    }`,
`    function accountNotSuspended(profile) {
      return !profile.keys().hasAny(['suspendedUntil'])
        || profile.suspendedUntil <= request.time;
    }`);

  out = out.replace(
`    function activeUserAfter() {
      return signedIn()
        && accountAvailableAfter(request.auth.uid)
        && getAfter(/databases/$(database)/documents/users/$(request.auth.uid)).data.get('banned', false) != true
        && accountNotSuspended(request.auth.uid);
    }`,
`    function activeUserAfter() {
      let profile = getAfter(/databases/$(database)/documents/users/$(request.auth.uid)).data;
      return signedIn()
        && accountAvailableAfter(request.auth.uid)
        && profile.get('banned', false) != true
        && accountNotSuspended(profile);
    }`);

  out = out.replace(
`    function activeUser() {
      return signedIn()
        && accountAvailable(request.auth.uid)
        && get(/databases/$(database)/documents/users/$(request.auth.uid)).data.get('banned', false) != true
        && accountNotSuspended(request.auth.uid);
    }`,
`    function activeUser() {
      let profile = get(/databases/$(database)/documents/users/$(request.auth.uid)).data;
      return signedIn()
        && accountAvailable(request.auth.uid)
        && profile.get('banned', false) != true
        && accountNotSuspended(profile);
    }`);

  const banFn = `    function validStandaloneAdminBan(userId) {
      return isAdmin()
        && !isProtectedAdministrator(resource.data.username)
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['banned'])
        && request.resource.data.banned is bool
        && (request.resource.data.banned == true
          || (hasNoDeletionQueueState(resource.data)
            && !exists(/databases/$(database)/documents/adminDeletionJobs/$(userId))));
    }`;
  const suspensionFn = banFn + `\n\n    function validStandaloneAdminSuspension(userId) {\n      return isAdmin()\n        && !isProtectedAdministrator(resource.data.username)\n        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['suspendedUntil'])\n        && request.resource.data.suspendedUntil is timestamp;\n    }`;
  if (!out.includes("function validStandaloneAdminSuspension")) out = out.replace(banFn, suspensionFn);
  out = out.replace("      allow update: if validStandaloneAdminBan(userId)\n        || validDeletionQueueProfile(userId)", "      allow update: if validStandaloneAdminBan(userId)\n        || validStandaloneAdminSuspension(userId)\n        || validDeletionQueueProfile(userId)");
  return out;
});

await patch("admin.js", source => {
  const oldBlock = `  try { await setDoc(doc(db,"accountModeration",user.id), { uid:user.id, suspendedUntil:until, suspensionReason:suspended?"":"24-hour administrator suspension", updatedAt:serverTimestamp(), updatedBy:adminUid }, {merge:true}); setStatus(suspended?"Suspension ended.":"Account suspended for 24 hours."); } catch { setStatus("Could not change that suspension.",true); }`;
  const newBlock = `  try { const batch=writeBatch(db); batch.set(doc(db,"accountModeration",user.id), { uid:user.id, suspendedUntil:until, suspensionReason:suspended?"":"24-hour administrator suspension", updatedAt:serverTimestamp(), updatedBy:adminUid }, {merge:true}); batch.update(doc(db,"users",user.id), { suspendedUntil:until }); await batch.commit(); setStatus(suspended?"Suspension ended.":"Account suspended for 24 hours."); } catch { setStatus("Could not change that suspension.",true); }`;
  if (!source.includes(oldBlock)) throw new Error("suspension write block not found");
  return source.replace(oldBlock, newBlock);
});

await patch("scripts/test-admin-expanded-controls.mjs", test => test
  .replace(/assert\.match\(rules, \/function accountNotSuspended\\\(uid\\\)\/[\s\S]*?\nassert\.match\(rules, \/function activeUser\\\(\\\)\/[\s\S]*?"suspended users cannot perform normal active-user writes"\);/, `assert.match(rules, /function accountNotSuspended\\(profile\\)/, "Firestore rules define a suspension gate without another document lookup");\nassert.match(rules, /function activeUser\\(\\)[\\s\\S]{0,350}get\\(\\/databases\\/\\$\\(database\\)\\/documents\\/users\\/\\$\\(request\\.auth\\.uid\\)\\)[\\s\\S]{0,250}accountNotSuspended\\(profile\\)/, "suspended users are gated from the already-loaded user profile");`));

console.log("suspension rule lookup budget fix applied");
