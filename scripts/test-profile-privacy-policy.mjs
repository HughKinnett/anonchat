import assert from "node:assert/strict";
import {
  DEFAULT_PROFILE_PRIVACY,
  normalizeProfilePrivacy,
  resolveProfileVisibility
} from "../profile-privacy-policy.mjs";

assert.deepEqual(DEFAULT_PROFILE_PRIVACY, {
  showPosts: true,
  showBadges: true,
  showFollowersFollowing: true,
  showActivity: true
});

assert.deepEqual(normalizeProfilePrivacy(null), DEFAULT_PROFILE_PRIVACY);
assert.deepEqual(normalizeProfilePrivacy({ showPosts: false }), {
  showPosts: false,
  showBadges: true,
  showFollowersFollowing: true,
  showActivity: true
});
assert.deepEqual(normalizeProfilePrivacy({
  showPosts: false,
  showBadges: false,
  showFollowersFollowing: false,
  showActivity: false,
  unsupported: true
}), {
  showPosts: false,
  showBadges: false,
  showFollowersFollowing: false,
  showActivity: false
});

assert.deepEqual(resolveProfileVisibility({
  ownerUid: "owner",
  viewerUid: "visitor",
  blocked: false,
  privacy: { showPosts: false, showBadges: true, showFollowersFollowing: false, showActivity: true }
}), {
  posts: false,
  badges: true,
  followersFollowing: false,
  activity: true,
  ownerView: false
});

assert.deepEqual(resolveProfileVisibility({
  ownerUid: "owner",
  viewerUid: "owner",
  blocked: false,
  privacy: { showPosts: false, showBadges: false, showFollowersFollowing: false, showActivity: false }
}), {
  posts: true,
  badges: true,
  followersFollowing: true,
  activity: true,
  ownerView: true
});

assert.deepEqual(resolveProfileVisibility({
  ownerUid: "owner",
  viewerUid: "visitor",
  blocked: true,
  privacy: DEFAULT_PROFILE_PRIVACY
}), {
  posts: false,
  badges: false,
  followersFollowing: false,
  activity: false,
  ownerView: false
});

console.log("profile privacy policy tests passed");
