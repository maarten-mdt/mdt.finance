"use client";
import { useActionState, useMemo, useState } from "react";
import { formatCents, parseDollarsToCents } from "@/lib/calc";
import { Alert, Button, Field } from "@/components/ui";
import { declareAction, type DeclareState, type PreviewLine } from "./actions";

export function DeclareForm({ today, holders }: { today: string; holders: { id: string; name: string }[] }) {
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

      {p && <EditablePreview key={JSON.stringify(p.lines)} preview={p} holders={holders} pending={pending} today={today} />}
    </form>
  );
}

type Row = PreviewLine & { added?: boolean };

/**
 * The calculated split, with every amount editable so a past dividend can match what was really
 * paid. People the ledger doesn't show on the record date can be added; 0 leaves someone out.
 */
function EditablePreview({
  preview,
  holders,
  pending,
  today,
}: {
  preview: NonNullable<DeclareState["preview"]>;
  holders: { id: string; name: string }[];
  pending: boolean;
  today: string;
}) {
  const [rows, setRows] = useState<Row[]>(preview.lines);
  const [adding, setAdding] = useState("");
  const [alreadyPaid, setAlreadyPaid] = useState(false);
  const original = useMemo(() => new Map(preview.lines.map((l) => [l.holderId, l.amount])), [preview.lines]);

  const total = rows.reduce<bigint | null>((sum, r) => {
    if (sum === null) return null;
    try {
      return sum + parseDollarsToCents(r.amount.trim() || "0");
    } catch {
      return null;
    }
  }, 0n);
  const edited = rows.some((r) => r.added || original.get(r.holderId) !== r.amount);
  const available = holders.filter((h) => !rows.some((r) => r.holderId === h.id));
  const setAmount = (k: number, amount: string) => setRows((rs) => rs.map((r, i) => (i === k ? { ...r, amount } : r)));

  return (
    <div className="space-y-3 border-t border-line pt-4">
      <p className="text-sm">
        Calculated: <strong>{preview.total}</strong> to {preview.holders} shareholders on {preview.totalShares} shares, about{" "}
        <strong>{preview.rate}</strong> per share. Change any amount to match what was actually paid.
      </p>
      <div className="max-h-[32rem] overflow-auto rounded-lg border border-line">
        <table className="w-full text-sm" data-testid="dividend-preview">
          <thead className="sticky top-0 bg-white text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-3 py-2">Shareholder</th>
              <th className="px-3 py-2 text-right">Shares</th>
              <th className="px-3 py-2 text-right">Amount ($)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, k) => (
              <tr key={r.holderId} className="border-t border-line">
                <td className="px-3 py-1.5">
                  {r.name}
                  {r.isVrh && <span className="ml-1 text-xs text-muted">(VRH)</span>}
                  {r.added && <span className="ml-1 text-xs text-muted">(added)</span>}
                  {!r.added && original.get(r.holderId) !== r.amount && (
                    <span className="ml-1 text-xs text-accent">edited (was {original.get(r.holderId)})</span>
                  )}
                  <input type="hidden" name="line_holder" value={r.holderId} />
                  <input type="hidden" name="line_shares" value={r.sharesUnits} />
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">{r.shares}</td>
                <td className="px-3 py-1 text-right">
                  <input
                    name="line_amount"
                    aria-label={`Amount for ${r.name}`}
                    value={r.amount}
                    onChange={(e) => setAmount(k, e.target.value)}
                    inputMode="decimal"
                    className="w-32 rounded border border-line bg-white px-2 py-1 text-right tabular-nums"
                  />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-ink font-semibold">
              <td className="px-3 py-2">Total</td>
              <td className="px-3 py-2 text-right tabular-nums">{preview.totalShares}</td>
              <td className="px-3 py-2 text-right tabular-nums" data-testid="dividend-total">
                {total === null ? "Check the amounts" : formatCents(total)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {available.length > 0 && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="text-xs font-medium text-muted">Add someone who isn&apos;t listed</span>
            <select
              value={adding}
              onChange={(e) => setAdding(e.target.value)}
              aria-label="Add a shareholder"
              className="mt-1 block rounded-lg border border-line bg-white px-3 py-2 text-sm"
            >
              <option value="">Choose…</option>
              {available.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
          </label>
          <Button
            type="button"
            variant="secondary"
            disabled={!adding}
            onClick={() => {
              const h = holders.find((x) => x.id === adding);
              if (!h) return;
              setRows((rs) => [...rs, { holderId: h.id, name: h.name, isVrh: false, sharesUnits: "0", shares: "—", amount: "0.00", added: true }]);
              setAdding("");
            }}
          >
            Add
          </Button>
        </div>
      )}

      <label className="flex flex-wrap items-center gap-2 text-sm">
        <input type="checkbox" name="alreadyPaid" checked={alreadyPaid} onChange={(e) => setAlreadyPaid(e.target.checked)} />
        Already paid out on
        <input
          type="date"
          name="paidOn"
          defaultValue={today}
          disabled={!alreadyPaid}
          aria-label="Date paid out"
          className="rounded border border-line bg-white px-2 py-1 disabled:opacity-50"
        />
        <span className="text-xs text-muted">(for past dividends; otherwise it&apos;s held as cash until you mark it paid)</span>
      </label>

      <p className="text-xs text-muted">
        {edited
          ? "You've changed the calculated amounts; they'll be recorded exactly as entered."
          : "Amounts are in whole cents and add up exactly to the total."}{" "}
        Declaring adds each amount to the shareholder&apos;s cash balance{alreadyPaid ? " and records it as paid out" : ""}.
      </p>
      <Button type="submit" name="intent" value="confirm" disabled={pending || total === null || total <= 0n}>
        Declare {total === null ? "" : formatCents(total)} dividend
      </Button>
    </div>
  );
}
