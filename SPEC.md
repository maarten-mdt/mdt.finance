# mdt.finance — Employee Shareholder Portal Brief

Nov 6, 2026 · @Maarten

## Summary

mdt.finance is a private web portal where eligible people buy, hold and sell MDT's new non-voting share class. Two groups use it: employees with 4+ years of service, and outside investors Maarten invites. Each holder sees their shares, current value, dividends and return. Admins run one transaction date a year (July 1), declare dividends, handle buybacks and produce the lawyer package. It is built in-house with Claude Code instead of using Carta, for dozens of holders. Van Ruitenburg Holdings Ltd. (VRH) is the counterparty on both sides: it sells shares to buyers and buys back shares from departing holders. MDT itself never issues or redeems shares through this system.

**In scope:** holder portal, onboarding with Adobe Sign, annual pricing and order matching, share ledger, dividend allocation, departure buybacks, document packages for counsel.

**Out of scope:** moving money (EFT and payroll happen outside the system; admins confirm receipt), filing tax slips, any order book visible to other holders.

## Program rules

These are the business rules the software enforces. Each number is an admin setting, not hard-coded, because the shareholder agreement will change over time.

| Rule | Setting |
| --- | --- |
| Share class | New non-voting class, created by counsel |
| Eligibility | Employees with 4+ years of continuous service; outside investors only by Maarten's invitation |
| Price per share | (7 × audited EBITDA − debt) ÷ shares outstanding, set once a year |
| Audit timing | Audited financials final in April |
| Transaction date | July 1 each year; every buy, sell and issuance settles that day |
| Purchase size | Minimum $1,000, maximum $10,000 per transaction, lump sum |
| Payroll savings | Optional. MDT holds deductions until July 1, then buys shares with the balance |
| Selling | Holders file a sell request. On July 1, sell requests fill first from buy demand, before VRH sells any of its own shares. Requests are private to admins |
| Leaving MDT | Quitting or being fired triggers an automatic buyback of all shares by VRH |
| Keeping shares after leaving | Allowed if the person has 10+ years of service and has owned shares for 5+ years |
| Dividends | Calculated per share at declaration and credited to each holder's account |
| Dividend reinvestment | Holder can apply dividend credit to the next purchase, topping up to the $1,000 minimum if needed |
| Signing | Shareholder agreement and purchase agreement signed in Adobe Sign before the first purchase |

## Users and roles

There are five roles. The system assigns most of them automatically from employment data.

| Role | Who | Can do |
| --- | --- | --- |
| Employee, not yet eligible | Under 4 years of service | Sees the date they become eligible; nothing else |
| Eligible employee | 4+ years, not yet a holder | Onboarding, signing, first buy order, payroll savings |
| Shareholder | Employee or invited outside investor holding shares | Dashboard, buy and sell orders, dividends, documents |
| Former employee holder | Left MDT after meeting the 10-year / 5-year rule | Dashboard, dividends, sell orders; no new purchases |
| Admin | Maarten plus the controller or CFO | Everything in Admin features; every action logged |

Counsel gets no login. They receive generated packages instead (see Documents).

## Employee portal

The portal is mobile-first: most employees will check it on a phone.

**Dashboard**

- Shares held, current price per share, current value
- Total invested (cost basis)
- Value gain in $ and %
- Dividends received to date
- Total return (value gain + dividends) in $ and %, plus annualized return
- Price-per-share history by year, with the holder's purchase points marked
- Credit balance (dividend credit, payroll savings, leftover cash) and what it can be used for

**Onboarding** (required before the first purchase)

1. Confirm identity, address, tax residency and SIN (SIN is needed for dividend tax slips)
2. Add banking details for buyback and dividend payouts
3. Read a plain-language summary of the program
4. Sign the shareholder agreement and purchase agreement through Adobe Sign, embedded in the portal
5. The account unlocks when the Adobe Sign webhook confirms both agreements are signed

**Buy**

- Open only during the order window
- Enter an amount from $1,000 to $10,000; the system shows an estimated share count at this year's price
- Option to apply dividend credit and payroll savings; the screen shows any top-up needed to reach $1,000
- Payment instructions and due date; status reads "awaiting payment" until an admin confirms the money arrived
- Can be edited or cancelled until the window closes

**Payroll savings**

- Enrol, change or stop a per-paycheque amount; payroll processes it, and this screen only records and displays it
- Running balance held by MDT, converted to shares on July 1

**Sell**

- Request to sell a number of shares, up to the holder's balance
- Status: submitted, filled, partly filled, carried forward
- Only admins see sell requests

**Dividends**

- Every declaration: date, amount per share, shares held, amount credited, and whether it was paid out or applied to a purchase

**Documents**

- Signed agreements, July 1 transaction confirmations, annual statements and dividend notices, all downloadable as PDFs

**Notifications by email**

