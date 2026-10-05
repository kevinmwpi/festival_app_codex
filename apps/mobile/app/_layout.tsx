import { supabaseConfigError } from '@festival/data-access';
import { OfflineBanner, colors, radii, spacing, TextLink, useOfflineStatus } from '@festival/ui';
import { useFonts } from 'expo-font';
import * as Linking from 'expo-linking';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { SUPPORT_EMAIL } from '@/src/config/app-info';
import { AppProviders } from '@/src/providers/app-providers';
import { useHasStoredSession } from '@/src/providers/session-state';

export { ErrorBoundary } from 'expo-router';

// Kept up until the first real frame: `AppProviders` hides it once the launch checks finish (or the
// configuration-error screen does).
void SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
  });

  // A font that fails to load must not block launch; the system font is used instead.
  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      {supabaseConfigError ? (
        <ConfigErrorScreen detail={supabaseConfigError} />
      ) : (
        <AppProviders>
          <RootShell />
        </AppProviders>
      )}
    </SafeAreaProvider>
  );
}

function RootShell() {
  const isOffline = useOfflineStatus();
  const hasSession = useHasStoredSession();

  return (
    <SafeAreaView style={styles.safeArea}>
      <OfflineBanner visible={isOffline} />
      <View style={styles.content}>
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="auth/enter-email" />
          <Stack.Screen name="auth/verify-otp" />
          <Stack.Protected guard={hasSession}>
            <Stack.Screen name="auth/profile-setup" options={{ gestureEnabled: false }} />
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="settings" />
          </Stack.Protected>
        </Stack>
      </View>
    </SafeAreaView>
  );
}

/**
 * Shown instead of the app when the build has no Supabase configuration (`supabaseConfigError`): no
 * sign-in or data is possible, so nothing else renders. Release builds cannot reach this (app.config.ts
 * refuses to build them without the configuration); it guards development and misconfigured builds.
 */
function ConfigErrorScreen({ detail }: { detail: string }) {
  React.useEffect(() => {
    void SplashScreen.hideAsync().catch(() => undefined);
  }, []);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.configContainer}>
        <View style={styles.configCard}>
          <View style={styles.configIcon} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
            <Text style={styles.configGlyph}>⛺</Text>
          </View>
          <Text style={styles.configTitle} accessibilityRole="header">
            Festie can&apos;t start
          </Text>
          <Text style={styles.configBody}>
            This version of the app is missing its server settings, so it can&apos;t sign you in or load festivals.
            Please install the latest version of Festie.
          </Text>
          {__DEV__ ? <Text style={styles.configDetail}>{detail}</Text> : null}
          {SUPPORT_EMAIL ? (
            <TextLink
              label="Contact support"
              accessibilityLabel={`Contact support at ${SUPPORT_EMAIL}`}
              onPress={() => void Linking.openURL(`mailto:${SUPPORT_EMAIL}`).catch(() => undefined)}
            />
          ) : null}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
  },
  configContainer: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  configCard: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.borderCard,
    borderRadius: radii.card,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.xxl,
  },
  configIcon: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radii.xxl,
    height: 72,
    justifyContent: 'center',
    width: 72,
  },
  configGlyph: { fontSize: 32 },
  configTitle: {
    color: colors.textPrimary,
    fontFamily: 'Georgia',
    fontSize: 26,
    fontStyle: 'italic',
    fontWeight: '700',
    textAlign: 'center',
  },
  configBody: { color: colors.textSecondary, fontSize: 15, lineHeight: 22, textAlign: 'center' },
  configDetail: { color: colors.destructive, fontSize: 12, lineHeight: 18, textAlign: 'center' },
});
