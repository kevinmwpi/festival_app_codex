import { requestEmailCode, toUserMessage, verifyEmailCode } from '@festival/data-access';
import { colors, InlineMessage, PrimaryButton, radii, showToast, spacing, TextLink } from '@festival/ui';
import { router, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { OTP_LENGTH } from '@/src/config/app-info';
import { resetTo } from '@/src/providers/launch-route';
import { trackSignIn } from '@/src/providers/owner-check';
import { notifySessionChanged } from '@/src/providers/session-state';

/** Pasted codes of this length are accepted with the Verify button (sign-in codes and review codes). */
const MIN_CODE_LENGTH = 6;
const MAX_CODE_LENGTH = 10;
const RESEND_COOLDOWN_S = 60;

function firstParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

export default function VerifyOtpScreen() {
  const params = useLocalSearchParams<{ email?: string; sent?: string }>();
  const email = firstParam(params.email).trim();
  // Arriving via "I already have a code" (`sent=0`): no code was just sent, so resending is allowed now.
  const justSent = firstParam(params.sent) !== '0';

  const [code, setCode] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [verifying, setVerifying] = React.useState(false);
  const [resending, setResending] = React.useState(false);
  const [cooldownEndsAt, setCooldownEndsAt] = React.useState<number>(() => (justSent ? Date.now() + RESEND_COOLDOWN_S * 1000 : 0));
  const [now, setNow] = React.useState(() => Date.now());
  const inputRef = React.useRef<TextInput>(null);
  const verifyingRef = React.useRef(false);
  const mountedRef = React.useRef(true);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // After a rejected code, bring the keyboard back for the retry. This runs once the input is editable
  // again: focusing from the submit handler happens while it is still disabled and is ignored.
  React.useEffect(() => {
    if (!verifying && error) inputRef.current?.focus();
  }, [verifying, error]);

  const secondsLeft = Math.max(0, Math.ceil((cooldownEndsAt - now) / 1000));

  React.useEffect(() => {
    if (secondsLeft <= 0) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [secondsLeft]);

  const submit = React.useCallback(
    async (candidate: string) => {
      if (verifyingRef.current || candidate.length < MIN_CODE_LENGTH || candidate.length > MAX_CODE_LENGTH) return;
      verifyingRef.current = true;
      setVerifying(true);
      setError(null);
      try {
        // Tracked so the launch route waits for the local owner check inside it: the session guard
        // lands on `index` at `SIGNED_IN`, before this call has finished claiming the local cache.
        await trackSignIn(verifyEmailCode(email, candidate));
        notifySessionChanged();
        // The session guard in the root layout normally removes this screen and lands on the launch
        // route already (profile setup, the join screen for a remembered invite, or the app); this only
        // covers the screen still being shown.
        if (mountedRef.current) resetTo('/');
      } catch (verifyError) {
        setError(toUserMessage(verifyError));
        setCode('');
      } finally {
        verifyingRef.current = false;
        setVerifying(false);
      }
    },
    [email],
  );

  const handleChange = React.useCallback(
    (value: string) => {
      const digits = value.replace(/\D/g, '').slice(0, MAX_CODE_LENGTH);
      setCode(digits);
      if (error) setError(null);
      // Auto-submit only for a complete sign-in code; longer pasted codes use the Verify button.
      if (digits.length === OTP_LENGTH) {
        void submit(digits);
      }
    },
    [error, submit],
  );

  const handleResend = React.useCallback(async () => {
    if (resending || secondsLeft > 0) return;
    setResending(true);
    setError(null);
    try {
      await requestEmailCode(email);
      setCooldownEndsAt(Date.now() + RESEND_COOLDOWN_S * 1000);
      setNow(Date.now());
      setCode('');
      showToast(`New code sent to ${email}`, 'success');
    } catch (resendError) {
      setError(toUserMessage(resendError));
    } finally {
      setResending(false);
    }
  }, [email, resending, secondsLeft]);

  const handleChangeEmail = React.useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/auth/enter-email');
    }
  }, []);

  if (!email) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Text style={styles.title} accessibilityRole="header">Verify Code</Text>
        <Text style={styles.subtitle}>Enter your email first so we know where to send the code.</Text>
        <PrimaryButton label="Enter email" onPress={() => router.replace('/auth/enter-email')} />
      </View>
    );
  }

  const boxCount = Math.max(OTP_LENGTH, code.length);
  const canVerify = code.length >= MIN_CODE_LENGTH && code.length <= MAX_CODE_LENGTH;

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.content}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title} accessibilityRole="header">Verify Code</Text>
            <Text style={styles.subtitle}>
              {justSent ? `We sent a ${OTP_LENGTH}-digit code to ${email}` : `Enter the ${OTP_LENGTH}-digit code we emailed to ${email}`}
            </Text>
          </View>

          {/* Code boxes over one transparent input: taps focus it, and it receives typing, paste and
              the keyboard's one-time-code autofill. */}
          <Pressable
            onPress={() => inputRef.current?.focus()}
            style={styles.otpRow}
            accessible={false}
            importantForAccessibility="no"
          >
            {Array.from({ length: boxCount }).map((_, index) => {
              const active = index === code.length && !verifying;
              return (
                <View
                  key={index}
                  style={[styles.otpCell, code[index] ? styles.otpCellFilled : null, active && styles.otpCellActive, error ? styles.otpCellError : null]}
                  importantForAccessibility="no-hide-descendants"
                  accessibilityElementsHidden
                >
                  <Text style={styles.otpText} allowFontScaling={false}>
                    {code[index] ?? ''}
                  </Text>
                </View>
              );
            })}
            <TextInput
              ref={inputRef}
              accessibilityLabel={`Sign-in code, ${OTP_LENGTH} digits`}
              accessibilityHint="The code is checked automatically when complete"
              autoComplete="one-time-code"
              autoFocus
              caretHidden
              contextMenuHidden={false}
              editable={!verifying}
              keyboardType="number-pad"
              maxLength={MAX_CODE_LENGTH}
              onChangeText={handleChange}
              onSubmitEditing={() => void submit(code)}
              selectionColor="transparent"
              style={styles.hiddenInput}
              textContentType="oneTimeCode"
              value={code}
            />
          </Pressable>

          <InlineMessage message={error} />

          <PrimaryButton
            label={verifying ? 'Checking code…' : 'Verify'}
            loading={verifying}
            disabled={!canVerify}
            onPress={() => void submit(code)}
          />

          <View style={styles.links}>
            {secondsLeft > 0 ? (
              <Text style={styles.helper} accessibilityLiveRegion="polite">
                Didn&apos;t get it? Check spam, or resend in {secondsLeft}s
              </Text>
            ) : (
              <TextLink
                align="center"
                label={resending ? 'Sending…' : 'Resend code'}
                accessibilityLabel={`Resend code to ${email}`}
                onPress={() => void handleResend()}
              />
            )}
            <TextLink align="center" label="Use a different email" onPress={handleChangeEmail} />
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
  centered: {
    gap: spacing.lg,
    justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.xxxl,
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
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  otpRow: {
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
  },
  // Nearly transparent rather than 0-sized/opacity 0, which some platforms treat as not focusable.
  hiddenInput: {
    ...StyleSheet.absoluteFillObject,
    color: 'transparent',
    fontSize: 1,
    opacity: 0.02,
  },
  otpCell: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.borderCard,
    borderRadius: radii.md,
    borderWidth: 1,
    flex: 1,
    maxWidth: 48,
    minHeight: 56,
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
  otpCellActive: {
    borderColor: colors.link,
    borderWidth: 2,
  },
  otpCellError: {
    borderColor: colors.destructive,
  },
  otpText: {
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: '700',
  },
  links: {
    alignItems: 'center',
    // TextLink is 20pt tall with 12pt hitSlop above and below: 24pt apart, the touch areas don't overlap.
    gap: spacing.xl,
    marginTop: spacing.xs,
  },
  helper: {
    color: colors.textSecondary,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 20,
  },
});
