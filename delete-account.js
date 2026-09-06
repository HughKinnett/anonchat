import { auth, db } from "./firebase-config.js";
import { recordPageActivity } from "./activity-integration.mjs";
import { preparePushForAccountDeletion, selfDeletionQueuePayloads } from "./account-deletion-push.mjs";
import { createPushAlertsClient } from "./push-client.mjs";
import { VAPID_PUBLIC_KEY } from "./push-config.mjs";
import { exitAuthenticatedSession } from "./push-exit.js";
import { EmailAuthProvider, onAuthStateChanged, reauthenticateWithCredential, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  collection, deleteDoc, doc, getDoc, getDocs, query, setDoc,
  serverTimestamp, updateDoc, where, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const form=document.getElementById("delete-account-form"),status=document.getElementById("delete-status"),button=document.getElementById("delete-account-button");
let currentUser=null,profile=null;
const setStatus=(text)=>{status.textContent=text;};
const queryDocs=async(ref)=>[...(await getDocs(ref)).docs];
const serviceWorkerSupported="serviceWorker" in navigator,pushSupported="PushManager" in window;
const protectedAdministrator=(value)=>["i_love_you_h","cybercapone"].includes(String(value||"").toLowerCase());

const deleteInChunks=async(refs)=>{
  const unique=[...new Map(refs.map(ref=>[ref.path,ref])).values()];
  for(let start=0;start<unique.length;start+=400){
    const batch=writeBatch(db);unique.slice(start,start+400).forEach(ref=>batch.delete(ref));await batch.commit();
  }
};

const deletionPushClient=createPushAlertsClient({
  notification:"Notification" in window?window.Notification:null,
  serviceWorkerSupported,
  pushSupported,
  serviceWorkerReady:serviceWorkerSupported?navigator.serviceWorker.ready:null,
  publicKey:VAPID_PUBLIC_KEY,
  subtle:window.crypto?.subtle,
  timestamp:serverTimestamp,
  persist:async()=>{},
  remove:({id})=>deleteDoc(doc(db,"pushSubscriptions",id))
});

const loadDeletionProfile=async(user)=>{
  const snap=await getDoc(doc(db,"users",user.uid));
  if(!snap.exists())throw new Error("profile-missing");
  const nextProfile=snap.data();
  if(protectedAdministrator(nextProfile.username))throw new Error("protected-admin");
  currentUser=user;
  profile=nextProfile;
  document.getElementById("delete-email").value=user.email||document.getElementById("delete-email").value;
  void recordPageActivity({
    surface:"delete-account",
    profile,
    user,
    db,
    firestore:{doc,updateDoc,serverTimestamp}
  });
  return nextProfile;
};

onAuthStateChanged(auth,async user=>{
  if(!user){
    currentUser=null;profile=null;form.hidden=false;
    setStatus("Enter your account email and password below to verify the account you want to delete.");
    return;
  }
  try{
    await loadDeletionProfile(user);
    setStatus("Account verified. Complete the confirmation below to permanently delete it.");
  }catch(error){
    if(error.message==="protected-admin"){
      form.hidden=true;setStatus("Protected administrator accounts cannot be deleted from this page.");return;
    }
    await exitAuthenticatedSession({user,redirect:()=>{}}).catch(()=>{});
    currentUser=null;profile=null;form.hidden=false;
    setStatus("We could not load that account. Enter the account email and password below to try again.");
  }
});

form.addEventListener("submit",async event=>{
  event.preventDefault();
  if(document.getElementById("delete-word").value!=="DELETE"){setStatus("Type DELETE exactly to continue.");return;}
  if(!window.confirm("Permanently delete this account and its AnonChat data? This is the final confirmation."))return;
  button.disabled=true;[...form.elements].forEach(x=>x.disabled=true);setStatus("Verifying your account…");
  try{
    const email=document.getElementById("delete-email").value.trim();
    const password=document.getElementById("delete-password").value;
    if(!currentUser){
      const credential=await signInWithEmailAndPassword(auth,email,password);
      currentUser=credential.user;
      await loadDeletionProfile(currentUser);
    }
    if(email.toLowerCase()!==String(currentUser.email||"").toLowerCase())throw new Error("email-mismatch");
    if(!profile)profile=await loadDeletionProfile(currentUser);
    await reauthenticateWithCredential(currentUser,EmailAuthProvider.credential(email,password));
    const requestRef=doc(db,"accountDeletionRequests",currentUser.uid);
    await preparePushForAccountDeletion({
      uid:currentUser.uid,
      ensureDeletionRequest:async()=>{
        const jobRef=doc(db,"adminDeletionJobs",currentUser.uid);
        const [requestSnapshot,jobSnapshot]=await Promise.all([getDoc(requestRef),getDoc(jobRef)]);
        if(requestSnapshot.exists()&&jobSnapshot.exists())return;
        if(requestSnapshot.exists()&&!jobSnapshot.exists()){
          const payloads=selfDeletionQueuePayloads({uid:currentUser.uid,username:profile.username,timestamp:requestSnapshot.data().createdAt});
          await setDoc(jobRef,payloads.job);return;
        }
        if(jobSnapshot.exists())return;
        const timestamp=serverTimestamp(),payloads=selfDeletionQueuePayloads({uid:currentUser.uid,username:profile.username,timestamp});
        const batch=writeBatch(db);batch.set(requestRef,payloads.request);batch.set(jobRef,payloads.job);await batch.commit();
      },
      listSubscriptionRefs:async uid=>(await queryDocs(query(collection(db,"pushSubscriptions"),where("uid","==",uid)))).map(snapshot=>snapshot.ref),
      deleteSubscriptionRefs:deleteInChunks,
      unsubscribeCurrent:async()=>{
        if(!(await deletionPushClient.cleanupForSignOut(currentUser,{removeDocument:false})))throw new Error("push-unsubscribe-failed");
      }
    });
    setStatus("Account locked. Permanent deletion is queued and will continue automatically.");
    await exitAuthenticatedSession({user:currentUser,redirect:()=>{localStorage.clear();sessionStorage.clear();location.replace("index.html?accountDeletionQueued=1");}});
  }catch(error){
    console.error(error);
    let message="Account deletion could not be completed. Your account may remain in deletion mode; please retry to continue cleanup.";
    if(error.message==="email-mismatch")message="Enter the email address currently attached to this account.";
    if(error.message==="protected-admin")message="Protected administrator accounts cannot be deleted from this page.";
    if(error.message==="profile-missing")message="That login does not have an AnonChat profile available for deletion.";
    if(["auth/invalid-credential","auth/wrong-password","auth/user-not-found","auth/invalid-email"].includes(error.code))message="The email or password was not recognized. Use Forgot password first if needed, then try deletion again.";
    if(error.code==="auth/too-many-requests")message="Too many attempts. Wait a few minutes before trying again.";
    setStatus(message);button.disabled=false;[...form.elements].forEach(x=>x.disabled=false);
  }
});
