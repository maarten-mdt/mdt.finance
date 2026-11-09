import { requireAdmin } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

const TEMPLATE = [
  "name,email,hire_date,status,type",
  "Jane Doe,jane.doe@mdttac.com,2019-04-01,active,employee",
  "Sam Investor,sam@example.com,,,outside_investor",
].join("\n");

export async function GET() {
  await requireAdmin();
  return new Response(TEMPLATE + "\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="people-import-template.csv"',
      "Cache-Control": "no-store",
    },
  });
}
