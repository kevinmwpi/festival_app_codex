import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useAppStore } from '@/src/state/app-store';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const TAB_CONFIG: Record<string, { icon: IoniconName; iconFocused: IoniconName; label: string }> = {
  festivals: { icon: 'flag-outline',          iconFocused: 'flag',           label: 'Fests'    },
  lineup:    { icon: 'musical-notes-outline', iconFocused: 'musical-notes',  label: 'Lineup'   },
  schedule:  { icon: 'calendar-outline',      iconFocused: 'calendar',       label: 'Schedule' },
  group:     { icon: 'people-outline',        iconFocused: 'people',         label: 'Group'    },
  map:       { icon: 'map-outline',           iconFocused: 'map',            label: 'Map'      },
};

function TabIcon({ name, focused }: { name: string; focused: boolean }) {
  const cfg = TAB_CONFIG[name];
  if (!cfg) return null;
  return (
    <View style={[styles.iconContainer, focused && styles.iconContainerFocused]}>
      <Ionicons
        name={focused ? cfg.iconFocused : cfg.icon}
        size={26}
        color={focused ? '#FFFFFF' : 'rgba(0,0,0,0.45)'}
      />
      <Text style={[styles.iconLabel, focused && styles.iconLabelFocused]}>{cfg.label}</Text>
    </View>
  );
}

export default function TabLayout() {
  // Tab bar background = selected festival accent colour, exactly as in the reference
  const accent = useAppStore((s) => s.activeFestivalAccent);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        tabBarStyle: {
          backgroundColor: accent,
          borderTopWidth: 0,
          borderRadius: 32,
          height: 80,
          marginHorizontal: 20,
          marginBottom: 24,
          position: 'absolute',
          shadowColor: '#000000',
          shadowOpacity: 0.25,
          shadowRadius: 24,
          shadowOffset: { width: 0, height: 8 },
          elevation: 12,
          // subtle white border as in reference: border border-white/20
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.2)',
        },
      }}
    >
      <Tabs.Screen name="festivals" options={{ title: 'Fests',    tabBarIcon: ({ focused }) => <TabIcon name="festivals" focused={focused} /> }} />
      <Tabs.Screen name="lineup"    options={{ title: 'Lineup',   tabBarIcon: ({ focused }) => <TabIcon name="lineup"    focused={focused} /> }} />
      <Tabs.Screen name="schedule"  options={{ title: 'Schedule', tabBarIcon: ({ focused }) => <TabIcon name="schedule"  focused={focused} /> }} />
      <Tabs.Screen name="group"     options={{ title: 'Group',    tabBarIcon: ({ focused }) => <TabIcon name="group"     focused={focused} /> }} />
      <Tabs.Screen name="map"       options={{ title: 'Map',      tabBarIcon: ({ focused }) => <TabIcon name="map"       focused={focused} /> }} />
      <Tabs.Screen name="index" options={{ href: null }} />
      <Tabs.Screen name="chat"  options={{ href: null }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  iconContainer: {
    alignItems: 'center',
    gap: 4,
    opacity: 0.45,
  },
  iconContainerFocused: {
    opacity: 1,
    transform: [{ scale: 1.1 }],
  },
  iconLabel: {
    color: 'rgba(0,0,0,0.6)',
    fontSize: 9,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  iconLabelFocused: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
});
