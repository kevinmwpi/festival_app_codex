import { colors } from '@festival/ui';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { initialsOf, pastelFor } from './palette';

/**
 * Artist tile: initials on a stable pastel. Festie shows no artist photos or artwork (factual
 * schedule data only), so this replaces the prototype's placeholder images.
 */
export function ArtistMonogram({ name, colorKey, size = 112, radius = 32 }: { name: string; colorKey?: string; size?: number; radius?: number }) {
  return (
    <View
      importantForAccessibility="no-hide-descendants"
      accessible={false}
      style={[styles.tile, { width: size, height: size, borderRadius: radius, backgroundColor: pastelFor(colorKey ?? name) }]}
    >
      <Text allowFontScaling={false} style={[styles.initials, { fontSize: Math.round(size * 0.32) }]}>
        {initialsOf(name)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { alignItems: 'center', justifyContent: 'center' },
  initials: { color: colors.textPrimary, fontFamily: 'Georgia', fontStyle: 'italic', fontWeight: '700', opacity: 0.85 },
});
