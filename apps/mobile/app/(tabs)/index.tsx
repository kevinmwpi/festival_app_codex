import { Redirect } from 'expo-router';

/** `/(tabs)` itself has no screen: land on the festival list, the first tab. */
export default function TabsIndex() {
  return <Redirect href="/(tabs)/festivals" />;
}
