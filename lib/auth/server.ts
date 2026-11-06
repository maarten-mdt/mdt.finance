import "server-only";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { twoFactor } from "better-auth/plugins";
import { passkey } from "@better-auth/passkey";
import { Pool } from "pg";
import { env } from "@/lib/env";
import { SESSION } from "./config";
import { withContext } from "@/lib/db";

/**
 * Better Auth runs against its own Postgres role (auth_service), which can reach only the
 * auth tables. The app role (app_user) cannot read password hashes, TOTP secrets or sessions.
 */
function createAuth() {
  return betterAuth({
    appName: "MDT Finance",
    baseURL: env.baseUrl,
    secret: env.authSecret,
    database: new Pool({ connectionString: env.authDatabaseUrl, max: 5 }),
    emailAndPassword: {
      enabled: true,
      // Nobody signs up on their own: accounts are created from admin invites only.
      disableSignUp: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
    },
    session: {
      expiresIn: SESSION.idleMinutes * 60,
      updateAge: SESSION.refreshSeconds,
      additionalFields: {
        authMethod: { type: "string", required: false, input: false },
      },
    },
    user: {
      additionalFields: {
        personId: { type: "string", required: false, input: false },
      },
    },
    rateLimit: { enabled: true, window: 60, max: 30, storage: "database" },
    advanced: {
      useSecureCookies: env.baseUrl.startsWith("https://"),
      cookiePrefix: "mdtf",
    },
    databaseHooks: {
      session: {
        create: {
          // Record which endpoint created the session (password, TOTP, passkey) so guards
          // can require MFA, and require a passkey for admin pages.
          before: async (session, ctx) => ({ data: { ...session, authMethod: ctx?.path ?? null } }),
          // Every sign-in is written to the audit log, attributed to the person signing in.
          after: async (session) => {
            const user = await getAuth().$context.then((c) => c.internalAdapter.findUserById(session.userId));
            const personId = (user as { personId?: string | null } | null)?.personId ?? null;
            await withContext({ personId, actorId: personId ?? `auth-user:${session.userId}`, isAdmin: false }, (tx) =>
              tx.query("SELECT app.log_event('auth.sign_in', 'session', $1, $2)", [
                session.id,
                JSON.stringify({ method: (session as { authMethod?: string }).authMethod ?? null, ip: session.ipAddress ?? null }),
              ]),
            );
          },
        },
      },
    },
    plugins: [
      twoFactor({ issuer: "MDT Finance", skipVerificationOnEnable: false }),
      passkey({
        rpID: env.passkeyRpId,
        rpName: "MDT Finance",
        origin: env.passkeyOrigin,
        authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
      }),
      nextCookies(),
    ],
  });
}

type Auth = ReturnType<typeof createAuth>;
const globalForAuth = globalThis as unknown as { __mdtAuth?: Auth };

export function getAuth(): Auth {
  globalForAuth.__mdtAuth ??= createAuth();
  return globalForAuth.__mdtAuth;
}
