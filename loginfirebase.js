import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile, GoogleAuthProvider, signInWithPopup } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore, doc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCTAxRZ7dsKhogtd6LVsfENLyXSu6GWXAg",
  authDomain: "anon-chat-e7acd.firebaseapp.com",
  databaseURL: "https://anon-chat-e7acd-default-rtdb.firebaseio.com",
  projectId: "anon-chat-e7acd",
  storageBucket: "anon-chat-e7acd.appspot.com",
  messagingSenderId: "1063426879391",
  appId: "1:1063426879391:web:34d84186bc665e487dd7aa",
  measurementId: "G-LF1NTLY7JB"
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

// Example usage
writeUserData("andreawu", "awu", "myemail@me.com", "password", "myimageurl");

const auth = getAuth(app);
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
      console.log('Signed in successfully:', user);
    })
    .catch((error) => {
      console.error('Error signing in:', error);
    });
});