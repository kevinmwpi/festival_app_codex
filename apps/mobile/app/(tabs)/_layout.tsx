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
        tabBarActiveTintColor: '#20352f',
        tabBarInactiveTintColor: '#735d4f',
        tabBarStyle: {
          backgroundColor: '#fffaf6',
          borderTopColor: '#eaded0',
          height: 74,
          paddingBottom: 10,
          paddingTop: 10,
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
  icon: {
    alignItems: 'center',
    backgroundColor: '#efe4d8',
    borderRadius: 999,
    justifyContent: 'center',
    minWidth: 44,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  iconFocused: {
    backgroundColor: '#20352f',
  },
  iconText: {
    color: '#6a5a4d',
    fontSize: 11,
    fontWeight: '700',
  },
  iconTextFocused: {
    color: '#f4efe8',
  },
  disabledTab: {
    alignItems: 'center',
    opacity: 0.55,
  },
  disabledLabel: {
    color: '#735d4f',
    fontSize: 12,
    marginTop: 4,
  },
});
