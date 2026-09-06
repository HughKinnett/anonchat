const findMatchingBrace = (source, openIndex) => {
  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  throw new Error("Unbalanced Firestore rules block.");
};

const replaceMatchBlock = (source, header, replacement) => {
  const start = source.indexOf(header);
  if (start < 0) throw new Error(`Could not find Firestore rules block: ${header}`);
  const openIndex = source.indexOf("{", start + header.length - 1);
  if (openIndex < 0) throw new Error(`Could not find opening brace for: ${header}`);
  const end = findMatchingBrace(source, openIndex);
  return `${source.slice(0, start)}${replacement}${source.slice(end + 1)}`;
};

const denyAll = (header) => `${header}\n      allow read, write: if false;\n    }`;

export const hardenRetiredFeatureRules = (input) => {
  let rules = String(input || "");

  for (const header of [
    "    match /groups/{groupId} {",
    "    match /groups/{groupId}/members/{userId} {",
    "    match /groups/{groupId}/privateGroupMessages/{messageId} {",
    "    match /communities/{communityId} {",
    "    match /communities/{communityId}/members/{userId} {",
    "    match /communities/{communityId}/badges/{badgeId} {",
    "    match /communities/{communityId}/members/{userId}/badges/{badgeId} {"
  ]) {
    rules = replaceMatchBlock(rules, header, denyAll(header));
  }

  rules = replaceMatchBlock(
    rules,
    "    match /badgeTypes/{badgeId} {",
    "    match /badgeTypes/{badgeId} {\n      allow read: if signedIn();\n      allow create, update, delete: if false;\n    }"
  );

  rules = replaceMatchBlock(
    rules,
    "    match /users/{userId}/badges/{badgeId} {",
    "    match /users/{userId}/badges/{badgeId} {\n      allow read: if profileBadgesReadable(userId);\n      allow create, update, delete: if false;\n    }"
  );

  return rules;
};
