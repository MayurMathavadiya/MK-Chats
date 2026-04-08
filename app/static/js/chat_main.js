/**
 * Core Chat Business Logic for MK Chats
 */

// Global State
window.activeContactId = null;
window.activeSharedKey = null;
window.myPrivateKey = null;
window.cachedContacts = [];
window.temporaryPinnedContact = null;
window.activeHistoryLoadToken = 0;
window.lastMessageDateString = null;
window.pendingReadReceipts = new Set();
window.windowTypingTimeouts = {};
window.hasPresenceSync = false;
window.lastPresenceSyncAt = 0;
window.onlineUserIds = new Set();
window.presenceUiPending = new Map();
window.presenceUiFlushRafId = null;
window.presenceDotCache = new Map();

// Constants
const STITCH_COLORS = ["indigo", "purple", "rose", "amber", "teal", "emerald"];

async function initCrypto(config) {
    if (!config.userEncryptedDek || !config.userKeysSalt) return;
    const password = sessionStorage.getItem('mk_vault_key');
    if (!password) {
        console.warn("Vault key dummy check failed. Redirecting to login.");
        window.location.href = '/login';
        return;
    }
    window.myPrivateKey = await importPrivateKeys(
        config.userEncryptedDek,
        config.userDekIv,
        config.userKeysSalt,
        password
    );
}

async function selectUser(id, name, pubKeyB64, mobile = null, profilePic = null, blockedByMe = false, blockedMe = false) {
    window.activeContactId = id;
    syncDynamicView(true);

    document.getElementById('chat-name').innerText = name;
    document.getElementById('callContactBtn').classList.remove('hidden');
    document.getElementById('videoCallBtn').classList.remove('hidden');

    const avatarImg = document.getElementById('chat-avatar-img');
    const avatarChar = document.getElementById('chat-avatar-char');
    if (profilePic) {
        avatarImg.src = profilePic;
        avatarImg.classList.remove('hidden');
        avatarChar.classList.add('hidden');
    } else {
        avatarImg.src = "";
        avatarImg.classList.add('hidden');
        avatarChar.innerText = name.charAt(0);
        avatarChar.classList.remove('hidden');
    }

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
    const contactDot = document.querySelector(`.status-dot-user-${id}`);
    const isOnline = window.hasPresenceSync ? window.onlineUserIds.has(Number(id)) : (contactDot && contactDot.classList.contains('bg-kin_tertiary'));

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

    updateActiveContactHighlight(id);
    localStorage.setItem('activeContactId', id);

    try {
        if (pubKeyB64 && pubKeyB64 !== "null") {
            let contactPubKey = await importContactPublicKey(pubKeyB64);
            window.activeSharedKey = await deriveSharedSecret(window.myPrivateKey, contactPubKey);
        } else {
            window.activeSharedKey = null;
        }
    } catch (e) { console.error("Key derivation failed", e); }

    await loadMessageHistory(id);
}

async function loadMessageHistory(contactId) {
    const loadToken = ++window.activeHistoryLoadToken;
    const messagesArea = document.getElementById('messages-area');
    messagesArea.innerHTML = '<div class="text-center text-gray-500 text-sm mt-4">Loading history...</div>';

    try {
        const res = await fetch('/api/messages/' + contactId);
        const history = await res.json();

        if (loadToken !== window.activeHistoryLoadToken || Number(contactId) !== Number(window.activeContactId)) {
            return;
        }

        messagesArea.innerHTML = '';
        window.lastMessageDateString = null;

        for (let msg of history) {
            let plainText = msg.content;
            if (msg.content && window.activeSharedKey) {
                plainText = await decryptText(msg.content, window.activeSharedKey);
            }
            let plainFileData = msg.file_data;
            if (msg.file_data && window.activeSharedKey) {
                plainFileData = await decryptText(msg.file_data, window.activeSharedKey);
            }
            appendMessageUI(msg, plainText, plainFileData);
        }

        scrollToBottom();
        markChatAsRead(contactId);
    } catch (e) {
        console.error(e);
        if (loadToken === window.activeHistoryLoadToken) {
            messagesArea.innerHTML = '';
        }
    }
}

