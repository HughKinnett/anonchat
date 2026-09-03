const encoder = new TextEncoder();
const decoder = new TextDecoder();
const VERSION = 1;
const PBKDF2_ITERATIONS = 600_000;

const bytesToBase64 = bytes => {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
};
const base64ToBytes = value => Uint8Array.from(atob(value), character => character.charCodeAt(0));
const randomBytes = size => crypto.getRandomValues(new Uint8Array(size));
const importPublicKey = jwk => crypto.subtle.importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, false, []);
const importPrivateKey = jwk => crypto.subtle.importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);

export const exportPrivateKeyJwk = privateKey => crypto.subtle.exportKey("jwk", privateKey);
export const importPrivateKeyJwk = jwk => importPrivateKey(jwk);

const passwordKey = async (passphrase, salt, iterations = PBKDF2_ITERATIONS) => {
  const material = await crypto.subtle.importKey("raw", encoder.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
};

export const validateEncryptionPassphrase = passphrase => {
  const value = String(passphrase || "");
  if (value.length < 12) throw new Error("Your chat encryption password must contain at least 12 characters.");
  if (value.length > 256) throw new Error("Your chat encryption password is too long.");
  return value;
};

export const createIdentityBundle = async passphrase => {
  const password = validateEncryptionPassphrase(passphrase);
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const [publicJwk, privateJwk] = await Promise.all([
    crypto.subtle.exportKey("jwk", pair.publicKey),
    crypto.subtle.exportKey("jwk", pair.privateKey)
  ]);
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const wrappingKey = await passwordKey(password, salt);
  const wrapped = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode("AnonChat identity key v1") },
    wrappingKey,
    encoder.encode(JSON.stringify(privateJwk))
  );
  return {
    publicJwk,
    privateBundle: {
      version: VERSION,
      algorithm: "P-256+PBKDF2-SHA256+A256GCM",
      iterations: PBKDF2_ITERATIONS,
      salt: bytesToBase64(salt),
      iv: bytesToBase64(iv),
      ciphertext: bytesToBase64(new Uint8Array(wrapped))
    },
    privateKey: pair.privateKey
  };
};

export const unlockIdentityBundle = async (privateBundle, passphrase) => {
  const password = validateEncryptionPassphrase(passphrase);
  if (privateBundle?.version !== VERSION || !privateBundle?.ciphertext) throw new Error("This chat identity is not supported.");
  try {
    const key = await passwordKey(password, base64ToBytes(privateBundle.salt), privateBundle.iterations);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64ToBytes(privateBundle.iv), additionalData: encoder.encode("AnonChat identity key v1") },
      key,
      base64ToBytes(privateBundle.ciphertext)
    );
    return importPrivateKey(JSON.parse(decoder.decode(plain)));
  } catch {
    throw new Error("That chat encryption password could not unlock your messages.");
  }
};

export const derivePairwiseKey = async (privateKey, otherPublicJwk, context) => {
  const publicKey = await importPublicKey(otherPublicJwk);
  const shared = await crypto.subtle.deriveBits({ name: "ECDH", public: publicKey }, privateKey, 256);
  const material = await crypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: encoder.encode("AnonChat E2EE key derivation v1"),
      info: encoder.encode(String(context))
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
};

export const generateRoomKey = () => crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);

export const encryptPayload = async (key, payload, context) => {
  const iv = randomBytes(12);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(String(context)) },
    key,
    encoder.encode(JSON.stringify(payload))
  );
  return { version: VERSION, algorithm: "A256GCM", iv: bytesToBase64(iv), ciphertext: bytesToBase64(new Uint8Array(encrypted)) };
};

export const decryptPayload = async (key, envelope, context) => {
  if (envelope?.version !== VERSION || envelope?.algorithm !== "A256GCM") throw new Error("Unsupported encrypted message.");
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(envelope.iv), additionalData: encoder.encode(String(context)) },
    key,
    base64ToBytes(envelope.ciphertext)
  );
  return JSON.parse(decoder.decode(plain));
};

export const wrapRoomKey = async (roomKey, pairwiseKey, roomId, recipientUid) => {
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", roomKey));
  return encryptPayload(pairwiseKey, { key: bytesToBase64(raw) }, `room-key:${roomId}:${recipientUid}`);
};

export const unwrapRoomKey = async (envelope, pairwiseKey, roomId, recipientUid) => {
  const payload = await decryptPayload(pairwiseKey, envelope, `room-key:${roomId}:${recipientUid}`);
  return crypto.subtle.importKey("raw", base64ToBytes(payload.key), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
};

export const publicKeyFingerprint = async publicJwk => {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(`${publicJwk.crv}:${publicJwk.x}:${publicJwk.y}`)));
  return [...digest.subarray(0, 12)].map(byte => byte.toString(16).padStart(2, "0")).join("").match(/.{1,4}/g).join(" ");
};

export const e2eeConstants = Object.freeze({ version: VERSION, pbkdf2Iterations: PBKDF2_ITERATIONS });
