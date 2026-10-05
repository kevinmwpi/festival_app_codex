import { digestMatches, sha256 } from '../_shared/crypto.ts';
import {
  checkMethod,
  clientIpFromForwardedFor,
  describeError,
  errorResponse,
  jsonResponse,
  readJsonBody,
} from '../_shared/http.ts';

const DEMO_CODE_PATTERN = /^\d{8,10}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Longest email (RFC 5321) / code accepted from a request; longer input is a plain mismatch. */
const MAX_EMAIL_LENGTH = 254;
const MAX_CODE_LENGTH = 32;

export const IP_LIMIT = { action: 'attempt', max: 20, window: '1 hour' } as const;
export const GLOBAL_LIMIT = { key: 'demo-login:global', action: 'fail', max: 30, window: '1 hour' } as const;
/**
 * Attempts naming any other email. They never touch the global cap (so mistyped real codes and
 * strangers cannot lock the reviewer out) but still make one rate-limiter call, so a request
 * takes the same path and time whether or not the email matched. The answer is always 401; the
 * cap only bounds how many rows this bucket can write per hour.
 */
export const OTHER_EMAIL_LIMIT = { key: 'demo-login:other', action: 'attempt', max: 1000, window: '1 hour' } as const;

export interface DemoLoginConfig {
  /** Lower-cased `DEMO_LOGIN_EMAIL`. */
  email: string;
  emailDigest: Uint8Array;
  codeDigest: Uint8Array;
}

/**
 * The demo login is enabled only when `DEMO_LOGIN_EMAIL` is an email address and
 * `DEMO_LOGIN_CODE` is 8–10 digits; otherwise null (every request answers 404).
 */
export async function readDemoLoginConfig(getEnv: (name: string) => string | undefined): Promise<DemoLoginConfig | null> {
  const email = getEnv('DEMO_LOGIN_EMAIL')?.trim().toLowerCase() ?? '';
  const code = getEnv('DEMO_LOGIN_CODE')?.trim() ?? '';
  if (!EMAIL_PATTERN.test(email) || email.length > MAX_EMAIL_LENGTH || !DEMO_CODE_PATTERN.test(code)) {
    return null;
  }
  const [emailDigest, codeDigest] = await Promise.all([sha256(email), sha256(code)]);
  return { email, emailDigest, codeDigest };
}

export interface DemoCredentials {
  email: string;
  code: string;
}

/**
 * `{ email, code }` → trimmed, lower-cased email and the code without whitespace (the same
 * normalisation the app applies), or null when the body does not have that shape.
 */
export function parseDemoCredentials(body: unknown): DemoCredentials | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return null;
  }
  const { email, code } = body as { email?: unknown; code?: unknown };
  if (typeof email !== 'string' || typeof code !== 'string') {
    return null;
  }
  return {
    email: email.trim().toLowerCase().slice(0, MAX_EMAIL_LENGTH + 1),
    code: code.replace(/\s+/g, '').slice(0, MAX_CODE_LENGTH + 1),
  };
}

export interface MagicLinkToken {
  authUserId: string;
  tokenHash: string;
  verificationType: string;
}

/** Everything the handler needs from Supabase (service role). Each call throws on failure. */
export interface DemoLoginDeps {
  /** `rpc('check_rate_limit')`: true records one event; false means the limit is reached. */
  checkRateLimit(key: string, action: string, max: number, window: string): Promise<boolean>;
  /** `auth.admin.createUser({ email, email_confirm: true })` unless the user already exists. */
  ensureAuthUser(email: string): Promise<void>;
  /** `auth.admin.generateLink({ type: 'magiclink', email })`. */
  generateMagicLink(email: string): Promise<MagicLinkToken>;
  /** `rpc('prepare_demo_account')`: profile, demo crew membership, live fake locations. */
  prepareDemoAccount(authUserId: string): Promise<void>;
  /** Log sink for failures; receives no PII. */
  logError(step: string, details: Record<string, unknown>): void;
}

/**
 * The App Review sign-in. The reviewer types the configured email and code into the normal
 * sign-in screen; when the emailed-code check fails the app calls this function, verifies the
 * returned `token_hash` with `verifyOtp({ token_hash, type: 'email' })` and is signed in.
 *
 * - Disabled (`config` null) → 404 for every request.
 * - Per client IP (last `X-Forwarded-For` entry): 20 attempts/hour → 429.
 * - The email is compared first (constant time). Exactly one more rate-limiter call follows:
 *   - email matches → global `demo-login:global`: 30 attempts/hour. The slot is taken *before*
 *     the code is compared (the rate limiter records atomically), so no burst from many
 *     addresses can guess codes more often than that; a successful reviewer login also uses a
 *     slot. Only a caller who already knows the demo email can use up this cap. A refused slot
 *     answers the same 401 as a wrong code (never 429): a distinct status would confirm a
 *     guessed demo email once the cap fills, and the app treats every non-404 failure alike.
 *   - any other email → `demo-login:other` (see `OTHER_EMAIL_LIMIT`), whose answer is ignored:
 *     the response is always 401, so neither the timing nor the status reveals the demo email.
 * - The code digest is always computed; a token needs email match, code match and a granted slot.
 * - Anything else → 401 `{ error: 'invalid_code' }`, byte-identical for a wrong email, a wrong
 *   code and a full global cap. Only the per-IP limit (checked before the email) answers 429.
 * - Match → ensure the auth user (created WITHOUT `app_metadata.festie_demo`, which marks the
 *   seeded fake crew), mint a magic-link token, run `prepare_demo_account` for that user, then
 *   200 `{ token_hash, verification_type }`. The token is only returned once the account is ready.
 */
export function createDemoLoginHandler(
  config: DemoLoginConfig | null,
  deps: DemoLoginDeps,
): (request: Request) => Promise<Response> {
  return async (request) => {
    if (!config) {
      return errorResponse(404, 'not_found');
    }
    const rejected = checkMethod(request, 'POST');
    if (rejected) {
      return rejected;
    }

    const body = await readJsonBody(request);
    if (!body.ok) {
      return errorResponse(body.status, body.error);
    }
    const credentials = parseDemoCredentials(body.value);
    if (!credentials) {
      return errorResponse(400, 'invalid_input');
    }

    const ip = clientIpFromForwardedFor(request.headers.get('X-Forwarded-For')) ?? 'unknown';
    let step = 'rate_limit';
    try {
      const ipAllowed = await deps.checkRateLimit(`demo-login:ip:${ip}`, IP_LIMIT.action, IP_LIMIT.max, IP_LIMIT.window);
      if (!ipAllowed) {
        return errorResponse(429, 'rate_limited', { 'Retry-After': '3600' });
      }
      const emailOk = await digestMatches(credentials.email, config.emailDigest);
      const limit = emailOk ? GLOBAL_LIMIT : OTHER_EMAIL_LIMIT;
      const slotGranted = await deps.checkRateLimit(limit.key, limit.action, limit.max, limit.window);
      const codeOk = await digestMatches(credentials.code, config.codeDigest);
      if (Number(emailOk) + Number(codeOk) + Number(slotGranted) !== 3) {
        return errorResponse(401, 'invalid_code');
      }

      step = 'ensure_auth_user';
      await deps.ensureAuthUser(config.email);
      step = 'generate_link';
      const token = await deps.generateMagicLink(config.email);
      step = 'prepare_demo_account';
      await deps.prepareDemoAccount(token.authUserId);

      return jsonResponse({ token_hash: token.tokenHash, verification_type: token.verificationType });
    } catch (error) {
      deps.logError(step, describeError(error));
      return errorResponse(500, 'server_error');
    }
  };
}
