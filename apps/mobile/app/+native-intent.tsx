/**
 * Incoming links (§5.1). `festivalapp://group/join?code=ABC123` opens the join screen pre-filled with
 * the code. The code is also remembered (MMKV `pending-invite-code`) unless the user is already signed
 * in with a profile and has agreed to the terms, so that after sign-in, profile setup or the terms
 * agreement `app/index` opens the join screen with it.
 * Every other path passes through unchanged (the root layout's session guards decide whether it can
 * open).
 */
import { getCachedProfile, getStoredSession } from '@festival/data-access';
import { showToast } from '@festival/ui';

import { inviteCodeFromSystemPath, savePendingInviteCode } from '@/src/providers/pending-invite';
import { hasCurrentUserAcceptedTerms } from '@/src/providers/terms-acceptance';

/** Returned for a link received while the app is open: expo-router ignores an empty path. */
const STAY_ON_CURRENT_SCREEN = '';

export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }): string {
  try {
    const { isJoinPath, code } = inviteCodeFromSystemPath(path);
    if (!isJoinPath) {
      return path;
    }

    const signedIn = getStoredSession() !== null;
    const setUp = signedIn && getCachedProfile() !== null;
    if (setUp && hasCurrentUserAcceptedTerms()) {
      return path;
    }

    const saved = code ? savePendingInviteCode(code) : null;
    if (initial) {
      // Cold start: begin at the launch route, which leads through sign-in, profile setup and the
      // terms agreement to the join screen with the remembered code.
      return '/';
    }
    // The app is already open on sign-in, code entry, profile setup or the terms: keep that screen and whatever
    // was typed there. The launch route opens the join screen once setup finishes.
    if (saved) {
      showToast(
        setUp
          ? 'Invite saved. Agree to the terms to join the crew.'
          : signedIn
            ? 'Invite saved. Finish your profile to join the crew.'
            : 'Invite saved. Sign in to join the crew.',
      );
    }
    return STAY_ON_CURRENT_SCREEN;
  } catch {
    return path;
  }
}
