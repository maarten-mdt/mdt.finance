"use client";
import { useActionState, useState } from "react";
import { Alert, Button, Card, Field } from "@/components/ui";
import { personMovementAction, updatePersonAction, type PersonFormState } from "./actions";

const selectCls = "mt-1 block w-full rounded-lg border border-line bg-white px-3 py-3 text-base";

export interface PersonEditable {
  id: string;
  name: string;
  type: "employee" | "outside_investor" | "entity" | "system";
  email: string | null;
  contactName: string | null;
  hireDate: string | null;
  status: string;
  isVrh: boolean;
}

export function PersonDetailsForm({ p }: { p: PersonEditable }) {
  const [state, action, pending] = useActionState<PersonFormState, FormData>(updatePersonAction, {});
  const [type, setType] = useState(p.type === "system" ? "entity" : p.type);
  return (
    <Card>
      <details open={!p.email && !p.isVrh}>
        <summary className="cursor-pointer font-semibold">Edit details</summary>
        <form action={action} className="mt-4 grid gap-3 sm:grid-cols-2">
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
          <input type="hidden" name="personId" value={p.id} />
          <Field label={type === "entity" ? "Company name" : "Full name"} name="name" defaultValue={p.name} required />
          <label className="block">
            <span className="text-sm font-medium">Type</span>
            <select name="type" value={type} onChange={(e) => setType(e.target.value as typeof type)} disabled={p.isVrh} className={selectCls}>
              <option value="employee">Employee</option>
              <option value="outside_investor">Outside investor</option>
              <option value="entity">Company (with a contact person)</option>
            </select>
            {p.isVrh && <input type="hidden" name="type" value="entity" />}
          </label>
          {type === "entity" && <Field label="Contact person (signs in)" name="contactName" defaultValue={p.contactName ?? ""} />}
          <Field
            label={type === "entity" ? "Contact's email" : "Email"}
            name="email"
            type="email"
            defaultValue={p.email ?? ""}
            hint="Needed to send an invite."
          />
          {type === "employee" && (
            <>
              <Field label="Hire date" name="hireDate" type="date" defaultValue={p.hireDate ?? ""} />
              <label className="block">
                <span className="text-sm font-medium">Status</span>
                <select name="status" defaultValue={p.status === "not_applicable" ? "active" : p.status} className={selectCls}>
                  <option value="active">Active</option>
                  <option value="leave">On leave</option>
                  <option value="departed">Departed</option>
                </select>
              </label>
            </>
          )}
          <div className="sm:col-span-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save details"}
            </Button>
          </div>
        </form>
      </details>
    </Card>
  );
}

export function ShareMoveForm({
  personId,
  personName,
  sources,
  destinations,
  defaultPrice,
  today,
}: {
  personId: string;
  personName: string;
  sources: { id: string; label: string }[];
  destinations: { id: string; label: string }[];
  defaultPrice: string;
  today: string;
}) {
  const [state, action, pending] = useActionState<PersonFormState, FormData>(personMovementAction, {});
  const [direction, setDirection] = useState<"add" | "remove">("add");
  const options = direction === "add" ? sources : destinations;
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2" data-testid="share-move-form">
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
      <input type="hidden" name="personId" value={personId} />
      <fieldset className="flex flex-wrap gap-4 text-sm sm:col-span-2">
        <legend className="sr-only">Add or remove</legend>
        <label className="flex items-center gap-2">
          <input type="radio" name="direction" value="add" checked={direction === "add"} onChange={() => setDirection("add")} />
          Add shares to {personName}
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="direction" value="remove" checked={direction === "remove"} onChange={() => setDirection("remove")} />
          Remove shares from {personName}
        </label>
      </fieldset>
      <label className="block sm:col-span-2">
        <span className="text-sm font-medium">{direction === "add" ? "From" : "To"}</span>
        <select key={direction} name="otherId" required aria-label={direction === "add" ? "From" : "To"} className={selectCls}>
          <option value="">Choose…</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <Field label="Shares" name="shares" inputMode="decimal" placeholder="26.05" required hint="Up to two decimals." />
      <Field label="Price per share ($)" name="price" inputMode="decimal" defaultValue={defaultPrice} hint="0 for shares issued at no cost." />
      <Field label="Total paid ($, optional)" name="amount" inputMode="decimal" hint="Leave blank to use shares × price." />
      <Field label="Date" name="date" type="date" defaultValue={today} required />
      <div className="sm:col-span-2">
        <Field label="Note (optional)" name="memo" maxLength={200} />
      </div>
      <div className="sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : direction === "add" ? "Add shares" : "Remove shares"}
        </Button>
      </div>
    </form>
  );
}
