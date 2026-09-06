import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import { loadUserSettings } from './user-settings-storage.mjs';
import { applyUserAppearance, watchUserAppearance } from './user-appearance.mjs';

const firestore = { doc, getDoc };
let stopWatching = () => {};
let generation = 0;

onAuthStateChanged(auth, async user => {
  generation += 1;
  const currentGeneration = generation;
  stopWatching();
  stopWatching = () => {};

  if (!user) {
    applyUserAppearance(undefined);
    return;
  }

  const settings = await loadUserSettings(db, user.uid, firestore);
  if (currentGeneration !== generation) return;
  stopWatching = watchUserAppearance(settings);
});
