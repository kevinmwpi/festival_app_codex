import { signInWithOTP } from '@festival/data-access';
import { colors, FieldInput, InlineMessage, PrimaryButton } from '@festival/ui';
import { router } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

const MAX_EMAIL_LENGTH = 254;

/** Default auth screen uses Coachella palette before a festival is chosen */
const AUTH_BG     = '#FFF5F9';
const AUTH_ACCENT = '#FFB3D9';

export default function EnterEmailScreen() {
  const [email, setEmail] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const handleSubmit = React.useCallback(async () => {
    const trimmed = email.trim();
    if (trimmed.length > MAX_EMAIL_LENGTH) { setError('Please enter a valid email address.'); return; }
    setLoading(true);
    setError(null);
    try {
      await signInWithOTP(trimmed);
      router.push({ pathname: '/auth/verify-otp', params: { email: trimmed } });
    } catch (err: any) {
      const msg = err?.message || 'Unable to send code.';
      setError(msg.toLowerCase().includes('rate limit')
        ? 'Too many attempts. Please wait a few minutes and try again.'
        : msg);
    } finally {
      setLoading(false);
    }
  }, [email]);

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        {/* Icon */}
        <View style={styles.iconWrap}>
          <View style={[styles.iconBox, { backgroundColor: AUTH_ACCENT }]}>
            {/* Tent-like shape via text icon */}
            <Text style={styles.iconGlyph}>⛺</Text>
          </View>
        </View>

        {/* Wordmark */}
        <View style={styles.brand}>
          <Text style={styles.wordmark}>Festie</Text>
          <Text style={styles.tagline}>Ready for the show?</Text>
        </View>

        {/* Form */}
        <View style={styles.form}>
          <FieldInput
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            onChangeText={setEmail}
            placeholder="Your Name"
            value=""
            style={styles.nameInput}
          />
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
            label="Enter Festival"
            onPress={handleSubmit}
            accentColor={AUTH_ACCENT}
          />

          {/* Social buttons row */}
          <View style={styles.socialRow}>
            <Pressable style={[styles.socialBtn, { opacity: 0.7 }]}>
              <Text style={styles.socialLabel}>G  Google</Text>
            </Pressable>
            <Pressable style={[styles.socialBtn, styles.socialBtnDark]}>
              <Text style={[styles.socialLabel, { color: '#FFFFFF' }]}>  Apple</Text>
            </Pressable>
          </View>

          <View style={styles.legalRow}>
            <Text style={styles.legalText}>By continuing you agree to our </Text>
            <Pressable onPress={() => router.push('/legal/terms-of-use')}>
              <Text style={styles.legalLink}>Terms</Text>
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
    backgroundColor: AUTH_BG,
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  content: { gap: 32 },
  iconWrap: { alignItems: 'center' },
  iconBox: {
    width: 80,
    height: 80,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  iconGlyph: { fontSize: 36 },
  brand: { alignItems: 'center', gap: 4 },
  wordmark: {
    fontFamily: 'Georgia',
    fontStyle: 'italic',
    fontSize: 52,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  tagline: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textSecondary,
    letterSpacing: 0.5,
  },
  form: { gap: 12 },
  nameInput: { paddingVertical: 20, fontSize: 16 },
  emailInput: { paddingVertical: 20, fontSize: 16 },
  socialRow: { flexDirection: 'row', gap: 12 },
  socialBtn: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    paddingVertical: 16,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
    borderWidth: 1,
    borderColor: colors.borderCard,
  },
  socialBtnDark: { backgroundColor: '#000000', borderColor: '#000000' },
  socialLabel: { fontSize: 13, fontWeight: '700', color: colors.textPrimary },
  legalRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', marginTop: 4 },
  legalText: { fontSize: 12, color: colors.textSecondary },
  legalLink: { fontSize: 12, color: colors.primary, fontWeight: '700' },
});
