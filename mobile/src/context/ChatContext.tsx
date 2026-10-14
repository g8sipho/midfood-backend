import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as api from '../api/client';
import { useAuth } from './AuthContext';

type ChatContextValue = {
  // Messages waiting for the customer, across every thread (the tab badge).
  unread: number;
  refreshUnread: () => Promise<void>;
};

const ChatContext = createContext<ChatContextValue | undefined>(undefined);

// How often the badge checks for new replies while the app is open.
const BADGE_INTERVAL_MS = 20000;

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [unread, setUnread] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshUnread = useCallback(async () => {
    if (!user) {
      setUnread(0);
      return;
    }
    try {
      setUnread(await api.fetchChatUnread());
    } catch {
      /* keep the last count */
    }
  }, [user]);

  useEffect(() => {
    refreshUnread();
    if (timer.current) clearInterval(timer.current);
    timer.current = setInterval(refreshUnread, BADGE_INTERVAL_MS);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshUnread();
    });
    return () => {
      if (timer.current) clearInterval(timer.current);
      sub.remove();
    };
  }, [refreshUnread]);

  return <ChatContext.Provider value={{ unread, refreshUnread }}>{children}</ChatContext.Provider>;
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used within a ChatProvider');
  return ctx;
}
