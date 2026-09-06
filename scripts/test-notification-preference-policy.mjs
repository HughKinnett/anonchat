import assert from 'node:assert/strict';
import {
  isQuietHoursActive,
  notificationCategoryForEvent,
  shouldDeliverPush
} from '../notification-preference-policy.mjs';
import { DEFAULT_USER_SETTINGS } from '../user-settings-policy.mjs';

assert.equal(notificationCategoryForEvent('reaction'), 'reactions');
assert.equal(notificationCategoryForEvent('comment'), 'comments');
assert.equal(notificationCategoryForEvent('private-message'), 'privateMessages');
assert.equal(notificationCategoryForEvent('message-request'), 'messageRequests');
assert.equal(notificationCategoryForEvent('room-message'), 'communityChatrooms');
assert.equal(notificationCategoryForEvent('premium-room-message'), 'communityChatrooms');
assert.equal(notificationCategoryForEvent('reveal-request'), 'mutualRevealRequests');
assert.equal(notificationCategoryForEvent('mention'), 'mentions');
assert.equal(notificationCategoryForEvent('unknown'), null);

assert.equal(isQuietHoursActive({ enabled: false, start: '22:00', end: '07:00' }, 23 * 60), false);
assert.equal(isQuietHoursActive({ enabled: true, start: '09:00', end: '17:00' }, 9 * 60), true);
assert.equal(isQuietHoursActive({ enabled: true, start: '09:00', end: '17:00' }, 16 * 60 + 59), true);
assert.equal(isQuietHoursActive({ enabled: true, start: '09:00', end: '17:00' }, 17 * 60), false);
assert.equal(isQuietHoursActive({ enabled: true, start: '22:00', end: '07:00' }, 22 * 60), true);
assert.equal(isQuietHoursActive({ enabled: true, start: '22:00', end: '07:00' }, 6 * 60 + 59), true);
assert.equal(isQuietHoursActive({ enabled: true, start: '22:00', end: '07:00' }, 7 * 60), false);
assert.equal(isQuietHoursActive({ enabled: true, start: '22:00', end: '07:00' }, 12 * 60), false);

assert.equal(shouldDeliverPush({ settings: DEFAULT_USER_SETTINGS, eventType: 'reaction', localMinutes: 12 * 60 }), true);
assert.equal(shouldDeliverPush({
  settings: { ...DEFAULT_USER_SETTINGS, pauseAllNotifications: true },
  eventType: 'reaction',
  localMinutes: 12 * 60
}), false);
assert.equal(shouldDeliverPush({
  settings: { ...DEFAULT_USER_SETTINGS, notifications: { ...DEFAULT_USER_SETTINGS.notifications, comments: false } },
  eventType: 'comment',
  localMinutes: 12 * 60
}), false);
assert.equal(shouldDeliverPush({
  settings: { ...DEFAULT_USER_SETTINGS, quietHours: { enabled: true, start: '22:00', end: '07:00' } },
  eventType: 'private-message',
  localMinutes: 23 * 60
}), false);
assert.equal(shouldDeliverPush({
  settings: { ...DEFAULT_USER_SETTINGS, quietHours: { enabled: true, start: '22:00', end: '07:00' } },
  eventType: 'private-message',
  localMinutes: 12 * 60
}), true);

console.log('notification preference policy tests passed');
