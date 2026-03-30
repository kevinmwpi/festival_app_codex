import {
  getGroupLocations,
  getLocalFestivalBundle,
  getLocalMeetups,
  shareLocation,
  stopSharingLocation,
  type FriendLocation,
} from '@festival/data-access';
import { getMeetupMapPoint, getNextStageSet, normaliseMapPoint } from '@festival/map-utils';
import { colors, radii, spacing } from '@festival/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Location from 'expo-location';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MMKV } from 'react-native-mmkv';

import { useAppStore } from '@/src/state/app-store';

const Mapbox = require('@rnmapbox/maps') as any;
const MAP_CENTER: [number, number] = [-122.4194, 37.7749];
const storage = new MMKV({ id: 'location-prefs' });

function toLngLat(point: { x: number; y: number }): [number, number] {
  return [MAP_CENTER[0] + (point.x - 0.5) * 0.02, MAP_CENTER[1] + (0.5 - point.y) * 0.02];
}

function getInitials(name: string): string {
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

export default function MapScreen() {
  const festivalId = useAppStore((s) => s.activeFestivalId);
  const selectedGroupId = useAppStore((s) => s.selectedGroupId);
  const mapDownloaded = useAppStore((s) => s.mapDownloaded);
  const setMapDownloaded = useAppStore((s) => s.setMapDownloaded);
  const queryClient = useQueryClient();

  const [locationSharing, setLocationSharing] = React.useState(
    () => storage.getBoolean('sharing-enabled') ?? false,
  );
  const locationWatchRef = React.useRef<Location.LocationSubscription | null>(null);

  const festivalQuery = useQuery({
    queryKey: ['festival-bundle', festivalId],
    queryFn: () => getLocalFestivalBundle(festivalId),
  });

  const meetupsQuery = useQuery({
    queryKey: ['map-meetups', selectedGroupId],
    queryFn: () => (selectedGroupId ? getLocalMeetups(selectedGroupId) : Promise.resolve([])),
  });

  const friendsQuery = useQuery({
    queryKey: ['friend-locations', selectedGroupId],
    queryFn: () => (selectedGroupId ? getGroupLocations(selectedGroupId) : Promise.resolve([])),
    refetchInterval: locationSharing ? 30_000 : false,
  });

  const accessToken = process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN ?? '';
  React.useEffect(() => {
    if (accessToken && Mapbox?.setAccessToken) {
      Mapbox.setAccessToken(accessToken);
    }
  }, [accessToken]);

  // Location sharing toggle
  const toggleLocationSharing = React.useCallback(async () => {
    if (locationSharing) {
      // Turn off
      locationWatchRef.current?.remove();
      locationWatchRef.current = null;
      if (selectedGroupId) {
        await stopSharingLocation(selectedGroupId).catch(() => {});
      }
      storage.set('sharing-enabled', false);
      setLocationSharing(false);
      return;
    }

    // Turn on — request permission
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return;

    storage.set('sharing-enabled', true);
    setLocationSharing(true);

    if (!selectedGroupId) return;

    // Start watching
    const sub = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.Balanced, distanceInterval: 20, timeInterval: 30_000 },
      (loc) => {
        void shareLocation(
          selectedGroupId,
          loc.coords.latitude,
          loc.coords.longitude,
          loc.coords.accuracy,
          loc.coords.heading,
        ).catch(() => {});
      },
    );
    locationWatchRef.current = sub;
  }, [locationSharing, selectedGroupId]);

  // Cleanup on unmount
  React.useEffect(() => {
    return () => {
      locationWatchRef.current?.remove();
    };
  }, []);

  const handleDownload = React.useCallback(async () => {
    if (Mapbox?.offlineManager?.createPack) {
      await Mapbox.offlineManager.createPack({
        name: `festival-${festivalId}`,
        styleURL: Mapbox.StyleURL?.Outdoors ?? Mapbox.StyleURL?.Street,
        bounds: [
          [MAP_CENTER[0] - 0.02, MAP_CENTER[1] - 0.02],
          [MAP_CENTER[0] + 0.02, MAP_CENTER[1] + 0.02],
        ],
        minZoom: 12,
        maxZoom: 16,
      });
    }
    setMapDownloaded(true);
  }, [festivalId, setMapDownloaded]);

  const festivalBundle = festivalQuery.data;

  // Mapbox not available fallback
  if (!accessToken || !Mapbox?.MapView) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Map</Text>
          <Text style={styles.subtitle}>FESTIVAL GROUNDS</Text>
        </View>
        <View style={styles.fallbackCard}>
          <Text style={styles.fallbackIcon}>📍</Text>
          <Text style={styles.fallbackTitle}>Mapbox not configured</Text>
          <Text style={styles.fallbackDesc}>
            Add EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN to enable the live map.
            {'\n\n'}Stage pins and meetup locations will appear once Mapbox is set up.
          </Text>

          {/* Show stages as list fallback */}
          {festivalBundle?.stages.map((stage) => (
            <View key={stage.id} style={styles.listRow}>
              <View style={styles.listDot} />
              <Text style={styles.listText}>{stage.name}</Text>
            </View>
          ))}
        </View>
      </View>
    );
  }

  const stages = (festivalBundle?.stages ?? [])
    .map((stage) => {
      const point = normaliseMapPoint(stage.map_x, stage.map_y);
      if (!point) return null;
      return {
        ...stage,
        coordinates: toLngLat(point),
        nextSet: getNextStageSet(stage.id, festivalBundle?.sets ?? [], new Date()),
      };
    })
    .filter(Boolean) as any[];

  const meetups = (meetupsQuery.data ?? [])
    .map((meetup) => {
      const point = getMeetupMapPoint(meetup, festivalBundle?.stages ?? []);
      if (!point) return null;
      return { ...meetup, coordinates: toLngLat(point) };
    })
    .filter(Boolean) as any[];

  const friends = (friendsQuery.data ?? []) as FriendLocation[];

  return (
    <View style={styles.container}>
      {/* Top overlay controls */}
      <View style={styles.topOverlay}>
        <View style={styles.headerOverlay}>
          <Text style={styles.titleOverlay}>Map</Text>
        </View>

        <View style={styles.controlRow}>
          {/* Location sharing toggle */}
          <Pressable
            onPress={() => void toggleLocationSharing()}
            style={({ pressed }) => [
              styles.togglePill,
              locationSharing && styles.togglePillActive,
              pressed && { opacity: 0.8 },
            ]}
          >
            <View style={[styles.toggleDot, locationSharing && styles.toggleDotActive]} />
            <Text style={[styles.toggleLabel, locationSharing && styles.toggleLabelActive]}>
              {locationSharing ? 'Sharing' : 'Share location'}
            </Text>
          </Pressable>

          {/* Download offline map */}
          {!mapDownloaded && (
            <Pressable
              onPress={() => void handleDownload()}
              style={({ pressed }) => [styles.downloadPill, pressed && { opacity: 0.8 }]}
            >
              <Text style={styles.downloadLabel}>↓ Offline Map</Text>
            </Pressable>
          )}
        </View>
      </View>

      {/* Map */}
      <Mapbox.MapView style={styles.map} styleURL={Mapbox.StyleURL?.Outdoors ?? Mapbox.StyleURL?.Street}>
        <Mapbox.Camera zoomLevel={13.5} centerCoordinate={MAP_CENTER} animationMode="flyTo" />
        <Mapbox.UserLocation visible />

        {/* Stage pins */}
        {stages.map((stage: any) => (
          <Mapbox.PointAnnotation id={`stage-${stage.id}`} key={stage.id} coordinate={stage.coordinates}>
            <View style={styles.stagePin}>
              <Text style={styles.stagePinText}>{stage.name}</Text>
              {stage.nextSet ? (
                <Text style={styles.stagePinTime}>
                  {new Date(stage.nextSet.start_time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                </Text>
              ) : null}
            </View>
          </Mapbox.PointAnnotation>
        ))}

        {/* Meetup pins */}
        {meetups.map((meetup: any) => (
          <Mapbox.PointAnnotation id={`meetup-${meetup.id}`} key={meetup.id} coordinate={meetup.coordinates}>
            <View style={styles.meetupPin}>
              <Text style={styles.meetupPinEmoji}>📍</Text>
              <Text style={styles.meetupPinText}>{meetup.title}</Text>
              <Text style={styles.meetupPinTime}>
                {new Date(meetup.starts_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
              </Text>
            </View>
          </Mapbox.PointAnnotation>
        ))}

        {/* Friend location pins */}
        {friends.map((friend) => (
          <Mapbox.PointAnnotation
            id={`friend-${friend.id}`}
            key={friend.id}
            coordinate={[friend.lng, friend.lat]}
          >
            <View style={styles.friendPin}>
              <Text style={styles.friendPinText}>
                {friend.avatar_type === 'emoji' ? friend.avatar_value : getInitials(friend.display_name)}
              </Text>
            </View>
            <Mapbox.Callout title={friend.display_name} />
          </Mapbox.PointAnnotation>
        ))}
      </Mapbox.MapView>

      {/* Bottom legend */}
      {(stages.length > 0 || meetups.length > 0 || friends.length > 0) && (
        <View style={styles.legend}>
          {stages.length > 0 && (
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: colors.primary }]} />
              <Text style={styles.legendText}>{stages.length} stages</Text>
            </View>
          )}
          {meetups.length > 0 && (
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: colors.success }]} />
              <Text style={styles.legendText}>{meetups.length} meetups</Text>
            </View>
          )}
          {friends.length > 0 && (
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: '#D1B3FF' }]} />
              <Text style={styles.legendText}>{friends.length} friends</Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  map: {
    flex: 1,
  },

  /* Top overlay */
  topOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    paddingTop: spacing.xxxl + 12,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  headerOverlay: {
    marginBottom: spacing.sm,
  },
  titleOverlay: {
    color: colors.textPrimary,
    fontSize: 28,
    fontWeight: '700',
    fontStyle: 'italic',
    textShadowColor: 'rgba(255,255,255,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  controlRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  togglePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surface,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderCard,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  togglePillActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  toggleDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.textSecondary,
  },
  toggleDotActive: {
    backgroundColor: colors.success,
  },
  toggleLabel: {
    color: colors.textPrimary,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  toggleLabelActive: {
    color: colors.textOnPrimary,
  },
  downloadPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderCard,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  downloadLabel: {
    color: colors.textPrimary,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },

  /* Map pins */
  stagePin: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderColor: '#FFFFFF',
    borderRadius: radii.md,
    borderWidth: 2,
    minWidth: 80,
    paddingHorizontal: 10,
    paddingVertical: 6,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  stagePinText: {
    color: colors.textPrimary,
    fontSize: 11,
    fontWeight: '800',
    textAlign: 'center',
  },
  stagePinTime: {
    color: colors.textPrimary,
    fontSize: 9,
    fontWeight: '600',
    opacity: 0.6,
    marginTop: 1,
  },
  meetupPin: {
    alignItems: 'center',
    backgroundColor: colors.success,
    borderColor: '#FFFFFF',
    borderRadius: radii.md,
    borderWidth: 2,
    minWidth: 80,
    paddingHorizontal: 10,
    paddingVertical: 6,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  meetupPinEmoji: {
    fontSize: 12,
  },
  meetupPinText: {
    color: colors.textPrimary,
    fontSize: 11,
    fontWeight: '800',
    textAlign: 'center',
  },
  meetupPinTime: {
    color: colors.textPrimary,
    fontSize: 9,
    fontWeight: '600',
    opacity: 0.6,
  },
  friendPin: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#D1B3FF',
    borderWidth: 3,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  friendPinText: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.textPrimary,
  },

  /* Bottom legend */
  legend: {
    position: 'absolute',
    bottom: spacing.xxxl + 60,
    left: spacing.lg,
    right: spacing.lg,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.md,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    color: colors.textPrimary,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  /* Fallback (no Mapbox) */
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.md,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 32,
    fontWeight: '700',
    fontStyle: 'italic',
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 2,
    marginTop: spacing.xs,
  },
  fallbackCard: {
    margin: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radii.xxl,
    borderWidth: 1,
    borderColor: colors.borderCard,
    padding: spacing.xl,
    gap: spacing.md,
    alignItems: 'center',
  },
  fallbackIcon: {
    fontSize: 40,
  },
  fallbackTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '700',
  },
  fallbackDesc: {
    color: colors.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    alignSelf: 'flex-start',
  },
  listDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  listText: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '600',
  },
});
