(() => {
  const emojis = [
    "😀", "😃", "😄", "😁", "😊", "🙂",
    "😂", "🤣", "😍", "🥰", "😘", "😎",
    "🤔", "🙄", "😢", "😭", "😡", "🤬",
    "👍", "👎", "👏", "🙌", "🙏", "💪",
    "❤️", "💜", "🔥", "🎉", "✨", "💯",
    "🖕", "🤝", "👀", "🤷", "😴", "🤯"
  ];
  const targets = ["#room-message"];

  const closeAll = (except) => {
    document.querySelectorAll(".emoji-picker-panel").forEach((panel) => {
      if (panel !== except) panel.hidden = true;
    });
    document.querySelectorAll(".emoji-picker-toggle").forEach((button) => {
      button.setAttribute("aria-expanded", String(!button.nextElementSibling?.hidden));
    });
  };

  const insertEmoji = (input, emoji) => {
    const start = Number.isInteger(input.selectionStart) ? input.selectionStart : input.value.length;
    const end = Number.isInteger(input.selectionEnd) ? input.selectionEnd : start;
    input.value = input.value.slice(0, start) + emoji + input.value.slice(end);
    const cursor = start + emoji.length;
    input.focus();
    input.setSelectionRange?.(cursor, cursor);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };

  targets.forEach((selector) => {
    const input = document.querySelector(selector);
    if (!input || input.dataset.emojiPickerReady === "true") return;
    input.dataset.emojiPickerReady = "true";
    const host = document.createElement("span");
    host.className = "emoji-picker-host";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "emoji-picker-toggle";
    toggle.textContent = "🙂";
    toggle.title = "Add emoji";
    toggle.setAttribute("aria-label", "Open emoji picker");
    toggle.setAttribute("aria-expanded", "false");
    const panel = document.createElement("div");
    panel.className = "emoji-picker-panel";
    panel.hidden = true;
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Choose an emoji");
    emojis.forEach((emoji) => {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "emoji-picker-option";
      option.textContent = emoji;
      option.setAttribute("aria-label", `Insert ${emoji}`);
      option.addEventListener("click", () => {
        insertEmoji(input, emoji);
        panel.hidden = true;
        toggle.setAttribute("aria-expanded", "false");
      });
      panel.append(option);
    });
    toggle.addEventListener("click", () => {
      const opening = panel.hidden;
      closeAll(opening ? panel : undefined);
      panel.hidden = !opening;
      toggle.setAttribute("aria-expanded", String(opening));
    });
    host.append(toggle, panel);
    input.insertAdjacentElement("afterend", host);
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".emoji-picker-host")) closeAll();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeAll();
  });
})();
