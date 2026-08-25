import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  addDoc, collection, deleteDoc, doc, getDoc, onSnapshot, orderBy, query,
  serverTimestamp, setDoc, Timestamp, updateDoc, where
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const $ = (id) => document.getElementById(id);
const state = { user:null, profile:null, privateDetails:{}, users:[], posts:[], votes:[], circles:[], members:[], rooms:[], roomMessages:[], requests:[], messages:[], reveals:[], preferences:null, activeRoom:"" };
const listeners = [];
const status = $("status");
const setStatus = (text, error=false) => { status.textContent=text; status.classList.toggle("danger",error); };
const userName = (uid) => state.users.find(x=>x.id===uid)?.data().username || "anonymous";
const now = () => Date.now();
const aggressive = /\b(fuck|bitch|kill|hate|stupid|idiot|dumb|worthless|shut up)\b/i;
const safeToSend = (text) => !state.preferences?.contextCheck || !aggressive.test(text) ||
  window.confirm("This may come across as aggressive. Do you want to send it as written?");
const escapeText = (v) => String(v || "");

document.querySelectorAll('[role="tab"]').forEach(button => button.addEventListener("click", () => {
  document.querySelectorAll('[role="tab"]').forEach(x => x.setAttribute("aria-selected", String(x===button)));
  document.querySelectorAll('[role="tabpanel"]').forEach(x => x.hidden = x.id !== button.dataset.panel);
}));
$("sign-out").addEventListener("click", async()=>{ listeners.forEach(x=>x()); await signOut(auth); location.replace("index.html"); });

const trustLabel = () => {
  const created = state.profile?.createdAt?.toMillis?.() || now();
  const ageDays = (now()-created)/86400000;
  const postCount = state.posts.filter(p=>p.data().authorId===state.user?.uid).length;
  if(ageDays>=30 && postCount>=20) return "Highly trusted";
  if(ageDays>=7 || postCount>=5) return "Established";
  return "New member";
};
const renderIdentity = () => {
  if(!state.profile) return;
  $("identity-card").innerHTML = "";
  const name=document.createElement("strong"); name.textContent="@"+state.profile.username;
  const trust=document.createElement("span"); trust.className="trust"; trust.textContent="◆ "+trustLabel();
  const note=document.createElement("span"); note.textContent="Email hidden · private details controlled by you";
  $("identity-card").append(name,trust,note);
};

const joinedCircle = id => state.members.some(m=>m.id===id+"_"+state.user.uid);
const renderCircles = () => {
  $("post-circle").replaceChildren(new Option("Everyone",""), ...state.circles.filter(c=>joinedCircle(c.id)).map(c=>new Option(c.data().name,c.id)));
  $("circle-list").replaceChildren(...state.circles.map(c=>{
    const d=c.data(), card=document.createElement("article"); card.className="list-card card-row";
    const text=document.createElement("div"), h=document.createElement("h3"), p=document.createElement("p");
    h.textContent=d.name; p.className="muted"; p.textContent=d.description;
    const count=state.members.filter(m=>m.data().circleId===c.id).length;
    const meta=document.createElement("span"); meta.className="pill"; meta.textContent=count+" member"+(count===1?"":"s");
    text.append(h,p,meta);
    const button=document.createElement("button"); button.className=joinedCircle(c.id)?"secondary":"primary";
    button.textContent=joinedCircle(c.id)?"Leave":"Join";
    button.onclick=async()=>{button.disabled=true; const ref=doc(db,"circleMembers",c.id+"_"+state.user.uid);
      try{ joinedCircle(c.id)?await deleteDoc(ref):await setDoc(ref,{circleId:c.id,uid:state.user.uid,createdAt:serverTimestamp()});}
      catch{setStatus("Could not update circle membership.",true);button.disabled=false;}
    };
    card.append(text,button); return card;
  }));
};
$("circle-form").addEventListener("submit",async e=>{e.preventDefault(); const name=$("circle-name").value.trim(),description=$("circle-description").value.trim();
  try{const made=await addDoc(collection(db,"circles"),{name,description,ownerId:state.user.uid,createdAt:serverTimestamp()});
    await setDoc(doc(db,"circleMembers",made.id+"_"+state.user.uid),{circleId:made.id,uid:state.user.uid,createdAt:serverTimestamp()});
    e.target.reset();setStatus("Circle created.");}catch{setStatus("Could not create that circle.",true);}
});

