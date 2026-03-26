import { useNetInfo } from '@react-native-community/netinfo';
import React, { type PropsWithChildren } from 'react';
import {
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

export function useOfflineStatus(): boolean {
  const info = useNetInfo();
  return info.isConnected === false || info.isInternetReachable === false;
}

export function OfflineBanner({ visible, label = 'Offline mode: showing cached festival data.' }: { visible: boolean; label?: string }) {
  if (!visible) {
    return null;
  }

  return (
    <View style={styles.banner}>
      <Text style={styles.bannerText}>{label}</Text>
    </View>
  );
}

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

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <SectionCard>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyDescription}>{description}</Text>
      {action}
    </SectionCard>
  );
}

export function PrimaryButton({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[styles.button, disabled ? styles.buttonDisabled : null]}>
      <Text style={styles.buttonLabel}>{label}</Text>
    </Pressable>
  );
}

export function SecondaryButton({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={styles.secondaryButton}>
      <Text style={styles.secondaryButtonLabel}>{label}</Text>
    </Pressable>
  );
}

export function FieldLabel({ children }: PropsWithChildren) {
  return <Text style={styles.fieldLabel}>{children}</Text>;
}

export function FieldInput(props: TextInputProps) {
  return <TextInput placeholderTextColor="#7d7d85" style={styles.input} {...props} />;
}

export function InlineMessage({ message, tone = 'error' }: { message?: string | null; tone?: 'error' | 'muted' }) {
  if (!message) {
    return null;
  }

  return <Text style={tone === 'error' ? styles.errorText : styles.mutedText}>{message}</Text>;
}

export function Chip({ label, active = false }: { label: string; active?: boolean }) {
  return (
    <View style={[styles.chip, active ? styles.chipActive : null]}>
      <Text style={[styles.chipLabel, active ? styles.chipLabelActive : null]}>{label}</Text>
    </View>
  );
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
    <View style={styles.segmented}>
      {options.map((option) => {
        const active = value === option.value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            style={[styles.segment, active ? styles.segmentActive : null]}
          >
            <Text style={[styles.segmentLabel, active ? styles.segmentLabelActive : null]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: '#fde68a',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  bannerText: {
    color: '#1f2937',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  screen: {
    flex: 1,
    backgroundColor: '#f4f7ff',
  },
  screenContent: {
    gap: 16,
    padding: 20,
  },
  card: {
    backgroundColor: '#ffffff',
    borderColor: '#dbe7ff',
    borderRadius: 24,
    borderWidth: 1,
    gap: 10,
    padding: 18,
    shadowColor: '#93b4ef',
    shadowOpacity: 0.14,
    shadowRadius: 16,
    shadowOffset: {
      width: 0,
      height: 8,
    },
  },
  cardTitle: {
    color: '#111827',
    fontSize: 18,
    fontWeight: '800',
  },
  cardSubtitle: {
    color: '#64748b',
    fontSize: 14,
  },
  emptyTitle: {
    color: '#111827',
    fontSize: 20,
    fontWeight: '800',
  },
  emptyDescription: {
    color: '#64748b',
    fontSize: 14,
    lineHeight: 20,
  },
  button: {
    alignItems: 'center',
    backgroundColor: '#b2cefe',
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonLabel: {
    color: '#0f172a',
    fontSize: 15,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  secondaryButton: {
    alignItems: 'center',
    borderColor: '#b2cefe',
    borderRadius: 18,
    borderWidth: 2,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  secondaryButtonLabel: {
    color: '#3b82f6',
    fontSize: 14,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  fieldLabel: {
    color: '#1e3a8a',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: '#f8fbff',
    borderColor: '#cfe0ff',
    borderRadius: 18,
    borderWidth: 2,
    color: '#111827',
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  errorText: {
    color: '#b42318',
    fontSize: 13,
  },
  mutedText: {
    color: '#64748b',
    fontSize: 13,
  },
  chip: {
    alignSelf: 'flex-start',
    backgroundColor: '#eef4ff',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipActive: {
    backgroundColor: '#b2cefe',
  },
  chipLabel: {
    color: '#1e3a8a',
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  chipLabelActive: {
    color: '#0f172a',
  },
  segmented: {
    backgroundColor: '#e8f0ff',
    borderRadius: 18,
    flexDirection: 'row',
    padding: 4,
  },
  segment: {
    borderRadius: 14,
    flex: 1,
    paddingVertical: 10,
  },
  segmentActive: {
    backgroundColor: '#ffffff',
  },
  segmentLabel: {
    color: '#1e3a8a',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  segmentLabelActive: {
    color: '#111827',
    fontWeight: '800',
  },
});
