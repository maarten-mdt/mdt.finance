import { Card } from "@/components/ui";
import { adminContext, requireAdmin } from "@/lib/auth/guards";
import { withContext } from "@/lib/db";
import { SETTING_META, formatSetting } from "@/lib/settings";
import { SettingForm } from "./setting-form";

interface Row {
  key: string;
  int_value: string;
  effective_from: string;
  created_by: string;
  actor_name: string | null;
}

export default async function SettingsPage() {
  const viewer = await requireAdmin();
  const rows = (
    await withContext(adminContext(viewer), (tx) =>
      tx.query<Row>(
        `SELECT s.key, s.int_value::text, s.effective_from::text, s.created_by, p.name AS actor_name
         FROM settings s LEFT JOIN people p ON p.id::text = s.created_by
         WHERE s.int_value IS NOT NULL
         ORDER BY s.key, s.effective_from DESC`,
      ),
    )
  ).rows;
  const keys = Object.keys(SETTING_META).filter((k) => rows.some((r) => r.key === k));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Program settings</h1>
        <p className="text-sm text-muted">
          The rules the system enforces. A change applies from now on; earlier values are kept so past calculations can always be
          reproduced, and every change is in the audit log.
        </p>
      </div>
      {keys.map((key) => {
        const history = rows.filter((r) => r.key === key);
        const current = history[0]!;
        const meta = SETTING_META[key]!;
        return (
          <Card key={key} className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <h2 className="font-semibold">{meta.label}</h2>
                <p className="text-xs text-muted">{meta.help}</p>
              </div>
              <div className="text-lg font-semibold tabular-nums" data-testid={`setting-${key}`}>
                {formatSetting(key, BigInt(current.int_value))}
              </div>
            </div>
            <SettingForm settingKey={key} />
            {history.length > 1 && (
              <details className="text-xs text-muted">
                <summary className="cursor-pointer">Earlier values</summary>
                <ul className="mt-1 space-y-0.5">
                  {history.slice(1).map((h) => (
                    <li key={h.effective_from}>
                      {formatSetting(key, BigInt(h.int_value))} from {h.effective_from.slice(0, 10)} (set by {h.actor_name ?? h.created_by})
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </Card>
        );
      })}
    </div>
  );
}
