import { describe, expect, it } from "vitest";
import { formatSetting, parseSettingInput } from "@/lib/settings";

describe("program setting input and display", () => {
  it("handles share counts", () => {
    expect(parseSettingInput("shares_outstanding_total", "100,078")).toBe(100_078n);
    expect(formatSetting("shares_outstanding_total", 100_078n)).toBe("100,078 shares");
    expect(() => parseSettingInput("shares_outstanding_total", "100.5")).toThrow(/whole number/);
    expect(() => parseSettingInput("shares_outstanding_total", "0")).toThrow(/above zero/);
  });

  it("handles money in cents", () => {
    expect(parseSettingInput("min_purchase_cents", "$1,000")).toBe(100_000n);
    expect(parseSettingInput("max_purchase_cents", "10000.50")).toBe(1_000_050n);
    expect(formatSetting("min_purchase_cents", 100_000n)).toBe("$1,000.00");
  });

  it("handles the multiple without floats", () => {
    expect(parseSettingInput("valuation_multiple_x100", "7")).toBe(700n);
    expect(parseSettingInput("valuation_multiple_x100", "6.5x")).toBe(650n);
    expect(formatSetting("valuation_multiple_x100", 650n)).toBe("6.50×");
  });

  it("rejects junk", () => {
    expect(() => parseSettingInput("eligibility_years", "four")).toThrow();
    expect(() => parseSettingInput("eligibility_years", "-1")).toThrow();
  });
});
