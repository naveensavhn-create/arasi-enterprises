// @vitest-environment node
import { describe, it, expect } from "vitest";

// Set the key BEFORE importing the module (loadKey caches on first call).
process.env.FIELD_ENCRYPTION_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const { encryptField, decryptField, maskSensitive } = await import(
  "@/lib/crypto.server"
);

describe("crypto.server AES-256-GCM", () => {
  it("round-trips plaintext through encrypt/decrypt", () => {
    const ct = encryptField("1234-5678-9012", "aadhaar_number");
    expect(ct).not.toBeNull();
    expect(Buffer.isBuffer(ct)).toBe(true);
    const pt = decryptField(ct, "aadhaar_number");
    expect(pt).toBe("1234-5678-9012");
  });

  it("returns null for null/empty input on both sides", () => {
    expect(encryptField(null, "x")).toBeNull();
    expect(encryptField("", "x")).toBeNull();
    expect(decryptField(null, "x")).toBeNull();
  });

  it("produces distinct ciphertexts for the same plaintext (random IV)", () => {
    const a = encryptField("hello", "col")!;
    const b = encryptField("hello", "col")!;
    expect(a.equals(b)).toBe(false);
  });

  it("rejects ciphertext decrypted with a different AAD", () => {
    const ct = encryptField("secret", "aadhaar_number")!;
    expect(() => decryptField(ct, "pan_number")).toThrow();
  });

  it("rejects tampered ciphertext (auth tag mismatch)", () => {
    const ct = Buffer.from(encryptField("secret", "col")!);
    // Flip a bit in the middle of the ciphertext payload.
    ct[ct.length - 20] ^= 0x01;
    expect(() => decryptField(ct, "col")).toThrow();
  });

  it("rejects a payload that is too short to be valid", () => {
    expect(() => decryptField(Buffer.alloc(10), "col")).toThrow(/too short/);
  });
});

describe("maskSensitive", () => {
  it("returns em dash for null/empty", () => {
    expect(maskSensitive(null)).toBe("—");
    expect(maskSensitive("")).toBe("—");
  });

  it("shows last N characters with bullets before", () => {
    expect(maskSensitive("123456789012", 4)).toBe("••••••••9012");
  });

  it("fully masks values shorter than the visible window", () => {
    expect(maskSensitive("abc", 4)).toBe("•••");
  });
});
