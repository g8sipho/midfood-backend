import React, { useEffect } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { DefaultTheme, NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { BottomTabBarProps, createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { useChat } from '../context/ChatContext';
import { colors, flame, fonts, shadow, spacing } from '../theme';
import Txt from '../components/Txt';

import LoginScreen from '../screens/LoginScreen';
import RegisterScreen from '../screens/RegisterScreen';
import ForgotPasswordScreen from '../screens/ForgotPasswordScreen';
import RestaurantListScreen from '../screens/RestaurantListScreen';
import RestaurantDetailScreen from '../screens/RestaurantDetailScreen';
import CartScreen from '../screens/CartScreen';
import CheckoutScreen from '../screens/CheckoutScreen';
import OrderListScreen from '../screens/OrderListScreen';
import OrderDetailScreen from '../screens/OrderDetailScreen';
import ProfileScreen from '../screens/ProfileScreen';
import ChatListScreen from '../screens/ChatListScreen';
import ChatThreadScreen from '../screens/ChatThreadScreen';

import type {
  AuthStackParamList,
  CartStackParamList,
  ChatsStackParamList,
  HomeStackParamList,
  OrdersStackParamList,
  RootTabParamList,
} from './types';

const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const HomeStack = createNativeStackNavigator<HomeStackParamList>();
const CartStack = createNativeStackNavigator<CartStackParamList>();
const OrdersStack = createNativeStackNavigator<OrdersStackParamList>();
const ChatsStack = createNativeStackNavigator<ChatsStackParamList>();
const Tab = createBottomTabNavigator<RootTabParamList>();

export const navigationRef = createNavigationContainerRef<RootTabParamList>();

// Every stack header: plum text on paper, Fraunces title, no hairline.
const screenOptions = {
  headerStyle: { backgroundColor: colors.paper },
  headerTintColor: colors.ink,
  headerShadowVisible: false,
  headerTitleStyle: { fontFamily: fonts.display, fontSize: 20, color: colors.ink },
  headerBackTitleVisible: false,
  contentStyle: { backgroundColor: colors.paper },
};

const navTheme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: colors.paper, primary: colors.ember, card: colors.paper, text: colors.ink },
};

// Deep links: midfood://auth?token=... (social sign-in) and
// midfood://chat/<id> (a push notification about a reply).
const linking = {
  prefixes: ['midfood://', 'https://midfood.co.za/app'],
  config: {
    screens: {
      ChatsTab: { screens: { ChatList: 'chats', ChatThread: 'chat/:conversationId' } },
      OrdersTab: { screens: { OrderList: 'orders', OrderDetail: 'order/:orderId' } },
      HomeTab: { screens: { RestaurantList: 'home', RestaurantDetail: 'store/:restaurantId' } },
    },
  },
};

function AuthNavigator() {
  return (
    <AuthStack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.plum } }}>
      <AuthStack.Screen name="Login" component={LoginScreen} />
      <AuthStack.Screen name="Register" component={RegisterScreen} />
      <AuthStack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
    </AuthStack.Navigator>
  );
}

function HomeNavigator() {
  return (
    <HomeStack.Navigator screenOptions={screenOptions}>
      <HomeStack.Screen name="RestaurantList" component={RestaurantListScreen} options={{ headerShown: false }} />
      <HomeStack.Screen name="RestaurantDetail" component={RestaurantDetailScreen} options={{ headerShown: false }} />
    </HomeStack.Navigator>
  );
}

function CartNavigator() {
  return (
    <CartStack.Navigator screenOptions={screenOptions}>
      <CartStack.Screen name="Cart" component={CartScreen} options={{ title: 'Your order' }} />
      <CartStack.Screen name="Checkout" component={CheckoutScreen} options={{ title: 'Checkout' }} />
    </CartStack.Navigator>
  );
}

function OrdersNavigator() {
  return (
    <OrdersStack.Navigator screenOptions={screenOptions}>
      <OrdersStack.Screen name="OrderList" component={OrderListScreen} options={{ title: 'My orders' }} />
      <OrdersStack.Screen name="OrderDetail" component={OrderDetailScreen} options={{ title: 'Track order' }} />
    </OrdersStack.Navigator>
  );
}

function ChatsNavigator() {
  return (
    <ChatsStack.Navigator screenOptions={screenOptions}>
      <ChatsStack.Screen name="ChatList" component={ChatListScreen} options={{ title: 'Chats' }} />
      <ChatsStack.Screen name="ChatThread" component={ChatThreadScreen} options={{ title: '' }} />
    </ChatsStack.Navigator>
  );
}

