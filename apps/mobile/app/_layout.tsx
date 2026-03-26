import { OfflineBanner, useOfflineStatus } from '@festival/ui';
import { Stack } from 'expo-router';
import React from 'react';
import { SafeAreaView, StyleSheet, View } from 'react-native';

import { AppProviders } from '@/src/providers/app-providers';

export { ErrorBoundary } from 'expo-router';

export default function RootLayout() {
  return (
    <AppProviders>
      <RootShell />
    </AppProviders>
  );
}

function RootShell() {
  const isOffline = useOfflineStatus();

  return (
    <SafeAreaView style={styles.safeArea}>
      <OfflineBanner visible={isOffline} />
      <View style={styles.content}>
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#f4f7ff' } }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="auth/enter-email" />
          <Stack.Screen name="auth/verify-otp" />
          <Stack.Screen name="auth/profile-setup" />
          <Stack.Screen name="(tabs)" />
        </Stack>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f4f7ff',
  },
  content: {
    flex: 1,
  },
});
