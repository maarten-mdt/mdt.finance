# mdt.finance

Employee shareholder portal. The product brief is `SPEC.md` (source: Google Drive folder "MDT.Finance"); keep it updated as open decisions close. `README.md` covers layout, running, testing and deploying.

All hosting, database (Railway Postgres) and file storage live on Railway; do not use Vercel or Supabase. Railway's `railway.json` is deprecated: deploy settings live on the Railway service (see README).

## Non-negotiable rules
1. Money is integer cents and share quantities are integer hundredths of a share (`bigint`; 26.05 shares = 2605). No floats in money or share math (the XIRR rate is the one float, never used for money). Total shares outstanding (price denominator) stays in whole shares.
2. `share_ledger` and `credit_ledger` are append-only (triggers). Corrections are reversing entries. Holdings are computed from the ledgers.
3. VRH is a normal holder record; every share movement is holder → holder.
4. RLS on every table; holders read only their own rows; all writes go through server code via `withContext`.
5. MFA mandatory for everyone, passkeys for admins, sessions time out.
6. SIN/banking encrypted at field level, masked by default, every reveal audit-logged.
7. `audit_log` covers every write and is append-only.
8. Program rule values live in the `settings` table, never in code.
9. Every calculation lives in `lib/calc` with unit tests before the UI uses it.

## Checks before pushing
`npm run typecheck`, `npm test` (needs local Postgres, see README), `npm run test:e2e` for UI changes.

## Workflow preferences
- After opening a pull request, merge it automatically once it is mergeable (no conflicts, checks green) — no need to ask first.
- Railway deploys `main` to production at mdt.finance. Don't merge app changes to `main` until production has its Postgres and variables configured.
