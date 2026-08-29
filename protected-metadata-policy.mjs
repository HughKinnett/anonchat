export const clearProfileProtectedMetadata = ({ document, renderSpotify }, message) => {
  document.title = "Loading profile — AnonChat";
  document.getElementById("profile-name").textContent = message;
  document.getElementById("profile-handle").textContent = "";
  document.getElementById("view-profile-avatar").src = "Untitled.jpeg";
  document.getElementById("view-profile-cover").src = "Untitled.jpeg";
  const followersLink = document.getElementById("profile-followers");
  followersLink.textContent = "— followers";
  followersLink.removeAttribute("href");
  const followingLink = document.getElementById("profile-following");
  followingLink.textContent = "— following";
  followingLink.removeAttribute("href");
  document.getElementById("profile-admin-link").hidden = true;
  renderSpotify("");
};

export const clearConnectionsProtectedMetadata = ({ document, followersList, followingList }, message) => {
  document.getElementById("connections-title").textContent = message;
  document.getElementById("followers-count").textContent = "—";
  document.getElementById("following-count").textContent = "—";
  followersList.replaceChildren();
  followingList.replaceChildren();
};
