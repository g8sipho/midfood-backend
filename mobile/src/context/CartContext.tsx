import React, { createContext, useContext, useMemo, useState } from 'react';
import type { CartLine, MenuItem, Restaurant } from '../types';

type CartContextValue = {
  restaurant: Restaurant | null;
  lines: CartLine[];
  subtotal: number;
  itemCount: number;
  addItem: (restaurant: Restaurant, item: MenuItem) => void;
  removeItem: (menuItemId: string) => void;
  setQuantity: (menuItemId: string, quantity: number) => void;
  clear: () => void;
};

const CartContext = createContext<CartContextValue | undefined>(undefined);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [lines, setLines] = useState<CartLine[]>([]);

  function addItem(newRestaurant: Restaurant, item: MenuItem) {
    // MidFood carts are single-restaurant, like most delivery apps: adding
    // from a different restaurant starts a fresh cart rather than mixing
    // deliveries.
    setRestaurant((current) => {
      if (current && current.id !== newRestaurant.id) {
        setLines([{ menuItem: item, quantity: 1 }]);
        return newRestaurant;
      }
      setLines((currentLines) => {
        const existing = currentLines.find((l) => l.menuItem.id === item.id);
        if (existing) {
          return currentLines.map((l) =>
            l.menuItem.id === item.id ? { ...l, quantity: l.quantity + 1 } : l
          );
        }
        return [...currentLines, { menuItem: item, quantity: 1 }];
      });
      return newRestaurant;
    });
  }

  function removeItem(menuItemId: string) {
    setLines((current) => current.filter((l) => l.menuItem.id !== menuItemId));
  }

  function setQuantity(menuItemId: string, quantity: number) {
    if (quantity <= 0) {
      removeItem(menuItemId);
      return;
    }
    setLines((current) =>
      current.map((l) => (l.menuItem.id === menuItemId ? { ...l, quantity } : l))
    );
  }

  function clear() {
    setRestaurant(null);
    setLines([]);
  }

  const subtotal = useMemo(
    () => lines.reduce((sum, l) => sum + l.menuItem.price * l.quantity, 0),
    [lines]
  );
  const itemCount = useMemo(() => lines.reduce((sum, l) => sum + l.quantity, 0), [lines]);

  return (
    <CartContext.Provider
      value={{ restaurant, lines, subtotal, itemCount, addItem, removeItem, setQuantity, clear }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within a CartProvider');
  return ctx;
}
