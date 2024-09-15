import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile, GoogleAuthProvider, signInWithPopup } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore, doc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

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
const db = getFirestore(app);

async function writeUserData(userID, username, email, password, imageURL) {
  try {
    await setDoc(doc(db, 'users', userID), {
      username: username,
      email: email,
      password: password,
      profile_picture: imageURL
    });
    console.log('Data saved successfully.');
  } catch (error) {
    console.error('Error saving data:', error);
  }
}

const auth = getAuth(app);
const provider = new GoogleAuthProvider();

document.getElementById('sign-in-form').addEventListener('submit', function(event) {
  event.preventDefault();
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;

  if (!validateEmail(email)) {
    console.error('Invalid email format');
    return;
  }

  console.log('Attempting to sign in with email:', email);

  signInWithEmailAndPassword(auth, email, password)
    .then((userCredential) => {
      // Signed in
      const user = userCredential.user;
      console.log('Signed in successfully:', user);
    })
    .catch((error) => {
      console.error('Error signing in:', error);
    });
});

function validateEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(String(email).toLowerCase());
}