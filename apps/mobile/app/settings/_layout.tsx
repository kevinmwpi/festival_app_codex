import { colors } from '@festival/ui';
import { Stack } from 'expo-router';
import React from 'react';

/** Settings stack (§5.3), opened from the avatar button in the Fests header. Screens draw their own headers. */
export default function SettingsLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="profile" />
      <Stack.Screen name="blocked-users" />
      <Stack.Screen name="delete-account" />
    </Stack>
  );
}
