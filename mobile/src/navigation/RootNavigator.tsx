import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { colors } from '../theme/colors';

import LoginScreen from '../screens/LoginScreen';
import RegisterScreen from '../screens/RegisterScreen';
import RestaurantListScreen from '../screens/RestaurantListScreen';
import RestaurantDetailScreen from '../screens/RestaurantDetailScreen';
import CartScreen from '../screens/CartScreen';
import CheckoutScreen from '../screens/CheckoutScreen';
import OrderListScreen from '../screens/OrderListScreen';
import OrderDetailScreen from '../screens/OrderDetailScreen';
import ProfileScreen from '../screens/ProfileScreen';

import type {
  AuthStackParamList,
  HomeStackParamList,
  OrdersStackParamList,
  RootTabParamList,
} from './types';

const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const HomeStack = createNativeStackNavigator<HomeStackParamList>();
const OrdersStack = createNativeStackNavigator<OrdersStackParamList>();
const Tab = createBottomTabNavigator<RootTabParamList>();

const screenOptions = {
  headerStyle: { backgroundColor: colors.bgApp },
  headerTintColor: colors.textPrimary,
  headerShadowVisible: false,
  contentStyle: { backgroundColor: colors.bgApp },
};

function AuthNavigator() {
  return (
    <AuthStack.Navigator screenOptions={{ headerShown: false }}>
      <AuthStack.Screen name="Login" component={LoginScreen} />
      <AuthStack.Screen name="Register" component={RegisterScreen} />
    </AuthStack.Navigator>
  );
}

function HomeNavigator() {
  return (
    <HomeStack.Navigator screenOptions={screenOptions}>
      <HomeStack.Screen
        name="RestaurantList"
        component={RestaurantListScreen}
        options={{ title: 'MidFood', headerShown: false }}
      />
      <HomeStack.Screen name="RestaurantDetail" component={RestaurantDetailScreen} options={{ title: '' }} />
      <HomeStack.Screen name="Cart" component={CartScreen} options={{ title: 'Your cart' }} />
      <HomeStack.Screen name="Checkout" component={CheckoutScreen} options={{ title: 'Checkout' }} />
    </HomeStack.Navigator>
  );
}

function OrdersNavigator() {
  return (
    <OrdersStack.Navigator screenOptions={screenOptions}>
      <OrdersStack.Screen name="OrderList" component={OrderListScreen} options={{ title: 'My orders' }} />
      <OrdersStack.Screen name="OrderDetail" component={OrderDetailScreen} options={{ title: 'Order status' }} />
    </OrdersStack.Navigator>
  );
}

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accentPrimary,
        tabBarInactiveTintColor: colors.textTertiary,
        tabBarStyle: { backgroundColor: colors.bgSurface, borderTopColor: colors.border },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '700' },
      }}
    >
      <Tab.Screen
        name="HomeTab"
        component={HomeNavigator}
        options={{
          title: 'Home',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'home' : 'home-outline'} size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="OrdersTab"
        component={OrdersNavigator}
        options={{
          title: 'My orders',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'receipt' : 'receipt-outline'} size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="ProfileTab"
        component={ProfileScreen}
        options={{
          title: 'Account',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'person' : 'person-outline'} size={size} color={color} />
          ),
        }}
      />
    </Tab.Navigator>
  );
}

export default function RootNavigator() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bgApp }}>
        <ActivityIndicator color={colors.accentPrimary} />
      </View>
    );
  }

  return <NavigationContainer>{user ? <MainTabs /> : <AuthNavigator />}</NavigationContainer>;
}
