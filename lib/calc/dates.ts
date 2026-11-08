/** Dates are plain calendar dates as "YYYY-MM-DD" strings; no time zones involved. */
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function parse(date: string): [number, number, number] {
  const m = ISO.exec(date);
  if (!m) throw new RangeError(`Not a YYYY-MM-DD date: "${date}"`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) throw new RangeError(`Invalid date: "${date}"`);
  return [y, mo, d];
}

const fmt = (y: number, m: number, d: number) =>
  `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** Add whole calendar years. Feb 29 becomes Feb 28 in a non-leap target year. */
export function addYears(date: string, years: number): string {
  if (!Number.isInteger(years)) throw new RangeError("years must be an integer");
  const [y, m, d] = parse(date);
  const ty = y + years;
  return fmt(ty, m, Math.min(d, daysInMonth(ty, m)));
}

export function isValidDate(date: string): boolean {
  try {
    parse(date);
    return true;
  } catch {
    return false;
  }
}

/** The date an employee reaches the required years of service. */
export function eligibilityDate(hireDate: string, eligibilityYears: number): string {
  return addYears(hireDate, eligibilityYears);
}

export function isEligible(hireDate: string, today: string, eligibilityYears: number): boolean {
  parse(today);
  return eligibilityDate(hireDate, eligibilityYears) <= today;
}
