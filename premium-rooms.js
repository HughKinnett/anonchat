import { auth, db } from "./firebase-config.js";
import { hasPremiumAccess, PREMIUM_COLORS } from "./premium-policy.mjs";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc, where, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const $=id=>document.getElementById(id), status=$("premium-room-status");
let user=null, profile=null, rooms=new Map(), members=[], users=new Map(), entitled=new Set(), activeRoom=null, roomUnsubs=[];
const roomColorSelect=document.createElement("select");roomColorSelect.id="premium-room-color";roomColorSelect.setAttribute("aria-label","Room color");roomColorSelect.replaceChildren(...Object.entries(PREMIUM_COLORS).map(([value,color])=>new Option(color.label,value)));roomColorSelect.value="purple";$('premium-room-topic').after(roomColorSelect);
const stopRoom=()=>{while(roomUnsubs.length)roomUnsubs.pop()();};
const setStatus=(text,error=false)=>{status.textContent=text;status.style.color=error?"#fca5a5":"";};
const displayName=uid=>`@${users.get(uid)?.username||"anonymous"}`;
const currentRole=()=>members.find(item=>item.uid===user?.uid)?.role;
const canManage=()=>["owner","moderator"].includes(currentRole());
const setModerator=async(member,enabled)=>{try{const roomRef=doc(db,"premiumRooms",activeRoom),snap=await getDoc(roomRef),ids=snap.data().moderatorIds||[];if(enabled&&ids.length>=2)throw new Error("Two moderators are already assigned.");const next=enabled?[...new Set([...ids,member.uid])]:ids.filter(uid=>uid!==member.uid);await updateDoc(roomRef,{moderatorIds:next,updatedAt:serverTimestamp()});await updateDoc(doc(db,"premiumRoomMembers",`${activeRoom}_${member.uid}`),{role:enabled?"moderator":"member"});setStatus(`${displayName(member.uid)} is ${enabled?"now a moderator":"now a member"}.`);}catch(error){setStatus(error.message||"Could not change that role.",true);}};

const renderRoomList=()=>{
  const wrap=$("premium-room-list"); wrap.replaceChildren();
  [...rooms.values()].sort((a,b)=>(b.createdAt?.toMillis?.()||0)-(a.createdAt?.toMillis?.()||0)).forEach(room=>{
    const button=document.createElement("button");button.type="button";button.className="premium-room-item";button.textContent=`${room.name} · ${room.role}`;button.onclick=()=>openRoom(room.id);wrap.append(button);
  });
  if(!rooms.size)wrap.textContent="No invite-only rooms yet.";
};
const renderMembers=()=>{
  const wrap=$("premium-members");wrap.replaceChildren();
  members.forEach(member=>{const chip=document.createElement("span");chip.className="premium-member";chip.textContent=`${displayName(member.uid)} · ${member.role}`;
    if(currentRole()==="owner"&&["member","moderator"].includes(member.role)&&member.uid!==user.uid){const role=document.createElement("button");role.type="button";role.textContent=member.role==="moderator"?"Remove moderator":"Make moderator";role.onclick=()=>setModerator(member,member.role!=="moderator");chip.append(" ",role);}if(canManage()&&member.role==="member"&&member.uid!==user.uid){const kick=document.createElement("button");kick.type="button";kick.textContent="Kick";kick.onclick=()=>deleteDoc(doc(db,"premiumRoomMembers",`${activeRoom}_${member.uid}`)).catch(()=>setStatus("Could not remove that member.",true));chip.append(" ",kick);}wrap.append(chip);});
  const role=currentRole();$("premium-room-controls").hidden=!["owner","moderator"].includes(role);$("premium-invite-moderator").closest("label").hidden=role!=="owner";$("premium-delete-room").hidden=role!=="owner";
};
const openRoom=async roomId=>{
  stopRoom();activeRoom=roomId;members=[];$("premium-messages").replaceChildren();
  const roomSnap=await getDoc(doc(db,"premiumRooms",roomId));if(!roomSnap.exists()){setStatus("That room is no longer available.",true);return;}
  const room=roomSnap.data(),roomColor=PREMIUM_COLORS[room.roomColor]||PREMIUM_COLORS.purple,panel=$("premium-room-panel");panel.style.setProperty("--premium-room-bg",roomColor.background);panel.style.setProperty("--premium-room-text",roomColor.text);panel.classList.add("room-color-active");$("active-premium-room").textContent=room.name;$("active-premium-topic").textContent=room.topic||"Private Premium room";$("premium-message-form").hidden=false;
  roomUnsubs.push(onSnapshot(query(collection(db,"premiumRoomMembers"),where("roomId","==",roomId)),snap=>{members=snap.docs.map(d=>({id:d.id,...d.data()}));renderMembers();}));
  roomUnsubs.push(onSnapshot(query(collection(db,"premiumRooms",roomId,"messages"),orderBy("createdAt","desc"),limit(100)),snap=>{
    const list=$("premium-messages");list.replaceChildren();[...snap.docs].reverse().forEach(entry=>{const data=entry.data(),item=document.createElement("article");item.className="premium-message";const head=document.createElement("header"),name=document.createElement("strong");name.textContent=`@${data.username}`;head.append(name);if(data.senderId===user.uid||canManage()){const del=document.createElement("button");del.type="button";del.textContent="Delete";del.onclick=()=>deleteDoc(entry.ref).catch(()=>setStatus("Could not delete that message.",true));head.append(del);}const body=document.createElement("div");body.textContent=data.text;item.append(head,body);list.append(item);});list.scrollTop=list.scrollHeight;
  }));
  setStatus("Invite-only room opened.");
};

