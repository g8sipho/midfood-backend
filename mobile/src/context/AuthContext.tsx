import React, { createContext, useContext, useEffect, useState } from 'react';
import * as WebBrowser from 'expo-web-browser';
import * as api from '../api/client';
import { registerForPushNotifications } from '../push';
import type { SocialProvider, User } from '../types';

type AuthContextValue = {
  user: User | null;
  isLoading: boolean;
  // `identifier` is the email address or the cellphone number.
  login: (identifier: string, password: string) => Promise<void>;
  register: (name: string, email: string, phone: string, password: string) => Promise<void>;
  // Finishes "forgot password": the emailed code plus the new password.
  resetPassword: (identifier: string, code: string, password: string) => Promise<void>;
  // Google or Facebook: the server does the sign-in and hands back a token.
  // Resolves false if the customer closed the browser without finishing.
  socialLogin: (provider: SocialProvider) => Promise<boolean>;
  refreshUser: () => Promise<void>;
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

  async function login(identifier: string, password: string) {
    const { token, user: loggedInUser } = await api.login(identifier, password);
    await api.setToken(token);
    setUser(loggedInUser);
    registerForPushNotifications();
  }

  async function register(name: string, email: string, phone: string, password: string) {
    const { token, user: newUser } = await api.register(name, email, phone, password);
    await api.setToken(token);
    setUser(newUser);
    registerForPushNotifications();
  }

  async function resetPassword(identifier: string, code: string, password: string) {
    const { token, user: restored } = await api.resetPassword(identifier, code, password);
    await api.setToken(token);
    setUser(restored);
    registerForPushNotifications();
  }

  async function socialLogin(provider: SocialProvider) {
    const result = await WebBrowser.openAuthSessionAsync(api.socialStartUrl(provider), 'midfood://auth');
    if (result.type !== 'success' || !result.url) return false;
    const params = new URL(result.url.replace('midfood://', 'https://midfood.co.za/')).searchParams;
    const token = params.get('token');
    const problem = params.get('error');
    if (problem) throw new Error(problem);
    if (!token) return false;
    await api.setToken(token);
    const restored = await api.fetchMe();
    setUser(restored);
    registerForPushNotifications();
    return true;
  }

  // Re-reads the account after something about it changed (a password set).
  async function refreshUser() {
    try {
      setUser(await api.fetchMe());
    } catch {
      // Keep what we have; the next launch will sort it out.
    }
  }

  async function logout() {
    await api.setToken(null);
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, isLoading, login, register, resetPassword, socialLogin, refreshUser, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
