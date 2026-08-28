import { auth, db } from "./firebase-config.js";
import { recordPageActivity } from "./activity-integration.mjs";
import { adminDeletionQueuePayloads, canAdminSetBanned, canQueueAdminDeletion, hasAdminDeletionQueueState, isProtectedAdministrator, normalizeUsername } from "./admin-deletion-policy.mjs";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { collection, collectionGroup, deleteDoc, doc, getDoc, onSnapshot, orderBy, query, serverTimestamp, updateDoc, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const $=id=>document.getElementById(id);
const state={users:[],posts:[],communityPosts:[],comments:[],reactions:[],follows:[],views:[],circles:[],members:[],rooms:[],roomMessages:[],votes:[]};
const unsubs=[]; let userFilter="all";
let adminUid="";
const setStatus=(message,error=false)=>{$("admin-status").textContent=message;$("admin-status").style.color=error?"#fca5a5":"inherit";};
const millis=v=>v?.toMillis?.()||0;
const formatDate=v=>v?.toDate?v.toDate().toLocaleString():"Unknown date";
const withinWindow=v=>{const days=Number($("metric-window").value);return !days||millis(v)>=Date.now()-days*86400000;};
const pct=(part,total)=>total?Math.round(part/total*100):0;
const postIdFor=entry=>entry.ref?.parent?.parent?.id;
const usernameFor=uid=>state.users.find(u=>u.id===uid)?.data().username||"unknown";

const setText=(id,value)=>{$(id).textContent=value;};
const activityByUser=()=>{
  const map=new Map(); const add=(uid,points=1)=>{if(uid)map.set(uid,(map.get(uid)||0)+points);};
  state.posts.forEach(x=>add(x.data().authorId,3));state.communityPosts.forEach(x=>add(x.data().authorId,3));
  state.comments.forEach(x=>add(x.data().uid,2));state.reactions.forEach(x=>add(x.data().uid));state.follows.forEach(x=>add(x.data().followerId));
  state.roomMessages.forEach(x=>add(x.data().senderId));return map;
};

const renderMetrics=()=>{
  const users=state.users, active=users.filter(x=>!x.data().banned), banned=users.length-active.length;
  const newUsers=users.filter(x=>withinWindow(x.data().createdAt)).length;
  const newPosts=[...state.posts,...state.communityPosts].filter(x=>withinWindow(x.data().createdAt)).length;
  const windowViews=state.views.filter(x=>{const d=new Date(x.id+"T23:59:59");const days=Number($("metric-window").value);return !days||d>=new Date(Date.now()-days*86400000);}).reduce((n,x)=>n+(x.data().views||0),0);
  const totalPublicPosts=state.posts.length+state.communityPosts.length;
  const engaged=activityByUser().size;
  const expiring=state.communityPosts.filter(x=>millis(x.data().expiresAt)>Date.now()).length;
  const values={
    "metric-users":users.length,"metric-active-users":active.length,"metric-banned":banned,
    "metric-views":state.views.reduce((n,x)=>n+(x.data().views||0),0),"metric-posts":state.posts.length,
    "metric-community-posts":state.communityPosts.length,"metric-comments":state.comments.length,
    "metric-reactions":state.reactions.length,"metric-follows":state.follows.length,"metric-circles":state.circles.length,
    "metric-rooms":state.rooms.length,"metric-poll-votes":state.votes.length
  };Object.entries(values).forEach(([id,v])=>setText(id,v));
  setText("metric-new-users",newUsers+" new in window");setText("metric-engaged-users",engaged+" engaged");
  setText("metric-ban-rate",pct(banned,users.length)+"% of profiles");setText("metric-window-views",windowViews+" in window");
  setText("metric-new-posts",newPosts+" in window");setText("metric-expiring",expiring+" currently expiring");
  setText("metric-comments-per-post",(state.comments.length/Math.max(1,state.posts.length)).toFixed(1)+" per timeline post");
  setText("metric-reactions-per-post",(state.reactions.length/Math.max(1,state.posts.length)).toFixed(1)+" per timeline post");
  setText("metric-follow-rate",(state.follows.length/Math.max(1,users.length)).toFixed(1)+" per profile");
  setText("metric-memberships",state.members.length+" memberships");setText("metric-room-messages",state.roomMessages.length+" room messages");
  setText("metric-engagement-rate",pct(engaged,active.length)+"% participation");
  setText("account-count",users.length);const capacity=pct(users.length,500);$("capacity-bar").style.width=capacity+"%";setText("capacity-label",capacity+"% capacity");
  setText("last-updated","Live data updated "+new Date().toLocaleTimeString());
  renderGrowth();renderBreakdowns();renderHealth();renderTopLists();renderPulse();
};

const renderGrowth=()=>{
  const days=[...Array(14)].map((_,i)=>{const d=new Date(Date.now()-(13-i)*86400000);return d.toISOString().slice(0,10);});
  const values=days.map(day=>({day,views:state.views.find(x=>x.id===day)?.data().views||0,users:state.users.filter(x=>x.data().createdAt?.toDate?.().toISOString().slice(0,10)===day).length}));
  const max=Math.max(1,...values.map(x=>Math.max(x.views,x.users)));
  $("growth-chart").replaceChildren(...values.map(x=>{const col=document.createElement("div");col.className="chart-day";col.title=`${x.day}: ${x.views} views, ${x.users} new profiles`;
    const bars=document.createElement("div");bars.className="chart-bars";const v=document.createElement("i"),u=document.createElement("i");v.className="views";u.className="users";v.style.height=Math.max(3,x.views/max*100)+"%";u.style.height=Math.max(3,x.users/max*100)+"%";bars.append(v,u);
    const label=document.createElement("small");label.textContent=x.day.slice(5);col.append(bars,label);return col;}));
};

const barRows=(host,items,total)=>{host.replaceChildren(...items.map(([label,count])=>{const row=document.createElement("div");row.className="breakdown-row";const head=document.createElement("div"),name=document.createElement("span"),value=document.createElement("strong");name.textContent=label;value.textContent=count+" · "+pct(count,total)+"%";head.append(name,value);const track=document.createElement("div"),bar=document.createElement("i");track.className="breakdown-track";bar.style.width=pct(count,total)+"%";track.append(bar);row.append(head,track);return row;}));};
const renderBreakdowns=()=>{
  const categories=["Question","Confession","Advice","Rant","Good News","Poll"].map(k=>[k,state.communityPosts.filter(x=>x.data().category===k).length]);
  barRows($("category-breakdown"),categories,state.communityPosts.length);
  const reactionMap={heart:"❤️ Heart",middle_finger:"🖕 Middle finger",laugh:"😂 Laugh",sad:"😢 Sad"};
  barRows($("reaction-breakdown"),Object.entries(reactionMap).map(([k,label])=>[label,state.reactions.filter(x=>x.data().type===k).length]),state.reactions.length);
};

const healthRow=(label,value,tone="good")=>{const row=document.createElement("div");row.className="health-row "+tone;const a=document.createElement("span"),b=document.createElement("strong");a.textContent=label;b.textContent=value;row.append(a,b);return row;};
const renderHealth=()=>{
  const names=state.users.map(x=>(x.data().username||"").toLowerCase()).filter(Boolean),duplicates=names.filter((x,i)=>names.indexOf(x)!==i).length;
  const missingUser=state.users.filter(x=>!x.data().username||!x.data().createdAt).length;
  const userIds=new Set(state.users.map(x=>x.id));const orphaned=[...state.posts,...state.communityPosts].filter(x=>!userIds.has(x.data().authorId)).length;
  const expired=state.communityPosts.filter(x=>millis(x.data().expiresAt)&&millis(x.data().expiresAt)<=Date.now()).length;
  const emptyCircles=state.circles.filter(c=>!state.members.some(m=>m.data().circleId===c.id)).length;
  $("data-health").replaceChildren(
    healthRow("Incomplete legacy profiles",missingUser,missingUser?"warn":"good"),
    healthRow("Duplicate usernames",duplicates,duplicates?"bad":"good"),
    healthRow("Orphaned posts",orphaned,orphaned?"bad":"good"),
    healthRow("Expired posts stored",expired,expired?"warn":"good"),
    healthRow("Empty circles",emptyCircles,emptyCircles?"warn":"good")
  );
};

const renderTopLists=()=>{
  const activity=activityByUser();const top=[...activity.entries()].sort((a,b)=>b[1]-a[1]).slice(0,8);
  $("top-users").replaceChildren(...top.map(([uid,score],i)=>rankRow(i+1,"@"+usernameFor(uid),score+" activity points",`profile.html?uid=${encodeURIComponent(uid)}`)));
  const all=state.posts.map(x=>({entry:x,type:"timeline"}));const scores=all.map(x=>{const id=x.entry.id;return {...x,score:state.comments.filter(c=>postIdFor(c)===id).length+state.reactions.filter(r=>postIdFor(r)===id).length};}).sort((a,b)=>b.score-a.score).slice(0,8);
  $("top-posts").replaceChildren(...scores.map((x,i)=>rankRow(i+1,"@"+(x.entry.data().username||"unknown"),x.score+" interactions · "+String(x.entry.data().content||"Photo").slice(0,55),"timeline.html#post-"+x.entry.id)));
};
const rankRow=(rank,label,detail,href)=>{const row=document.createElement(href?"a":"div");row.className="rank-row";if(href)row.href=href;const n=document.createElement("b"),text=document.createElement("span"),title=document.createElement("strong"),small=document.createElement("small");n.textContent=rank;title.textContent=label;small.textContent=detail;text.append(title,small);row.append(n,text);return row;};

const renderPulse=()=>{
  const originals=state.posts.filter(x=>x.data().type!=="repost").length,reposts=state.posts.length-originals,photos=state.posts.filter(x=>x.data().imageData).length;
  const activeRooms=new Set(state.roomMessages.filter(x=>millis(x.data().expiresAt)>Date.now()).map(x=>x.data().roomId)).size;
  const circleUse=pct(new Set(state.communityPosts.filter(x=>x.data().circleId).map(x=>x.data().circleId)).size,state.circles.length);
  $("community-pulse").replaceChildren(
    healthRow("Original posts",originals),healthRow("Reposts",reposts),healthRow("Photo posts",photos),
    healthRow("Rooms active in 24h",activeRooms),healthRow("Circles used for posts",circleUse+"%"),healthRow("Average circle size",(state.members.length/Math.max(1,state.circles.length)).toFixed(1))
  );
};

const renderUsers=()=>{
  const term=$("admin-user-search").value.trim().toLowerCase(),activity=activityByUser();
  const filtered=state.users.filter(entry=>{const d=entry.data(),legacy=!d.username||!d.createdAt;
    const matchesFilter=userFilter==="all"||(userFilter==="active"&&!d.banned)||(userFilter==="banned"&&d.banned)||(userFilter==="legacy"&&legacy);
    return matchesFilter&&(!term||d.username?.toLowerCase().includes(term)||entry.id.toLowerCase().includes(term));});
  $("admin-users").replaceChildren(...filtered.map(entry=>{const d=entry.data(),row=document.createElement("article");row.className="admin-row";
    const info=document.createElement("div"),name=document.createElement("strong"),meta=document.createElement("small"),stats=document.createElement("small");
    name.textContent=`@${d.username||"unknown"}${d.banned?" — BANNED":""}`;meta.textContent=`UID: ${entry.id} · Created: ${formatDate(d.createdAt)}`;
    const followers=state.follows.filter(x=>x.data().followingId===entry.id).length,userPosts=[...state.posts,...state.communityPosts].filter(x=>x.data().authorId===entry.id).length;
    stats.textContent=`${userPosts} posts · ${followers} followers · ${activity.get(entry.id)||0} activity points`;info.append(name,meta,stats);
    const actions=document.createElement("div");actions.className="admin-actions";const profile=document.createElement("a");profile.className="admin-action nav-button";profile.href=`profile.html?uid=${encodeURIComponent(entry.id)}`;profile.textContent="View";
    const ban=document.createElement("button");ban.type="button";ban.className=`admin-action ${d.banned?"restore":"danger"}`;const protectedAdmin=isProtectedAdministrator(d.username),existingQueueState=hasAdminDeletionQueueState(d);ban.textContent=protectedAdmin?"Protected admin":d.banned?"Unban":"Ban";ban.disabled=protectedAdmin||!canAdminSetBanned({nextBanned:!d.banned,existingJob:false,existingQueueState});
    ban.onclick=async()=>{ban.disabled=true;try{await updateDoc(doc(db,"users",entry.id),{banned:!d.banned});setStatus(d.banned?"User unbanned.":"User banned.");}catch{setStatus("Could not update that user.",true);ban.disabled=false;}};
    const queueDeletion=document.createElement("button");queueDeletion.type="button";queueDeletion.className="admin-action danger";queueDeletion.textContent="Queue deletion";queueDeletion.disabled=protectedAdmin||existingQueueState;
    queueDeletion.onclick=async()=>{queueDeletion.disabled=true;try{const job=await getDoc(doc(db,"adminDeletionJobs",entry.id));if(!canQueueAdminDeletion({targetUid:entry.id,username:d.username,existingJob:job.exists(),existingQueueState})){setStatus("That account cannot be queued for deletion.",true);return;}if(!confirm("Queue this account for deletion? The account will be locked immediately."))return;const timestamp=serverTimestamp(),payloads=adminDeletionQueuePayloads({targetUid:entry.id,requesterUid:adminUid,timestamp}),batch=writeBatch(db);batch.update(doc(db,"users",entry.id),payloads.profile);batch.set(doc(db,"adminDeletionJobs",entry.id),payloads.job);await batch.commit();setStatus("Account locked and queued for deletion.");}catch{setStatus("Could not queue that account for deletion.",true);}finally{queueDeletion.disabled=protectedAdmin||existingQueueState;}};
    actions.append(profile,ban,queueDeletion);row.append(info,actions);return row;}));
};
document.querySelectorAll("[data-user-filter]").forEach(b=>b.onclick=()=>{userFilter=b.dataset.userFilter;document.querySelectorAll("[data-user-filter]").forEach(x=>x.setAttribute("aria-pressed",String(x===b)));renderUsers();});

const renderContent=()=>{
  const term=$("admin-content-search").value.trim().toLowerCase(),type=$("admin-content-type").value;
  const combined=[...state.posts.map(entry=>({entry,type:"timeline"})),...state.communityPosts.map(entry=>({entry,type:"community"}))]
    .filter(x=>(type==="all"||x.type===type)&&(!term||x.entry.data().username?.toLowerCase().includes(term)||x.entry.data().content?.toLowerCase().includes(term)))
    .sort((a,b)=>millis(b.entry.data().createdAt)-millis(a.entry.data().createdAt)).slice(0,200);
  $("admin-posts").replaceChildren(...combined.map(({entry,type})=>{const d=entry.data(),row=document.createElement("article");row.className="admin-row";
    const info=document.createElement("div"),title=document.createElement("strong"),excerpt=document.createElement("small"),meta=document.createElement("small");
    title.textContent=`@${d.username||"unknown"} · ${type==="community"?(d.category||"Community"):"Timeline"}`;excerpt.textContent=String(d.content||"[Photo post]").slice(0,240);meta.textContent=`${formatDate(d.createdAt)} · ID: ${entry.id}`;info.append(title,excerpt,meta);
    const actions=document.createElement("div");actions.className="admin-actions";const open=document.createElement("a");open.className="admin-action nav-button";open.href=type==="community"?"community.html":`timeline.html#post-${entry.id}`;open.textContent="Open";
    const remove=document.createElement("button");remove.className="admin-action danger";remove.textContent="Delete";remove.onclick=async()=>{if(!confirm("Delete this content? This cannot be undone."))return;remove.disabled=true;try{await deleteDoc(doc(db,type==="community"?"communityPosts":"posts",entry.id));setStatus("Content deleted.");}catch{setStatus("Could not delete that content.",true);remove.disabled=false;}};
    actions.append(open,remove);row.append(info,actions);return row;}));
};

const renderViews=()=>{$("admin-views").replaceChildren(...[...state.views].sort((a,b)=>b.id.localeCompare(a.id)).map(entry=>{const row=document.createElement("article");row.className="admin-row";const day=document.createElement("strong"),count=document.createElement("span");day.textContent=entry.id;count.textContent=(entry.data().views||0)+" views";row.append(day,count);return row;}));};

const renderAll=()=>{renderMetrics();renderUsers();renderContent();renderViews();};
$("metric-window").onchange=renderMetrics;$("admin-user-search").oninput=renderUsers;$("admin-content-search").oninput=renderContent;$("admin-content-type").onchange=renderContent;
$("refresh-admin").onclick=()=>{renderAll();setStatus("Dashboard recalculated from live data.");};
$("admin-sign-out").onclick=async()=>{await signOut(auth);location.replace("index.html");};
$("download-admin-data").onclick=()=>{const summary={generatedAt:new Date().toISOString(),profiles:state.users.length,banned:state.users.filter(x=>x.data().banned).length,timelinePosts:state.posts.length,communityPosts:state.communityPosts.length,comments:state.comments.length,reactions:state.reactions.length,follows:state.follows.length,circles:state.circles.length,rooms:state.rooms.length,pollVotes:state.votes.length,pageViews:state.views.map(x=>({date:x.id,views:x.data().views||0}))};const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([JSON.stringify(summary,null,2)],{type:"application/json"}));a.download="anonchat-admin-summary.json";a.click();setTimeout(()=>URL.revokeObjectURL(a.href),5000);};

