import { EmptyState, Screen } from '@festival/ui';
import React from 'react';

export default function ChatPlaceholderScreen() {
  return (
    <Screen>
      <EmptyState
        title="Cloud chat comes next"
        description="The chat transport is intentionally stubbed for this phase. Schedule, groups, meetups, and offline sync are ready to build on now."
      />
    </Screen>
  );
}
