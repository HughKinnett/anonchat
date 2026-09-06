import { auth, db } from "./firebase-config.js";
import { isProtectedAdministrator, normalizeUsername } from "./admin-deletion-policy.mjs";
import { listBadgeTypes, listUserBadges } from "./badge-firestore.mjs";
import { exitAfterAuthLoss } from "./push-exit.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const $ = (id) => document.getElementById(id);

export const createBadgeAdminSection = () => {
  if ($("badge-admin-section")) return $("badge-admin-section");
  const section = document.createElement("section");
  section.id = "badge-admin-section";
  section.className = "admin-panel badge-admin-panel";
  section.innerHTML = `
    <div class="admin-panel-heading">
      <div>
        <h2>Achievement badges</h2>
        <p class="admin-note">Read-only badge status. AnonChat awards badges automatically from fixed milestone rules. Admins cannot create, edit, assign, remove, disable, or alter badges.</p>
      </div>
    </div>
    <div id="badge-definition-list" class="admin-list compact-list" aria-live="polite"></div>
    <hr>
    <div class="admin-panel-heading">
      <div>
        <h3>Member badge status</h3>
        <p class="admin-note">Enter a user ID to view the badges currently shown on that account.</p>
      </div>
    </div>
    <div class="badge-admin-form">
      <label>User ID<input id="badge-user-id" autocomplete="off" placeholder="Firebase user ID"></label>
    </div>
    <div class="admin-actions"><button id="badge-user-refresh" class="admin-action" type="button">View member badges</button></div>
    <div id="badge-user-assignments" class="admin-list compact-list" aria-live="polite"></div>`;
  document.querySelector(".analytics-section")?.before(section);
  return section;
};

export const initAdminBadges = ({ db, setStatus = () => {} }) => {
  createBadgeAdminSection();
  let definitions = [];

  const localStatus = (message, error = false) => {
    setStatus(message, error);
  };

  const definitionById = () => new Map(definitions.map((badge) => [badge.id, badge]));

  const renderDefinitions = () => {
    const rows = [...definitions]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((badge) => {
        const row = document.createElement("article");
        row.className = "admin-row";
        const image = document.createElement("img");
        image.src = badge.imageUrl;
        image.alt = `${badge.name} badge`;
        image.width = 48;
        image.height = 48;
        const info = document.createElement("div");
        const title = document.createElement("strong");
        title.textContent = `${badge.name} · ${badge.tier}`;
        const details = document.createElement("small");
        details.textContent = badge.milestoneThreshold
          ? `${badge.milestoneMetric} ≥ ${badge.milestoneThreshold}`
          : badge.milestoneMetric;
        const description = document.createElement("small");
        description.textContent = badge.description;
        info.append(title, details, description);
        row.append(image, info);
        return row;
      });
    $("badge-definition-list").replaceChildren(...rows);
  };

  const renderUserAssignments = async () => {
    const uid = $("badge-user-id").value.trim();
    if (!uid) {
      $("badge-user-assignments").replaceChildren();
      localStatus("Enter a user ID to view badge status.", true);
      return;
    }
    try {
      const assignments = await listUserBadges(db, uid);
      const byId = definitionById();
      const rows = assignments.map((assignment) => {
        const definition = byId.get(assignment.badgeId);
        const row = document.createElement("article");
        row.className = "admin-row";
        const image = document.createElement("img");
        image.src = definition?.imageUrl || "anonchat-anonymous.png";
        image.alt = definition ? `${definition.name} badge` : "Badge";
        image.width = 48;
        image.height = 48;
        const info = document.createElement("div");
        const title = document.createElement("strong");
        title.textContent = definition?.name || assignment.badgeId;
        const detail = document.createElement("small");
        const earned = assignment.earnedAt?.toDate?.();
        detail.textContent = earned ? `Earned ${earned.toLocaleDateString()} · automatic` : "Automatically awarded";
        info.append(title, detail);
        row.append(image, info);
        return row;
      });
      $("badge-user-assignments").replaceChildren(...(rows.length
        ? rows
        : [Object.assign(document.createElement("p"), { className: "admin-note", textContent: "This member has no visible badges." })]));
      localStatus("Badge status loaded.");
    } catch {
      localStatus("Could not load this member's badge status.", true);
    }
  };

  $("badge-user-refresh").onclick = renderUserAssignments;
  void listBadgeTypes(db).then((loaded) => {
    definitions = loaded;
    renderDefinitions();
  }).catch(() => localStatus("Could not load badge definitions.", true));

  return { refreshUserBadges: renderUserAssignments };
};

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    await exitAfterAuthLoss({ redirect: () => {} });
    return;
  }
  if ($("badge-admin-section")) return;
  try {
    const profile = await getDoc(doc(db, "users", user.uid));
    const username = profile.exists() ? String(profile.data().username || "") : "";
    if (!isProtectedAdministrator(username) || profile.data().banned === true) return;
    const reservation = await getDoc(doc(db, "usernames", normalizeUsername(username)));
    if (!reservation.exists() || reservation.data().uid !== user.uid || reservation.data().username !== username) return;
    initAdminBadges({ db });
  } catch { /* Main admin surface remains usable if badge status cannot initialize. */ }
});
