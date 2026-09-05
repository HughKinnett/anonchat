import { readFile, writeFile } from "node:fs/promises";

const path = new URL("../firestore.rules", import.meta.url);
let rules = await readFile(path, "utf8");

const spotifyClause = `            (request.resource.data.diff(resource.data).affectedKeys().hasOnly(['spotifyPlaylistUrl'])
              && featureEnabled('spotifyEmbedsEnabled')
              && isPremiumUidAfter(userId)
              && request.resource.data.get('spotifyPlaylistUrl', '') is string
              && request.resource.data.get('spotifyPlaylistUrl', '').size() <= 220
              && (request.resource.data.get('spotifyPlaylistUrl', '') == ''
                || request.resource.data.get('spotifyPlaylistUrl', '')
                  .matches('https://open[.]spotify[.]com/playlist/[A-Za-z0-9]+')))
          ));`;

const spotifyWithBio = `            (request.resource.data.diff(resource.data).affectedKeys().hasOnly(['spotifyPlaylistUrl'])
              && featureEnabled('spotifyEmbedsEnabled')
              && isPremiumUidAfter(userId)
              && request.resource.data.get('spotifyPlaylistUrl', '') is string
              && request.resource.data.get('spotifyPlaylistUrl', '').size() <= 220
              && (request.resource.data.get('spotifyPlaylistUrl', '') == ''
                || request.resource.data.get('spotifyPlaylistUrl', '')
                  .matches('https://open[.]spotify[.]com/playlist/[A-Za-z0-9]+')))
            ||
            (request.resource.data.diff(resource.data).affectedKeys().hasOnly(['bio'])
              && request.resource.data.get('bio', '') is string
              && request.resource.data.get('bio', '').size() <= 300)
          ));`;

if (!rules.includes("affectedKeys().hasOnly(['bio'])")) {
  if (!rules.includes(spotifyClause)) throw new Error("Could not locate user profile update clause");
  rules = rules.replace(spotifyClause, spotifyWithBio);
}

const userBlockEnd = `      allow delete: if activeUser()
          && request.auth.uid == userId
          && exists(/databases/$(database)/documents/accountDeletionRequests/$(request.auth.uid))
          && !isProtectedAdministrator(resource.data.username);
    }

    match /adminDeletionJobs/{targetUid} {`;

const badgeBlocks = `      allow delete: if activeUser()
          && request.auth.uid == userId
          && exists(/databases/$(database)/documents/accountDeletionRequests/$(request.auth.uid))
          && !isProtectedAdministrator(resource.data.username);
    }

    match /badgeTypes/{badgeId} {
      allow read: if signedIn();
      allow create, update, delete: if isAdmin();
    }

    match /users/{userId}/badges/{badgeId} {
      allow read: if signedIn();
      allow create, update, delete: if isAdmin();
    }

    match /adminDeletionJobs/{targetUid} {`;

if (!rules.includes("match /badgeTypes/{badgeId}")) {
  if (!rules.includes(userBlockEnd)) throw new Error("Could not locate users block end");
  rules = rules.replace(userBlockEnd, badgeBlocks);
}

await writeFile(path, rules);
console.log("profiles and badges Firestore patch applied");
