import fs from "node:fs";

const path = "timeline.css";
let css = fs.readFileSync(path, "utf8");
const marker = "/* Phase B content and discovery */";
if (!css.includes(marker)) {
  css += `

${marker}
.post-media-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 8px;
  margin-top: 12px;
  overflow: hidden;
  border-radius: 14px;
}

.post-media-grid .post-image {
  width: 100%;
  height: 100%;
  min-height: 180px;
  max-height: 520px;
  margin: 0;
  object-fit: cover;
  border-radius: 10px;
}

.post-media-grid.media-count-2,
.media-count-2 {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.post-media-grid.media-count-3,
.post-media-grid.media-count-4,
.media-count-3,
.media-count-4 {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.comment-reply {
  margin-left: clamp(18px, 6vw, 42px);
  border-left: 3px solid rgba(139, 92, 246, 0.45);
  border-radius: 0 12px 12px 0;
}

.edited-label {
  color: var(--muted);
  font-size: 0.76rem;
  font-weight: 700;
  white-space: nowrap;
}

.hashtag-link {
  color: #c4b5fd;
  font-weight: 800;
  text-decoration: none;
}

.hashtag-link:hover,
.hashtag-link:focus-visible {
  text-decoration: underline;
}

.admin-edit-history-host {
  display: grid;
  gap: 8px;
  margin-top: 10px;
}

.admin-edit-history,
.admin-edit-version {
  display: grid;
  gap: 6px;
}

.admin-edit-version {
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.035);
}

@media (max-width: 620px) {
  .post-media-grid,
  .post-media-grid.media-count-2,
  .post-media-grid.media-count-3,
  .post-media-grid.media-count-4,
  .media-count-2,
  .media-count-3,
  .media-count-4 {
    gap: 5px;
  }

  .post-media-grid .post-image {
    min-height: 130px;
    max-height: 360px;
  }

  .comment-reply {
    margin-left: 16px;
  }
}
`;
}
fs.writeFileSync(path, css);
console.log("Applied Phase B responsive styles");
