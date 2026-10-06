import { colors, radii, SecondaryButton, showToast, spacing } from '@festival/ui';
import React from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';

import { formatAgo, useNow } from '@/src/hooks/use-now';
import { STOP_NOT_CONFIRMED_MESSAGE, useLocationSharing } from '@/src/location/LocationSharingProvider';

import { LocationSharingSheet } from './LocationSharingSheet';

function formatRemaining(expiresAt: number, now: number): string {
  const minutes = Math.max(0, Math.round((expiresAt - now) / 60_000));
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/**
 * Truthful sharing status for one crew with Start/Stop. `otherGroupName` resolves the crew currently
 * shared with when it is a different one.
 */
export function LocationSharingCard({
  groupId,
  groupName,
  resolveGroupName,
}: {
  groupId: string;
  groupName: string;
  resolveGroupName: (groupId: string) => string | null;
}) {
  const sharing = useLocationSharing();
  const now = useNow(30_000);
  const [sheetVisible, setSheetVisible] = React.useState(false);
  const [stopping, setStopping] = React.useState(false);

  const isThisGroup = sharing.groupId === groupId && sharing.status !== 'off';
  const otherGroupName = sharing.groupId && sharing.groupId !== groupId ? (resolveGroupName(sharing.groupId) ?? 'another crew') : null;

  let title = 'Location sharing is off';
  let detail = 'Let this crew see where you are on the map while Festie is open.';
  if (isThisGroup) {
    if (sharing.status === 'permission_denied') {
      title = 'Location access is off';
      detail = sharing.canAskAgain
        ? "Festie can't read your location, so your crew can't see you. Allow location access to keep sharing."
        : "Festie can't read your location, so your crew can't see you. Turn on location access in Settings.";
    } else {
      title = sharing.status === 'paused' ? 'Sharing paused' : 'Sharing your location';
      const ends = sharing.expiresAt ? `Ends in ${formatRemaining(sharing.expiresAt, now)}` : '';
      const sent = sharing.lastSentAt
        ? `last update ${formatAgo(sharing.lastSentAt, now)}`
        : sharing.lastErrorAt
          ? 'waiting for signal'
          : 'getting your position';
      detail = `${ends}${ends ? ' · ' : ''}${sent}.`;
    }
  } else if (otherGroupName) {
    detail = `You're sharing with ${otherGroupName}. Starting here stops that.`;
  }

  const stop = React.useCallback(async () => {
    setStopping(true);
    try {
      if (!(await sharing.stop())) {
        showToast(STOP_NOT_CONFIRMED_MESSAGE, 'error');
      }
    } finally {
      setStopping(false);
    }
  }, [sharing]);

  const [requesting, setRequesting] = React.useState(false);
  const allowLocation = React.useCallback(async () => {
    setRequesting(true);
    try {
      await sharing.requestAccess();
    } finally {
      setRequesting(false);
    }
  }, [sharing]);

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <View style={[styles.dot, isThisGroup && sharing.status === 'sharing' ? styles.dotOn : isThisGroup ? styles.dotWarn : null]} />
        <View style={styles.text}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.detail} accessibilityLiveRegion="polite">
            {detail}
          </Text>
        </View>
      </View>
      {isThisGroup ? (
        <View style={styles.actions}>
          {sharing.status === 'permission_denied' ? (
            sharing.canAskAgain ? (
              <SecondaryButton label="Allow location" onPress={() => void allowLocation()} loading={requesting} />
            ) : (
              <SecondaryButton label="Open Settings" onPress={() => void Linking.openSettings()} />
            )
          ) : null}
          <SecondaryButton label="Stop sharing" onPress={() => void stop()} loading={stopping} />
        </View>
      ) : (
        <SecondaryButton label="Share my location" onPress={() => setSheetVisible(true)} />
      )}
      <LocationSharingSheet
        visible={sheetVisible}
        groupId={groupId}
        groupName={groupName}
        otherGroupName={otherGroupName}
        onClose={() => setSheetVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.borderCard,
    borderRadius: radii.card,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.xl,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  row: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.md },
  dot: { backgroundColor: 'rgba(44, 51, 39, 0.2)', borderRadius: 6, height: 12, marginTop: 5, width: 12 },
  dotOn: { backgroundColor: '#3E9B57' },
  dotWarn: { backgroundColor: '#D99A00' },
  text: { flex: 1, gap: 4 },
  title: { color: colors.textPrimary, fontSize: 16, fontWeight: '700' },
  detail: { color: colors.textSecondary, fontSize: 13, lineHeight: 18 },
  actions: { gap: spacing.sm },
});
