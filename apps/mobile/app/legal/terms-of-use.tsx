import { colors } from '@festival/ui';
import { Stack } from 'expo-router';
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

type Section = { heading: string; body: string };

const SECTIONS: Section[] = [
  {
    heading: '1. Acceptance of Terms',
    body:
      'By downloading, installing, or using Festie, you confirm that you are at least 13 years of age and agree to be bound by these Terms and our Privacy Policy. If you do not agree, do not use the App.',
  },
  {
    heading: '2. Description of the App',
    body:
      'Festie is a personal festival planning tool for building your schedule, coordinating with friends, and sharing your location with your group. The App is intended for personal, non-commercial use only.',
  },
  {
    heading: '3. Accounts & Authentication',
    body:
      'You must provide a valid email address to create an account. You are responsible for maintaining the security of your account and must not share your login credentials. Notify us immediately if you suspect unauthorized access.',
  },
  {
    heading: '4. Acceptable Use',
    body:
      'You agree not to:\n\n' +
      '• Harass, bully, threaten, or harm other users\n' +
      '• Impersonate any person or misrepresent your identity\n' +
      '• Upload illegal, obscene, or infringing content\n' +
      '• Upload photos that contain nudity, violence, or others\' personal information without consent\n' +
      '• Scrape, crawl, or use automated tools to access the App\n' +
      '• Reverse engineer or attempt to extract source code\n' +
      '• Interfere with or overload the App\'s servers\n' +
      '• Use the App for any commercial purpose\n' +
      '• Attempt to bypass any rate limiting or access controls\n' +
      '• Violate any applicable law or regulation',
  },
  {
    heading: '5. User-Generated Content',
    body:
      'You retain ownership of content you upload (e.g., totem photos). By uploading, you grant us a limited license to store and display it within the App. All content must comply with applicable law and not infringe third-party rights. We reserve the right to remove any content that violates these Terms.',
  },
  {
    heading: '6. Location Sharing',
    body:
      'Location sharing is opt-in and can be stopped at any time. When active, your GPS coordinates are shared in real time with your group members and automatically deleted after 5 minutes. You are solely responsible for your decision to share your location.',
  },
  {
    heading: '7. Festival & Artist Data',
    body:
      'Schedule information is provided for convenience only. We do not guarantee its accuracy. Festie is not affiliated with, endorsed by, or in partnership with any festival, artist, or venue.',
  },
  {
    heading: '8. Disclaimer of Warranties',
    body:
      'THE APP IS PROVIDED "AS IS" WITHOUT WARRANTIES OF ANY KIND. WE DO NOT WARRANT THAT THE APP WILL BE UNINTERRUPTED OR ERROR-FREE.',
  },
  {
    heading: '9. Limitation of Liability',
    body:
      'TO THE MAXIMUM EXTENT PERMITTED BY LAW, KEVIN PI SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, OR CONSEQUENTIAL DAMAGES. OUR TOTAL LIABILITY SHALL NOT EXCEED $50 USD.',
  },
  {
    heading: '10. Governing Law',
    body:
      'These Terms are governed by the laws of the State of California, United States. Disputes shall be resolved in the courts of California.',
  },
  {
    heading: '11. Changes to These Terms',
    body:
      'We may update these Terms from time to time. Continued use of the App after changes constitutes acceptance of the updated Terms.',
  },
  {
    heading: '12. Contact',
    body: 'Kevin Pi\nEmail: legal@festie.app\nApp: Festie (com.kevin.festivalapp)',
  },
];

export default function TermsOfUseScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Terms of Use' }} />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
        <Text style={styles.lastUpdated}>Last updated: April 5, 2026</Text>
        <Text style={styles.intro}>
          Please read these Terms of Use carefully before using Festie. By creating an account or using the App,
          you agree to be bound by these Terms.
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
