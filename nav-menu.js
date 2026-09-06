(() => {
  import("./appearance-accessibility.js").catch(error => {
    console.warn("Unable to apply account appearance settings", error);
  });
  const button = document.getElementById("main-menu-button");
  const panel = document.getElementById("main-menu-panel");
  if (!button || !panel) return;

  panel.querySelectorAll('a[href="groups.html"], a[href="communities.html"], a[href="group-detail.html"], a[href="community-detail.html"]').forEach((link) => link.remove());

  const products = [
    ["community.html", "Temporary Rooms"],
    ["premium-rooms.html", "Premium Rooms"],
    ["settings.html", "Settings"]
  ];
  for (const [href, label] of products) {
    const existing = panel.querySelector(`a[href="${href}"]`);
    if (existing) existing.textContent = label;
    else {
      const link = document.createElement("a");
      link.href = href;
      link.textContent = label;
      panel.append(link);
    }
  }

  const close = () => { panel.hidden = true; button.setAttribute("aria-expanded", "false"); };

  const temporaryRoomsLink = panel.querySelector('a[href="community.html"]');
  temporaryRoomsLink?.addEventListener("click", async (event) => {
    event.preventDefault();
    close();
    const destination = temporaryRoomsLink.href;
    try {
      const [{ auth, db }, { ensureE2eeIdentity }] = await Promise.all([
        import("./firebase-config.js"),
        import("./e2ee-identity.js")
      ]);
      const user = auth.currentUser;
      if (!user) {
        window.location.href = destination;
        return;
      }
      await ensureE2eeIdentity(db, user);
      window.location.href = destination;
    } catch (error) {
      console.warn("Temporary Rooms encryption setup was not completed", error);
      window.alert(error?.message || "Complete encrypted-chat setup before entering Temporary Rooms.");
    }
  });

  button.addEventListener("click", (event) => {
    event.stopPropagation();
    const open = panel.hidden;
    panel.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".main-menu")) close();
  });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") close(); });
})();
