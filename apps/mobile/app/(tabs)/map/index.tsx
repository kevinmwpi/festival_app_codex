import { getLocalFestivalBundle, getLocalMeetups } from '@festival/data-access';
import { getMeetupMapPoint, getNextStageSet, normaliseMapPoint } from '@festival/map-utils';
import { EmptyState, PrimaryButton, Screen, SectionCard } from '@festival/ui';
import { useQuery } from '@tanstack/react-query';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useAppStore } from '@/src/state/app-store';

const Mapbox = require('@rnmapbox/maps') as any;
const MAP_CENTER: [number, number] = [-122.4194, 37.7749];

function toLngLat(point: { x: number; y: number }): [number, number] {
  return [MAP_CENTER[0] + (point.x - 0.5) * 0.02, MAP_CENTER[1] + (0.5 - point.y) * 0.02];
}

export default function MapScreen() {
  const festivalId = useAppStore((state) => state.activeFestivalId);
  const selectedGroupId = useAppStore((state) => state.selectedGroupId);
  const mapDownloaded = useAppStore((state) => state.mapDownloaded);
  const setMapDownloaded = useAppStore((state) => state.setMapDownloaded);
  const festivalQuery = useQuery({
    queryKey: ['festival-bundle', festivalId],
    queryFn: () => getLocalFestivalBundle(festivalId),
  });
  const meetupsQuery = useQuery({
    queryKey: ['map-meetups', selectedGroupId],
    queryFn: () => (selectedGroupId ? getLocalMeetups(selectedGroupId) : Promise.resolve([])),
  });

  const accessToken = process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN ?? '';
  React.useEffect(() => {
    if (accessToken && Mapbox?.setAccessToken) {
      Mapbox.setAccessToken(accessToken);
    }
  }, [accessToken]);

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

  if (!festivalQuery.data) {
    return (
      <Screen>
        <SectionCard title="Loading map data" subtitle="Reading the cached festival bundle and meetup pins." />
      </Screen>
    );
  }

  const festivalBundle = festivalQuery.data;

  if (!accessToken || !Mapbox?.MapView) {
    return (
      <Screen>
        <EmptyState
          title="Mapbox not configured"
          description="Add EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN to enable the live map. The cached festival stages and meetup list are already ready underneath."
        />
      </Screen>
    );
  }

  const stages = festivalBundle.stages
    .map((stage) => {
      const point = normaliseMapPoint(stage.map_x, stage.map_y);
      if (!point) {
        return null;
      }
      return {
        ...stage,
        coordinates: toLngLat(point),
        nextSet: getNextStageSet(stage.id, festivalBundle.sets, new Date()),
      };
    })
    .filter(Boolean);

  const meetups = (meetupsQuery.data ?? [])
    .map((meetup) => {
      const point = getMeetupMapPoint(meetup, festivalBundle.stages);
      if (!point) {
        return null;
      }
      return {
        ...meetup,
        coordinates: toLngLat(point),
      };
    })
    .filter(Boolean);

  return (
    <Screen style={{ padding: 0 }}>
      {!mapDownloaded ? (
        <View style={styles.prompt}>
          <Text style={styles.promptTitle}>Download map for offline use</Text>
          <Text style={styles.promptText}>Wi-Fi is recommended for the first tile pack download.</Text>
          <PrimaryButton label="Download map for offline" onPress={() => void handleDownload()} />
        </View>
      ) : null}

      <Mapbox.MapView style={styles.map} styleURL={Mapbox.StyleURL?.Outdoors ?? Mapbox.StyleURL?.Street}>
        <Mapbox.Camera zoomLevel={13.5} centerCoordinate={MAP_CENTER} animationMode="flyTo" />
        <Mapbox.UserLocation visible />
        {stages.map((stage: any) => (
          <Mapbox.PointAnnotation id={stage.id} key={stage.id} coordinate={stage.coordinates}>
            <View style={styles.stagePin}>
              <Text style={styles.pinText}>{stage.name}</Text>
              {stage.nextSet ? <Text style={styles.pinSubtext}>{new Date(stage.nextSet.start_time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</Text> : null}
            </View>
          </Mapbox.PointAnnotation>
        ))}
        {meetups.map((meetup: any) => (
          <Mapbox.PointAnnotation id={meetup.id} key={meetup.id} coordinate={meetup.coordinates}>
            <View style={styles.meetupPin}>
              <Text style={styles.pinText}>{meetup.title}</Text>
              <Text style={styles.pinSubtext}>{new Date(meetup.starts_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</Text>
            </View>
          </Mapbox.PointAnnotation>
        ))}
      </Mapbox.MapView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  map: {
    flex: 1,
  },
  meetupPin: {
    alignItems: 'center',
    backgroundColor: '#1e3a8a',
    borderColor: '#ffffff',
    borderRadius: 14,
    borderWidth: 2,
    minWidth: 88,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  pinSubtext: {
    color: '#e2e8f0',
    fontSize: 11,
  },
  pinText: {
    color: '#f8fafc',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  prompt: {
    backgroundColor: '#ffffff',
    gap: 8,
    padding: 16,
  },
  promptText: {
    color: '#64748b',
  },
  promptTitle: {
    color: '#111827',
    fontSize: 17,
    fontWeight: '700',
  },
  stagePin: {
    alignItems: 'center',
    backgroundColor: '#b2cefe',
    borderColor: '#ffffff',
    borderRadius: 14,
    borderWidth: 2,
    minWidth: 88,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
});
