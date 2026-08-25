import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAyIEUtkZMQwjfDuml46HslThXpnbXilEk",
  authDomain: "anonchatlogin.firebaseapp.com",
  projectId: "anonchatlogin",
  storageBucket: "anonchatlogin.appspot.com",
  messagingSenderId: "734396560776",
  appId: "1:734396560776:web:49cb149c173633d77ab63d",
  measurementId: "G-2LDXDEGR8Y"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
