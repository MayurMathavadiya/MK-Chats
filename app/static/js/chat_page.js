// WebRTC Definitions
let peerConnection = null;
let localStream = null;
let remoteStream = null;
let currentCallLogId = null;
let currentCallMode = 'audio';
let pendingIncomingOffer = null;
let pendingUpgradeRequest = null;
let pendingIceCandidatesQueue = [];
let videoStageLayout = 'fullscreen';
let videoControlsAutoHideTimeoutId = null;

// --- Desktop Notifications (best-effort) ---
const mkChatsNotificationIcon = "/static/branding/mk-chats-logo.svg";
const sharedKeyCache = new Map(); // userId -> CryptoKey|null
const recentNotificationTags = new Map(); // tag -> timestamp

function initDesktopNotifications() {
    if (!('Notification' in window)) return;
    if (!window.isSecureContext && location.hostname !== 'localhost') {
        console.warn("Notifications require a secure context (HTTPS or localhost).");
        return;
    }

    // Many browsers require a user gesture to show the permission prompt.
    if (Notification.permission === 'default') {
        document.addEventListener('click', async () => {
            try {
                await Notification.requestPermission();
            } catch (e) {
                console.warn("Notification permission request failed", e);
            }
        }, { once: true, capture: true });
    }
}

function canShowDesktopNotification() {
    return ('Notification' in window) && Notification.permission === 'granted';
}

function shouldThrottleNotification(tag, minIntervalMs = 2500) {
    const now = Date.now();
    const lastAt = recentNotificationTags.get(tag) || 0;
    if (now - lastAt < minIntervalMs) return true;
    recentNotificationTags.set(tag, now);
    return false;
}

function showDesktopNotification({ title, body, tag, icon, onClick } = {}) {
    if (!canShowDesktopNotification()) return null;
    if (tag && shouldThrottleNotification(tag)) return null;

    try {
        const notif = new Notification(String(title || "MK Chats"), {
            body: body ? String(body) : undefined,
            tag: tag ? String(tag) : undefined,
            icon: icon || mkChatsNotificationIcon,
            badge: mkChatsNotificationIcon,
            renotify: false
        });
        if (typeof onClick === 'function') {
            notif.onclick = (evt) => {
                try {
                    // Try to focus window first (Firefox requirement)
                    window.focus();
                } catch (e) { }

                try { evt?.preventDefault?.(); } catch (e) { }

                // Allow a small tick for focus to propagate
                setTimeout(() => {
                    try { window.focus(); } catch (e) { }
                    try { onClick(); } catch (e) { console.error("onClick error:", e); }
                    try { notif.close(); } catch (e) { }
                }, 0);
            };
        }
        return notif;
    } catch (e) {
        console.warn("Desktop notification failed", e);
        return null;
    }
}

function getContactById(userId) {
    const numericUserId = Number(userId);
    if (window.activeContactData && Number(window.activeContactData.id) === numericUserId) {
        return {
            id: numericUserId,
            first_name: (window.activeContactData.name || '').split(' ')[0] || '',
            last_name: (window.activeContactData.name || '').split(' ').slice(1).join(' ') || '',
            public_key: window.activeContactData.pubKeyB64 || '',
            mobile_number: window.activeContactData.mobile || '',
            profile_pic: window.activeContactData.profilePic || '',
            blocked_by_me: Boolean(window.activeContactData.blockedByMe),
            blocked_me: Boolean(window.activeContactData.blockedMe)
        };
    }
    return cachedContacts.find((entry) => Number(entry.id) === numericUserId) || null;
}

async function getSharedKeyForUser(userId) {
    const numericUserId = Number(userId);
    if (Number(activeContactId) === numericUserId && activeSharedKey) {
        return activeSharedKey;
    }
    if (sharedKeyCache.has(numericUserId)) {
        return sharedKeyCache.get(numericUserId);
    }

    const contact = getContactById(numericUserId);
    const pubKeyB64 = contact?.public_key;
    if (!pubKeyB64 || pubKeyB64 === "null") {
        sharedKeyCache.set(numericUserId, null);
        return null;
    }

    try {
        const contactPubKey = await importContactPublicKey(pubKeyB64);
        const sharedKey = await deriveSharedSecret(contactPubKey);
        sharedKeyCache.set(numericUserId, sharedKey || null);
        return sharedKey || null;
    } catch (e) {
        console.warn("Shared key derivation failed", e);
        sharedKeyCache.set(numericUserId, null);
        return null;
    }
}

function focusAndOpenChat(userId) {
    console.log("Redirecting to chat for user:", userId);
    try { window.focus(); } catch (e) { }

    // Ensure we are not on a sub-page if needed (not applicable for this monolith)
    if (document.visibilityState !== 'visible') {
        // Some browsers need this hint
        try { window.focus(); } catch (e) { }
    }

    const contact = getContactById(userId);
    if (!contact) {
        console.warn("Contact not found for focus:", userId);
        // Fallback: If contact not in cache, trigger a reload then select
        loadContacts().then(() => {
            const reContact = getContactById(userId);
            if (reContact) {
                const name = `${reContact.first_name || ''} ${reContact.last_name || ''}`.trim() || `User ${Number(userId)}`;
                selectUser(Number(reContact.id), name, reContact.public_key, reContact.mobile_number, reContact.profile_pic, Boolean(reContact.blocked_by_me), Boolean(reContact.blocked_me)).catch(console.error);
            }
        });
        return;
    }

    const name = `${contact.first_name || ''} ${contact.last_name || ''}`.trim() || `User ${Number(userId)}`;
    selectUser(
        Number(contact.id),
        name,
        contact.public_key || '',
        contact.mobile_number || null,
        contact.profile_pic || null,
        Boolean(contact.blocked_by_me),
        Boolean(contact.blocked_me)
    ).catch(console.error);
}

function shouldNotifyForIncomingMessage(msg) {
    if (!msg) return false;
    if (Number(msg.receiver_id) !== Number(currentUserId)) return false;
    if (Number(msg.sender_id) === Number(currentUserId)) return false;

    const isForeground = document.visibilityState === 'visible' && document.hasFocus();
    const isActiveChat = Number(msg.sender_id) === Number(activeContactId);
    return !(isForeground && isActiveChat);
}

async function notifyIncomingMessage(msg) {
    if (!canShowDesktopNotification()) return;
    if (!shouldNotifyForIncomingMessage(msg)) return;

    const senderId = Number(msg.sender_id);
    const contact = resolveContactForCall(senderId);

    let preview = "New message";
    try {
        if (msg.content) {
            const sharedKey = await getSharedKeyForUser(senderId);
            const decrypted = await decryptText(msg.content, sharedKey);
            if (decrypted && !String(decrypted).startsWith('[')) {
                preview = decrypted;
            }
        } else if (msg.file_data) {
            preview = "Attachment";
        }
    } catch (e) {
        console.warn("Notification preview failed", e);
    }

    if (preview && preview.length > 120) preview = preview.slice(0, 117) + '...';
    const tag = `mkchats-message-${msg.id || `${senderId}-${msg.created_at || ''}`}`;

    showDesktopNotification({
        title: contact.name,
        body: preview,
        tag,
        icon: contact.profilePic || mkChatsNotificationIcon,
        onClick: () => focusAndOpenChat(senderId)
    });
}

function shouldNotifyForIncomingCall(senderId) {
    if (Number(senderId) === Number(currentUserId)) return false;
    return !(document.visibilityState === 'visible' && document.hasFocus());
}

function notifyIncomingCall({ senderId, callType = 'audio', callId = null } = {}) {
    if (!canShowDesktopNotification()) return;
    if (!shouldNotifyForIncomingCall(senderId)) return;

    const contact = resolveContactForCall(senderId);
    const normalizedType = callType === 'video' ? 'video' : 'audio';
    const tag = `mkchats-call-${callId || senderId}`;
    const title = "Incoming call";
    const body = `${contact.name} is calling (${normalizedType}).`;

    showDesktopNotification({
        title,
        body,
        tag,
        icon: contact.profilePic || mkChatsNotificationIcon,
        onClick: () => focusAndOpenChat(senderId)
    });
}

// Add audio element to DOM for remote stream
const audioEl = document.createElement("audio");
audioEl.autoplay = true;
document.body.appendChild(audioEl);
const remoteVideoEl = document.getElementById("remoteVideoEl");
const localVideoEl = document.getElementById("localVideoEl");
const remoteVideoPlaceholder = document.getElementById("remoteVideoPlaceholder");
const videoCallStageEl = document.getElementById("videoCallStage");
const videoStageMinimizeBtn = document.getElementById("videoStageMinimizeBtn");
const videoStageMaximizeBtn = document.getElementById("videoStageMaximizeBtn");
const activeCallOverlayEl = document.getElementById("activeCallOverlay");

const rtcConfig = {
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

async function initLocalStream(mode = 'audio') {
    const wantsVideo = mode === 'video';

    if (!localStream) {
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: wantsVideo });
        } catch (e) {
            console.error("Media access denied", e);
            alert(wantsVideo ? "Camera and microphone access are required for video calling." : "Microphone access is required for calling.");
            return false;
        }
    } else if (wantsVideo && localStream.getVideoTracks().length === 0) {
        try {
            const upgradedStream = await navigator.mediaDevices.getUserMedia({ video: true });
            upgradedStream.getVideoTracks().forEach((track) => {
                localStream.addTrack(track);
                if (peerConnection) {
                    const sender = peerConnection.getSenders().find((entry) => entry.track && entry.track.kind === 'video');
                    if (sender) {
                        sender.replaceTrack(track);
                    } else {
                        peerConnection.addTrack(track, localStream);
                    }
                }
            });
        } catch (e) {
            console.error("Camera access denied", e);
            alert("Camera access is required to switch to video.");
            return false;
        }
    }

    currentCallMode = wantsVideo || localStream.getVideoTracks().length > 0 ? 'video' : 'audio';
    syncLocalVideoPreview();
    syncRemoteVideoState();
    updateCallMediaBadge(currentCallMode);
    return true;
}

function cleanupWebRTC() {
    if (document.pictureInPictureElement) {
        try {
            document.exitPictureInPicture().catch(() => { });
        } catch (e) { }
    }
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
        localStream = null;
    }
    remoteStream = null;
    audioEl.srcObject = null;
    if (remoteVideoEl) remoteVideoEl.srcObject = null;
    if (localVideoEl) localVideoEl.srcObject = null;
    hideVideoStage();
    setMuteButtonState(false);
    clearCallTimer();
    clearCallRingTimeout();
    currentCallState = 'idle';
    currentCallPeerId = null;
    currentCallMode = 'audio';
    currentCallLogId = null;
    pendingIncomingOffer = null;
    pendingUpgradeRequest = null;
    pendingIceCandidatesQueue = [];
}

function canUsePiP() {
    return Boolean(
        remoteVideoEl &&
        document.pictureInPictureEnabled &&
        typeof remoteVideoEl.requestPictureInPicture === 'function'
    );
}

function setVideoStageLayout(layout = 'fullscreen') {
    const normalized = layout === 'compact' ? 'compact' : 'fullscreen';
    videoStageLayout = normalized;
    if (videoCallStageEl) {
        videoCallStageEl.dataset.layout = normalized;
    }

    if (videoStageMinimizeBtn) videoStageMinimizeBtn.classList.toggle('hidden', normalized === 'compact');
    if (videoStageMaximizeBtn) videoStageMaximizeBtn.classList.toggle('hidden', normalized !== 'compact');
    syncVideoControlsMode();
}

function resetVideoStageLayout() {
    setVideoStageLayout('fullscreen');
}

function isVideoFullscreenActive() {
    if (!videoCallStageEl || videoCallStageEl.classList.contains('hidden')) return false;
    if (document.pictureInPictureElement === remoteVideoEl) return false;
    if (videoCallStageEl.dataset.layout !== 'fullscreen') return false;
    const hasAnyVideo = Boolean(
        (remoteStream && remoteStream.getVideoTracks().length > 0) ||
        (localStream && localStream.getVideoTracks().length > 0)
    );
    return hasAnyVideo;
}

function clearVideoControlsAutoHide() {
    if (!videoControlsAutoHideTimeoutId) return;
    clearTimeout(videoControlsAutoHideTimeoutId);
    videoControlsAutoHideTimeoutId = null;
}

function setVideoControlsVisible(visible) {
    if (!activeCallOverlayEl) return;
    // Only auto-hide controls in full-screen video
    if (!isVideoFullscreenActive()) {
        activeCallOverlayEl.classList.remove('opacity-0', 'translate-y-4', 'pointer-events-none');
        return;
    }

    clearVideoControlsAutoHide();

    if (visible) {
        activeCallOverlayEl.classList.remove('opacity-0', 'translate-y-4', 'pointer-events-none');
        // Auto-hide after a short delay (WhatsApp-like)
        videoControlsAutoHideTimeoutId = setTimeout(() => {
            setVideoControlsVisible(false);
        }, 3000);
    } else {
        activeCallOverlayEl.classList.add('opacity-0', 'translate-y-4', 'pointer-events-none');
    }
}

function syncVideoControlsMode() {
    if (!activeCallOverlayEl) return;
    // In compact mode, keep controls visible (more usable)
    if (videoCallStageEl && videoCallStageEl.dataset.layout === 'compact') {
        activeCallOverlayEl.classList.remove('opacity-0', 'translate-y-4', 'pointer-events-none');
        return;
    }
    // In fullscreen, hide by default (tap-to-show)
    if (isVideoFullscreenActive()) {
        setVideoControlsVisible(false);
    } else {
        // Not fullscreen video: ensure dock is usable when it is shown
        activeCallOverlayEl.classList.remove('pointer-events-none');
    }
}

if (remoteVideoEl) {
    remoteVideoEl.addEventListener('enterpictureinpicture', () => {
        hideVideoStage();
    });
    remoteVideoEl.addEventListener('leavepictureinpicture', () => {
        resetVideoStageLayout();
        syncRemoteVideoState();
    });
}

if (videoCallStageEl) {
    videoCallStageEl.addEventListener('click', () => {
        if (!isVideoFullscreenActive()) return;
        const currentlyHidden = activeCallOverlayEl
            ? (activeCallOverlayEl.classList.contains('opacity-0') || activeCallOverlayEl.classList.contains('pointer-events-none'))
            : true;
        setVideoControlsVisible(currentlyHidden);
    });
}