- Became eligible, window opens, 7 days before the window closes, payment received, July 1 confirmation, dividend declared

## Admin features

Admins run the program from one console. Every write action records who did it and when.

**People**

- Import or sync employees with hire date and employment status; the system computes eligibility
- Invite outside investors by email; they skip the tenure rule
- Record a departure with date and reason. This queues an automatic buyback unless the person qualifies to keep their shares

**Valuation**

- Enter audited EBITDA, debt, shares outstanding and the multiple (default 7)
- The system calculates price per share; an admin locks it after board approval
- Every year's inputs and price are kept permanently

**Annual cycle**

- Set window dates, open and close the window
- See all buy orders, sell requests and payroll savings balances
- Mark payments received; an unpaid order at close is cancelled
- Run the match (see Calculations) and review the result before approving
- Set how many VRH shares are available to cover demand that sell requests don't fill
- Settle on July 1: write ledger entries, issue confirmations, update the register

**Buybacks**

- Queue of departures with shares, price and amount owed
- Mark settled once VRH pays; the ledger then moves the shares to VRH. A VRH panel shows its share balance, shares available to sell, and cash owed on pending buybacks

**Dividends**

- Enter the total distribution or the amount per share, plus the record date
- The system allocates by shares held on the record date and credits each account
- Export a payout file (holder, amount, banking reference) and the year-end tax-slip data

**Reports**

- Shareholder register, cap table for the class, full transaction ledger
- Lawyer packages, generated on demand or automatically on schedule
- Every report exports to Excel and PDF

**Settings**

- All rule values from Program rules, plus email templates and Adobe Sign template IDs

## Annual cycle

Everything converges on one settlement date a year, so the system can be quiet most of the year and exact on July 1.

&#91;embedded content: annual cycle · 6 steps, April to July\]

Dividends sit outside this cycle: they can be declared any time and are allocated by shares held on the record date. Departures queue a buyback whenever they happen.

## Calculations

All calculations live in one tested module, and every result is stored with the inputs that produced it.

**Price per share**

```latex
\text{Price per share} = \frac{7 \times \text{Audited EBITDA} - \text{Debt}}{\text{Total shares outstanding (all classes)}}
```

**July 1 matching**

1. Convert each paid buy order to shares: amount ÷ price, rounded down to whole shares. The leftover cash goes to the holder's credit.
2. Total demand D = all buy shares. Total supply S = all sell-request shares.
3. If D ≤ S: every buyer is filled from sellers. Sellers are filled pro rata to their request size. Unfilled sell shares carry forward to next year.
4. If D > S: every seller is filled in full. VRH sells the remaining D − S from the supply the admin set. If that supply is short, buyers are cut back pro rata and the excess cash returns to credit.
5. Buyers never see who sold to them, and sellers never see who bought.

**Dividends**

- Holder amount = amount per share × shares held on the record date
- Credited to the holder's account, then paid out or applied to the next purchase at the holder's choice

**Return on investment**

- Value gain = shares × current price − cost basis
- Total return % = (value gain + dividends received) ÷ cost basis
- Annualized return = XIRR over the holder's cash flows (purchases out, dividends and sales in, current value as the final inflow)

**Departure buyback**

- Shares × the most recent July 1 price, unless counsel sets a different rule (see Open decisions)

Unit tests must cover each formula, rounding, both matching cases and an XIRR reference case before any real money flows.

## Documents and lawyer package

Counsel gets a complete record of who bought and sold what, generated by the system rather than assembled by hand.

**Adobe Sign**

- Templates: updated shareholder agreement and purchase agreement, plus a sell or transfer form if counsel requires one
- Signing is embedded in the portal and prefilled with the holder's details
- A webhook stores the signed PDF and marks the agreement complete; a holder cannot buy until both agreements are complete
- When the shareholder agreement is revised, the system re-prompts existing holders to sign the new version

**Lawyer package**, generated automatically after each July 1 settlement and at December 31

| Contents | Format |
| --- | --- |
| Summary: price used and its valuation inputs, shares sold by VRH, transferred between holders and bought back by VRH | PDF |
| Transaction ledger for the period: date, buyer, seller (holder or VRH), shares, price, amount | Excel + PDF |
| Updated shareholder register for the class | Excel + PDF |
| New holders and their signed agreements | PDF bundle |
| Departures and buybacks | Excel + PDF |
| Dividends declared in the period, by holder | Excel |

The package is delivered as one ZIP file through an expiring download link emailed to counsel, and an admin approves it before it goes out. Every package is stored permanently, so any year can be regenerated.

## Data model

The share ledger is the single source of truth. Its entries are append-only, holdings are always computed from it, and corrections are reversing entries, never edits.

