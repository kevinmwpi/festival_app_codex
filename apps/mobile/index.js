import { registerRootComponent } from 'expo';
import { ExpoRoot } from 'expo-router';

// Exporting the component keeps Fast Refresh working with Expo Router.
export function App() {
  const ctx = require.context('./app');
  return <ExpoRoot context={ctx} />;
}

registerRootComponent(App);
