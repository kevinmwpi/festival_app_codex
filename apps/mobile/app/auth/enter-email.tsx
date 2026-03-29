import { signInWithOTP } from '@festival/data-access';
import { colors, FieldInput, InlineMessage, PrimaryButton } from '@festival/ui';
import { router } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

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
      setError(submissionError instanceof Error ? submissionError.message : 'Unable to send code.');
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
});
