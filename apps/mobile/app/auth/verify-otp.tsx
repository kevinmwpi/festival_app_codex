import { getCurrentProfile, verifyOTP } from '@festival/data-access';
import { FieldInput, HeroHeader, InlineMessage, Screen, SectionCard } from '@festival/ui';
import { router, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

export default function VerifyOtpScreen() {
  const params = useLocalSearchParams<{ email?: string }>();
  const email = Array.isArray(params.email) ? params.email[0] : params.email ?? '';
  const [otp, setOtp] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const submitOtp = React.useCallback(
    async (nextOtp: string) => {
      if (nextOtp.length !== 6) {
        return;
      }

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
    <Screen scroll>
      <HeroHeader eyebrow="Check inbox" title="Verify your code" subtitle={email ? `We sent a six-digit code to ${email}.` : 'Enter the six-digit code from your inbox.'} />
      <SectionCard>
        <View style={styles.otpRow}>
          {Array.from({ length: 6 }).map((_, index) => (
            <View key={index} style={styles.otpCell}>
              <Text style={styles.otpText}>{otp[index] ?? '•'}</Text>
            </View>
          ))}
        </View>
        <FieldInput keyboardType="number-pad" maxLength={6} onChangeText={handleChange} placeholder="123456" value={otp} />
        <InlineMessage message={error} />
        <Text style={styles.helper}>{loading ? 'Checking code...' : 'The code submits automatically when the sixth digit is entered.'}</Text>
      </SectionCard>
    </Screen>
  );
}

const styles = StyleSheet.create({
  helper: {
    color: '#64748b',
    lineHeight: 20,
  },
  otpCell: {
    alignItems: 'center',
    backgroundColor: '#f8fbff',
    borderColor: '#cfe0ff',
    borderRadius: 16,
    borderWidth: 2,
    flex: 1,
    paddingVertical: 12,
  },
  otpRow: {
    flexDirection: 'row',
    gap: 8,
  },
  otpText: {
    color: '#1e3a8a',
    fontSize: 22,
    fontWeight: '700',
  },
});