function createPeerConnection(remoteUserId) {
    peerConnection = new RTCPeerConnection(rtcConfig);

    peerConnection.onicecandidate = (event) => {
        if (event.candidate && socket) {
            socket.emit("webrtc_ice_candidate", {
                receiver_id: remoteUserId,
                candidate: event.candidate
            });
        }
    };

    peerConnection.ontrack = (event) => {
        if (!remoteStream) {
            remoteStream = new MediaStream();
        }
        remoteStream.addTrack(event.track);

        if (event.track.kind === 'audio') {
            if (remoteVideoEl) {
                if (remoteVideoEl.srcObject !== remoteStream) {
                    remoteVideoEl.srcObject = remoteStream;
                }
                // Try playing through video element first (often more reliable sync)
                remoteVideoEl.play().catch(e => console.warn("Remote video play blocked", e));
            }
            audioEl.srcObject = remoteStream;
            audioEl.play().catch(e => console.warn("Audio play blocked", e));
        }

        if (event.track.kind === 'video') {
            if (remoteVideoEl && remoteVideoEl.srcObject !== remoteStream) {
                remoteVideoEl.srcObject = remoteStream;
            }
            remoteVideoEl.play().catch(e => console.warn("Remote video play blocked", e));

            // Mute the backup audioEl if video is active to avoid double-audio/echo
            audioEl.muted = true;

            if (currentCallMode === 'video') {
                showVideoStage();
            }
        }

        syncRemoteVideoState();
        showActiveCallOverlay(currentCallState === 'live' ? 'Live' : 'Connected', remoteUserId);
    };

    peerConnection.oniceconnectionstatechange = () => {
        if (!peerConnection) return;
        const state = peerConnection.iceConnectionState;
        if (state === 'connected' || state === 'completed') {
            setCallState('live', remoteUserId);
        } else if (state === 'failed' || state === 'disconnected') {
            console.warn("ICE Connection state:", state);
        }
    };

    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });
}

async function processPendingIceCandidates() {
    if (!peerConnection) return;
    for (const candidate of pendingIceCandidatesQueue) {
        try {
            await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
            console.error("Failed to add queued ICE candidate", e);
        }
    }
    pendingIceCandidatesQueue = [];
}

function setupWebRTCSocketListeners() {
    if (!socket) return;

    socket.on("webrtc_offer", async (data) => {
        if (
            currentCallState !== 'idle' &&
            Number(currentCallPeerId) === Number(data.sender_id) &&
            currentCallLogId &&
            Number(currentCallLogId) === Number(data.call_id)
        ) {
            try {
                const wasVideo = currentCallMode === 'video';
                currentCallMode = data.call_type === 'video' ? 'video' : currentCallMode;
                if (!wasVideo && currentCallMode === 'video') resetVideoStageLayout();
                await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
                processPendingIceCandidates();
                const answer = await peerConnection.createAnswer();
                await peerConnection.setLocalDescription(answer);
                socket.emit("webrtc_answer", {
                    receiver_id: data.sender_id,
                    answer,
                    call_id: currentCallLogId,
                    call_type: currentCallMode
                });
                syncLocalVideoPreview();
                return;
            } catch (e) {
                console.error(e);
                return;
            }
        }

        if (currentCallState !== 'idle' && Number(currentCallPeerId) !== Number(data.sender_id)) {
            socket.emit("webrtc_end", { receiver_id: data.sender_id, call_id: data.call_id, reason: "busy" });
            if (data.call_id) {
                patchCallLog('missed', data.call_type || 'audio', data.call_id).catch(console.error);
            }
            return;
        }

        currentCallPeerId = data.sender_id;
        currentCallMode = data.call_type === 'video' ? 'video' : 'audio';
        currentCallLogId = data.call_id || null;
        currentCallState = 'ringing';
        pendingIncomingOffer = data;
        showIncomingCallOverlay(data.sender_id, currentCallMode);
        notifyIncomingCall({ senderId: data.sender_id, callType: currentCallMode, callId: currentCallLogId });

        document.getElementById('acceptCallBtn').onclick = async () => {
            // Unlock media elements for autoplay policy
            audioEl.play().catch(() => { });
            if (remoteVideoEl) remoteVideoEl.play().catch(() => { });

            hideIncomingCallOverlay();
            const hasMedia = await initLocalStream(currentCallMode);
            if (!hasMedia) return;
            if (currentCallMode === 'video') resetVideoStageLayout();

            createPeerConnection(data.sender_id);
            try {
                await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
                processPendingIceCandidates();
                const answer = await peerConnection.createAnswer();
                await peerConnection.setLocalDescription(answer);
                if (currentCallLogId) {
                    await patchCallLog('accepted', currentCallMode, currentCallLogId);
                }
                socket.emit("webrtc_answer", { receiver_id: data.sender_id, answer: answer, call_id: currentCallLogId, call_type: currentCallMode });
                setCallState('live', data.sender_id);
            } catch (e) { console.error(e); }
        };

        document.getElementById('rejectCallBtn').onclick = () => {
            hideIncomingCallOverlay();
            clearCallRingTimeout();
            currentCallState = 'idle';
            currentCallPeerId = null;
            if (currentCallLogId) {
                patchCallLog('rejected', currentCallMode, currentCallLogId).catch(console.error);
            }
            socket.emit("webrtc_end", { receiver_id: data.sender_id, call_id: currentCallLogId, reason: 'rejected' });
            cleanupWebRTC();
        };
    });

    socket.on("webrtc_answer", async (data) => {
        if (peerConnection) {
            try {
                await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
                processPendingIceCandidates();
                currentCallLogId = data.call_id || currentCallLogId;
                const wasVideo = currentCallMode === 'video';
                currentCallMode = data.call_type === 'video' ? 'video' : currentCallMode;
                if (!wasVideo && currentCallMode === 'video') resetVideoStageLayout();
                setCallState('connecting', data.sender_id);
            } catch (e) { console.error(e); }
        }
    });

    socket.on("webrtc_ice_candidate", async (data) => {
        if (peerConnection && peerConnection.remoteDescription) {
            try {
                await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
            } catch (e) { console.error(e); }
        } else {
            pendingIceCandidatesQueue.push(data.candidate);
        }
    });

    socket.on("webrtc_end", (data) => {
        cleanupWebRTC();
        hideActiveCallOverlay();
        hideIncomingCallOverlay();
        loadCallHistory(activeContactId);
    });

    socket.on("webrtc_upgrade_request", async (data) => {
        if (Number(data.sender_id) !== Number(currentCallPeerId)) return;
        pendingUpgradeRequest = data;
        const accepted = await showModal({
            title: "Upgrade to Video",
            description: `${resolveContactForCall(data.sender_id).name} wants to turn this call into video.`
        });
        if (!accepted) {
            socket.emit("webrtc_upgrade_response", {
                receiver_id: data.sender_id,
                accepted: false,
                call_id: currentCallLogId
            });
            pendingUpgradeRequest = null;
            return;
        }

        const hasVideo = await initLocalStream('video');
        if (!hasVideo) {
            socket.emit("webrtc_upgrade_response", {
                receiver_id: data.sender_id,
                accepted: false,
                call_id: currentCallLogId
            });
            pendingUpgradeRequest = null;
            return;
        }
        resetVideoStageLayout();

        if (currentCallLogId) {
            await patchCallLog('accepted', 'video', currentCallLogId);
        }
        socket.emit("webrtc_upgrade_response", {
            receiver_id: data.sender_id,
            accepted: true,
            call_id: currentCallLogId
        });
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        socket.emit("webrtc_offer", {
            receiver_id: data.sender_id,
            offer,
            call_id: currentCallLogId,
            call_type: 'video'
        });
        currentCallMode = 'video';
        syncLocalVideoPreview();
    });

    socket.on("webrtc_upgrade_response", async (data) => {
        if (!data.accepted) {
            alert("The other user declined the video upgrade.");
            return;
        }
        currentCallMode = 'video';
        resetVideoStageLayout();
        if (currentCallLogId) {
            await patchCallLog('accepted', 'video', currentCallLogId);
        }
        syncLocalVideoPreview();
    });
}

const appConfigEl = document.getElementById('app-config');
const currentUserId = Number(appConfigEl?.dataset.userId || 0);
const callSignalingEnabled = true;
let activeContactId = null;
let activeSharedKey = null; // CryptoKey object (AES-GCM derived from ECDH)
let myPrivateKey = null; // CryptoKey object (ECDH)
let socket = null;
let cachedContacts = [];
let temporaryPinnedContact = null;
let activeHistoryLoadToken = 0;
let currentReplyToId = null;
let currentCallState = 'idle';
let currentCallPeerId = null;
let callTimerIntervalId = null;
let callStartedAt = null;
let callRingTimeoutId = null;
let isCallSignalingReady = false;

function getPendingStatusIcon() {
    return '<span class="material-symbols-outlined text-amber-300 text-xs">schedule</span>';
}

function findOptimisticMessage() {
    return document.querySelector('.message-container.optimistic[data-pending="true"]');
}

function sendOutgoingMessage({
    receiverId,
    encryptedContent = null,
    encryptedFileData = null,
    fileType = null,
    previewText = null,
    previewFileData = null,
    replyToId = null
}) {
    const createdAt = new Date().toISOString();
    const pendingMsg = {
        id: null,
        sender_id: currentUserId,
        receiver_id: Number(receiverId),
        content: encryptedContent,
        file_data: encryptedFileData,
        file_type: fileType,
        reply_to_id: replyToId,
        is_deleted: false,
        is_edited: false,
        is_read: false,
        created_at: createdAt,
        is_pending: true
    };

    if (Number(activeContactId) === Number(receiverId)) {
        appendMessageUI(
            pendingMsg,
            previewText,
            previewFileData
        );
    }

    if (socket && socket.connected) {
        socket.emit('send', {
            receiver_id: Number(receiverId),
            content: encryptedContent,
            file_data: encryptedFileData,
            file_type: fileType,
            reply_to_id: replyToId
        });
    }
}

// --- Utility: Base64/ArrayBuffer ---
function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
}

function base64ToArrayBuffer(base64) {
    const binary_string = window.atob(base64);
    const len = binary_string.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binary_string.charCodeAt(i);
    }
    return bytes.buffer;
}

function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
    });
}

async function deriveWrappingKey(password, saltUint8) {
    const enc = new TextEncoder();
    const keyMaterial = await window.crypto.subtle.importKey(
        "raw",
        enc.encode(password),
        { name: "PBKDF2" },
        false,
        ["deriveBits", "deriveKey"]
    );
    return window.crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            salt: saltUint8,
            iterations: 310000,
            hash: "SHA-256"
        },
        keyMaterial,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
    );
}
function ab2str(buf) {
    return String.fromCharCode.apply(null, new Uint8Array(buf));
}
function str2ab(str) {
    let buf = new ArrayBuffer(str.length);
    let bufView = new Uint8Array(buf);
    for (let i = 0; i < str.length; i++) { bufView[i] = str.charCodeAt(i); }
    return buf;
}
function encodeB64(buffer) { return window.btoa(ab2str(buffer)); }
function decodeB64(b64) { return str2ab(window.atob(b64)); }

// --- Crypto Initialization ---
async function initCrypto() {
    if (!window.isSecureContext) {
        showModal({
            title: "Insecure Context",
            description: "Web Crypto API requires a Secure Context (HTTPS or localhost).",
            isAlert: true
        });
        return;
    }

    try {
        const privKeyJwkStr = sessionStorage.getItem('chat_priv_key');
        if (!privKeyJwkStr) {
            console.warn("Private key not found in sessionStorage! Cannot decrypt messages. Logging out...");
            let seconds = 10;
            const modalPromise = showModal({
                title: "Security Session Locked",
                description: `Encryption keys cleared from memory. Logging out securely in ${seconds} seconds...`,
                isAlert: true
            });
            const descEl = document.getElementById('modalDescription');
            const interval = setInterval(() => {
                seconds--;
                if (descEl) descEl.innerText = `Encryption keys cleared from memory. Logging out securely in ${seconds} seconds...`;
                if (seconds <= 0) {
                    clearInterval(interval);
                    logout();
                }
            }, 1000);
            modalPromise.then(() => {
                clearInterval(interval);
                logout();
            });
            return;
        }
        const jwk = JSON.parse(privKeyJwkStr);
        myPrivateKey = await window.crypto.subtle.importKey(
            "jwk",
            jwk,
            { name: "ECDH", namedCurve: "P-256" },
            false,
            ["deriveKey", "deriveBits"]
        );
    } catch (e) { console.error("Crypto init error:", e); }
}

