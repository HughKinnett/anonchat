export const DEFAULT_PROFILE_PRIVACY = Object.freeze({
  showPosts: true,
  showBadges: true,
  showFollowersFollowing: true,
  showActivity: true
});

const boolOrDefault = (value, fallback) => typeof value === "boolean" ? value : fallback;

export function normalizeProfilePrivacy(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    showPosts: boolOrDefault(source.showPosts, DEFAULT_PROFILE_PRIVACY.showPosts),
    showBadges: boolOrDefault(source.showBadges, DEFAULT_PROFILE_PRIVACY.showBadges),
    showFollowersFollowing: boolOrDefault(source.showFollowersFollowing, DEFAULT_PROFILE_PRIVACY.showFollowersFollowing),
    showActivity: boolOrDefault(source.showActivity, DEFAULT_PROFILE_PRIVACY.showActivity)
  };
}

export function resolveProfileVisibility({ ownerUid, viewerUid, blocked = false, privacy } = {}) {
  const ownerView = Boolean(ownerUid && viewerUid && ownerUid === viewerUid);
  if (!ownerView && blocked) {
    return {
      posts: false,
      badges: false,
      followersFollowing: false,
      activity: false,
      ownerView: false
    };
  }

  const normalized = normalizeProfilePrivacy(privacy);
  if (ownerView) {
    return {
      posts: true,
      badges: true,
      followersFollowing: true,
      activity: true,
      ownerView: true
    };
  }

  return {
    posts: normalized.showPosts,
    badges: normalized.showBadges,
    followersFollowing: normalized.showFollowersFollowing,
    activity: normalized.showActivity,
    ownerView: false
  };
}
