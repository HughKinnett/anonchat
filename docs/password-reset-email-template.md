# AnonChat password-reset email

Configure Firebase Authentication → Templates → Password reset with:

- Sender name: `AnonChat Security`
- Subject: `Reset your AnonChat password`
- Message:

  `ANONCHAT`

  `Hi %DISPLAY_NAME%,`

  `We received a request to reset the password for %EMAIL%. Use the secure link below to choose a new password:`

  `%LINK%`

  `If you did not request this, you can safely ignore this email. Your password will not change.`

  `— AnonChat Security`

Firebase's built-in sender has limited layout customization. A true image logo inside the email requires generating the reset link with Firebase Admin and sending through a separate trusted email provider. The free reset page itself displays the AnonChat logo.
