"use client";
import { useActionState } from "react";
import { Alert, Button, Field } from "@/components/ui";
import { acceptInviteAction, type AcceptState } from "./actions";

export function AcceptForm({ token, email }: { token: string; email: string }) {
  const [state, action, pending] = useActionState<AcceptState, FormData>(acceptInviteAction, {});
  return (
    <form action={action} className="space-y-4">
      {state.error && <Alert>{state.error}</Alert>}
      <input type="hidden" name="token" value={token} />
      <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
      <Field label="Password" name="password" type="password" autoComplete="new-password" minLength={12} required hint="At least 12 characters." />
      <Field label="Confirm password" name="confirm" type="password" autoComplete="new-password" minLength={12} required />
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Creating your account…" : "Create account"}
      </Button>
    </form>
  );
}
