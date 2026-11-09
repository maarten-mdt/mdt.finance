import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { generateSync } from "otplib";
import { STATE_FILE } from "./global-setup";

const PASSWORD = "correct horse battery staple";

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
  await page.getByLabel("Authenticator code").fill(await freshCode(secret, firstCode));
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByTestId("shares")).toHaveText(Number(shares).toLocaleString("en-US"));

  // 6. The invite link can't be used twice.
  await page.goto(invite);
  await expect(page.getByText("This link has expired")).toBeVisible();
});

test("admin must add a passkey, then can import people, record an opening balance and see the audit log", async ({ page }) => {
  const { adminInvite } = JSON.parse(readFileSync(STATE_FILE, "utf8")) as { adminInvite: string };

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
});
