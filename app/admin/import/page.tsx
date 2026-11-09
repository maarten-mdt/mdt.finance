import { Card } from "@/components/ui";
import { ImportForm } from "./import-form";

export default function ImportPage() {
  return (
    <div className="space-y-4">
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-xl font-bold tracking-tight">Import people</h1>
          <a href="/admin/import/shares" className="text-sm font-medium underline-offset-4 hover:underline">
            Import share history →
          </a>
        </div>
        <p className="text-sm text-muted">
          Upload a CSV with the columns <code>name, email, hire_date, status, type</code> (and optionally <code>contact_name</code>). People are matched by email: new
          emails are added and existing people are updated. Nothing is saved until you confirm the preview.
        </p>
      </div>
      <Card className="text-sm">
        <ul className="list-disc space-y-1 pl-5 text-muted">
          <li>
            <strong className="text-ink">type</strong>: <code>employee</code>, <code>outside_investor</code> or <code>company</code> (with <code>contact_name</code>: the person who signs in)
          </li>
          <li>
            <strong className="text-ink">hire_date</strong>: YYYY-MM-DD, or blank if not known yet
          </li>
          <li>
            <strong className="text-ink">status</strong>: <code>active</code>, <code>leave</code> or <code>departed</code> (employees)
          </li>
        </ul>
      </Card>
      <ImportForm />
    </div>
  );
}
