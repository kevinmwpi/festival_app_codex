import { colors } from '@festival/ui';
import { Stack } from 'expo-router';
import React from 'react';

export default function LegalLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.primary,
        headerTitleStyle: { color: colors.textPrimary, fontWeight: '700' },
        contentStyle: { backgroundColor: colors.background },
      }}
    />
  );
}
