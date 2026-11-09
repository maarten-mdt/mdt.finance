# mdt.finance

Private shareholder portal for MDT's non-voting share class. The product brief is in [SPEC.md](SPEC.md).
This is **Phase 1 (Foundation)**: sign-in with mandatory MFA, people import, the ledgers, the audit log
and a read-only holder dashboard.

## Stack

- Next.js 16 (App Router, strict TypeScript), Tailwind 4, mobile-first
- Railway: app service + Postgres (and later a storage bucket)
- Better Auth: email + password, mandatory TOTP, passkeys for admins
- Vitest (unit + real-Postgres tests), Playwright (end-to-end)

## Layout

```
app/                 pages: / (public), /login, /invite/[token], /mfa/*, /dashboard, /admin/*
lib/calc/            every calculation; pure functions, bigint cents and whole shares
lib/auth/            Better Auth config, session guards, security constants
lib/db/              withContext(): one transaction per request with person/actor/admin set for RLS + audit
lib/data/            queries for the holder dashboard and the admin console
lib/crypto/          AES-256-GCM field encryption + masking for SIN and banking
db/migrations/       numbered SQL migrations (schema, triggers, RLS)
scripts/             migrate, seed, create-admin, release (Railway pre-deploy)
tests/unit, tests/db, tests/e2e
```

## How the rules are enforced

| Rule | Where |
| --- | --- |
| Integer cents and whole shares | `bigint` columns; `lib/calc` uses `bigint` only; pg returns int8 as strings |
| Ledgers append-only | `app.append_only()` triggers block UPDATE/DELETE/TRUNCATE; `app_user` has no UPDATE/DELETE grant |
| Holdings computed, never stored | `holdings` and `credit_balances` views; `app.my_share_balance()` |
| VRH is a holder | `people.system_key = 'vrh'`; every `share_ledger` row has `from_holder_id` and `to_holder_id` |
| RLS everywhere | forced on every table; holders read only their own rows and can't write; `app.is_admin()` also checks `user_roles` |
| MFA, admin passkeys, timeouts | `lib/auth/guards.ts`, `proxy.ts`, `lib/auth/config.ts` |
| Encrypted SIN/banking, logged reveals | `lib/crypto/fields.ts`; `logReveal()` writes the audit row in the same transaction |
| Audit log | `app.audit_row()` trigger on every table, append-only, ciphertext redacted |
| Rule values in settings | `settings` table (effective-dated); read via `current_settings` |

## Run locally

Needs Node 22+ and Postgres 16+.

```bash
npm install
```

```bash
cp .env.example .env.local
```

Fill in `BETTER_AUTH_SECRET` and `FIELD_ENCRYPTION_KEY` (any 32 random bytes, base64):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Create the database, migrate, seed and make yourself an admin:

```bash
createdb mdt_finance
```

```bash
export DATABASE_OWNER_URL=postgres://postgres@localhost:5432/mdt_finance APP_DB_PASSWORD=app_user AUTH_DB_PASSWORD=auth_service BETTER_AUTH_URL=http://localhost:3000
```

```bash
npm run db:migrate && npm run db:seed
```

```bash
npm run admin:create -- --email you@example.com --name "You" --hire-date 2015-01-01
```

Set `DATABASE_URL` / `AUTH_DATABASE_URL` in `.env.local` to the `app_user` / `auth_service` roles with the passwords above, then:

```bash
npm run dev
```

Open the printed invite link, set a password, set up TOTP, then visit `/admin` to add a passkey.
Passkeys work on `localhost`; elsewhere they need HTTPS on the domain in `PASSKEY_RP_ID`.

## Tests

```bash
npm run typecheck
```

```bash
npm test
```

```bash
npm run test:e2e
```

`npm test` runs the unit tests and the database tests. The database tests create and drop throwaway
databases on the server in `TEST_DATABASE_ADMIN_URL` (default `postgres://postgres@localhost:5433/postgres`).
The e2e tests build the app and use `E2E_DATABASE_SERVER` (default `postgres://localhost:5433`).

## Deploy (Railway)

Project **MDT.finance**, environments **staging** and **production**, services **mdt.finance** (app) and **Postgres**.
Railway's `railway.json` is deprecated, so these service settings live in Railway:

- Pre-deploy command: `npm run release` (migrations; on staging also the one-time seed and admin bootstrap)
- Start command: `npm start` · Healthcheck path: `/`

App service variables:

| Variable | Value |
| --- | --- |
| `PORT` | `8080` |
| `APP_ENV` | `staging` or `production` |
| `DATABASE_OWNER_URL` | `${{Postgres.DATABASE_URL}}` |
| `APP_DB_PASSWORD`, `AUTH_DB_PASSWORD` | random, distinct |
| `DATABASE_URL` | `postgresql://app_user:${{APP_DB_PASSWORD}}@${{Postgres.RAILWAY_PRIVATE_DOMAIN}}:5432/${{Postgres.POSTGRES_DB}}` |
| `AUTH_DATABASE_URL` | same with `auth_service:${{AUTH_DB_PASSWORD}}` |
| `BETTER_AUTH_SECRET`, `FIELD_ENCRYPTION_KEY` | 32 random bytes, base64. **Back up the encryption key**: losing it loses every SIN and bank detail |
| `BETTER_AUTH_URL`, `PASSKEY_ORIGIN` | `https://<domain>` |
| `PASSKEY_RP_ID` | `<domain>` (`mdt.finance` in production) |
| `SEED_ON_DEPLOY` | `true` on staging only |
| `BOOTSTRAP_ADMIN_EMAIL`, `_NAME`, `_HIRE_DATE` | optional: first admin; the invite link is printed in the deploy log |
| `RECOVER_ACCOUNT` | optional lock-out recovery: `email:one-time-code`. The next deploy clears that account's two-step sign-in, passkeys and sessions and prints a reset link in the deploy log. Each code works once; remove the variable afterwards |

Staging: https://staging.mdt.finance (Cloudflare CNAME `staging`, proxied, to the Railway staging service)
