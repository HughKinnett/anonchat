import { auth, db } from "./firebase-config.js";
import {
  joinCommunity,
  leaveCommunity,
  listCommunities,
  listCommunityMembers
} from "./community-interest-firestore.mjs";
import { exitAfterAuthLoss, exitAuthenticatedSession } from "./push-exit.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const searchInput = document.getElementById("community-search");
const topicFilter = document.getElementById("community-topic-filter");
const list = document.getElementById("communities-list");
const status = document.getElementById("communities-status");
const signOutButton = document.getElementById("communities-sign-out");

let currentUser = null;
let communities = [];
let memberships = new Map();

const setStatus = (message = "") => {
  if (status) status.textContent = message;
};

const communityMatches = (community) => {
  const term = String(searchInput?.value || "").trim().toLowerCase();
  const topic = String(topicFilter?.value || "").trim().toLowerCase();
  const haystack = [community.name, community.topic, community.description]
    .map((value) => String(value || "").toLowerCase())
    .join(" ");
  return (!term || haystack.includes(term))
    && (!topic || String(community.topic || "").toLowerCase() === topic);
};

const detailHref = (communityId) => `community-detail.html?id=${encodeURIComponent(communityId)}`;

const render = () => {
  if (!list) return;
  list.replaceChildren();
  const visible = communities.filter(communityMatches);

  if (!visible.length) {
    const empty = document.createElement("p");
    empty.textContent = "No Communities match these filters yet.";
    list.append(empty);
    return;
  }

  for (const community of visible) {
    const card = document.createElement("article");
    card.className = "connection-card";

    const heading = document.createElement("h3");
    const link = document.createElement("a");
    link.href = detailHref(community.id);
    link.textContent = community.name || "Community";
    heading.append(link);

    const topic = document.createElement("p");
    topic.textContent = community.topic || "General";

    const description = document.createElement("p");
    description.textContent = community.description || "Public AnonChat Community";

    const memberCount = document.createElement("p");
    memberCount.textContent = `${Number(community.memberCount || 0)} members`;

    const action = document.createElement("button");
    action.type = "button";
    const role = memberships.get(community.id) || null;
    action.textContent = role ? "Leave" : "Join";
    action.disabled = role === "owner";
    if (role === "owner") action.title = "Community owners cannot leave without transferring ownership.";

    action.addEventListener("click", async () => {
      if (!currentUser) return;
      action.disabled = true;
      try {
        if (memberships.has(community.id)) {
          await leaveCommunity(db, community.id, currentUser.uid);
          memberships.delete(community.id);
          community.memberCount = Math.max(0, Number(community.memberCount || 0) - 1);
        } else {
          const joinedRole = await joinCommunity(db, community.id, currentUser.uid);
          memberships.set(community.id, joinedRole || "member");
          community.memberCount = Number(community.memberCount || 0) + 1;
        }
        render();
      } catch (error) {
        setStatus(error?.message || "Could not update Community membership.");
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
  await Promise.all(communities.map(async (community) => {
    const members = await listCommunityMembers(db, community.id);
    const mine = members.find((member) => member.uid === currentUser.uid || member.id === currentUser.uid);
    if (mine) memberships.set(community.id, mine.role || "member");
  }));
};

const populateTopics = () => {
  if (!topicFilter) return;
  const selected = topicFilter.value;
  const topics = [...new Set(communities.map((community) => String(community.topic || "").trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
  topicFilter.replaceChildren(new Option("All topics", ""));
  for (const topic of topics) topicFilter.add(new Option(topic, topic.toLowerCase()));
  topicFilter.value = selected;
};

const loadCommunities = async () => {
  setStatus("Loading Communities…");
  communities = await listCommunities(db);
  await loadMemberships();
  populateTopics();
  render();
  setStatus(communities.length ? "" : "No public Communities are available yet.");
};

searchInput?.addEventListener("input", render);
topicFilter?.addEventListener("change", render);
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
    await loadCommunities();
  } catch (error) {
    setStatus(error?.message || "Could not load Communities.");
  }
});
