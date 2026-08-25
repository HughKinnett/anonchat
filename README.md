# AnonChat

A static social timeline using Firebase Authentication and Cloud Firestore.

## Firebase setup

1. Open the Firebase project named `anonchatlogin`.
2. In **Authentication → Sign-in method**, enable **Email/Password**.
3. Create the **Cloud Firestore** database.
4. Install the Firebase CLI and sign in.
5. From this repository, deploy the security rules with:

   `firebase deploy --only firestore:rules`

6. Serve the site over HTTP (not by opening the HTML file directly). Firebase Hosting can be deployed with:

   `firebase deploy --only hosting`

Passwords are managed by Firebase Authentication and are never written to Firestore. Firestore stores only user profiles and posts.

## Data model

- `users/{uid}`: `uid`, `username`, `createdAt`
- `posts/{postId}`: `authorId`, `username`, `content`, `createdAt`

The included rules require authentication, cap post length at 500 characters, and allow only a post's author to delete it.
