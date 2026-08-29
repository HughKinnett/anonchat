const millis = (value) => {
  try {
    const result = typeof value?.toMillis === "function" ? value.toMillis() : value instanceof Date ? value.getTime() : value;
    return Number.isFinite(result) ? result : null;
  } catch { return null; }
};

export const nearestFutureExpiry = (expiries, nowMillis = Date.now()) => expiries
  .map(millis).filter((value) => value !== null && value > nowMillis)
  .reduce((nearest, value) => nearest === null || value < nearest ? value : nearest, null);

export const scheduleExpiryBoundary = ({ expiries, nowMillis = Date.now(), setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout, onBoundary }) => {
  const expiry = nearestFutureExpiry(expiries, nowMillis);
  if (expiry === null) return () => {};
  const timer = setTimeoutFn(onBoundary, Math.max(0, expiry - nowMillis));
  return () => clearTimeoutFn(timer);
};