// --- Profile Modal Logic ---
document.addEventListener('DOMContentLoaded', () => {
    updateCurrentUserPresenceUI(false);
    setMuteButtonState(false);

    const btn = document.getElementById('profileEditBtn');
    const picInput = document.getElementById('profilePicInput');
    const picContainer = document.getElementById('profilePicContainer');
    const modalImg = document.getElementById('modalProfileImg');
    const modalChar = document.getElementById('modalProfileChar');

    if (btn) {
        btn.addEventListener('click', () => {
            const modal = document.getElementById('profileModal');
            const content = document.getElementById('profileModalContent');
            modal.classList.remove('hidden');
            modal.classList.add('flex');
            setTimeout(() => {
                modal.classList.remove('opacity-0');
                if (content) content.classList.remove('scale-95');
            }, 10);
        });
    }

    if (picContainer) {
        picContainer.addEventListener('click', () => picInput.click());
    }

    document.getElementById('togglePasswordBtn').addEventListener('click', () => {
        const section = document.getElementById('passwordSection');
        section.classList.toggle('hidden');
    });

    if (picInput) {
        picInput.addEventListener('change', (e) => {
            if (e.target.files && e.target.files[0]) {
                const reader = new FileReader();
                reader.onload = (re) => {
                    modalImg.src = re.target.result;
                    modalImg.classList.remove('hidden');
                    modalChar.classList.add('hidden');
                };
                reader.readAsDataURL(e.target.files[0]);
            }
        });
    }

    const form = document.getElementById('profileForm');
    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const fName = document.getElementById('profileFirstName').value.trim();
            const lName = document.getElementById('profileLastName').value.trim();
            if (!fName || !lName) return;

            const btn = document.getElementById('saveProfileBtn');
            const oldText = btn.innerText;
            btn.innerText = 'Saving...';

            try {
                let b64Data = null;
                const file = picInput.files[0];
                if (file) {
                    b64Data = await fileToBase64(file);
                }

                const updateData = { first_name: fName, last_name: lName };
                if (b64Data) updateData.profile_pic = b64Data;

                const res = await fetch('/api/profile', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(updateData)
                });

                // Handle password change if fields are filled
                const oldPw = document.getElementById('oldPassword').value;
                const newPw = document.getElementById('newPassword').value;
                const confirmNewPw = document.getElementById('confirmNewPassword').value;
                if (oldPw || newPw || confirmNewPw) {
                    if (!oldPw || !newPw || !confirmNewPw) {
                        throw new Error('Fill all password fields to update your password.');
                    }
                    if (newPw !== confirmNewPw) {
                        throw new Error('New password and confirmation do not match.');
                    }
                }

                if (oldPw && newPw) {
                    try {
                        // 1. Get current encrypted DEK and IVs from current user data
                        // We need to fetch current user's encrypted_dek if we don't have it.
                        // Better: Fetch specialized profile data or use the one we got from login?
                        // For simplicity, let's fetch current user info first.
                        const profileRes = await fetch('/api/profile');
                        const userData = await profileRes.json();

                        const salt = new Uint8Array(base64ToArrayBuffer(userData.keys_salt));
                        const dekIv = new Uint8Array(base64ToArrayBuffer(userData.dek_iv));
                        const encryptedDek = base64ToArrayBuffer(userData.encrypted_dek);

                        // 2. Derive old KEK
                        const oldKek = await deriveWrappingKey(oldPw, salt);

                        // 3. Decrypt DEK
                        const dekBuffer = await window.crypto.subtle.decrypt(
                            { name: "AES-GCM", iv: dekIv },
                            oldKek,
                            encryptedDek
                        );

                        // 4. Derive new KEK with NEW salt
                        const newSalt = window.crypto.getRandomValues(new Uint8Array(16));
                        const newKek = await deriveWrappingKey(newPw, newSalt);

                        // 5. Re-encrypt DEK with new KEK
                        const newDekIv = window.crypto.getRandomValues(new Uint8Array(12));
                        const newEncryptedDekBuffer = await window.crypto.subtle.encrypt(
                            { name: "AES-GCM", iv: newDekIv },
                            newKek,
                            dekBuffer
                        );

                        const pwPayload = {
                            old_password: oldPw,
                            new_password: newPw,
                            encrypted_dek: arrayBufferToBase64(newEncryptedDekBuffer),
                            dek_iv: arrayBufferToBase64(newDekIv),
                            keys_salt: arrayBufferToBase64(newSalt)
                        };

                        const pwRes = await fetch('/api/profile/password', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(pwPayload)
                        });

                        if (!pwRes.ok) {
                            const pwErr = await pwRes.json();
                            throw new Error(pwErr.detail || "Password update failed");
                        }
                    } catch (pwErr) {
                        console.error("Password change failed:", pwErr);
                        alert("Profile updated, but password change failed: " + pwErr.message);
                    }
                }

                if (res.ok) {
                    const updatedUser = await res.json();
                    updateProfileDisplay(updatedUser.first_name, updatedUser.last_name, updatedUser.profile_pic);
                    document.getElementById('oldPassword').value = '';
                    document.getElementById('newPassword').value = '';
                    document.getElementById('confirmNewPassword').value = '';
                    closeProfileModal();
                } else {
                    const err = await res.json();
                    alert(err.detail || "Failed to update profile");
                }
            } catch (err) {
                console.error(err);
                alert(err.message || 'Failed to update profile');
            } finally {
                btn.innerText = oldText;
            }
        });
    }

    const closeBtn = document.getElementById('closeProfileModalBtn');
    if (closeBtn) {
        closeBtn.addEventListener('click', closeProfileModal);
    }
});

window.openProfileModal = function () {
    const modal = document.getElementById('profileModal');
    const content = document.getElementById('profileModalContent');
    if (!modal || !content) return;

    modal.classList.remove('hidden');
    modal.classList.add('flex');
    setTimeout(() => {
        modal.classList.remove('opacity-0');
        content.classList.remove('scale-95');
    }, 10);
};

window.closeProfileModal = function () {
    const modal = document.getElementById('profileModal');
    const content = document.getElementById('profileModalContent');
    if (modal) modal.classList.add('opacity-0');
    if (content) content.classList.add('scale-95');
    setTimeout(() => {
        if (modal) {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        }
    }, 200);
};

// Profile Pic Trigger
document.getElementById('profileModal').addEventListener('click', (e) => {
    if (e.target.closest('#triggerProfilePic')) {
        document.getElementById('profilePicInput').click();
    }
});

// Profile Dropdown Toggle
document.addEventListener('click', (e) => {
    const dropdown = document.getElementById('profileDropdown');
    const btn = document.getElementById('sidebarSettingsBtn');

    if (btn && btn.contains(e.target)) {
        dropdown.classList.toggle('hidden');
    } else if (dropdown && !dropdown.contains(e.target)) {
        dropdown.classList.add('hidden');
    }
});



// Update profile display in header
function updateProfileDisplay(firstName, lastName, profilePic = null) {
    const topLabel = document.getElementById('topUserNameLabel');
    const topChar = document.getElementById('topAvatarChar');
    const topImg = document.getElementById('topAvatarImg');
    const modalName = document.getElementById('profileModalName');
    const modalChar = document.getElementById('modalProfileChar');
    const modalImg = document.getElementById('modalProfileImg');

    if (topLabel) topLabel.innerText = firstName + ' ' + lastName;
    if (topChar) topChar.innerText = firstName.charAt(0);
    if (modalName) modalName.innerText = firstName + ' ' + lastName;
    if (modalChar) modalChar.innerText = firstName.charAt(0);

    if (topImg) {
        if (profilePic) {
            topImg.src = profilePic;
            topImg.classList.remove('hidden');
            if (topChar) topChar.classList.add('hidden');
        } else {
            topImg.classList.add('hidden');
            if (topChar) topChar.classList.remove('hidden');
        }
    }

    if (modalImg) {
        if (profilePic) {
            modalImg.src = profilePic;
            modalImg.classList.remove('hidden');
            if (modalChar) modalChar.classList.add('hidden');
        } else {
            modalImg.classList.add('hidden');
            if (modalChar) modalChar.classList.remove('hidden');
        }
    }
}

function updateCurrentUserPresenceUI(isOnline) {
    const statusDot = document.getElementById('currentUserStatusDot');
    const statusText = document.getElementById('currentUserStatusText');

    if (statusDot) {
        statusDot.className = `absolute bottom-0 right-0 w-3 h-3 ${isOnline ? 'bg-kin_tertiary' : 'bg-slate-600'} border-2 border-kin_surf_lowest rounded-full transition-all`;
    }

    if (statusText) {
        statusText.innerText = isOnline ? 'Active Now' : 'Offline';
        statusText.className = `text-[10px] ${isOnline ? 'text-kin_tertiary' : 'text-slate-500'} uppercase font-bold tracking-widest truncate`;
    }
}


async function importContactPublicKey(b64Key) {
    try {
        const binaryDer = decodeB64(b64Key);
        return await window.crypto.subtle.importKey(
            "spki",
            binaryDer,
            { name: "ECDH", namedCurve: "P-256" },
            false,
            []
        );
    } catch (e) { console.error("Import public key error:", e); return null; }
}

async function deriveSharedSecret(contactPubKey) {
    if (!myPrivateKey || !contactPubKey) return null;
    return await window.crypto.subtle.deriveKey(
        {
            name: "ECDH",
            public: contactPubKey
        },
        myPrivateKey,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
    );
}

async function encryptText(text, sharedKey) {
    if (!text) return null;
    let enc = new TextEncoder();
    let iv = window.crypto.getRandomValues(new Uint8Array(12));
    let ciphertext = await window.crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv },
        sharedKey,
        enc.encode(text)
    );
    return encodeB64(iv) + ":" + encodeB64(ciphertext);
}

async function decryptText(payload, sharedKey) {
    if (!payload || !sharedKey) return "[Decryption Failed]";
    try {
        let parts = payload.split(':');
        if (parts.length !== 2) return "[Invalid Payload Format]";
        let iv = decodeB64(parts[0]);
        let buffer = decodeB64(parts[1]);

        let decrypted = await window.crypto.subtle.decrypt(
            { name: "AES-GCM", iv: iv },
            sharedKey,
            buffer
        );
        let dec = new TextDecoder();
        return dec.decode(decrypted);
    } catch (e) {
        console.error(e);
        return "[Decryption Error]";
    }
}

// --- HTTP Polling Realtime ---
let onlineUserIds = new Set();
let hasPresenceSync = false;
let presenceDotCache = new Map();
let presenceUiPending = new Map();
let presenceUiFlushRafId = null;
let windowTypingTimeouts = {};
let lastPresenceSyncAt = 0;

function rebuildPresenceDotCache() {
    presenceDotCache = new Map();
    document.querySelectorAll('[data-presence-user-id]').forEach((dot) => {
        const userId = Number(dot.getAttribute('data-presence-user-id'));
        if (Number.isNaN(userId)) return;
        if (!presenceDotCache.has(userId)) {
            presenceDotCache.set(userId, []);
        }
        presenceDotCache.get(userId).push(dot);
    });
}

function flushPresenceUi() {
    presenceUiFlushRafId = null;
    for (const [userId, isOnline] of presenceUiPending.entries()) {
        updatePresenceUI(userId, isOnline);
    }
    presenceUiPending.clear();
}

function queuePresenceUiUpdate(userId, isOnline) {
    presenceUiPending.set(Number(userId), Boolean(isOnline));
    if (presenceUiFlushRafId) return;
    presenceUiFlushRafId = window.requestAnimationFrame(flushPresenceUi);
}

function updatePresenceUI(userId, isOnline) {
    const numericUserId = Number(userId);

    // Update all status dots for this user (handles search results, main list, etc.)
    const dots = presenceDotCache.get(numericUserId) || [];
    for (const dot of dots) {
        dot.classList.toggle('bg-kin_tertiary', Boolean(isOnline));
        dot.classList.toggle('bg-slate-600', !isOnline);
    }

    cachedContacts = cachedContacts.map((contact) => (
        Number(contact.id) === numericUserId ? { ...contact, is_online: isOnline } : contact
    ));
    if (temporaryPinnedContact && Number(temporaryPinnedContact.id) === numericUserId) {
        temporaryPinnedContact = { ...temporaryPinnedContact, is_online: isOnline };
    }

    if (activeContactId === numericUserId) {
        const statusText = document.getElementById('chat-status-text');
        const statusDot = document.getElementById('chat-status-dot');
        if (statusText && statusDot) {
            if (isOnline) {
                statusText.innerText = 'Online';
                statusText.className = 'text-kin_tertiary font-bold';
                statusDot.className = 'absolute bottom-0 right-0 w-3.5 h-3.5 bg-kin_tertiary border-2 border-slate-900 rounded-full transition-all';
            } else {
                statusText.innerText = 'Offline';
                statusText.className = 'text-slate-400 font-medium';
                statusDot.className = 'absolute bottom-0 right-0 w-3.5 h-3.5 bg-slate-600 border-2 border-slate-900 rounded-full transition-all';
            }
        }

        if (isContactProfileOpen() && window.activeContactData && Number(window.activeContactData.id) === numericUserId) {
            setContactProfilePresence(Boolean(isOnline));
        }
    }
}

function isContactProfileOpen() {
    const modal = document.getElementById('contactProfileModal');
    return Boolean(modal && !modal.classList.contains('hidden'));
}

function getIsUserOnline(userId) {
    const numericUserId = Number(userId);
    if (Number.isNaN(numericUserId)) return false;
    if (hasPresenceSync) return onlineUserIds.has(numericUserId);

    const dot = document.querySelector(`.status-dot-user-${numericUserId}`);
    if (dot) return dot.classList.contains('bg-kin_tertiary');

    if (activeContactId === numericUserId) {
        const statusDot = document.getElementById('chat-status-dot');
        if (statusDot) return statusDot.classList.contains('bg-kin_tertiary');
    }
    return false;
}

function setContactProfilePresence(isOnline) {
    const statusDot = document.getElementById('cpStatusDotVisual');
    const statusText = document.getElementById('cpModalStatusText');
    const isOnlineBool = Boolean(isOnline);

    if (statusDot) {
        statusDot.className = isOnlineBool
            ? 'w-2 h-2 rounded-full bg-kin_tertiary animate-pulse shadow-[0_0_10px_rgba(0,218,243,0.5)]'
            : 'w-2 h-2 rounded-full bg-slate-500';
    }
    if (statusText) {
        statusText.innerText = isOnlineBool ? 'Online • Secure Session' : 'Offline • Secure Session';
    }
}

function syncOnlineUsers(nextOnlineUsers) {
    const normalized = new Set([...nextOnlineUsers].map((id) => Number(id)));
    const previous = onlineUserIds;
    // Fast path: no changes.
    if (previous.size === normalized.size) {
        let same = true;
        for (const id of previous) {
            if (!normalized.has(id)) {
                same = false;
                break;
            }
        }
        if (same) {
            onlineUserIds = normalized;
            return;
        }
    }

    const knownUsers = new Set([...previous, ...normalized]);
    // Also include any users we currently render in the UI so presence can flip them offline.
    cachedContacts.forEach((contact) => knownUsers.add(Number(contact.id)));
    if (temporaryPinnedContact) knownUsers.add(Number(temporaryPinnedContact.id));

    onlineUserIds = normalized;
    for (const userId of knownUsers) {
        const isOnline = normalized.has(Number(userId));
        queuePresenceUiUpdate(userId, isOnline);
    }
}

function handlePresenceIds(onlineIds) {
    hasPresenceSync = true;
    lastPresenceSyncAt = Date.now();
    const onlineSet = new Set((onlineIds || []).map((id) => Number(id)));
    console.log("[Presence] Received online IDs:", onlineSet);
    syncOnlineUsers(onlineSet);
}

