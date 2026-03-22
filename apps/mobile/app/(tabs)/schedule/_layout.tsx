import { Stack } from 'expo-router';
import React from 'react';

export default function ScheduleLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: '#fffaf6' },
        headerTintColor: '#2f241d',
        contentStyle: { backgroundColor: '#f6efe7' },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'My Schedule' }} />
      <Stack.Screen name="browse" options={{ title: 'Browse Lineup' }} />
    </Stack>
  );
}
