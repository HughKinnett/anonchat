import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { addDoc, collection, doc, getDoc, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc, where } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
const $=id=>document.getElementById(id);
const state={user:null,profile:null,users:[],requests:[],messages:[],readAt:0,active:""};
const unsubs=[];let first=[],second=[],markTimer;
const status=(text,error=false)=>{$("messages-status").textContent=text;$("messages-status").style.color=error?"#fca5a5":"";};
const nameFor=uid=>state.users.find(u=>u.id===uid)?.data().username||"anonymous";
const timeOf=value=>value?.toMillis?.()||0;
const requestFor=uid=>state.requests.find(r=>[r.data().fromId,r.data().toId].includes(state.user.uid)&&[r.data().fromId,r.data().toId].includes(uid));
const acceptedIds=()=>state.users.filter(u=>u.id!==state.user.uid&&requestFor(u.id)?.data().status==="accepted").map(u=>u.id);
const messagesWith=uid=>state.messages.filter(m=>m.data().participants?.includes(uid)).sort((a,b)=>timeOf(a.data().createdAt)-timeOf(b.data().createdAt));
const incomingUnread=()=>state.messages.filter(m=>m.data().senderId!==state.user.uid&&timeOf(m.data().createdAt)>state.readAt).length;
const renderCount=()=>{const n=incomingUnread();$("message-count").textContent=`${n} unread`;document.title=n?`(${n}) AnonChat — Messages`:"AnonChat — Messages";};
const renderRequests=()=>{
  const incoming=state.requests.filter(r=>r.data().toId===state.user.uid&&r.data().status==="pending");
  $("request-list").replaceChildren(...incoming.map(r=>{const row=document.createElement("div");row.className="request-item";const label=document.createElement("span");label.textContent=`@${nameFor(r.data().fromId)} wants to message you`;const actions=document.createElement("div");["Accept","Decline"].forEach(word=>{const b=document.createElement("button");b.type="button";b.textContent=word;b.className=word==="Accept"?"primary":"secondary";b.onclick=()=>updateDoc(r.ref,{status:word.toLowerCase(),respondedAt:serverTimestamp()}).catch(()=>status("Could not update that request.",true));actions.append(b);});row.append(label,actions);return row;}));
};
const renderRequestUsers=()=>{const choices=state.users.filter(u=>u.id!==state.user.uid&&requestFor(u.id)?.data().status!=="accepted");$("request-user").replaceChildren(...choices.map(u=>new Option("@"+u.data().username,u.id)));$("new-request-form").hidden=!choices.length;};
const renderConversationList=()=>{
  const ids=acceptedIds();$("conversation-total").textContent=String(ids.length);
  if(!state.active||!ids.includes(state.active))state.active=ids[0]||"";
  $("conversation-list").replaceChildren(...ids.map(uid=>{const msgs=messagesWith(uid),last=msgs.at(-1)?.data();const b=document.createElement("button");b.type="button";b.className="conversation-button"+(uid===state.active?" active":"");const avatar=document.createElement("span");avatar.className="conversation-avatar";avatar.textContent=nameFor(uid).slice(0,1).toUpperCase();const copy=document.createElement("span");copy.className="conversation-copy";const strong=document.createElement("strong");strong.textContent="@"+nameFor(uid);const small=document.createElement("small");small.textContent=last?.text||"Start the conversation";copy.append(strong,small);b.append(avatar,copy);b.onclick=()=>{state.active=uid;renderConversationList();renderStream();};return b;}));
  renderStream();
};
const renderStream=()=>{
  const uid=state.active;$("message-form").hidden=!uid;
  if(!uid){$("chat-title").textContent="Select a conversation";$("message-stream").innerHTML='<p class="empty-state">Accepted conversations will appear here.</p>';return;}
  $("chat-title").textContent="@"+nameFor(uid);const msgs=messagesWith(uid);
  $("message-stream").replaceChildren(...(msgs.length?msgs.map(m=>{const data=m.data(),box=document.createElement("article");box.className="bubble"+(data.senderId===state.user.uid?" mine":"");const who=document.createElement("small");who.textContent=data.senderId===state.user.uid?"You":"@"+nameFor(data.senderId);const body=document.createElement("p");body.textContent=data.text;box.append(who,body);return box;}):[Object.assign(document.createElement("p"),{className:"empty-state",textContent:"No messages yet. Say hello."})]));
  $("message-stream").scrollTop=$("message-stream").scrollHeight;
};
const mergeRequests=()=>{state.requests=[...first,...second].filter((x,i,a)=>a.findIndex(y=>y.id===x.id)===i);renderRequests();renderRequestUsers();renderConversationList();};
const markRead=()=>{clearTimeout(markTimer);markTimer=setTimeout(()=>setDoc(doc(db,"messageReads",state.user.uid),{uid:state.user.uid,lastReadAt:serverTimestamp()},{merge:true}).catch(()=>{}),500);};
$("new-request-form").addEventListener("submit",async e=>{e.preventDefault();const to=$("request-user").value;if(!to)return;try{await setDoc(doc(db,"messageRequests",[state.user.uid,to].sort().join("_")),{fromId:state.user.uid,toId:to,status:"pending",createdAt:serverTimestamp()});status("Conversation request sent.");}catch{status("Could not send that request.",true);}});
$("message-form").addEventListener("submit",async e=>{e.preventDefault();const text=$("message-text").value.trim();if(!state.active||!text)return;try{await addDoc(collection(db,"directMessages"),{participants:[state.user.uid,state.active].sort(),senderId:state.user.uid,text,createdAt:serverTimestamp()});e.target.reset();}catch{status("Could not send that message.",true);}});
$("sign-out").onclick=async()=>{unsubs.forEach(x=>x());await signOut(auth);location.replace("index.html");};
onAuthStateChanged(auth,async user=>{if(!user){location.replace("index.html?next=messages.html");return;}state.user=user;const profile=await getDoc(doc(db,"users",user.uid));if(!profile.exists()||profile.data().banned){await signOut(auth);location.replace("index.html");return;}state.profile=profile.data();
  const read=await getDoc(doc(db,"messageReads",user.uid)).catch(()=>null);state.readAt=read?.data()?.lastReadAt?.toMillis?.()||0;
  unsubs.push(onSnapshot(collection(db,"users"),s=>{state.users=s.docs;renderRequestUsers();renderRequests();renderConversationList();}));
  unsubs.push(onSnapshot(query(collection(db,"messageRequests"),where("fromId","==",user.uid)),s=>{first=s.docs;mergeRequests();}));
  unsubs.push(onSnapshot(query(collection(db,"messageRequests"),where("toId","==",user.uid)),s=>{second=s.docs;mergeRequests();}));
  unsubs.push(onSnapshot(query(collection(db,"directMessages"),where("participants","array-contains",user.uid),orderBy("createdAt","asc")),s=>{state.messages=s.docs;renderConversationList();renderCount();markRead();}));
});