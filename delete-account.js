import { auth, db } from "./firebase-config.js";
import { deleteUser, EmailAuthProvider, onAuthStateChanged, reauthenticateWithCredential, signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  collection, collectionGroup, deleteDoc, doc, getDoc, getDocs, query, runTransaction,
  serverTimestamp, setDoc, where, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const form=document.getElementById("delete-account-form"),status=document.getElementById("delete-status"),button=document.getElementById("delete-account-button");
let currentUser=null,profile=null;
const setStatus=(text)=>{status.textContent=text;};
const uniqueDocs=docs=>[...new Map(docs.map(x=>[x.ref.path,x])).values()];
const queryDocs=async(ref)=>[...(await getDocs(ref)).docs];

const deleteInChunks=async(refs)=>{
  const unique=[...new Map(refs.map(ref=>[ref.path,ref])).values()];
  for(let start=0;start<unique.length;start+=400){
    const batch=writeBatch(db);unique.slice(start,start+400).forEach(ref=>batch.delete(ref));await batch.commit();
  }
};

const gatherOwnedData=async(uid)=>{
  const [
    posts,communityPosts,comments,reactions,followsOut,followsIn,members,roomMessages,votes,
    requestsOut,requestsIn,messages,revealsOut,revealsIn,reads,circles,rooms
  ]=await Promise.all([
    queryDocs(query(collection(db,"posts"),where("authorId","==",uid))),
    queryDocs(query(collection(db,"communityPosts"),where("authorId","==",uid))),
    queryDocs(query(collectionGroup(db,"comments"),where("uid","==",uid))),
    queryDocs(query(collectionGroup(db,"reactions"),where("uid","==",uid))),
    queryDocs(query(collection(db,"follows"),where("followerId","==",uid))),
    queryDocs(query(collection(db,"follows"),where("followingId","==",uid))),
    queryDocs(query(collection(db,"circleMembers"),where("uid","==",uid))),
    queryDocs(query(collection(db,"roomMessages"),where("senderId","==",uid))),
    queryDocs(query(collection(db,"communityVotes"),where("uid","==",uid))),
    queryDocs(query(collection(db,"messageRequests"),where("fromId","==",uid))),
    queryDocs(query(collection(db,"messageRequests"),where("toId","==",uid))),
    queryDocs(query(collection(db,"directMessages"),where("participants","array-contains",uid))),
    queryDocs(query(collection(db,"reveals"),where("fromId","==",uid))),
    queryDocs(query(collection(db,"reveals"),where("toId","==",uid))),
    queryDocs(query(collection(db,"notificationReads"),where("uid","==",uid))),
    queryDocs(query(collection(db,"circles"),where("ownerId","==",uid))),
    queryDocs(query(collection(db,"rooms"),where("ownerId","==",uid)))
  ]);

  const nested=[];
  for(const post of posts){
    const [postComments,postReactions]=await Promise.all([
      queryDocs(collection(db,"posts",post.id,"comments")),
      queryDocs(collection(db,"posts",post.id,"reactions"))
    ]);
    nested.push(...postComments,...postReactions);
  }
  return uniqueDocs([
    ...nested,...comments,...reactions,...followsOut,...followsIn,...members,...roomMessages,...votes,
    ...requestsOut,...requestsIn,...messages,...revealsOut,...revealsIn,...reads,
    ...communityPosts,...posts,...circles,...rooms
  ]).map(x=>x.ref);
};

onAuthStateChanged(auth,async user=>{
  if(!user){location.replace("index.html");return;}
  currentUser=user;const snap=await getDoc(doc(db,"users",user.uid));
  if(!snap.exists()){await signOut(auth);location.replace("index.html");return;}
  profile=snap.data();
  if(["i_love_you_h","ownercybercapone"].includes(String(profile.username||"").toLowerCase())){
    form.hidden=true;setStatus("Protected administrator accounts cannot be deleted from this page.");return;
  }
  document.getElementById("delete-email").value=user.email||"";
});

form.addEventListener("submit",async event=>{
  event.preventDefault();
  if(!currentUser||!profile)return;
  if(document.getElementById("delete-word").value!=="DELETE"){setStatus("Type DELETE exactly to continue.");return;}
  if(!window.confirm("Permanently delete this account and its AnonChat data? This is the final confirmation."))return;
  button.disabled=true;[...form.elements].forEach(x=>x.disabled=true);setStatus("Verifying your password…");
  try{
    const email=document.getElementById("delete-email").value.trim();
    const password=document.getElementById("delete-password").value;
    if(email.toLowerCase()!==String(currentUser.email||"").toLowerCase())throw new Error("email-mismatch");
    await reauthenticateWithCredential(currentUser,EmailAuthProvider.credential(email,password));
    const requestRef=doc(db,"accountDeletionRequests",currentUser.uid);
    await setDoc(requestRef,{uid:currentUser.uid,username:profile.username,createdAt:serverTimestamp()});
    setStatus("Removing your posts and account activity…");
    const refs=await gatherOwnedData(currentUser.uid);
    refs.push(doc(db,"userPreferences",currentUser.uid),doc(db,"userPrivate",currentUser.uid));
    await deleteInChunks(refs);
    setStatus("Releasing your username and profile…");
    await runTransaction(db,async transaction=>{
      const statsRef=doc(db,"system","accountStats"),stats=await transaction.get(statsRef);
      transaction.delete(doc(db,"usernames",String(profile.username).toLowerCase()));
      transaction.delete(doc(db,"users",currentUser.uid));
      if(stats.exists())transaction.update(statsRef,{count:Math.max(0,(stats.data().count||1)-1),limit:500,updatedAt:serverTimestamp()});
      transaction.delete(requestRef);
    });
    setStatus("Deleting your sign-in…");
    await deleteUser(currentUser);
    localStorage.clear();sessionStorage.clear();location.replace("index.html?accountDeleted=1");
  }catch(error){
    console.error(error);
    let message="Account deletion could not be completed. Your account remains active; please try again.";
    if(error.message==="email-mismatch")message="Enter the email address currently attached to this account.";
    if(["auth/invalid-credential","auth/wrong-password"].includes(error.code))message="The password was not recognized. Use Forgot password first, then try deletion again.";
    if(error.code==="auth/too-many-requests")message="Too many attempts. Wait a few minutes before trying again.";
    setStatus(message);button.disabled=false;[...form.elements].forEach(x=>x.disabled=false);
  }
});