import { getCurrentProfile, getUser } from '@festival/data-access';
import { Redirect } from 'expo-router';
import React from 'react';
import { ActivityIndicator, View } from 'react-native';

export default function IndexScreen() {
  const [destination, setDestination] = React.useState<string | null>(null);

  React.useEffect(() => {
    let mounted = true;

    void (async () => {
      const user = await getUser().catch(() => null);
      const profile = user ? await getCurrentProfile().catch(() => null) : null;
      if (!mounted) {
        return;
      }

      if (!user) {
        setDestination('/auth/enter-email');
        return;
      }

      if (!profile) {
        setDestination('/auth/profile-setup');
        return;
      }

      setDestination('/(tabs)/festivals');
    })();

    return () => {
      mounted = false;
    };
  }, []);

  if (!destination) {
    return (
      <View style={{ alignItems: 'center', flex: 1, justifyContent: 'center' }}>
        <ActivityIndicator size="large" color="#e85d3f" />
      </View>
    );
  }

  return <Redirect href={destination as never} />;
}