async function initRealtime() {
    socket = io({ 
        withCredentials: true,
        transports: ['websocket', 'polling'] 
    });
    setupWebRTCSocketListeners();

    socket.on('connect', async () => {
        console.log('Polling sync connected');
        hasPresenceSync = false;
        socket.emit('request_presence');
        updateCurrentUserPresenceUI(true);
        rebuildPresenceDotCache();
        if (activeContactId) {
            await loadMessageHistory(activeContactId);
        }
    });

    socket.on('error', async (msg) => {
        await showModal({
            title: "Error",
            description: msg.message,
            isAlert: true
        });
    });

    socket.on('presence_sync', (onlineIds) => {
        handlePresenceIds(onlineIds);
    });

    socket.on('presence', (data) => {
        const uid = Number(data.user_id);
        const isOnline = data.status === 'online';
        if (isOnline) {
            onlineUserIds.add(uid);
        } else {
            onlineUserIds.delete(uid);
        }
        queuePresenceUiUpdate(uid, isOnline);
    });

    socket.on('signaling_ready', () => {
        isCallSignalingReady = true;
    });

    socket.on('signaling_unavailable', () => {
        isCallSignalingReady = false;
    });

    socket.on('receive_message', async (msg) => {
        if (Number(msg.receiver_id) === Number(currentUserId) && Number(msg.sender_id) !== Number(currentUserId)) {
            notifyIncomingMessage(msg).catch(console.error);
        }
        if ((Number(msg.sender_id) === Number(activeContactId) && Number(msg.receiver_id) === Number(currentUserId)) ||
            (Number(msg.sender_id) === Number(currentUserId) && Number(msg.receiver_id) === Number(activeContactId))) {

            let plainText = msg.content;
            if (msg.content) {
                plainText = await decryptText(msg.content, activeSharedKey);
            }

            let plainFileData = msg.file_data;
            if (msg.file_data) {
                plainFileData = await decryptText(msg.file_data, activeSharedKey);
            }

            if (Number(msg.sender_id) === Number(currentUserId)) {
                const optMsg = findOptimisticMessage();
                if (optMsg) {
                    optMsg.id = `msg-container-${msg.id}`;
                    optMsg.dataset.msgId = msg.id;
                    optMsg.dataset.pending = 'false';
                    optMsg.classList.remove('optimistic');
                    updateActionsVisibility(optMsg, msg.created_at);

                    const iconDiv = optMsg.querySelector('.msg-status-icon');
                    if (iconDiv) {
                        iconDiv.innerHTML = msg.is_read
                            ? '<span class="material-symbols-outlined text-sky-500 text-base" style="font-variation-settings: \'FILL\' 1;">done_all</span>'
                            : '<span class="material-symbols-outlined text-gray-400 text-base">done</span>';
                    }

                    if (window.pendingReadReceipts && window.pendingReadReceipts.has(msg.id)) {
                        if (iconDiv) {
                            iconDiv.innerHTML = '<span class="material-symbols-outlined text-[14px] text-kin_tertiary" style="font-variation-settings: \'FILL\' 1;">done_all</span>';
                        }
                        window.pendingReadReceipts.delete(msg.id);
                    }
                    if (document.getElementById('contactSearch').value.trim() === '') {
                        loadContacts();
                    }
                    return;
                }
            }

            appendMessageUI(msg, plainText, plainFileData);

            // Mark as read only if window has strict FOCUS (user is actively interacting with it)
            if (Number(msg.sender_id) === Number(activeContactId) && Number(msg.sender_id) !== Number(currentUserId) && document.hasFocus()) {
                await markChatAsRead(activeContactId);
            }
        }
        if (document.getElementById('contactSearch').value.trim() === '') {
            loadContacts();
        }
    });

    socket.on('edit', async (msg) => {
        if ((msg.sender_id === activeContactId && msg.receiver_id === currentUserId) ||
            (msg.sender_id === currentUserId && msg.receiver_id === activeContactId)) {
            await updateMessageUI(msg);
        }
        if (document.getElementById('contactSearch').value.trim() === '') {
            loadContacts();
        }
    });

    socket.on('delete', (msg) => {
        if ((msg.sender_id === activeContactId && msg.receiver_id === currentUserId) ||
            (msg.sender_id === currentUserId && msg.receiver_id === activeContactId)) {
            deleteMessageUI(msg.id);
        }
        if (document.getElementById('contactSearch').value.trim() === '') {
            loadContacts();
        }
    });

    socket.on('read_receipt', (msg) => {
        if (!window.pendingReadReceipts) window.pendingReadReceipts = new Set();
        
        // If this is a sync from another one of our own tabs
        if (msg.is_self_sync) {
            const contactEl = document.getElementById('contact-' + msg.contact_id);
            if (contactEl) {
                const badge = contactEl.querySelector('.unread-badge');
                if (badge) badge.remove();
            }
            // Update local cache
            cachedContacts = cachedContacts.map(c =>
                Number(c.id) === Number(msg.contact_id) ? { ...c, unread_count: 0 } : c
            );
            return;
        }

        msg.message_ids.forEach((id) => {
            const container = document.getElementById(`msg-container-${id}`);
            if (container) {
                const iconDiv = container.querySelector('.msg-status-icon');
                if (iconDiv) {
                    iconDiv.innerHTML = '<span class="material-symbols-outlined text-[14px] text-kin_tertiary" style="font-variation-settings: \'FILL\' 1;">done_all</span>';
                }
            } else {
                window.pendingReadReceipts.add(id);
            }
        });
    });

    socket.on('disconnect', () => {
        console.log("Polling sync disconnected");
        updateCurrentUserPresenceUI(false);
    });

    await socket.connect();
}

async function markChatAsRead(contactId) {
    if (socket && socket.connected) {
        await socket.emit('mark_read', { contact_id: contactId });

        const contactEl = document.getElementById('contact-' + contactId);
        if (contactEl) {
            const badge = contactEl.querySelector('.unread-badge');
            if (badge) badge.remove();
        }

        // Sync local contact data
        cachedContacts = cachedContacts.map(c =>
            Number(c.id) === Number(contactId) ? { ...c, unread_count: 0 } : c
        );
    }
}

function updateActiveContactHighlight(contactId = null) {
    document.querySelectorAll('.contact-item').forEach((el) => {
        el.classList.remove('bg-kin_primary/10', 'border-kin_primary');
        el.classList.add('hover:bg-white/5', 'border-transparent');
        // Reset time color
        const timeSpan = el.querySelector('.time-stamp');
        if (timeSpan) {
            timeSpan.classList.add('text-slate-500');
            timeSpan.classList.remove('text-kin_primary');
        }
    });

    // Highlights only visible on Desktop (>1280px)
    if (contactId === null || window.innerWidth < 1280) return;

    const contactEl = document.getElementById(`contact-${contactId}`);
    if (contactEl) {
        contactEl.classList.remove('hover:bg-white/5', 'border-transparent');
        contactEl.classList.add('bg-kin_primary/10', 'border-kin_primary');
        // Highlight time color
        const timeSpan = contactEl.querySelector('.time-stamp');
        if (timeSpan) {
            timeSpan.classList.remove('text-slate-500');
            timeSpan.classList.add('text-kin_primary');
        }
    }
}

function normalizeContactData(contact) {
    if (!contact) return null;
    const contactId = Number(contact.id);

    return {
        ...contact,
        id: contactId,
        first_name: contact.first_name || '',
        last_name: contact.last_name || '',
        mobile_number: contact.mobile_number || '',
        public_key: contact.public_key || '',
        profile_pic: contact.profile_pic || '',
        unread_count: Number(contact.unread_count || 0),
        blocked_by_me: Boolean(contact.blocked_by_me),
        blocked_me: Boolean(contact.blocked_me),
        is_online: hasPresenceSync ? onlineUserIds.has(contactId) : Boolean(contact.is_online),
    };
}

function getRenderedContacts(contactsArray) {
    const normalizedContacts = (contactsArray || []).map(normalizeContactData);

    if (!temporaryPinnedContact) {
        return normalizedContacts;
    }

    const pinnedContactId = Number(temporaryPinnedContact.id);
    if (normalizedContacts.some((contact) => Number(contact.id) === pinnedContactId)) {
        return normalizedContacts;
    }

    return [normalizeContactData(temporaryPinnedContact), ...normalizedContacts];
}

async function resetContactListAfterSearch(selectedContact = null) {
    const searchInput = document.getElementById('contactSearch');
    if (searchInput) {
        searchInput.value = '';
    }

    if (selectedContact) {
        const normalizedSelectedContact = normalizeContactData(selectedContact);
        const existingContact = cachedContacts.find(
            (contact) => Number(contact.id) === Number(normalizedSelectedContact.id)
        );
        temporaryPinnedContact = existingContact ? null : normalizedSelectedContact;
    } else {
        temporaryPinnedContact = null;
    }

    await renderContactList(cachedContacts);

    if (selectedContact) {
        updateActiveContactHighlight(Number(selectedContact.id));
    }
}

// --- UI Interactions ---
async function loadMessageHistory(contactId) {
    const loadToken = ++activeHistoryLoadToken;
    const messagesArea = document.getElementById('messages-area');
    messagesArea.innerHTML = '<div class="text-center text-gray-500 text-sm mt-4">Loading history...</div>';

    try {
        const res = await fetch('/api/messages/' + contactId);
        const history = await res.json();

        if (loadToken !== activeHistoryLoadToken || Number(contactId) !== Number(activeContactId)) {
            return;
        }

        messagesArea.innerHTML = '';
        window.lastMessageDateString = null; // Reset date tracker for new chat history

        for (let msg of history) {
            let plainText = msg.content;
            if (msg.content) {
                plainText = await decryptText(msg.content, activeSharedKey);
            }
            let plainFileData = msg.file_data;
            if (msg.file_data) {
                plainFileData = await decryptText(msg.file_data, activeSharedKey);
            }
            appendMessageUI(msg, plainText, plainFileData);
        }

        scrollToBottom();
        await markChatAsRead(contactId);
    } catch (e) {
        console.error(e);
        if (loadToken !== activeHistoryLoadToken || Number(contactId) !== Number(activeContactId)) {
            return;
        }
        messagesArea.innerHTML = '';
    }
}

// Mobile Navigation State Manager (Hardened)
function syncDynamicView(isChatActive = null) {
    const width = window.innerWidth;
    const isMobile = width < 768;
    const isTablet = width >= 768 && width < 1280;
    const isDesktop = width >= 1280;

    if (isChatActive === null) {
        isChatActive = !!activeContactId;
    }

    if (isChatActive) {
        document.body.classList.add('chat-active');
    } else {
        document.body.classList.remove('chat-active');
    }

    // Logic for Nav Bars
    if (isMobile) {
        document.body.classList.remove('sidebar-collapsed');
    } else {
        // Default to collapsed on tablet, expanded on desktop
        const savedState = localStorage.getItem('isSidebarCollapsed');
        const shouldCollapse = savedState !== null ? (savedState === 'true') : isTablet;
        if (shouldCollapse) {
            document.body.classList.add('sidebar-collapsed');
        } else {
            document.body.classList.remove('sidebar-collapsed');
        }
    }

    // Handle placeholders properly for all modes
    const placeholder = document.getElementById('no-chat-selected');
    const activeChat = document.getElementById('active-chat');
    if (isChatActive) {
        if (placeholder) placeholder.classList.add('hidden');
        if (activeChat) activeChat.classList.remove('hidden');
    } else {
        if (placeholder) placeholder.classList.remove('hidden');
        if (activeChat) activeChat.classList.add('hidden');
    }
}

async function selectUser(id, name, pubKeyB64, mobile = null, profilePic = null, blockedByMe = false, blockedMe = false) {
    activeContactId = id;

    syncDynamicView(true);

    document.getElementById('chat-name').innerText = name;
    const callContactBtn = document.getElementById('callContactBtn');
    const videoCallBtn = document.getElementById('videoCallBtn');
    const shouldShowCallControls = callSignalingEnabled && !blockedByMe && !blockedMe;
    if (callContactBtn) callContactBtn.classList.toggle('hidden', !shouldShowCallControls);
    if (videoCallBtn) videoCallBtn.classList.toggle('hidden', !shouldShowCallControls);
    const avatarImg = document.getElementById('chat-avatar-img');
    const avatarChar = document.getElementById('chat-avatar-char');
    if (profilePic) {
        avatarImg.src = profilePic;
        avatarImg.classList.remove('hidden');
        avatarChar.classList.add('hidden');
    } else {
        avatarImg.classList.add('hidden');
        avatarChar.innerText = name.charAt(0);
        avatarChar.classList.remove('hidden');
    }

    // Store active contact info for profile card
    window.activeContactData = { id, name, mobile, profilePic, pubKeyB64, blockedByMe, blockedMe };

    // Update Blocking UI
    const msgForm = document.getElementById('messageForm');
    const blockedUi = document.getElementById('blocked-ui-container');
    const blockedByMeMsg = document.getElementById('blocked-by-me-msg');
    const blockedMeMsg = document.getElementById('blocked-me-msg');
    const blockBtnModal = document.getElementById('blockContactBtn');

    if (blockedByMe || blockedMe) {
        msgForm.classList.add('hidden');
        blockedUi.classList.remove('hidden');
        blockedUi.classList.add('flex');

        if (blockedByMe) {
            blockedByMeMsg.classList.remove('hidden');
            blockedMeMsg.classList.add('hidden');
            blockBtnModal.innerText = 'Unblock Contact';
            blockBtnModal.classList.replace('text-red-400', 'text-teal-400');
        } else {
            blockedMeMsg.classList.remove('hidden');
            blockedByMeMsg.classList.add('hidden');
            blockBtnModal.innerText = 'Block Contact';
            blockBtnModal.classList.replace('text-teal-400', 'text-red-400');
        }
    } else {
        msgForm.classList.remove('hidden');
        blockedUi.classList.add('hidden');
        blockedUi.classList.remove('flex');
        blockBtnModal.innerText = 'Block Contact';
        blockBtnModal.classList.replace('text-teal-400', 'text-red-400');
    }

    const statusText = document.getElementById('chat-status-text');
    const statusDot = document.getElementById('chat-status-dot');
    const contactDot = document.getElementById(`contact-status-dot-${id}`);
    const isOnline = hasPresenceSync ? onlineUserIds.has(Number(id)) : Boolean(contactDot && contactDot.classList.contains('bg-kin_tertiary'));

    if (statusText && statusDot) {
        if (isOnline) {
            statusText.innerText = 'Online';
            statusText.className = 'text-[10px] text-kin_tertiary font-bold tracking-widest uppercase';
            statusDot.className = 'absolute bottom-0 right-0 w-3 h-3 bg-kin_tertiary border-2 border-surface-container rounded-full transition-all';
        } else {
            statusText.innerText = 'Offline';
            statusText.className = 'text-[10px] text-slate-500 font-bold tracking-widest uppercase';
            statusDot.className = 'absolute bottom-0 right-0 w-3 h-3 bg-slate-600 border-2 border-surface-container rounded-full transition-all';
        }
    }

    // Keep only the selected contact highlighted.
    updateActiveContactHighlight(id);

    // Save to localStorage for persistence
    localStorage.setItem('activeContactId', id);
    localStorage.setItem('activeContactName', name);
    localStorage.setItem('activeContactPubKey', pubKeyB64);

    // Import their public key and derive shared secret
    try {
        if (!pubKeyB64 || pubKeyB64 === "null") {
            console.warn("User has no public key yet.");
            activeSharedKey = null;
        } else {
            let contactPubKey = await importContactPublicKey(pubKeyB64);
            activeSharedKey = await deriveSharedSecret(contactPubKey);
        }
    } catch (e) { console.error("Key derivation failed", e); }

    await loadMessageHistory(id);
}

