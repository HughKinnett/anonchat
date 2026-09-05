import { listBadgeTypes, saveBadgeType } from "./badge-firestore.mjs";
import { BADGE_CATEGORIES, BADGE_MILESTONE_METRICS } from "./badge-policy.mjs";

const FIXED_METRICS = new Set(["early_member", "premium_active"]);
const $ = (id) => document.getElementById(id);

const badgeIdFromName = (name) => String(name || "")
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "")
  .slice(0, 60);

export const createBadgeAdminSection = () => {
  if ($("badge-admin-section")) return $("badge-admin-section");
  const section = document.createElement("section");
  section.id = "badge-admin-section";
  section.className = "admin-panel badge-admin-panel";
  section.innerHTML = `
    <div class="admin-panel-heading"><div><h2>Achievement badges</h2><p class="admin-note">Create, edit, activate, or pause the badges members can earn.</p></div></div>
    <div class="badge-admin-form">
      <label>Badge name<input id="badge-name" maxlength="60" autocomplete="off"></label>
      <label>Description<textarea id="badge-description" maxlength="280" rows="3"></textarea></label>
      <label>Artwork URL<input id="badge-image-url" type="url" placeholder="https://..."></label>
      <label>Category<select id="badge-category">${BADGE_CATEGORIES.map(value => `<option value="${value}">${value.replaceAll("_", " ")}</option>`).join("")}</select></label>
      <label>Award mode<select id="badge-award-mode"><option value="manual">Manual</option><option value="automatic">Automatic</option></select></label>
      <label>Milestone metric<select id="badge-milestone-metric"><option value="">Choose a metric</option>${BADGE_MILESTONE_METRICS.map(value => `<option value="${value}">${value}</option>`).join("")}</select></label>
      <label>Threshold<input id="badge-milestone-threshold" type="number" min="1" step="1"></label>
      <label class="announcement-toggle"><input id="badge-active" type="checkbox" checked> Badge is active</label>
    </div>
    <p id="badge-admin-status" class="admin-note" role="status" aria-live="polite"></p>
    <div class="admin-actions"><button id="badge-save" class="admin-action" type="button">Save badge</button><button id="badge-cancel-edit" class="admin-action" type="button" hidden>Cancel edit</button></div>
    <div id="badge-definition-list" class="admin-list compact-list" aria-live="polite"></div>`;
  const analytics = document.querySelector(".analytics-section");
  analytics?.before(section);
  return section;
};

export const initAdminBadges = ({ db, adminUid, setStatus = () => {} }) => {
  createBadgeAdminSection();
  let editingId = "";
  const mode = $("badge-award-mode"), metric = $("badge-milestone-metric"), threshold = $("badge-milestone-threshold");
  const localStatus = (message, error = false) => {
    $("badge-admin-status").textContent = message;
    $("badge-admin-status").classList.toggle("is-error", error);
    setStatus(message, error);
  };
  const syncMilestoneInputs = () => {
    const automatic = mode.value === "automatic";
    metric.disabled = !automatic;
    if (!automatic) { metric.value = ""; threshold.value = ""; }
    const fixed = FIXED_METRICS.has(metric.value);
    threshold.disabled = !automatic || !metric.value || fixed;
    if (fixed) threshold.value = "";
  };
  const reset = () => {
    editingId = "";
    $("badge-name").value = ""; $("badge-description").value = ""; $("badge-image-url").value = "";
    $("badge-category").value = "special"; mode.value = "manual"; $("badge-active").checked = true;
    $("badge-save").textContent = "Save badge"; $("badge-cancel-edit").hidden = true; syncMilestoneInputs();
  };
  const fillForEdit = (badge) => {
    editingId = badge.id;
    $("badge-name").value = badge.name || ""; $("badge-description").value = badge.description || "";
    $("badge-image-url").value = badge.imageUrl || ""; $("badge-category").value = badge.category || "special";
    mode.value = badge.awardMode || "manual"; metric.value = badge.milestoneMetric || "";
    threshold.value = badge.milestoneThreshold || ""; $("badge-active").checked = badge.active !== false;
    $("badge-save").textContent = "Update badge"; $("badge-cancel-edit").hidden = false; syncMilestoneInputs();
    $("badge-name").focus();
  };
  const render = async () => {
    const badges = await listBadgeTypes(db, { includeInactive: true });
    const rows = badges.sort((a, b) => a.name.localeCompare(b.name)).map((badge) => {
      const row = document.createElement("article"); row.className = "admin-row";
      const info = document.createElement("div");
      const title = document.createElement("strong"); title.textContent = badge.name;
      const details = document.createElement("small");
      details.textContent = `${badge.active === false ? "Inactive" : "Active"} · ${badge.awardMode} · ${badge.milestoneMetric || "no metric"}${badge.milestoneThreshold ? ` ≥ ${badge.milestoneThreshold}` : ""}`;
      const description = document.createElement("small"); description.textContent = badge.description;
      info.append(title, details, description);
      const actions = document.createElement("div"); actions.className = "admin-actions";
      const edit = document.createElement("button"); edit.type = "button"; edit.className = "admin-action"; edit.textContent = "Edit"; edit.onclick = () => fillForEdit(badge);
      const toggle = document.createElement("button"); toggle.type = "button"; toggle.className = "admin-action"; toggle.textContent = badge.active === false ? "Activate" : "Deactivate";
      toggle.onclick = async () => { await saveBadgeType(db, badge.id, { ...badge, active: badge.active === false }, adminUid); await render(); };
      actions.append(edit, toggle); row.append(info, actions); return row;
    });
    $("badge-definition-list").replaceChildren(...(rows.length ? rows : [Object.assign(document.createElement("p"), { className: "admin-note", textContent: "No badge definitions yet." })]));
  };
  mode.onchange = syncMilestoneInputs;
  metric.onchange = syncMilestoneInputs;
  $("badge-cancel-edit").onclick = reset;
  $("badge-save").onclick = async () => {
    const name = $("badge-name").value.trim(), description = $("badge-description").value.trim();
    if (!name || !description) { localStatus("Badge name and description are required.", true); return; }
    const awardMode = mode.value;
    const milestoneMetric = awardMode === "automatic" ? metric.value : null;
    const milestoneThreshold = threshold.disabled || !threshold.value ? null : Number(threshold.value);
    if (awardMode === "automatic" && !milestoneMetric) { localStatus("Choose a milestone metric for automatic badges.", true); return; }
    if (awardMode === "automatic" && !FIXED_METRICS.has(milestoneMetric) && (!Number.isInteger(milestoneThreshold) || milestoneThreshold < 1)) { localStatus("Enter a positive whole-number threshold.", true); return; }
    const id = editingId || badgeIdFromName(name);
    if (!id) { localStatus("Choose a badge name that can be saved.", true); return; }
    try {
      await saveBadgeType(db, id, { name, description, imageUrl: $("badge-image-url").value.trim(), category: $("badge-category").value, awardMode, milestoneMetric, milestoneThreshold, active: $("badge-active").checked }, adminUid);
      localStatus(editingId ? "Badge updated." : "Badge created."); reset(); await render();
    } catch (error) { localStatus(error?.message || "Could not save that badge.", true); }
  };
  syncMilestoneInputs();
  void render().catch(() => localStatus("Could not load badge definitions.", true));
  return { refresh: render };
};
