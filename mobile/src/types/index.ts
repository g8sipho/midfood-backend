export type MenuItem = {
  id: string;
  name: string;
  description: string;
  price: number;
};

export type Restaurant = {
  id: string;
  open?: boolean;
  name: string;
  cuisine: string;
  etaMinutes: number;
  deliveryFee: number;
  rating: number;
  heroColor: string;
  menu?: MenuItem[];
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
  subtotal: number;
  deliveryFee: number;
  total: number;
  deliveryAddress: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  paymentReference: string | null;
  readyAt: string | null;
  driverId: string | null;
  notes: string | null;
  rejectedReason: string | null;
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
};

export type User = {
  id: string;
  name: string;
  email: string;
  createdAt: string;
};