const handleBackToSidebar = (e) => {
    if (e) e.preventDefault();
    activeContactId = null;
    localStorage.removeItem('activeContactId');
    localStorage.removeItem('activeContactName');
    localStorage.removeItem('activeContactPubKey');

    syncDynamicView(false);
    updateActiveContactHighlight();
};


document.getElementById('contact-list').addEventListener('click', async (e) => {
    const item = e.target.closest('.contact-item');
    if (item) {
        const id = parseInt(item.getAttribute('data-contact-id'));
        const name = item.getAttribute('data-contact-name');
        const firstName = item.getAttribute('data-contact-first-name');
        const lastName = item.getAttribute('data-contact-last-name');
        const pubKey = item.getAttribute('data-contact-pubkey');
        const mobile = item.getAttribute('data-contact-mobile');
        const profilePic = item.getAttribute('data-contact-pic');
        const blockedByMe = item.getAttribute('data-contact-blocked-by-me') === 'true';
        const blockedMe = item.getAttribute('data-contact-blocked-me') === 'true';

        activeContactId = id; // Update state immediately

        await resetContactListAfterSearch({
            id,
            first_name: firstName,
            last_name: lastName,
            public_key: pubKey,
            mobile_number: mobile,
            profile_pic: profilePic,
            blocked_by_me: blockedByMe,
            blocked_me: blockedMe,
        });
        selectUser(id, name, pubKey, mobile, profilePic, blockedByMe, blockedMe);
    }
});

async function renderContactList(contactsArray) {
    const listDiv = document.getElementById('contact-list');
    if (!listDiv) return;

    // Clear the loading/placeholder state immediately.
    listDiv.innerHTML = '';

    const contactsToRender = getRenderedContacts(contactsArray);

    if (!contactsToRender || contactsToRender.length === 0) {
        listDiv.innerHTML = '<div class="text-center font-inter text-kin_on_surface_variant text-xs mt-8">No contacts found</div>';
        return;
    }

    const contactDataList = await Promise.all(contactsToRender.map(async (contact) => {
        if (Number(activeContactId) === Number(contact.id)) contact.unread_count = 0;
        let lastMsgText = "Click to start chatting";
        let timeStr = "";

        if (contact.last_message) {
            try {
                // Defensive check for public key existence.
                if (contact.public_key) {
                    let contactPubKey = await importContactPublicKey(contact.public_key);
                    if (contactPubKey && myPrivateKey) {
                        let tempSharedKey = await deriveSharedSecret(contactPubKey);
                        if (tempSharedKey) {
                            let plain = await decryptText(contact.last_message, tempSharedKey);
                            lastMsgText = plain ? plain : (contact.last_message.includes(':') ? "Secure message" : "Encrypted media");
                        } else {
                            lastMsgText = "Security setup pending";
                        }
                    } else if (contactPubKey) {
                        lastMsgText = "Encrypted message";
                    } else {
                        lastMsgText = "Secure message";
                    }
                } else {
                    lastMsgText = "Legacy message";
                }
            } catch (e) {
                console.warn("Could not decrypt preview for contact", contact.id, e);
                lastMsgText = "Encrypted message";
            }
        } else if (contact.last_message_at) {
            lastMsgText = "Attachment";
        }

        if (contact.last_message_at) {
            try {
                let d = new Date(contact.last_message_at + (contact.last_message_at.endsWith('Z') ? '' : 'Z'));
                timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            } catch (e) { timeStr = ""; }
        }
        return { ...contact, lastMsgText, timeStr };
    }));

    for (let contact of contactDataList) {
        let { lastMsgText, timeStr } = contact;

        const isOnline = Boolean(contact.is_online);
        const nameSafely = escapeHtml(contact.first_name) + ' ' + escapeHtml(contact.last_name);
        const profilePic = contact.profile_pic || "";

        const isDesktop = window.innerWidth >= 1280;
        const highlightClasses = (activeContactId === contact.id && isDesktop)
            ? 'bg-kin_primary/10 border-l-4 border-kin_primary'
            : 'hover:bg-white/5 border-l-4 border-transparent';

        const html = `
        <div id="contact-${contact.id}" data-contact-id="${contact.id}" data-contact-name="${nameSafely}"
            data-contact-first-name="${escapeHtml(contact.first_name)}"
            data-contact-last-name="${escapeHtml(contact.last_name)}"
            data-contact-pubkey="${contact.public_key}" data-contact-mobile="${escapeHtml(contact.mobile_number)}"
            data-contact-pic="${profilePic}"
            data-contact-blocked-by-me="${contact.blocked_by_me}"
            data-contact-blocked-me="${contact.blocked_me}"
            class="contact-item group flex items-center gap-4 p-4 md:px-6 cursor-pointer transition-all rounded-2xl mx-1
            ${highlightClasses}">
            <div class="relative flex-shrink-0">
                <div class="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-lg overflow-hidden bg-gradient-to-tr from-kin_primary_container to-kin_primary shadow-sm">
                    ${profilePic ? `<img src="${profilePic}" class="w-full h-full object-cover">` : escapeHtml(contact.first_name).charAt(0)}
                </div>
                <div data-presence-user-id="${contact.id}" class="status-dot-user-${contact.id} absolute bottom-0 right-0 w-3.5 h-3.5 ${isOnline ? 'bg-kin_tertiary' : 'bg-slate-600'} border-2 border-surface-container-lowest rounded-full transition-all"></div>
            </div>
            <div class="flex-1 text-left min-w-0">
                <div class="flex justify-between items-baseline mb-0.5 w-full">
                    <span class="font-bold text-on-surface truncate tracking-tight flex-1 min-w-0 pr-4">${nameSafely}</span>
                    <span class="text-[10px] time-stamp shrink-0 whitespace-nowrap ${(activeContactId === contact.id && isDesktop) ? 'text-kin_primary' : 'text-slate-500'} font-bold">${timeStr}</span>
                </div>
                <div class="flex justify-between items-center">
                    <p class="text-xs text-on-surface-variant truncate pr-2 opacity-80" id="contact-${contact.id}-preview">${escapeHtml(lastMsgText)}</p>
                    ${Number(contact.unread_count) > 0 ? `
                    <div class="unread-badge w-5 h-5 bg-kin_primary rounded-full flex items-center justify-center shadow-lg shadow-kin_primary/20 flex-shrink-0">
                        <span class="text-[10px] font-bold text-white">${contact.unread_count}</span>
                    </div>` : ''}
                </div>
            </div>
        </div>
        `;
        listDiv.insertAdjacentHTML('beforeend', html);
    }

    // Keep presence updates O(1) per user by caching dot elements after render.
    rebuildPresenceDotCache();

    // Re-apply presence state if we already have it from the socket
    if (hasPresenceSync) {
        console.log("[Presence] Re-applying presence state to newly rendered list");
        for (const userId of onlineUserIds) {
            updatePresenceUI(userId, true);
        }
    }
}

async function loadContacts() {
    const listDiv = document.getElementById('contact-list');
    try {
        const res = await fetch('/api/contacts');
        if (res.ok) {
            const data = await res.json();
            const contacts = (data || []).map(normalizeContactData);
            cachedContacts = contacts;
            if (temporaryPinnedContact && cachedContacts.some((contact) => Number(contact.id) === Number(temporaryPinnedContact.id))) {
                temporaryPinnedContact = null;
            }
            await renderContactList(cachedContacts);
        } else {
            console.error("Failed to fetch contacts", res.status);
            if (listDiv) listDiv.innerHTML = '<div class="text-center text-red-300 text-xs mt-10">Could not load contacts</div>';
        }
    } catch (e) {
        console.error("Error loading contacts", e);
        if (listDiv) listDiv.innerHTML = '<div class="text-center text-red-300 text-xs mt-10">Server unreachable</div>';
    }
}

let searchTimeout = null;
function setupSearch() {
    const searchInput = document.getElementById('contactSearch');
    searchInput.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        const query = e.target.value.trim();
        searchTimeout = setTimeout(async () => {
            const listDiv = document.getElementById('contact-list');
            if (query.length === 0) {
                listDiv.innerHTML = '<div class="text-center text-gray-500 text-sm mt-8 animate-pulse">Loading contacts...</div>';
                await loadContacts();
                return;
            }

            try {
                listDiv.innerHTML = '<div class="text-center text-gray-500 text-sm mt-8">Searching...</div>';
                const res = await fetch('/api/contacts?query=' + encodeURIComponent(query));
                if (res.ok) {
                    const results = (await res.json()).map(normalizeContactData);
                    await renderContactList(results);
                }
            } catch (err) { console.error(err); }
        }, 300);
    });
}

function appendMessageUI(msg, plainText, plainFileData = null) {
    const area = document.getElementById('messages-area');
    if (!area) return;

    const isMe = msg.sender_id === currentUserId;
    const contactName = document.getElementById('chat-name').innerText;
    const avatarChar = contactName.charAt(0);

    let fileHtml = '';
    if (plainFileData) {
        if (msg.file_type && msg.file_type.startsWith('image/')) {
            fileHtml = `<div class="mt-3 rounded-xl border border-kin_outline_variant/30 overflow-hidden shadow-sm bg-kin_surf_highest"><a href="${plainFileData}" target="_blank"><img src="${plainFileData}" class="max-w-full h-auto cursor-pointer hover:opacity-90 transition-opacity"></a></div>`;
        } else if (msg.file_type && msg.file_type.startsWith('video/')) {
            fileHtml = `<video src="${plainFileData}" controls class="max-w-full mt-3 rounded-xl border border-kin_outline_variant/30 shadow-sm bg-kin_surf_highest"></video>`;
        } else {
            fileHtml = `<a href="${plainFileData}" target="_blank" class="flex items-center gap-3 p-3 bg-kin_surf_highest border border-kin_outline_variant/30 rounded-xl text-xs font-semibold text-kin_on_surface mt-3 hover:bg-kin_surf transition-all shadow-sm">
                <div class="w-8 h-8 rounded-full bg-kin_primary/30 flex items-center justify-center">
                    <span class="material-symbols-outlined text-kin_primary text-xl">attach_file</span>
                </div>
                Encrypted File
            </a>`;
        }
    }

    let repliedHtml = '';
    if (msg.reply_to_id) {
        let repliedText = "Original message";
        let repliedTitle = "Message";
        let repliedMsgEl = document.getElementById(`msg-container-${msg.reply_to_id}`);
        if (repliedMsgEl) {
            if (repliedMsgEl.classList.contains('justify-end')) {
                repliedTitle = "You";
            } else {
                const chatName = document.getElementById('chat-name');
                if (chatName) repliedTitle = chatName.innerText.split(' ')[0];
            }

            let textEl = repliedMsgEl.querySelector('.message-content');
            if (textEl) {
                repliedText = textEl.innerText;
            } else if (repliedMsgEl.querySelector('img') || repliedMsgEl.querySelector('video')) {
                repliedText = "Media Attachment";
            }
        }

        const replyBg = isMe ? 'bg-kin_surf hover:bg-kin_surf_highest w-full' : 'bg-kin_surf_target hover:bg-kin_surf_highest/50 w-full';
        const replyBorder = isMe ? 'border-kin_on_surface/50' : 'border-kin_tertiary';
        const replyLabelText = isMe ? 'text-kin_primary' : 'text-kin_tertiary';
        const replyBodyText = isMe ? 'text-kin_on_surface' : 'text-kin_on_surface_variant';

        repliedHtml = `
        <div class="mb-2 ${replyBg} border-l-4 ${replyBorder} rounded-r-lg p-2 cursor-pointer text-xs ${replyBodyText} truncate transition-colors reply-quote-block font-inter" data-target-id="${msg.reply_to_id}">
            <div class="font-bold text-[10px] ${replyLabelText} mb-0.5">${escapeHtml(repliedTitle)}</div>
            <div class="truncate max-w-full opacity-90">${escapeHtml(repliedText)}</div>
        </div>`;
    }

    let createdAt = msg.created_at;
    if (typeof createdAt === 'string' && !createdAt.includes('Z') && !createdAt.includes('+')) {
        createdAt += 'Z';
    }
    const dateObj = new Date(createdAt);
    const timeStr = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // Render Date Separator
    const dateStr = dateObj.toDateString();
    if (window.lastMessageDateString !== dateStr) {
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);

        let friendlyDate = dateObj.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
        if (dateStr === today.toDateString()) friendlyDate = 'Today';
        else if (dateStr === yesterday.toDateString()) friendlyDate = 'Yesterday';

        const dateHtml = `
        <div class="flex justify-center w-full my-6 date-separator-marker">
            <span class="bg-kin_surf_highest px-4 py-1 rounded-full text-[10px] font-bold text-kin_on_surface_variant tracking-widest uppercase border border-white/5">
                ${friendlyDate}
            </span>
        </div>`;
        area.insertAdjacentHTML('beforeend', dateHtml);
        window.lastMessageDateString = dateStr;
    }

    const canEditOrDelete = isMe && msg.id && (new Date() - dateObj < 3600000);
    const isPending = Boolean(msg.is_pending);
    const isReadByReceipt = window.pendingReadReceipts && window.pendingReadReceipts.has(msg.id);
    const statusIcon = (msg.is_read || isReadByReceipt)
        ? '<span class="material-symbols-outlined text-[14px] text-kin_tertiary" style="font-variation-settings: \'FILL\' 1;">done_all</span>'
        : isPending
            ? getPendingStatusIcon()
            : '<span class="material-symbols-outlined text-[14px] text-slate-500">done</span>';
    
    if (isReadByReceipt) window.pendingReadReceipts.delete(msg.id);

    const html = `
        <div class="flex ${isMe ? 'justify-end' : 'justify-start'} items-end gap-2 md:gap-3 message-container w-full ${!msg.id ? 'optimistic' : ''}"
             id="${msg.id ? `msg-container-${msg.id}` : ''}"
             data-msg-id="${msg.id || ''}"
             data-pending="${isPending}"
             data-created-at="${createdAt}">

            ${!isMe ? `
            <div class="w-8 h-8 rounded-full bg-gradient-to-tr from-kin_primary_container to-kin_primary flex items-center justify-center text-white text-[10px] font-bold shadow-md flex-shrink-0 mb-1 border border-white/5">
                ${window.activeContactData && window.activeContactData.profilePic ? `<img src="${window.activeContactData.profilePic}" class="w-full h-full object-cover rounded-full">` : avatarChar}
            </div>
            ` : ''}

            <div class="max-w-[85%] flex flex-col ${isMe ? 'items-end' : 'items-start'} group relative">
                <div class="message-bubble ${isMe ? 'bg-kin_primary_container bg-gradient-to-br from-kin_primary_container to-kin_primary/40 rounded-2xl rounded-br-sm text-on-primary-container shadow-[0_0_20px_rgba(79,70,229,0.2)]' : 'bg-kin_surf_low rounded-2xl rounded-bl-sm text-on-surface shadow-sm border border-white/5'} px-4 md:px-5 py-2.5 md:py-3 transition-all w-full flex flex-col min-w-0 overflow-hidden relative">
                    ${repliedHtml}
                    <div class="flex flex-col gap-1 w-full relative z-10 break-words">
                        ${plainText ? `<span class="text-sm leading-relaxed message-content whitespace-pre-wrap font-inter font-medium">${escapeHtml(plainText)}</span>` : ''}
                        ${fileHtml}
                    </div>
                </div>

                <div class="flex items-center gap-1.5 mt-1.5 ${isMe ? 'mr-1' : 'ml-1'} relative z-10 opacity-60">
                    ${msg.is_edited ? '<span class="text-[9px] font-bold uppercase tracking-wider">Edited</span>' : ''}
                    <span class="text-[10px] font-inter font-bold tracking-wider uppercase">${timeStr}</span>
                    ${isMe ? `
                    <div class="msg-status-icon flex items-center" data-msg-id="${msg.id || ''}">
                        ${statusIcon}
                    </div>
                    ` : ''}
                </div>

                ${canEditOrDelete ? `
                <div class="absolute ${isMe ? '-left-10' : '-right-10'} top-2 flex flex-col gap-1.5 opacity-0 group-hover:opacity-100 transition-all duration-200 action-buttons">
                    <button class="btn-edit p-2 bg-white/5 hover:bg-white/10 text-slate-400 rounded-full border border-white/5 transition-colors" title="Edit">
                        <span class="material-symbols-outlined text-xs">edit</span>
                    </button>
                </div>
                ` : ''}
            </div>
        </div>
    `;
    area.insertAdjacentHTML('beforeend', html);
    scrollToBottom();
}

