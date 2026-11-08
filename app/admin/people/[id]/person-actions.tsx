"use client";
import { useActionState, useState } from "react";
import { Alert, Button } from "@/components/ui";
import { inviteAction, revealAction, type InviteState, type RevealState } from "../../actions";

export function RevealField({
  personId,
  field,
  label,
  masked,
  available,
}: {
  personId: string;
  field: "sin" | "bank";
  label: string;
  masked: string;
  available: boolean;
}) {
  const [state, action, pending] = useActionState<RevealState, FormData>(revealAction, {});
  return (
    <form action={action} className="flex items-center justify-between gap-3 border-t border-line pt-3 text-sm">
      <div>
        <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
        <div className="font-mono">{state.value ?? masked}</div>
        {state.error && <div className="text-xs text-danger">{state.error}</div>}
      </div>
      <input type="hidden" name="personId" value={personId} />
      <input type="hidden" name="field" value={field} />
      {available && !state.value && (
        <Button type="submit" variant="secondary" disabled={pending}>
          Reveal
        </Button>
      )}
    </form>
  );
}

export function InviteButton({ personId, hasAccount }: { personId: string; hasAccount: boolean }) {
  const [state, action, pending] = useActionState<InviteState, FormData>(inviteAction, {});
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-2">
      {state.error && <Alert>{state.error}</Alert>}
      {state.link ? (
        <div className="space-y-2">
          <p className="text-sm">
            Send this link to the person. It works once and expires in 72 hours.
            {hasAccount && " Using it sets a new password; their authenticator stays the same."}
          </p>
          <code data-testid="invite-link" className="block break-all rounded-lg border border-line bg-paper p-2 text-xs">
            {state.link}
          </code>
          <Button
            type="button"
            variant="secondary"
            onClick={async () => {
              await navigator.clipboard.writeText(state.link!);
              setCopied(true);
            }}
          >
            {copied ? "Copied" : "Copy link"}
          </Button>
        </div>
      ) : (
        <form action={action}>
          <input type="hidden" name="personId" value={personId} />
          <Button type="submit" disabled={pending}>
            {hasAccount ? "Create password-reset link" : "Create invite link"}
          </Button>
        </form>
      )}
    </div>
  );
}
