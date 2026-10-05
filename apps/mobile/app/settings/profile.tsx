import { colors, InlineMessage, PrimaryButton, ScreenHeader, SectionCard, showToast, spacing } from '@festival/ui';
import { Ionicons } from '@expo/vector-icons';
import { usePreventRemove } from '@react-navigation/native';
import { router, useNavigation } from 'expo-router';
import React from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from 'react-native';

import { ProfileFields, useProfileForm } from '@/src/providers/profile-form';
import { useCachedProfile } from '@/src/providers/session-state';
import { useFestivalScreenTint } from '@/src/providers/screen-tint';

export default function EditProfileScreen() {
  const screenTint = useFestivalScreenTint();
  const profile = useCachedProfile();
  // The form starts from the profile as it was when the screen opened.
  const [initial] = React.useState(profile);
  const form = useProfileForm(initial);
  const navigation = useNavigation();
  const [saved, setSaved] = React.useState(false);

  // Ask before throwing away unsaved edits (back button, swipe back).
  usePreventRemove(form.dirty && !saved && !form.saving, ({ data }) => {
    Alert.alert('Discard changes?', "Your profile changes haven't been saved.", [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => navigation.dispatch(data.action) },
    ]);
  });

  React.useEffect(() => {
    if (saved) router.back();
  }, [saved]);

  const handleSave = React.useCallback(async () => {
    const result = await form.save();
    if (result) {
      showToast('Profile updated', 'success');
      setSaved(true);
    }
  }, [form]);

  return (
    <KeyboardAvoidingView style={[styles.screen, { backgroundColor: screenTint }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <ScreenHeader
          title="Edit profile"
          subtitle="How your crew sees you"
          onBack={() => router.back()}
          backIcon={<Ionicons name="chevron-back" size={22} color={colors.textPrimary} />}
        />
        <SectionCard>
          <ProfileFields form={form} />
        </SectionCard>
        <InlineMessage message={form.error} />
        <PrimaryButton
          label="Save changes"
          loading={form.saving}
          disabled={!form.dirty || !form.nameValid}
          onPress={() => void handleSave()}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.background, flex: 1 },
  content: { gap: spacing.lg, padding: spacing.lg, paddingBottom: spacing.xxxl + spacing.xl },
});
