"use client";
import { useActionState, useState } from "react";
import { Alert, Button, Field } from "@/components/ui";
import { declareAction, type DeclareState } from "./actions";

export function DeclareForm({ today }: { today: string }) {
  const [state, action, pending] = useActionState<DeclareState, FormData>(declareAction, {});
  const v = state.values;
  const [mode, setMode] = useState(v?.mode ?? "total");
  const p = state.preview;

  return (
    <form action={action} className="space-y-4">
      {state.error && <Alert>{state.error}</Alert>}

      <fieldset className="flex flex-wrap gap-4 text-sm">
        <legend className="sr-only">How to enter the dividend</legend>
        {[
          ["total", "Total to pay out"],
          ["per_share", "Amount per share"],
        ].map(([value, label]) => (
          <label key={value} className="flex items-center gap-2">
            <input type="radio" name="mode" value={value} checked={mode === value} onChange={() => setMode(value!)} />
            {label}
          </label>
        ))}
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label={mode === "total" ? "Total dividend ($)" : "Amount per share ($)"}
          name="amount"
          inputMode="decimal"
          placeholder={mode === "total" ? "25,000.00" : "0.35"}
          defaultValue={v?.amount}
          required
        />
        <Field label="Record date" name="recordDate" type="date" defaultValue={v?.recordDate ?? today} required hint="Paid on shares held at the end of this day." />
        <Field label="Declaration date" name="declarationDate" type="date" defaultValue={v?.declarationDate ?? today} required />
        <Field label="Note (optional)" name="memo" maxLength={200} defaultValue={v?.memo} placeholder="e.g. 2026 year-end dividend" />
      </div>

      <Button type="submit" name="intent" value="preview" variant="secondary" disabled={pending}>
        {pending ? "Calculating…" : "Calculate"}
      </Button>

      {p && (
        <div className="space-y-3 border-t border-line pt-4">
          <p className="text-sm">
            <strong>{p.total}</strong> to {p.holders} shareholders on {p.totalShares} shares, about <strong>{p.rate}</strong> per share.
          </p>
          <div className="max-h-96 overflow-auto rounded-lg border border-line">
            <table className="w-full text-sm" data-testid="dividend-preview">
              <thead className="sticky top-0 bg-white text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-2">Shareholder</th>
                  <th className="px-3 py-2 text-right">Shares</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {p.lines.map((l, i) => (
                  <tr key={i} className="border-t border-line">
                    <td className="px-3 py-1.5">
                      {l.name}
                      {l.isVrh && <span className="ml-1 text-xs text-muted">(VRH)</span>}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{l.shares}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{l.amount}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-ink font-semibold">
                  <td className="px-3 py-2">Total</td>
                  <td className="px-3 py-2 text-right tabular-nums">{p.totalShares}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{p.total}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="text-xs text-muted">
            Amounts are in whole cents and add up exactly to the total. Declaring adds each amount to the shareholder&apos;s cash
            balance; nothing is paid until you mark it paid.
          </p>
          <Button type="submit" name="intent" value="confirm" disabled={pending}>
            Declare {p.total} dividend
          </Button>
        </div>
      )}
    </form>
  );
}
