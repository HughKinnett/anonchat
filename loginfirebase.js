import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile, GoogleAuthProvider, signInWithPopup } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore, doc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";

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
const auth = getAuth(app);
const database = getDatabase(app);
const provider = new GoogleAuthProvider();

document.getElementById('sign-in-form').addEventListener('submit', function(event) {
    event.preventDefault();
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;

    console.log('Attempting to sign in with email:', email);

    signInWithEmailAndPassword(auth, email, password)
        .then((userCredential) => {
            // Signed in
            const user = userCredential.user;
            console.log('User signed in:', user);
            window.location.href = 'timeline.html'; // Redirect to timeline
        })
        .catch((error) => {
            const errorCode = error.code;
            const errorMessage = error.message;
            console.error('Error signing in:', errorCode, errorMessage);
            alert('Login failed: ' + errorMessage);
        });
});
document.getElementById('sign-up-form').addEventListener('submit', function(event) {
    event.preventDefault();
    const username = document.getElementById('username').value;
    const email = document.getElementById('sign-up-email').value;
    const password = document.getElementById('sign-up-password').value;

    console.log('Attempting to sign up with email:', email);

    createUserWithEmailAndPassword(auth, email, password)
        .then((userCredential) => {
            // Signed up
            const user = userCredential.user;
            console.log('User signed up:', user);

            // Update profile with username
            updateProfile(user, {
                displayName: username
            }).then(() => {
                console.log('Username updated:', username);
                window.location.href = 'timeline.html'; // Redirect to timeline
            }).catch((error) => {
                console.error('Error updating username:', error);
                alert('Sign up failed: ' + error.message);
            });
        })
        .catch((error) => {
            const errorCode = error.code;
            const errorMessage = error.message;
            console.error('Error signing up:', errorCode, errorMessage);
            alert('Sign up failed: ' + errorMessage);
        });
});