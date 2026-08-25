(() => {
  const installButtons = document.querySelectorAll(".install-app");
  const help = document.querySelector(".install-help");
  let installPrompt;

  const isStandalone = window.matchMedia("(display-mode: standalone)").matches
    || window.navigator.standalone === true;

  if (isStandalone) {
    installButtons.forEach((button) => { button.hidden = true; });
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
  });

  installButtons.forEach((button) => {
    button.addEventListener("click", async () => {
      if (installPrompt) {
        installPrompt.prompt();
        await installPrompt.userChoice;
        installPrompt = undefined;
        return;
      }

      const isiOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
      if (help) {
        help.textContent = isiOS
          ? "On iPhone or iPad: tap Share, then “Add to Home Screen.”"
          : "Open this site in Chrome, Edge, or Safari and use the browser’s Install/Add to Home Screen option.";
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
