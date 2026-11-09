"use client";
import Link from "next/link";
import { useActionState } from "react";
import { Alert, Button, Card, FileField } from "@/components/ui";
import { importAction, type ImportState } from "../actions";

export function ImportForm() {
  const [state, action, pending] = useActionState<ImportState, FormData>(importAction, {});

  if (state.result) {
    const r = state.result;
    return (
      <Alert tone="ok">
        Imported: {r.inserted} added, {r.updated} updated, {r.unchanged} unchanged.{" "}
        <Link href="/admin" className="underline">
          View people
        </Link>
      </Alert>
    );
  }

  const p = state.preview;
  return (
    <div className="space-y-4">
      {state.error && <Alert>{state.error}</Alert>}
      <form action={action} className="space-y-4">
        <FileField label="Upload a CSV file" name="file" accept=".csv,.tsv,.txt,text/csv,text/plain" />
        <div className="flex items-center gap-3 text-xs uppercase tracking-wide text-muted">
          <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
        </div>
        <label className="block">
          <span className="text-sm font-medium">Paste the rows</span>
          <textarea
            name="pasted"
            rows={8}
            spellCheck={false}
            placeholder={"name,email,hire_date,status,type\nJane Doe,jane@mdttac.com,2019-04-01,active,employee"}
            className="mt-1 block w-full rounded-lg border border-line bg-white px-3 py-2 font-mono text-sm outline-none focus:border-ink"
          />
          <span className="mt-1 block text-xs text-muted">
            Copy straight from Excel or Google Sheets (including the header row), or paste CSV text.
          </span>
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" name="intent" value="preview" disabled={pending}>
            {pending ? "Reading…" : "Preview"}
          </Button>
          <a href="/admin/import/template" className="text-sm underline-offset-4 hover:underline">
            Download a template CSV
          </a>
        </div>
      </form>

      {p && (
        <Card className="space-y-3">
          <h2 className="font-semibold">
            Preview: {p.rows.length} valid, {p.errors.length} with errors
          </h2>
          {p.errors.length > 0 && (
            <ul className="space-y-1 text-sm text-danger" data-testid="import-errors">
              {p.errors.map((e) => (
                <li key={`${e.line}-${e.message}`}>
                  Line {e.line}: {e.message}
                </li>
              ))}
            </ul>
          )}
          {p.rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted">
                  <tr>
                    <th className="py-1 pr-3">Line</th>
                    <th className="py-1 pr-3">Name</th>
                    <th className="py-1 pr-3">Email</th>
                    <th className="py-1 pr-3">Hired</th>
                    <th className="py-1 pr-3">Status</th>
                    <th className="py-1">Type</th>
                  </tr>
                </thead>
                <tbody>
                  {p.rows.slice(0, 200).map((r) => (
                    <tr key={r.line} className="border-t border-line">
                      <td className="py-1 pr-3 text-muted">{r.line}</td>
                      <td className="py-1 pr-3">{r.name}</td>
                      <td className="py-1 pr-3">{r.email}</td>
                      <td className="py-1 pr-3">{r.hireDate ?? "—"}</td>
                      <td className="py-1 pr-3">{r.status}</td>
                      <td className="py-1">{r.type}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <form action={action}>
            <input type="hidden" name="csv" value={state.csv ?? ""} />
            <Button type="submit" name="intent" value="apply" disabled={pending || p.errors.length > 0 || p.rows.length === 0}>
              {pending ? "Importing…" : `Import ${p.rows.length} people`}
            </Button>
            {p.errors.length > 0 && <p className="mt-2 text-xs text-muted">Fix the errors in your file and preview again.</p>}
          </form>
        </Card>
      )}
    </div>
  );
}
