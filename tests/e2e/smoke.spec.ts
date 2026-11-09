import { readFileSync } from "node:fs";
import { devices, expect, test } from "@playwright/test";
import { generateSync } from "otplib";
import { STATE_FILE } from "./global-setup";

const PASSWORD = "correct horse battery staple";
const holder = { secret: "", lastCode: "" };
const PDF = Buffer.from("%PDF-1.4\n% test agreement\n");

/** A TOTP code that won't roll over mid-request, and differs from the last one used. */
async function freshCode(secret: string, previous?: string): Promise<string> {
  for (;;) {
    const remaining = 30 - (Math.floor(Date.now() / 1000) % 30);
    const code = generateSync({ secret });
    if (remaining > 3 && code !== previous) return code;
    await new Promise((r) => setTimeout(r, 1000));
  }
}

test("invited holder sets up MFA, sees only their dashboard, and signs back in with TOTP", async ({ page }) => {
  const { invite, email, shares } = JSON.parse(readFileSync(STATE_FILE, "utf8")) as {
    invite: string;
    email: string;
    shares: string;
  };

  // 0. The site has no public face: the home page is a bare sign-in page that says nothing about what's behind it.
  const home = await page.goto("/");
  expect(home?.status()).toBe(200); // Railway's health check requests "/" and needs a 200
  await expect(page.getByRole("button", { name: "Continue" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  const visible = (await page.locator("body").innerText()).toLowerCase();
  for (const word of ["share", "portal", "admin", "dividend", "invest", "launching"]) expect(visible).not.toContain(word);
  const robots = await page.request.get("/robots.txt");
  expect(await robots.text()).toMatch(/Disallow: \//);

  // 1. Accept the invite and choose a password.
  await page.goto(invite);
  await expect(page.getByText(email)).toBeVisible();
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Confirm password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();

  // 2. MFA is mandatory: the dashboard is unreachable until it's set up.
  await expect(page).toHaveURL(/\/mfa\/setup/);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/mfa\/setup/);

  await page.getByLabel("Confirm your password").fill(PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByText("Can't scan? Enter this key instead").click();
  const secret = (await page.getByTestId("totp-secret").textContent())!.trim();
  const firstCode = await freshCode(secret);
  await page.getByLabel("Authenticator code").fill(firstCode);
  await page.getByRole("button", { name: "Turn on two-step sign-in" }).click();

  // 3. Dashboard shows this holder's own balance, computed from the ledger.
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByTestId("shares")).toHaveText(Number(shares).toLocaleString("en-US"));
  await expect(page.getByText("2026 valuation")).toBeVisible();
  // Held since 2025: an annualized return is shown.
  await expect(page.getByTestId("annualized")).toHaveText(/^[+−]?\d+\.\d{2}%$/);

  // Cash, charts and share history (seed: dividends, 2021–2026 prices).
  await expect(page.getByTestId("cash-balance")).toHaveText(/^\$[\d,]+\.\d{2}$/);
  await expect(page.getByTestId("cash-breakdown")).toContainText("Dividends earned");
  await expect(page.getByRole("heading", { name: "Price per share by year" })).toBeVisible();
  await expect(page.getByRole("img", { name: /Price per share by year/ })).toBeVisible();
  await expect(page.getByTestId("history-list")).toContainText("Bought");
  await expect(page.getByRole("img", { name: /Value of your shares/ })).toBeVisible();
  if (process.env.SCREENSHOT_DIR) {
    await page.getByRole("img", { name: /Value of your shares/ }).focus();
    await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/dashboard-mobile.png`, fullPage: true });
  }

  // 4. A holder can't open the admin console.
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/dashboard/);

  // 5. Sign out, then sign back in: password alone isn't enough.
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();
  const secondCode = await freshCode(secret, firstCode);
  await page.getByLabel("Authenticator code").fill(secondCode);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  holder.secret = secret;
  holder.lastCode = secondCode;
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByTestId("shares")).toHaveText(Number(shares).toLocaleString("en-US"));

  // 6. The invite link can't be used twice.
  await page.goto(invite);
  await expect(page.getByText("This link has expired")).toBeVisible();
});

test("admin: passkey, import, opening balance, admin role, agreements, dividends and sales", async ({ page, browser }) => {
  const { adminInvite, holderId, holderName, email } = JSON.parse(readFileSync(STATE_FILE, "utf8")) as {
    adminInvite: string;
    holderId: string;
    holderName: string;
    email: string;
  };

  // A virtual passkey device (Chromium's WebAuthn emulation) stands in for Face ID / a security key.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });

  await page.goto(adminInvite);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Confirm password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Confirm your password").fill(PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByText("Can't scan? Enter this key instead").click();
  const secret = (await page.getByTestId("totp-secret").textContent())!.trim();
  await page.getByLabel("Authenticator code").fill(await freshCode(secret));
  await page.getByRole("button", { name: "Turn on two-step sign-in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  // Password + TOTP isn't enough for the admin console: a passkey is required.
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/mfa\/passkey/);
  await page.getByRole("button", { name: "Add a passkey and continue" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByText("Van Ruitenburg Holdings Ltd.").first()).toBeVisible();

  // Import: a bad row blocks the whole import; a clean file goes through.
  await page.goto("/admin/import");
  await page.locator('input[type="file"]').setInputFiles({
    name: "people.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("name,email,hire_date,status,type\nNew Hire,new.hire@example.com,2025-03-01,active,employee\nBad,bad,01/02/2020,active,employee\n"),
  });
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page.getByTestId("import-errors")).toContainText("Line 3");
  await expect(page.getByRole("button", { name: /Import 1 people/ })).toBeDisabled();

  await page.locator('input[type="file"]').setInputFiles({
    name: "people.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("name,email,hire_date,status,type\nNew Hire,new.hire@example.com,2025-03-01,active,employee\n"),
  });
  await page.getByRole("button", { name: "Preview" }).click();
  await page.getByRole("button", { name: "Import 1 people" }).click();
  await expect(page.getByText("1 added, 0 updated")).toBeVisible();

  // Opening balance for the new person.
  await page.goto("/admin/holders");
  await page.getByLabel("Holder").selectOption({ label: "New Hire" });
  await page.getByLabel("Shares").fill("75");
  await page.getByLabel("Price per share ($)").fill("18.50");
  await page.getByLabel("Date acquired").fill("2025-07-01");
  await page.getByRole("button", { name: "Record opening balance" }).click();
  await expect(page.getByText("Opening balance recorded.")).toBeVisible();
  await expect(page.getByTestId("opening-table")).toContainText("New Hire");

  // Grant the admin role from the person page (confirm dialog accepted).
  await page.getByTestId("opening-table").getByRole("link", { name: "New Hire" }).click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Make admin" }).click();
  await expect(page.getByText("Admin role granted.")).toBeVisible();

  // Both writes are in the audit log, attributed to this admin.
  await page.goto("/admin/audit?table=share_ledger");
  await expect(page.getByTestId("audit-list")).toContainText("opening_balance");
  await page.goto("/admin/audit?table=people");
  await expect(page.getByTestId("audit-list")).toContainText("new.hire@example.com");
  await page.goto("/admin/audit?table=user_roles");
  await expect(page.getByTestId("audit-list")).toContainText("INSERT");

  // ---- Settings: total shares outstanding is preset and can be changed ----
  await page.goto("/admin/settings");
  await expect(page.getByTestId("setting-shares_outstanding_total")).toHaveText("100,078 shares");
  await page.getByTestId("setting-shares_outstanding_total").locator("xpath=ancestor::section").getByLabel("New value").fill("100,100");
  await page.getByTestId("setting-shares_outstanding_total").locator("xpath=ancestor::section").getByRole("button", { name: "Change" }).click();
  await expect(page.getByTestId("setting-shares_outstanding_total")).toHaveText("100,100 shares");

  // ---- Valuations: enter 2020, see the live price, save, lock ----
  await page.goto("/admin/valuations");
  const y2020 = page.getByTestId("valuation-2020");
  await y2020.getByLabel("Audited EBITDA").fill("2,000,000");
  await y2020.getByLabel("Debt").fill("3,500,000");
  await y2020.getByLabel("Total shares (all classes)").fill("1,000,000");
  await expect(page.getByTestId("price-2020")).toHaveText("$10.50"); // (7 × 2M − 3.5M) ÷ 1M
  await y2020.getByRole("button", { name: "Save draft" }).click();
  await expect(y2020.getByText("2020 saved as a draft: $10.50")).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await y2020.getByRole("button", { name: "Lock" }).click();
  await expect(y2020.getByText("2020 locked.")).toBeVisible();
  await expect(y2020.getByLabel("Audited EBITDA")).toBeDisabled();
  await expect(page.getByTestId("valuation-2026")).toContainText("Locked");
  if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/valuations.png`, fullPage: true });

  // ---- Shareholder agreement: upload, send to the holder ----
  await page.goto("/admin/agreements");
  await page.getByLabel("Version name").fill("v1 test");
  await page.locator('input[name="file"]').setInputFiles({ name: "agreement.pdf", mimeType: "application/pdf", buffer: PDF });
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(page.getByText("Agreement uploaded.")).toBeVisible();
  await expect(page.getByTestId("templates")).toContainText("Current");

  await page.goto(`/admin/people/${holderId}`);
  await page.getByRole("button", { name: "Send agreement to sign" }).click();
  await expect(page.getByText("Sent. They'll see it")).toBeVisible();

  // ---- Dividend: declare a total, check it adds up, mark all but one paid ----
  await page.goto("/admin/dividends");
  await page.getByLabel("Total dividend ($)").fill("10,000.00");
  await page.getByRole("button", { name: "Calculate" }).click();
  await expect(page.getByTestId("dividend-preview")).toContainText("Van Ruitenburg Holdings Ltd.");
  await expect(page.getByTestId("dividend-preview").locator("tfoot")).toContainText("$10,000.00");
  await page.getByRole("button", { name: "Declare $10,000.00 dividend" }).click();
  await expect(page).toHaveURL(/\/admin\/dividends\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId("held-total")).toHaveText("$10,000.00");
  await page.getByRole("checkbox", { name: `Paid: ${holderName}` }).uncheck(); // keeps it as cash
  await page.getByRole("button", { name: /^Mark \d+ as paid$/ }).click();
  await expect(page.getByText(/Marked \d+ payments as paid/)).toBeVisible();
  await expect(page.getByTestId("allocations")).toContainText("Held as cash");
  // Whoever is left unpaid starts unticked after a payment run.
  await expect(page.getByRole("checkbox", { name: `Paid: ${holderName}` })).not.toBeChecked();
  await expect(page.getByRole("button", { name: "Mark 0 as paid" })).toBeDisabled();
  if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/dividend.png`, fullPage: true });

  // ---- Sale between shareholders ----
  await page.goto("/admin/transfers");
  await page.getByLabel("Seller").selectOption(holderId);
  await page.getByLabel("Buyer").selectOption({ label: "New Hire" });
  await page.getByLabel("Shares", { exact: true }).fill("5");
  await page.getByRole("button", { name: "Record sale" }).click();
  await expect(page.getByText(/Recorded: 5 shares/)).toBeVisible();
  await expect(page.getByTestId("movements")).toContainText(`${holderName} → New Hire`);
  await page.getByLabel("Shares", { exact: true }).fill("999999");
  await page.getByLabel("Seller").selectOption(holderId);
  await page.getByLabel("Buyer").selectOption({ label: "New Hire" });
  await page.getByRole("button", { name: "Record sale" }).click();
  await expect(page.getByText("The seller doesn't have 999,999 shares.")).toBeVisible();

  // ---- The holder signs in elsewhere and returns the signed agreement ----
  const holderCtx = await browser.newContext({ ...devices["Pixel 7"], baseURL: page.url().replace(/\/admin.*$/, "") });
  const hp = await holderCtx.newPage();
  await hp.goto("/login");
  await hp.getByLabel("Email").fill(email);
  await hp.getByLabel("Password").fill(PASSWORD);
  await hp.getByRole("button", { name: "Continue" }).click();
  await hp.getByLabel("Authenticator code").fill(await freshCode(holder.secret, holder.lastCode));
  await hp.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(hp.getByText("Action needed: sign your shareholder agreement")).toBeVisible();
  const download = await hp.request.get(await hp.getByRole("link", { name: "Download the agreement" }).getAttribute("href").then((h) => h!));
  expect(download.headers()["content-type"]).toBe("application/pdf");
  await hp.locator('input[name="file"]').setInputFiles({ name: "signed.pdf", mimeType: "application/pdf", buffer: PDF });
  if (process.env.SCREENSHOT_DIR) await hp.screenshot({ path: `${process.env.SCREENSHOT_DIR}/agreement-task.png` });
  await hp.getByRole("button", { name: "Upload signed agreement" }).click();
  await expect(hp.getByText("Uploaded. MDT will review it")).toBeVisible();

  // ---- Admin confirms; the holder sees the signed date ----
  await page.goto(`/admin/people/${holderId}`);
  await expect(page.getByTestId("agreement-status")).toContainText("needs your review");
  await page.getByLabel("Date signed").first().fill("2026-11-09");
  await page.getByRole("button", { name: "Confirm signed agreement" }).click();
  await expect(page.getByTestId("agreement-status")).toContainText("Signed on 2026-11-09");

  await hp.reload();
  await expect(hp.getByTestId("agreement-signed")).toContainText("Signed on 2026-11-09");
  await holderCtx.close();
});
