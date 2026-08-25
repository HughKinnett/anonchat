# AnonChat

A responsive pseudonymous social timeline using Firebase Authentication and Cloud Firestore.

## Features

- unique anonymous handles; email addresses are never displayed
- original posts with live ❤️ and 🖕 reaction counts
- follow/unfollow controls with live follower totals beside each author
- secure reposts to a user's profile without changing the original author's words
- Timeline and My profile views
- responsive desktop and mobile layouts
- installable Progressive Web App with an offline app shell

## Firebase setup

1. Open the Firebase project named `anonchatlogin`.
2. In **Authentication → Sign-in method**, enable **Email/Password**.
3. Create the **Cloud Firestore** database.
4. Install the Firebase CLI and sign in.
5. Deploy the security rules with `firebase deploy --only firestore:rules`.
6. Deploy the HTTPS site with `firebase deploy --only hosting`.

Passwords are managed by Firebase Authentication and are never written to Firestore. Users appear under unique pseudonymous usernames.

## Installing the app

The **Install app** button opens the browser's native installation prompt on supported Android and desktop browsers. On iPhone and iPad, it explains how to use **Share → Add to Home Screen**. App installation and service workers require HTTPS (Firebase Hosting provides it).

## Data model

- `usernames/{normalizedUsername}`: reserves each anonymous handle
- `users/{uid}`: `uid`, `username`, `createdAt`
- `follows/{followerId_followingId}`: one validated follow relationship per user pair
- `posts/{postId}`: an original post or a validated repost
- `posts/{postId}/reactions/{uid}`: one ❤️ or 🖕 reaction per user

The included rules require authentication, cap original posts at 500 characters, prevent handle impersonation, verify reposts against their original posts, and restrict deletion to the post or repost owner.
