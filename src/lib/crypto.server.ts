/**
 * AES-256-GCM primitives for column-level encryption at rest.
 *
 * Ciphertext layout (single bytea column):
 *   [0..12)   IV (96 bits, random)
 *   [12..N)   ciphertext
 *   [N..N+16) GCM authentication tag
 *
 * AAD (additional authenticated data) is bound to the logical column name,
 * so a ciphertext copied between columns cannot be silently accepted.
 *
 * The key comes from the FIELD_ENCRYPTION_KEY env var, which stores 32 raw
 * bytes hex-encoded (64 hex chars) or as a base64 string. Never hard-code
 * keys, never log plaintext.
 *
 * IMPORTANT: import this only from server contexts. It uses `node:crypto`
 * and reads a secret. It must never be pulled into a client bundle.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;

let cachedKey: Buffer | null = null;

function loadKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.FIELD_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "FIELD_ENCRYPTION_KEY is not configured. Set it via the secrets manager before using field encryption.",
    );
  }
  let key: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    key = Buffer.from(raw, "hex");
  } else if (/^[A-Za-z0-9+/=]{40,}$/.test(raw)) {
    // Base64 fallback (accept 32-byte payloads only after decoding).
    const b = Buffer.from(raw, "base64");
    if (b.length !== KEY_LEN) {
      throw new Error(
        `FIELD_ENCRYPTION_KEY (base64) must decode to ${KEY_LEN} bytes; got ${b.length}.`,
      );
    }
    key = b;
  } else if (Buffer.byteLength(raw, "utf8") >= KEY_LEN) {
    // Last-resort UTF-8 derivation: take first 32 bytes. Not recommended.
    key = Buffer.from(raw, "utf8").subarray(0, KEY_LEN);
  } else {
    throw new Error(
      "FIELD_ENCRYPTION_KEY must be 64 hex chars, a 32-byte base64 value, or ≥32 UTF-8 bytes.",
    );
  }
  cachedKey = key;
  return key;
}

/**
 * Encrypt a UTF-8 plaintext with AES-256-GCM, binding the ciphertext to
 * `aad` (typically the column name). Returns a single Buffer suitable for
 * `bytea` storage. `null`/empty input returns `null` so callers can pass
 * schema-nullable values through unchanged.
 */
export function encryptField(plaintext: string | null | undefined, aad: string): Buffer | null {
  if (plaintext == null || plaintext === "") return null;
  const key = loadKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ct, tag]);
}

/**
 * Decrypt a ciphertext produced by {@link encryptField}. Throws when the
 * tag or AAD does not match — never returns partial plaintext on tamper.
 * Returns `null` for a `null` input so read paths can compose cleanly.
 */
export function decryptField(payload: Buffer | Uint8Array | null | undefined, aad: string): string | null {
  if (payload == null) return null;
  const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  if (buf.length < IV_LEN + TAG_LEN + 1) {
    throw new Error("Ciphertext too short to be valid AES-256-GCM output.");
  }
  const key = loadKey();
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(buf.length - TAG_LEN);
  const ct = buf.subarray(IV_LEN, buf.length - TAG_LEN);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

/**
 * Return a stable masked representation for display in lists where the
 * admin has not opted in to reveal the full value. Handles null/short
 * inputs safely and never depends on the encryption key.
 */
export function maskSensitive(value: string | null | undefined, visible = 4): string {
  if (!value) return "—";
  const trimmed = value.replace(/\s+/g, "");
  if (trimmed.length <= visible) return "•".repeat(trimmed.length);
  return `${"•".repeat(Math.max(0, trimmed.length - visible))}${trimmed.slice(-visible)}`;
}