function escapeHtml(unsafe) {
    return unsafe
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function scrollToBottom() {
    const area = document.getElementById('messages-area');
    // Adding a slight delay to ensure the DOM has painted the new elements
    setTimeout(() => {
        area.scrollTop = area.scrollHeight;
    }, 50);
}

window.scrollToMessage = function (targetId) {
    console.log('Attempting to scroll to message:', targetId);
    let msgEl = document.getElementById(`msg-container-${targetId}`);
    if (msgEl) {
        msgEl.scrollIntoView({ behavior: 'smooth', block: 'center' });

        // Instantly apply a soft background color with NO layout shifting margins
        msgEl.classList.add('transition-colors', 'duration-500');
        msgEl.style.backgroundColor = 'rgba(129, 140, 248, 0.15)';
        msgEl.style.borderRadius = '8px';

        // Remove it smoothly after 1 second
        setTimeout(() => {
            msgEl.style.backgroundColor = 'transparent';

            setTimeout(() => {
                msgEl.classList.remove('transition-colors', 'duration-500');
                msgEl.style.backgroundColor = '';
                msgEl.style.borderRadius = '';
            }, 500); // wait for fade out to complete
        }, 1000);
    } else {
        console.log('Message element not found in DOM.');
    }
};

window.cancelReply = function () {
    currentReplyToId = null;
    document.getElementById('reply-preview-container').classList.add('hidden');
    document.getElementById('reply-preview-text').innerText = '';
};

window.triggerReplyMode = function (container) {
    if (!container) return;
    let msgId = container.dataset.msgId;
    if (!msgId) return;
    let contentEl = container.querySelector('.message-content');
    let text = contentEl ? contentEl.innerText : "Media Attachment";

    let repliedTitle = "Message";
    if (container.classList.contains('justify-end')) {
        repliedTitle = "You";
    } else {
        const chatName = document.getElementById('chat-name');
        if (chatName) repliedTitle = chatName.innerText.split(' ')[0];
    }

    currentReplyToId = Number(msgId);
    const titleEl = document.getElementById('reply-preview-title');
    if (titleEl) titleEl.innerText = repliedTitle;
    document.getElementById('reply-preview-text').innerText = text;
    document.getElementById('reply-preview-container').classList.remove('hidden');
    document.getElementById('msgInput').focus();
};

function keepActiveChatVisible(forceScroll = false) {
    const activeChat = document.getElementById('active-chat');
    const input = document.getElementById('msgInput');

    if (!activeChat || activeChat.classList.contains('hidden') || !input) {
        return;
    }

    // On mobile, scrollIntoView can sometimes cause the whole body to jump if not handled carefully
    requestAnimationFrame(() => {
        if (forceScroll || document.activeElement === input) {
            // Use a more stable scroll approach for mobile
            const area = document.getElementById('messages-area');
            if (area) {
                area.scrollTop = area.scrollHeight;
            }
        }
    });
}

// Modal functions moved to base.html

// --- Action Menu Modal ---
let activeMenuMsgId = null;
function showActionMenu(msgId) {
    activeMenuMsgId = msgId;
    const modal = document.getElementById('actionMenuModal');
    const content = document.getElementById('actionMenuContent');

    modal.classList.remove('hidden');
    setTimeout(() => {
        modal.classList.remove('opacity-0');
        content.classList.remove('scale-95');
    }, 10);
}

function hideActionMenu() {
    const modal = document.getElementById('actionMenuModal');
    const content = document.getElementById('actionMenuContent');
    modal.classList.add('opacity-0');
    content.classList.add('scale-95');
    setTimeout(() => {
        modal.classList.add('hidden');
        activeMenuMsgId = null;
    }, 200);
}

document.getElementById('menuCancelBtn').addEventListener('click', hideActionMenu);
document.getElementById('menuReplyBtn').addEventListener('click', () => {
    const id = activeMenuMsgId;
    hideActionMenu();
    const container = document.getElementById(`msg-container-${id}`);
    if (container) triggerReplyMode(container);
});
document.getElementById('menuEditBtn').addEventListener('click', () => {
    const id = activeMenuMsgId;
    hideActionMenu();
    startEdit(id);
});
document.getElementById('menuDeleteBtn').addEventListener('click', () => {
    const id = activeMenuMsgId;
    hideActionMenu();
    confirmDelete(id);
});

// --- Message Actions ---
async function startEdit(msgId) {
    if (!msgId) return;
    const container = document.getElementById(`msg-container-${msgId}`);
    if (!container) return;
    const contentEl = container.querySelector('.message-content');
    const oldText = contentEl.innerText;

    const newText = await showModal({
        title: "Edit Message",
        description: "Change your message content:",
        placeholder: "New message content...",
        value: oldText
    });

    if (newText !== null && newText.trim() !== "" && newText !== oldText) {
        try {
            const encryptedPayload = await encryptText(newText, activeSharedKey);
            socket.emit('edit', {
                id: msgId,
                content: encryptedPayload
            });
        } catch (err) { console.error(err); }
    }
}

async function confirmDelete(msgId) {
    if (!msgId) return;
    const result = await showModal({
        title: "Delete Message",
        description: "Are you sure you want to delete this message?"
    });

    if (result) {
        socket.emit('delete', {
            id: msgId
        });
    }
}

async function updateMessageUI(msg) {
    const container = document.getElementById(`msg-container-${msg.id}`);
    if (!container) return;

    const contentEl = container.querySelector('.message-content');
    const flagEl = container.querySelector('.edited-flag');

    const plainText = await decryptText(msg.content, activeSharedKey);
    contentEl.innerText = plainText;
    if (flagEl) flagEl.classList.remove('hidden');
}

function deleteMessageUI(msgId) {
    const container = document.getElementById(`msg-container-${msgId}`);
    if (container) container.remove();
}

async function clearChat() {
    if (!activeContactId) return;
    const result = await showModal({
        title: "Clear Chat",
        description: "Clear your chat history with this contact? (Other user will still see the history)"
    });

    if (result) {
        try {
            const res = await fetch(`/api/messages/clear/${activeContactId}`, { method: 'POST' });
            if (res.ok) {
                document.getElementById('messages-area').innerHTML = '';
            }
        } catch (e) { console.error(e); }
    }
}

function updateActionsVisibility(container, createdAt) {
    const buttons = container.querySelector('.action-buttons');
    if (!buttons) return;

    // Ensure createdAt has a timezone (Z) for UTC parsing if missing
    if (typeof createdAt === 'string' && !createdAt.includes('Z') && !createdAt.includes('+')) {
        createdAt += 'Z';
    }

    const isWithinWindow = new Date() - new Date(createdAt) < 3600000;
    if (isWithinWindow) {
        buttons.classList.remove('hidden');
    } else {
        buttons.classList.add('hidden');
    }
}

// --- Sending Messages ---
let myTypingTimeout = null;
let lastTypingTime = 0;
async function startCall(callType = 'audio') {
    if (!callSignalingEnabled || !isCallSignalingReady) {
        await showModal({
            title: "Calling Unavailable",
            description: "Call signaling is not ready yet. Check Supabase configuration and try again.",
            isAlert: true
        });
        return;
    }

    if (currentCallState !== 'idle') return;

    // Unlock media elements for autoplay policy
    audioEl.play().catch(() => { });
    if (remoteVideoEl) remoteVideoEl.play().catch(() => { });

    const hasMedia = await initLocalStream(callType);
    if (!hasMedia) return;

    currentCallMode = callType === 'video' ? 'video' : 'audio';
    if (currentCallMode === 'video') resetVideoStageLayout();
    createPeerConnection(activeContactId);

    try {
        const callLog = await createCallLog(activeContactId, currentCallMode);
        currentCallLogId = callLog.id;
        currentCallPeerId = activeContactId;
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        socket.emit("webrtc_offer", {
            receiver_id: activeContactId,
            offer,
            call_id: currentCallLogId,
            call_type: currentCallMode
        });
        setCallState('dialing', activeContactId);
    } catch (e) {
        console.error("WebRTC offer error", e);
        cleanupWebRTC();
        hideActiveCallOverlay();
    }
}

const msgInputLine = document.getElementById('msgInput');
if (msgInputLine) {
    msgInputLine.addEventListener('input', () => {
        if (!activeContactId || !socket || !socket.connected) return;
        const now = Date.now();
        if (now - lastTypingTime > 1500) {
            socket.emit('typing', { receiver_id: activeContactId, is_typing: true });
            lastTypingTime = now;
        }

        clearTimeout(myTypingTimeout);
        myTypingTimeout = setTimeout(() => {
            socket.emit('typing', { receiver_id: activeContactId, is_typing: false });
            lastTypingTime = 0;
        }, 2000);
    });
}

document.getElementById('messageForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('msgInput');
    const text = input.value.trim();

    if (!activeContactId) {
        await showModal({ title: "Note", description: "No contact selected.", isAlert: true });
        return;
    }

    if (!activeSharedKey) {
        await showModal({
            title: "Security Check",
            description: "Cannot send secure message. Encryption keys are missing or invalid for this contact.",
            isAlert: true
        });
        return;
    }

    if (!text) return;

    try {
        const encryptedPayload = await encryptText(text, activeSharedKey);
        sendOutgoingMessage({
            receiverId: activeContactId,
            encryptedContent: encryptedPayload,
            previewText: text,
            replyToId: currentReplyToId
        });
        input.value = '';
        input.style.height = 'auto';
        cancelReply();
    } catch (err) {
        console.error("Encryption/Send error:", err);
        alert("An error occurred while encrypting the message.");
    }
});

// --- File Handling (Base64 E2EE) ---
async function handleFileSelection(e) {
    const file = e.target.files[0];
    if (!file || !activeContactId || !activeSharedKey) return;

    const prog = document.getElementById('uploadProgress');
    prog.classList.remove('hidden');

    try {
        const b64Data = await fileToBase64(file);
        // Encrypt the entire Base64 string
        const encryptedFile = await encryptText(b64Data, activeSharedKey);
        sendOutgoingMessage({
            receiverId: activeContactId,
            encryptedFileData: encryptedFile,
            fileType: file.type,
            previewFileData: b64Data
        });

    } catch (err) {
        console.error("File processing error:", err);
        await showModal({ title: "Error", description: "Could not process file for secure transfer.", isAlert: true });
    } finally {
        prog.classList.add('hidden');
        e.target.value = '';
    }
}

async function logout() {
    await fetch('/api/logout', { method: 'POST' });
    sessionStorage.clear();
    localStorage.clear();
    window.location.href = '/login';
}

