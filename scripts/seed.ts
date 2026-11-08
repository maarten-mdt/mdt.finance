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
    if (already.rowCount) {
      if (!process.argv.includes("--history")) throw new Error("Already seeded (VRH exists). Seed a fresh database instead.");
      await addHistory(c);
      await addTestPeople(c);
      return;
    }

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
    await addHistory(c);
    await addTestPeople(c);
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

/**
 * Staging history, added once (idempotent): locked prices for 2021–2025, two dividends with
 * some paid out and some still held as cash, and a sample position for the bootstrap admin
 * so their own dashboard has something to show.
 */
async function addHistory(c: Client) {
  if ((await c.query("SELECT 1 FROM cycles WHERE year = 2021")).rowCount) {
    console.log("seed history: already added, skipping");
    return;
  }
  await c.query("BEGIN");
  try {
    const shares = 1_000_000n;
    const debt = 350_000_000n;
    for (const [year, price] of [[2021, 1140n], [2022, 1280n], [2023, 1495n], [2024, 1660n], [2025, 1850n]] as const) {
      // Smallest EBITDA that produces exactly this price with the 7× formula.
      const num = 100n * shares * price + 100n * debt;
      const ebitda = (num + 699n) / 700n;
      if (pricePerShareCents({ ebitdaCents: ebitda, debtCents: debt, multipleX100: 700n, sharesOutstanding: shares }) !== price) {
        throw new Error(`seed history: can't reproduce ${year} price`);
      }
      await c.query(
        `INSERT INTO cycles (year, ebitda_cents, debt_cents, multiple_x100, shares_outstanding, price_per_share_cents,
                             window_opens_on, window_closes_on, settlement_date, status, locked_by, locked_at)
         VALUES ($1, $2, $3, 700, $4, $5, $6, $7, $8, 'settled', 'system:seed', $9)`,
        [year, ebitda.toString(), debt.toString(), shares.toString(), price.toString(),
         `${year}-05-15`, `${year}-06-15`, `${year}-07-01`, `${year}-05-01`],
      );
    }

    // Sample position for the staging admin (e.g. the person created by BOOTSTRAP_ADMIN_EMAIL).
    const adminEmail = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
    if (adminEmail) {
      const person = (await c.query<{ id: string }>("SELECT id FROM people WHERE email = $1", [adminEmail])).rows[0];
      if (person) await addSamplePosition(c, person.id, [["2021-07-01", 200, 1140], ["2023-07-01", 150, 1495], ["2025-07-01", 100, 1850]], 120, 1830);
    }

    // Dividends to individual holders (not VRH) by shares held on the record date.
    const dividends = [
      { declared: "2025-12-15", record: "2025-11-30", perShare: 35n, payoutOn: "2026-01-15" },
      { declared: "2026-10-15", record: "2026-09-30", perShare: 60n, payoutOn: null },
    ];
    for (const [k, dv] of dividends.entries()) {
      const holders = (
        await c.query<{ holder_id: string; shares: string }>(
          `SELECT m.holder_id, sum(m.delta)::text AS shares
           FROM (SELECT to_holder_id AS holder_id, shares AS delta, entry_date FROM share_ledger
                 UNION ALL SELECT from_holder_id, -shares, entry_date FROM share_ledger) m
           JOIN people p ON p.id = m.holder_id AND p.system_key IS NULL
           WHERE m.entry_date <= $1
           GROUP BY m.holder_id HAVING sum(m.delta) > 0
           ORDER BY m.holder_id`,
          [dv.record],
        )
      ).rows;
      if (!holders.length) continue;
      const total = holders.reduce((a, h) => a + BigInt(h.shares) * dv.perShare, 0n);
      const id = (
        await c.query<{ id: string }>(
          `INSERT INTO dividends (declaration_date, record_date, amount_per_share_cents, total_cents, declared_by)
           VALUES ($1, $2, $3, $4, 'system:seed') RETURNING id`,
          [dv.declared, dv.record, dv.perShare.toString(), total.toString()],
        )
      ).rows[0]!.id;
      for (const [i, h] of holders.entries()) {
        const amount = BigInt(h.shares) * dv.perShare;
        // First dividend: every other holder had theirs paid out; the rest is still held as cash.
        const paid = dv.payoutOn !== null && (i + k) % 2 === 0;
        await c.query(
          `INSERT INTO dividend_allocations (dividend_id, person_id, shares_on_record_date, amount_cents, disposition)
           VALUES ($1, $2, $3, $4, $5)`,
          [id, h.holder_id, h.shares, amount.toString(), paid ? "paid_out" : "pending"],
        );
        await c.query(
          "INSERT INTO credit_ledger (entry_date, person_id, type, amount_cents, dividend_id) VALUES ($1, $2, 'dividend', $3, $4)",
          [dv.declared, h.holder_id, amount.toString(), id],
        );
        if (paid) {
          await c.query(
            "INSERT INTO credit_ledger (entry_date, person_id, type, amount_cents, dividend_id) VALUES ($1, $2, 'payout', $3, $4)",
            [dv.payoutOn, h.holder_id, (-amount).toString(), id],
          );
        }
      }
    }
    await c.query("COMMIT");
    console.log("seed history: added 2021–2025 prices and two dividends");
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  }
}

