import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword } from "firebase/auth.js";
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


// Initialize Firebase Authentication
const auth = getAuth();

// Define email and password variables
const email = "user@example.com";
const password = "userPassword";

// Create a new user with email and password
createUserWithEmailAndPassword(auth, email, password)
  .then((userCredential) => {
    // Signed in 
    const user = userCredential.user;
    console.log("User created:", user);
  })
  .catch((error) => {
    const errorCode = error.code;
    const errorMessage = error.message;
    console.error("Error creating user:", errorCode, errorMessage);
  });

// Sign in an existing user with email and password
signInWithEmailAndPassword(auth, email, password)
  .then((userCredential) => {
    // Signed in 
    const user = userCredential.user;
    console.log("User signed in:", user);
  })
  .catch((error) => {
    const errorCode = error.code;
    const errorMessage = error.message;
    console.error("Error signing in:", errorCode, errorMessage);
  });