// Init
    document.addEventListener("DOMContentLoaded", async () => {
    // --- STATE FOR INTERACTIVE HANDLERS ---
    let longPressTimer = null;
    let touchStartX = 0;
    let touchStartY = 0;
    let touchContainer = null;
    let isMouseDown = false;
    let mouseContainer = null;

    // --- 1. ATTACH STATIC UI EVENT LISTENERS IMMEDIATELY ---
    const attachUIListeners = () => {
        const cancelReplyBtn = document.getElementById("cancelReplyBtn");
        if (cancelReplyBtn) cancelReplyBtn.addEventListener("click", cancelReply);

        const logoutBtn = document.getElementById("logoutBtn");
        if (logoutBtn) logoutBtn.addEventListener("click", logout);

        const clearChatBtn = document.getElementById("clearChatBtn");
        if (clearChatBtn) clearChatBtn.addEventListener("click", clearChat);

        const callContactBtn = document.getElementById("callContactBtn");
        if (callContactBtn) {
            callContactBtn.addEventListener("click", async () => {
                await startCall('audio');
            });
        }

        const videoCallBtn = document.getElementById("videoCallBtn");
        if (videoCallBtn) {
            videoCallBtn.addEventListener("click", async () => {
                await startCall('video');
            });
        }

        const sidebarCallsBtn = document.getElementById("sidebarCallsBtn");
        if (sidebarCallsBtn) sidebarCallsBtn.addEventListener("click", openCallHistoryModal);

        const closeCallHistoryBtn = document.getElementById("closeCallHistoryBtn");
        if (closeCallHistoryBtn) closeCallHistoryBtn.addEventListener("click", closeCallHistoryModal);

        const endCallBtn = document.getElementById("endCallBtn");
        if (endCallBtn) {
            endCallBtn.addEventListener("click", () => {
                hideActiveCallOverlay();
                if (currentCallPeerId && socket) socket.emit("webrtc_end", { receiver_id: currentCallPeerId, call_id: currentCallLogId, reason: 'ended' });
                if (currentCallLogId) {
                    patchCallLog('ended', currentCallMode, currentCallLogId).catch(console.error);
                }
                cleanupWebRTC();
                loadCallHistory(activeContactId);
            });
        }

        const muteCallBtn = document.getElementById("muteCallBtn");
        if (muteCallBtn) {
            muteCallBtn.addEventListener("click", (e) => {
                if (localStream) {
                    localStream.getAudioTracks().forEach(t => t.enabled = !t.enabled);
                    const isMuted = !localStream.getAudioTracks()[0].enabled;
                    setMuteButtonState(isMuted);
                }
            });
        }

        const upgradeVideoBtn = document.getElementById("upgradeVideoBtn");
        if (upgradeVideoBtn) {
            upgradeVideoBtn.addEventListener("click", async () => {
                if (!currentCallPeerId || currentCallMode === 'video') return;
                const hasVideo = await initLocalStream('video');
                if (!hasVideo) return;
                resetVideoStageLayout();
                socket.emit("webrtc_upgrade_request", {
                    receiver_id: currentCallPeerId,
                    call_id: currentCallLogId
                });
            });
        }

        if (videoStageMinimizeBtn) {
            videoStageMinimizeBtn.addEventListener("click", async (e) => {
                e.stopPropagation();
                if (!videoCallStageEl) return;
                if (canUsePiP()) {
                    try {
                        await remoteVideoEl.play().catch(() => { });
                        await remoteVideoEl.requestPictureInPicture();
                        hideVideoStage();
                        return;
                    } catch (e) {
                        console.warn("PiP request failed, falling back to compact mode", e);
                    }
                }
                const nextLayout = (videoCallStageEl.dataset.layout === 'compact') ? 'fullscreen' : 'compact';
                setVideoStageLayout(nextLayout);
            });
        }

        if (window.videoStageMaximizeBtn) {
            window.videoStageMaximizeBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                setVideoStageLayout('fullscreen');
            });
        }

        const uploadTrigger = document.getElementById("uploadBtnTrigger");
        if (uploadTrigger) uploadTrigger.addEventListener("click", () => document.getElementById("fileInput")?.click());

        const fileInput = document.getElementById("fileInput");
        if (fileInput) fileInput.addEventListener("change", handleFileSelection);

        const backBtn = document.getElementById("backToSidebarBtn");
        if (backBtn) backBtn.addEventListener("click", handleBackToSidebar);

        const sidebarToggle = document.getElementById("sidebarToggleBtn");
        const sideNavbar = document.getElementById("side-navbar");

        if (sidebarToggle) {
            sidebarToggle.onclick = (e) => {
                e.stopPropagation();
                const width = window.innerWidth;
                if (width < 768) {
                    document.body.classList.toggle('sidebar-open');
                    document.body.classList.remove('sidebar-collapsed');
                } else {
                    const nowCollapsed = document.body.classList.toggle('sidebar-collapsed');
                    localStorage.setItem('isSidebarCollapsed', nowCollapsed);
                    if (width < 1280) syncDynamicView();
                }
            };
        }

        document.addEventListener('click', (e) => {
            if (window.innerWidth < 768 && document.body.classList.contains('sidebar-open')) {
                if (sideNavbar && !sideNavbar.contains(e.target) && sidebarToggle && !sidebarToggle.contains(e.target)) {
                    document.body.classList.remove('sidebar-open');
                }
            }
        });

        window.addEventListener('resize', () => {
            syncDynamicView();
            keepActiveChatVisible(false);
        });

        const msgInput = document.getElementById('msgInput');
        const msgForm = document.getElementById('messageForm');
        if (msgInput) {
            msgInput.addEventListener('focus', () => {
                keepActiveChatVisible(true);
                setTimeout(() => keepActiveChatVisible(true), 250);
            });
            msgInput.addEventListener('input', () => {
                msgInput.style.height = 'auto';
                msgInput.style.height = (msgInput.scrollHeight) + 'px';
            });
            msgInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (msgForm) msgForm.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
                }
            });
        }

        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', () => keepActiveChatVisible(true));
            window.visualViewport.addEventListener('scroll', () => keepActiveChatVisible(false));
        }

        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                if (activeContactId) markChatAsRead(activeContactId);
                syncDynamicView();
            }
        });

        window.addEventListener('focus', () => {
            if (activeContactId) markChatAsRead(activeContactId);
        });

        const messagesArea = document.getElementById("messages-area");
        if (messagesArea) {
            messagesArea.addEventListener("click", handleMessageAreaClick);
            messagesArea.addEventListener("touchstart", handleTouchStart, { passive: true });
            messagesArea.addEventListener("touchmove", handleTouchMove, { passive: true });
            messagesArea.addEventListener("touchend", handleTouchEnd);
            messagesArea.addEventListener("touchcancel", handleTouchEnd);
            messagesArea.addEventListener("mousedown", handleMouseDown);
            messagesArea.addEventListener("mousemove", handleMouseMove);
            messagesArea.addEventListener("mouseup", handleMouseUp);
            messagesArea.addEventListener("mouseleave", handleMouseUp);
            messagesArea.addEventListener("contextmenu", handleContextMenu);
        }

        const chatHeader = document.getElementById('chatHeaderInfo');
        if (chatHeader) chatHeader.addEventListener('click', showContactProfile);

        const closeCPBtn = document.getElementById('closeContactProfileBtn');
        if (closeCPBtn) closeCPBtn.addEventListener('click', closeContactProfile);

        const blockBtn = document.getElementById('blockContactBtn');
        if (blockBtn) blockBtn.addEventListener('click', blockActiveContact);

        const unblockNowBtn = document.getElementById('unblockNowBtn');
        if (unblockNowBtn) unblockNowBtn.addEventListener('click', blockActiveContact);
    };

    // --- INTERACTIVE HANDLERS FOR MESSAGES --- (Swipe, Long Press)
    const handleMessageAreaClick = (e) => {
        const quoteBlock = e.target.closest('.reply-quote-block');
        if (quoteBlock) {
            const targetId = quoteBlock.dataset.targetId;
            if (targetId) window.scrollToMessage(targetId);
            return;
        }
        const editBtn = e.target.closest('.btn-edit');
        const deleteBtn = e.target.closest('.btn-delete');
        if (editBtn || deleteBtn) {
            const container = (editBtn || deleteBtn).closest('.message-container');
            const msgId = container?.dataset.msgId;
            if (msgId) {
                if (editBtn) startEdit(msgId);
                else confirmDelete(msgId);
            }
        }
    };

    const startLongPress = (e) => {
        const container = e.target.closest('.message-container');
        if (!container) return;
        const buttons = container.querySelector('.action-buttons');
        if (!buttons || buttons.classList.contains('hidden')) return;
        const msgId = container.dataset.msgId;
        if (!msgId) return;
        container.classList.add('scale-95', 'opacity-80', 'transition-all');
        longPressTimer = setTimeout(() => {
            showActionMenu(msgId);
            container.classList.remove('scale-95', 'opacity-80');
            longPressTimer = null;
        }, 600);
    };

    const cancelLongPress = (e) => {
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
            const container = e.target.closest('.message-container');
            if (container) container.classList.remove('scale-95', 'opacity-80');
        }
    };

    const handleTouchStart = (e) => {
        const container = e.target.closest('.message-container');
        if (!container || e.target.closest('.reply-quote-block')) return;
        touchStartX = e.changedTouches[0].screenX;
        touchStartY = e.changedTouches[0].screenY;
        touchContainer = container;
        startLongPress(e);
    };

    const handleTouchMove = (e) => {
        cancelLongPress(e);
        if (!touchContainer) return;
        let diffX = e.changedTouches[0].screenX - touchStartX;
        let diffY = e.changedTouches[0].screenY - touchStartY;
        if (Math.abs(diffY) > Math.abs(diffX)) {
            touchContainer.style.transform = '';
            return;
        }
        if (Math.abs(diffX) < 80) touchContainer.style.transform = `translateX(${diffX}px)`;
        if (diffX > 60 || diffX < -60) {
            triggerReplyMode(touchContainer);
            touchContainer.style.transform = '';
            touchContainer = null;
        }
    };

    const handleTouchEnd = (e) => {
        cancelLongPress(e);
        if (touchContainer) {
            touchContainer.style.transform = '';
            touchContainer = null;
        }
    };

    const handleMouseDown = (e) => {
        const container = e.target.closest('.message-container');
        if (container && !e.target.closest('.reply-quote-block')) {
            isMouseDown = true;
            touchStartX = e.clientX;
            mouseContainer = container;
        }
        startLongPress(e);
    };

    const handleMouseMove = (e) => {
        if (longPressTimer) cancelLongPress(e);
        if (!isMouseDown || !mouseContainer) return;
        let diffX = e.clientX - touchStartX;
        if (Math.abs(diffX) < 80) mouseContainer.style.transform = `translateX(${diffX}px)`;
        if (diffX > 60 || diffX < -60) {
            triggerReplyMode(mouseContainer);
            mouseContainer.style.transform = '';
            mouseContainer = null;
            isMouseDown = false;
        }
    };

    const handleMouseUp = (e) => {
        cancelLongPress(e);
        isMouseDown = false;
        if (mouseContainer) {
            mouseContainer.style.transform = '';
            mouseContainer = null;
        }
    };

    const handleContextMenu = (e) => {
        const container = e.target.closest('.message-container');
        if (!container) return;
        const buttons = container.querySelector('.action-buttons');
        if (!buttons || buttons.classList.contains('hidden')) return;
        const msgId = container.dataset.msgId;
        e.preventDefault();
        showActionMenu(msgId);
    };

    attachUIListeners();
    syncDynamicView();

    // --- 2. START ASYNC SERVICES IN PARALLEL ---
    // We launch these in parallel so the UI does not wait on socket setup.

    // Crypto is needed for decryption, but it usually initializes quickly.
    const cryptoPromise = initCrypto().catch(e => console.error("Crypto Error:", e));

    // Notifications don't block anything.
    initDesktopNotifications();

    // Socket setup can fail independently without blocking the rest of the page.
    const realtimePromise = initRealtime().catch(e => console.error("Realtime Error:", e));


    // Search setup is fast.
    setupSearch();

    // Load contacts immediately. We'll wait for crypto inside loadContacts if needed, 
    // but at least we'll clear the "Syncing" message as soon as the fetch completes.
    const contactsPromise = loadContacts().catch(e => console.error("Load Contacts Error:", e));

    // Wait for critical data for session restoration, but don't block the UI.
    Promise.allSettled([cryptoPromise, contactsPromise, realtimePromise]).then(() => {
        // --- 3. RESTORE SESSION ---
        const savedId = localStorage.getItem('activeContactId');
        const savedName = localStorage.getItem('activeContactName');
        const savedPubKey = localStorage.getItem('activeContactPubKey');
        if (savedId && savedName && savedPubKey) {
            const contactEl = document.getElementById('contact-' + savedId);
            if (contactEl) {
                const mobile = contactEl.getAttribute('data-contact-mobile');
                const pic = contactEl.getAttribute('data-contact-pic');
                const bByMe = contactEl.getAttribute('data-contact-blocked-by-me') === 'true';
                const bMe = contactEl.getAttribute('data-contact-blocked-me') === 'true';
                selectUser(Number(savedId), savedName, savedPubKey, mobile, pic, bByMe, bMe);
            } else {
                selectUser(Number(savedId), savedName, savedPubKey);
            }
        } else {
            const activeChat = document.getElementById('active-chat');
            if (activeChat) activeChat.classList.add('hidden');
            const placeholder = document.getElementById('no-chat-selected');
            if (placeholder && window.innerWidth >= 768) placeholder.classList.remove('hidden');
            syncDynamicView(false);
        }
        keepActiveChatVisible(false);
    });
});

function showContactProfile() {
    if (!window.activeContactData) return;
    const data = window.activeContactData;
    const modal = document.getElementById('contactProfileModal');
    const content = document.getElementById('contactProfileModalContent');

    document.getElementById('cpModalName').innerText = data.name;
    document.getElementById('cpModalMobile').innerText = data.mobile || "+1 (555) 000-0000";

    const avatarImg = document.getElementById('cpModalImg');
    const avatarChar = document.getElementById('cpModalChar');
    const avatarBg = document.getElementById('cpModalAvatarBg');

    if (data.profilePic) {
        avatarImg.src = data.profilePic;
        avatarImg.classList.remove('hidden');
        avatarChar.classList.add('hidden');
        if (avatarBg) avatarBg.classList.add('bg-transparent');
    } else {
        avatarImg.classList.add('hidden');
        avatarChar.innerText = data.name.charAt(0);
        avatarChar.classList.remove('hidden');
        if (avatarBg) avatarBg.classList.remove('bg-transparent');
    }

    setContactProfilePresence(getIsUserOnline(data.id));

    // Show Modal
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    setTimeout(() => {
        modal.classList.remove('opacity-0');
        if (content) content.classList.remove('scale-95');
    }, 10);
}

function closeContactProfile() {
    const modal = document.getElementById('contactProfileModal');
    const content = document.getElementById('contactProfileModalContent');
    if (modal) modal.classList.add('opacity-0');
    if (content) content.classList.add('scale-95');
    setTimeout(() => {
        if (modal) {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        }
    }, 200);
}

function resolveContactForCall(userId) {
    const numericUserId = Number(userId);
    if (window.activeContactData && Number(window.activeContactData.id) === numericUserId) {
        return {
            name: window.activeContactData.name,
            profilePic: window.activeContactData.profilePic || null
        };
    }

    const contact = cachedContacts.find((entry) => Number(entry.id) === numericUserId);
    if (contact) {
        return {
            name: `${contact.first_name} ${contact.last_name}`.trim(),
            profilePic: contact.profile_pic || null
        };
    }

    return {
        name: `User ${numericUserId}`,
        profilePic: null
    };
}