async function loadContacts() {
    try {
        const res = await fetch('/api/contacts');
        if (res.ok) {
            const contacts = (await res.json()).map(normalizeContactData);
            window.cachedContacts = contacts;
            if (window.temporaryPinnedContact && window.cachedContacts.some((c) => Number(c.id) === Number(window.temporaryPinnedContact.id))) {
                window.temporaryPinnedContact = null;
            }
            await renderContactList(window.cachedContacts);
        }
    } catch (e) { console.error("Error loading contacts", e); }
}

function normalizeContactData(contact) {
    if (!contact) return null;
    const contactId = Number(contact.id);
    return {
        ...contact,
        id: contactId,
        unread_count: Number(contact.unread_count || 0),
        is_online: window.hasPresenceSync ? window.onlineUserIds.has(contactId) : Boolean(contact.is_online),
    };
}

function getRenderedContacts(contactsArray) {
    const normalizedContacts = (contactsArray || []).map(normalizeContactData);
    if (!window.temporaryPinnedContact) return normalizedContacts;
    const pinnedId = Number(window.temporaryPinnedContact.id);
    if (normalizedContacts.some((c) => Number(c.id) === pinnedId)) return normalizedContacts;
    return [normalizeContactData(window.temporaryPinnedContact), ...normalizedContacts];
}

async function renderContactList(contactsArray) {
    const listDiv = document.getElementById('contact-list');
    listDiv.innerHTML = '';
    const contactsToRender = getRenderedContacts(contactsArray);

    if (!contactsToRender || contactsToRender.length === 0) {
        listDiv.innerHTML = '<div class="text-center font-inter text-kin_on_surface_variant text-xs mt-8">No contacts found</div>';
        return;
    }

    for (let contact of contactsToRender) {
        let lastMsgText = "Click to start chatting";
        let timeStr = "";

        if (contact.last_message) {
            try {
                let contactPubKey = await importContactPublicKey(contact.public_key);
                let tempSharedKey = await deriveSharedSecret(window.myPrivateKey, contactPubKey);
                let plain = await decryptText(contact.last_message, tempSharedKey);
                lastMsgText = plain ? plain : (contact.last_message.includes(':') ? "Secure message" : "Encrypted media");
            } catch (e) { lastMsgText = "Encrypted message"; }
        }

        if (contact.last_message_at) {
            let d = new Date(contact.last_message_at + (contact.last_message_at.endsWith('Z') ? '' : 'Z'));
            timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }

        const isOnline = Boolean(contact.is_online);
        const nameSafely = escapeHtml(contact.first_name) + ' ' + escapeHtml(contact.last_name);
        const highlightClasses = (window.activeContactId === contact.id && window.innerWidth >= 1280)
            ? 'bg-kin_primary/10 border-l-4 border-kin_primary'
            : 'hover:bg-white/5 border-l-4 border-transparent';

        const html = `
        <div id="contact-${contact.id}" data-contact-id="${contact.id}" data-contact-name="${nameSafely}"
            data-contact-first-name="${escapeHtml(contact.first_name)}" data-contact-last-name="${escapeHtml(contact.last_name)}"
            data-contact-pubkey="${contact.public_key}" data-contact-mobile="${escapeHtml(contact.mobile_number)}"
            data-contact-pic="${contact.profile_pic || ""}" data-contact-blocked-by-me="${contact.blocked_by_me}"
            data-contact-blocked-me="${contact.blocked_me}"
            class="contact-item group flex items-center gap-4 p-4 md:px-6 cursor-pointer transition-all rounded-2xl mx-1 ${highlightClasses}">
            <div class="relative flex-shrink-0">
                <div class="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-lg overflow-hidden bg-gradient-to-tr from-kin_primary_container to-kin_primary shadow-sm">
                    ${contact.profile_pic ? `<img src="${contact.profile_pic}" class="w-full h-full object-cover">` : escapeHtml(contact.first_name).charAt(0)}
                </div>
                <div data-presence-user-id="${contact.id}" class="status-dot-user-${contact.id} absolute bottom-0 right-0 w-3.5 h-3.5 ${isOnline ? 'bg-kin_tertiary' : 'bg-slate-600'} border-2 border-surface-container-lowest rounded-full transition-all"></div>
            </div>
            <div class="flex-1 text-left min-w-0">
                <div class="flex justify-between items-baseline mb-0.5 w-full">
                    <span class="font-bold text-on-surface truncate tracking-tight flex-1 min-w-0 pr-4">${nameSafely}</span>
                    <span class="text-[10px] time-stamp shrink-0 whitespace-nowrap ${ (window.activeContactId === contact.id && window.innerWidth >= 1280) ? 'text-kin_primary' : 'text-slate-500'} font-bold">${timeStr}</span>
                </div>
                <div class="flex justify-between items-center">
                    <p class="text-xs text-on-surface-variant truncate pr-2 opacity-80" id="contact-${contact.id}-preview">${escapeHtml(lastMsgText)}</p>
                    ${contact.unread_count > 0 ? `<div class="w-5 h-5 bg-kin_primary rounded-full flex items-center justify-center shadow-lg shadow-kin_primary/20 flex-shrink-0"><span class="text-[10px] font-bold text-white">${contact.unread_count}</span></div>` : ''}
                </div>
            </div>
        </div>`;
        listDiv.insertAdjacentHTML('beforeend', html);
    }
    rebuildPresenceDotCache();
}

