"use client";
import { useActionState } from "react";
import { Alert, Button, Field, FileField } from "@/components/ui";
import { addTemplateAction, type DocState } from "./actions";

export function TemplateForm() {
  const [state, action, pending] = useActionState<DocState, FormData>(addTemplateAction, {});
  return (
    <form action={action} className="space-y-3">
      {state.error && <Alert>{state.error}</Alert>}
      {state.ok && <Alert tone="ok">{state.ok}</Alert>}
      <Field label="Version name" name="version" placeholder="v1 — March 2027" required maxLength={80} />
      <FileField label="Agreement (PDF, up to 10 MB)" name="file" accept="application/pdf,.pdf" required />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="current" defaultChecked /> Make this the current version (the one sent to people)
      </label>
      <Button type="submit" disabled={pending}>
        {pending ? "Uploading…" : "Upload"}
      </Button>
    </form>
  );
}
