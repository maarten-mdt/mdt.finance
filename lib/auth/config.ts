/**
 * Security constants. These are deliberately in code, not the settings table: they are
 * security controls, not program rules from SPEC.md, and must not be loosened from the admin UI.
 */
export const SESSION = {
  /** Holder sessions end after this much inactivity. */
  idleMinutes: 30,
  /** Admin sessions end after this much inactivity. */
  adminIdleMinutes: 15,
  /** No session lives longer than this, active or not. */
  maxHours: 12,
  /** How often activity refreshes the session expiry. */
  refreshSeconds: 60,
} as const;

/** Better Auth endpoint paths that create sessions, recorded on each session as `authMethod`. */
export const AUTH_METHOD = {
  password: "/sign-in/email",
  totp: "/two-factor/verify-totp",
  backupCode: "/two-factor/verify-backup-code",
  passkey: "/passkey/verify-authentication",
} as const;

/** Sessions that passed a second factor. */
export const MFA_METHODS: readonly string[] = [AUTH_METHOD.totp, AUTH_METHOD.backupCode, AUTH_METHOD.passkey];

export const INVITE_TTL_HOURS = 72;
