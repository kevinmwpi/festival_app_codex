import { colors } from '@festival/ui';
import { Stack } from 'expo-router';
import React from 'react';

export default function GroupLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.textPrimary,
        contentStyle: { backgroundColor: colors.background },
        headerShown: false,
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Your Groups' }} />
      <Stack.Screen name="create" options={{ title: 'Create Group' }} />
      <Stack.Screen name="join" options={{ title: 'Join Group' }} />
      <Stack.Screen name="[groupId]/index" options={{ title: 'Group Detail' }} />
      <Stack.Screen name="[groupId]/schedule" options={{ title: 'Combined Schedule' }} />
      <Stack.Screen name="[groupId]/meetup/create" options={{ title: 'Create Meetup' }} />
    </Stack>
  );
}
