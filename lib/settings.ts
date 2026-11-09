import { formatCents, formatShares } from "@/lib/calc";

/**
 * How each program setting is shown and entered. Values are stored as integers (cents,
 * multiples × 100, counts), so the admin form converts to and from what people type.
 */
export type SettingUnit = "cents" | "x100" | "years" | "shares" | "count";

export const SETTING_META: Record<string, { label: string; unit: SettingUnit; help: string }> = {
  shares_outstanding_total: {
    label: "Total shares outstanding (all classes)",
    unit: "shares",
    help: "Used to work out the price per share. Update it when share classes or counts change.",
  },
  valuation_multiple_x100: { label: "EBITDA multiple", unit: "x100", help: "Price per share = (multiple × audited EBITDA − debt) ÷ total shares." },
  min_purchase_cents: { label: "Minimum purchase", unit: "cents", help: "Smallest buy order, per transaction." },
  max_purchase_cents: { label: "Maximum purchase", unit: "cents", help: "Largest buy order, per transaction." },
  eligibility_years: { label: "Years of service to become eligible", unit: "years", help: "Employees can buy after this many years." },
  hold_service_years: { label: "Years of service to keep shares after leaving", unit: "years", help: "Part of the keep-your-shares rule." },
  hold_ownership_years: { label: "Years of ownership to keep shares after leaving", unit: "years", help: "Part of the keep-your-shares rule." },
};

export function formatSetting(key: string, value: bigint): string {
  switch (SETTING_META[key]?.unit) {
    case "cents":
      return formatCents(value);
    case "x100":
      return `${(value / 100n).toString()}.${(value % 100n).toString().padStart(2, "0")}×`;
    case "years":
      return `${value.toString()} years`;
    case "shares":
      // Stored in whole shares (the price-formula denominator); formatShares takes hundredths.
      return `${formatShares(value * 100n)} shares`;
    default:
      return value.toString();
  }
}

/** What the admin types → the stored integer. Throws a readable error. */
export function parseSettingInput(key: string, input: string): bigint {
  const raw = input.trim().replaceAll(",", "").replace(/^\$/, "").replace(/[×x]$/i, "");
  const unit = SETTING_META[key]?.unit ?? "count";
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(raw);
  if (!m) throw new Error("Enter a number, like 100,078 or 7.5.");
  const whole = BigInt(m[1]!);
  const frac = BigInt((m[2] ?? "").padEnd(2, "0") || "0");
  if (unit === "cents" || unit === "x100") return whole * 100n + frac;
  if (m[2]) throw new Error("Enter a whole number.");
  if (whole <= 0n) throw new Error("Enter a number above zero.");
  return whole;
}
