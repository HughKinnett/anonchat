import fs from "node:fs";

const path = "admin.js";
let source = fs.readFileSync(path, "utf8");

const replaceOnce = (needle, replacement, label) => {
  if (!source.includes(needle)) throw new Error(`Could not locate ${label}`);
  source = source.replace(needle, () => replacement);
};

replaceOnce(
  `function renderContent() {`,
  `async function loadContentEditHistory(entry, host, control) {
  const collectionName = entry.type === "community" ? "communityPosts" : "posts";
  control.disabled = true;
  host.replaceChildren(create("small", "Loading edit history…", "admin-note"));
  try {
    const postHistory = await getDocs(query(
      collection(db, collectionName, entry.id, "editHistory"),
      orderBy("archivedAt", "desc"),
      limit(20)
    ));
    const commentsSnapshot = await getDocs(query(
      collection(db, collectionName, entry.id, "comments"),
      limit(100)
    ));
    const editedComments = commentsSnapshot.docs.filter((comment) => Number(comment.data().editVersion || 0) > 0 || comment.data().editedAt);
    const commentHistories = await Promise.all(editedComments.map(async (comment) => ({
      comment,
      history: await getDocs(query(
        collection(db, collectionName, entry.id, "comments", comment.id, "editHistory"),
        orderBy("archivedAt", "desc"),
        limit(20)
      ))
    })));

    const sections = [];
    if (!postHistory.empty) {
      const section = create("section", undefined, "admin-edit-history");
      section.append(create("strong", "Previous post versions"));
      postHistory.docs.forEach((version) => {
        const data = version.data();
        const row = create("article", undefined, "admin-edit-version");
        row.append(
          create("small", `Version ${data.editVersion ?? "?"} · ${formatDate(data.archivedAt)}`),
          create("p", String(data.content || "Empty post text"))
        );
        section.append(row);
      });
      sections.push(section);
    }

    if (commentHistories.some(({ history }) => !history.empty)) {
      const section = create("section", undefined, "admin-edit-history");
      section.append(create("strong", "Previous comment versions"));
      commentHistories.forEach(({ comment, history }) => {
        if (history.empty) return;
        const current = comment.data();
        const heading = create("small", `Current comment by @${current.username || "anonymous"}: ${String(current.text || "").slice(0, 120)}`);
        section.append(heading);
        history.docs.forEach((version) => {
          const data = version.data();
          const row = create("article", undefined, "admin-edit-version");
          row.append(
            create("small", `Version ${data.editVersion ?? "?"} · ${formatDate(data.archivedAt)}`),
            create("p", String(data.content || "Empty comment text"))
          );
          section.append(row);
        });
      });
      sections.push(section);
    }

    host.replaceChildren(...(sections.length ? sections : [empty("No prior edited versions are available for this post or its loaded comments.")]));
    control.textContent = "Refresh edit history";
  } catch {
    host.replaceChildren(empty("Could not load edit history."));
    setStatus("Could not load that content's edit history.", true);
  } finally {
    control.disabled = false;
  }
}

function renderContent() {`,
  "renderContent declaration"
);

replaceOnce(
  `    const open = create("a", "View", "admin-action nav-button"); open.href = entry.type === "community" ? "community.html" : \`timeline.html#post-\${entry.id}\`;`,
  `    const open = create("a", "View", "admin-action nav-button"); open.href = entry.type === "community" ? "community.html" : \`timeline.html#post-\${entry.id}\`;
    const historyHost = create("div", undefined, "admin-edit-history-host");
    const viewHistory = create("button", "View edit history", "admin-action");
    viewHistory.type = "button";
    viewHistory.onclick = () => loadContentEditHistory(entry, historyHost, viewHistory);
    info.append(historyHost);`,
  "content View action"
);

replaceOnce(
  `    actions.append(open, remove); row.append(info, actions); return row;`,
  `    actions.append(open, viewHistory, remove); row.append(info, actions); return row;`,
  "content actions append"
);

fs.writeFileSync(path, source);
console.log("Applied admin Phase B edit-history viewer");
