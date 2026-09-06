import * as QRCode from "./vendor/qrcode.mjs";

export const renderProfileQr = async (canvas, payload) => {
  if (!canvas) throw new TypeError("QR canvas is required.");
  const value = String(payload || "").trim();
  if (!value) throw new TypeError("QR payload is required.");
  await QRCode.toCanvas(canvas, value, { width: 280, margin: 2 });
};
