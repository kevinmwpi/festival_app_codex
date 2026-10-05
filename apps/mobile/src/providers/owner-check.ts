/**
 * Local owner checks (`ensureLocalOwner`). The SQLite cache and the offline queue belong to one auth
 * user; when a different account signs in, they are wiped before that account may see or send them.
 * Routing waits for every pending check (`waitForOwnerCheck`), so no screen that reads the cache mounts
 * until the wipe has finished.
 */
import { ensureLocalOwner } from '@festival/data-access';

let ownerCheckQueue: Promise<void> = Promise.resolve();
/** Owner checks and sign-ins that have not settled yet. */
const pending = new Set<Promise<unknown>>();
let lastConfirmedOwner: string | null = null;

/* The removal callback is attached first, so it runs before any later `Promise.allSettled` over the same
 * promise resolves: `waitForOwnerCheck` never sees a settled promise still pending. */
function track<T>(promise: Promise<T>): Promise<T> {
  pending.add(promise);
  const forget = () => {
    pending.delete(promise);
  };
  promise.then(forget, forget);
  return promise;
}

/**
 * Runs `ensureLocalOwner` strictly one after another. The launch check and the `SIGNED_IN` that
 * supabase-js emits on every cold launch with an unexpired token would otherwise both read the owner
 * meta before either sets it, and both wipe — the second possibly after the user queued a write.
 * Serialised, the second sees the owner the first recorded and does nothing.
 *
 * A check for the owner already confirmed in this app run, with nothing else pending, cannot wipe
 * anything, so routing does not wait for it (no loading flash on the `SIGNED_IN` of every cold launch).
 *
 * @returns whether this check confirmed a different owner than the previous one in this app run (the
 *   local data may have been wiped, so cached queries must be reset).
 */
export function runOwnerCheck(authUserId: string): Promise<{ ownerChanged: boolean }> {
  const alreadyConfirmed = lastConfirmedOwner === authUserId && pending.size === 0;
  const check = ownerCheckQueue.then(async () => {
    await ensureLocalOwner(authUserId);
    const ownerChanged = lastConfirmedOwner !== authUserId;
    lastConfirmedOwner = authUserId;
    return { ownerChanged };
  });
  ownerCheckQueue = check.then(
    () => undefined,
    () => undefined,
  );
  return alreadyConfirmed ? check : track(check);
}

/**
 * Registers a sign-in call (`verifyEmailCode`) whose own `ensureLocalOwner` runs outside the queue.
 * Pass it before the call can emit `SIGNED_IN`; routing then waits for it to settle too.
 */
export function trackSignIn<T>(signIn: Promise<T>): Promise<T> {
  return track(signIn);
}

/** `true` while an owner check or a tracked sign-in has not settled. */
export function isOwnerCheckPending(): boolean {
  return pending.size > 0;
}

/**
 * Resolves once every owner check and tracked sign-in started so far — and any started while waiting —
 * has settled. Never rejects (a failed check is reported where it was started).
 */
export async function waitForOwnerCheck(): Promise<void> {
  while (pending.size > 0) {
    await Promise.allSettled([...pending]);
  }
}
