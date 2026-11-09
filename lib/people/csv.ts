import Papa from "papaparse";
import { isValidDate } from "@/lib/calc";

export const PERSON_TYPES = ["employee", "outside_investor", "company"] as const;
export const STATUSES = ["active", "leave", "departed"] as const;

export interface PersonRow {
  line: number;
  name: string;
  /** Null when not known yet; they can't be invited until it's added. */
  email: string | null;
  hireDate: string | null;
  status: "active" | "leave" | "departed" | "not_applicable";
  type: (typeof PERSON_TYPES)[number];
  /** For a company: the person who signs in for it. */
  contactName: string | null;
}

export interface RowError {
  line: number;
  message: string;
}

export interface ParsedImport {
  rows: PersonRow[];
  errors: RowError[];
}

const REQUIRED = ["name", "email", "hire_date", "status", "type"] as const;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const norm = (h: string) => h.trim().toLowerCase().replace(/[\s-]+/g, "_");

/**
 * Parse a people CSV with columns name, email, hire_date, status, type and optionally
 * contact_name (any order, header row required; commas or tabs, so rows pasted from a
 * spreadsheet work). Email and hire date may be blank when not known yet. Dates must be
 * YYYY-MM-DD. Every problem is reported with its line number; nothing is partially accepted.
 */
export function parsePeopleCsv(text: string): ParsedImport {
  const parsed = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: norm,
  });
  const errors: RowError[] = parsed.errors.map((e) => ({ line: (e.row ?? 0) + 2, message: e.message }));
  const headers = parsed.meta.fields ?? [];
  const missing = REQUIRED.filter((h) => !headers.includes(h));
  if (missing.length) return { rows: [], errors: [{ line: 1, message: `Missing column(s): ${missing.join(", ")}` }] };

  const rows: PersonRow[] = [];
  const seenEmail = new Map<string, number>();
  const seenName = new Map<string, number>();
  parsed.data.forEach((raw, i) => {
    const line = i + 2;
    const name = (raw.name ?? "").trim();
    const email = (raw.email ?? "").trim().toLowerCase();
    const hire = (raw.hire_date ?? "").trim();
    const type = norm(raw.type ?? "") as PersonRow["type"];
    const status = norm(raw.status ?? "");
    const contact = (raw.contact_name ?? "").trim();
    const problems: string[] = [];

    if (!name) problems.push("name is empty");
    if (email && !EMAIL.test(email)) problems.push(`"${raw.email ?? ""}" is not a valid email`);
    if (!PERSON_TYPES.includes(type)) problems.push(`type must be employee, outside_investor or company, not "${raw.type ?? ""}"`);
    if (hire && !isValidDate(hire)) problems.push(`hire_date must be YYYY-MM-DD or empty, not "${hire}"`);
    if (type === "employee" && status && !(STATUSES as readonly string[]).includes(status)) {
      problems.push(`status must be active, leave or departed, not "${raw.status ?? ""}"`);
    }
    if (email) {
      const prev = seenEmail.get(email);
      if (prev) problems.push(`email also appears on line ${prev}`);
      seenEmail.set(email, line);
    } else if (name) {
      const prev = seenName.get(name.toLowerCase());
      if (prev) problems.push(`name also appears on line ${prev} (without an email, people are matched by name)`);
      seenName.set(name.toLowerCase(), line);
    }

    if (problems.length) {
      errors.push({ line, message: problems.join("; ") });
      return;
    }
    rows.push({
      line,
      name,
      email: email || null,
      hireDate: hire || null,
      status: type === "employee" ? ((status || "active") as PersonRow["status"]) : "not_applicable",
      type,
      contactName: type === "company" ? contact || null : null,
    });
  });
  return { rows, errors };
}
