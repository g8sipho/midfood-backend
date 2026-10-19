import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE_URL } from './config';
import type {
  Category,
  FeaturedDish,
  ChatMessage,
  Conversation,
  Order,
  PromoCheck,
  Restaurant,
  RestaurantReviews,
  SavedAddress,
  SocialProvider,
  Tracking,
  User,
} from '../types';

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
  // The server's JSON body, for answers that carry more than `error`
  // (a rejected promo code, a changed price).
  body: Record<string, unknown> | undefined;
  constructor(message: string, status: number, body?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.body = body;
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
    throw new ApiError(message, response.status, body && typeof body === 'object' ? body : undefined);
  }

  return body as T;
}

// True when a thrown error is the server saying no (as opposed to no network).
export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}

// --- Auth ---

export async function register(name: string, email: string, phone: string, password: string) {
  return request<{ token: string; user: User }>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name, email, phone, password }),
  });
}

// `identifier` is the email address or the cellphone number.
export async function login(identifier: string, password: string) {
  return request<{ token: string; user: User }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier, password }),
  });
}

// Forgot password, step 1: the server emails a 6-digit code to the address
// on the account. `emailHint` is the masked address it went to.
export async function forgotPassword(identifier: string) {
  return request<{ ok: true; message: string; emailHint?: string }>('/api/auth/forgot', {
    method: 'POST',
    body: JSON.stringify({ identifier }),
  });
}

// Forgot password, step 2: the code plus the new password. Signs them in.
export async function resetPassword(identifier: string, code: string, password: string) {
  return request<{ token: string; user: User }>('/api/auth/reset', {
    method: 'POST',
    body: JSON.stringify({ identifier, code, password }),
  });
}

// A signed-in customer changing their own password.
export async function changePassword(currentPassword: string | null, newPassword: string) {
  return request<{ ok: true }>('/api/auth/password', {
    method: 'PUT',
    body: JSON.stringify(currentPassword ? { currentPassword, newPassword } : { newPassword }),
  });
}

// Deletes the signed-in customer's account for good. The password is needed
// when the account has one; a Google/Facebook-only account sends just the
// confirmation word. Callers clear the token afterwards.
export async function deleteAccount(params: { password?: string; confirm: string }) {
  return request<{ ok: true; message: string }>('/api/auth/account', {
    method: 'DELETE',
    body: JSON.stringify(params.password ? params : { confirm: params.confirm }),
  });
}

// Turns an image path from the API ("/api/images/<id>/thumb") into a URL the
// phone can load. Null stays null so callers can fall back to a colour block.
export function imageSource(path?: string | null): { uri: string } | null {
  return path ? { uri: `${API_BASE_URL}${path}` } : null;
}

// Restores a saved session on app launch (see context/AuthContext).
export async function fetchMe() {
  const data = await request<{ user: User }>('/api/auth/me');
  return data.user;
}

// --- Restaurants ---

// The home feed, or with `query` only the restaurants whose name, kind of
// food or menu matches (each with up to three matching dish names).
export async function fetchRestaurants(query?: string) {
  const q = (query || '').trim();
  const data = await request<{ restaurants: Restaurant[] }>(
    q ? `/api/restaurants?q=${encodeURIComponent(q)}` : '/api/restaurants'
  );
  return data.restaurants;
}

export async function fetchRestaurant(id: string) {
  const data = await request<{ restaurant: Restaurant }>(`/api/restaurants/${id}`);
  return data.restaurant;
}

// What customers said about a store: words first, newest first.
export async function fetchReviews(id: string, limit = 20) {
  return request<RestaurantReviews>(`/api/restaurants/${id}/reviews?limit=${limit}`);
}

// --- Favourites ---

export async function fetchFavourites() {
  const data = await request<{ restaurantIds: string[] }>('/api/customer/favourites');
  return data.restaurantIds;
}

export async function setFavourite(restaurantId: string, on: boolean) {
  return request<{ ok: true; favourite: boolean }>(`/api/customer/favourites/${restaurantId}`, {
    method: on ? 'PUT' : 'DELETE',
  });
}

// --- Saved addresses ---

export async function fetchAddresses() {
  const data = await request<{ addresses: SavedAddress[] }>('/api/customer/addresses');
  return data.addresses;
}

