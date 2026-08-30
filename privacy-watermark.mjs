const WATERMARK_ID = "anonchat-privacy-watermark";
const STYLE_ID = "anonchat-privacy-watermark-style";
let refreshTimer = 0;

const ensureStyle = () => {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    #${WATERMARK_ID} {
      position: fixed;
      inset: -18vh -16vw;
      z-index: 2147483000;
      display: grid;
      grid-template-columns: repeat(3, minmax(260px, 1fr));
      grid-auto-rows: minmax(120px, 1fr);
      align-items: center;
      justify-items: center;
      overflow: hidden;
      pointer-events: none;
      user-select: none;
      transform: rotate(-18deg);
      transform-origin: center;
      opacity: .16;
      color: #d8b4fe;
      mix-blend-mode: screen;
    }
    #${WATERMARK_ID} span {
      padding: .35rem .75rem;
      font: 700 clamp(.72rem, 1.25vw, 1rem)/1.25 system-ui, sans-serif;
      letter-spacing: .045em;
      white-space: nowrap;
      text-shadow: 0 0 10px rgba(139, 92, 246, .8);
    }
    @media (max-width: 680px) {
      #${WATERMARK_ID} {
        grid-template-columns: repeat(2, minmax(210px, 1fr));
        grid-auto-rows: minmax(105px, 1fr);
        opacity: .18;
      }
    }
    @media print {
      #${WATERMARK_ID} { opacity: .25; }
    }
  `;
  document.head.append(style);
};

const minuteStamp = () => new Intl.DateTimeFormat(undefined, {
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit"
}).format(new Date());

export const clearPrivacyWatermark = () => {
  if (refreshTimer) window.clearInterval(refreshTimer);
  refreshTimer = 0;
  document.getElementById(WATERMARK_ID)?.remove();
};

export const applyPrivacyWatermark = ({ username, surface = "private view" }) => {
  clearPrivacyWatermark();
  const safeUsername = String(username || "").replace(/^@+/, "").trim();
  if (!safeUsername) return;
  ensureStyle();
  const layer = document.createElement("div");
  layer.id = WATERMARK_ID;
  layer.setAttribute("aria-hidden", "true");
  const marks = Array.from({ length: 24 }, () => document.createElement("span"));
  layer.replaceChildren(...marks);
  document.body.append(layer);
  const refresh = () => {
    const label = `Viewer @${safeUsername} • ${surface} • ${minuteStamp()}`;
    marks.forEach((mark) => { mark.textContent = label; });
  };
  refresh();
  refreshTimer = window.setInterval(refresh, 30_000);
};
