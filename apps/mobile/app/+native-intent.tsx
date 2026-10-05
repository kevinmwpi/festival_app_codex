/**
 * Incoming links (§5.1). `festivalapp://group/join?code=ABC123` opens the join screen pre-filled with
 * the code. The code is also remembered (MMKV `pending-invite-code`) unless the user is already signed
 * in with a profile, so that after sign-in or profile setup `app/index` opens the join screen with it.
 * Every other path passes through unchanged.
 */
import { getCachedProfile, getStoredSession } from '@festival/data-access';

import { inviteCodeFromSystemPath, savePendingInviteCode } from '@/src/providers/pending-invite';

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    const { isJoinPath, code } = inviteCodeFromSystemPath(path);
    if (!isJoinPath) {
      return path;
    }

    const readyForJoin = getStoredSession() !== null && getCachedProfile() !== null;
    if (readyForJoin) {
      return path;
    }

    if (code) {
      savePendingInviteCode(code);
    }
    // Not signed in (or no profile yet): start at the launch route, which leads through sign-in and
    // profile setup to the join screen with the remembered code.
    return '/';
  } catch {
    return path;
  }
}
