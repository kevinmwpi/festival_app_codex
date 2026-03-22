import { Stack } from 'expo-router';
import React from 'react';

export default function GroupLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: '#fffaf6' },
        headerTintColor: '#2f241d',
        contentStyle: { backgroundColor: '#f6efe7' },
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
