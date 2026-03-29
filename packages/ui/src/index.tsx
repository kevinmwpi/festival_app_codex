import { useNetInfo } from '@react-native-community/netinfo';
import React, { type PropsWithChildren } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ScrollViewProps,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { colors, radii, spacing } from './theme';

export { colors, radii, spacing, typography } from './theme';

/* ─── Connectivity ──────────────────────────────────────── */

export function useOfflineStatus(): boolean {
  const info = useNetInfo();
  return info.isConnected === false || info.isInternetReachable === false;
}

export function OfflineBanner({ visible, label = 'Offline — showing cached data' }: { visible: boolean; label?: string }) {
  if (!visible) return null;
  return (
    <View style={styles.banner}>
      <Text style={styles.bannerText}>{label}</Text>
    </View>
  );
}

/* ─── Layout ────────────────────────────────────────────── */

export function Screen({
  children,
  scroll = false,
  style,
  contentContainerStyle,
}: PropsWithChildren<{
  scroll?: boolean;
  style?: ViewStyle;
  contentContainerStyle?: ScrollViewProps['contentContainerStyle'];
}>) {
  if (scroll) {
    return (
      <ScrollView style={[styles.screen, style]} contentContainerStyle={[styles.screenContent, contentContainerStyle]}>
        {children}
      </ScrollView>
    );
  }
  return <View style={[styles.screen, styles.screenContent, style]}>{children}</View>;
}

export function SectionCard({ children, title, subtitle }: PropsWithChildren<{ title?: string; subtitle?: string }>) {
  return (
    <View style={styles.card}>
      {title ? <Text style={styles.cardTitle}>{title}</Text> : null}
      {subtitle ? <Text style={styles.cardSubtitle}>{subtitle}</Text> : null}
      {children}
    </View>
  );
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return (
    <View style={styles.emptyContainer}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyDescription}>{description}</Text>
      {action}
    </View>
  );
}

/* ─── Inputs ────────────────────────────────────────────── */

export function FieldLabel({ children }: PropsWithChildren) {
  return <Text style={styles.fieldLabel}>{children}</Text>;
}

export function FieldInput(props: TextInputProps) {
  return <TextInput placeholderTextColor="rgba(44,51,39,0.3)" style={styles.input} {...props} />;
}

export function InlineMessage({ message, tone = 'error' }: { message?: string | null; tone?: 'error' | 'muted' }) {
  if (!message) return null;
  return <Text style={tone === 'error' ? styles.errorText : styles.mutedText}>{message}</Text>;
}

/* ─── Buttons ───────────────────────────────────────────── */

export function PrimaryButton({ label, onPress, disabled, loading }: { label: string; onPress: () => void; disabled?: boolean; loading?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [styles.primaryButton, (disabled || loading) && styles.buttonDisabled, pressed && styles.primaryButtonPressed]}
    >
      {loading ? (
        <ActivityIndicator color={colors.textOnPrimary} size="small" />
      ) : (
        <Text style={styles.primaryButtonLabel}>{label}</Text>
      )}
    </Pressable>
  );
}

export function SecondaryButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.secondaryButton, pressed && { opacity: 0.7 }]}>
      <Text style={styles.secondaryButtonLabel}>{label}</Text>
    </Pressable>
  );
}

/* ─── Chips & Segments ──────────────────────────────────── */

export function Chip({ label, active = false, onPress }: { label: string; active?: boolean; onPress?: () => void }) {
  const content = (
    <View style={[styles.chip, active ? styles.chipActive : null]}>
      <Text style={[styles.chipLabel, active ? styles.chipLabelActive : null]}>{label}</Text>
    </View>
  );
  if (onPress) {
    return <Pressable onPress={onPress}>{content}</Pressable>;
  }
  return content;
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ label: string; value: T }>;
  onChange: (value: T) => void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.segmented}>
      {options.map((option) => {
        const active = value === option.value;
        return (
          <Pressable key={option.value} onPress={() => onChange(option.value)} style={[styles.segment, active ? styles.segmentActive : null]}>
            <Text style={[styles.segmentLabel, active ? styles.segmentLabelActive : null]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/* ─── Styles ────────────────────────────────────────────── */

const styles = StyleSheet.create({
  /* Banner */
  banner: {
    backgroundColor: colors.offlineBg,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  bannerText: {
    color: colors.offlineText,
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },

  /* Screen */
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  screenContent: {
    gap: spacing.md,
    padding: spacing.lg,
  },

  /* Card */
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.borderCard,
    borderRadius: radii.xxl,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.xl,
    shadowColor: colors.shadow,
    shadowOpacity: 1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  cardTitle: {
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: '700',
    fontStyle: 'italic',
  },
  cardSubtitle: {
    color: colors.textSecondary,
    fontSize: 14,
  },

  /* Empty */
  emptyContainer: {
    backgroundColor: colors.surface,
    borderColor: colors.borderCard,
    borderRadius: radii.xxl,
    borderWidth: 1,
    padding: spacing.xxxl,
    alignItems: 'center',
    gap: spacing.sm,
  },
  emptyTitle: {
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: '700',
  },
  emptyDescription: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },

  /* Inputs */
  fieldLabel: {
    color: colors.textSecondary,
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 2,
  },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.borderCard,
    borderRadius: radii.md,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '700',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    shadowColor: colors.shadow,
    shadowOpacity: 1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },

  /* Error / Muted */
  errorText: {
    color: '#b42318',
    fontSize: 13,
  },
  mutedText: {
    color: colors.textSecondary,
    fontSize: 13,
  },

  /* Primary Button */
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md + 2,
    shadowColor: colors.primary,
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  primaryButtonPressed: {
    backgroundColor: colors.primaryPressed,
    transform: [{ scale: 0.97 }],
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  primaryButtonLabel: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 2,
  },

  /* Secondary Button */
  secondaryButton: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    shadowColor: colors.shadow,
    shadowOpacity: 1,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  secondaryButtonLabel: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '700',
  },

  /* Chips */
  chip: {
    alignSelf: 'flex-start',
    backgroundColor: '#F0F4FF',
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.xs + 2,
  },
  chipActive: {
    backgroundColor: colors.primary,
  },
  chipLabel: {
    color: colors.primary,
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  chipLabelActive: {
    color: colors.textOnPrimary,
  },

  /* Segments */
  segmented: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  segment: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: 10,
    opacity: 0.4,
  },
  segmentActive: {
    backgroundColor: colors.primary,
    opacity: 1,
    shadowColor: colors.primary,
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  segmentLabel: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 2,
  },
  segmentLabelActive: {
    color: colors.textOnPrimary,
    fontWeight: '800',
  },
});
