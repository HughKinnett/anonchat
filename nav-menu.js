(() => {
  const button = document.getElementById("main-menu-button");
  const panel = document.getElementById("main-menu-panel");
  if (!button || !panel) return;
  const close = () => { panel.hidden = true; button.setAttribute("aria-expanded", "false"); };
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