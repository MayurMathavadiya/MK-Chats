/**
 * WebRTC and Call logic for MK Chats
 */

let peerConnection = null;
let localStream = null;
let remoteStream = null;
let currentCallLogId = null;
let currentCallMode = 'audio';
let pendingIncomingOffer = null;
let pendingUpgradeRequest = null;
let videoStageLayout = 'fullscreen';
let videoControlsAutoHideTimeoutId = null;

// Add audio element to DOM for remote stream
const audioEl = document.createElement("audio");
audioEl.autoplay = true;
document.body.appendChild(audioEl);

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
        try { document.exitPictureInPicture().catch(() => { }); } catch (e) { }
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
    const remoteVideoEl = document.getElementById("remoteVideoEl");
    const localVideoEl = document.getElementById("localVideoEl");
    if (remoteVideoEl) remoteVideoEl.srcObject = null;
    if (localVideoEl) localVideoEl.srcObject = null;
    hideVideoStage();
    setMuteButtonState(false);
    clearCallTimer();
    clearCallRingTimeout();
    window.currentCallState = 'idle';
    window.currentCallPeerId = null;
    currentCallMode = 'audio';
}

function createPeerConnection(peerId) {
    if (peerConnection) return;
    peerConnection = new RTCPeerConnection(rtcConfig);

    peerConnection.onicecandidate = (event) => {
        if (event.candidate && socket) {
            socket.emit("webrtc_candidate", {
                receiver_id: peerId,
                candidate: event.candidate
            });
        }
    };

    peerConnection.ontrack = (event) => {
        if (!remoteStream) remoteStream = new MediaStream();
        event.streams[0].getTracks().forEach(track => remoteStream.addTrack(track));
        
        const remoteVideoEl = document.getElementById("remoteVideoEl");
        if (event.track.kind === 'video') {
            if (remoteVideoEl) {
                remoteVideoEl.srcObject = remoteStream;
                syncRemoteVideoState();
                showVideoStage();
            }
        } else if (event.track.kind === 'audio') {
            audioEl.srcObject = remoteStream;
        }
    };

    if (localStream) {
        localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
    }
}

async function startCall(callType = 'audio') {
    if (!window.activeContactId || !socket || window.currentCallState !== 'idle') return;

    const hasMedia = await initLocalStream(callType);
    if (!hasMedia) return;

    currentCallMode = callType === 'video' ? 'video' : 'audio';
    if (currentCallMode === 'video') resetVideoStageLayout();
    createPeerConnection(window.activeContactId);

    try {
        const callLog = await createCallLog(window.activeContactId, currentCallMode);
        currentCallLogId = callLog.id;
        window.currentCallPeerId = window.activeContactId;
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        socket.emit("webrtc_offer", {
            receiver_id: window.activeContactId,
            offer,
            call_id: currentCallLogId,
            call_type: currentCallMode
        });
        setCallState('dialing', window.activeContactId);
    } catch (e) {
        console.error("WebRTC offer error", e);
        cleanupWebRTC();
        hideActiveCallOverlay();
    }
}

