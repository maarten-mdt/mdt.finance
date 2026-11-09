import Papa from "papaparse";
import { isValidDate, parseDollarsToCents, parseShares, valueCents, type Cents, type Shares } from "@/lib/calc";

export interface LedgerRow {
  line: number;
  date: string;
  from: string;
  to: string;
  shares: Shares;
  priceCents: Cents;
  amountCents: Cents;
  memo: string | null;
}

export interface LedgerRowError {
  line: number;
  message: string;
}

const REQUIRED = ["date", "from", "to", "shares"] as const;
const norm = (h: string) => h.trim().toLowerCase().replace(/[\s-]+/g, "_").replace(/[^a-z_]/g, "");

/**
 * Parse share history: date, from, to, shares (two decimals) and optionally price_per_share,
 * amount (total paid) and note. Commas or tabs. "from" may be "Issued by MDT" for new shares.
 * Rows come back in file order; every problem is reported with its line number.
 */
export function parseLedgerCsv(text: string): { rows: LedgerRow[]; errors: LedgerRowError[] } {
  const parsed = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => {
      const n = norm(h);
      return n === "price" || n === "price_share" ? "price_per_share" : n === "total" || n === "total_paid" ? "amount" : n === "notes" || n === "memo" ? "note" : n;
    },
  });
  const errors: LedgerRowError[] = parsed.errors.map((e) => ({ line: (e.row ?? 0) + 2, message: e.message }));
  const headers = parsed.meta.fields ?? [];
  const missing = REQUIRED.filter((h) => !headers.includes(h));
  if (missing.length) return { rows: [], errors: [{ line: 1, message: `Missing column(s): ${missing.join(", ")}` }] };

  const rows: LedgerRow[] = [];
  parsed.data.forEach((raw, i) => {
    const line = i + 2;
    const date = (raw.date ?? "").trim();
    const from = (raw.from ?? "").trim();
    const to = (raw.to ?? "").trim();
    const problems: string[] = [];
    if (!isValidDate(date)) problems.push(`date must be YYYY-MM-DD, not "${date}"`);
    if (!from) problems.push("from is empty");
    if (!to) problems.push("to is empty");
    if (from && to && from.toLowerCase() === to.toLowerCase()) problems.push("from and to are the same");

    let shares = 0n;
    try {
      shares = parseShares(raw.shares ?? "");
      if (shares <= 0n) problems.push("shares must be more than zero");
    } catch {
      problems.push(`shares must be a number with up to two decimals, not "${raw.shares ?? ""}"`);
    }
    let priceCents = 0n;
    const priceRaw = (raw.price_per_share ?? "").trim();
    if (priceRaw) {
      try {
        priceCents = parseDollarsToCents(priceRaw);
        if (priceCents < 0n) problems.push("price can't be negative");
      } catch {
        problems.push(`price_per_share isn't a dollar amount: "${priceRaw}"`);
      }
    }
    let amountCents = valueCents(shares, priceCents);
    const amountRaw = (raw.amount ?? "").trim();
    if (amountRaw) {
      try {
        amountCents = parseDollarsToCents(amountRaw);
        if (amountCents < 0n) problems.push("amount can't be negative");
      } catch {
        problems.push(`amount isn't a dollar amount: "${amountRaw}"`);
      }
    }
    if (problems.length) {
      errors.push({ line, message: problems.join("; ") });
      return;
    }
    rows.push({ line, date, from, to, shares, priceCents, amountCents, memo: (raw.note ?? "").trim() || null });
  });
  return { rows, errors };
}

const ISSUED = new Set(["issued by mdt", "issued by mdt / pre-portal", "issued", "mdt", "treasury", "opening balance", "opening balance (pre-system)", "pre-portal"]);
const VRH = new Set(["vrh", "van ruitenburg holdings", "van ruitenburg holdings ltd", "van ruitenburg holdings ltd."]);

/** Which special holder a name refers to, if any. */
export function specialHolder(name: string): "opening_balance" | "vrh" | null {
  const n = name.trim().toLowerCase().replace(/\s+/g, " ");
  if (ISSUED.has(n)) return "opening_balance";
  if (VRH.has(n)) return "vrh";
  return null;
}
