import {
  REPORT_DETAILS_MAX_LENGTH,
  REPORT_REASONS,
  reportContent,
  toUserMessage,
  type ReportReason,
  type ReportTargetType,
} from '@festival/data-access';
import { colors, FieldInput, FieldLabel, InlineMessage, PrimaryButton, radii, showToast, spacing } from '@festival/ui';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BottomSheet } from './BottomSheet';

export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  spam: 'Spam',
  harassment: 'Harassment or bullying',
  hate: 'Hate speech',
  sexual: 'Sexual content',
  violence: 'Violence or threats',
  impersonation: 'Impersonation',
  other: 'Something else',
};

export const REPORT_THANKS = "Thanks — we'll review this within 24 hours.";

export interface ReportTarget {
  type: ReportTargetType;
  /** For `photo`, the meetup id. */
  id: string;
  /** What is being reported, for the sheet title ("Report Alex", "Report this photo"). */
  label: string;
}

/**
 * Report flow (§5.4): reason picker + optional details → `reportContent` → thank-you toast. Reporting
 * the same thing twice is fine (the server returns the existing report).
 */
export function ReportSheet({ target, onClose }: { target: ReportTarget | null; onClose: () => void }) {
  const [reason, setReason] = React.useState<ReportReason | null>(null);
  const [details, setDetails] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (target) {
      setReason(null);
      setDetails('');
      setError(null);
      setSubmitting(false);
    }
  }, [target]);

  const submit = React.useCallback(async () => {
    if (!target || !reason) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await reportContent(target.type, target.id, reason, details.trim() || null);
      onClose();
      showToast(REPORT_THANKS, 'success');
    } catch (reportError) {
      setError(toUserMessage(reportError));
    } finally {
      setSubmitting(false);
    }
  }, [details, onClose, reason, target]);

  return (
    <BottomSheet
      visible={target !== null}
      onClose={onClose}
      title={target?.label ?? 'Report'}
      subtitle="Reports are anonymous to the person you report. Our team reviews every report."
    >
      <FieldLabel>Reason</FieldLabel>
      <View style={styles.reasons} accessibilityRole="radiogroup">
        {REPORT_REASONS.map((value) => {
          const selected = reason === value;
          return (
            <Pressable
              key={value}
              onPress={() => setReason(value)}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              accessibilityLabel={REPORT_REASON_LABELS[value]}
              style={({ pressed }) => [styles.reason, selected && styles.reasonSelected, pressed && styles.pressed]}
            >
              <View style={[styles.radio, selected && styles.radioSelected]} />
              <Text style={styles.reasonLabel}>{REPORT_REASON_LABELS[value]}</Text>
            </Pressable>
          );
        })}
      </View>

      <FieldLabel>Details (optional)</FieldLabel>
      <FieldInput
        value={details}
        onChangeText={setDetails}
        placeholder="Anything that helps us understand"
        multiline
        maxLength={REPORT_DETAILS_MAX_LENGTH}
        style={styles.details}
        accessibilityLabel="Details, optional"
      />
      <Text style={styles.counter}>
        {details.length}/{REPORT_DETAILS_MAX_LENGTH}
      </Text>

      <InlineMessage message={error} />
      <PrimaryButton label="Send report" onPress={() => void submit()} disabled={!reason} loading={submitting} />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  reasons: { gap: spacing.xs },
  reason: {
    alignItems: 'center',
    borderColor: colors.borderCard,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm + 4,
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  reasonSelected: { backgroundColor: '#F0F4FF', borderColor: colors.primary },
  pressed: { opacity: 0.7 },
  radio: { borderColor: 'rgba(44, 51, 39, 0.35)', borderRadius: 10, borderWidth: 2, height: 20, width: 20 },
  radioSelected: { backgroundColor: colors.link, borderColor: colors.link },
  reasonLabel: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  details: { minHeight: 88, paddingTop: spacing.md, textAlignVertical: 'top' },
  counter: { alignSelf: 'flex-end', color: colors.textSecondary, fontSize: 12, marginTop: -spacing.sm },
});
