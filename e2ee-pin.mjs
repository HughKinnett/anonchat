const encoder = new TextEncoder();
const decoder = new TextDecoder();
const VERSION = 1;
const PIN_ITERATIONS = 600_000;
const PIN_AD = "AnonChat trusted-device PIN key v1";
const IDENTITY_AD = "AnonChat trusted-device identity v1";

const bytesToBase64 = bytes => {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
};

const base64ToBytes = value => Uint8Array.from(atob(String(value || "")), character => character.charCodeAt(0));
const randomBytes = size => crypto.getRandomValues(new Uint8Array(size));

const importAesKey = raw => crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);

const derivePinKey = async (pin, salt, iterations = PIN_ITERATIONS) => {
  const material = await crypto.subtle.importKey("raw", encoder.encode(pin), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
};

export const validateChatPin = pin => {
  if (typeof pin !== "string" || !/^[0-9]{4}$/.test(pin)) {
    throw new Error("Your chat PIN must contain exactly four digits.");
  }
  return pin;
};

export const trustedDeviceStorageKey = uid => `anonchat:e2ee:trusted-device:${String(uid || "")}`;

export const pinDelayMs = failureCount => {
  const failures = Math.max(0, Number(failureCount) || 0);
  if (failures <= 0) return 0;
  if (failures === 1) return 1000;
  if (failures === 2) return 2000;
  if (failures === 3) return 5000;
  if (failures === 4) return 10000;
  return 30000;
};

export const createTrustedDeviceRecord = async (privateJwk, pin, { now = Date.now } = {}) => {
  const normalizedPin = validateChatPin(pin);
  if (!privateJwk || typeof privateJwk !== "object" || typeof privateJwk.d !== "string") {
    throw new Error("A valid private E2EE key is required.");
  }

  const deviceKeyBytes = randomBytes(32);
  const deviceKey = await importAesKey(deviceKeyBytes);
  const identityIv = randomBytes(12);
  const wrappedPrivateJwk = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: identityIv, additionalData: encoder.encode(IDENTITY_AD) },
    deviceKey,
    encoder.encode(JSON.stringify(privateJwk))
  );

  const pinSalt = randomBytes(16);
  const pinIv = randomBytes(12);
  const pinKey = await derivePinKey(normalizedPin, pinSalt);
  const wrappedDeviceKey = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: pinIv, additionalData: encoder.encode(PIN_AD) },
    pinKey,
    deviceKeyBytes
  );

  deviceKeyBytes.fill(0);

  return {
    version: VERSION,
    algorithm: "A256GCM+PBKDF2-SHA256",
    pinIterations: PIN_ITERATIONS,
    pinSalt: bytesToBase64(pinSalt),
    pinIv: bytesToBase64(pinIv),
    wrappedDeviceKey: bytesToBase64(new Uint8Array(wrappedDeviceKey)),
    identityIv: bytesToBase64(identityIv),
    wrappedPrivateJwk: bytesToBase64(new Uint8Array(wrappedPrivateJwk)),
    createdAt: Number(now())
  };
};

export const unlockTrustedDeviceRecord = async (record, pin) => {
  const normalizedPin = validateChatPin(pin);
  if (record?.version !== VERSION || record?.algorithm !== "A256GCM+PBKDF2-SHA256") {
    throw new Error("This trusted-device encryption record is unsupported or corrupt.");
  }

  try {
    const pinKey = await derivePinKey(normalizedPin, base64ToBytes(record.pinSalt), record.pinIterations);
    const deviceKeyBytes = new Uint8Array(await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64ToBytes(record.pinIv), additionalData: encoder.encode(PIN_AD) },
      pinKey,
      base64ToBytes(record.wrappedDeviceKey)
    ));
    const deviceKey = await importAesKey(deviceKeyBytes);
    const privateJwkBytes = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64ToBytes(record.identityIv), additionalData: encoder.encode(IDENTITY_AD) },
      deviceKey,
      base64ToBytes(record.wrappedPrivateJwk)
    );
    deviceKeyBytes.fill(0);
    const privateJwk = JSON.parse(decoder.decode(privateJwkBytes));
    if (!privateJwk || typeof privateJwk !== "object" || typeof privateJwk.d !== "string") {
      throw new Error("corrupt");
    }
    return privateJwk;
  } catch (error) {
    if (/unsupported|corrupt/i.test(String(error?.message || ""))) {
      throw new Error("This trusted-device encryption record is corrupt.");
    }
    throw new Error("That chat PIN is incorrect.");
  }
};

export const e2eePinConstants = Object.freeze({ version: VERSION, pinIterations: PIN_ITERATIONS });
