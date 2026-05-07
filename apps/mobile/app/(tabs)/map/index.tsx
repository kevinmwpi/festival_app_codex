import {
  getGroupLocations,
  getLocalFestivalBundle,
  getLocalMeetups,
  shareLocation,
  stopSharingLocation,
  type FriendLocation,
} from '@festival/data-access';
import { getMeetupMapPoint, getNextStageSet, normaliseMapPoint } from '@festival/map-utils';
import { colors, deriveAccentColors, radii, spacing } from '@festival/ui';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import * as Location from 'expo-location';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { createMMKV } from 'react-native-mmkv';

import { useAppStore } from '@/src/state/app-store';

const Mapbox = require('@rnmapbox/maps') as any;
const MAP_CENTER: [number, number] = [-122.4194, 37.7749];
const storage = createMMKV({ id: 'location-prefs' });

function toLngLat(point: { x: number; y: number }): [number, number] {
  return [MAP_CENTER[0] + (point.x - 0.5) * 0.02, MAP_CENTER[1] + (0.5 - point.y) * 0.02];
}

function getInitials(name: string): string {
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

export default function MapScreen() {
  const festivalId = useAppStore((s) => s.activeFestivalId);
  const selectedGroupId = useAppStore((s) => s.selectedGroupId);
  const activeFestivalAccent = useAppStore((s) => s.activeFestivalAccent);
  const mapDownloaded = useAppStore((s) => s.mapDownloaded);
  const setMapDownloaded = useAppStore((s) => s.setMapDownloaded);

  const screenBg = deriveAccentColors(activeFestivalAccent).bgTint;

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
    if (accessToken && Mapbox?.setAccessToken) Mapbox.setAccessToken(accessToken);
  }, [accessToken]);

  const toggleLocationSharing = React.useCallback(async () => {
    if (locationSharing) {
      locationWatchRef.current?.remove();
      locationWatchRef.current = null;
      if (selectedGroupId) await stopSharingLocation(selectedGroupId).catch(() => {});
      storage.set('sharing-enabled', false);
      setLocationSharing(false);
      return;
    }
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return;
    storage.set('sharing-enabled', true);
    setLocationSharing(true);
    if (!selectedGroupId) return;
    const sub = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.Balanced, distanceInterval: 20, timeInterval: 30_000 },
      (loc) => {
        void shareLocation(selectedGroupId, loc.coords.latitude, loc.coords.longitude, loc.coords.accuracy, loc.coords.heading).catch(() => {});
      },
    );
    locationWatchRef.current = sub;
  }, [locationSharing, selectedGroupId]);

  React.useEffect(() => { return () => { locationWatchRef.current?.remove(); }; }, []);

  const handleDownload = React.useCallback(async () => {
    if (Mapbox?.offlineManager?.createPack) {
      await Mapbox.offlineManager.createPack({
        name: `festival-${festivalId}`,
        styleURL: Mapbox.StyleURL?.Outdoors ?? Mapbox.StyleURL?.Street,
        bounds: [[MAP_CENTER[0] - 0.02, MAP_CENTER[1] - 0.02], [MAP_CENTER[0] + 0.02, MAP_CENTER[1] + 0.02]],
        minZoom: 12, maxZoom: 16,
      });
    }
    setMapDownloaded(true);
  }, [festivalId, setMapDownloaded]);

  const festivalBundle = festivalQuery.data;

  /* ─── No Mapbox fallback — reference: bg-[#E8F0FE] map placeholder ─── */
  if (!accessToken || !Mapbox?.MapView) {
    return (
      <View style={[styles.container, { backgroundColor: screenBg }]}>
        <View style={styles.header}>
          <Text style={styles.wordmark}>Festie</Text>
          <Text style={[styles.breadcrumb, { color: activeFestivalAccent }]}>Map</Text>
        </View>

        {/* Reference-style decorative map placeholder */}
        <View style={styles.mapPlaceholder}>
          {/* Dot grid overlay */}
          <View style={[styles.dotGrid, { backgroundColor: colors.primary, opacity: 0.08 }]} />
          {/* Blur blobs */}
          <View style={[styles.blob1, { backgroundColor: activeFestivalAccent }]} />
          <View style={[styles.blob2, { backgroundColor: colors.warning }]} />

          {/* Centered badge */}
          <View style={styles.mapBadge}>
            <Text style={[styles.mapBadgeLabel, { color: colors.primary }]}>Mapbox not configured</Text>
            <Text style={styles.mapBadgeSub}>Add EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN</Text>
          </View>

          {/* Stage list as map markers */}
          {(festivalBundle?.stages ?? []).map((stage) => (
            <View key={stage.id} style={[styles.listMarker, { borderColor: activeFestivalAccent }]}>
              <Ionicons name="flag" size={12} color={activeFestivalAccent} />
              <Text style={styles.listMarkerText}>{stage.name}</Text>
            </View>
          ))}
        </View>

        {/* Meetup point list — matches reference bottom card style */}
        {(festivalBundle?.stages ?? []).slice(0, 3).map((stage) => (
          <View key={stage.id} style={styles.listRow}>
            <View style={[styles.listIcon, { backgroundColor: '#F0F4FF' }]}>
              <Ionicons name="flag-outline" size={18} color={colors.primary} />
            </View>
            <Text style={styles.listText}>{stage.name}</Text>
            <View style={styles.listChevron}>
              <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
            </View>
          </View>
        ))}
      </View>
    );
  }

  const stages = (festivalBundle?.stages ?? []).map((stage) => {
    const point = normaliseMapPoint(stage.map_x, stage.map_y);
    if (!point) return null;
    return { ...stage, coordinates: toLngLat(point), nextSet: getNextStageSet(stage.id, festivalBundle?.sets ?? [], new Date()) };
  }).filter(Boolean) as any[];

  const meetups = (meetupsQuery.data ?? []).map((meetup) => {
    const point = getMeetupMapPoint(meetup, festivalBundle?.stages ?? []);
    if (!point) return null;
    return { ...meetup, coordinates: toLngLat(point) };
  }).filter(Boolean) as any[];

  const friends = (friendsQuery.data ?? []) as FriendLocation[];

  return (
    <View style={styles.container}>
      <Mapbox.MapView style={styles.map} styleURL={Mapbox.StyleURL?.Outdoors ?? Mapbox.StyleURL?.Street}>
        <Mapbox.Camera zoomLevel={13.5} centerCoordinate={MAP_CENTER} animationMode="flyTo" />
        <Mapbox.UserLocation visible />

        {stages.map((stage: any) => (
          <Mapbox.PointAnnotation id={`stage-${stage.id}`} key={stage.id} coordinate={stage.coordinates}>
            {/* Reference: bg-white p-2 rounded-xl shadow-lg border-2 border-[#B2CEFE] */}
            <View style={[styles.stagePin, { borderColor: activeFestivalAccent }]}>
              <Ionicons name="flag" size={14} color={activeFestivalAccent} />
              <Text style={[styles.stagePinText, { color: colors.textPrimary }]}>{stage.name}</Text>
              {stage.nextSet && (
                <Text style={styles.stagePinTime}>
                  {new Date(stage.nextSet.start_time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                </Text>
              )}
            </View>
          </Mapbox.PointAnnotation>
        ))}

        {meetups.map((meetup: any) => (
          <Mapbox.PointAnnotation id={`meetup-${meetup.id}`} key={meetup.id} coordinate={meetup.coordinates}>
            <View style={styles.meetupPin}>
              <Ionicons name="location" size={14} color="#FFFFFF" />
              <Text style={styles.meetupPinText}>{meetup.title}</Text>
            </View>
          </Mapbox.PointAnnotation>
        ))}

        {friends.map((friend) => (
          <Mapbox.PointAnnotation id={`friend-${friend.id}`} key={friend.id} coordinate={[friend.lng, friend.lat]}>
            <View style={[styles.friendPin, { backgroundColor: activeFestivalAccent }]}>
              <Text style={styles.friendPinText}>
                {friend.avatar_type === 'emoji' ? friend.avatar_value : getInitials(friend.display_name)}
              </Text>
            </View>
            <Mapbox.Callout title={friend.display_name} />
          </Mapbox.PointAnnotation>
        ))}
      </Mapbox.MapView>

      {/* Top overlay */}
      <View style={styles.topOverlay}>
        <View style={styles.controlRow}>
          <Pressable
            onPress={() => void toggleLocationSharing()}
            style={({ pressed }) => [styles.pill, locationSharing && styles.pillActive, pressed && { opacity: 0.85 }]}
          >
            <View style={[styles.pillDot, locationSharing && styles.pillDotActive]} />
            <Text style={[styles.pillLabel, locationSharing && styles.pillLabelActive]}>
              {locationSharing ? 'Sharing' : 'Share location'}
            </Text>
          </Pressable>
          {!mapDownloaded && (
            <Pressable onPress={() => void handleDownload()} style={({ pressed }) => [styles.pill, pressed && { opacity: 0.85 }]}>
              <Ionicons name="cloud-download-outline" size={13} color={colors.textPrimary} />
              <Text style={styles.pillLabel}>Offline</Text>
            </Pressable>
          )}
        </View>
      </View>

      {/* Bottom legend */}
      {(stages.length > 0 || meetups.length > 0 || friends.length > 0) && (
        <View style={styles.legend}>
          {stages.length > 0 && <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: activeFestivalAccent }]} /><Text style={styles.legendText}>{stages.length} stages</Text></View>}
          {meetups.length > 0 && <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: colors.success }]} /><Text style={styles.legendText}>{meetups.length} meetups</Text></View>}
          {friends.length > 0 && <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: activeFestivalAccent }]} /><Text style={styles.legendText}>{friends.length} friends</Text></View>}
        </View>
      )}
    </View>
  );
}

