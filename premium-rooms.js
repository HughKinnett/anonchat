import { auth, db } from "./firebase-config.js";
import { hasPremiumAccess, PREMIUM_SWATCHES } from "./premium-policy.mjs";
import { createModerationClient } from "./moderation-client.mjs";
import { REPORT_REASONS } from "./moderation-policy.mjs";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc, where, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const $ = id => document.getElementById(id), status = $("premium-room-status");
let user, profile, rooms = new Map(), members = [], users = new Map(), entitled = new Set(), activeRoom, roomUnsubs = [], moderationClient;
const stopRoom = () => { while (roomUnsubs.length) roomUnsubs.pop()(); };
const setStatus = (text, error = false) => { status.textContent = text; status.style.color = error ? "#fca5a5" : ""; };
const displayName = uid => `@${users.get(uid)?.username || "anonymous"}`;
const memberFor = uid => members.find(item => item.uid === uid);
const currentRole = () => memberFor(user?.uid)?.role;
const canManage = () => ["owner", "moderator"].includes(currentRole());

const actionSheet = document.createElement("dialog"); actionSheet.className = "premium-message-actions-sheet"; document.body.append(actionSheet);
const closeSheet = () => actionSheet.close();
const actionButton = (label, action, closeAfter = true) => { const button = document.createElement("button"); button.type = "button"; button.textContent = label; button.onclick = async () => { button.disabled = true; try { await action(); } catch (error) { setStatus(error.message || "That action could not be completed.", true); } finally { if (closeAfter && actionSheet.open) closeSheet(); else button.disabled = false; } }; return button; };
const setModerator = async (member, enabled) => {
  const roomRef = doc(db, "premiumRooms", activeRoom), snap = await getDoc(roomRef), ids = snap.data().moderatorIds || [];
  if (enabled && ids.length >= 2) throw new Error("This room already has two moderators.");
  const next = enabled ? [...new Set([...ids, member.uid])] : ids.filter(uid => uid !== member.uid);
  await updateDoc(roomRef, { moderatorIds: next, updatedAt: serverTimestamp() });
  await updateDoc(doc(db, "premiumRoomMembers", `${activeRoom}_${member.uid}`), { role: enabled ? "moderator" : "member" });
  setStatus(`${displayName(member.uid)} is ${enabled ? "now a moderator" : "no longer a moderator"}.`);
};
const showReportReasons = message => {
  actionSheet.replaceChildren(); const title = document.createElement("h3"); title.textContent = `Report ${displayName(message.senderId)}`; actionSheet.append(title);
  REPORT_REASONS.forEach(reason => actionSheet.append(actionButton(reason.replaceAll("-", " "), async () => { await moderationClient.report({ targetKind: "user", targetCollection: "users", targetId: message.senderId, reportedUserId: message.senderId }, reason); setStatus(`${displayName(message.senderId)} was reported for review.`); })));
  actionSheet.append(actionButton("Cancel", async () => {}));
};
const showMessageActions = (entry, message) => {
  const targetMember = memberFor(message.senderId); actionSheet.replaceChildren(); const title = document.createElement("h3"); title.textContent = displayName(message.senderId); actionSheet.append(title);
  if (message.senderId === user.uid || canManage()) actionSheet.append(actionButton("Delete message", async () => { await deleteDoc(entry.ref); setStatus("Message deleted."); }));
  if (message.senderId !== user.uid) actionSheet.append(actionButton("Report user", async () => { showReportReasons(message); }, false));
  if (currentRole() === "owner" && targetMember && targetMember.role !== "owner") actionSheet.append(actionButton(targetMember.role === "moderator" ? "Remove moderator" : "Make moderator", () => setModerator(targetMember, targetMember.role !== "moderator")));
  if (message.senderId !== user.uid && targetMember && ((currentRole() === "owner" && targetMember.role !== "owner") || (currentRole() === "moderator" && targetMember.role === "member"))) actionSheet.append(actionButton("Kick from room", async () => { await deleteDoc(doc(db, "premiumRoomMembers", `${activeRoom}_${message.senderId}`)); setStatus(`${displayName(message.senderId)} was removed from the room.`); }));
  actionSheet.append(actionButton("Cancel", async () => {})); actionSheet.showModal();
};
const attachHoldMenu = (element, entry, message) => {
  let timer; const cancel = () => clearTimeout(timer); element.addEventListener("pointerdown", event => { if (event.button !== 0) return; timer = setTimeout(() => showMessageActions(entry, message), 550); }); ["pointerup", "pointercancel", "pointerleave"].forEach(type => element.addEventListener(type, cancel)); element.addEventListener("contextmenu", event => { event.preventDefault(); cancel(); showMessageActions(entry, message); });
};
const renderRoomList = () => { const wrap = $("premium-room-list"); wrap.replaceChildren(); [...rooms.values()].sort((a,b)=>(b.createdAt?.toMillis?.()||0)-(a.createdAt?.toMillis?.()||0)).forEach(room => { const button = document.createElement("button"); button.type = "button"; button.className = "premium-room-item"; button.textContent = `${room.name} · ${room.role}`; button.onclick = () => openRoom(room.id); wrap.append(button); }); if (!rooms.size) wrap.textContent = "No invite-only rooms yet."; };
const renderMembers = () => { const wrap = $("premium-members"); wrap.replaceChildren(...members.map(member => { const chip = document.createElement("span"); chip.className = "premium-member"; chip.textContent = `${displayName(member.uid)} · ${member.role}`; return chip; })); const role = currentRole(); $("premium-room-controls").hidden = !["owner", "moderator"].includes(role); $("premium-delete-room").hidden = role !== "owner"; };
const openRoom = async roomId => { stopRoom(); activeRoom = roomId; members = []; $("premium-messages").replaceChildren(); const roomSnap = await getDoc(doc(db, "premiumRooms", roomId)); if (!roomSnap.exists()) return setStatus("That room is no longer available.", true); const room = roomSnap.data(), color = PREMIUM_SWATCHES[room.roomColor] || PREMIUM_SWATCHES.purple, panel = $("premium-room-panel"); panel.style.setProperty("--premium-room-bg", color.background); panel.style.setProperty("--premium-room-text", color.text); panel.classList.add("room-color-active"); $("active-premium-room").textContent = room.name; $("active-premium-topic").textContent = room.topic || "Private Premium room"; $("premium-message-form").hidden = false;
  roomUnsubs.push(onSnapshot(query(collection(db,"premiumRoomMembers"),where("roomId","==",roomId),limit(100)), snap => { members = snap.docs.map(entry => ({ id: entry.id, ...entry.data() })); renderMembers(); }));
  roomUnsubs.push(onSnapshot(query(collection(db,"premiumRooms",roomId,"messages"),orderBy("createdAt","desc"),limit(50)), snap => { const list = $("premium-messages"); list.replaceChildren(); [...snap.docs].reverse().forEach(entry => { const data = entry.data(), item = document.createElement("article"), head = document.createElement("header"), name = document.createElement("strong"), body = document.createElement("div"); item.className = "premium-message"; item.tabIndex = 0; name.textContent = `@${data.username}`; body.textContent = data.text; head.append(name); item.append(head, body); attachHoldMenu(item, entry, data); list.append(item); }); list.scrollTop = list.scrollHeight; })); setStatus("Room opened. Hold a message for actions."); };

