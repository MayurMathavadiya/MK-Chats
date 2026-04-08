(() => {
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function subscribeChannel(channel) {
    return await new Promise((resolve, reject) => {
      let settled = false;
      const timeoutId = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error("Timed out while subscribing to Supabase Realtime channel"));
        }
      }, 10000);

      channel.subscribe((status) => {
        if (settled) return;
        if (status === "SUBSCRIBED") {
          settled = true;
          clearTimeout(timeoutId);
          resolve(channel);
          return;
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          settled = true;
          clearTimeout(timeoutId);
          reject(new Error(`Supabase Realtime subscribe failed with status ${status}`));
        }
      });
    });
  }

  function getDirectChannelName(userId) {
    return `user-stream:${userId}`;
  }

  function createSocket({ supabaseUrl, supabaseAnonKey, currentUserId, onPresenceIds } = {}) {
    let realtimeClient = null;
    let inboundChannel = null;
    let presenceChannel = null;
    const outboundChannelPromises = new Map();
    let watchdogIntervalId = null;
    let lastPresenceSyncAt = 0;

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
          Promise.resolve(handler(payload)).catch((err) => console.error(err));
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
            await publishToUser(payload.receiver_id, "receive_message", data);
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
            await publishToUser(data.receiver_id, "edit", editPayload);
            return;
          }

          if (eventName === "delete") {
            const response = await fetch(`/api/messages/${payload.id}`, { method: "DELETE" });
            const data = await response.json();
            if (!response.ok) throw new Error(data.detail || "Could not delete message");

            this._dispatch("delete", data);
            await publishToUser(data.receiver_id, "delete", data);
            return;
          }

          if (eventName === "mark_read") {
            const response = await fetch(`/api/messages/read/${payload.contact_id}`, { method: "POST" });
            const data = await response.json();
            if (!response.ok) throw new Error(data.detail || "Could not mark messages as read");

            if (Array.isArray(data.message_ids) && data.message_ids.length > 0) {
              await publishToUser(payload.contact_id, "read_receipt", data);
            }
            return;
          }

          if (eventName === "typing" || String(eventName).startsWith("webrtc_")) {
            await publishToUser(payload.receiver_id, eventName, { ...payload, sender_id: currentUserId });
            return;
          }
        } catch (err) {
          this._dispatch("error", { message: err?.message || "Realtime request failed" });
        }
      },
      async connect() {
        if (this.connected) return;
        if (!supabaseUrl || !supabaseAnonKey) {
          this._dispatch("error", { message: "Supabase Realtime is not configured." });
          return;
        }
        if (!window.supabase || typeof window.supabase.createClient !== "function") {
          this._dispatch("error", { message: "Supabase client failed to load." });
          return;
        }

        realtimeClient = window.supabase.createClient(supabaseUrl, supabaseAnonKey);
        inboundChannel = realtimeClient.channel(getDirectChannelName(currentUserId), {
          config: { broadcast: { self: false } },
        });
        presenceChannel = realtimeClient.channel("presence:online-users", {
          config: { presence: { key: String(currentUserId) } },
        });

        [
          "receive_message",
          "edit",
          "delete",
          "read_receipt",
          "typing",
          "webrtc_offer",
          "webrtc_answer",
          "webrtc_ice_candidate",
          "webrtc_end",
          "webrtc_upgrade_request",
          "webrtc_upgrade_response",
        ].forEach((eventName) => {
          inboundChannel.on("broadcast", { event: eventName }, ({ payload }) => {
            this._dispatch(eventName, payload);
          });
        });

        const consumePresenceState = () => {
          if (!presenceChannel || typeof presenceChannel.presenceState !== "function") return;
          const presenceState = presenceChannel.presenceState();
          const ids = [];
          Object.keys(presenceState).forEach((key) => {
            const userId = Number(key);
            const metas = presenceState[key];
            const hasAnyPresence = Array.isArray(metas) ? metas.length > 0 : Boolean(metas);
            if (!Number.isNaN(userId) && hasAnyPresence) ids.push(userId);
          });
          lastPresenceSyncAt = Date.now();
          if (typeof onPresenceIds === "function") onPresenceIds(ids);
        };

        presenceChannel.on("presence", { event: "sync" }, consumePresenceState);
        presenceChannel.on("presence", { event: "join" }, consumePresenceState);
        presenceChannel.on("presence", { event: "leave" }, consumePresenceState);

        await Promise.all([subscribeChannel(inboundChannel), subscribeChannel(presenceChannel)]);
        await presenceChannel.track({ user_id: currentUserId });
        consumePresenceState();

        this.connected = true;
        this._dispatch("connect");

        if (!watchdogIntervalId) {
          watchdogIntervalId = window.setInterval(async () => {
            if (!this.connected) return;
            // If presence stops syncing for a while, reconnect.
            if (lastPresenceSyncAt && Date.now() - lastPresenceSyncAt > 90000) {
              try {
                await this.disconnect();
              } catch (e) {}
              await sleep(250);
              try {
                await this.connect();
              } catch (e) {}
            }
          }, 15000);
        }

        // Best-effort disconnect on pagehide (more reliable than beforeunload).
        window.addEventListener(
          "pagehide",
          () => {
            try {
              this.disconnect();
            } catch (e) {}
          },
          { once: true }
        );
      },
      async disconnect() {
        if (!realtimeClient) {
          this.connected = false;
          return;
        }

        if (presenceChannel) {
          try {
            await presenceChannel.untrack();
          } catch (err) {
            console.error(err);
          }
        }

        const channels = [inboundChannel, presenceChannel];
        outboundChannelPromises.forEach((channelPromise) => channels.push(channelPromise));
        await Promise.allSettled(
          channels.map(async (channelOrPromise) => {
            const channel = await channelOrPromise;
            return realtimeClient.removeChannel(channel);
          })
        );

        outboundChannelPromises.clear();
        inboundChannel = null;
        presenceChannel = null;
        realtimeClient = null;
        this.connected = false;
        if (typeof onPresenceIds === "function") onPresenceIds([]);
        this._dispatch("disconnect");
      },
    };

    async function getOutboundChannel(userId) {
      const channelName = getDirectChannelName(userId);
      if (!outboundChannelPromises.has(channelName)) {
        const channel = realtimeClient.channel(channelName, {
          config: { broadcast: { self: false } },
        });
        outboundChannelPromises.set(channelName, subscribeChannel(channel));
      }
      return await outboundChannelPromises.get(channelName);
    }

    async function publishToUser(userId, eventName, payload) {
      if (!socket.connected || !realtimeClient) return;
      const channel = await getOutboundChannel(userId);
      await channel.send({ type: "broadcast", event: eventName, payload });
    }

    return socket;
  }

  window.MKChatsRealtime = {
    createSocket,
  };
})();

