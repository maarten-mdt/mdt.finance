import { Button, Card } from "@/components/ui";
import { adminContext, requireAdmin } from "@/lib/auth/guards";
import { listTemplates } from "@/lib/data/documents";
import { makeCurrentAction } from "./actions";
import { TemplateForm } from "./template-form";

export default async function AgreementsPage() {
  const viewer = await requireAdmin();
  const templates = await listTemplates(adminContext(viewer));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Shareholder agreement</h1>
        <p className="text-sm text-muted">
          Upload the agreement from counsel and mark it current. Then send it to each shareholder from their page in People: they
          download it, sign it, and upload the signed copy, which you confirm.
        </p>
      </div>

      <Card className="space-y-3">
        <h2 className="font-semibold">Upload a version</h2>
        <TemplateForm />
      </Card>

      <Card flush>
        <h2 className="px-4 pt-4 font-semibold sm:px-5">Versions</h2>
        {templates.length === 0 ? (
          <p className="px-4 pb-4 pt-2 text-sm text-muted sm:px-5">No agreement uploaded yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-line" data-testid="templates">
            {templates.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
                <div>
                  <div className="font-medium">
                    {t.version}
                    {t.is_current && <span className="ml-2 rounded bg-ok/10 px-1.5 py-0.5 text-xs text-ok">Current</span>}
                  </div>
                  <div className="text-xs text-muted">
                    {t.file_name} · uploaded {t.created_at.slice(0, 10)} · {t.complete} signed · {t.sent} waiting
                  </div>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <a href={`/admin/files/${t.file_id}`} className="underline-offset-4 hover:underline">
                    View PDF
                  </a>
                  {!t.is_current && (
                    <form action={makeCurrentAction}>
                      <input type="hidden" name="templateId" value={t.id} />
                      <Button type="submit" variant="secondary">
                        Make current
                      </Button>
                    </form>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
