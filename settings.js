import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import { doc, getDoc, setDoc } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import { loadUserSettings, saveUserSettings } from './user-settings-storage.mjs';
import { applyUserAppearance } from './user-appearance.mjs';

const form = document.getElementById('settings-form');
const status = document.getElementById('settings-status');
const requestMode = document.getElementById('message-request-mode');
const pauseAll = document.getElementById('pause-all-notifications');
const quietEnabled = document.getElementById('quiet-hours-enabled');
const quietStart = document.getElementById('quiet-hours-start');
const quietEnd = document.getElementById('quiet-hours-end');
const theme = document.getElementById('theme-setting');
const reduceMotion = document.getElementById('reduce-motion-setting');
const textSize = document.getElementById('text-size-setting');
const highContrast = document.getElementById('high-contrast-setting');
const notificationInputs = [...document.querySelectorAll('[data-notification-setting]')];

let currentUser = null;
let currentSettings = null;

const firestore = { doc, getDoc, setDoc };

const setStatus = (message, state = '') => {
  if (!status) return;
  status.textContent = message;
  status.dataset.state = state;
};

const render = settings => {
  currentSettings = settings;
  requestMode.value = settings.messageRequestMode;
  pauseAll.checked = settings.pauseAllNotifications;
  quietEnabled.checked = settings.quietHours.enabled;
  quietStart.value = settings.quietHours.start;
  quietEnd.value = settings.quietHours.end;
  theme.value = settings.theme;
  reduceMotion.checked = settings.reduceMotion;
  textSize.value = settings.textSize;
  highContrast.checked = settings.highContrast;
  for (const input of notificationInputs) {
    input.checked = settings.notifications[input.dataset.notificationSetting] !== false;
    input.disabled = settings.pauseAllNotifications;
  }
  quietStart.disabled = !settings.quietHours.enabled;
  quietEnd.disabled = !settings.quietHours.enabled;
  applyUserAppearance(settings);
};

const readForm = () => ({
  messageRequestMode: requestMode.value,
  notifications: Object.fromEntries(notificationInputs.map(input => [input.dataset.notificationSetting, input.checked])),
  pauseAllNotifications: pauseAll.checked,
  quietHours: {
    enabled: quietEnabled.checked,
    start: quietStart.value || '22:00',
    end: quietEnd.value || '07:00'
  },
  theme: theme.value,
  reduceMotion: reduceMotion.checked,
  textSize: textSize.value,
  highContrast: highContrast.checked
});

const previewAppearance = () => {
  if (!currentSettings) return;
  applyUserAppearance({ ...currentSettings, ...readForm(), notifications: currentSettings.notifications, quietHours: currentSettings.quietHours });
};

theme?.addEventListener('change', previewAppearance);
reduceMotion?.addEventListener('change', previewAppearance);
textSize?.addEventListener('change', previewAppearance);
highContrast?.addEventListener('change', previewAppearance);

pauseAll?.addEventListener('change', () => {
  for (const input of notificationInputs) input.disabled = pauseAll.checked;
});

quietEnabled?.addEventListener('change', () => {
  quietStart.disabled = !quietEnabled.checked;
  quietEnd.disabled = !quietEnabled.checked;
});

form?.addEventListener('submit', async event => {
  event.preventDefault();
  if (!currentUser) return;
  const saveButton = document.getElementById('settings-save');
  saveButton.disabled = true;
  setStatus('Saving settings…');
  try {
    const saved = await saveUserSettings(db, currentUser.uid, readForm(), firestore);
    render(saved);
    setStatus('Settings saved.', 'success');
  } catch (error) {
    console.error('Unable to save user settings', error);
    setStatus('Could not save settings. Please try again.', 'error');
  } finally {
    saveButton.disabled = false;
  }
});

onAuthStateChanged(auth, async user => {
  if (!user) {
    location.replace('index.html');
    return;
  }
  currentUser = user;
  setStatus('Loading settings…');
  const settings = await loadUserSettings(db, user.uid, firestore);
  render(settings);
  setStatus('Settings loaded.');
});
