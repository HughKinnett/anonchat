(() => {
  const installButtons = document.querySelectorAll(".install-app");
  const help = document.querySelector(".install-help");
  let installPrompt;

  const isiOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches
    || window.navigator.standalone === true;

  const showAppleInstallGuide = () => {
    const overlay = document.createElement("div");
    overlay.className = "ios-install-overlay";
    overlay.setAttribute("role", "presentation");
    const dialog = document.createElement("section");
    dialog.className = "ios-install-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "ios-install-title");

    const title = document.createElement("h2");
    title.id = "ios-install-title";
    title.textContent = "Install AnonChat on iPhone";
    const steps = document.createElement("ol");
    ["Open this page in Safari.", "Tap the Share button (the square with an up arrow).", "Choose “Add to Home Screen,” then tap Add."].forEach((step) => {
      const item = document.createElement("li");
      item.textContent = step;
      steps.append(item);
    });
    const done = document.createElement("button");
    done.type = "button";
    done.textContent = "Got it";
    done.addEventListener("click", () => overlay.remove());
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) overlay.remove();
    });
    dialog.append(title, steps, done);
    overlay.append(dialog);
    document.body.append(overlay);
    done.focus();
  };

  const style = document.createElement("style");
  style.textContent = `
    .ios-install-overlay {
      position: fixed; z-index: 1000; inset: 0; display: grid; place-items: center;
      padding: 20px; background: rgba(3, 5, 10, .78); backdrop-filter: blur(8px);
    }
    .ios-install-dialog {
      width: min(420px, 100%); padding: 24px; border: 1px solid rgba(255,255,255,.14);
      border-radius: 20px; background: #141821; color: #f7f8fb;
      box-shadow: 0 24px 70px rgba(0,0,0,.55);
    }
    .ios-install-dialog h2 { margin: 0 0 14px; }
    .ios-install-dialog ol { margin: 0 0 20px; padding-left: 22px; line-height: 1.6; }
    .ios-install-dialog button {
      width: 100%; min-height: 44px; border: 0; border-radius: 999px;
      background: #8b5cf6; color: white; font: inherit; font-weight: 800;
    }
  `;
  document.head.append(style);

  if (isStandalone) {
    installButtons.forEach((button) => { button.hidden = true; });
  } else if (isiOS) {
    installButtons.forEach((button) => { button.textContent = "Install on iPhone"; });
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
  });

  installButtons.forEach((button) => {
    button.addEventListener("click", async () => {
      if (isiOS) {
        showAppleInstallGuide();
        return;
      }

      if (installPrompt) {
        installPrompt.prompt();
        await installPrompt.userChoice;
        installPrompt = undefined;
        return;
      }

      if (help) {
        help.textContent = "Open this site in Chrome, Edge, or Safari and use the browser’s Install/Add to Home Screen option.";
      }
    });
  });

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => {
        if (help) help.textContent = "App installation is unavailable until the site is served over HTTPS.";
      });
    });
  }
})();