/* ─── Styles ─────────────────────────────────────────────── */

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },

  /* Fallback */
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.xl + 4, paddingBottom: spacing.sm, gap: 4 },
  wordmark: { fontFamily: 'Georgia', fontStyle: 'italic', fontSize: 40, fontWeight: '700', color: colors.textPrimary, letterSpacing: -0.5 },
  breadcrumb: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1 },

  /* Decorative map placeholder — reference: bg-[#E8F0FE] rounded-[40px] aspect-square */
  mapPlaceholder: {
    marginHorizontal: spacing.lg,
    borderRadius: radii.card,
    aspectRatio: 1,
    backgroundColor: '#E8F0FE',
    overflow: 'hidden',
    borderWidth: 4,
    borderColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  dotGrid: { position: 'absolute', inset: 0 as any },
  blob1: { position: 'absolute', top: 40, left: 40, width: 128, height: 128, borderRadius: 64, opacity: 0.4 },
  blob2: { position: 'absolute', bottom: 80, right: 40, width: 160, height: 160, borderRadius: 80, opacity: 0.4 },
  mapBadge: {
    backgroundColor: 'rgba(255,255,255,0.85)',
    borderRadius: 16,
    paddingHorizontal: 24,
    paddingVertical: 12,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  mapBadgeLabel: { fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 2 },
  mapBadgeSub: { fontSize: 8, opacity: 0.4, fontWeight: '700', marginTop: 2 },
  listMarker: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 2,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  listMarkerText: { fontSize: 10, fontWeight: '800', color: colors.textPrimary },

  /* Reference list rows */
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    marginHorizontal: spacing.lg,
    borderRadius: 32,
    padding: spacing.md,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.05)',
    marginTop: spacing.sm,
  },
  listIcon: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  listText: { flex: 1, color: colors.textPrimary, fontSize: 14, fontWeight: '600' },
  listChevron: { width: 40, height: 40, borderRadius: 14, backgroundColor: '#F0F4FF', alignItems: 'center', justifyContent: 'center' },

  /* Live map overlay */
  topOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
    paddingTop: spacing.xxxl + 8, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm,
  },
  controlRow: { flexDirection: 'row', gap: spacing.sm },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(255,255,255,0.9)', borderRadius: radii.pill,
    paddingHorizontal: spacing.md, paddingVertical: 8,
    shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 4,
  },
  pillActive: { backgroundColor: colors.primary },
  pillDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: 'rgba(0,0,0,0.2)' },
  pillDotActive: { backgroundColor: colors.success },
  pillLabel: { color: colors.textPrimary, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8 },
  pillLabelActive: { color: colors.textPrimary },

  /* Map pins */
  stagePin: {
    alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 12, borderWidth: 2,
    minWidth: 80, paddingHorizontal: 10, paddingVertical: 6,
    shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 4, gap: 2,
  },
  stagePinText: { fontSize: 10, fontWeight: '800', textAlign: 'center' },
  stagePinTime: { color: colors.textSecondary, fontSize: 9, fontWeight: '600' },
  meetupPin: {
    alignItems: 'center', backgroundColor: colors.success, borderColor: '#FFFFFF', borderRadius: 12, borderWidth: 2,
    minWidth: 80, paddingHorizontal: 10, paddingVertical: 6,
    shadowColor: colors.success, shadowOpacity: 0.25, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 4, gap: 1,
  },
  meetupPinText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800', textAlign: 'center' },
  friendPin: {
    width: 40, height: 40, borderRadius: 20, borderWidth: 3, borderColor: '#FFFFFF',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 5,
  },
  friendPinText: { fontSize: 14, fontWeight: '800', color: colors.textPrimary },

  /* Legend */
  legend: {
    position: 'absolute', bottom: spacing.xxxl + 68, left: spacing.lg, right: spacing.lg,
    flexDirection: 'row', justifyContent: 'center', gap: spacing.md,
    backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: radii.pill,
    paddingHorizontal: spacing.lg, paddingVertical: 9,
    shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 4,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { color: colors.textPrimary, fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
});