$("post-category").addEventListener("change",()=>{$("poll-options").hidden=$("post-category").value!=="Poll";});
$("community-post-form").addEventListener("submit",async e=>{e.preventDefault();const content=$("community-content").value.trim();
  if(!safeToSend(content)) return;
  const category=$("post-category").value, hours=Number($("post-expiry").value);
  const options=[...document.querySelectorAll(".poll-option")].map(x=>x.value.trim()).filter(Boolean);
  if(category==="Poll"&&options.length<2){setStatus("Add at least two poll choices.",true);return;}
  const button=e.submitter;button.disabled=true;
  try{await addDoc(collection(db,"communityPosts"),{authorId:state.user.uid,username:state.profile.username,content,category,circleId:$("post-circle").value,
    options:category==="Poll"?options:[],expiresAt:hours?Timestamp.fromMillis(now()+hours*3600000):null,createdAt:serverTimestamp()});
    e.target.reset();$("poll-options").hidden=true;setStatus("Community post published.");}
  catch{setStatus("Could not publish that post.",true);}finally{button.disabled=false;}
});

const canSeePost = p => {
  const d=p.data(); if(d.expiresAt?.toMillis?.()<=now()) return false;
  if(d.circleId&&!joinedCircle(d.circleId)) return false;
  const muted=state.preferences?.mutedKeywords||[];
  return !muted.some(k=>k&&d.content.toLowerCase().includes(k.toLowerCase()));
};
const renderPosts = () => {
  const category=$("feed-category").value;
  const visible=state.posts.filter(canSeePost).filter(p=>!category||p.data().category===category);
  $("community-feed").replaceChildren(...visible.map(p=>{
    const d=p.data(),card=document.createElement("article");card.className="post-card";
    const header=document.createElement("div");header.className="card-row";
    const h=document.createElement("h3");h.textContent=d.category+" · @"+d.username;
    const pill=document.createElement("span");pill.className="pill";pill.textContent=d.circleId?(state.circles.find(c=>c.id===d.circleId)?.data().name||"Circle"):"Everyone";
    header.append(h,pill);
    const body=document.createElement("p");body.className="post-body";body.textContent=d.content;
    const meta=document.createElement("p");meta.className="post-meta";
    const expires=d.expiresAt?.toMillis?.();meta.textContent=(d.createdAt?.toDate?.().toLocaleString()||"Just now")+(expires?" · Expires "+new Date(expires).toLocaleString():"");
    card.append(header,body,meta);
    if(d.category==="Poll"){
      const votes=state.votes.filter(v=>v.data().postId===p.id),mine=votes.find(v=>v.data().uid===state.user.uid);
      const poll=document.createElement("div");poll.className="poll";
      d.options.forEach((option,index)=>{const count=votes.filter(v=>v.data().option===index).length,b=document.createElement("button");
        b.type="button";b.setAttribute("aria-pressed",String(mine?.data().option===index));
        const label=document.createElement("span");label.textContent=option;const total=document.createElement("strong");total.textContent=count+" vote"+(count===1?"":"s");b.append(label,total);
        b.onclick=async()=>{b.disabled=true;const ref=doc(db,"communityVotes",p.id+"_"+state.user.uid);
          try{mine?.data().option===index?await deleteDoc(ref):await setDoc(ref,{postId:p.id,uid:state.user.uid,option:index,createdAt:serverTimestamp()});}
          catch{setStatus("Could not update your vote.",true);b.disabled=false;}};
        poll.append(b);});card.append(poll);
    }
    if(d.authorId===state.user.uid){const del=document.createElement("button");del.className="secondary";del.textContent="Remove";del.onclick=()=>deleteDoc(doc(db,"communityPosts",p.id));card.append(del);}
    return card;
  }));
  if(!visible.length){const empty=document.createElement("p");empty.className="muted";empty.textContent="No visible community posts match your filters."; $("community-feed").append(empty);}
  renderIdentity();
};
$("feed-category").addEventListener("change",renderPosts);

