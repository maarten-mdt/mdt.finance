"use client";
import Link from "next/link";
import { useActionState } from "react";
import { Alert, Button, Card, FileField } from "@/components/ui";
import { ledgerImportAction, type LedgerImportState } from "./actions";

export function LedgerImportForm() {
  const [state, action, pending] = useActionState<LedgerImportState, FormData>(ledgerImportAction, {});

  if (state.done !== undefined) {
    return (
      <Alert tone="ok">
        Recorded {state.done} share movements.{" "}
        <Link href="/admin" className="underline">
          View people
        </Link>
      </Alert>
    );
  }
  const errs = state.errors ?? [];
  return (
    <div className="space-y-4">
      {state.error && <Alert>{state.error}</Alert>}
      <form action={action} className="space-y-4">
        <FileField label="Upload a CSV file" name="file" accept=".csv,.tsv,.txt,text/csv,text/plain" />
        <label className="block">
          <span className="text-sm font-medium">Or paste the rows</span>
          <textarea
            name="pasted"
            rows={8}
            spellCheck={false}
            placeholder={"date,from,to,shares,price_per_share,amount,note\n2022-02-01,Issued by MDT,Ryan Neels,1052,0,0,Initial issuance"}
            className="mt-1 block w-full rounded-lg border border-line bg-white px-3 py-2 font-mono text-sm outline-none focus:border-ink"
          />
        </label>
        <Button type="submit" name="intent" value="preview" disabled={pending}>
          {pending ? "Reading…" : "Preview"}
        </Button>
      </form>

      {state.preview && (
        <Card className="space-y-3">
          <h2 className="font-semibold">
            Preview: {state.preview.length} rows, {errs.length} with errors
          </h2>
          {errs.length > 0 && (
            <ul className="space-y-1 text-sm text-danger" data-testid="ledger-import-errors">
              {errs.map((e) => (
                <li key={`${e.line}-${e.message}`}>
                  Line {e.line}: {e.message}
                </li>
              ))}
            </ul>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="ledger-import-preview">
              <thead className="text-left text-xs uppercase text-muted">
                <tr>
                  <th className="py-1 pr-3">Line</th>
                  <th className="py-1 pr-3">Date</th>
                  <th className="py-1 pr-3">From → to</th>
                  <th className="py-1 pr-3 text-right">Shares</th>
                  <th className="py-1 pr-3 text-right">Price</th>
                  <th className="py-1 pr-3 text-right">Paid</th>
                  <th className="py-1">Note</th>
                </tr>
              </thead>
              <tbody>
                {state.preview.map((r) => (
                  <tr key={r.line} className={`border-t border-line ${r.ok ? "" : "text-danger"}`}>
                    <td className="py-1 pr-3 text-muted">{r.line}</td>
                    <td className="py-1 pr-3 tabular-nums">{r.date}</td>
                    <td className="py-1 pr-3">
                      {r.from} → {r.to}
                    </td>
                    <td className="py-1 pr-3 text-right tabular-nums">{r.shares}</td>
                    <td className="py-1 pr-3 text-right tabular-nums">{r.price}</td>
                    <td className="py-1 pr-3 text-right tabular-nums">{r.amount}</td>
                    <td className="py-1 text-xs text-muted">{r.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <form action={action}>
            <input type="hidden" name="csv" value={state.csv ?? ""} />
            <Button type="submit" name="intent" value="apply" disabled={pending || errs.length > 0 || state.preview.length === 0}>
              {pending ? "Recording…" : `Record ${state.preview.length} movements`}
            </Button>
          </form>
        </Card>
      )}
    </div>
  );
}
