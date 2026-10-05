import { getTotemSignedUrl } from '@festival/data-access';
import { colors, IconButton, radii, spacing } from '@festival/ui';
import { useQuery } from '@tanstack/react-query';
import React from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';

import { queryKeys } from '@/src/hooks/query-keys';
import { useUserKey } from '@/src/hooks/use-session';

/**
 * A meetup's totem photo from the private bucket via a short-lived signed URL (cached ~45 min), with
 * a Report control on the photo for anyone but its owner.
 */
export function TotemPhoto({
  path,
  meetupTitle,
  onReport,
}: {
  path: string;
  meetupTitle: string;
  /** Omit for the photo's owner. */
  onReport?: () => void;
}) {
  const userKey = useUserKey();
  const urlQuery = useQuery({
    queryKey: queryKeys.totemUrl(userKey, path),
    queryFn: () => getTotemSignedUrl(path),
    staleTime: 45 * 60_000,
    gcTime: 50 * 60_000,
    retry: 1,
  });
  const [failed, setFailed] = React.useState(false);

  return (
    <View style={styles.frame}>
      {urlQuery.data && !failed ? (
        <Image
          source={{ uri: urlQuery.data }}
          style={styles.image}
          resizeMode="cover"
          accessible
          accessibilityRole="image"
          accessibilityLabel={`Totem photo for ${meetupTitle}`}
          onError={() => setFailed(true)}
        />
      ) : (
        <View style={styles.placeholder}>
          {urlQuery.isPending && !failed ? (
            <ActivityIndicator color={colors.textPrimary} />
          ) : (
            <Text style={styles.placeholderText}>Photo unavailable right now — check your connection.</Text>
          )}
        </View>
      )}
      {onReport ? (
        <View style={styles.reportButton}>
          <IconButton icon="⚑" accessibilityLabel={`Report the photo for ${meetupTitle}`} onPress={onReport} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { borderRadius: radii.xl, overflow: 'hidden', position: 'relative' },
  image: { height: 200, width: '100%' },
  placeholder: {
    alignItems: 'center',
    backgroundColor: '#F0F4FF',
    height: 120,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  placeholderText: { color: colors.textSecondary, fontSize: 13, textAlign: 'center' },
  reportButton: { position: 'absolute', right: spacing.sm, top: spacing.sm },
});
