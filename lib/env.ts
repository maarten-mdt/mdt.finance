import "server-only";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable ${name}`);
  return v;
}

/** Read lazily so `next build` works without runtime secrets. */
export const env = {
  get databaseUrl() {
    return required("DATABASE_URL");
  },
  get authDatabaseUrl() {
    return required("AUTH_DATABASE_URL");
  },
  get authSecret() {
    return required("BETTER_AUTH_SECRET");
  },
  get baseUrl() {
    return required("BETTER_AUTH_URL");
  },
  get passkeyRpId() {
    return required("PASSKEY_RP_ID");
  },
  get passkeyOrigin() {
    return required("PASSKEY_ORIGIN");
  },
  get fieldEncryptionKey() {
    return required("FIELD_ENCRYPTION_KEY");
  },
};
