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
    backgroundColor: '#ffd166',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  bannerText: {
    color: '#2d1800',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  screen: {
    flex: 1,
    backgroundColor: '#f6efe7',
  },
  screenContent: {
    gap: 16,
    padding: 20,
  },
  card: {
    backgroundColor: '#fffaf6',
    borderColor: '#eaded0',
    borderRadius: 20,
    borderWidth: 1,
    gap: 8,
    padding: 18,
    shadowColor: '#a38b72',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: {
      width: 0,
      height: 6,
    },
  },
  cardTitle: {
    color: '#2f241d',
    fontSize: 18,
    fontWeight: '700',
  },
  cardSubtitle: {
    color: '#6a5a4d',
    fontSize: 14,
  },
  emptyTitle: {
    color: '#2f241d',
    fontSize: 20,
    fontWeight: '700',
  },
  emptyDescription: {
    color: '#6a5a4d',
    fontSize: 14,
    lineHeight: 20,
  },
  button: {
    alignItems: 'center',
    backgroundColor: '#e85d3f',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonLabel: {
    color: '#fff8f1',
    fontSize: 15,
    fontWeight: '700',
  },
  secondaryButton: {
    alignItems: 'center',
    borderColor: '#dfc7b2',
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  secondaryButtonLabel: {
    color: '#4a3527',
    fontSize: 15,
    fontWeight: '600',
  },
  fieldLabel: {
    color: '#3d2d20',
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  input: {
    backgroundColor: '#ffffff',
    borderColor: '#e2d4c6',
    borderRadius: 14,
    borderWidth: 1,
    color: '#201712',
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  errorText: {
    color: '#b42318',
    fontSize: 13,
  },
  mutedText: {
    color: '#6a5a4d',
    fontSize: 13,
  },
  chip: {
    alignSelf: 'flex-start',
    backgroundColor: '#efe4d8',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  chipActive: {
    backgroundColor: '#20352f',
  },
  chipLabel: {
    color: '#5a483c',
    fontSize: 12,
    fontWeight: '700',
  },
  chipLabelActive: {
    color: '#f8f4ef',
  },
  segmented: {
    backgroundColor: '#efe4d8',
    borderRadius: 16,
    flexDirection: 'row',
    padding: 4,
  },
  segment: {
    borderRadius: 12,
    flex: 1,
    paddingVertical: 10,
  },
  segmentActive: {
    backgroundColor: '#fffaf6',
  },
  segmentLabel: {
    color: '#5a483c',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  segmentLabelActive: {
    color: '#241812',
    fontWeight: '700',
  },
});
