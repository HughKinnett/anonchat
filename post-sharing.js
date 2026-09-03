import { buildPostShareUrl, parseSharedPostKey, stablePostKey } from "./social-sharing-policy.mjs";

const SHARE_SELECTOR = ".feed-item";
const shareTextFor = (item) => {
  const copy = [...item.querySelectorAll("p")]
    .map((node) => node.textContent?.trim())
    .find((text) => text && text.length > 2 && !/^Posted |^Reposted |^Expires /i.test(text));
  return copy || "See this post on AnonChat.";
};

const postKeyFor = (item) => {
  const explicit = item.id?.replace(/^post-/, "");
  return explicit || stablePostKey(shareTextFor(item));
};

const copyShareLink = async (url, button) => {
  try {
    await navigator.clipboard.writeText(url);
    const previous = button.textContent;
    button.textContent = "✓ Link copied";
    window.setTimeout(() => { button.textContent = previous; }, 1600);
  } catch {
    window.prompt("Copy this AnonChat post link:", url);
  }
};

const sharePost = async (item, button) => {
  const url = buildPostShareUrl({ pageUrl: window.location.href, postKey: postKeyFor(item) });
  const text = shareTextFor(item).slice(0, 180);
  if (navigator.share) {
    try {
      await navigator.share({ title: "AnonChat post", text, url });
      return;
    } catch (error) {
      if (error?.name === "AbortError") return;
    }
  }
  await copyShareLink(url, button);
};

const decoratePost = (item) => {
  if (item.dataset.shareReady === "true") return;
  const actions = item.querySelector(".post-actions");
  if (!actions) return;
  item.dataset.shareReady = "true";
  item.dataset.shareKey = postKeyFor(item);
  const button = document.createElement("button");
  button.type = "button";
  button.className = "share-button post-share-button";
  button.setAttribute("aria-label", "Share this post");
  button.title = "Share this post";
  button.textContent = "↗ Share";
  button.addEventListener("click", () => void sharePost(item, button));
  actions.append(button);
};

const decorateAll = () => document.querySelectorAll(SHARE_SELECTOR).forEach(decoratePost);
const observer = new MutationObserver(decorateAll);
observer.observe(document.documentElement, { childList: true, subtree: true });
decorateAll();

const focusSharedPost = () => {
  const key = parseSharedPostKey(window.location.href);
  if (!key) return;
  const target = [...document.querySelectorAll(SHARE_SELECTOR)]
    .find((item) => (item.dataset.shareKey || postKeyFor(item)) === key);
  if (!target) return;
  target.classList.add("shared-post-highlight");
  target.scrollIntoView({ behavior: "smooth", block: "center" });
  window.setTimeout(() => target.classList.remove("shared-post-highlight"), 2400);
};

window.addEventListener("hashchange", focusSharedPost);
const focusObserver = new MutationObserver(() => window.requestAnimationFrame(focusSharedPost));
focusObserver.observe(document.documentElement, { childList: true, subtree: true });
window.setTimeout(focusSharedPost, 250);
