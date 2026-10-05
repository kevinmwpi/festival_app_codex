import { colors, spacing } from '@festival/ui';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

/** Required on festival detail / lineup screens (§5.5). */
export const FESTIVAL_DISCLAIMER =
  'Festie is an independent app and is not affiliated with or endorsed by any festival, organizer, or artist. Schedules can change — check official sources.';

/** "Times shown in festival local time (PDT)" / device-time variant, as a small clock-prefixed line. */
export function TimeZoneHint({ hint }: { hint: string }) {
  return (
    <View style={styles.hintRow} accessible accessibilityLabel={hint}>
      <Text style={styles.hintIcon} importantForAccessibility="no">
        ◷
      </Text>
      <Text style={styles.hint}>{hint}</Text>
    </View>
  );
}

export function FestivalDisclaimer() {
  return <Text style={styles.disclaimer}>{FESTIVAL_DISCLAIMER}</Text>;
}

const styles = StyleSheet.create({
  hintRow: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  hintIcon: { color: colors.textSecondary, fontSize: 12 },
  hint: { color: colors.textSecondary, flexShrink: 1, fontSize: 12, fontWeight: '600' },
  disclaimer: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm,
    textAlign: 'center',
  },
});
