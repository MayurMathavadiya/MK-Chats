const WebAuthnHelper = {
    // Check if browser supports WebAuthn and PRF
    isSupported: async function() {
        if (!window.PublicKeyCredential) return false;
        
        // Check for PRF extension support
        const extensions = await PublicKeyCredential.getClientCapabilities();
        return !!extensions.prf;
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
        // Prepare options from server
        const creationOptions = {
            publicKey: {
                ...options.publicKey,
                challenge: this.coerceToArrayBuffer(options.publicKey.challenge),
                user: {
                    ...options.publicKey.user,
                    id: this.coerceToArrayBuffer(options.publicKey.user.id)
                }
            }
        };

        // Add PRF extension if supported
        if (await this.isSupported()) {
            creationOptions.publicKey.extensions = {
                prf: { enabled: true }
            };
        }

        const credential = await navigator.credentials.create(creationOptions);
        
        // Extract PRF output to wrap the DEK
        let prfOutput = null;
        const extensionResults = credential.getClientExtensionResults();
        if (extensionResults.prf && extensionResults.prf.enabled) {
            // We'll use this later to wrap the DEK
            console.log("PRF enabled for this credential");
        }

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
        const salt = new TextEncoder().encode("mk-chats-prf-salt-v1-32bytes-len");
        
        const requestOptions = {
            publicKey: {
                ...options.publicKey,
                challenge: this.coerceToArrayBuffer(options.publicKey.challenge),
                allowCredentials: options.publicKey.allowCredentials.map(c => ({
                    ...c,
                    id: this.coerceToArrayBuffer(c.id)
                })),
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
