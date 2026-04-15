(() => {
  function createSocket({ supabaseUrl, supabaseAnonKey, currentUserId, onPresenceIds } = {}) {
    let realtimeClient = null;
    let inboundChannel = null;
    let presenceChannel = null;
    const outboundChannels = new Map(); // userId -> channel

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
            console.error(`[Socket] Error in handler for ${eventName}:`, err);
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

            this._dispatch("receive_message", data);
            publishToUser(payload.receiver_id, "receive_message", data);
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

            const editPayload = {
              action: "edit",
              id: data.id,
              content: data.content,
              receiver_id: data.receiver_id,
              sender_id: data.sender_id,
            };
            this._dispatch("edit", editPayload);
            publishToUser(data.receiver_id, "edit", editPayload);
            return;
          }

          if (eventName === "delete") {
            const response = await fetch(`/api/messages/${payload.id}`, { method: "DELETE" });
            const data = await response.json();
            if (!response.ok) throw new Error(data.detail || "Could not delete message");

            this._dispatch("delete", data);
            publishToUser(data.receiver_id, "delete", data);
            return;
          }

          if (eventName === "mark_read") {
            const response = await fetch(`/api/messages/read/${payload.contact_id}`, { method: "POST" });
            const data = await response.json();
            if (!response.ok) throw new Error(data.detail || "Could not mark messages as read");

            if (Array.isArray(data.message_ids) && data.message_ids.length > 0) {
                publishToUser(payload.contact_id, "read_receipt", { ...data, contact_id: payload.contact_id });
            }
            return;
          }

          if (eventName === "typing" || String(eventName).startsWith("webrtc_")) {
            publishToUser(payload.receiver_id, eventName, { ...payload, sender_id: currentUserId });
            return;
          }
        } catch (err) {
          console.error(`[Socket] Emit error for ${eventName}:`, err);
          this._dispatch("error", { message: err?.message || "Operation failed" });
        }
      },

      connect() {
        if (this.connected) return;
        if (!supabaseUrl || !supabaseAnonKey || !window.supabase) {
            console.error("[Socket] Missing Supabase configuration or library.");
            return;
        }

        realtimeClient = window.supabase.createClient(supabaseUrl, supabaseAnonKey);
        
        // Inbound channel
        const inboundName = `user-stream:${currentUserId}`;
        inboundChannel = realtimeClient.channel(inboundName, {
            config: { broadcast: { self: false } },
        });

        [
          "receive_message", "edit", "delete", "read_receipt", "typing",
          "webrtc_offer", "webrtc_answer", "webrtc_ice_candidate", 
          "webrtc_end", "webrtc_upgrade_request", "webrtc_upgrade_response"
        ].forEach((eventName) => {
          inboundChannel.on("broadcast", { event: eventName }, ({ payload }) => {
            this._dispatch(eventName, payload);
          });
        });

        inboundChannel.subscribe();

        // Presence channel
        presenceChannel = realtimeClient.channel("presence:online-users", {
          config: { presence: { key: String(currentUserId) } },
        });

        const syncPresence = () => {
          const state = presenceChannel.presenceState();
          const ids = Object.keys(state)
            .filter(key => state[key] && state[key].length > 0)
            .map(key => Number(key))
            .filter(id => !isNaN(id));
          
          if (typeof onPresenceIds === "function") {
            onPresenceIds(ids);
          }
        };

        presenceChannel
          .on("presence", { event: "sync" }, syncPresence)
          .on("presence", { event: "join" }, syncPresence)
          .on("presence", { event: "leave" }, syncPresence)
          .subscribe(async (status) => {
            if (status === "SUBSCRIBED") {
              await presenceChannel.track({ user_id: currentUserId });
              this.connected = true;
              this._dispatch("connect");
            }
          });
      },

      disconnect() {
        if (realtimeClient) {
          realtimeClient.removeAllChannels();
          realtimeClient = null;
        }
        inboundChannel = null;
        presenceChannel = null;
        outboundChannels.clear();
        this.connected = false;
        this._dispatch("disconnect");
      }
    };

    function publishToUser(userId, eventName, payload) {
      if (!realtimeClient || !socket.connected || !userId) return;

      const channelName = `user-stream:${userId}`;
      let channel = outboundChannels.get(channelName);

      if (!channel) {
        channel = realtimeClient.channel(channelName, {
            config: { broadcast: { self: false } },
        });
        channel.subscribe((status) => {
          if (status === "SUBSCRIBED") {
            outboundChannels.set(channelName, channel);
            channel.send({ type: "broadcast", event: eventName, payload });
          }
        });
      } else {
        channel.send({ type: "broadcast", event: eventName, payload });
      }
    }

    return socket;
  }

  window.MKChatsRealtime = { createSocket };
})();
