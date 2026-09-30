// Order-status push notifications.
//
// Expo's push service delivers these; the backend sends them from src/notify.js
// whenever an order changes hands (accepted, preparing, ready, picked up,
// delivered). Everything here is best-effort: on a simulator, or if the
// customer declines the permission prompt, the app carries on silently.
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { registerPushToken } from './api/client';

// Show a banner even while the app is in the foreground.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function registerForPushNotifications(): Promise<string | null> {
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('orders', {
        name: 'Order updates',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
      });
    }

    const existing = await Notifications.getPermissionsAsync();
    let granted = existing.granted;
    if (!granted && existing.canAskAgain) {
      granted = (await Notifications.requestPermissionsAsync()).granted;
    }
    if (!granted) return null;

    // The project id is what routes a push to this specific app; EAS injects
    // it into the build, so it's read from the config rather than hardcoded.
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    const { data: token } = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );

    await registerPushToken(token);
    return token;
  } catch (err) {
    console.warn('Push notifications unavailable:', err);
    return null;
  }
}