type Client = Awaited<ReturnType<typeof ownerClient>>;

/** Give a staging person earlier purchases, a 2026 purchase from VRH and some leftover cash, once. */
async function addSamplePosition(
  c: Client,
  personId: string,
  earlier: readonly (readonly [string, number, number])[],
  sharesIn2026: number,
  leftoverCents: number,
) {
  if ((await c.query("SELECT 1 FROM share_ledger WHERE to_holder_id = $1", [personId])).rowCount) return;
  for (const [date, n, price] of earlier) {
    await c.query(
      `INSERT INTO share_ledger (entry_date, type, from_holder_id, to_holder_id, shares, price_cents, memo)
       SELECT $1, 'opening_balance', id, $2, $3, $4, 'Staging seed: sample history' FROM people WHERE system_key = 'opening_balance'`,
      [date, personId, n, price],
    );
  }
  await c.query(
    `INSERT INTO share_ledger (entry_date, type, from_holder_id, to_holder_id, shares, price_cents, cycle_id)
     SELECT '2026-07-01', 'vrh_sale', v.id, $1, $2, cy.price_per_share_cents, cy.id
     FROM people v, cycles cy WHERE v.system_key = 'vrh' AND cy.year = 2026`,
    [personId, sharesIn2026],
  );
  await c.query(
    "INSERT INTO credit_ledger (entry_date, person_id, type, amount_cents, cycle_id) SELECT '2026-07-01', $1, 'leftover_cash', $2, id FROM cycles WHERE year = 2026",
    [personId, leftoverCents],
  );
}

/**
 * Staging test accounts from SEED_TEST_PEOPLE ("Name|email;Name|email"). Each is created once as
 * an active employee with a sample position and their share of the 2026 dividend. An admin then
 * sends each their invite link from the admin console. Idempotent.
 */
async function addTestPeople(c: Client) {
  const list = (process.env.SEED_TEST_PEOPLE ?? "")
    .split(";")
    .map((x) => x.split("|").map((y) => y.trim()))
    .filter((x): x is [string, string] => x.length === 2 && !!x[0] && !!x[1]);
  for (const [name, rawEmail] of list) {
    const email = rawEmail.toLowerCase();
    await c.query("BEGIN");
    try {
      let id = (await c.query<{ id: string }>("SELECT id FROM people WHERE email = $1", [email])).rows[0]?.id;
      if (!id) {
        id = (
          await c.query<{ id: string }>(
            "INSERT INTO people (type, name, email, hire_date, status) VALUES ('employee', $1, $2, '2018-03-01', 'active') RETURNING id",
            [name, email],
          )
        ).rows[0]!.id;
        console.log(`test people: created ${name} <${email}>`);
      }
      const had = (await c.query("SELECT 1 FROM share_ledger WHERE to_holder_id = $1", [id])).rowCount;
      if (!had) {
        await addSamplePosition(c, id, [["2022-07-01", 120, 1280], ["2024-07-01", 80, 1660]], 60, 960);
        // Their share of the 2026 dividend, still held as cash.
        const dv = (await c.query<{ id: string; per: string; declared: string }>(
          "SELECT id, amount_per_share_cents::text AS per, declaration_date::text AS declared FROM dividends WHERE record_date = '2026-09-30'",
        )).rows[0];
        if (dv) {
          const amount = 260n * BigInt(dv.per); // 120 + 80 + 60 shares on the record date
          await c.query(
            "INSERT INTO dividend_allocations (dividend_id, person_id, shares_on_record_date, amount_cents) VALUES ($1, $2, 260, $3)",
            [dv.id, id, amount.toString()],
          );
          await c.query(
            "INSERT INTO credit_ledger (entry_date, person_id, type, amount_cents, dividend_id) VALUES ($1, $2, 'dividend', $3, $4)",
            [dv.declared, id, amount.toString(), dv.id],
          );
        }
        console.log(`test people: gave ${name} a sample position`);
      }
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK").catch(() => {});
      throw e;
    }
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
