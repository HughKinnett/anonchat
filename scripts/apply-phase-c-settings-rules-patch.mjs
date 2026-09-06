import { readFile, writeFile } from 'node:fs/promises';

const path = new URL('../firestore.rules', import.meta.url);
let rules = await readFile(path, 'utf8');

const validator = `    function validUserSettings(settings) {
      let notifications = settings.notifications;
      let quietHours = settings.quietHours;
      return settings.keys().hasOnly(['messageRequestMode', 'notifications', 'pauseAllNotifications', 'quietHours', 'theme', 'reduceMotion', 'textSize', 'highContrast'])
        && settings.keys().hasAll(['messageRequestMode', 'notifications', 'pauseAllNotifications', 'quietHours', 'theme', 'reduceMotion', 'textSize', 'highContrast'])
        && settings.messageRequestMode in ['everyone', 'following', 'none']
        && notifications is map
        && notifications.keys().hasOnly(['reactions', 'comments', 'privateMessages', 'messageRequests', 'communityChatrooms', 'mentions', 'mutualRevealRequests'])
        && notifications.keys().hasAll(['reactions', 'comments', 'privateMessages', 'messageRequests', 'communityChatrooms', 'mentions', 'mutualRevealRequests'])
        && notifications.reactions is bool && notifications.comments is bool
        && notifications.privateMessages is bool && notifications.messageRequests is bool
        && notifications.communityChatrooms is bool && notifications.mentions is bool
        && notifications.mutualRevealRequests is bool
        && settings.pauseAllNotifications is bool
        && quietHours is map && quietHours.keys().hasOnly(['enabled', 'start', 'end'])
        && quietHours.keys().hasAll(['enabled', 'start', 'end']) && quietHours.enabled is bool
        && quietHours.start is string && quietHours.start.matches('^(?:[01][0-9]|2[0-3]):[0-5][0-9]$')
        && quietHours.end is string && quietHours.end.matches('^(?:[01][0-9]|2[0-3]):[0-5][0-9]$')
        && settings.theme in ['system', 'light', 'dark'] && settings.reduceMotion is bool
        && settings.textSize in ['small', 'default', 'large', 'extra-large'] && settings.highContrast is bool;
    }

`;

const settingsRule = `    match /users/{userId}/private/settings {
      allow read: if signedIn() && request.auth.uid == userId;
      allow create, update: if activeUserAfter() && request.auth.uid == userId && validUserSettings(request.resource.data);
      allow delete: if signedIn() && request.auth.uid == userId;
    }

`;

if (!rules.includes('function validUserSettings(settings)')) {
  const anchor = '    function validPhaseBPostEdit() {';
  if (!rules.includes(anchor)) throw new Error('validator insertion anchor not found');
  rules = rules.replace(anchor, validator + anchor);
}

if (rules.includes('match /users/{userId}/private/settings/preferences')) {
  rules = rules.replace('match /users/{userId}/private/settings/preferences', 'match /users/{userId}/private/settings');
}

if (!rules.includes('match /users/{userId}/private/settings')) {
  const anchor = '    match /users/{userId} {';
  if (!rules.includes(anchor)) throw new Error('settings rule insertion anchor not found');
  rules = rules.replace(anchor, settingsRule + anchor);
}

await writeFile(path, rules);
console.log('Phase C settings rules patch applied');
