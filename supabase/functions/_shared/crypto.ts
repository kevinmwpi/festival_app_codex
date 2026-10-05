// Digest helpers for comparing secrets. Pure: no env, no network.

const encoder = new TextEncoder();

export async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
}

/**
 * Constant-time equality for byte arrays. Every byte is visited regardless of where the first
 * difference is; only a length mismatch returns early (digests always have the same length).
 */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < a.byteLength; index += 1) {
    difference |= a[index] ^ b[index];
  }
  return difference === 0;
}

/**
 * Whether `candidate` hashes to `expectedDigest`. Hashing first makes the comparison independent
 * of the candidate's length and content, so response timing reveals nothing about the secret.
 */
export async function digestMatches(candidate: string, expectedDigest: Uint8Array): Promise<boolean> {
  return timingSafeEqual(await sha256(candidate), expectedDigest);
}
