export const BADGE_ACTIVITY_METRICS = Object.freeze({
  post_created: Object.freeze(["posts_created"]),
  post_interaction_received: Object.freeze(["single_post_interactions", "total_interactions_received"]),
  comment_received: Object.freeze(["single_post_interactions", "total_interactions_received", "comments_received"]),
  comment_or_reply_created: Object.freeze(["comments_or_replies_created"]),
  followers_changed: Object.freeze(["followers_count"]),
  premium_reconciled: Object.freeze(["premium_active"]),
  profile_initialized: Object.freeze(["early_member", "account_age_days"])
});

export const badgeMetricsForActivity = (activity) => {
  const metrics = BADGE_ACTIVITY_METRICS[String(activity || "")];
  return metrics ? [...metrics] : [];
};
