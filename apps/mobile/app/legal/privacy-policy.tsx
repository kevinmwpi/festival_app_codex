import { colors } from '@festival/ui';
import { Stack } from 'expo-router';
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

type Section = { heading: string; body: string };

const SECTIONS: Section[] = [
  {
    heading: '1. Information We Collect',
    body:
      'Account: email address, display name, and avatar.\n\n' +
      'Schedule: festivals you follow and artist sets you select.\n\n' +
      'Group & social: group memberships, meetup details, totem photos you upload, and group chat messages.\n\n' +
      'Location: real-time GPS coordinates (latitude, longitude, heading, accuracy) — only when you explicitly enable location sharing within a group. Location data is shared only with your group members and is deleted automatically after 5 minutes.\n\n' +
      'Session: authentication tokens stored securely on your device.',
  },
  {
    heading: '2. How We Use Your Information',
    body:
      'We use your information solely to operate the App:\n\n' +
      '• Email — to authenticate you via one-time code\n' +
      '• Display name & avatar — shown to your group members\n' +
      '• Schedule data — to build your personal festival schedule\n' +
      '• Group & meetup data — to coordinate with your crew\n' +
      '• Location — to show your pin on the group map in real time\n' +
      '• Totem photos — to display your group\'s meetup photo\n\n' +
      'We do not use your data for advertising.',
  },
  {
    heading: '3. How We Share Your Information',
    body:
      'We share your information only in these limited circumstances:\n\n' +
      '• With your group members — display name, avatar, location (when sharing), and meetup details are visible to people in your group.\n\n' +
      '• With our service providers — Supabase (database & auth), Mapbox (maps), and Expo/EAS (app delivery). These providers process data only to operate the App.\n\n' +
      '• If required by law.\n\n' +
      'We do not sell your data to any third party.',
  },
  {
    heading: '4. Data Retention',
    body:
      'Account and schedule data: retained until you delete your account.\n\n' +
      'Location shares: automatically deleted after 5 minutes.\n\n' +
      'Group and meetup data: retained until the group is deleted.\n\n' +
      'To request deletion of your account and all data, contact: privacy@festie.app',
  },
  {
    heading: '5. Data Security',
    body:
      'All data in transit is encrypted via HTTPS/TLS. Authentication tokens are stored in encrypted on-device storage. Database access is protected by Row-Level Security — you can only access your own data and data shared by your groups. Photos have EXIF metadata stripped before upload. Rate limiting is enforced on all authentication endpoints.',
  },
  {
    heading: '6. Children\'s Privacy',
    body:
      'Festie is not directed to children under 13. We do not knowingly collect personal information from children under 13. If you believe we have inadvertently collected such information, contact us and we will delete it promptly.',
  },
  {
    heading: '7. Your Rights',
    body:
      'Depending on your location, you may have rights to access, correct, or delete your personal data, or to object to certain processing. To exercise these rights, email: privacy@festie.app',
  },
  {
    heading: '8. Changes to This Policy',
    body:
      'We may update this policy from time to time. We will notify you by updating the "Last updated" date. Continued use of the App after changes constitutes acceptance.',
  },
  {
    heading: '9. Contact',
    body: 'Kevin Pi\nEmail: privacy@festie.app\nApp: Festie (com.kevin.festivalapp)',
  },
];

export default function PrivacyPolicyScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Privacy Policy' }} />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
        <Text style={styles.lastUpdated}>Last updated: April 5, 2026</Text>
        <Text style={styles.intro}>
          Festie is operated by Kevin Pi. This Privacy Policy explains how we collect, use, store, and protect
          information when you use the Festie app.
        </Text>

        {SECTIONS.map((section) => (
          <View key={section.heading} style={styles.section}>
            <Text style={styles.heading}>{section.heading}</Text>
            <Text style={styles.body}>{section.body}</Text>
          </View>
        ))}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    padding: 24,
    paddingBottom: 48,
    gap: 20,
  },
  lastUpdated: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  intro: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 22,
  },
  section: {
    gap: 8,
  },
  heading: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  body: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 22,
  },
});
