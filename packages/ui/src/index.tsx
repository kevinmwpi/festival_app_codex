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

export function HeroHeader({
  eyebrow,
  title,
  subtitle,
  rightSlot,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  rightSlot?: React.ReactNode;
}) {
  return (
    <View style={styles.heroCard}>
      {eyebrow ? <Text style={styles.heroEyebrow}>{eyebrow}</Text> : null}
      <View style={styles.heroRow}>
        <View style={styles.heroTextWrap}>
          <Text style={styles.heroTitle}>{title}</Text>
          {subtitle ? <Text style={styles.heroSubtitle}>{subtitle}</Text> : null}
        </View>
        {rightSlot}
      </View>
    </View>
  );
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

export function LoadingState({ title, description }: { title: string; description?: string }) {
  return (
    <SectionCard>
      <Text style={styles.emptyTitle}>{title}</Text>
      {description ? <Text style={styles.emptyDescription}>{description}</Text> : null}
    </SectionCard>
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

export function ArtistLineupCard({
  title,
  subtitle,
  badge,
  action,
  conflict,
}: {
  title: string;
  subtitle: string;
  badge?: string;
  action?: React.ReactNode;
  conflict?: boolean;
}) {
  return (
    <View style={[styles.lineupCard, conflict ? styles.lineupCardConflict : null]}>
      <View style={styles.lineupHeader}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={styles.lineupTitle}>{title}</Text>
          <Text style={styles.lineupSubtitle}>{subtitle}</Text>
        </View>
        {badge ? <Chip label={badge} active={conflict} /> : null}
      </View>
      {action}
    </View>
  );
}

export function ScheduleSetCard({
  title,
  subtitle,
  tone = 'default',
  detail,
}: {
  title: string;
  subtitle: string;
  tone?: 'default' | 'conflict' | 'success';
  detail?: React.ReactNode;
}) {
  return (
    <View style={[styles.scheduleCard, tone === 'conflict' ? styles.scheduleCardConflict : null, tone === 'success' ? styles.scheduleCardSuccess : null]}>
      <Text style={styles.scheduleTitle}>{title}</Text>
      <Text style={styles.scheduleSubtitle}>{subtitle}</Text>
      {detail}
    </View>
  );
}

export function AvatarStack({ labels }: { labels: string[] }) {
  return (
    <View style={styles.avatarStack}>
      {labels.slice(0, 4).map((label, index) => (
        <View key={`${label}-${index}`} style={[styles.avatarBubble, { marginLeft: index === 0 ? 0 : -10 }]}> 
          <Text style={styles.avatarBubbleText}>{label}</Text>
        </View>
      ))}
      {labels.length > 4 ? <Text style={styles.avatarMore}>+{labels.length - 4}</Text> : null}
    </View>
  );
}

export function InviteCodeCard({ code, onShare }: { code: string; onShare?: () => void }) {
  return (
    <View style={styles.inviteCard}>
      <Text style={styles.inviteLabel}>Invite code</Text>
      <Text style={styles.inviteCode}>{code}</Text>
      {onShare ? <SecondaryButton label="Share code" onPress={onShare} /> : null}
    </View>
  );
}

export function GroupHeroCard({
  title,
  subtitle,
  inviteCode,
  avatars,
}: {
  title: string;
  subtitle: string;
  inviteCode?: string;
  avatars?: string[];
}) {
  return (
    <View style={styles.groupHeroCard}>
      <Text style={styles.groupHeroTitle}>{title}</Text>
      <Text style={styles.groupHeroSubtitle}>{subtitle}</Text>
      {inviteCode ? <InviteCodeCard code={inviteCode} /> : null}
      {avatars?.length ? <AvatarStack labels={avatars} /> : null}
    </View>
  );
}

export function MeetupCard({ title, subtitle, meta }: { title: string; subtitle: string; meta?: string }) {
  return (
    <View style={styles.meetupCard}>
      <Text style={styles.meetupTitle}>{title}</Text>
      <Text style={styles.meetupSubtitle}>{subtitle}</Text>
      {meta ? <Text style={styles.meetupMeta}>{meta}</Text> : null}
    </View>
  );
}

export function MapOverlayCard({ title, subtitle, action }: { title: string; subtitle: string; action?: React.ReactNode }) {
  return (
    <View style={styles.mapOverlay}>
      <Text style={styles.mapOverlayTitle}>{title}</Text>
      <Text style={styles.mapOverlaySubtitle}>{subtitle}</Text>
      {action}
    </View>
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
  avatarBubble: {
    alignItems: 'center',
    backgroundColor: '#d8e7ff',
    borderColor: '#fff',
    borderRadius: 999,
    borderWidth: 2,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  avatarBubbleText: {
    color: '#0f172a',
    fontSize: 12,
    fontWeight: '800',
  },
  avatarMore: {
    color: '#334155',
    fontSize: 12,
    fontWeight: '700',
    marginLeft: 6,
  },
  avatarStack: {
    alignItems: 'center',
    flexDirection: 'row',
    marginTop: 8,
  },
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
  card: {
    backgroundColor: '#ffffff',
    borderColor: '#dbe7ff',
    borderRadius: 24,
    borderWidth: 1,
    gap: 10,
    padding: 18,
    shadowColor: '#93b4ef',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.14,
    shadowRadius: 16,
  },
  cardSubtitle: {
    color: '#64748b',
    fontSize: 14,
  },
  cardTitle: {
    color: '#111827',
    fontSize: 18,
    fontWeight: '800',
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
  emptyDescription: {
    color: '#64748b',
    fontSize: 14,
    lineHeight: 20,
  },
  emptyTitle: {
    color: '#111827',
    fontSize: 20,
    fontWeight: '800',
  },
  errorText: {
    color: '#b42318',
    fontSize: 13,
  },
  fieldLabel: {
    color: '#1e3a8a',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  groupHeroCard: {
    backgroundColor: '#0f172a',
    borderRadius: 28,
    gap: 8,
    padding: 20,
  },
  groupHeroSubtitle: {
    color: '#bfdbfe',
    fontSize: 14,
    lineHeight: 20,
  },
  groupHeroTitle: {
    color: '#f8fafc',
    fontSize: 24,
    fontWeight: '800',
  },
  heroCard: {
    backgroundColor: '#0f172a',
    borderRadius: 28,
    gap: 8,
    padding: 20,
  },
  heroEyebrow: {
    color: '#bfdbfe',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  heroRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  heroSubtitle: {
    color: '#cbd5e1',
    fontSize: 14,
    lineHeight: 20,
  },
  heroTextWrap: {
    flex: 1,
    gap: 4,
  },
  heroTitle: {
    color: '#f8fafc',
    fontSize: 28,
    fontWeight: '900',
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
  inviteCard: {
    backgroundColor: '#f8fbff',
    borderColor: '#bfd5ff',
    borderRadius: 18,
    borderWidth: 1,
    gap: 10,
    marginTop: 10,
    padding: 14,
  },
  inviteCode: {
    color: '#0f172a',
    fontSize: 32,
    fontWeight: '900',
    letterSpacing: 3,
    textAlign: 'center',
  },
  inviteLabel: {
    color: '#1e3a8a',
    fontSize: 12,
    fontWeight: '800',
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  lineupCard: {
    backgroundColor: '#fff',
    borderColor: '#dbe7ff',
    borderRadius: 24,
    borderWidth: 1,
    gap: 12,
    padding: 16,
  },
  lineupCardConflict: {
    borderColor: '#fdba74',
    backgroundColor: '#fff7ed',
  },
  lineupHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  lineupSubtitle: {
    color: '#475569',
    fontSize: 13,
  },
  lineupTitle: {
    color: '#0f172a',
    fontSize: 20,
    fontWeight: '800',
  },
  mapOverlay: {
    backgroundColor: '#ffffff',
    borderColor: '#dbe7ff',
    borderRadius: 20,
    borderWidth: 1,
    gap: 8,
    padding: 14,
  },
  mapOverlaySubtitle: {
    color: '#64748b',
    fontSize: 13,
  },
  mapOverlayTitle: {
    color: '#0f172a',
    fontSize: 16,
    fontWeight: '800',
  },
  meetupCard: {
    backgroundColor: '#eff6ff',
    borderRadius: 18,
    gap: 4,
    padding: 14,
  },
  meetupMeta: {
    color: '#1e3a8a',
    fontSize: 12,
    fontWeight: '700',
  },
  meetupSubtitle: {
    color: '#334155',
    fontSize: 13,
  },
  meetupTitle: {
    color: '#0f172a',
    fontSize: 16,
    fontWeight: '800',
  },
  mutedText: {
    color: '#64748b',
    fontSize: 13,
  },
  scheduleCard: {
    backgroundColor: '#ffffff',
    borderColor: '#dbe7ff',
    borderRadius: 22,
    borderWidth: 1,
    gap: 6,
    padding: 16,
  },
  scheduleCardConflict: {
    backgroundColor: '#fff7ed',
    borderColor: '#fb923c',
  },
  scheduleCardSuccess: {
    backgroundColor: '#ecfeff',
    borderColor: '#7dd3fc',
  },
  scheduleSubtitle: {
    color: '#475569',
    fontSize: 14,
  },
  scheduleTitle: {
    color: '#0f172a',
    fontSize: 18,
    fontWeight: '800',
  },
  screen: {
    backgroundColor: '#f4f7ff',
    flex: 1,
  },
  screenContent: {
    gap: 16,
    padding: 20,
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
  segment: {
    borderRadius: 14,
    flex: 1,
    paddingVertical: 10,
  },
  segmentActive: {
    backgroundColor: '#ffffff',
  },
  segmented: {
    backgroundColor: '#e8f0ff',
    borderRadius: 18,
    flexDirection: 'row',
    padding: 4,
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
