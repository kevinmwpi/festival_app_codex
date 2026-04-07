import { signInWithOTP } from '@festival/data-access';
import { colors, FieldInput, InlineMessage, PrimaryButton } from '@festival/ui';
import { router } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

const MAX_EMAIL_LENGTH = 254;

export default function EnterEmailScreen() {
  const [email, setEmail] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const handleSubmit = React.useCallback(async () => {
    const trimmed = email.trim();
    if (trimmed.length > MAX_EMAIL_LENGTH) {
      setError('Please enter a valid email address.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await signInWithOTP(trimmed);
      router.push({
        pathname: '/auth/verify-otp',
        params: { email: trimmed },
      });
    } catch (submissionError: any) {
      console.error('[OTP Error]', JSON.stringify(submissionError, null, 2));
      const msg = submissionError?.message || submissionError?.error_description || 'Unable to send code.';
      setError(`${msg} (status: ${submissionError?.status ?? 'unknown'})`);
    } finally {
      setLoading(false);
    }
  }, [email]);

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        {/* Logo */}
        <View style={styles.logoContainer}>
          <View style={styles.logoCircle}>
            <Text style={styles.logoEmoji}>🎵</Text>
          </View>
          <Text style={styles.title}>Festie</Text>
          <Text style={styles.subtitle}>READY FOR THE SHOW?</Text>
        </View>

        {/* Form */}
        <View style={styles.form}>
          <FieldInput
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            onChangeText={setEmail}
            placeholder="Email Address"
            value={email}
            style={styles.emailInput}
          />
          <InlineMessage message={error} />
          <PrimaryButton
            disabled={email.trim().length < 5}
            loading={loading}
            label="Send Code"
            onPress={handleSubmit}
          />
          <View style={styles.legalRow}>
            <Text style={styles.legalText}>By continuing you agree to our </Text>
            <Pressable onPress={() => router.push('/legal/terms-of-use')}>
              <Text style={styles.legalLink}>Terms of Use</Text>
            </Pressable>
            <Text style={styles.legalText}> and </Text>
            <Pressable onPress={() => router.push('/legal/privacy-policy')}>
              <Text style={styles.legalLink}>Privacy Policy</Text>
            </Pressable>
          </View>
        </View>
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
    gap: 32,
  },
  logoContainer: {
    alignItems: 'center',
    gap: 8,
  },
  logoCircle: {
    width: 80,
    height: 80,
    borderRadius: 32,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    shadowColor: colors.primary,
    shadowOpacity: 0.4,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  logoEmoji: {
    fontSize: 40,
  },
  title: {
    fontSize: 48,
    fontWeight: '700',
    fontStyle: 'italic',
    color: colors.textPrimary,
  },
  subtitle: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 3,
    marginTop: 4,
  },
  form: {
    gap: 16,
  },
  emailInput: {
    paddingVertical: 20,
    borderRadius: 16,
    fontSize: 16,
    fontWeight: '700',
  },
  legalRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 4,
  },
  legalText: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  legalLink: {
    fontSize: 12,
    color: colors.primary,
    fontWeight: '600',
  },
});
