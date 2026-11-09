"use client";
import { useActionState } from "react";
import { Alert, Button } from "@/components/ui";
import { changeSettingAction, type SettingState } from "./actions";

export function SettingForm({ settingKey }: { settingKey: string }) {
  const [state, action, pending] = useActionState<SettingState, FormData>(changeSettingAction, {});
  return (
    <form action={action} className="space-y-2">
      {state.error && <Alert>{state.error}</Alert>}
      {state.ok && <Alert tone="ok">{state.ok}</Alert>}
      <input type="hidden" name="key" value={settingKey} />
      <div className="flex gap-2">
        <input
          name="value"
          aria-label="New value"
          required
          inputMode="decimal"
          placeholder="New value"
          className="w-40 rounded-lg border border-line bg-white px-3 py-2 text-base"
        />
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "Saving…" : "Change"}
        </Button>
      </div>
    </form>
  );
}