function setCallAvatar(imageId, charId, profilePic, name) {
    const avatarImg = document.getElementById(imageId);
    const avatarChar = document.getElementById(charId);
    if (!avatarImg || !avatarChar) return;

    if (profilePic) {
        avatarImg.src = profilePic;
        avatarImg.classList.remove('hidden');
        avatarChar.classList.add('hidden');
    } else {
        avatarImg.classList.add('hidden');
        avatarChar.textContent = (name || 'U').charAt(0).toUpperCase();
        avatarChar.classList.remove('hidden');
    }
}

function setMuteButtonState(isMuted) {
    const muteBtn = document.getElementById('muteCallBtn');
    if (!muteBtn) return;

    muteBtn.title = isMuted ? 'Unmute' : 'Mute';
    muteBtn.setAttribute('aria-pressed', String(isMuted));
    muteBtn.classList.toggle('text-red-400', isMuted);
    muteBtn.classList.toggle('bg-red-500/10', isMuted);
    muteBtn.classList.toggle('text-on-surface', !isMuted);
    muteBtn.classList.toggle('bg-transparent', !isMuted);

    muteBtn.innerHTML = `<span class="material-symbols-outlined">${isMuted ? 'mic_off' : 'mic'}</span>`;
}

function updateCallMediaBadge(mode = 'audio') {
    const badge = document.getElementById('callMediaBadge');
    const incomingLabel = document.getElementById('incomingCallTypeLabel');
    const acceptIcon = document.getElementById('acceptCallIcon');
    const upgradeBtn = document.getElementById('upgradeVideoBtn');
    const normalizedMode = mode === 'video' ? 'video' : 'audio';

    if (badge) {
        badge.textContent = normalizedMode === 'video' ? 'Video' : 'Audio';
    }
    if (incomingLabel) {
        incomingLabel.textContent = normalizedMode === 'video' ? 'Secure Video Call' : 'Secure Voice Call';
    }
    if (acceptIcon) {
        acceptIcon.textContent = normalizedMode === 'video' ? 'videocam' : 'call';
    }
    if (upgradeBtn) {
        const hasVideo = normalizedMode === 'video';
        upgradeBtn.disabled = hasVideo;
        upgradeBtn.classList.toggle('opacity-40', hasVideo);
        upgradeBtn.classList.toggle('cursor-not-allowed', hasVideo);
        upgradeBtn.title = hasVideo ? 'Video enabled' : 'Turn on video';
    }
}

function syncLocalVideoPreview() {
    if (localVideoEl && localStream) {
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack && videoTrack.enabled) {
            localVideoEl.srcObject = localStream;
            localVideoEl.style.transform = "scaleX(-1)"; // Mirror effect for local preview
            localVideoEl.classList.remove('hidden');
            localVideoEl.play().catch(e => console.warn("Local video play blocked", e));
        } else {
            localVideoEl.classList.add('hidden');
            localVideoEl.srcObject = null;
        }
    }
    updateCallMediaBadge(localStream && localStream.getVideoTracks().length > 0 ? 'video' : currentCallMode);
}

function syncRemoteVideoState() {
    const hasRemoteVideo = Boolean(remoteStream && remoteStream.getVideoTracks().length > 0);
    if (remoteVideoPlaceholder) {
        remoteVideoPlaceholder.classList.toggle('hidden', hasRemoteVideo);
    }
    if (document.pictureInPictureElement === remoteVideoEl) {
        return;
    }
    if (hasRemoteVideo || (localStream && localStream.getVideoTracks().length > 0)) {
        showVideoStage();
    } else {
        hideVideoStage();
    }
}

function showVideoStage() {
    if (!videoCallStageEl) return;
    if (document.pictureInPictureElement === remoteVideoEl) return;
    videoCallStageEl.classList.remove('hidden');
    setVideoStageLayout(videoStageLayout || 'fullscreen');
    // When entering full-screen video, show controls briefly then hide.
    if (activeCallOverlayEl && isVideoFullscreenActive()) {
        setVideoControlsVisible(true);
    }
}

function hideVideoStage() {
    if (!videoCallStageEl) return;
    videoCallStageEl.classList.add('hidden');
}

async function createCallLog(receiverId, callType) {
    const response = await fetch('/api/calls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receiver_id: receiverId, call_type: callType })
    });
    const data = await response.json();
    if (!response.ok) {
        throw new Error(data.detail || 'Could not create call log');
    }
    currentCallLogId = data.id;
    return data;
}

async function patchCallLog(status, finalType = currentCallMode, callId = currentCallLogId) {
    if (!callId) return null;
    const response = await fetch(`/api/calls/${callId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, final_call_type: finalType })
    });
    const data = await response.json();
    if (!response.ok) {
        throw new Error(data.detail || 'Could not update call log');
    }
    return data;
}

function formatCallHistoryTime(value) {
    if (!value) return '';
    const date = new Date(value + (String(value).includes('Z') || String(value).includes('+') ? '' : 'Z'));
    return date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function renderCallHistoryItem(call) {
    const otherUserId = Number(call.initiator_id) === currentUserId ? Number(call.receiver_id) : Number(call.initiator_id);
    const contact = resolveContactForCall(otherUserId);
    const direction = Number(call.started_by_id) === currentUserId ? 'Outgoing' : 'Incoming';
    const typeLabel = (call.final_call_type || call.call_type) === 'video' ? 'Video' : 'Audio';
    const durationLabel = call.duration_seconds > 0 ? formatCallTimer(call.duration_seconds) : (call.status || 'initiated');

    return `
        <div class="flex items-center gap-4 rounded-2xl border border-white/5 bg-surface-container-lowest/60 p-4">
            <div class="w-11 h-11 rounded-2xl overflow-hidden bg-indigo-500/10 flex items-center justify-center text-indigo-300 font-bold">
                ${contact.profilePic ? `<img src="${contact.profilePic}" class="w-full h-full object-cover">` : escapeHtml((contact.name || 'U').charAt(0).toUpperCase())}
            </div>
            <div class="min-w-0 flex-1">
                <p class="text-sm font-bold text-on-surface truncate">${escapeHtml(contact.name)}</p>
                <p class="text-[10px] text-on-surface-variant uppercase tracking-widest mt-1">${direction} ${typeLabel} • ${escapeHtml(durationLabel)}</p>
            </div>
            <div class="text-right">
                <p class="text-[10px] text-tertiary font-bold uppercase tracking-widest">${escapeHtml(call.status || 'ended')}</p>
                <p class="text-[10px] text-on-surface-variant mt-1">${escapeHtml(formatCallHistoryTime(call.started_at))}</p>
            </div>
        </div>
    `;
}

async function loadCallHistory(contactId = activeContactId) {
    const listEl = document.getElementById('callHistoryList');
    const subtitleEl = document.getElementById('callHistorySubtitle');
    if (!listEl) return;

    if (subtitleEl) {
        subtitleEl.textContent = contactId
            ? `Recent secure sessions with ${resolveContactForCall(contactId).name}`
            : 'Recent secure sessions across all contacts';
    }

    listEl.innerHTML = '<div class="text-sm text-on-surface-variant text-center py-8">Loading call history...</div>';
    try {
        const response = await fetch(
            contactId ? `/api/calls/history?contact_id=${contactId}` : '/api/calls/history'
        );
        const history = await response.json();
        if (!response.ok) {
            throw new Error(history.detail || 'Could not load call history');
        }
        if (!Array.isArray(history) || history.length === 0) {
            listEl.innerHTML = '<div class="text-sm text-on-surface-variant text-center py-8">No call history yet.</div>';
            return;
        }
        listEl.innerHTML = history.map(renderCallHistoryItem).join('');
    } catch (err) {
        console.error(err);
        listEl.innerHTML = '<div class="text-sm text-red-300 text-center py-8">Could not load call history.</div>';
    }
}

function openCallHistoryModal() {
    const modal = document.getElementById('callHistoryModal');
    const content = document.getElementById('callHistoryModalContent');
    if (!modal || !content) return;
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    setTimeout(() => {
        modal.classList.remove('opacity-0');
        content.classList.remove('scale-95');
    }, 10);
    loadCallHistory(activeContactId);
}

function closeCallHistoryModal() {
    const modal = document.getElementById('callHistoryModal');
    const content = document.getElementById('callHistoryModalContent');
    if (!modal || !content) return;
    modal.classList.add('opacity-0');
    content.classList.add('scale-95');
    setTimeout(() => {
        modal.classList.remove('flex');
        modal.classList.add('hidden');
    }, 200);
}

function clearCallTimer() {
    if (callTimerIntervalId) {
        clearInterval(callTimerIntervalId);
        callTimerIntervalId = null;
    }
    callStartedAt = null;
}

function clearCallRingTimeout() {
    if (callRingTimeoutId) {
        clearTimeout(callRingTimeoutId);
        callRingTimeoutId = null;
    }
}

function formatCallTimer(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function startCallTimer() {
    const timerEl = document.getElementById('activeCallTimer');
    if (!timerEl) return;

    clearCallTimer();
    callStartedAt = Date.now();
    timerEl.innerText = '00:00';
    callTimerIntervalId = setInterval(() => {
        const elapsedSeconds = Math.max(0, Math.floor((Date.now() - callStartedAt) / 1000));
        timerEl.innerText = formatCallTimer(elapsedSeconds);
    }, 1000);
}

function scheduleCallRingTimeout(peerId) {
    clearCallRingTimeout();
    callRingTimeoutId = setTimeout(() => {
        if (currentCallState !== 'dialing' || Number(currentCallPeerId) !== Number(peerId)) {
            return;
        }
        if (socket && socket.connected) {
            socket.emit("webrtc_end", { receiver_id: peerId, call_id: currentCallLogId, reason: "missed" });
        }
        if (currentCallLogId) {
            patchCallLog('missed', currentCallMode, currentCallLogId).catch(console.error);
        }
        cleanupWebRTC();
        hideIncomingCallOverlay();
        hideActiveCallOverlay();
        alert("Call timed out. The other user did not answer.");
    }, 30000);
}

function setCallState(nextState, peerId = currentCallPeerId) {
    currentCallState = nextState;
    currentCallPeerId = peerId;

    if (nextState === 'dialing') {
        showActiveCallOverlay('Calling', peerId);
        scheduleCallRingTimeout(peerId);
        return;
    }

    if (nextState === 'ringing') {
        clearCallRingTimeout();
        return;
    }

    if (nextState === 'connecting') {
        clearCallRingTimeout();
        showActiveCallOverlay('Connecting', peerId);
        return;
    }

    if (nextState === 'live') {
        clearCallRingTimeout();
        showActiveCallOverlay('Live', peerId);
        startCallTimer();
        syncRemoteVideoState();
        return;
    }

    if (nextState === 'idle') {
        clearCallRingTimeout();
        clearCallTimer();
    }
}

function showIncomingCallOverlay(fromUserId, mode = 'audio') {
    const overlay = document.getElementById('incomingCallOverlay');
    const name = document.getElementById('incomingCallerName');
    const contact = resolveContactForCall(fromUserId);

    if (name) name.innerText = contact.name;
    updateCallMediaBadge(mode);
    setCallAvatar('incomingCallAvatarImg', 'incomingCallAvatarChar', contact.profilePic, contact.name);

    overlay.classList.remove('hidden');
    overlay.classList.add('flex');
    setTimeout(() => overlay.classList.remove('opacity-0'), 10);
}

function hideIncomingCallOverlay() {
    const overlay = document.getElementById('incomingCallOverlay');
    overlay.classList.add('opacity-0');
    overlay.classList.remove('flex');
    setTimeout(() => overlay.classList.add('hidden'), 200);
}

function showActiveCallOverlay(status, contactId = activeContactId) {
    const dock = document.getElementById('activeCallOverlay');
    const name = document.getElementById('activeCallName');
    const statusEl = document.getElementById('activeCallStatus');
    const timerEl = document.getElementById('activeCallTimer');
    const contact = resolveContactForCall(contactId);

    if (name) name.innerText = contact.name;
    if (statusEl) statusEl.innerText = status || "Live";
    if (timerEl) {
        timerEl.innerText = status === 'Live' ? '00:00' : status;
    }
    updateCallMediaBadge(currentCallMode);
    setCallAvatar('activeCallAvatarImg', 'activeCallAvatarChar', contact.profilePic, contact.name);

    dock.classList.remove('hidden');
    dock.classList.add('flex');
    setTimeout(() => {
        dock.classList.remove('opacity-0', 'translate-y-4');
    }, 10);
}

function hideActiveCallOverlay() {
    const dock = document.getElementById('activeCallOverlay');
    dock.classList.add('opacity-0', 'translate-y-4');
    dock.classList.remove('flex');
    setTimeout(() => dock.classList.add('hidden'), 300);
    hideVideoStage();
}

async function blockActiveContact() {
    if (!window.activeContactData) return;
    const contactId = window.activeContactData.id;
    const isBlocked = window.activeContactData.blockedByMe;
    const action = isBlocked ? 'unblock' : 'block';

    closeContactProfile();

    const confirmed = await showModal({
        title: `${action.charAt(0).toUpperCase() + action.slice(1)} Contact`,
        description: `Are you sure you want to ${action} ${window.activeContactData.name}?`
    });

    if (confirmed) {
        try {
            const res = await fetch(`/api/contacts/${action}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ blocked_contact_id: contactId })
            });
            if (res.ok) {
                // Optimistic UI Update instantly
                const pContact = getContactById(contactId);
                if (pContact) pContact.blocked_by_me = (action === 'block');

                if (window.activeContactData && window.activeContactData.id === contactId) {
                    window.activeContactData.blockedByMe = (action === 'block');
                    focusAndOpenChat(contactId);
                }

                // Fetch fresh data in background
                loadContacts();

                await showModal({
                    title: "Success",
                    description: `Contact has been ${action}ed successfully.`,
                    isAlert: true
                });
            } else {
                const err = await res.json();
                showModal({
                    title: "Error",
                    description: err.detail || `Failed to ${action} contact.`,
                    isAlert: true
                });
            }
        } catch (e) {
            console.error(e);
            showModal({
                title: "Error",
                description: "An unexpected error occurred.",
                isAlert: true
            });
        }
    }
}
