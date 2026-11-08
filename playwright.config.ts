import { randomBytes } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
const base = process.env.E2E_DATABASE_SERVER ?? "postgres://localhost:5433";
const db = "mdt_e2e";
const url = (user: string) => {
  const u = new URL(base);
  u.username = user;
  u.password = process.env.E2E_DB_PASSWORD ?? user;
  u.pathname = `/${db}`;
  return u.toString();
};

export const e2eEnv = {
  DATABASE_URL: url("app_user"),
  AUTH_DATABASE_URL: url("auth_service"),
  DATABASE_OWNER_URL: url(process.env.E2E_OWNER_USER ?? "postgres"),
  BETTER_AUTH_SECRET: randomBytes(32).toString("base64"),
  BETTER_AUTH_URL: `http://localhost:${PORT}`,
  PASSKEY_RP_ID: "localhost",
  PASSKEY_ORIGIN: `http://localhost:${PORT}`,
  FIELD_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  APP_ENV: "test",
};
Object.assign(process.env, e2eEnv);

export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  use: { baseURL: `http://localhost:${PORT}`, trace: "off" },
  projects: [{ name: "mobile", use: { ...devices["Pixel 7"] } }],
  webServer: {
    command: `npx next build && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    timeout: 240_000,
    reuseExistingServer: false,
    env: e2eEnv,
  },
});
