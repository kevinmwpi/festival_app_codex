import { getCurrentProfile, verifyOTP } from '@festival/data-access';
import { colors, FieldInput, InlineMessage } from '@festival/ui';
import { router, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export default function VerifyOtpScreen() {
  const params = useLocalSearchParams<{ email?: string }>();
  const email = Array.isArray(params.email) ? params.email[0] : params.email ?? '';
  const [otp, setOtp] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const submitOtp = React.useCallback(
    async (nextOtp: string) => {
      if (nextOtp.length !== 6) return;
      setLoading(true);
      setError(null);
      try {
        await verifyOTP(email, nextOtp);
        const profile = await getCurrentProfile();
        if (profile) {
          router.replace('/(tabs)/schedule');
        } else {
          router.replace('/auth/profile-setup');
        }
      } catch (submissionError) {
        setError(submissionError instanceof Error ? submissionError.message : 'That code was not accepted.');
      } finally {
        setLoading(false);
      }
    },
    [email],
  );

  const handleChange = React.useCallback(
    (value: string) => {
      const digits = value.replace(/\D/g, '').slice(0, 6);
      setOtp(digits);
      if (digits.length === 6) {
        void submitOtp(digits);
      }
    },
    [submitOtp],
  );

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Verify Code</Text>
          <Text style={styles.subtitle}>
            {email ? `We sent a six-digit code to ${email}` : 'Enter the six-digit code from your inbox'}
          </Text>
        </View>

        {/* OTP Display */}
        <View style={styles.otpRow}>
          {Array.from({ length: 6 }).map((_, index) => (
            <View key={index} style={[styles.otpCell, otp[index] ? styles.otpCellFilled : null]}>
              <Text style={styles.otpText}>{otp[index] ?? ''}</Text>
            </View>
          ))}
        </View>

        {/* Hidden input */}
        <FieldInput
          keyboardType="number-pad"
          maxLength={6}
          onChangeText={handleChange}
          placeholder="123456"
          value={otp}
          autoFocus
        />
        <InlineMessage message={error} />
        <Text style={styles.helper}>
          {loading ? 'Checking code...' : 'Code submits automatically when complete.'}
        </Text>

        {/* Back */}
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backLabel}>Use different email</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  content: {
    gap: 20,
  },
  header: {
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    fontStyle: 'italic',
    color: colors.textPrimary,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  otpRow: {
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
  },
  otpCell: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.borderCard,
    borderRadius: 16,
    borderWidth: 1,
    flex: 1,
    paddingVertical: 16,
    shadowColor: colors.shadow,
    shadowOpacity: 1,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  otpCellFilled: {
    borderColor: colors.primary,
    borderWidth: 2,
  },
  otpText: {
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: '700',
  },
  helper: {
    color: colors.textSecondary,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 20,
  },
  backButton: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  backLabel: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '700',
  },
});
