import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fetchMessages, openConversation, sendMessage } from '../api/client';
import { useChat } from '../context/ChatContext';
import Txt from '../components/Txt';
import { Icon, Skeleton } from '../components/ui';
import { colors, fonts, radius, spacing } from '../theme';
import type { ChatMessage, Conversation } from '../types';
import type { ChatsStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<ChatsStackParamList, 'ChatThread'>;

// How often to look for a reply from the kitchen while the thread is open.
const POLL_MS = 5000;

function clock(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function ChatThreadScreen({ route, navigation }: Props) {
  const { conversationId, restaurantId, orderId, title } = route.params;
  const insets = useSafeAreaInsets();
  const { refreshUnread } = useChat();
  const [convo, setConvo] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const lastAt = useRef<string | null>(null);
  const listRef = useRef<FlatList<ChatMessage>>(null);

  useLayoutEffect(() => {
    navigation.setOptions({ title: convo?.title || title || 'Chat' });
  }, [navigation, convo?.title, title]);

  // Find or open the thread, then load what's in it.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let id = conversationId;
        let c: Conversation | null = null;
        if (!id) {
          c = await openConversation(restaurantId || orderId ? { restaurantId, orderId } : {});
          id = c.id;
        } else if (orderId) {
          c = await openConversation({ orderId });
        }
        if (cancelled) return;
        if (c) setConvo(c);
        else setConvo({ id, title: title || 'Chat' } as Conversation);
        const initial = await fetchMessages(id);
        if (cancelled) return;
        setMessages(initial);
        lastAt.current = initial.length ? initial[initial.length - 1].createdAt : null;
        refreshUnread();
      } catch (err: any) {
        if (!cancelled) setError(err.message || "Couldn't open this chat.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [conversationId, restaurantId, orderId]);

  const pull = useCallback(async () => {
    if (!convo?.id) return;
    try {
      const fresh = await fetchMessages(convo.id, lastAt.current);
      if (fresh.length) {
        setMessages((m) => {
          const seen = new Set(m.map((x) => x.id));
          const add = fresh.filter((x) => !seen.has(x.id));
          return add.length ? [...m, ...add] : m;
        });
        lastAt.current = fresh[fresh.length - 1].createdAt;
        if (fresh.some((m) => m.sender !== 'customer')) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        }
        refreshUnread();
      }
    } catch {
      /* next poll */
    }
  }, [convo?.id, refreshUnread]);

  useEffect(() => {
    if (!convo?.id) return;
    const t = setInterval(pull, POLL_MS);
    return () => clearInterval(t);
  }, [convo?.id, pull]);

  useEffect(() => {
    if (messages.length) setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 60);
  }, [messages.length, typing]);

  async function send(body: string) {
    const clean = body.trim();
    if (!clean || !convo?.id || sending) return;
    setText('');
    setSending(true);
    setError(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    try {
      const { message, reply } = await sendMessage(convo.id, clean);
      setMessages((m) => [...m, message]);
      lastAt.current = message.createdAt;
      if (reply) {
        // A beat before the answer appears, so it reads as a reply, not an echo.
        setTyping(true);
        await new Promise((r) => setTimeout(r, 650));
        setTyping(false);
        setMessages((m) => [...m, reply]);
        lastAt.current = reply.createdAt;
      }
    } catch (err: any) {
      setError(err.message || "That didn't send. Try again.");
      setText(clean);
    } finally {
      setSending(false);
    }
  }

  const last = messages[messages.length - 1];
  const quick = last && last.sender === 'bot' && last.quickReplies && last.quickReplies.length ? last.quickReplies : null;
  const isSupport = convo && !convo.restaurantId;

  if (error && !messages.length) {
    return (
      <View style={styles.centered}>
        <Txt variant="body" color={colors.berry} center>
          {error}
        </Txt>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      {!convo ? (
        <View style={{ padding: spacing.lg, gap: spacing.md }}>
          <Skeleton height={60} width="70%" round={radius.lg} />
          <Skeleton height={44} width="50%" round={radius.lg} style={{ alignSelf: 'flex-end' }} />
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <View style={styles.intro}>
              <View style={[styles.introIcon, isSupport && { backgroundColor: colors.plum }]}>
                <Icon name={isSupport ? 'lifebuoy' : 'storefront-outline'} size={22} color={isSupport ? colors.onDark : colors.ember} />
              </View>
              <Txt variant="small" center style={{ maxWidth: 280 }}>
                {isSupport
                  ? 'MidFood support. Quick questions are answered on the spot; a person picks up the rest.'
                  : `This chat goes to ${convo.title}. Quick questions are answered on the spot; the kitchen answers the rest while it's open.`}
              </Txt>
            </View>
          }
          ListFooterComponent={
            typing ? (
              <View style={[styles.bubbleRow, styles.left]}>
                <View style={[styles.bubble, styles.bubbleBot]}>
                  <Txt variant="small">…</Txt>
                </View>
              </View>
            ) : null
          }
          renderItem={({ item, index }) => {
            const mine = item.sender === 'customer';
            const bot = item.sender === 'bot';
            const prev = messages[index - 1];
            const sameAsPrev = prev && prev.sender === item.sender;
            return (
              <View style={[styles.bubbleRow, mine ? styles.right : styles.left, sameAsPrev && { marginTop: -4 }]}>
                <View style={[styles.bubble, mine ? styles.bubbleMine : bot ? styles.bubbleBot : styles.bubbleTheirs]}>
                  {!mine && !sameAsPrev ? (
                    <Txt variant="smallBold" color={bot ? colors.plumSoft : colors.ember} style={styles.sender}>
                      {bot ? 'Instant answer' : item.sender === 'admin' ? 'MidFood' : convo.title}
                    </Txt>
                  ) : null}
                  <Txt variant="body" color={mine ? colors.onDark : colors.ink}>
                    {item.body}
                  </Txt>
                  <Txt variant="small" color={mine ? 'rgba(255,255,255,0.7)' : colors.inkFaint} style={styles.time}>
                    {clock(item.createdAt)}
                  </Txt>
                </View>
              </View>
            );
          }}
        />
      )}

      {quick && !typing ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.quickBar} contentContainerStyle={styles.quick} keyboardShouldPersistTaps="handled">
          {quick.map((q) => (
            <Pressable key={q} onPress={() => send(q)} style={({ pressed }) => [styles.quickChip, pressed && { backgroundColor: colors.emberSoft }]}>
              <Txt variant="smallBold" color={colors.emberDeep}>
                {q}
              </Txt>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      {error && messages.length ? (
        <Txt variant="small" color={colors.berry} center style={{ paddingHorizontal: spacing.lg }}>
          {error}
        </Txt>
      ) : null}

      <View style={[styles.compose, { paddingBottom: insets.bottom + spacing.sm }]}>
        <TextInput
          style={styles.input}
          placeholder={isSupport ? 'Message MidFood…' : `Message ${convo?.title || 'the kitchen'}…`}
          placeholderTextColor={colors.inkFaint}
          value={text}
          onChangeText={setText}
          multiline
          maxLength={1000}
          editable={Boolean(convo) && !sending}
        />
        <Pressable onPress={() => send(text)} disabled={!text.trim() || sending} style={[styles.sendBtn, (!text.trim() || sending) && { opacity: 0.4 }]}>
          <Icon name="send" size={20} color={colors.onDark} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  list: {
    padding: spacing.lg,
    paddingBottom: spacing.md,
  },
  intro: {
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  introIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.emberSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bubbleRow: {
    flexDirection: 'row',
    marginBottom: spacing.sm,
  },
  left: {
    justifyContent: 'flex-start',
  },
  right: {
    justifyContent: 'flex-end',
  },
  bubble: {
    maxWidth: '82%',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.lg,
  },
  bubbleMine: {
    backgroundColor: colors.ember,
    borderBottomRightRadius: 6,
  },
  bubbleTheirs: {
    backgroundColor: colors.surface,
    borderBottomLeftRadius: 6,
  },
  bubbleBot: {
    backgroundColor: colors.sand,
    borderBottomLeftRadius: 6,
  },
  sender: {
    fontSize: 11,
    marginBottom: 2,
  },
  time: {
    fontSize: 10.5,
    lineHeight: 14,
    marginTop: 3,
    alignSelf: 'flex-end',
  },
  quickBar: {
    flexGrow: 0,
    flexShrink: 0,
  },
  quick: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
    alignItems: 'center',
  },
  quickChip: {
    borderWidth: 1.5,
    borderColor: colors.ember,
    borderRadius: radius.pill,
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: colors.surface,
  },
  compose: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  input: {
    flex: 1,
    fontFamily: fonts.medium,
    fontSize: 15,
    color: colors.ink,
    backgroundColor: colors.paper,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingTop: 12,
    paddingBottom: 12,
    maxHeight: 120,
  },
  sendBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.ember,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
