import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptField, encryptField, isValidSin, lastDigits, maskBank, maskSin, parseKey } from "@/lib/crypto/fields";

const key = parseKey(randomBytes(32).toString("base64"));

describe("field encryption", () => {
  it("round-trips a value", () => {
    const ct = encryptField("046 454 286", key, "person-1");
    expect(ct.startsWith("v1:")).toBe(true);
    expect(ct).not.toContain("046");
    expect(decryptField(ct, key, "person-1")).toBe("046 454 286");
  });

  it("uses a fresh IV each time", () => {
    expect(encryptField("x", key, "p")).not.toBe(encryptField("x", key, "p"));
  });

  it("fails with the wrong key", () => {
    const ct = encryptField("secret", key, "p");
    expect(() => decryptField(ct, parseKey(randomBytes(32).toString("base64")), "p")).toThrow();
  });

  it("fails when moved to another person's record", () => {
    const ct = encryptField("secret", key, "person-1");
    expect(() => decryptField(ct, key, "person-2")).toThrow();
  });

  it("fails when tampered with", () => {
    const ct = encryptField("secret", key, "p");
    const raw = Buffer.from(ct.slice(3), "base64");
    raw[raw.length - 1] = raw[raw.length - 1]! ^ 1;
    expect(() => decryptField(`v1:${raw.toString("base64")}`, key, "p")).toThrow();
  });

  it("rejects keys that are not 32 bytes", () => {
    expect(() => parseKey(randomBytes(16).toString("base64"))).toThrow(/32 bytes/);
  });
});

describe("masking", () => {
  it("keeps only the last four digits", () => {
    expect(lastDigits("046-454-286")).toBe("4286");
    expect(lastDigits("Transit 12345 Account 0012345678")).toBe("5678");
  });

  it("masks SIN and bank values", () => {
    expect(maskSin("4286")).toBe("•••-••4-286");
    expect(maskBank("5678")).toBe("•••• 5678");
    expect(maskSin(null)).toBe("Not provided");
  });

  it("validates SINs with the Luhn check", () => {
    expect(isValidSin("046 454 286")).toBe(true);
    expect(isValidSin("046 454 287")).toBe(false);
    expect(isValidSin("12345678")).toBe(false);
  });
});
