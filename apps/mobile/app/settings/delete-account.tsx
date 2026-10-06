import React from 'react';

import { DeleteAccountView } from '@/src/components/DeleteAccountView';
import { goBackOr } from '@/src/providers/launch-route';
import { useFestivalScreenTint } from '@/src/providers/screen-tint';

export default function DeleteAccountScreen() {
  const screenTint = useFestivalScreenTint();
  return <DeleteAccountView backgroundColor={screenTint} onBack={() => goBackOr('/settings')} />;
}