const listen=(ref,key)=>unsubs.push(onSnapshot(ref,s=>{state[key]=s.docs;renderAll();},()=>setStatus("Could not load "+key+".",true)));
onAuthStateChanged(auth,async user=>{if(!user){location.replace("index.html");return;}const profile=await getDoc(doc(db,"users",user.uid));const profileData=profile.exists()?profile.data():null;const username=profileData?.username||"",reservation=isProtectedAdministrator(username)?await getDoc(doc(db,"usernames",normalizeUsername(username))):null;const isAuthorizedAdmin=!profileData?.banned&&reservation?.exists()&&reservation.data().uid===user.uid&&reservation.data().username===username;if(!isAuthorizedAdmin){location.replace("timeline.html");return;}adminUid=user.uid;
  void recordPageActivity({surface:"admin",profile:profileData,user,db,firestore:{doc,updateDoc,serverTimestamp},isAuthorizedAdmin});
  setText("admin-identity",`Signed in as @${username} · public activity analytics only`);
  listen(collection(db,"users"),"users");listen(query(collection(db,"posts"),orderBy("createdAt","desc")),"posts");listen(query(collection(db,"communityPosts"),orderBy("createdAt","desc")),"communityPosts");
  listen(collectionGroup(db,"comments"),"comments");listen(collectionGroup(db,"reactions"),"reactions");listen(collection(db,"follows"),"follows");listen(collection(db,"pageViews"),"views");
  listen(collection(db,"circles"),"circles");listen(collection(db,"circleMembers"),"members");listen(collection(db,"rooms"),"rooms");listen(collection(db,"roomMessages"),"roomMessages");listen(collection(db,"communityVotes"),"votes");
});
