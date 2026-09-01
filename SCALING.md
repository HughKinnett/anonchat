# AnonChat scaling roadmap

The browser app now bounds its live queries, hydrates only visible profiles, caches
static files, compresses uploaded images, and uses aggregate counts where practical.
Those changes reduce reads, memory, bandwidth, and repeat-load time at the current
Firebase architecture.

Reaching millions of active users reliably requires a measured backend rollout:

1. Store media in object storage behind a CDN, with thumbnails and moderation
   results, instead of keeping image data in Firestore documents.
2. Use cursor-based pagination for every feed, conversation, notification list,
   admin queue, and follower list. Never attach an unbounded collection listener.
3. Maintain reaction, follower, comment, and unread counters in trusted server-side
   workers so clients do not read entire subcollections to count them.
4. Build partitioned home-feed materialization and hot-post protection before a
   single post or account can create a read hotspot.
5. Move notification, media moderation, account cleanup, and fan-out jobs to queued,
   idempotent backend workers with retry and dead-letter handling.
6. Add App Check, rate limits, abuse controls, spending alerts, and hard operational
   budgets before opening registration broadly.
7. Load-test realistic mobile sessions and measure reads, writes, egress, storage,
   listener duration, and p95 response time before each traffic tier is enabled.

No client-only change can guarantee a smooth or inexpensive ten-million-user
deployment. The stages above are the required production path while preserving the
current product behavior.
