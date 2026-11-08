/**
 * Field-level encryption for SIN and banking details.
 *
 * AES-256-GCM with a random 96-bit IV per value. Stored as "v1:<base64(iv | tag | ciphertext)>".
 * The key comes from FIELD_ENCRYPTION_KEY (32 bytes, base64) and never reaches the database,
 * so a database dump alone reveals nothing. The record id is bound in as associated data, so a
 * ciphertext copied onto another person's row fails to decrypt.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";

export function parseKey(base64Key: string): Buffer {
  const key = Buffer.from(base64Key, "base64");
  if (key.length !== 32) throw new Error("FIELD_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
  return key;
}

export function encryptField(plain: string, key: Buffer, recordId: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(recordId, "utf8"));
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `${VERSION}:${Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64")}`;
}

export function decryptField(stored: string, key: Buffer, recordId: string): string {
  const [version, body] = stored.split(":", 2);
  if (version !== VERSION || !body) throw new Error("Unsupported ciphertext format");
  const raw = Buffer.from(body, "base64");
  if (raw.length < 29) throw new Error("Ciphertext too short");
  const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
  decipher.setAAD(Buffer.from(recordId, "utf8"));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}

/** Last four digits, the only part stored in clear for masking. */
export function lastDigits(value: string, n = 4): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length < n) throw new Error("Value has too few digits to mask");
  return digits.slice(-n);
}

export function maskSin(last4: string | null): string {
  return last4 ? `•••-••${last4.slice(0, 1)}-${last4.slice(1)}` : "Not provided";
}

export function maskBank(last4: string | null): string {
  return last4 ? `•••• ${last4}` : "Not provided";
}

/** Canadian SIN: 9 digits passing the Luhn check. */
export function isValidSin(sin: string): boolean {
  const d = sin.replace(/[\s-]/g, "");
  if (!/^\d{9}$/.test(d)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let n = Number(d[i]);
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return sum % 10 === 0;
}
