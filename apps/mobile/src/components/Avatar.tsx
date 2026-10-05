import { colors } from '@festival/ui';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { initialsOf, pastelFor } from './palette';

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

export interface AvatarProps {
  name: string | null | undefined;
  avatarType?: string | null;
  avatarValue?: string | null;
  /** Stable key for the fallback colour (user id). */
  colorKey?: string | null;
  size?: number;
  /** Greyed-out placeholder (blocked users). */
  muted?: boolean;
}

/**
 * Profile avatar: emoji, initials on the user's chosen colour, or initials on a stable pastel.
 * Decorative — pair it with a visible name (it is hidden from screen readers).
 */
export function Avatar({ name, avatarType, avatarValue, colorKey, size = 44, muted = false }: AvatarProps) {
  const isEmoji = avatarType === 'emoji' && Boolean(avatarValue);
  const background = muted
    ? '#ECEDEA'
    : avatarType === 'color' && avatarValue && HEX_COLOR.test(avatarValue)
      ? avatarValue
      : isEmoji
        ? '#F0F4FF'
        : pastelFor(colorKey ?? name ?? undefined);
  const label = muted ? '–' : isEmoji ? avatarValue : initialsOf(name);

  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={[styles.circle, { width: size, height: size, borderRadius: size / 2, backgroundColor: background }]}
    >
      <Text
        allowFontScaling={false}
        style={[styles.label, { fontSize: Math.round(size * (isEmoji ? 0.5 : 0.36)) }, muted && styles.mutedLabel]}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  label: { color: colors.textPrimary, fontWeight: '800' },
  mutedLabel: { color: colors.textSecondary },
});
