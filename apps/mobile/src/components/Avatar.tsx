import { Avatar as ProfileAvatar } from '@festival/ui';
import React from 'react';
import { View } from 'react-native';

export interface AvatarProps {
  name: string | null | undefined;
  avatarType?: string | null;
  avatarValue?: string | null;
  size?: number;
  /** Greyed-out placeholder (blocked users). */
  muted?: boolean;
}

/**
 * Decorative profile avatar for lists, pins and buttons that already show (or announce) the person's
 * name. It draws the same `@festival/ui` avatar the user picked in profile setup — same shape, and
 * chosen colours made fill-safe — so crew members see what the user chose. Hidden from screen readers
 * on both platforms (`accessibilityElementsHidden` on iOS, `importantForAccessibility` on Android).
 */
export function Avatar({ name, avatarType, avatarValue, size = 44, muted = false }: AvatarProps) {
  return (
    <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <ProfileAvatar name={name} avatarType={avatarType} avatarValue={avatarValue} size={size} muted={muted} accessibilityLabel={null} />
    </View>
  );
}
