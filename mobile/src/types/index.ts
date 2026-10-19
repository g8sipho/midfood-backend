export type MenuItem = {
  id: string;
  name: string;
  description: string;
  price: number;
  // The menu section the dish sits under, if the menu has sections.
  category?: string | null;
  // Paths on the API host (prefix with the API base URL), or null: the full
  // photo, and a small square copy for lists.
  imageUrl?: string | null;
  thumbUrl?: string | null;
};

export type Restaurant = {
  id: string;
  open?: boolean;
  name: string;
  cuisine: string;
  etaMinutes: number;
  deliveryFee: number;
  // The average of what customers gave delivered orders, or null while the
  // restaurant is too new to have a rating (show "New", never a made-up score).
  rating: number | null;
  ratingCount?: number;
  // Cover photo paths on the API host (prefix with the API base URL), or
  // null when the restaurant has none yet: the full photo and a card-sized copy.
  imageUrl?: string | null;
  thumbUrl?: string | null;
  heroColor: string;
  menu?: MenuItem[];
  // Up to three dish names that matched a search, when the list was searched.
  matches?: string[];
  // Home-screen category keys this store sits under.
  categories?: string[];
};

export type CartLine = {
  menuItem: MenuItem;
  quantity: number;
};

export type OrderStatus =
  | 'placed'
  | 'confirmed'
  | 'preparing'
  | 'out_for_delivery'
  | 'delivered'
  | 'rejected';

// Separate from OrderStatus: whether the customer has actually paid yet.
// 'pending' until PayFast confirms the payment server-to-server, 'paid' once
// it does, 'failed' if the customer cancelled or the payment didn't go through.
export type PaymentStatus = 'pending' | 'paid' | 'failed';

export type OrderItem = {
  menuItemId: string;
  name: string;
  price: number;
  quantity: number;
};

export type Order = {
  id: string;
  userId: string;
  restaurantId: string;
  restaurantName: string;
  items: OrderItem[];
  // Money: total = subtotal - discount + deliveryFee + tip.
  subtotal: number;
  // What a promo code took off, 0 when none was used.
  discount?: number;
  deliveryFee: number;
  // The driver's tip, 0 when none. All of it goes to the driver.
  tip?: number;
  total: number;
  // The promo code used, upper-case, or null.
  promoCode?: string | null;
  // When the customer asked for it, as ISO, or null for "as soon as possible".
  scheduledFor?: string | null;
  deliveryAddress: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  paymentReference: string | null;
  readyAt: string | null;
  driverId: string | null;
  notes: string | null;
  rejectedReason: string | null;
  // The customer's own 1-5 stars, once given, and the few words they wrote.
  rating?: number | null;
  review?: string | null;
  createdAt: string;
  updatedAt: string;
};

// Live tracking: the order's real status plus the driver's last known
// position, so the customer can watch their driver approach.
export type Tracking = {
  id: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  readyAt: string | null;
  restaurantName: string;
  deliveryAddress: string;
  rejectedReason: string | null;
  updatedAt: string;
  driverName: string | null;
  driverPhone: string | null;
  driverLat: number | null;
  driverLng: number | null;
  driverSeenAt: string | null;
  tip?: number;
  discount?: number;
  scheduledFor?: string | null;
  review?: string | null;
};

// An address the customer keeps for repeat orders ("Home", "Work").
export type SavedAddress = {
  id: string;
  label: string;
  line: string;
  lat: number | null;
  lng: number | null;
  createdAt: string;
  lastUsedAt: string | null;
};

// What the server says a promo code is worth on this order.
export type PromoCheck = {
  ok: true;
  code: string;
  discount: number;
  description: string;
  kind: 'fixed' | 'percent' | 'free_delivery';
};

// One customer's stars and words on a delivered order, as shown on the
// store's page. `customerName` is a first name, or "MidFood customer".
export type RestaurantReview = {
  rating: number;
  review: string | null;
  ratedAt: string;
  customerName: string;
  dishes: string[];
};

export type RestaurantReviews = {
  reviews: RestaurantReview[];
  count: number;
  withWords: number;
  // Null while fewer than three people have rated: say "New".
  average: number | null;
};

export type User = {
  id: string;
  name: string;
  email: string;
  // Ten-digit local form, 0821234567, or null for accounts made before
  // sign-up asked for it.
  phone?: string | null;
  createdAt: string;
  avatarUrl?: string | null;
  // False for an account made with "Continue with Google / Facebook" that
  // hasn't chosen a password yet.
  hasPassword?: boolean;
  linked?: { google: boolean; facebook: boolean };
};

// Where a sign-in came from, when it was not a password.
export type SocialProvider = 'google' | 'facebook';

// A tile on the home screen (see the server's src/categories.js).
export type Category = {
  key: string;
  label: string;
  // A MaterialCommunityIcons glyph name.
  icon: string;
  emoji: string;
  count: number;
};

// A dish with a photo, for the food showcase on the home screen.
export type FeaturedDish = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  category: string | null;
  restaurantId: string;
  restaurantName: string;
  restaurantOpen: boolean;
  etaMinutes: number;
  imageUrl: string | null;
  thumbUrl: string | null;
};

export type ChatSender = 'customer' | 'restaurant' | 'admin' | 'bot';

export type Conversation = {
  id: string;
  restaurantId: string | null;
  orderId: string | null;
  title: string;
  heroColor: string | null;
  open: boolean | null;
  thumbUrl: string | null;
  needsHuman: boolean;
  unread: number;
  lastMessage: string | null;
  lastSender: ChatSender | null;
  lastMessageAt: string;
};

export type ChatMessage = {
  id: string;
  sender: ChatSender;
  body: string;
  quickReplies: string[] | null;
  createdAt: string;
};