$("create-premium-room").onsubmit=async event=>{event.preventDefault();const name=$("premium-room-name").value.trim(),topic=$("premium-room-topic").value.trim(),roomColor=roomColorSelect.value;if(!name)return;const roomRef=doc(collection(db,"premiumRooms")),batch=writeBatch(db),now=serverTimestamp();batch.set(roomRef,{name,topic,roomColor,ownerId:user.uid,moderatorIds:[],createdAt:now,updatedAt:now,moderationState:"visible"});batch.set(doc(db,"premiumRoomMembers",`${roomRef.id}_${user.uid}`),{roomId:roomRef.id,uid:user.uid,role:"owner",invitedBy:user.uid,joinedAt:now});try{await batch.commit();event.target.reset();roomColorSelect.value="purple";setStatus("Premium room created.");}catch{setStatus("Could not create that room.",true);}};
$("premium-message-form").onsubmit=async event=>{event.preventDefault();const text=$("premium-message").value.trim();if(!text||!activeRoom)return;try{await addDoc(collection(db,"premiumRooms",activeRoom,"messages"),{senderId:user.uid,username:profile.username,text,createdAt:serverTimestamp()});event.target.reset();}catch{setStatus("Could not send that message.",true);}};
$("premium-invite").onclick=async()=>{const uid=$("premium-invite-user").value,moderator=$("premium-invite-moderator").checked;if(!uid||!activeRoom)return;try{if(moderator){const roomRef=doc(db,"premiumRooms",activeRoom),snap=await getDoc(roomRef),ids=snap.data().moderatorIds||[];if(ids.length>=2)throw new Error("Two moderators are already assigned.");await updateDoc(roomRef,{moderatorIds:[...new Set([...ids,uid])],updatedAt:serverTimestamp()});}await setDoc(doc(db,"premiumRoomMembers",`${activeRoom}_${uid}`),{roomId:activeRoom,uid,role:moderator?"moderator":"member",invitedBy:user.uid,joinedAt:serverTimestamp()});setStatus(`${displayName(uid)} was invited.`);}catch(error){setStatus(error.message||"Could not invite that member.",true);}};
$("premium-delete-room").onclick=async()=>{if(!activeRoom||currentRole()!=="owner"||!confirm("Delete this invite-only room?"))return;try{await deleteDoc(doc(db,"premiumRooms",activeRoom));stopRoom();rooms.delete(activeRoom);activeRoom=null;renderRoomList();$("active-premium-room").textContent="Room deleted";$("premium-message-form").hidden=true;setStatus("Room deleted.");}catch{setStatus("Could not delete that room.",true);}};

onAuthStateChanged(auth,async current=>{if(!current){location.replace("index.html");return;}const [accessSnap,profileSnap,userSnaps,accessSnaps]=await Promise.all([getDoc(doc(db,"premiumAccess",current.uid)),getDoc(doc(db,"users",current.uid)),getDocs(query(collection(db,"users"),limit(500))),getDocs(collection(db,"premiumAccess"))]);if(!accessSnap.exists()||!hasPremiumAccess(accessSnap.data())){location.replace("premium.html");return;}user=current;profile=profileSnap.data();users=new Map(userSnaps.docs.map(d=>[d.id,d.data()]));entitled=new Set(accessSnaps.docs.filter(d=>hasPremiumAccess(d.data())).map(d=>d.id));const select=$("premium-invite-user");select.replaceChildren(new Option("Choose Premium member",""),...[...entitled].filter(uid=>uid!==user.uid).map(uid=>new Option(displayName(uid),uid)));onSnapshot(query(collection(db,"premiumRoomMembers"),where("uid","==",user.uid)),async snap=>{const next=new Map();await Promise.all(snap.docs.map(async member=>{const room=await getDoc(doc(db,"premiumRooms",member.data().roomId));if(room.exists())next.set(room.id,{id:room.id,...room.data(),role:member.data().role});}));rooms=next;renderRoomList();setStatus("Your Premium rooms are ready.");});});
addEventListener("pagehide",stopRoom);
