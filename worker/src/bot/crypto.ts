const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** Imports TOKEN_KEY (base64, 32 bytes) as an AES-GCM key. */
export async function importKey(tokenKey: string): Promise<CryptoKey> {
  const raw = unb64(tokenKey);
  if (raw.length !== 32) throw new Error("TOKEN_KEY must be 32 bytes, base64-encoded");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** Returns `<iv>.<ciphertext>`, both base64, with a fresh 12-byte IV. */
export async function encrypt(key: CryptoKey, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext));
  return `${b64(iv)}.${b64(new Uint8Array(ct))}`;
}

export async function decrypt(key: CryptoKey, stored: string): Promise<string> {
  const [iv, ct] = stored.split(".");
  if (!iv || !ct) throw new Error("malformed ciphertext");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, key, unb64(ct));
  return new TextDecoder().decode(pt);
}
