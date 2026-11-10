"use client";
import Link from "next/link";
import { useActionState, useEffect, useMemo, useState, useTransition } from "react";
import { Alert, Button, Card } from "@/components/ui";
import { formatCents, parseDollarsToCents, pricePerShareCents } from "@/lib/calc";
import { parseSettingInput } from "@/lib/settings";
import { valuationAction, type ValuationState } from "./actions";

interface Values {
  ebitda: string;
  debt: string;
  multiple: string;
  shares: string;
}

/** Live price from the typed values, using the same calc module the server uses. */
function previewPrice(v: Values): string {
  try {
    const price = pricePerShareCents({
      ebitdaCents: parseDollarsToCents(v.ebitda),
      debtCents: parseDollarsToCents(v.debt),
      multipleX100: parseSettingInput("valuation_multiple_x100", v.multiple),
      sharesOutstanding: parseSettingInput("shares_outstanding_total", v.shares),
    });
    return formatCents(price);
  } catch {
    return "—";
  }
}

function Input({ label, name, value, onChange, disabled, suffix }: { label: string; name: string; value: string; onChange: (v: string) => void; disabled: boolean; suffix?: string }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-muted">{label}</span>
      <div className="mt-1 flex items-center rounded-lg border border-line bg-white focus-within:border-ink">
        {name !== "multiple" && name !== "shares" && <span className="pl-3 text-muted">$</span>}
        <input
          name={name}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          inputMode="decimal"
          aria-label={label}
          className="w-full min-w-0 rounded-lg bg-transparent px-2 py-2 text-base tabular-nums outline-none disabled:text-muted"
        />
        {suffix && <span className="pr-3 text-muted">{suffix}</span>}
      </div>
    </label>
  );
}

export function ValuationRowForm({
  year,
  locked,
  lockedNote,
  saved,
  initial,
  dividends,
  isLatest,
}: {
  isLatest: boolean;
  year: number;
  locked: boolean;
  lockedNote: string | null;
  saved: boolean;
  initial: Values;
  dividends: string | null;
}) {
  const [state, action, pending] = useActionState<ValuationState, FormData>(valuationAction, {});
  const [, startTransition] = useTransition();
  const [v, setV] = useState<Values>(initial);
  const initialKey = JSON.stringify(initial);
  // After a save the page re-renders with the stored values; show exactly those.
  useEffect(() => setV(JSON.parse(initialKey) as Values), [initialKey]);
  const price = useMemo(() => previewPrice(v), [v]);
  const dirty = JSON.stringify(v) !== JSON.stringify(initial);
  const set = (k: keyof Values) => (val: string) => setV((x) => ({ ...x, [k]: val }));

  return (
    <Card className={locked ? "bg-paper/60" : ""}>
      <form
        // Submitted by hand (no automatic form reset), so the controlled inputs keep their values.
        onSubmit={(e) => {
          e.preventDefault();
          const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
          if (submitter?.value === "lock" && !window.confirm(`Lock ${year} at ${price} per share? Shareholders will see it and it can't be changed.`)) {
            return;
          }
          const fd = new FormData(e.currentTarget, submitter);
          startTransition(() => action(fd));
        }}
        className="space-y-3"
        data-testid={`valuation-${year}`}
      >
        <input type="hidden" name="year" value={year} />
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold">{year}</h2>
          <div className="text-right">
            <div className="text-xl font-semibold tabular-nums" data-testid={`price-${year}`}>
              {price}
            </div>
            <div className="text-xs text-muted">
              {locked
                ? lockedNote
                : saved
                  ? dirty
                    ? "Unsaved changes"
                    : isLatest
                      ? "Draft: shareholders see this as an estimate"
                      : "Draft, not visible to shareholders"
                  : "Not entered"}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Input label="Audited EBITDA" name="ebitda" value={v.ebitda} onChange={set("ebitda")} disabled={locked} />
          <Input label="Debt" name="debt" value={v.debt} onChange={set("debt")} disabled={locked} />
          <Input label="Multiple" name="multiple" value={v.multiple} onChange={set("multiple")} disabled={locked} suffix="×" />
          <Input label="Total shares (all classes)" name="shares" value={v.shares} onChange={set("shares")} disabled={locked} />
        </div>

        {state.error && <Alert>{state.error}</Alert>}
        {state.ok && <Alert tone="ok">{state.ok}</Alert>}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-muted">
            Dividends in {year}: {dividends ?? "none"} ·{" "}
            <Link href={`/admin/dividends?year=${year}`} className="underline-offset-4 hover:underline">
              Declare a {year} dividend
            </Link>
          </div>
          {!locked && (
            <div className="flex gap-2">
              <Button type="submit" name="intent" value="save" variant="secondary" disabled={pending || price === "—"}>
                {pending ? "Saving…" : saved ? "Save changes" : "Save draft"}
              </Button>
              {saved && (
                <Button type="submit" name="intent" value="lock" disabled={pending || dirty}>
                  Lock
                </Button>
              )}
            </div>
          )}
        </div>
      </form>
    </Card>
  );
}