$("create-premium-room").onsubmit = async event => { event.preventDefault(); const name = $("premium-room-name").value.trim(), topic = $("premium-room-topic").value.trim(); if (!name) return; const roomRef = doc(collection(db,"premiumRooms")), batch = writeBatch(db), now = serverTimestamp(); batch.set(roomRef,{name,topic,roomColor:"purple",ownerId:user.uid,moderatorIds:[],createdAt:now,updatedAt:now,moderationState:"visible"}); batch.set(doc(db,"premiumRoomMembers",`${roomRef.id}_${user.uid}`),{roomId:roomRef.id,uid:user.uid,role:"owner",invitedBy:user.uid,joinedAt:now}); try { await batch.commit(); event.target.reset(); setStatus("Premium room created."); } catch { setStatus("Could not create that room.",true); } };
$("premium-message-form").onsubmit = async event => {
  event.preventDefault();
  const input = $("premium-message"), button = event.target.querySelector("button[type='submit']");
  const text = input.value.trim();
  if (!user || !activeRoom) return setStatus("Open an invite-only room before sending.", true);
  if (!text) return setStatus("Write a message before sending.", true);
  button.disabled = true;
  try {
    const [memberSnap, profileSnap] = await Promise.all([
      getDoc(doc(db, "premiumRoomMembers", `${activeRoom}_${user.uid}`)),
      getDoc(doc(db, "users", user.uid))
    ]);
    if (!memberSnap.exists()) throw new Error("You are no longer a member of this room.");
    const username = profileSnap.data()?.username;
    if (!username) throw new Error("Your AnonChat profile could not be loaded.");
    const messageRef = doc(collection(db, "premiumRooms", activeRoom, "messages"));
    const notificationRef = doc(db, "premiumRoomNotifications", messageRef.id);
    const batch = writeBatch(db);
    batch.set(messageRef, { senderId: user.uid, username, text, createdAt: serverTimestamp() });
    batch.set(notificationRef, { roomId: activeRoom, senderId: user.uid, createdAt: serverTimestamp() });
    await batch.commit();
    input.value = "";
    setStatus("Message sent.");
  } catch (error) {
    setStatus(error?.message || "Could not send that message.", true);
  } finally {
    button.disabled = false;
  }
};
$("premium-invite").onclick = async () => { const uid = $("premium-invite-user").value; if(!uid||!activeRoom)return; try { await setDoc(doc(db,"premiumRoomMembers",`${activeRoom}_${uid}`),{roomId:activeRoom,uid,role:"member",invitedBy:user.uid,joinedAt:serverTimestamp()}); setStatus(`${displayName(uid)} was invited.`); } catch { setStatus("Could not invite that member.",true); } };
$("premium-delete-room").onclick = async () => { if(!activeRoom||currentRole()!=="owner"||!confirm("Delete this invite-only room?"))return; try { await deleteDoc(doc(db,"premiumRooms",activeRoom)); stopRoom(); rooms.delete(activeRoom); activeRoom=null; renderRoomList(); $("active-premium-room").textContent="Room deleted"; $("premium-message-form").hidden=true; setStatus("Room deleted."); } catch { setStatus("Could not delete that room.",true); } };
onAuthStateChanged(auth, async current => { if(!current)return location.replace("index.html"); const [accessSnap,profileSnap,userSnaps,accessSnaps]=await Promise.all([getDoc(doc(db,"premiumAccess",current.uid)),getDoc(doc(db,"users",current.uid)),getDocs(query(collection(db,"users"),limit(100))),getDocs(query(collection(db,"premiumAccess"),limit(100)))]); if(!accessSnap.exists()||!hasPremiumAccess(accessSnap.data()))return location.replace("premium.html"); user=current; profile=profileSnap.data(); users=new Map(userSnaps.docs.map(entry=>[entry.id,entry.data()])); entitled=new Set(accessSnaps.docs.filter(entry=>hasPremiumAccess(entry.data())).map(entry=>entry.id)); moderationClient=createModerationClient({db,firestore:{deleteDoc,doc,getDoc,setDoc,writeBatch},currentUid:user.uid,timestamp:serverTimestamp}); const select=$("premium-invite-user"); select.replaceChildren(new Option("Choose Premium member",""),...[...entitled].filter(uid=>uid!==user.uid).map(uid=>new Option(displayName(uid),uid))); onSnapshot(query(collection(db,"premiumRoomMembers"),where("uid","==",user.uid),limit(50)),async snap=>{const next=new Map();await Promise.all(snap.docs.map(async member=>{const room=await getDoc(doc(db,"premiumRooms",member.data().roomId));if(room.exists())next.set(room.id,{id:room.id,...room.data(),role:member.data().role});}));rooms=next;renderRoomList();setStatus("Your Premium rooms are ready.");}); });
addEventListener("pagehide",()=>{stopRoom();moderationClient?.destroy();});
