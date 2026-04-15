(() => {
  function createSocket({ currentUserId, onPresenceIds, signalingSupabaseUrl, signalingSupabaseAnonKey } = {}) {
    let messagePollTimer = null;
    let presencePollTimer = null;
    let messageSyncInFlight = false;
    let hasPrimedSync = false;
    let latestMessageCursor = null;
    let realtimeClient = null;
    let signalingInboundChannel = null;
    const signalingOutboundChannels = new Map();
    const knownMessages = new Map();
    const MESSAGE_SYNC_INTERVALS = {
      visibleFocused: 8000,
      visibleBackground: 15000,
      hidden: 30000,
    };

    const socket = {
      connected: false,
      handlers: {},

      on(eventName, handler) {
        if (!this.handlers[eventName]) {
          this.handlers[eventName] = [];
        }
        this.handlers[eventName].push(handler);
      },

      _dispatch(eventName, payload) {
        const list = this.handlers[eventName] || [];
        for (const handler of list) {
          try {
            handler(payload);
          } catch (err) {
            console.error(`[PollingSocket] Error in handler for ${eventName}:`, err);
          }
        }
      },

      async emit(eventName, payload) {
        if (!this.connected) return;

        try {
          if (eventName === "send") {
            const response = await fetch("/api/messages", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.detail || "Could not send message");

            knownMessages.set(Number(data.id), snapshotMessage(data));
            this._dispatch("receive_message", data);
            scheduleMessageSync(2000);
            return;
          }

          if (eventName === "edit") {
            const response = await fetch(`/api/messages/${payload.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ content: payload.content }),
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.detail || "Could not edit message");

            knownMessages.set(Number(data.id), snapshotMessage(data));
            this._dispatch("edit", data);
            scheduleMessageSync(2000);
            return;
          }

          if (eventName === "delete") {
            const response = await fetch(`/api/messages/${payload.id}`, { method: "DELETE" });
            const data = await response.json();
            if (!response.ok) throw new Error(data.detail || "Could not delete message");

            const existing = knownMessages.get(Number(data.id)) || {};
            knownMessages.set(Number(data.id), { ...existing, is_deleted: true });
            this._dispatch("delete", data);
            scheduleMessageSync(2000);
            return;
          }

          if (eventName === "mark_read") {
            const response = await fetch(`/api/messages/read/${payload.contact_id}`, { method: "POST" });
            const data = await response.json();
            if (!response.ok) throw new Error(data.detail || "Could not mark messages as read");

            if (Array.isArray(data.message_ids)) {
              for (const messageId of data.message_ids) {
                const existing = knownMessages.get(Number(messageId)) || {};
                knownMessages.set(Number(messageId), { ...existing, is_read: true });
              }
            }
            scheduleMessageSync(2000);
            return data;
          }

          if (eventName === "typing" || String(eventName).startsWith("webrtc_")) {
            if (String(eventName).startsWith("webrtc_")) {
              await publishSignalToUser(payload?.receiver_id, eventName, {
                ...payload,
                sender_id: Number(currentUserId),
              });
            }
            return;
          }
        } catch (err) {
          console.error(`[PollingSocket] Emit error for ${eventName}:`, err);
          this._dispatch("error", { message: err?.message || "Operation failed" });
        }
      },

      async connect() {
        if (this.connected) return;
        this.connected = true;
        this._dispatch("connect");

        connectSignaling();
        await refreshPresence();
        await syncMessages();

        presencePollTimer = window.setInterval(refreshPresence, 25000);
        scheduleMessageSync();

        document.addEventListener("visibilitychange", handleActivityStateChange);
        window.addEventListener("focus", handleActivityStateChange);
        window.addEventListener("blur", handleActivityStateChange);
      },

      disconnect() {
        if (messagePollTimer) {
          window.clearTimeout(messagePollTimer);
          messagePollTimer = null;
        }
        if (presencePollTimer) {
          window.clearInterval(presencePollTimer);
          presencePollTimer = null;
        }
        disconnectSignaling();
        document.removeEventListener("visibilitychange", handleActivityStateChange);
        window.removeEventListener("focus", handleActivityStateChange);
        window.removeEventListener("blur", handleActivityStateChange);
        this.connected = false;
        this._dispatch("disconnect");
      }
    };

    function getNextMessageSyncDelay() {
      if (document.visibilityState !== "visible") {
        return MESSAGE_SYNC_INTERVALS.hidden;
      }

      if (document.hasFocus()) {
        return MESSAGE_SYNC_INTERVALS.visibleFocused;
      }

      return MESSAGE_SYNC_INTERVALS.visibleBackground;
    }

    function scheduleMessageSync(delay = getNextMessageSyncDelay()) {
      if (!socket.connected) return;

      if (messagePollTimer) {
        window.clearTimeout(messagePollTimer);
      }

      messagePollTimer = window.setTimeout(() => {
        syncMessages();
      }, delay);
    }

    function handleActivityStateChange() {
      if (!socket.connected) return;
      scheduleMessageSync(1000);
    }

    function connectSignaling() {
      if (!signalingSupabaseUrl || !signalingSupabaseAnonKey || !window.supabase) {
        socket._dispatch("signaling_unavailable", {
          message: "Supabase signaling is not configured.",
        });
        return;
      }

      realtimeClient = window.supabase.createClient(signalingSupabaseUrl, signalingSupabaseAnonKey);
      const inboundName = `user-signal:${currentUserId}`;
      signalingInboundChannel = realtimeClient.channel(inboundName, {
        config: { broadcast: { self: false } },
      });

      [
        "webrtc_offer",
        "webrtc_answer",
        "webrtc_ice_candidate",
        "webrtc_end",
        "webrtc_upgrade_request",
        "webrtc_upgrade_response",
      ].forEach((eventName) => {
        signalingInboundChannel.on("broadcast", { event: eventName }, ({ payload }) => {
          socket._dispatch(eventName, payload);
        });
      });

      signalingInboundChannel.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          socket._dispatch("signaling_ready");
        }
      });
    }

    function disconnectSignaling() {
      if (realtimeClient) {
        realtimeClient.removeAllChannels();
      }
      signalingInboundChannel = null;
      signalingOutboundChannels.clear();
      realtimeClient = null;
    }

    async function publishSignalToUser(userId, eventName, payload) {
      if (!realtimeClient || !userId) {
        throw new Error("Call signaling is not available");
      }

      const channelName = `user-signal:${Number(userId)}`;
      let channel = signalingOutboundChannels.get(channelName);

      if (!channel) {
        channel = realtimeClient.channel(channelName, {
          config: { broadcast: { self: false } },
        });
        signalingOutboundChannels.set(channelName, channel);
        await new Promise((resolve, reject) => {
          channel.subscribe((status) => {
            if (status === "SUBSCRIBED") resolve();
            if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
              reject(new Error("Could not connect signaling channel"));
            }
          });
        });
      }

      const result = await channel.send({
        type: "broadcast",
        event: eventName,
        payload,
      });

      if (result !== "ok") {
        throw new Error("Could not publish signaling event");
      }
    }

    async function refreshPresence() {
      if (!socket.connected) return;

      try {
        const response = await fetch("/api/presence/ping", { method: "POST" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.detail || "Could not refresh presence");

        if (typeof onPresenceIds === "function") {
          onPresenceIds(data.online_user_ids || []);
        }
      } catch (err) {
        console.error("[PollingSocket] Presence refresh failed:", err);
      }
    }

    async function syncMessages() {
      if (!socket.connected || messageSyncInFlight) return;
      messageSyncInFlight = true;

      try {
        const params = new URLSearchParams({ limit: "200" });
        if (latestMessageCursor) {
          params.set("updated_after", latestMessageCursor);
        }

        const response = await fetch(`/api/sync/messages?${params.toString()}`);
        const messages = await response.json();
        if (!response.ok) throw new Error(messages.detail || "Could not sync messages");
        const readReceiptGroups = new Map();
        let nextCursor = latestMessageCursor;

        for (const message of messages) {
          const messageId = Number(message.id);

          const previous = knownMessages.get(messageId);
          const current = snapshotMessage(message);
          nextCursor = maxCursor(nextCursor, current.updated_at);

          if (!hasPrimedSync || !previous) {
            knownMessages.set(messageId, current);
            if (hasPrimedSync && !current.is_deleted) {
              socket._dispatch("receive_message", message);
            }
            continue;
          }

          if (!previous.is_deleted && current.is_deleted) {
            socket._dispatch("delete", {
              id: current.id,
              sender_id: current.sender_id,
              receiver_id: current.receiver_id,
            });
          } else if (
            !current.is_deleted &&
            (previous.content !== current.content || previous.is_edited !== current.is_edited)
          ) {
            socket._dispatch("edit", message);
          }

          if (!previous.is_read && current.is_read && Number(current.sender_id) === Number(currentUserId)) {
            const contactId = Number(current.receiver_id);
            const list = readReceiptGroups.get(contactId) || [];
            list.push(current.id);
            readReceiptGroups.set(contactId, list);
          }

          knownMessages.set(messageId, current);
        }

        for (const [contactId, messageIds] of readReceiptGroups.entries()) {
          socket._dispatch("read_receipt", { contact_id: contactId, message_ids: messageIds });
        }

        latestMessageCursor = nextCursor;
        hasPrimedSync = true;
      } catch (err) {
        console.error("[PollingSocket] Message sync failed:", err);
      } finally {
        messageSyncInFlight = false;
        scheduleMessageSync();
      }
    }

    function snapshotMessage(message) {
      return {
        id: Number(message.id),
        sender_id: Number(message.sender_id),
        receiver_id: Number(message.receiver_id),
        content: message.content || null,
        is_deleted: Boolean(message.is_deleted),
        is_edited: Boolean(message.is_edited),
        is_read: Boolean(message.is_read),
        updated_at: normalizeCursorValue(message.updated_at || message.edited_at || message.created_at),
      };
    }

    function normalizeCursorValue(value) {
      if (!value) return null;
      return String(value).includes("Z") || String(value).includes("+")
        ? String(value)
        : `${value}Z`;
    }

    function maxCursor(left, right) {
      if (!left) return right;
      if (!right) return left;
      return new Date(left) >= new Date(right) ? left : right;
    }

    return socket;
  }

  window.MKChatsRealtime = { createSocket };
})();
