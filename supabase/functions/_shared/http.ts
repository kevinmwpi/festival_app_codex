// Request/response helpers shared by the edge functions. Pure: no env, no network.
// The functions are called by the native app only, so no CORS headers are sent.

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
} as const;

/** Default cap for JSON request bodies (the largest legitimate body is a few hundred bytes). */
export const MAX_JSON_BODY_BYTES = 4 * 1024;

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...headers } });
}

/** `{ error: <code> }` — the shape data-access reads into `DataAccessError.code`. */
export function errorResponse(status: number, code: string, headers: Record<string, string> = {}): Response {
  return jsonResponse({ error: code }, status, headers);
}

/**
 * OPTIONS → 204, any method other than `allowed` → 405. Returns null when the request may proceed.
 */
export function checkMethod(request: Request, allowed: 'POST'): Response | null {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { Allow: `${allowed}, OPTIONS` } });
  }
  if (request.method !== allowed) {
    return errorResponse(405, 'method_not_allowed', { Allow: `${allowed}, OPTIONS` });
  }
  return null;
}

export type JsonBodyResult =
  | { ok: true; value: unknown }
  | { ok: false; status: 400; error: 'invalid_input' }
  | { ok: false; status: 413; error: 'payload_too_large' };

const TOO_LARGE = { ok: false, status: 413, error: 'payload_too_large' } as const;
const INVALID = { ok: false, status: 400, error: 'invalid_input' } as const;

/**
 * Reads a UTF-8 JSON body of at most `maxBytes`. A declared `Content-Length` over the cap is
 * rejected without reading; otherwise the stream is read only up to the cap (chunked bodies too).
 */
export async function readJsonBody(request: Request, maxBytes = MAX_JSON_BODY_BYTES): Promise<JsonBodyResult> {
  const declared = request.headers.get('Content-Length');
  if (declared !== null && /^\d+$/.test(declared.trim()) && Number(declared.trim()) > maxBytes) {
    return TOO_LARGE;
  }
  if (!request.body) {
    return INVALID;
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return TOO_LARGE;
      }
      chunks.push(value);
    }
  } catch {
    return INVALID;
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return INVALID;
  }
}

/** The token of an `Authorization: Bearer <token>` header, or null. */
export function parseBearerToken(header: string | null): string | null {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header?.trim() ?? '');
  return match ? match[1] : null;
}

const IPV4_WITH_PORT = /^(\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}$/;
const BRACKETED_IPV6 = /^\[([0-9a-f:.]+)\](?::\d{1,5})?$/i;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const IPV6 = /^[0-9a-f]{0,4}:[0-9a-f:.]{1,43}$/i;

/**
 * The client address from `X-Forwarded-For`: the **last** entry, which is the one appended by the
 * platform's own proxy (earlier entries are client-supplied and can be forged). Ports and IPv6
 * brackets are stripped and the address is lower-cased; anything that is not an IPv4/IPv6
 * literal yields null.
 */
export function clientIpFromForwardedFor(header: string | null): string | null {
  if (!header) {
    return null;
  }
  const entries = header.split(',');
  let address = entries[entries.length - 1].trim();
  const bracketed = BRACKETED_IPV6.exec(address);
  if (bracketed) {
    address = bracketed[1];
  } else {
    const withPort = IPV4_WITH_PORT.exec(address);
    if (withPort) {
      address = withPort[1];
    }
  }
  if (!IPV4.test(address) && !IPV6.test(address)) {
    return null;
  }
  return address.toLowerCase();
}

/**
 * A log-safe summary of an error: name, HTTP status and error code only. Messages are never logged
 * because auth and storage messages can contain an email address or object path (no PII in logs).
 */
export function describeError(error: unknown): { name: string; status?: number; code?: string } {
  if (typeof error !== 'object' || error === null) {
    return { name: typeof error };
  }
  const candidate = error as { name?: unknown; status?: unknown; statusCode?: unknown; code?: unknown };
  const summary: { name: string; status?: number; code?: string } = {
    name: typeof candidate.name === 'string' ? candidate.name : 'Error',
  };
  const status = typeof candidate.status === 'number' ? candidate.status : Number(candidate.statusCode);
  if (Number.isInteger(status)) {
    summary.status = status;
  }
  if (typeof candidate.code === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(candidate.code)) {
    summary.code = candidate.code;
  }
  return summary;
}
