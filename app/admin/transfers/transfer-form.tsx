"use client";
import { useActionState } from "react";
import { Alert, Button, Field } from "@/components/ui";
import { transferAction, type TransferState } from "./actions";

type Option = { id: string; label: string };

function Select({ label, name, options }: { label: string; name: string; options: Option[] }) {
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      <select name={name} required className="mt-1 block w-full rounded-lg border border-line bg-white px-3 py-3 text-base">
        <option value="">Choose…</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function TransferForm({ sellers, buyers, defaultPrice, today }: { sellers: Option[]; buyers: Option[]; defaultPrice: string; today: string }) {
  const [state, action, pending] = useActionState<TransferState, FormData>(transferAction, {});
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      {state.error && (
        <div className="sm:col-span-2">
          <Alert>{state.error}</Alert>
        </div>
      )}
      {state.ok && (
        <div className="sm:col-span-2">
          <Alert tone="ok">{state.ok}</Alert>
        </div>
      )}
      <Select label="Seller" name="fromId" options={sellers} />
      <Select label="Buyer" name="toId" options={buyers} />
      <Field label="Shares" name="shares" inputMode="decimal" placeholder="26.05" required hint="Up to two decimals." />
      <Field label="Price per share ($)" name="price" inputMode="decimal" defaultValue={defaultPrice} required hint="Defaults to the latest approved price." />
      <Field label="Total paid ($, optional)" name="amount" inputMode="decimal" hint="Leave blank to use shares × price." />
      <Field label="Date of sale" name="date" type="date" defaultValue={today} required />
      <Field label="Note (optional)" name="memo" maxLength={200} />
      <div className="sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Recording…" : "Record sale"}
        </Button>
      </div>
    </form>
  );
}
