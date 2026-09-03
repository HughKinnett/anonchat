const PLAYLIST_EMBED = 'iframe[src*="open.spotify.com/embed/playlist/"]';

const protectPlaylistEmbed = (frame) => {
  if (frame.dataset.playlistPrivacyReady === "true") return;
  frame.dataset.playlistPrivacyReady = "true";
  const host = frame.parentElement;
  if (!host) return;
  host.classList.add("spotify-playlist-private");
  const mask = document.createElement("div");
  mask.className = "spotify-playlist-name-mask";
  mask.setAttribute("aria-hidden", "true");
  mask.innerHTML = '<span>Spotify playlist</span><small>Playlist name hidden for privacy</small>';
  host.insertBefore(mask, frame);
};

const protectAll = () => document.querySelectorAll(PLAYLIST_EMBED).forEach(protectPlaylistEmbed);
const observer = new MutationObserver(protectAll);
observer.observe(document.documentElement, { childList: true, subtree: true });
protectAll();
