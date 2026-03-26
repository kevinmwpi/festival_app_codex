import { Tabs } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

function FestivalTabIcon({ label, focused }: { label: string; focused: boolean }) {
  return (
    <View style={[styles.icon, focused ? styles.iconFocused : null]}>
      <Text style={[styles.iconText, focused ? styles.iconTextFocused : null]}>{label}</Text>
    </View>
  );
}

function DisabledTabButton(props: any) {
  return (
    <Pressable {...props} disabled style={styles.disabledTab}>
      <View style={styles.icon}>
        <Text style={styles.iconText}>Soon</Text>
      </View>
      <Text style={styles.disabledLabel}>Chat</Text>
    </Pressable>
  );
}

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#0f172a',
        tabBarInactiveTintColor: '#64748b',
        tabBarStyle: {
          backgroundColor: '#ffffff',
          borderTopColor: '#dbe7ff',
          borderTopWidth: 1,
          height: 82,
          paddingBottom: 10,
          paddingTop: 12,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '700',
          marginTop: 2,
          textTransform: 'uppercase',
        },
      }}
    >
      <Tabs.Screen
        name="schedule"
        options={{
          title: 'Schedule',
          tabBarIcon: ({ focused }) => <FestivalTabIcon label="Set" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="group"
        options={{
          title: 'Group',
          tabBarIcon: ({ focused }) => <FestivalTabIcon label="Crew" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="map"
        options={{
          title: 'Map',
          tabBarIcon: ({ focused }) => <FestivalTabIcon label="Map" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: 'Chat',
          tabBarButton: (props) => <DisabledTabButton {...props} />,
          tabBarIcon: ({ focused }) => <FestivalTabIcon label="Chat" focused={focused} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  disabledLabel: {
    color: '#64748b',
    fontSize: 12,
    marginTop: 4,
  },
  disabledTab: {
    alignItems: 'center',
    opacity: 0.55,
  },
  icon: {
    alignItems: 'center',
    backgroundColor: '#edf3ff',
    borderRadius: 999,
    justifyContent: 'center',
    minWidth: 48,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  iconFocused: {
    backgroundColor: '#b2cefe',
    transform: [{ scale: 1.05 }],
  },
  iconText: {
    color: '#1e3a8a',
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  iconTextFocused: {
    color: '#0f172a',
  },
});