const aliasFor = roomId => {const key="anonchat-room-alias-"+roomId;let alias=localStorage.getItem(key);
  if(!alias){const a=["Quiet","Silver","Hidden","Brave","Kind","Midnight","Electric"],b=["Fox","Owl","River","Comet","Panda","Echo","Wolf"];alias=a[Math.floor(Math.random()*a.length)]+b[Math.floor(Math.random()*b.length)]+Math.floor(10+Math.random()*90);localStorage.setItem(key,alias);}return alias;};
const renderRooms=()=>{$("room-list").replaceChildren(...state.rooms.map(r=>{const d=r.data(),card=document.createElement("article");card.className="list-card card-row";
  const x=document.createElement("div"),h=document.createElement("h3"),p=document.createElement("p");h.textContent=d.name;p.className="muted";p.textContent=d.topic;x.append(h,p);
  const b=document.createElement("button");b.className="primary";b.textContent="Enter anonymously";b.onclick=()=>openRoom(r.id,d.name);card.append(x,b);return card;}));};
const openRoom=(id,name)=>{state.activeRoom=id;$("room-title").textContent=name;$("room-alias").textContent="You are "+aliasFor(id);renderRoomMessages();$("room-dialog").showModal();};
$("room-dialog").querySelector(".dialog-close").onclick=()=>{$("room-dialog").close();state.activeRoom="";};
const renderRoomMessages=()=>{const msgs=state.roomMessages.filter(m=>m.data().roomId===state.activeRoom&&m.data().expiresAt?.toMillis?.()>now());
  $("room-messages").replaceChildren(...msgs.map(m=>{const x=document.createElement("div");x.className="message"+(m.data().senderId===state.user.uid?" mine":"");const s=document.createElement("small");s.textContent=m.data().tempName;const p=document.createElement("span");p.textContent=m.data().text;x.append(s,p);return x;}));$("room-messages").scrollTop=$("room-messages").scrollHeight;};
$("room-form").addEventListener("submit",async e=>{e.preventDefault();try{await addDoc(collection(db,"rooms"),{name:$("room-name").value.trim(),topic:$("room-topic").value.trim(),ownerId:state.user.uid,createdAt:serverTimestamp()});e.target.reset();setStatus("Temporary room started.");}catch{setStatus("Could not start room.",true);}});
$("room-message-form").addEventListener("submit",async e=>{e.preventDefault();const text=$("room-message").value.trim();if(!safeToSend(text))return;
  try{await addDoc(collection(db,"roomMessages"),{roomId:state.activeRoom,senderId:state.user.uid,tempName:aliasFor(state.activeRoom),text,expiresAt:Timestamp.fromMillis(now()+86400000),createdAt:serverTimestamp()});e.target.reset();}catch{setStatus("Could not send room message.",true);}});

const requestFor=(other)=>state.requests.find(r=>[r.data().fromId,r.data().toId].includes(state.user.uid)&&[r.data().fromId,r.data().toId].includes(other));
const acceptedUsers=()=>state.users.filter(u=>u.id!==state.user.uid&&requestFor(u.id)?.data().status==="accepted");
const renderMessageUsers=()=>{
  const others=state.users.filter(u=>u.id!==state.user.uid);$("message-user").replaceChildren(...others.map(u=>new Option("@"+u.data().username,u.id)));
  $("conversation-user").replaceChildren(...acceptedUsers().map(u=>new Option("@"+u.data().username,u.id)));
  $("direct-message-form").hidden=!acceptedUsers().length;renderDirectMessages();renderReveals();
};
$("request-chat").onclick=async()=>{const to=$("message-user").value;if(!to)return;const id=[state.user.uid,to].sort().join("_");
  try{await setDoc(doc(db,"messageRequests",id),{fromId:state.user.uid,toId:to,status:"pending",createdAt:serverTimestamp()});setStatus("Conversation request sent.");}catch{setStatus("Could not send request.",true);}};
