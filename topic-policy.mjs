export const MAX_TOPIC_LENGTH = 40;
export const MAX_POST_TOPICS = 8;

const SAFE_TOPIC = /^[a-z0-9_]+(?:-[a-z0-9_]+)*$/;

export const normalizeTopic = (value) => {
  const raw = String(value ?? "")
    .trim()
    .replace(/^#+/, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
  if (!raw || raw.length > MAX_TOPIC_LENGTH || !SAFE_TOPIC.test(raw)) return "";
  return raw;
};

export const extractHashtags = (text) => {
  const topics = [];
  const seen = new Set();
  const pattern = /(^|[^\p{L}\p{N}_])#+([\p{L}\p{N}_-]+)/gu;
  for (const match of String(text ?? "").matchAll(pattern)) {
    const topic = normalizeTopic(match[2]);
    if (!topic || seen.has(topic)) continue;
    seen.add(topic);
    topics.push(topic);
    if (topics.length >= MAX_POST_TOPICS) break;
  }
  return topics;
};

export const postTopics = (post = {}) => {
  const ordered = [];
  const seen = new Set();
  const candidates = [
    ...(Array.isArray(post.topics) ? post.topics : []),
    post.category,
    ...extractHashtags(post.content)
  ];
  for (const candidate of candidates) {
    const topic = normalizeTopic(candidate);
    if (!topic || seen.has(topic)) continue;
    seen.add(topic);
    ordered.push(topic);
    if (ordered.length >= MAX_POST_TOPICS) break;
  }
  return ordered;
};
