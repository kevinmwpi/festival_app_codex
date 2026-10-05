/**
 * Opening the legal documents and support channels. Hosted URLs (when configured at build time) open
 * in an in-app browser; otherwise the in-app legal screens are used. Failures surface as a toast with
 * the address, so the user can still reach support by hand.
 */
import { showToast } from '@festival/ui';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';

import { PRIVACY_POLICY_URL, SUPPORT_EMAIL, SUPPORT_URL, TERMS_URL } from '@/src/config/app-info';

async function openInAppBrowser(url: string): Promise<void> {
  try {
    await WebBrowser.openBrowserAsync(url, {
      presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
      dismissButtonStyle: 'close',
    });
  } catch {
    try {
      await Linking.openURL(url);
    } catch {
      showToast(`Couldn't open ${url}`, 'error');
    }
  }
}

export function openPrivacyPolicy(): void {
  if (PRIVACY_POLICY_URL) {
    void openInAppBrowser(PRIVACY_POLICY_URL);
  } else {
    router.push('/legal/privacy-policy');
  }
}

export function openTermsOfUse(): void {
  if (TERMS_URL) {
    void openInAppBrowser(TERMS_URL);
  } else {
    router.push('/legal/terms-of-use');
  }
}

/** `true` when a support page is configured (the row is hidden otherwise). */
export const hasSupportUrl = SUPPORT_URL !== null;
/** `true` when a support mailbox is configured (the row is hidden otherwise). */
export const hasSupportEmail = SUPPORT_EMAIL !== null;

export function openSupportUrl(): void {
  if (SUPPORT_URL) {
    void openInAppBrowser(SUPPORT_URL);
  }
}

/** Opens the mail app addressed to support, with the app version in the subject. */
export function openSupportEmail(subject = 'Festie support'): void {
  if (!SUPPORT_EMAIL) {
    return;
  }
  const url = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`;
  Linking.openURL(url).catch(() => {
    showToast(`No mail app found. Email us at ${SUPPORT_EMAIL}`, 'error');
  });
}
