/**
 * Supabase Realtime and Presence integration for MK Chats
 */

function rebuildPresenceDotCache() {
    window.presenceDotCache = new Map();
    document.querySelectorAll('[data-presence-user-id]').forEach((dot) => {
        const userId = Number(dot.getAttribute('data-presence-user-id'));
        if (Number.isNaN(userId)) return;
        if (!window.presenceDotCache.has(userId)) {
            window.presenceDotCache.set(userId, []);
        }
        window.presenceDotCache.get(userId).push(dot);
    });
}

function flushPresenceUi() {
    window.presenceUiFlushRafId = null;
    for (const [userId, isOnline] of window.presenceUiPending.entries()) {
        updatePresenceUI(userId, isOnline);
    }
    window.presenceUiPending.clear();
}

function queuePresenceUiUpdate(userId, isOnline) {
    window.presenceUiPending.set(Number(userId), Boolean(isOnline));
    if (window.presenceUiFlushRafId) return;
    window.presenceUiFlushRafId = window.requestAnimationFrame(flushPresenceUi);
}

function updatePresenceUI(userId, isOnline) {
    const numericUserId = Number(userId);
    const isOnlineBool = Boolean(isOnline);
    
    const dots = (window.presenceDotCache && window.presenceDotCache.get(numericUserId)) || [];
    for (const dot of dots) {
        dot.classList.toggle('bg-kin_tertiary', isOnlineBool);
        dot.classList.toggle('bg-slate-600', !isOnlineBool);
    }

    if (window.cachedContacts) {
        window.cachedContacts = window.cachedContacts.map((contact) => (
            Number(contact.id) === numericUserId ? { ...contact, is_online: isOnlineBool } : contact
        ));
    }
    if (window.temporaryPinnedContact && Number(window.temporaryPinnedContact.id) === numericUserId) {
        window.temporaryPinnedContact = { ...window.temporaryPinnedContact, is_online: isOnlineBool };
    }

    if (window.activeContactId === numericUserId) {
        const statusText = document.getElementById('chat-status-text');
        const statusDot = document.getElementById('chat-status-dot');
        if (statusText && statusDot) {
            if (isOnlineBool) {
                statusText.innerText = 'Online';
                statusText.className = 'text-[10px] text-kin_tertiary font-bold tracking-widest uppercase';
                statusDot.className = 'absolute bottom-0 right-0 w-3 h-3 bg-kin_tertiary border-2 border-surface-container rounded-full transition-all';
            } else {
                statusText.innerText = 'Offline';
                statusText.className = 'text-[10px] text-slate-500 font-bold tracking-widest uppercase';
                statusDot.className = 'absolute bottom-0 right-0 w-3 h-3 bg-slate-600 border-2 border-surface-container rounded-full transition-all';
            }
        }
    }
}

function syncOnlineUsers(nextOnlineUsers) {
    const normalized = new Set([...nextOnlineUsers].map((id) => Number(id)));
    const previous = window.onlineUserIds || new Set();
    
    if (previous.size === normalized.size) {
        let same = true;
        for (const id of previous) {
            if (!normalized.has(id)) { same = false; break; }
        }
        if (same) {
            window.onlineUserIds = normalized;
            return;
        }
    }

    const knownUsers = new Set([...previous, ...normalized]);
    if (window.cachedContacts) {
        window.cachedContacts.forEach((contact) => knownUsers.add(Number(contact.id)));
    }
    if (window.temporaryPinnedContact) knownUsers.add(Number(window.temporaryPinnedContact.id));

    window.onlineUserIds = normalized;
    for (const userId of knownUsers) {
        const isOnline = normalized.has(Number(userId));
        queuePresenceUiUpdate(userId, isOnline);
    }
}

function handlePresenceIds(onlineIds) {
    window.hasPresenceSync = true;
    window.lastPresenceSyncAt = Date.now();
    syncOnlineUsers(new Set((onlineIds || []).map((id) => Number(id))));
}

