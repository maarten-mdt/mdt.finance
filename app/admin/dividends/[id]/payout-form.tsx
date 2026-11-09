"use client";
import Link from "next/link";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { Alert, Button, Card, Field } from "@/components/ui";
import { markPaidAction, type PayState } from "../actions";

export interface PayoutRow {
  id: string;
  personId: string;
  name: string;
  isVrh: boolean;
  bank: string;
  shares: string;
  amount: string;
  paidOn: string | null;
}

export function PayoutForm({ dividendId, today, rows }: { dividendId: string; today: string; rows: PayoutRow[] }) {
  const [state, action, pending] = useActionState<PayState, FormData>(markPaidAction, {});
  const [, startTransition] = useTransition();
  const unpaid = rows.filter((r) => !r.paidOn);
  const unpaidKey = unpaid.map((r) => r.id).join(",");
  // Everyone unpaid starts ticked. After a payment run, whoever is left was deliberately kept
  // as cash, so start them unticked.
  const [picked, setSelected] = useState<Set<string>>(() => new Set(unpaid.map((r) => r.id)));
  const firstKey = useRef(unpaidKey);
  useEffect(() => {
    if (unpaidKey !== firstKey.current) setSelected(new Set());
  }, [unpaidKey]);
  const unpaidIds = new Set(unpaid.map((r) => r.id));
  const selected = new Set([...picked].filter((id) => unpaidIds.has(id)));
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <form
      // Submit without the automatic form reset, which would desync the controlled checkboxes.
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(() => action(fd));
      }}
      className="space-y-4"
    >
      <input type="hidden" name="dividendId" value={dividendId} />
      {state.error && <Alert>{state.error}</Alert>}
      {state.ok && <Alert tone="ok">{state.ok}</Alert>}

      {unpaid.length > 0 && (
        <Card className="space-y-3">
          <h2 className="font-semibold">Mark as paid</h2>
          <p className="text-sm text-muted">
            Tick everyone the company has paid. Leave someone unticked if they&apos;re keeping it as cash toward a future share
            purchase.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-48">
              <Field label="Date paid" name="paidOn" type="date" defaultValue={today} required />
            </div>
            <Button type="submit" disabled={pending || selected.size === 0}>
              {pending ? "Saving…" : `Mark ${selected.size} as paid`}
            </Button>
          </div>
        </Card>
      )}

      <Card flush className="overflow-x-auto">
        <table className="w-full text-sm" data-testid="allocations">
          <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="w-10 px-4 py-3">
                {unpaid.length > 0 && (
                  <input
                    type="checkbox"
                    aria-label="Select all unpaid"
                    checked={selected.size === unpaid.length && unpaid.length > 0}
                    onChange={(e) => setSelected(e.target.checked ? new Set(unpaid.map((r) => r.id)) : new Set())}
                  />
                )}
              </th>
              <th className="px-4 py-3">Shareholder</th>
              <th className="px-4 py-3 text-right">Shares</th>
              <th className="px-4 py-3 text-right">Amount</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-line last:border-0">
                <td className="px-4 py-2.5">
                  {!r.paidOn && (
                    <input
                      type="checkbox"
                      name="allocationId"
                      value={r.id}
                      aria-label={`Paid: ${r.name}`}
                      checked={selected.has(r.id)}
                      onChange={() => toggle(r.id)}
                    />
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <Link href={`/admin/people/${r.personId}`} className="hover:underline">
                    {r.name}
                  </Link>
                  {r.isVrh && <span className="ml-1 text-xs text-muted">(VRH)</span>}
                  <div className="text-xs text-muted">{r.bank}</div>
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">{r.shares}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{r.amount}</td>
                <td className="px-4 py-2.5 text-xs">{r.paidOn ? `Paid ${r.paidOn}` : <span className="text-muted">Held as cash</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </form>
  );
}
