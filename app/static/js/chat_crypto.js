/**
 * Cryptographic helper functions for MK Chats End-to-End Encryption
 */

function encodeB64(buffer) {
    return btoa(String.fromCharCode.apply(null, new Uint8Array(buffer)));
}

function decodeB64(str) {
    return Uint8Array.from(atob(str), c => c.charCodeAt(0));
}

function arrayBufferToBase64(buffer) {
    let binary = '';
    let bytes = new Uint8Array(buffer);
    let len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
}

function base64ToArrayBuffer(base64) {
    let binary_string = window.atob(base64);
    let len = binary_string.length;
    let bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binary_string.charCodeAt(i);
    }
    return bytes.buffer;
}

async function deriveWrappingKey(password, salt) {
    const enc = new TextEncoder();
    const keyMaterial = await window.crypto.subtle.importKey(
        "raw",
        enc.encode(password),
        "PBKDF2",
        false,
        ["deriveKey"]
    );
    return await window.crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            salt: salt,
            iterations: 100000,
            hash: "SHA-256"
        },
        keyMaterial,
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"]
    );
}

async function importDek(rawDek) {
    return await window.crypto.subtle.importKey(
        "raw",
        rawDek,
        "AES-GCM",
        true,
        ["encrypt", "decrypt"]
    );
}

async function importPrivateKeys(encryptedDekB64, dekIvB64, keysSaltB64, password) {
    try {
        const salt = new Uint8Array(base64ToArrayBuffer(keysSaltB64));
        const iv = new Uint8Array(base64ToArrayBuffer(dekIvB64));
        const encryptedDek = base64ToArrayBuffer(encryptedDekB64);

        const kek = await deriveWrappingKey(password, salt);
        const dekBuffer = await window.crypto.subtle.decrypt(
            { name: "AES-GCM", iv: iv },
            kek,
            encryptedDek
        );

        return await importDek(dekBuffer);
    } catch (e) {
        console.error("Failed to import/decrypt keys:", e);
        return null;
    }
}

async function importContactPublicKey(b64Key) {
    if (!b64Key || b64Key === "null") return null;
    try {
        const binaryDer = decodeB64(b64Key);
        return await window.crypto.subtle.importKey(
            "spki",
            binaryDer,
            { name: "ECDH", namedCurve: "P-256" },
            false,
            []
        );
    } catch (e) {
        console.error("Import public key error:", e);
        return null;
    }
}

async function deriveSharedSecret(myPrivateKey, contactPubKey) {
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

async function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
    });
}
