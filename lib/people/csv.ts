import Papa from "papaparse";
import { isValidDate } from "@/lib/calc";

export const PERSON_TYPES = ["employee", "outside_investor"] as const;
export const STATUSES = ["active", "leave", "departed"] as const;

export interface PersonRow {
  line: number;
  name: string;
  email: string;
  hireDate: string | null;
  status: "active" | "leave" | "departed" | "not_applicable";
  type: (typeof PERSON_TYPES)[number];
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
 * Parse a people CSV with columns name, email, hire_date, status, type (any order, header row
 * required). Dates must be YYYY-MM-DD so day and month can't be confused. Every problem is
 * reported with its line number; nothing is partially accepted.
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
  const seen = new Map<string, number>();
  parsed.data.forEach((raw, i) => {
    const line = i + 2;
    const name = (raw.name ?? "").trim();
    const email = (raw.email ?? "").trim().toLowerCase();
    const hire = (raw.hire_date ?? "").trim();
    const type = norm(raw.type ?? "") as PersonRow["type"];
    const status = norm(raw.status ?? "");
    const problems: string[] = [];

    if (!name) problems.push("name is empty");
    if (!EMAIL.test(email)) problems.push(`"${raw.email ?? ""}" is not a valid email`);
    if (!PERSON_TYPES.includes(type)) problems.push(`type must be employee or outside_investor, not "${raw.type ?? ""}"`);
    if (type === "employee") {
      if (!isValidDate(hire)) problems.push(`hire_date must be YYYY-MM-DD, not "${hire}"`);
      if (!(STATUSES as readonly string[]).includes(status)) problems.push(`status must be active, leave or departed, not "${raw.status ?? ""}"`);
    } else if (hire && !isValidDate(hire)) {
      problems.push(`hire_date must be YYYY-MM-DD or empty, not "${hire}"`);
    }
    const prev = seen.get(email);
    if (email && prev) problems.push(`email also appears on line ${prev}`);
    seen.set(email, line);

    if (problems.length) {
      errors.push({ line, message: problems.join("; ") });
      return;
    }
    rows.push({
      line,
      name,
      email,
      hireDate: hire || null,
      status: type === "employee" ? (status as PersonRow["status"]) : "not_applicable",
      type,
    });
  });
  return { rows, errors };
}