/**
 * Message UI Appending and Management
 */
function appendMessageUI(msg, plainText, plainFileData = null) {
    const area = document.getElementById('messages-area');
    if (!area) return;

    const currentUserId = Number(document.getElementById('supabase-config').dataset.userId);
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
                <div class="w-8 h-8 rounded-full bg-kin_primary/30 flex items-center justify-center"><span class="material-symbols-outlined text-kin_primary text-xl">attach_file</span></div>
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
            repliedTitle = repliedMsgEl.classList.contains('justify-end') ? "You" : document.getElementById('chat-name').innerText.split(' ')[0];
            let textEl = repliedMsgEl.querySelector('.message-content');
            repliedText = textEl ? textEl.innerText : (repliedMsgEl.querySelector('img') || repliedMsgEl.querySelector('video') ? "Media Attachment" : "Original message");
        }
        const replyBg = isMe ? 'bg-kin_surf hover:bg-kin_surf_highest w-full' : 'bg-kin_surf_target hover:bg-kin_surf_highest/50 w-full';
        const replyBorder = isMe ? 'border-kin_on_surface/50' : 'border-kin_tertiary';
        repliedHtml = `
        <div class="mb-2 ${replyBg} border-l-4 ${replyBorder} rounded-r-lg p-2 cursor-pointer text-xs truncate transition-colors reply-quote-block font-inter" onclick="scrollToMessage(${msg.reply_to_id})">
            <div class="font-bold text-[10px] mb-0.5">${escapeHtml(repliedTitle)}</div>
            <div class="truncate max-w-full opacity-90">${escapeHtml(repliedText)}</div>
        </div>`;
    }

    let createdAt = msg.created_at;
    if (typeof createdAt === 'string' && !createdAt.includes('Z') && !createdAt.includes('+')) createdAt += 'Z';
    const dateObj = new Date(createdAt);
    const timeStr = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const dateStr = dateObj.toDateString();
    if (window.lastMessageDateString !== dateStr) {
        const today = new Date();
        const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
        let friendlyDate = dateObj.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
        if (dateStr === today.toDateString()) friendlyDate = 'Today';
        else if (dateStr === yesterday.toDateString()) friendlyDate = 'Yesterday';
        area.insertAdjacentHTML('beforeend', `<div class="flex justify-center w-full my-6"><span class="bg-kin_surf_highest px-4 py-1 rounded-full text-[10px] font-bold text-kin_on_surface_variant tracking-widest uppercase border border-white/5">${friendlyDate}</span></div>`);
        window.lastMessageDateString = dateStr;
    }

    const isPending = Boolean(msg.is_pending);
    const statusIcon = msg.is_read ? '<span class="material-symbols-outlined text-[14px] text-kin_tertiary" style="font-variation-settings: \'FILL\' 1;">done_all</span>' : (isPending ? '<span class="material-symbols-outlined text-[14px] text-slate-500 animate-spin">refresh</span>' : '<span class="material-symbols-outlined text-[14px] text-slate-500">done</span>');

    const html = `
        <div class="flex ${isMe ? 'justify-end' : 'justify-start'} items-end gap-2 md:gap-3 message-container w-full" id="msg-container-${msg.id || 'pending'}" data-msg-id="${msg.id || ''}">
            ${!isMe ? `<div class="w-8 h-8 rounded-full bg-gradient-to-tr from-kin_primary_container to-kin_primary flex items-center justify-center text-white text-[10px] font-bold shadow-md flex-shrink-0 mb-1 border border-white/5">${window.activeContactData && window.activeContactData.profilePic ? `<img src="${window.activeContactData.profilePic}" class="w-full h-full object-cover rounded-full">` : avatarChar}</div>` : ''}
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
                    ${isMe ? `<div class="msg-status-icon flex items-center">${statusIcon}</div>` : ''}
                </div>
            </div>
        </div>`;
    area.insertAdjacentHTML('beforeend', html);
    scrollToBottom();
}

