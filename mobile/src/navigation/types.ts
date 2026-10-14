import type { NavigatorScreenParams } from '@react-navigation/native';

export type AuthStackParamList = {
  Login: undefined;
  Register: undefined;
  // `identifier` carries over whatever was typed on the sign-in screen.
  ForgotPassword: { identifier?: string } | undefined;
};

export type HomeStackParamList = {
  RestaurantList: undefined;
  RestaurantDetail: { restaurantId: string; dishId?: string };
};

export type CartStackParamList = {
  Cart: undefined;
  Checkout: undefined;
};

export type OrdersStackParamList = {
  OrderList: undefined;
  OrderDetail: { orderId: string };
};

export type ChatsStackParamList = {
  ChatList: undefined;
  // Open by thread id, or by what the thread is about (the screen opens or
  // finds the thread itself).
  ChatThread: { conversationId?: string; restaurantId?: string; orderId?: string; title?: string };
};

export type RootTabParamList = {
  HomeTab: NavigatorScreenParams<HomeStackParamList>;
  OrdersTab: NavigatorScreenParams<OrdersStackParamList>;
  CartTab: NavigatorScreenParams<CartStackParamList>;
  ChatsTab: NavigatorScreenParams<ChatsStackParamList>;
  ProfileTab: undefined;
};
