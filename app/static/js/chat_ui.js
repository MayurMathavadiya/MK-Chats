/**
 * UI helper functions for MK Chats
 */

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

function syncDynamicView(isChatActive = null) {
    const width = window.innerWidth;
    const isMobile = width < 768;
    const isTablet = width >= 768 && width < 1280;

    if (isChatActive === null) {
        isChatActive = !!window.activeContactId;
    }

    if (isChatActive) {
        document.body.classList.add('chat-active');
    } else {
        document.body.classList.remove('chat-active');
    }

    if (isMobile) {
        document.body.classList.remove('sidebar-collapsed');
    } else {
        const savedState = localStorage.getItem('isSidebarCollapsed');
        const shouldCollapse = savedState !== null ? (savedState === 'true') : isTablet;
        if (shouldCollapse) {
            document.body.classList.add('sidebar-collapsed');
        } else {
            document.body.classList.remove('sidebar-collapsed');
        }
    }

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

function scrollToBottom() {
    const area = document.getElementById('messages-area');
    setTimeout(() => {
        if (area) area.scrollTop = area.scrollHeight;
    }, 50);
}

window.scrollToMessage = function (targetId) {
    let msgEl = document.getElementById(`msg-container-${targetId}`);
    if (msgEl) {
        msgEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        msgEl.classList.add('transition-colors', 'duration-500');
        msgEl.style.backgroundColor = 'rgba(129, 140, 248, 0.15)';
        msgEl.style.borderRadius = '8px';
        setTimeout(() => {
            msgEl.style.backgroundColor = 'transparent';
            setTimeout(() => {
                msgEl.classList.remove('transition-colors', 'duration-500');
                msgEl.style.backgroundColor = '';
                msgEl.style.borderRadius = '';
            }, 500);
        }, 1000);
    }
};

function escapeHtml(unsafe) {
    if (!unsafe) return "";
    return unsafe
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function showActionMenu(msgId) {
    window.activeMenuMsgId = msgId;
    const modal = document.getElementById('actionMenuModal');
    const content = document.getElementById('actionMenuContent');
    if (!modal || !content) return;

    modal.classList.remove('hidden');
    setTimeout(() => {
        modal.classList.remove('opacity-0');
        content.classList.remove('scale-95');
    }, 10);
}

function hideActionMenu() {
    const modal = document.getElementById('actionMenuModal');
    const content = document.getElementById('actionMenuContent');
    if (!modal || !content) return;
    modal.classList.add('opacity-0');
    content.classList.add('scale-95');
    setTimeout(() => {
        modal.classList.add('hidden');
        window.activeMenuMsgId = null;
    }, 200);
}

function setCallState(state, peerId = null) {
    window.currentCallState = state;
    if (peerId) window.currentCallPeerId = peerId;
    updateActiveCallOverlay();
}
