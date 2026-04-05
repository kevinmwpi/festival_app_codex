import { corsHeaders } from './cors.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ValidationError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Validate that val is a non-empty string within maxLen characters.
 * Trims whitespace before checking length.
 */
export function requireString(val: unknown, field: string, maxLen: number): string {
  if (typeof val !== 'string' || val.trim().length === 0) {
    throw new ValidationError(`'${field}' is required and must be a non-empty string.`);
  }
  const trimmed = val.trim();
  if (trimmed.length > maxLen) {
    throw new ValidationError(`'${field}' must be ${maxLen} characters or fewer.`);
  }
  return trimmed;
}

/** Validate that val is a UUID v4 string. */
export function requireUUID(val: unknown, field: string): string {
  const str = requireString(val, field, 36);
  if (!UUID_RE.test(str)) {
    throw new ValidationError(`'${field}' must be a valid UUID.`);
  }
  return str;
}

/** Validate that val is a well-formed URL string within maxLen characters. */
export function requireUrl(val: unknown, field: string, maxLen = 2048): string {
  const str = requireString(val, field, maxLen);
  try {
    new URL(str);
  } catch {
    throw new ValidationError(`'${field}' must be a valid URL.`);
  }
  return str;
}

/**
 * Validate that val is a well-formed email address.
 * Uses a pragmatic regex that covers the vast majority of real email addresses.
 */
export function requireEmail(val: unknown, field: string): string {
  const str = requireString(val, field, 254);
  // RFC 5321 max total length is 254; local part max is 64
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!EMAIL_RE.test(str)) {
    throw new ValidationError(`'${field}' must be a valid email address.`);
  }
  return str.toLowerCase();
}

/**
 * Check the Content-Length request header against a byte limit.
 * Returns a 413 Response if exceeded, or null if within bounds.
 *
 * Note: Content-Length may be absent for chunked transfers.
 * If absent we allow the request through (Deno's body reading will
 * still apply memory limits at the runtime level).
 */
export function checkBodySize(request: Request, maxBytes: number): Response | null {
  const contentLength = request.headers.get('Content-Length');
  if (contentLength !== null) {
    const bytes = parseInt(contentLength, 10);
    if (!isNaN(bytes) && bytes > maxBytes) {
      return new Response(
        JSON.stringify({ error: `Request body too large. Maximum size is ${maxBytes} bytes.` }),
        {
          status: 413,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      );
    }
  }
  return null;
}

/** Wrap a ValidationError into a 400 Response. */
export function validationErrorResponse(err: ValidationError): Response {
  return new Response(JSON.stringify({ error: err.message }), {
    status: 400,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
