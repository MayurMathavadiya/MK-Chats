const WebAuthnHelper = {
    // Check if browser supports WebAuthn and biometrics
    getSupportStatus: async function() {
        // 1. Browser check
        if (!window.PublicKeyCredential) {
            return { ok: false, reason: 'browser_unsupported' };
        }
        
        // 2. Hardware check
        const isPlatformAvailable = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
        if (!isPlatformAvailable) {
            return { ok: false, reason: 'no_hardware' };
        }

        // 3. PRF extension check
        try {
            if (PublicKeyCredential.getClientCapabilities) {
                const caps = await PublicKeyCredential.getClientCapabilities();
                if (!caps.prf) {
                    return { ok: false, reason: 'no_prf' };
                }
            }
        } catch (e) {
            console.warn("Error checking client capabilities:", e);
        }
        
        return { ok: true };
    },

    // Legacy alias for compatibility during transition
    isSupported: async function() {
        const status = await this.getSupportStatus();
        return status.ok;
    },

    // Convert base64 to ArrayBuffer
    coerceToArrayBuffer: function(data) {
        if (typeof data === 'string') {
            // b64url to b64
            let b64 = data.replace(/-/g, '+').replace(/_/g, '/');
            // pad
            while (b64.length % 4 !== 0) b64 += '=';
            
            const binary = window.atob(b64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
                bytes[i] = binary.charCodeAt(i);
            }
            return bytes.buffer;
        }
        return data;
    },

    // Convert ArrayBuffer to base64url (WebAuthn spec format)
    coerceToBase64Url: function(buffer) {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return window.btoa(binary)
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=/g, '');
    },

    // Register a new biometric device
    register: async function(options) {
        // Handle options getting passed either directly or wrapped in publicKey
        const publicKey = options.publicKey || options;
        
        if (!publicKey || !publicKey.challenge) {
            throw new Error("Invalid registration options received from server.");
        }

        const creationOptions = {
            publicKey: {
                ...publicKey,
                challenge: this.coerceToArrayBuffer(publicKey.challenge),
                user: {
                    ...publicKey.user,
                    id: this.coerceToArrayBuffer(publicKey.user.id)
                },
                // Crucial for mobile biometrics
                authenticatorSelection: {
                    authenticatorAttachment: "platform",
                    userVerification: "required",
                    residentKey: "required",
                    requireResidentKey: true
                },
                extensions: {
                    prf: { enabled: true }
                }
            }
        };

        const credential = await navigator.credentials.create(creationOptions);
        
        // Extract PRF output
        const extensionResults = credential.getClientExtensionResults();
        
        return {
            id: credential.id,
            rawId: this.coerceToBase64Url(credential.rawId),
            type: credential.type,
            response: {
                clientDataJSON: this.coerceToBase64Url(credential.response.clientDataJSON),
                attestationObject: this.coerceToBase64Url(credential.response.attestationObject)
            },
            clientExtensionResults: extensionResults
        };
    },

    // Login with biometric device
    authenticate: async function(options) {
        const publicKey = options.publicKey || options;
        
        if (!publicKey || !publicKey.challenge) {
            throw new Error("Invalid authentication options received from server.");
        }

        const salt = new TextEncoder().encode("mk-chats-prf-salt-v1-32bytes-len");
        
        const requestOptions = {
            publicKey: {
                ...publicKey,
                challenge: this.coerceToArrayBuffer(publicKey.challenge),
                allowCredentials: (publicKey.allowCredentials || []).map(c => ({
                    ...c,
                    id: this.coerceToArrayBuffer(c.id)
                })),
                userVerification: "required", // Explicitly trigger biometrics
                extensions: {
                    prf: {
                        eval: { first: salt }
                    }
                }
            }
        };

        const assertion = await navigator.credentials.get(requestOptions);
        const extensionResults = assertion.getClientExtensionResults();
        
        let prfResults = null;
        if (extensionResults.prf && extensionResults.prf.results) {
            prfResults = extensionResults.prf.results.first;
        }

        return {
            id: assertion.id,
            rawId: this.coerceToBase64Url(assertion.rawId),
            type: assertion.type,
            response: {
                clientDataJSON: this.coerceToBase64Url(assertion.response.clientDataJSON),
                authenticatorData: this.coerceToBase64Url(assertion.response.authenticatorData),
                signature: this.coerceToBase64Url(assertion.response.signature),
                userHandle: assertion.response.userHandle ? this.coerceToBase64Url(assertion.response.userHandle) : null
            },
            prfResults: prfResults // ArrayBuffer
        };
    },

    // Derive a symmetric key from PRF results
    deriveKeyFromPrf: async function(prfBuffer) {
        const baseKey = await window.crypto.subtle.importKey(
            "raw",
            prfBuffer,
            "HKDF",
            false,
            ["deriveKey"]
        );

        return window.crypto.subtle.deriveKey(
            {
                name: "HKDF",
                salt: new Uint8Array(16), // Use a fixed salt for determinism
                info: new TextEncoder().encode("mk-chats-prf-key-v1"),
                hash: "SHA-256"
            },
            baseKey,
            { name: "AES-GCM", length: 256 },
            false,
            ["encrypt", "decrypt"]
        );
    }
};
