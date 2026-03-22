import { Stack } from 'expo-router';
import React from 'react';

export default function MapLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: '#fffaf6' },
        headerTintColor: '#2f241d',
        contentStyle: { backgroundColor: '#f6efe7' },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Festival Map' }} />
    </Stack>
  );
}
