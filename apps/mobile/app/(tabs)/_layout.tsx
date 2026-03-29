import { colors } from '@festival/ui';
import { Tabs } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

function TabIcon({ label, icon, focused }: { label: string; icon: string; focused: boolean }) {
  return (
    <View style={[styles.iconContainer, focused && styles.iconContainerFocused]}>
      <Text style={styles.iconEmoji}>{icon}</Text>
      <Text style={[styles.iconLabel, focused && styles.iconLabelFocused]}>{label}</Text>
    </View>
  );
}

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.textOnPrimary,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarShowLabel: false,
        tabBarStyle: {
          backgroundColor: colors.primary,
          borderTopWidth: 0,
          borderRadius: 32,
          height: 72,
          marginHorizontal: 20,
          marginBottom: 24,
          paddingTop: 8,
          paddingBottom: 8,
          position: 'absolute',
          shadowColor: colors.primary,
          shadowOpacity: 0.3,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 8 },
          elevation: 8,
        },
      }}
    >
      <Tabs.Screen
        name="schedule"
        options={{
          title: 'Schedule',
          tabBarIcon: ({ focused }) => <TabIcon label="Schedule" icon="📅" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="group"
        options={{
          title: 'Group',
          tabBarIcon: ({ focused }) => <TabIcon label="Group" icon="👥" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="map"
        options={{
          title: 'Map',
          tabBarIcon: ({ focused }) => <TabIcon label="Map" icon="📍" focused={focused} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  iconContainer: {
    alignItems: 'center',
    gap: 2,
    opacity: 0.5,
  },
  iconContainerFocused: {
    opacity: 1,
    transform: [{ scale: 1.1 }],
  },
  iconEmoji: {
    fontSize: 22,
  },
  iconLabel: {
    color: 'rgba(0,0,0,0.4)',
    fontSize: 9,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  iconLabelFocused: {
    color: colors.textOnPrimary,
  },
});