window.initializeApp = async function(config) {
    await initCrypto(config);
    await initRealtime(config);
    setupSearch();
    await loadContacts();
    setupWebRTCSocketListeners();

    // Mark read when returning to tab
    window.addEventListener('focus', () => {
        if (window.activeContactId) {
            markChatAsRead(window.activeContactId);
        }
    });

    // Sidebar Toggles
    const toggleSidebar = () => {
        const isCollapsed = document.body.classList.toggle('sidebar-collapsed');
        localStorage.setItem('isSidebarCollapsed', isCollapsed);
    };
    document.getElementById('sidebar-toggle')?.addEventListener('click', toggleSidebar);
    document.getElementById('mobile-sidebar-toggle')?.addEventListener('click', toggleSidebar);

    // Profile Modals
    document.getElementById('profile-btn')?.addEventListener('click', openProfileModal);
    document.getElementById('closeProfileBtn')?.addEventListener('click', closeProfileModal);
    document.getElementById('profileModal')?.addEventListener('click', (e) => {
        if (e.target.id === 'profileModal') closeProfileModal();
    });

    // Chat Actions
    document.getElementById("logoutBtn")?.addEventListener("click", logout);
    document.getElementById("clearChatBtn")?.addEventListener("click", clearChat);
    document.getElementById("callContactBtn")?.addEventListener("click", () => startCall('audio'));
    document.getElementById("videoCallBtn")?.addEventListener("click", () => startCall('video'));
    document.getElementById("sidebarCallsBtn")?.addEventListener("click", () => {
        // Implement openCallHistoryModal if needed or link to dynamic loading
    });

    document.getElementById("endCallBtn")?.addEventListener("click", () => {
        hideActiveCallOverlay();
        if (window.currentCallPeerId && socket) {
            socket.emit("webrtc_end", { receiver_id: window.currentCallPeerId, call_id: window.currentCallLogId, reason: 'ended' });
        }
        if (window.currentCallLogId) {
            patchCallLog('ended', window.currentCallMode, window.currentCallLogId).catch(console.error);
        }
        cleanupWebRTC();
    });

    document.getElementById("muteCallBtn")?.addEventListener("click", () => {
        if (localStream) {
            localStream.getAudioTracks().forEach(t => t.enabled = !t.enabled);
            setMuteButtonState(!localStream.getAudioTracks()[0].enabled);
        }
    });

    document.getElementById("upgradeVideoBtn")?.addEventListener("click", async () => {
        if (!window.currentCallPeerId || window.currentCallMode === 'video') return;
        const hasVideo = await initLocalStream('video');
        if (!hasVideo) return;
        resetVideoStageLayout();
        socket.emit("webrtc_upgrade_request", {
            receiver_id: window.currentCallPeerId,
            call_id: window.currentCallLogId
        });
    });

    // File Input
    document.getElementById('fileInput')?.addEventListener('change', handleFileSelection);

    // Sync view initially
    syncDynamicView();
    window.addEventListener('resize', () => syncDynamicView());
};
