import { roomState } from "./moderation-policy.mjs";

const timestampMillis = (value) => value?.toMillis?.();
export const MAX_TIMER_DELAY_MS = 2_147_483_647;

export const createRoomReportSubmissionGate = () => {
  let activeToken = null;
  let sequence = 0;
  return Object.freeze({
    tryStart(request) {
      if (activeToken) return null;
      activeToken = Object.freeze({ sequence: ++sequence, request });
      return activeToken;
    },
    finish(token) {
      if (token !== activeToken) return false;
      activeToken = null;
      return true;
    },
    isBusy: () => activeToken !== null
  });
};

export const createAuthoritativeRoomReportTracker = () => {
  const held = new Set();
  const pending = new Set();
  let authoritativeActiveRoomIds = null;
  const releaseObservedHolds = () => {
    if (!authoritativeActiveRoomIds) return;
    for (const roomId of held) {
      if (!pending.has(roomId) && !authoritativeActiveRoomIds.has(roomId)) held.delete(roomId);
    }
  };
  return Object.freeze({
    start(roomId) {
      held.add(roomId);
      pending.add(roomId);
    },
    commit(roomId) {
      pending.delete(roomId);
      releaseObservedHolds();
    },
    fail(roomId) {
      pending.delete(roomId);
      held.delete(roomId);
    },
    reconcile(activeRoomIds) {
      authoritativeActiveRoomIds = new Set(activeRoomIds);
      releaseObservedHolds();
    },
    isHeld: (roomId) => held.has(roomId),
    clear() {
      held.clear();
      pending.clear();
      authoritativeActiveRoomIds = null;
    }
  });
};

export const createRoomExpiryController = ({
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  onExpire
}) => {
  let timer = null;
  let target = null;
  const cancel = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
    target = null;
  };
  const arm = () => {
    if (!Number.isFinite(target)) return;
    const remaining = target - now();
    if (remaining <= 0) {
      timer = null;
      target = null;
      onExpire();
      return;
    }
    timer = setTimer(arm, Math.min(remaining, MAX_TIMER_DELAY_MS));
  };
  return Object.freeze({
    schedule(expirationMillis) {
      cancel();
      const current = now();
      target = expirationMillis
        .filter((value) => Number.isFinite(value) && value > current)
        .sort((left, right) => left - right)[0] ?? null;
      arm();
    },
    cancel
  });
};

export const createRoomMessageListenerRegistry = ({
  subscribe,
  onMessages,
  onError = () => {},
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout
}) => {
  const listeners = new Map();
  const messagesByRoom = new Map();
  let latest = null;
  const emit = () => onMessages([...messagesByRoom.values()].flat());
  const remove = (roomId) => {
    const unsubscribe = listeners.get(roomId);
    if (unsubscribe) unsubscribe();
    listeners.delete(roomId);
    messagesByRoom.delete(roomId);
  };
  const expiry = createRoomExpiryController({
    now,
    setTimer,
    clearTimer,
    onExpire: () => { if (latest) sync(latest); }
  });
  const sync = ({ rooms, memberships, currentUid }) => {
    latest = { rooms, memberships, currentUid };
    const current = now();
    const activeRooms = new Map(rooms
      .filter((room) => room.data().moderationStatus === "active"
        && roomState(room.data(), current) === "active")
      .map((room) => [room.id, room]));
    const joinedActiveRoomIds = new Set(memberships
      .filter((membership) => !currentUid || membership.data().uid === currentUid)
      .map((membership) => membership.data().roomId)
      .filter((roomId) => activeRooms.has(roomId)));

    for (const roomId of listeners.keys()) {
      if (!joinedActiveRoomIds.has(roomId)) remove(roomId);
    }
    for (const roomId of joinedActiveRoomIds) {
      if (listeners.has(roomId)) continue;
      const unsubscribe = subscribe(
        roomId,
        (messages) => {
          messagesByRoom.set(roomId, messages);
          emit();
        },
        () => {
          remove(roomId);
          emit();
          onError(roomId);
        }
      );
      listeners.set(roomId, unsubscribe);
    }
    expiry.schedule([...joinedActiveRoomIds]
      .map((roomId) => timestampMillis(activeRooms.get(roomId)?.data().expiresAt)));
    emit();
  };
  const stop = () => {
    expiry.cancel();
    for (const roomId of [...listeners.keys()]) remove(roomId);
    latest = null;
    emit();
  };
  return Object.freeze({ sync, stop });
};

export const openRoomAfterMembershipWrite = async ({
  getRoom,
  canOpen,
  writeMembership,
  onOpen,
  onUnavailable = () => {}
}) => {
  await writeMembership();
  const room = await getRoom();
  if (!room || !canOpen(room)) {
    onUnavailable();
    return false;
  }
  onOpen(room);
  return true;
};

export const roomViewState = ({
  room,
  currentUid,
  now = Date.now(),
  locallyReported = false,
  isAdmin = false
}) => {
  const state = !room
    ? "unavailable"
    : locallyReported
      ? "reported"
      : roomState(room, now);
  const active = state === "active";
  const reported = state === "reported";
  return {
    state,
    visible: active || (reported && isAdmin),
    canInteract: active,
    canReport: active
      && typeof currentUid === "string"
      && currentUid.length > 0
      && typeof room?.ownerId === "string"
      && room.ownerId !== currentUid,
    retainEvidence: reported,
    expirationPaused: reported
  };
};

export const roomMessageView = ({
  room,
  message,
  now = Date.now(),
  isAdmin = false,
  formatDate = (milliseconds) => new Date(milliseconds).toLocaleString()
}) => {
  const roomView = roomViewState({ room, currentUid: "", now, isAdmin });
  if (roomView.retainEvidence) {
    return {
      visible: roomView.visible,
      retainedForReview: true,
      expirationMillis: null,
      expirationText: "Expiration paused for admin review"
    };
  }
  const restoredRoomExpiry = Number.isFinite(timestampMillis(room?.resumedAt))
    ? timestampMillis(room?.expiresAt)
    : undefined;
  const expiresAt = Number.isFinite(restoredRoomExpiry)
    ? restoredRoomExpiry
    : timestampMillis(message?.expiresAt);
  return {
    visible: roomView.canInteract && Number.isFinite(expiresAt) && expiresAt > now,
    retainedForReview: false,
    expirationMillis: Number.isFinite(expiresAt) ? expiresAt : null,
    expirationText: Number.isFinite(expiresAt) ? `Disappears ${formatDate(expiresAt)}` : ""
  };
};
