import { colors, EmptyState, PrimaryButton, spacing } from '@festival/ui';
import { router, Stack } from 'expo-router';
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { resetTo } from '@/src/providers/launch-route';

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.container}>
        <EmptyState
          title="Nothing here"
          description="This link doesn't lead anywhere in Festie. It may be out of date."
          action={
            <View style={styles.action}>
              <PrimaryButton label="Go to Festie" onPress={() => (router.canGoBack() ? router.back() : resetTo('/'))} />
            </View>
          }
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.background,
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  action: { alignSelf: 'stretch', marginTop: spacing.md },
});
