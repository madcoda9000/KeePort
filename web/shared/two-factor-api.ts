/** A second factor an account can use to sign in; recovery codes are the fallback for all of them. */
export type MfaMethod = 'totp' | 'email' | 'recovery';

/** The server's answer to a correct password when the account needs a second factor; there is no session yet. */
export interface MfaChallenge {
  mfaRequired: true;
  /** The one-time token for the second step, valid for 10 minutes. */
  mfaToken: string;
  /** The methods the account can use, apart from recovery codes. */
  methods: ('totp' | 'email')[];
  /** The masked address e-mail codes go to, e.g. "a…@example.org". */
  emailHint: string | null;
}

/** The two-factor state of the signed-in account. */
export interface MfaStatus {
  totpEnabledAt: string | null;
  emailEnabledAt: string | null;
  /** Whether the administrator allows e-mail codes for this account. */
  emailAllowed: boolean;
  /** Whether the account's address is confirmed, which e-mail codes need. */
  emailVerified: boolean;
  recoveryCodesLeft: number;
  /** Whether the administrator requires a second factor for this account. */
  required: boolean;
  /** Whether signing in needs a second factor right now. */
  active: boolean;
}

/** The state after a change, with new recovery codes to show once (empty when the old ones stay valid). */
export interface MfaChange {
  status: MfaStatus;
  recoveryCodes: string[];
}

/** Sends a same-origin API request of the app (with its CSRF token) and decodes the JSON answer. */
export type ApiSend = <T>(path: string, init?: RequestInit) => Promise<T>;

/**
 * Tells a second-step challenge apart from a finished sign-in.
 * @param value - The answer of the sign-in request.
 */
export function isMfaChallenge(value: unknown): value is MfaChallenge {
  return typeof value === 'object' && value !== null && (value as { mfaRequired?: unknown }).mfaRequired === true;
}

/**
 * Creates the two-factor API calls for one app.
 * @param authPath - The app's auth path: /api/auth for the web vault, /api/admin/auth for the admin console.
 * @param send - The app's request function.
 */
export function createMfaApi(authPath: string, send: ApiSend) {
  /**
   * Posts JSON to a two-factor route.
   * @param path - The path below the auth path.
   * @param body - The JSON body.
   */
  const post = <T>(path: string, body: unknown) => send<T>(`${authPath}${path}`, { method: 'POST', body: JSON.stringify(body) });
  return {
    /** Reads the account's two-factor state. */
    status: () => send<MfaStatus>(`${authPath}/mfa`),
    /**
     * Starts setting up an authenticator app.
     * @param password - The account password.
     */
    startTotp: (password: string) => post<{ secret: string; uri: string }>('/mfa/totp/start', { password }),
    /**
     * Finishes setting up the authenticator app.
     * @param code - A code from the app.
     */
    confirmTotp: (code: string) => post<MfaChange>('/mfa/totp/confirm', { code }),
    /**
     * Turns off the authenticator app.
     * @param password - The account password.
     * @param method - totp or recovery.
     * @param code - The code.
     */
    disableTotp: (password: string, method: 'totp' | 'recovery', code: string) => post<MfaChange>('/mfa/totp/disable', { password, method, code }),
    /**
     * Turns on sign-in codes by e-mail.
     * @param password - The account password.
     */
    enableEmail: (password: string) => post<MfaChange>('/mfa/email/enable', { password }),
    /**
     * Turns off sign-in codes by e-mail.
     * @param password - The account password.
     */
    disableEmail: (password: string) => post<MfaChange>('/mfa/email/disable', { password }),
    /**
     * Replaces the recovery codes with new ones.
     * @param password - The account password.
     */
    newRecoveryCodes: (password: string) => post<MfaChange>('/mfa/recovery-codes', { password }),
    /**
     * Sends the second factor of a sign-in; the answer is the same as a sign-in without a second factor.
     * @param mfaToken - The token from the challenge.
     * @param method - The method used.
     * @param code - The code.
     */
    verifyLogin: <T>(mfaToken: string, method: MfaMethod, code: string) => post<T>('/login/mfa', { mfaToken, method, code }),
    /**
     * Asks for a sign-in code by e-mail.
     * @param mfaToken - The token from the challenge.
     */
    sendLoginEmail: (mfaToken: string) => post<void>('/login/mfa/email', { mfaToken })
  };
}

/** The two-factor API calls of one app. */
export type MfaApi = ReturnType<typeof createMfaApi>;
