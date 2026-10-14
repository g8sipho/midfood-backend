import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from './src/context/AuthContext';
import { CartProvider } from './src/context/CartContext';
import { ChatProvider } from './src/context/ChatContext';
import RootNavigator from './src/navigation/RootNavigator';
import { colors } from './src/theme';

export default function App() {
  // The two faces the whole design is set in; nothing draws until they're
  // in, so no screen ever flashes in the system font first.
  const [fontsReady] = useFonts({
    'Fraunces-ExtraBold': require('./assets/fonts/Fraunces_800ExtraBold.ttf'),
    'Fraunces-SemiBold': require('./assets/fonts/Fraunces_600SemiBold.ttf'),
    'Poppins-Regular': require('./assets/fonts/Poppins-Regular.ttf'),
    'Poppins-Medium': require('./assets/fonts/Poppins-Medium.ttf'),
    'Poppins-Bold': require('./assets/fonts/Poppins-Bold.ttf'),
    'Poppins-ExtraBold': require('./assets/fonts/Poppins-ExtraBold.ttf'),
  });

  if (!fontsReady) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.plum, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.ember} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <CartProvider>
          <ChatProvider>
            <RootNavigator />
            <StatusBar style="light" />
          </ChatProvider>
        </CartProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
