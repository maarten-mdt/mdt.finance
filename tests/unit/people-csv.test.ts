import { describe, expect, it } from "vitest";
import { parsePeopleCsv } from "@/lib/people/csv";

describe("parsePeopleCsv", () => {
  it("parses valid rows in any column order and normalises values", () => {
    const csv = [
      "Type,Name,Email,Hire Date,Status",
      "employee,Jane Doe,Jane.Doe@MDT.com,2019-04-01,Active",
      "outside_investor,Sam Investor,sam@example.com,,",
    ].join("\n");
    const { rows, errors } = parsePeopleCsv(csv);
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { line: 2, name: "Jane Doe", email: "jane.doe@mdt.com", hireDate: "2019-04-01", status: "active", type: "employee", contactName: null },
      { line: 3, name: "Sam Investor", email: "sam@example.com", hireDate: null, status: "not_applicable", type: "outside_investor", contactName: null },
    ]);
  });

  it("reports a missing column instead of guessing", () => {
    const { rows, errors } = parsePeopleCsv("name,email,type\nA,a@b.co,employee");
    expect(rows).toEqual([]);
    expect(errors[0]!.message).toMatch(/hire_date, status/);
  });

  it("reports every bad row with its line number", () => {
    const csv = [
      "name,email,hire_date,status,type",
      ",bad-email,04/01/2019,active,employee",
      "Bob,bob@x.co,2019-02-30,active,employee",
      "Cy,cy@x.co,2019-01-01,retired,employee",
      "Di,di@x.co,2019-01-01,active,contractor",
      "Ed,BOB@x.co,2019-01-01,active,employee",
    ].join("\n");
    const { rows, errors } = parsePeopleCsv(csv);
    expect(rows.map((r) => r.name)).toEqual([]);
    expect(errors.map((e) => e.line)).toEqual([2, 3, 4, 5, 6]);
    expect(errors[0]!.message).toMatch(/name is empty.*not a valid email.*YYYY-MM-DD/);
    expect(errors[1]!.message).toMatch(/2019-02-30/);
    expect(errors[2]!.message).toMatch(/status/);
    expect(errors[3]!.message).toMatch(/type/);
    expect(errors[4]!.message).toMatch(/also appears on line 3/);
  });

  it("ignores blank lines and a byte-order mark", () => {
    const { rows, errors } = parsePeopleCsv("﻿name,email,hire_date,status,type\n\nA B,a@b.co,2020-01-01,leave,employee\n\n");
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(1);
  });

  it("accepts rows pasted from Excel or Google Sheets (tab-separated)", () => {
    const pasted = "name\temail\thire_date\tstatus\ttype\nJane Doe\tjane@mdttac.com\t2019-04-01\tactive\temployee\n";
    const { rows, errors } = parsePeopleCsv(pasted);
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { line: 2, name: "Jane Doe", email: "jane@mdttac.com", hireDate: "2019-04-01", status: "active", type: "employee", contactName: null },
    ]);
  });

  it("accepts companies with a contact person, and blank emails and hire dates", () => {
    const { rows, errors } = parsePeopleCsv(
      "name,email,hire_date,status,type,contact_name\n1076844 BC Ltd.,,,,company,Nathan Neels\nJohn Neels,,,,employee,\n",
    );
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { line: 2, name: "1076844 BC Ltd.", email: null, hireDate: null, status: "not_applicable", type: "company", contactName: "Nathan Neels" },
      { line: 3, name: "John Neels", email: null, hireDate: null, status: "active", type: "employee", contactName: null },
    ]);
  });

  it("matches people without email by name, so a name can't repeat", () => {
    const { errors } = parsePeopleCsv("name,email,hire_date,status,type\nJohn,,,,employee\njohn,,,,employee\n");
    expect(errors[0]!.message).toMatch(/name also appears on line 2/);
  });
});