const renderRequests=()=>{$("request-list").replaceChildren(...state.requests.filter(r=>r.data().toId===state.user.uid&&r.data().status==="pending").map(r=>{const card=document.createElement("div");card.className="list-card card-row";
  const p=document.createElement("span");p.textContent="@"+userName(r.data().fromId)+" wants to message you";const actions=document.createElement("div");
  ["Accept","Decline"].forEach(label=>{const b=document.createElement("button");b.className=label==="Accept"?"primary":"secondary";b.textContent=label;b.onclick=()=>updateDoc(r.ref,{status:label.toLowerCase(),respondedAt:serverTimestamp()});actions.append(b);});card.append(p,actions);return card;}));};
$("conversation-user").addEventListener("change",()=>{renderDirectMessages();renderReveals();});
const renderDirectMessages=()=>{const other=$("conversation-user").value,msgs=state.messages.filter(m=>m.data().participants.includes(state.user.uid)&&m.data().participants.includes(other));
  $("direct-messages").replaceChildren(...msgs.map(m=>{const x=document.createElement("div");x.className="message"+(m.data().senderId===state.user.uid?" mine":"");const s=document.createElement("small");s.textContent="@"+userName(m.data().senderId);const p=document.createElement("span");p.textContent=m.data().text;x.append(s,p);return x;}));$("direct-messages").scrollTop=$("direct-messages").scrollHeight;};
$("direct-message-form").addEventListener("submit",async e=>{e.preventDefault();const other=$("conversation-user").value,text=$("direct-message").value.trim();if(!other||!safeToSend(text))return;
  try{await addDoc(collection(db,"directMessages"),{participants:[state.user.uid,other].sort(),senderId:state.user.uid,text,createdAt:serverTimestamp()});e.target.reset();}catch{setStatus("Could not send private message.",true);}});

$("send-reveal").onclick=async()=>{const to=$("conversation-user").value;if(!to)return;const fields={interests:$("reveal-interests").checked,region:$("reveal-region").checked,ageRange:$("reveal-age").checked};
  if(!Object.values(fields).some(Boolean)){setStatus("Choose at least one detail to reveal.",true);return;}
  try{await setDoc(doc(db,"reveals",state.user.uid+"_"+to),{fromId:state.user.uid,toId:to,fields,status:"pending",createdAt:serverTimestamp()});setStatus("Mutual reveal request sent.");}catch{setStatus("Could not send reveal request.",true);}};
const renderReveals=()=>{const other=$("conversation-user").value, incoming=state.reveals.find(r=>r.data().fromId===other&&r.data().toId===state.user.uid),out=state.reveals.find(r=>r.data().fromId===state.user.uid&&r.data().toId===other);
  const box=$("reveal-status");box.replaceChildren();
  if(incoming?.data().status==="pending"){const p=document.createElement("p");p.textContent="@"+userName(other)+" requested a controlled reveal.";const b=document.createElement("button");b.className="primary";b.textContent="Accept selected reveal";b.onclick=()=>updateDoc(incoming.ref,{status:"accepted",respondedAt:serverTimestamp()});box.append(p,b);}
  if(incoming?.data().status==="accepted"&&out?.data().status==="accepted"){const p=document.createElement("p");p.textContent="Mutual reveal accepted. Loading the selected details…";box.append(p);getDoc(doc(db,"userPrivate",other)).then(s=>{const theirs=s.data()||{},fields=incoming.data().fields,parts=[];if(fields.interests&&theirs.interests)parts.push("Interests: "+theirs.interests);if(fields.region&&theirs.region)parts.push("Region: "+theirs.region);if(fields.ageRange&&theirs.ageRange)parts.push("Age range: "+theirs.ageRange);p.textContent=parts.join(" · ")||"They accepted but have not filled in those details.";}).catch(()=>{p.textContent="The selected details are not available.";});}
};

