/**
 * Account deletion before the app opens: reachable from the terms gate and profile setup, which a user
 * who declines the terms never gets past (Settings sits behind the terms guard). Guarded only by the
 * session in app/_layout.tsx.
 */
import { colors } from '@festival/ui';
import React from 'react';

import { DeleteAccountView } from '@/src/components/DeleteAccountView';
import { goBackOr } from '@/src/providers/launch-route';

export default function SignUpDeleteAccountScreen() {
  // Back to whichever gate opened it; `/` routes a cold deep link to the right one.
  return <DeleteAccountView backgroundColor={colors.background} onBack={() => goBackOr('/')} />;
}