type TabIcon = keyof typeof MaterialCommunityIcons.glyphMap;
const TABS: Record<string, { label: string; icon: TabIcon; iconActive: TabIcon }> = {
  HomeTab: { label: 'Home', icon: 'silverware-fork-knife', iconActive: 'silverware-fork-knife' },
  OrdersTab: { label: 'Orders', icon: 'receipt-text-outline', iconActive: 'receipt-text' },
  CartTab: { label: 'Cart', icon: 'moped', iconActive: 'moped' },
  ChatsTab: { label: 'Chats', icon: 'chat-outline', iconActive: 'chat' },
  ProfileTab: { label: 'Account', icon: 'account-circle-outline', iconActive: 'account-circle' },
};

// The tab bar: plum, with the cart raised in the middle as an ember button
// that carries the item count. Hidden while a thread or a store is open.
function PlumTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const { itemCount } = useCart();
  const { unread } = useChat();

  const focusedRoute = state.routes[state.index];
  const nested = (focusedRoute.state as { index?: number; routes?: { name: string }[] } | undefined);
  const innerName = nested?.routes?.[nested.index ?? 0]?.name;
  if (innerName === 'ChatThread' || innerName === 'RestaurantDetail' || innerName === 'Checkout') return null;

  return (
    <View style={[styles.tabBar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
      {state.routes.map((route, index) => {
        const meta = TABS[route.name];
        const focused = state.index === index;
        const onPress = () => {
          Haptics.selectionAsync().catch(() => {});
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
        };
        if (route.name === 'CartTab') {
          return (
            <Pressable key={route.key} onPress={onPress} style={styles.cartSlot} hitSlop={8}>
              <LinearGradient colors={[...flame]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.cartButton, shadow.ember]}>
                <MaterialCommunityIcons name="moped" size={28} color={colors.onDark} />
                {itemCount > 0 ? (
                  <View style={styles.cartCount}>
                    <Txt variant="smallBold" color={colors.ember} style={{ fontSize: 11, lineHeight: 14 }}>
                      {itemCount}
                    </Txt>
                  </View>
                ) : null}
              </LinearGradient>
              <Txt variant="smallBold" color={focused ? colors.onDark : colors.onDarkSoft} style={styles.tabLabel}>
                {meta.label}
              </Txt>
            </Pressable>
          );
        }
        const badge = route.name === 'ChatsTab' ? unread : 0;
        return (
          <Pressable key={route.key} onPress={onPress} style={styles.tab} hitSlop={8}>
            <View>
              <MaterialCommunityIcons
                name={focused ? meta.iconActive : meta.icon}
                size={24}
                color={focused ? colors.ember : colors.onDarkSoft}
              />
              {badge > 0 ? (
                <View style={styles.tabBadge}>
                  <Txt variant="smallBold" color={colors.onDark} style={{ fontSize: 10, lineHeight: 12 }}>
                    {badge > 9 ? '9+' : badge}
                  </Txt>
                </View>
              ) : null}
            </View>
            <Txt variant="smallBold" color={focused ? colors.onDark : colors.onDarkSoft} style={styles.tabLabel}>
              {meta.label}
            </Txt>
            {focused ? <View style={styles.tabDot} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

function MainTabs() {
  return (
    <Tab.Navigator screenOptions={{ headerShown: false }} tabBar={(props) => <PlumTabBar {...props} />}>
      <Tab.Screen name="HomeTab" component={HomeNavigator} />
      <Tab.Screen name="OrdersTab" component={OrdersNavigator} />
      <Tab.Screen name="CartTab" component={CartNavigator} />
      <Tab.Screen name="ChatsTab" component={ChatsNavigator} />
      <Tab.Screen name="ProfileTab" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

export default function RootNavigator() {
  const { user, isLoading } = useAuth();

  // A tapped notification opens the thing it is about.
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = (response.notification.request.content.data || {}) as { conversationId?: string; orderId?: string };
      if (!navigationRef.isReady()) return;
      if (data.conversationId) {
        navigationRef.navigate('ChatsTab', { screen: 'ChatThread', params: { conversationId: data.conversationId } });
      } else if (data.orderId) {
        navigationRef.navigate('OrdersTab', { screen: 'OrderDetail', params: { orderId: data.orderId } });
      }
    });
    return () => sub.remove();
  }, []);

  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.plum }}>
        <ActivityIndicator color={colors.ember} />
      </View>
    );
  }

  return (
    <NavigationContainer ref={navigationRef} theme={navTheme} linking={user ? linking : undefined}>
      {user ? <MainTabs /> : <AuthNavigator />}
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: colors.plum,
    paddingTop: 10,
    paddingHorizontal: spacing.sm,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 4,
    gap: 3,
  },
  tabLabel: {
    fontSize: 10.5,
    lineHeight: 14,
  },
  tabDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.ember,
  },
  tabBadge: {
    position: 'absolute',
    top: -4,
    right: -8,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 3,
    backgroundColor: colors.ember,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cartSlot: {
    flex: 1,
    alignItems: 'center',
    marginTop: -26,
    gap: 3,
  },
  cartButton: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: colors.plum,
  },
  cartCount: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    backgroundColor: colors.onDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
