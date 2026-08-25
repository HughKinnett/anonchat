# AnonChat

A pseudonymous social timeline using Firebase Authentication and Cloud Firestore. The original visual design is preserved.

## Firebase setup

1. Open the Firebase project named `anonchatlogin`.
2. In **Authentication → Sign-in method**, enable **Email/Password**.
3. Create the **Cloud Firestore** database.
4. Install the Firebase CLI and sign in.
5. Deploy the security rules with `firebase deploy --only firestore:rules`.
6. Serve the site over HTTP. Firebase Hosting can be deployed with `firebase deploy --only hosting`.

Passwords are managed by Firebase Authentication and are never written to Firestore. Email addresses are used only to sign in and are never displayed in posts. Users appear under unique pseudonymous usernames.

## Data model

- `usernames/{normalizedUsername}`: reserves each anonymous handle
- `users/{uid}`: `uid`, `username`, `createdAt`
- `posts/{postId}`: `authorId`, `username`, `content`, `createdAt`
- `posts/{postId}/reactions/{uid}`: one ❤️ or 🖕 reaction per user

The included rules require authentication, cap posts at 500 characters, prevent handle impersonation, and restrict post deletion to its author. Reaction counts are shown, but the interface does not display who reacted.
