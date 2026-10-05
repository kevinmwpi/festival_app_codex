import { Checkbox, checkboxLabelStyle, colors, InlineMessage, PrimaryButton, spacing, TextLink } from '@festival/ui';
import React from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { openPrivacyPolicy, openTermsOfUse } from '@/src/providers/external-links';
import { resetTo } from '@/src/providers/launch-route';
import { ProfileFields, useProfileForm } from '@/src/providers/profile-form';
import { performSignOut, signOutErrorMessage } from '@/src/providers/session-actions';

export default function ProfileSetupScreen() {
  const form = useProfileForm(null);
  const [agreed, setAgreed] = React.useState(false);
  const [signingOut, setSigningOut] = React.useState(false);

  const handleSave = React.useCallback(async () => {
    if (!agreed) {
      form.setError('Please agree to the Terms of Use and Privacy Policy to continue.');
      return;
    }
    const saved = await form.save();
    if (saved) {
      // The launch route continues to the join screen for a remembered invite, or into the app.
      resetTo('/');
    }
  }, [agreed, form]);

  const handleSignOut = React.useCallback(() => {
    setSigningOut(true);
    performSignOut('sign_out').catch((error: unknown) => {
      setSigningOut(false);
      form.setError(signOutErrorMessage(error));
    });
  }, [form]);

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.contentContainer} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.content}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title} accessibilityRole="header">Your Profile</Text>
            <Text style={styles.subtitle}>Pick a name and avatar so your crew can spot you.</Text>
          </View>

          <ProfileFields form={form} />

          <View style={styles.terms}>
            <Checkbox
              checked={agreed}
              onChange={(next) => {
                setAgreed(next);
                if (next) form.setError(null);
              }}
              accessibilityLabel="I agree to the Terms of Use and Privacy Policy"
              accessibilityActions={[
                { name: 'openTerms', label: 'Open Terms of Use' },
                { name: 'openPrivacy', label: 'Open Privacy Policy' },
              ]}
              onAccessibilityAction={(action) => {
                if (action === 'openTerms') openTermsOfUse();
                if (action === 'openPrivacy') openPrivacyPolicy();
              }}
              label={
                <Text style={checkboxLabelStyle}>
                  I agree to the{' '}
                  <Text style={styles.link} onPress={openTermsOfUse} accessibilityRole="link">
                    Terms of Use
                  </Text>{' '}
                  and{' '}
                  <Text style={styles.link} onPress={openPrivacyPolicy} accessibilityRole="link">
                    Privacy Policy
                  </Text>
                </Text>
              }
            />
            <Text style={styles.termsNote}>
              No harassment, hate or explicit content. You can report or block anyone, and we review reports within 24 hours.
            </Text>
          </View>

          <InlineMessage message={form.error} />
          <PrimaryButton
            disabled={!form.nameValid || !agreed}
            loading={form.saving}
            label="Let's go"
            onPress={() => void handleSave()}
          />
          <View style={styles.signOutRow}>
            <TextLink label={signingOut ? 'Signing out…' : 'Sign out'} onPress={signingOut ? () => undefined : handleSignOut} />
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  contentContainer: {
    paddingHorizontal: spacing.xl,
    paddingTop: 60,
    paddingBottom: spacing.xxxl,
  },
  content: {
    gap: spacing.lg,
  },
  header: {
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  title: {
    fontFamily: 'Georgia',
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
  terms: { gap: spacing.xs },
  link: { color: colors.link, fontWeight: '700', textDecorationLine: 'underline' },
  termsNote: { color: colors.textSecondary, fontSize: 12, lineHeight: 17, paddingLeft: 36 },
  signOutRow: { alignItems: 'center' },
});
