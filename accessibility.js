import { applyAccessibilityPreferences, normalizeAppearance, normalizeTextScale } from "./accessibility-policy.mjs";

const read = () => ({
  appearance: normalizeAppearance(localStorage.getItem("anonchat:appearance") || "system"),
  textScale: normalizeTextScale(localStorage.getItem("anonchat:text-scale") || 1)
});
const apply = (settings = read()) => {
  applyAccessibilityPreferences(document.documentElement, settings);
  const appearance = document.getElementById("appearance-select"); const scale = document.getElementById("text-size-select");
  if (appearance) appearance.value = settings.appearance; if (scale) scale.value = String(settings.textScale);
};
apply();

document.addEventListener("DOMContentLoaded", () => {
  apply();
  document.getElementById("appearance-select")?.addEventListener("change", (event) => { const value = normalizeAppearance(event.target.value); localStorage.setItem("anonchat:appearance", value); apply({ ...read(), appearance: value }); });
  document.getElementById("text-size-select")?.addEventListener("change", (event) => { const value = normalizeTextScale(event.target.value); localStorage.setItem("anonchat:text-scale", String(value)); apply({ ...read(), textScale: value }); });
});