function setupWebRTCSocketListeners() {
    if (!socket) return;

    socket.on("webrtc_offer", async (data) => {
        if (window.currentCallState !== 'idle') {
            socket.emit("webrtc_reject", { receiver_id: data.sender_id, reason: 'busy' });
            return;
        }
        pendingIncomingOffer = data;
        currentCallMode = data.call_type || 'audio';
        setCallState('incoming', data.sender_id);
    });

    socket.on("webrtc_answer", async (data) => {
        if (peerConnection) {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
            setCallState('live');
            startCallTimer();
        }
    });

    socket.on("webrtc_candidate", async (data) => {
        if (peerConnection) {
            try {
                await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
            } catch (e) { console.error("Error adding candidate", e); }
        }
    });

    socket.on("webrtc_reject", (data) => {
        cleanupWebRTC();
        hideActiveCallOverlay();
        hideIncomingCallOverlay();
        if (data.reason === 'busy') {
            showModal({ title: "Call Failed", description: "Contact is busy in another call.", isAlert: true });
        }
    });

    socket.on("webrtc_end", (data) => {
        cleanupWebRTC();
        hideActiveCallOverlay();
        hideIncomingCallOverlay();
    });

    socket.on("webrtc_upgrade_request", (data) => {
        if (window.currentCallState !== 'live' || currentCallMode === 'video') return;
        pendingUpgradeRequest = data;
        showModal({
            title: "Switch to Video",
            description: "Incoming request to switch to video call."
        }).then(async (result) => {
            if (result) {
                const hasVideo = await initLocalStream('video');
                if (hasVideo) {
                    resetVideoStageLayout();
                    socket.emit("webrtc_upgrade_accept", { receiver_id: data.sender_id, call_id: data.call_id });
                    currentCallMode = 'video';
                    syncLocalVideoPreview();
                    syncRemoteVideoState();
                    updateCallMediaBadge('video');
                }
            }
        });
    });

    socket.on("webrtc_upgrade_accept", (data) => {
        currentCallMode = 'video';
        syncLocalVideoPreview();
        syncRemoteVideoState();
        updateCallMediaBadge('video');
        showVideoStage();
    });
}

// Call UI Helpers
let callTimerInterval = null;
let callStartTime = null;

function startCallTimer() {
    clearCallTimer();
    callStartTime = Date.now();
    callTimerInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - callStartTime) / 1000);
        const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
        const secs = String(elapsed % 60).padStart(2, '0');
        const timerEl = document.getElementById('activeCallTimer');
        if (timerEl) timerEl.innerText = `${mins}:${secs}`;
    }, 1000);
}

function clearCallTimer() {
    if (callTimerInterval) clearInterval(callTimerInterval);
    callTimerInterval = null;
}

function clearCallRingTimeout() {
    // Implement if ring timeout is needed
}

async function createCallLog(receiverId, callType) {
    const res = await fetch('/api/calls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receiver_id: receiverId, call_type: callType })
    });
    return await res.json();
}

async function patchCallLog(status, callType, callId) {
    await fetch(`/api/calls/${callId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, call_type: callType })
    });
}

function syncLocalVideoPreview() {
    const localVideoEl = document.getElementById("localVideoEl");
    if (localVideoEl && localStream) {
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack && videoTrack.enabled) {
            localVideoEl.srcObject = localStream;
            localVideoEl.classList.remove('hidden');
        } else {
            localVideoEl.classList.add('hidden');
        }
    }
}

function syncRemoteVideoState() {
    const remoteVideoPlaceholder = document.getElementById("remoteVideoPlaceholder");
    if (!remoteVideoPlaceholder) return;
    const hasVideo = remoteStream && remoteStream.getVideoTracks().some(t => t.readyState === 'live');
    remoteVideoPlaceholder.classList.toggle('hidden', hasVideo);
}

function updateCallMediaBadge(mode) {
    const badge = document.getElementById("callMediaBadge");
    if (badge) badge.innerText = mode === 'video' ? 'Video' : 'Audio';
}

function resetVideoStageLayout() {
    const stage = document.getElementById("videoCallStage");
    if (stage) stage.dataset.layout = 'fullscreen';
}

function setVideoStageLayout(layout) {
    const stage = document.getElementById("videoCallStage");
    if (stage) stage.dataset.layout = layout;
}

function hideVideoStage() {
    const stage = document.getElementById("videoCallStage");
    if (stage) stage.classList.add('hidden');
}

function showVideoStage() {
    const stage = document.getElementById("videoCallStage");
    if (stage) stage.classList.remove('hidden');
}

function setMuteButtonState(isMuted) {
    const btn = document.getElementById("muteCallBtn");
    if (btn) {
        const icon = btn.querySelector('.material-symbols-outlined');
        if (icon) icon.innerText = isMuted ? 'mic_off' : 'mic';
        btn.classList.toggle('bg-red-500/20', isMuted);
        btn.classList.toggle('text-red-500', isMuted);
    }
}
