import { auth, db } from "./firebase-config.js";
import { exitAfterAuthLoss } from "./push-exit.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const status = document.getElementById("timeline-status");
const setStatus = (message, isError = false) => {
  if (!status) return;
  status.textContent = message;
  status.style.color = isError ? "#fca5a5" : "inherit";
};

const replaceDisplayedImage = async (imageId, source, custom = true) => {
  const current = document.getElementById(imageId);
  if (!current || !source) return;
  const replacement = current.cloneNode(false);
  replacement.src = source;
  replacement.hidden = false;
  replacement.classList.toggle("has-custom-photo", custom);
  try { await replacement.decode(); } catch { /* The browser can still render the data URL. */ }
  current.replaceWith(replacement);
};

const compressImage = (file, maxWidth, maxHeight, quality = 0.72) => new Promise((resolve, reject) => {
  if (!file?.type.startsWith("image/") || file.size > 10 * 1024 * 1024) {
    reject(new Error("Choose an image smaller than 10 MB."));
    return;
  }
  const reader = new FileReader();
  reader.onerror = () => reject(new Error("Could not read that image."));
  reader.onload = () => {
    const image = new Image();
    image.onerror = () => reject(new Error("Could not open that image."));
    image.onload = () => {
      const scale = Math.min(1, maxWidth / image.width, maxHeight / image.height);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
      const data = canvas.toDataURL("image/jpeg", quality);
      if (data.length > 360000) {
        reject(new Error("That image is still too large after compression."));
        return;
      }
      resolve(data);
    };
    image.src = reader.result;
  };
  reader.readAsDataURL(file);
});

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    await exitAfterAuthLoss({ redirect: () => location.replace("index.html") });
    return;
  }
  const profileRef = doc(db, "users", user.uid);
  const snapshot = await getDoc(profileRef);
  const profile = snapshot.exists() ? snapshot.data() : {};
  await replaceDisplayedImage(
    "profile-pic",
    profile.profileImage || "anonchat-anonymous.png",
    Boolean(profile.profileImage)
  );
  await replaceDisplayedImage(
    "banner-pic",
    profile.coverImage || "anonchat-anonymous.png",
    Boolean(profile.coverImage)
  );

  const bindUpload = (inputId, imageId, field, maxWidth, maxHeight) => {
    document.getElementById(inputId).addEventListener("change", async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      event.target.disabled = true;
      setStatus("Preparing your photo…");
      try {
        const imageData = await compressImage(file, maxWidth, maxHeight);
        await setDoc(profileRef, { [field]: imageData }, { merge: true });
        await replaceDisplayedImage(imageId, imageData);
        setStatus(field === "profileImage" ? "Profile photo replaced." : "Cover photo replaced.");
      } catch (error) {
        setStatus(error.message || "Could not update that photo.", true);
      } finally {
        event.target.value = "";
        event.target.disabled = false;
      }
    });
  };

  bindUpload("profile-upload", "profile-pic", "profileImage", 512, 512);
  bindUpload("banner-upload", "banner-pic", "coverImage", 1400, 500);
});