async function initRealtime(config) {
    if (!window.MKChatsRealtime || typeof window.MKChatsRealtime.createSocket !== 'function') {
        throw new Error('Realtime adapter failed to load.');
    }

    window.socket = window.MKChatsRealtime.createSocket({
        supabaseUrl: config.supabaseUrl,
        supabaseAnonKey: config.supabaseAnonKey,
        currentUserId: config.currentUserId,
        onPresenceIds: handlePresenceIds
    });

    window.socket.on('connect', async () => {
        console.log('Supabase Realtime connected');
        updateCurrentUserPresenceUI(true);
        rebuildPresenceDotCache();
        if (window.activeContactId) {
            await loadMessageHistory(window.activeContactId);
        }
    });

    window.socket.on('error', async (msg) => {
        if (window.showModal) {
            await window.showModal({
                title: "Error",
                description: msg.message,
                isAlert: true
            });
        }
    });

    window.socket.on('typing', (msg) => {
        const senderId = msg.sender_id;
        const previewEl = document.getElementById(`contact-${senderId}-preview`);
        if (previewEl) {
            if (msg.is_typing) {
                if (!previewEl.hasAttribute('data-original-text')) {
                    previewEl.setAttribute('data-original-text', previewEl.innerHTML);
                }
                previewEl.innerHTML = `<div class="flex items-center gap-1"><span class="text-indigo-400 font-semibold opacity-90">typing</span><div class="flex items-center space-x-0.5 mt-1.5"><div class="w-1 h-1 bg-indigo-400 rounded-full animate-bounce" style="animation-delay: 0s"></div><div class="w-1 h-1 bg-indigo-400 rounded-full animate-bounce" style="animation-delay: 0.15s"></div><div class="w-1 h-1 bg-indigo-400 rounded-full animate-bounce" style="animation-delay: 0.3s"></div></div></div>`;
            } else if (previewEl.hasAttribute('data-original-text')) {
                previewEl.innerHTML = previewEl.getAttribute('data-original-text');
                previewEl.removeAttribute('data-original-text');
            }
        }

        if (senderId === window.activeContactId) {
            const messagesArea = document.getElementById('messages-area');
            const typingBubble = document.getElementById('typing-indicator-bubble');

            if (msg.is_typing) {
                if (!typingBubble && messagesArea) {
                    const contactName = document.getElementById('chat-name').innerText;
                    const avatarChar = contactName.charAt(0);
                    const typingHtml = `
                        <div class="flex justify-start items-end gap-2.5 message-container" id="typing-indicator-bubble">
                            <div class="w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-600 flex items-center justify-center text-white text-xs font-bold shadow-md flex-shrink-0 mb-5">
                                ${window.activeContactData && window.activeContactData.profilePic ? `<img src="${window.activeContactData.profilePic}" class="w-full h-full object-cover rounded-full">` : avatarChar}
                            </div>
                            <div class="max-w-[75%] flex flex-col items-start relative">
                                <div class="bg-white text-slate-800 rounded-2xl rounded-tl-sm shadow-sm border border-gray-100 px-4 py-3 transition-all h-[42px] flex items-center justify-center">
                                    <div class="flex items-center space-x-1">
                                        <div class="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style="animation-delay: 0s"></div>
                                        <div class="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style="animation-delay: 0.15s"></div>
                                        <div class="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style="animation-delay: 0.3s"></div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    `;
                    messagesArea.insertAdjacentHTML('beforeend', typingHtml);
                    scrollToBottom();
                }

                clearTimeout(window.windowTypingTimeouts[senderId]);
                window.windowTypingTimeouts[senderId] = setTimeout(() => {
                    const bubble = document.getElementById('typing-indicator-bubble');
                    if (bubble) bubble.remove();
                    if (previewEl && previewEl.hasAttribute('data-original-text')) {
                        previewEl.innerHTML = previewEl.getAttribute('data-original-text');
                        previewEl.removeAttribute('data-original-text');
                    }
                }, 3000);
            } else {
                if (typingBubble) typingBubble.remove();
                clearTimeout(window.windowTypingTimeouts[senderId]);
            }
        }
    });

    window.socket.on('receive_message', async (msg) => {
        if ((msg.sender_id === window.activeContactId && msg.receiver_id === config.currentUserId) ||
            (msg.sender_id === config.currentUserId && msg.receiver_id === window.activeContactId)) {

            let plainText = msg.content;
            if (msg.content) {
                plainText = await decryptText(msg.content, window.activeSharedKey);
            }

            let plainFileData = msg.file_data;
            if (msg.file_data) {
                plainFileData = await decryptText(msg.file_data, window.activeSharedKey);
            }

            if (msg.sender_id === config.currentUserId) {
                const optMsg = typeof findOptimisticMessage === 'function' ? findOptimisticMessage() : null;
                if (optMsg) {
                    optMsg.id = `msg-container-${msg.id}`;
                    optMsg.dataset.msgId = msg.id;
                    optMsg.dataset.pending = 'false';
                    optMsg.classList.remove('optimistic');
                    if (typeof updateActionsVisibility === 'function') updateActionsVisibility(optMsg, msg.created_at);

                    const iconDiv = optMsg.querySelector('.msg-status-icon');
                    if (iconDiv) {
                        iconDiv.innerHTML = msg.is_read
                            ? '<span class="material-symbols-outlined text-sky-500 text-base" style="font-variation-settings: \'FILL\' 1;">done_all</span>'
                            : '<span class="material-symbols-outlined text-gray-400 text-base">done</span>';
                    }
                    if (document.getElementById('contactSearch').value.trim() === '') {
                        loadContacts();
                    }
                    return;
                }
            }

            if (typeof appendMessageUI === 'function') appendMessageUI(msg, plainText, plainFileData);

            if (msg.sender_id === window.activeContactId && msg.sender_id !== config.currentUserId && document.hasFocus()) {
                markChatAsRead(window.activeContactId);
            }
        }
        if (document.getElementById('contactSearch').value.trim() === '') {
            loadContacts();
        }
    });

    window.socket.on('edit', async (msg) => {
        if ((msg.sender_id === window.activeContactId && msg.receiver_id === config.currentUserId) ||
            (msg.sender_id === config.currentUserId && msg.receiver_id === window.activeContactId)) {
            if (typeof updateMessageUI === 'function') await updateMessageUI(msg);
        }
        if (document.getElementById('contactSearch').value.trim() === '') {
            loadContacts();
        }
    });

    window.socket.on('delete', (msg) => {
        if ((msg.sender_id === window.activeContactId && msg.receiver_id === config.currentUserId) ||
            (msg.sender_id === config.currentUserId && msg.receiver_id === window.activeContactId)) {
            if (typeof deleteMessageUI === 'function') deleteMessageUI(msg.id);
        }
        if (document.getElementById('contactSearch').value.trim() === '') {
            loadContacts();
        }
    });

    window.socket.on('read_receipt', (msg) => {
        if (!window.pendingReadReceipts) window.pendingReadReceipts = new Set();
        msg.message_ids.forEach((id) => {
            const container = document.getElementById(`msg-container-${id}`);
            if (container) {
                const iconDiv = container.querySelector('.msg-status-icon');
                if (iconDiv) {
                    iconDiv.innerHTML = '<span class="material-symbols-outlined text-sky-500 text-base" style="font-variation-settings: \'FILL\' 1;">done_all</span>';
                }
            } else {
                window.pendingReadReceipts.add(id);
            }
        });
    });

    window.socket.on('disconnect', () => {
        console.log("Supabase Realtime disconnected");
        updateCurrentUserPresenceUI(false);
    });

    await window.socket.connect();
}

function markChatAsRead(contactId) {
    if (window.socket && window.socket.connected) {
        window.socket.emit('mark_read', { contact_id: contactId });
        const contactEl = document.getElementById('contact-' + contactId);
        if (contactEl) {
            const badge = contactEl.querySelector('.bg-sky-500');
            if (badge) badge.remove();
        }
    }
}
