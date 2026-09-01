const KEY_PREFIX = "anonchat:page-view:";

export const shouldRecordDailyPageView = (storage = globalThis.sessionStorage, date = new Date()) => {
  const day = date.toISOString().slice(0, 10), key = `${KEY_PREFIX}${day}`;
  try {
    if (storage.getItem(key) === "1") return false;
    storage.setItem(key, "1");
  } catch { /* A private browser may disable session storage. */ }
  return true;
};
