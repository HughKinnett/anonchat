import { normalizeUserSettings } from './user-settings-policy.mjs';

const EVENT_CATEGORY = Object.freeze({
  reaction: 'reactions',
  comment: 'comments',
  'private-message': 'privateMessages',
  'message-request': 'messageRequests',
  'room-message': 'communityChatrooms',
  'premium-room-message': 'communityChatrooms',
  mention: 'mentions',
  'reveal-request': 'mutualRevealRequests'
});

const clockMinutes = value => {
  if (typeof value !== 'string' || !/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(value)) return null;
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
};

export const notificationCategoryForEvent = type => EVENT_CATEGORY[type] ?? null;

export const isQuietHoursActive = (quietHours, localMinutes) => {
  if (!quietHours?.enabled || !Number.isInteger(localMinutes) || localMinutes < 0 || localMinutes >= 24 * 60) {
    return false;
  }
  const start = clockMinutes(quietHours.start);
  const end = clockMinutes(quietHours.end);
  if (start === null || end === null || start === end) return false;
  return start < end
    ? localMinutes >= start && localMinutes < end
    : localMinutes >= start || localMinutes < end;
};

export const shouldDeliverPush = ({ settings, eventType, localMinutes }) => {
  const normalized = normalizeUserSettings(settings);
  if (normalized.pauseAllNotifications) return false;
  const category = notificationCategoryForEvent(eventType);
  if (category && normalized.notifications[category] === false) return false;
  if (isQuietHoursActive(normalized.quietHours, localMinutes)) return false;
  return true;
};
