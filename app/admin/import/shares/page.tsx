import Link from "next/link";
import { Card } from "@/components/ui";
import { LedgerImportForm } from "./ledger-import-form";

export default function ShareHistoryImportPage() {
  return (
    <div className="space-y-4">
      <Link href="/admin/import" className="text-sm text-muted hover:underline">
        ← Import
      </Link>
      <div>
        <h1 className="text-xl font-bold tracking-tight">Import share history</h1>
        <p className="text-sm text-muted">
          Record past share issues, purchases and sales in one go. Each row moves shares from one holder to another. Rows are
          recorded oldest first, and if any row fails nothing is recorded. Add the people first on the People import.
        </p>
      </div>
      <Card className="text-sm">
        <ul className="list-disc space-y-1 pl-5 text-muted">
          <li>
            <strong className="text-ink">date</strong>: YYYY-MM-DD
          </li>
          <li>
            <strong className="text-ink">from</strong> / <strong className="text-ink">to</strong>: holder names as on the People page.
            Use <code>Issued by MDT</code> for newly issued shares, and <code>VRH</code> or <code>Van Ruitenburg Holdings</code> for VRH.
          </li>
          <li>
            <strong className="text-ink">shares</strong>: up to two decimals, e.g. <code>26.05</code>
          </li>
          <li>
            <strong className="text-ink">price_per_share</strong>, <strong className="text-ink">amount</strong> (total actually paid; blank
            = shares × price), <strong className="text-ink">note</strong>: optional
          </li>
        </ul>
      </Card>
      <LedgerImportForm />
    </div>
  );
}
