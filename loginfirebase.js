import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyCTAxRZ7dsKhogtd6LVsfENLyXSu6GWXAg",
  authDomain: "anon-chat-e7acd.firebaseapp.com",
  databaseURL: "https://anon-chat-e7acd-default-rtdb.firebaseio.com",
  projectId: "anon-chat-e7acd",
  storageBucket: "anon-chat-e7acd.appspot.com",
  messagingSenderId: "1063426879391",
  appId: "1:1063426879391:web:34d84186bc665e487dd7aa",
  measurementId: "G-LF1NTLY7JB"
}

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

document.getElementById('submit').addEventListener('click', function(event) {
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

document.getElementById('sign-up').addEventListener('click', function(event) {
    event.preventDefault();
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;

    console.log('Attempting to sign up with email:', email);

    createUserWithEmailAndPassword(auth, email, password)
        .then((userCredential) => {
            // Signed up
            const user = userCredential.user;
            console.log('User signed up:', user);
            window.location.href = 'timeline.html'; // Redirect to timeline
        })
        .catch((error) => {
            const errorCode = error.code;
            const errorMessage = error.message;
            console.error('Error signing up:', errorCode, errorMessage);
            alert('Sign up failed: ' + errorMessage);
        });
});