/**
 * Staging seed: VRH, the opening-balance holder, 40 fake holders, a few people not yet
 * eligible, opening balances, a locked 2026 valuation and July 1, 2026 sales from VRH.
 * Deterministic (same data every run) and refuses to run twice or against production.
 *
 *   APP_ENV=staging npm run db:seed
 *
 * Env: DATABASE_OWNER_URL, APP_ENV (must not be "production")
 */
import { pricePerShareCents } from "@/lib/calc";
import { ownerClient } from "./lib";

const FIRST = ["Avery", "Blake", "Casey", "Devon", "Emerson", "Finley", "Gray", "Harper", "Indy", "Jordan", "Kai", "Logan",
  "Morgan", "Noel", "Oakley", "Parker", "Quinn", "Reese", "Sage", "Taylor", "Umi", "Val", "Wren", "Xen", "Yael", "Zion"];
const LAST = ["Anders", "Brooks", "Chen", "Dubois", "Evans", "Fischer", "Garcia", "Haas", "Ito", "Janssen", "Kowalski",
  "Larsen", "Moreau", "Novak", "Okafor", "Patel", "Quist", "Rossi", "Singh", "Tremblay", "Ueda", "Visser", "Weber"];

/** Small deterministic PRNG so staging data is identical on every fresh seed. */
function rng(seed: number) {
  let s = seed >>> 0;
  return (n: number) => {
    s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0;
    return s % n;
  };
}

async function main() {
  if ((process.env.APP_ENV ?? "") === "production") throw new Error("Refusing to seed production.");
  const c = await ownerClient("system:seed");
  try {
    const already = await c.query("SELECT 1 FROM people WHERE system_key = 'vrh'");
    if (already.rowCount) throw new Error("Already seeded (VRH exists). Seed a fresh database instead.");

    await c.query("BEGIN");
    const ins = async (type: string, name: string, email: string | null, hire: string | null, status: string, key: string | null = null) =>
      (
        await c.query<{ id: string }>(
          "INSERT INTO people (type, name, email, hire_date, status, system_key) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
          [type, name, email, hire, status, key],
        )
      ).rows[0]!.id;

    const opening = await ins("system", "Opening balance (pre-system)", null, null, "not_applicable", "opening_balance");
    const vrh = await ins("entity", "Van Ruitenburg Holdings Ltd.", null, null, "not_applicable", "vrh");

    // VRH's holding of the new class before the first July 1 (SPEC open decision: issued or converted).
    await c.query(
      `INSERT INTO share_ledger (entry_date, type, from_holder_id, to_holder_id, shares, price_cents, memo)
       VALUES ('2026-06-30', 'opening_balance', $1, $2, 200000, 0, 'Staging seed: VRH holding of the new class')`,
      [opening, vrh],
    );

    // A locked 2026 valuation: (7 × $4,200,000 − $3,500,000) ÷ 1,000,000 shares.
    const valuation = { ebitdaCents: 420_000_000n, debtCents: 350_000_000n, multipleX100: 700n, sharesOutstanding: 1_000_000n };
    const price = pricePerShareCents(valuation);
    const cycle = (
      await c.query<{ id: string }>(
        `INSERT INTO cycles (year, ebitda_cents, debt_cents, multiple_x100, shares_outstanding, price_per_share_cents,
                             window_opens_on, window_closes_on, settlement_date, status, locked_by, locked_at)
         VALUES (2026, $1, $2, $3, $4, $5, '2026-05-15', '2026-06-15', '2026-07-01', 'settled', 'system:seed', '2026-05-01')
         RETURNING id`,
        [valuation.ebitdaCents, valuation.debtCents, valuation.multipleX100, valuation.sharesOutstanding, price].map(String),
      )
    ).rows[0]!.id;

    const rand = rng(20261106);
    const used = new Set<string>();
    let holders = 0;
    for (let i = 0; i < 46; i++) {
      let first: string, last: string;
      do {
        first = FIRST[rand(FIRST.length)]!;
        last = LAST[rand(LAST.length)]!;
      } while (used.has(first + last));
      used.add(first + last);
      const name = `${first} ${last}`;
      const email = `${first}.${last}@example.com`.toLowerCase();

      if (i < 3) {
        // Outside investors invited by Maarten.
        const id = await ins("outside_investor", name, email, null, "not_applicable");
        await sale(id, 400n + BigInt(rand(400)));
        holders++;
      } else if (i < 43) {
        // 40 employees: hired 2008–2021, so all have 4+ years by July 2026. 37 hold shares.
        const hire = `${2008 + rand(14)}-${String(1 + rand(12)).padStart(2, "0")}-${String(1 + rand(28)).padStart(2, "0")}`;
        const id = await ins("employee", name, email, hire, "active");
        if (i < 40) {
          if (rand(3) === 0) {
            // Some bought before the portal existed: an opening balance at an older price.
            await c.query(
              `INSERT INTO share_ledger (entry_date, type, from_holder_id, to_holder_id, shares, price_cents, memo)
               VALUES ('2025-07-01', 'opening_balance', $1, $2, $3, 1850, 'Staging seed: pre-system purchase')`,
              [opening, id, String(20 + rand(200))],
            );
          }
          await sale(id, 20n + BigInt(rand(380)));
          holders++;
        }
      } else {
        // Not eligible yet: hired recently.
        await ins("employee", name, email, `2024-${String(1 + rand(12)).padStart(2, "0")}-15`, "active");
      }
    }

    async function sale(personId: string, shares: bigint) {
      await c.query(
        `INSERT INTO share_ledger (entry_date, type, from_holder_id, to_holder_id, shares, price_cents, cycle_id)
         VALUES ('2026-07-01', 'vrh_sale', $1, $2, $3, $4, $5)`,
        [vrh, personId, shares.toString(), price.toString(), cycle],
      );
    }

    await c.query("COMMIT");
    const vrhLeft = (await c.query<{ shares: string }>("SELECT shares::text FROM holdings WHERE holder_id = $1", [vrh])).rows[0]!.shares;
    console.log(`Seeded VRH (${vrhLeft} shares left), ${holders} fake holders, 3 not-yet-eligible employees.`);
    console.log(`2026 price per share: $${(price / 100n).toString()}.${(price % 100n).toString().padStart(2, "0")}`);
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    await c.end();
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
