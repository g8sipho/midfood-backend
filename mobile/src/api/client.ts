import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE_URL } from './config';
import type { Order, Restaurant, Tracking, User } from '../types';

const TOKEN_KEY = 'midfood.authToken';

let cachedToken: string | null = null;

export async function getToken(): Promise<string | null> {
  if (cachedToken !== null) return cachedToken;
  cachedToken = await AsyncStorage.getItem(TOKEN_KEY);
  return cachedToken;
}

export async function setToken(token: string | null): Promise<void> {
  cachedToken = token;
  if (token) {
    await AsyncStorage.setItem(TOKEN_KEY, token);
  } else {
    await AsyncStorage.removeItem(TOKEN_KEY);
  }
}

class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = await getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
  } catch (err) {
    throw new ApiError(
      `Could not reach the MidFood server at ${API_BASE_URL}. Is the backend running and is API_BASE_URL set correctly for your device? (src/api/config.ts)`,
      0
    );
  }

  const isJson = response.headers.get('content-type')?.includes('application/json');
  const body = isJson ? await response.json() : undefined;

  if (!response.ok) {
    const message = body?.error || `Request failed with status ${response.status}`;
    throw new ApiError(message, response.status);
  }

  return body as T;
}

// --- Auth ---

export async function register(name: string, email: string, password: string) {
  return request<{ token: string; user: User }>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name, email, password }),
  });
}

export async function login(email: string, password: string) {
  return request<{ token: string; user: User }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

// Restores a saved session on app launch (see context/AuthContext).
export async function fetchMe() {
  const data = await request<{ user: User }>('/api/auth/me');
  return data.user;
}

// --- Restaurants ---

export async function fetchRestaurants() {
  const data = await request<{ restaurants: Restaurant[] }>('/api/restaurants');
  return data.restaurants;
}

export async function fetchRestaurant(id: string) {
  const data = await request<{ restaurant: Restaurant }>(`/api/restaurants/${id}`);
  return data.restaurant;
}

// --- Orders ---

export async function placeOrder(params: {
  restaurantId: string;
  items: { menuItemId: string; quantity: number }[];
  deliveryAddress: string;
  customerPhone?: string;
  notes?: string;
}) {
  // paymentUrl is null if PayFast isn't configured on the backend -- callers
  // should handle that by skipping straight to the order screen.
  return request<{ order: Order; paymentUrl: string | null }>('/api/orders', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

// Gets a fresh PayFast payment link for an order that hasn't been paid yet --
// used to retry payment if the customer backed out or it failed the first time.
export async function requestPayfastCheckout(orderId: string) {
  const data = await request<{ paymentUrl: string }>(`/api/orders/${orderId}/payfast-checkout`, {
    method: 'POST',
  });
  return data.paymentUrl;
}

export async function fetchOrders() {
  const data = await request<{ orders: Order[] }>('/api/orders');
  return data.orders;
}

export async function fetchOrder(id: string) {
  const data = await request<{ order: Order }>(`/api/orders/${id}`);
  return data.order;
}

// Live tracking for an order: kitchen/delivery status plus the driver's last
// known position. Replaces the old development-only advanceOrder() call --
// statuses now come from the restaurant portal and the driver app for real.
export async function fetchTracking(id: string) {
  const data = await request<{ tracking: Tracking }>(`/api/orders/${id}/tracking`);
  return data.tracking;
}

// Registers this phone for order-status push notifications.
export async function registerPushToken(token: string, phone?: string) {
  return request<{ ok: boolean }>('/api/auth/push-token', {
    method: 'PUT',
    body: JSON.stringify({ token, phone }),
  });
}

export { ApiError };
