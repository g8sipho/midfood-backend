import React, { createContext, useContext, useEffect, useState } from 'react';
import * as api from '../api/client';
import { registerForPushNotifications } from '../push';
import type { User } from '../types';

type AuthContextValue = {
  user: User | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Restore the saved session on launch so customers stay logged in between
  // app opens. The token lives in AsyncStorage; GET /api/auth/me turns it
  // back into a user, and an expired or revoked token just clears itself.
  useEffect(() => {
    (async () => {
      try {
        const token = await api.getToken();
        if (!token) return;
        const restored = await api.fetchMe();
        setUser(restored);
        registerForPushNotifications();
      } catch {
        await api.setToken(null);
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  async function login(email: string, password: string) {
    const { token, user: loggedInUser } = await api.login(email, password);
    await api.setToken(token);
    setUser(loggedInUser);
    registerForPushNotifications();
  }

  async function register(name: string, email: string, password: string) {
    const { token, user: newUser } = await api.register(name, email, password);
    await api.setToken(token);
    setUser(newUser);
    registerForPushNotifications();
  }

  async function logout() {
    await api.setToken(null);
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, isLoading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