| Table | Key fields |
| --- | --- |
| people | type (employee, outside investor), name, email, hire date, departure date and reason, tax residency, SIN (encrypted), banking (encrypted), status |
| cycles | year, audited EBITDA, debt, multiple, shares outstanding, price per share, window dates, status, locked by, locked at |
| orders | cycle, person, side (buy or sell), amount or shares requested, payment status, shares filled, status |
| share\_ledger | date, type (VRH sale, holder transfer, VRH buyback, opening balance, correction), from holder, to holder (VRH is a holder record like any other), shares, price, cycle |
| credit\_ledger | person, type (dividend, payroll saving, leftover cash, top-up, payout), amount, related cycle or dividend |
| dividends | declaration date, record date, amount per share, total |
| dividend\_allocations | dividend, person, shares on record date, amount, paid out or applied |
| buybacks | person, trigger, shares, price, amount, settled date |
| documents | person, type, version, Adobe Sign agreement ID, status, file |
| packages | period, generated at, approved by, sent at, file |
| audit\_log | actor, action, table, record, before, after, timestamp |

## Security and tech stack

This system holds SINs, bank details and ownership records, so it is built to a financial standard from day one.

**Stack**

- Next.js (TypeScript) on Vercel at mdt.finance
- Supabase for the database, auth and file storage, hosted in the Canada region
- Adobe Sign API for signatures
- Postmark or Resend for email
- Server-side PDF and Excel generation for statements and packages

**Security**

- Mandatory multi-factor authentication for everyone, and phishing-resistant MFA (passkey) for admins
- Row-level security so holders only ever read their own rows; all admin actions go through server code
- Field-level encryption for SIN and banking details; admins see them masked unless a reveal is logged
- Daily backups with point-in-time recovery, plus a restore test before launch
- Separate staging and production projects; no real holder data in staging
- Session timeout, login alerts, and an audit log nobody can edit
- Compliance with BC's Personal Information Protection Act (PIPA): a privacy notice at onboarding and a stated retention period

## Build phases for Claude Code

Build in five phases and dry-run a full fake cycle before July 1, 2027. Save this brief in the repo as SPEC.md and keep it updated as decisions close.

| Phase | Delivers | Done when |
| --- | --- | --- |
| 1. Foundation | Auth with MFA, people import, ledgers, audit log, read-only dashboard | Admin can load holders and each holder sees only their own balance |
| 2. Onboarding | Eligibility engine, Adobe Sign flow, documents library | A test employee signs both agreements end to end and is unlocked |
| 3. Annual cycle | Valuation, window, orders, payment confirmation, matching, July 1 settlement, confirmations, lawyer package | A seeded cycle with 40 fake holders settles and the package matches a hand-checked spreadsheet |
| 4. Dividends and ROI | Declaration, allocation, credits, reinvestment top-up, payout export, return metrics | A test dividend allocates correctly and returns match an Excel XIRR |
| 5. Departures and year-end | Buyback queue, 10/5 hold rule, December 31 package, annual statements | Departure of a short-tenure and a long-tenure test holder each behave correctly |

Target: phases 1–2 live by March 2027, so eligible employees can onboard before the first window; phases 3–4 live by April 2027, so you can do a full dry run in May before the first real July 1.

## Open decisions for Maarten and counsel

The first two are decided: VRH is the seller and the buyer. Close the rest before Phase 3 starts.

- [ ] **Decided: VRH sells all shares.** Follow-up for counsel: VRH needs to hold shares of the new non-voting class before the first July 1, either newly issued to it or converted from its current shares. Confirm that the securities exemption for employee sales covers a sale by VRH as the controlling shareholder.
- [ ] **Decided: VRH buys back departing shares.** This should give the departing employee capital-gains treatment rather than a deemed dividend; the accountant should confirm. Follow-up: departures happen any time, so VRH needs cash available for buybacks year-round.
- [ ] **Buyback price and timing.** Last July 1 price, paid now, or held to the next July 1? Is there a lower price for someone fired for cause?
- [ ] **Formula details.** Total debt or net debt (debt minus cash)? Does the share count include every class?
- [ ] **$10,000 cap.** Per person per year, or per order (allowing several orders)?
- [ ] **Whole shares only?** Recommended. Leftover cash goes to credit.
- [ ] **Unfilled sell requests.** When sell requests exceed demand, does pro rata with carry-forward work for you? Or should VRH buy the excess at the same price?
- [ ] **Outside investors.** Are they exempt from the departure buyback? Counsel to confirm which securities exemption applies to non-employees and what forms they need.
- [ ] **US and Ireland staff.** Eligible at launch? Does service at Lone Peak or Leading Edge count toward the 4 years?
- [ ] **Payroll savings.** Held in a separate trust account? Is interest paid? Refunded in full if the person leaves before July 1?
- [ ] **10-year / 5-year rule.** Is "owned 5 years" measured from the first purchase? Can a qualifying former employee keep buying?
- [ ] **Dividend tax.** Does finance issue T5 slips from the export, and handle non-resident withholding for outside or foreign holders? Dividends applied to a purchase are still taxable income.
