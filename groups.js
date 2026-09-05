import { auth, db } from "./firebase-config.js";
import {
  createPublicGroup,
  joinPublicGroup,
  leaveGroup,
  listGroupMembers,
  listPublicGroups
} from "./group-firestore.mjs";
import { exitAfterAuthLoss, exitAuthenticatedSession } from "./push-exit.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const searchInput = document.getElementById("group-search");
const topicFilter = document.getElementById("group-topic-filter");
const list = document.getElementById("groups-list");
const status = document.getElementById("groups-status");
const createForm = document.getElementById("group-create-form");
const signOutButton = document.getElementById("groups-sign-out");

let currentUser = null;
let groups = [];
let memberships = new Map();

const setStatus = (message = "") => {
  if (status) status.textContent = message;
};

const slugify = (value) => String(value || "")
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "")
  .slice(0, 60);

const groupMatches = (group) => {
  const term = String(searchInput?.value || "").trim().toLowerCase();
  const topic = String(topicFilter?.value || "").trim().toLowerCase();
  const haystack = [group.name, group.topic, group.description]
    .map((value) => String(value || "").toLowerCase())
    .join(" ");
  return (!term || haystack.includes(term))
    && (!topic || String(group.topic || "").toLowerCase() === topic);
};

const detailHref = (groupId) => `group-detail.html?id=${encodeURIComponent(groupId)}`;

const render = () => {
  if (!list) return;
  list.replaceChildren();
  const visible = groups.filter(groupMatches);

  if (!visible.length) {
    const empty = document.createElement("p");
    empty.textContent = "No public Groups match these filters yet.";
    list.append(empty);
    return;
  }

  for (const group of visible) {
    const card = document.createElement("article");
    card.className = "connection-card";

    const heading = document.createElement("h3");
    const link = document.createElement("a");
    link.href = detailHref(group.id);
    link.textContent = group.name || "Group";
    heading.append(link);

    const topic = document.createElement("p");
    topic.textContent = group.topic || "General";

    const description = document.createElement("p");
    description.textContent = group.description || "Public AnonChat Group";

    const memberCount = document.createElement("p");
    memberCount.textContent = `${Number(group.memberCount || 0)} members`;

    const action = document.createElement("button");
    action.type = "button";
    const role = memberships.get(group.id) || null;
    action.textContent = role ? "Leave" : "Join";
    action.disabled = role === "owner";
    if (role === "owner") action.title = "Group owners cannot leave without transferring ownership.";

    action.addEventListener("click", async () => {
      if (!currentUser) return;
      action.disabled = true;
      try {
        if (memberships.has(group.id)) {
          await leaveGroup(db, group.id, currentUser.uid);
          memberships.delete(group.id);
          group.memberCount = Math.max(0, Number(group.memberCount || 0) - 1);
        } else {
          const role = await joinPublicGroup(db, group.id, currentUser.uid);
          memberships.set(group.id, role || "member");
          group.memberCount = Number(group.memberCount || 0) + 1;
        }
        render();
      } catch (error) {
        setStatus(error?.message || "Could not update Group membership.");
        action.disabled = false;
      }
    });

    card.append(heading, topic, description, memberCount, action);
    list.append(card);
  }
};

const loadMemberships = async () => {
  memberships = new Map();
  if (!currentUser) return;
  await Promise.all(groups.map(async (group) => {
    const members = await listGroupMembers(db, group.id);
    const mine = members.find((member) => member.uid === currentUser.uid || member.id === currentUser.uid);
    if (mine) memberships.set(group.id, mine.role || "member");
  }));
};

const populateTopics = () => {
  if (!topicFilter) return;
  const selected = topicFilter.value;
  const topics = [...new Set(groups.map((group) => String(group.topic || "").trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
  topicFilter.replaceChildren(new Option("All topics", ""));
  for (const topic of topics) topicFilter.add(new Option(topic, topic.toLowerCase()));
  topicFilter.value = selected;
};

const loadGroups = async () => {
  setStatus("Loading Groups…");
  groups = await listPublicGroups(db);
  await loadMemberships();
  populateTopics();
  render();
  setStatus(groups.length ? "" : "No public Groups are available yet.");
};

searchInput?.addEventListener("input", render);
topicFilter?.addEventListener("change", render);

createForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentUser) return;
  const form = new FormData(createForm);
  const name = String(form.get("name") || "").trim();
  const topic = String(form.get("topic") || "").trim();
  const description = String(form.get("description") || "").trim();
  const submit = createForm.querySelector("button[type='submit']");
  if (submit) submit.disabled = true;
  try {
    const groupId = await createPublicGroup(db, currentUser.uid, {
      name,
      slug: slugify(name),
      topic,
      description,
      visibility: "public"
    });
    createForm.reset();
    setStatus("Public Group created.");
    await loadGroups();
    location.href = detailHref(groupId);
  } catch (error) {
    setStatus(error?.message || "Could not create Group.");
  } finally {
    if (submit) submit.disabled = false;
  }
});

signOutButton?.addEventListener("click", async () => {
  await exitAuthenticatedSession({ user: currentUser });
  location.href = "index.html";
});

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    await exitAfterAuthLoss();
    location.href = "index.html";
    return;
  }
  currentUser = user;
  try {
    await loadGroups();
  } catch (error) {
    setStatus(error?.message || "Could not load Groups.");
  }
});