// Saves an address under a label ("Home"); a same-named one is replaced.
export async function saveAddress(params: { label: string; line: string; lat?: number | null; lng?: number | null }) {
  const data = await request<{ address: SavedAddress }>('/api/customer/addresses', {
    method: 'POST',
    body: JSON.stringify(params),
  });
  return data.address;
}

export async function deleteAddress(id: string) {
  return request<{ ok: true }>(`/api/customer/addresses/${id}`, { method: 'DELETE' });
}

// --- Orders ---

export async function placeOrder(params: {
  restaurantId: string;
  items: { menuItemId: string; quantity: number }[];
  deliveryAddress: string;
  customerPhone?: string;
  notes?: string;
  // The customer's GPS pin, if their phone gave a good one.
  deliveryLat?: number;
  deliveryLng?: number;
  // A saved address they picked (the text above is still sent).
  addressId?: string;
  // Upper-case promo code; the server answers 400 { promoRejected } if it
  // doesn't apply.
  promoCode?: string;
  // Rands for the driver, 0..500.
  tip?: number;
  // ISO datetime for "order for later", or omitted for as soon as possible.
  scheduledFor?: string;
  // The total the screen showed (food - promo + delivery + tip). The server
  // answers 409 { priceChanged, total } if its own figure differs.
  expectedTotal?: number;
}) {
  // paymentUrl is null if PayFast isn't configured on the backend -- callers
  // should handle that by skipping straight to the order screen.
  return request<{ order: Order; paymentUrl: string | null }>('/api/orders', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

// Asks whether a promo code applies to this basket, before paying.
export async function checkPromo(params: { code: string; restaurantId: string; subtotal: number }) {
  return request<PromoCheck>('/api/orders/promo-check', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

// Gets a fresh PayFast payment link for an order that hasn't been paid yet --
// used to retry payment if the customer backed out or it failed the first time.
export async function requestPayfastCheckout(orderId: string) {
  const data = await request<{ paymentUrl: string }>(`/api/orders/${orderId}/checkout`, {
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

// --- Home-screen categories ---

export async function fetchFeaturedDishes(limit = 12) {
  const data = await request<{ dishes: FeaturedDish[] }>(`/api/restaurants/dishes/featured?limit=${limit}`);
  return data.dishes;
}

export async function fetchCategories() {
  const data = await request<{ categories: Category[] }>('/api/restaurants/categories');
  return data.categories;
}

// --- Ratings ---

// Stars, and a few words if they like. Sending stars without the words
// clears any words saved before, so callers pass the existing review along.
export async function rateOrder(orderId: string, rating: number, review?: string | null) {
  return request<{ ok: true; rating: number; review: string | null }>(`/api/orders/${orderId}/rating`, {
    method: 'POST',
    body: JSON.stringify(review ? { rating, review } : { rating }),
  });
}

// --- Chat ---

export async function fetchConversations() {
  const data = await request<{ conversations: Conversation[] }>('/api/chat/conversations');
  return data.conversations;
}

export async function fetchChatUnread() {
  const data = await request<{ unread: number }>('/api/chat/unread');
  return data.unread;
}

// Opens (or finds) the thread with a kitchen; no restaurantId means MidFood.
export async function openConversation(params: { restaurantId?: string; orderId?: string }) {
  const data = await request<{ conversation: Conversation }>('/api/chat/conversations', {
    method: 'POST',
    body: JSON.stringify(params),
  });
  return data.conversation;
}

export async function fetchMessages(conversationId: string, after?: string | null) {
  const q = after ? `?after=${encodeURIComponent(after)}` : '';
  const data = await request<{ messages: ChatMessage[] }>(`/api/chat/conversations/${conversationId}/messages${q}`);
  return data.messages;
}

export async function sendMessage(conversationId: string, body: string) {
  return request<{ message: ChatMessage; reply: ChatMessage | null }>(`/api/chat/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  });
}

// --- Social sign-in ---

// Where the phone sends the customer to sign in with Google or Facebook. The
// server does the whole dance and comes back to the app with a token.
export function socialStartUrl(provider: SocialProvider) {
  return `${API_BASE_URL}/api/auth/${provider}/start?platform=app`;
}

// Which of the social sign-ins the server has keys for.
export async function fetchSocialProviders() {
  return request<Record<SocialProvider, boolean>>('/api/auth/providers');
}
