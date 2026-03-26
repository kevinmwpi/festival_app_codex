import { signInWithOTP } from '@festival/data-access';
import { FieldInput, FieldLabel, InlineMessage, PrimaryButton, Screen, SectionCard } from '@festival/ui';
import { router } from 'expo-router';
import React from 'react';
import { Text } from 'react-native';

export default function EnterEmailScreen() {
  const [email, setEmail] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const handleSubmit = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await signInWithOTP(email.trim());
      router.push({
        pathname: '/auth/verify-otp',
        params: { email: email.trim() },
      });
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : 'Unable to send your magic link.');
    } finally {
      setLoading(false);
    }
  }, [email]);

  return (
    <Screen scroll>
      <SectionCard title="Festival-ready sign in" subtitle="Use a one-time email code so your plans sync across devices.">
        <Text style={{ color: '#64748b', lineHeight: 21 }}>
          Enter the email you want tied to your festival schedule, group invites, and offline sync queue.
        </Text>
        <FieldLabel>Email</FieldLabel>
        <FieldInput
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          onChangeText={setEmail}
          placeholder="you@example.com"
          value={email}
        />
        <InlineMessage message={error} />
        <PrimaryButton disabled={loading || email.trim().length < 5} label={loading ? 'Sending...' : 'Send magic link'} onPress={handleSubmit} />
      </SectionCard>
    </Screen>
  );
}