$("privacy-form").addEventListener("submit",async e=>{e.preventDefault();const muted=$("muted-keywords").value.split(",").map(x=>x.trim()).filter(Boolean).slice(0,20);
  try{await setDoc(doc(db,"userPreferences",state.user.uid),{uid:state.user.uid,mutedKeywords:muted,contextCheck:$("context-check").checked,updatedAt:serverTimestamp()},{merge:true});
    await setDoc(doc(db,"userPrivate",state.user.uid),{uid:state.user.uid,interests:$("privacy-interests").value.trim(),region:$("privacy-region").value.trim(),ageRange:$("privacy-age").value,updatedAt:serverTimestamp()},{merge:true}); state.privateDetails={interests:$("privacy-interests").value.trim(),region:$("privacy-region").value.trim(),ageRange:$("privacy-age").value};
    setStatus("Privacy choices saved.");}catch{setStatus("Could not save privacy choices.",true);}};
const loadPrivacy=()=>{const p=state.preferences||{};$("muted-keywords").value=(p.mutedKeywords||[]).join(", ");$("context-check").checked=p.contextCheck!==false;
  $("privacy-interests").value=state.privateDetails.interests||"";$("privacy-region").value=state.privateDetails.region||"";$("privacy-age").value=state.privateDetails.ageRange||"";};
$("download-data").onclick=()=>{const data={profile:{username:state.profile.username},preferences:state.preferences,communityPosts:state.posts.filter(p=>p.data().authorId===state.user.uid).map(p=>p.data()),circles:state.members.filter(m=>m.data().uid===state.user.uid).map(m=>m.data()),messages:state.messages.filter(m=>m.data().participants.includes(state.user.uid)).map(m=>m.data())};
  const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:"application/json"}));a.download="anonchat-my-data.json";a.click();setTimeout(()=>URL.revokeObjectURL(a.href),5000);};

const listen=(ref,key,render)=>listeners.push(onSnapshot(ref,s=>{state[key]=s.docs;render?.();},()=>setStatus("A community section could not load.",true)));
onAuthStateChanged(auth,async user=>{if(!user){location.replace("index.html");return;}state.user=user;const snap=await getDoc(doc(db,"users",user.uid));if(!snap.exists()||snap.data().banned){await signOut(auth);location.replace("index.html");return;}state.profile=snap.data();const privateSnap=await getDoc(doc(db,"userPrivate",user.uid));state.privateDetails=privateSnap.exists()?privateSnap.data():{};loadPrivacy();renderIdentity();
  listen(collection(db,"users"),"users",()=>{renderMessageUsers();renderRequests();});
  listen(query(collection(db,"communityPosts"),orderBy("createdAt","desc")),"posts",renderPosts);
  listen(collection(db,"communityVotes"),"votes",renderPosts);
  listen(query(collection(db,"circles"),orderBy("createdAt","desc")),"circles",()=>{renderCircles();renderPosts();});
  listen(collection(db,"circleMembers"),"members",()=>{renderCircles();renderPosts();});
  listen(query(collection(db,"rooms"),orderBy("createdAt","desc")),"rooms",renderRooms);
  listen(query(collection(db,"roomMessages"),orderBy("createdAt","asc")),"roomMessages",renderRoomMessages);
  const mergePrivate = (key, firstQuery, secondQuery, render) => {
    let first=[], second=[];
    listeners.push(onSnapshot(firstQuery,s=>{first=s.docs;state[key]=[...first,...second];render();},()=>setStatus("A private section could not load.",true)));
    listeners.push(onSnapshot(secondQuery,s=>{second=s.docs;state[key]=[...first,...second].filter((item,index,list)=>list.findIndex(x=>x.id===item.id)===index);render();},()=>setStatus("A private section could not load.",true)));
  };
  mergePrivate("requests",query(collection(db,"messageRequests"),where("fromId","==",user.uid)),query(collection(db,"messageRequests"),where("toId","==",user.uid)),()=>{renderRequests();renderMessageUsers();});
  listen(query(collection(db,"directMessages"),where("participants","array-contains",user.uid)),"messages",renderDirectMessages);
  mergePrivate("reveals",query(collection(db,"reveals"),where("fromId","==",user.uid)),query(collection(db,"reveals"),where("toId","==",user.uid)),renderReveals);
  listeners.push(onSnapshot(doc(db,"userPreferences",user.uid),s=>{state.preferences=s.exists()?s.data():{contextCheck:true,mutedKeywords:[]};loadPrivacy();renderPosts();}));
});